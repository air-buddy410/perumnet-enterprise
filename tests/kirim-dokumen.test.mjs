// Mengirim dokumen resmi lewat email, dengan PDF-nya sebagai lampiran:
// SPK/PO ke vendor; quotation, invoice, dan BAST ke klien.
//
// Tes terpenting di berkas ini adalah yang menjaga uang: SPK punya dua edisi,
// dan yang internal memuat kolom Budget — harga modal PerumNet per item. Yang
// diuji bukan nama berkasnya, melainkan ISI PDF yang benar-benar terkirim,
// dibaca ulang dari pesan SMTP-nya. Nama berkas bisa berubah tanpa isinya
// berubah, dan sebaliknya.
//
// Server SMTP palsu di sini benar-benar bicara SMTP. Menandai baris di database
// hanya akan menguji SQL milik tes ini sendiri.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { PDFParse } from "pdf-parse";

let server;
let smtp;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";
const diterimaSmtp = [];

const WORKER_SECRET = "rahasia-worker-uji";

// Angka yang tidak mungkin muncul dari perhitungan lain. Kalau ia sampai
// terbaca di PDF yang dikirim ke vendor, itu harga modal kita.
const BUDGET_RAHASIA = 7_777_777;
const HARGA_VENDOR = 9_000_000;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address();
      listener.close(() => resolve(port));
    });
  });
}

function mulaiSmtpPalsu(port) {
  return new Promise((resolve) => {
    const srv = createServer((socket) => {
      let buffer = "";
      let dalamData = false;
      let pesan = "";
      let penerima = "";
      const balas = (baris) => socket.write(`${baris}\r\n`);
      balas("220 uji.local ESMTP siap");
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (dalamData) {
          const penutup = buffer.indexOf("\r\n.\r\n");
          if (penutup === -1) return;
          pesan += buffer.slice(0, penutup);
          buffer = buffer.slice(penutup + 5);
          dalamData = false;
          diterimaSmtp.push({ penerima, pesan });
          pesan = "";
          balas("250 2.0.0 OK diterima");
        }
        let potong;
        while (!dalamData && (potong = buffer.indexOf("\r\n")) !== -1) {
          const baris = buffer.slice(0, potong);
          buffer = buffer.slice(potong + 2);
          const perintah = baris.toUpperCase();
          if (perintah.startsWith("EHLO") || perintah.startsWith("HELO")) {
            socket.write("250-uji.local\r\n250-SIZE 26214400\r\n250 AUTH PLAIN\r\n");
          } else if (perintah.startsWith("AUTH PLAIN")) {
            balas("235 2.7.0 Authentication successful");
          } else if (perintah.startsWith("MAIL FROM")) {
            balas("250 2.1.0 OK");
          } else if (perintah.startsWith("RCPT TO")) {
            const cocok = baris.match(/<([^>]*)>/);
            penerima = cocok ? cocok[1] : "";
            balas("250 2.1.5 OK");
          } else if (perintah === "DATA") {
            dalamData = true;
            balas("354 Kirim isinya");
          } else if (perintah.startsWith("QUIT")) {
            balas("221 2.0.0 Selamat tinggal");
            socket.end();
          } else {
            balas("250 2.0.0 OK");
          }
        }
      });
      socket.on("error", () => {});
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 40_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
      lastError = new Error(`Health mengembalikan ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError ?? new Error("Server tidak pernah siap.");
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return await fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function json(path, options = {}, expectedStatus = 200) {
  const response = await request(path, options);
  const payload = response.status === 204 ? null : await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${path} -> ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload?.data ?? payload;
}

async function galat(path, options = {}) {
  const response = await request(path, options);
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    code: payload?.error?.code,
    message: payload?.error?.message,
    details: payload?.error?.details,
  };
}

async function loginAsAdmin() {
  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
    redirect: "manual",
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function attachment(label) {
  return {
    name: `${label}.pdf`,
    mimeType: "application/pdf",
    contentBase64: Buffer.from("%PDF-1.4\n%%EOF\n", "utf8").toString("base64"),
  };
}

async function jalankanWorker() {
  const response = await fetch(`${baseUrl}/api/internal/email-dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 200);
}

/** Mengambil lampiran PDF pertama dari pesan SMTP mentah. */
function pdfDariPesan(pesan) {
  const bagian = pesan.split(/--[-\w]+/);
  for (const b of bagian) {
    if (!/Content-Type: application\/pdf/i.test(b)) continue;
    const pisah = b.indexOf("\r\n\r\n");
    if (pisah === -1) continue;
    const base64 = b.slice(pisah + 4).replace(/[^A-Za-z0-9+/=]/g, "");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.subarray(0, 4).toString() === "%PDF") return bytes;
  }
  return null;
}

async function teksPdf(bytes) {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const info = await parser.getInfo();
    const parsed = await parser.getText({ first: info.total });
    return parsed.text.replace(/ /g, " ").replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

let konteks = {};

before(async () => {
  const port = await freePort();
  const smtpPort = await freePort();
  smtp = await mulaiSmtpPalsu(smtpPort);
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-kirim-spk-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-kirim-spk-uploads-${process.pid}-${Date.now()}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        GEOCODING_ENABLED: "false",
        TURSO_DATABASE_URL: `file:${databasePath}`,
        APP_URL: baseUrl,
        UPLOAD_DIR: uploadDirectory,
        EMAIL_WORKER_SECRET: WORKER_SECRET,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(smtpPort),
        SMTP_SECURE: "false",
        SMTP_USER: "uji",
        SMTP_PASS: "uji",
        EMAIL_FROM: "PerumNet Enterprise <it@perumnet.id>",
        RESEND_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
  await loginAsAdmin();

  const project = await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Proyek Kirim SPK",
        client: "Klien Uji",
        location: "Denpasar",
        status: "Aktif",
        value: 0,
      }),
    },
    201,
  );
  await json(
    `/api/boq/items?projectId=${project.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Jasa",
        description: "Instalasi jaringan",
        // Dua, karena tesnya membuat DUA SPK dari item yang sama: satu untuk
        // vendor yang punya email dan satu untuk yang tidak.
        quantity: 2,
        unit: "paket",
        costPrice: BUDGET_RAHASIA,
        sellingPrice: 12_000_000,
      }),
    },
    201,
  );
  // Satu Perangkat, supaya proyek ini bisa melewati Validasi Perangkat —
  // syarat BAST. Validasi hanya menghitung Perangkat dan Material; BoQ yang
  // isinya Jasa saja ditolak dengan VALIDATION_ITEMS_REQUIRED.
  await json(
    `/api/boq/items?projectId=${project.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Perangkat",
        description: "Access Point",
        quantity: 1,
        unit: "unit",
        costPrice: 1_500_000,
        sellingPrice: 3_000_000,
      }),
    },
    201,
  );
  const sent = await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent" }),
  });
  const scope = await json(`/api/quotations/${sent.id}/accept`, {
    method: "POST",
    body: JSON.stringify({ acceptedAt: "2026-08-01", attachment: attachment("terima") }),
  });
  const item = scope.items.find((row) => row.category === "Jasa");

  const vendorBerEmail = await json(
    "/api/vendors",
    {
      method: "POST",
      body: JSON.stringify({
        name: "PT Vendor Beremail",
        vendorType: "Jasa",
        category: "Teknisi Jaringan",
        contact: "081200004444",
        email: "vendor@contoh.test",
        rate: 0,
        status: "Aktif",
      }),
    },
    201,
  );
  const vendorTanpaEmail = await json(
    "/api/vendors",
    {
      method: "POST",
      body: JSON.stringify({
        name: "PT Vendor Tanpa Email",
        vendorType: "Jasa",
        category: "Teknisi Jaringan",
        contact: "081200005555",
        rate: 0,
        status: "Aktif",
      }),
    },
    201,
  );

  const buatOrder = async (vendorId) => {
    const order = await json(
      "/api/procurement-orders",
      {
        method: "POST",
        body: JSON.stringify({
          documentType: "SPK",
          vendorId,
          projectId: project.id,
          quotationId: sent.id,
          items: [
            { boqItemId: item.id, quantity: 1, agreedUnitCost: HARGA_VENDOR },
          ],
          terms: [{ label: "Pelunasan", type: "Final", percentage: 100 }],
        }),
      },
      201,
    );
    await json(`/api/procurement-orders/${order.id}/submit`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    // Admin yang menyetujui pengajuannya sendiri wajib menuliskan alasannya —
    // pemisahan pembuat dan penyetuju yang sudah ada, bukan bagian dari fitur
    // ini.
    await json(`/api/procurement-orders/${order.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ overrideReason: "Pengajuan uji otomatis" }),
    });
    return order;
  };

  const template = await json(
    "/api/document-email-templates",
    {
      method: "POST",
      body: JSON.stringify({
        documentKind: "spk",
        name: "Pengantar SPK",
        subject: "SPK {{nomor}} untuk {{vendor}}",
        bodyHtml:
          "Yth. {{vendor}},\n\nTerlampir {{nomor}} untuk proyek {{proyek}} senilai {{nilai}}.",
        bodyFormat: "text",
        senderSignoff: "Hormat kami,",
        senderName: "Admin Uji",
        senderEmail: "admin.uji@perumnet.id",
      }),
    },
    201,
  );

  konteks = {
    projectId: project.id,
    quotationId: sent.id,
    orderBeremail: await buatOrder(vendorBerEmail.id),
    orderTanpaEmail: await buatOrder(vendorTanpaEmail.id),
    templateId: template.id,
  };
}, { timeout: 120_000 });

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      server.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
  if (smtp) await new Promise((resolve) => smtp.close(resolve));
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
});

test("vendor tanpa email ditolak, dan TIDAK ada apa pun yang tertulis", async () => {
  const sebelumnya = diterimaSmtp.length;
  const form = new FormData();
  form.set("templateId", konteks.templateId);
  const gagal = await galat(
    `/api/procurement-orders/${konteks.orderTanpaEmail.id}/send-email`,
    { method: "POST", body: form },
  );

  assert.equal(gagal.status, 409);
  assert.equal(gagal.code, "VENDOR_EMAIL_MISSING");
  // Pesannya harus menyebut nama vendornya DAN siapa yang boleh membetulkannya:
  // yang mentok di sini bisa jadi Project Manager, yang tidak boleh mengubah
  // data vendor sama sekali.
  assert.match(gagal.message, /PT Vendor Tanpa Email/);
  assert.match(gagal.message, /Admin atau Finance/);
  assert.equal(gagal.details.vendorName, "PT Vendor Tanpa Email");

  assert.equal(diterimaSmtp.length, sebelumnya, "ada surat yang terlanjur keluar");
  const riwayat = await json(
    `/api/procurement-orders/${konteks.orderTanpaEmail.id}/deliveries`,
  );
  assert.equal(riwayat.items.length, 0, "ada riwayat yang terlanjur tertulis");
});

test("pratinjau sama dengan yang terkirim, huruf demi huruf", async () => {
  const lihat = await json(
    `/api/procurement-orders/${konteks.orderBeremail.id}/send-email-preview`,
    { method: "POST", body: JSON.stringify({ templateId: konteks.templateId }) },
  );
  assert.equal(lihat.recipient, "vendor@contoh.test");
  assert.match(lihat.subject, /untuk PT Vendor Beremail/);
  assert.equal(lihat.attachments.length, 1);
  assert.ok(lihat.attachments[0].generated, "dokumen resmi harus ditandai otomatis");

  const form = new FormData();
  form.set("templateId", konteks.templateId);
  const hasil = await json(
    `/api/procurement-orders/${konteks.orderBeremail.id}/send-email`,
    { method: "POST", body: form },
  );

  const riwayat = await json(
    `/api/procurement-orders/${konteks.orderBeremail.id}/deliveries`,
  );
  const baris = riwayat.items.find((x) => x.id === hasil.deliveryId);
  assert.ok(baris, "riwayatnya tidak tertulis");
  assert.equal(baris.subject, lihat.subject);

  // Status dokumennya ikut berubah: menekan Kirim Email ADALAH aksi kirim.
  assert.equal(hasil.order.workflowStatus, "Dikirim");
});

test("PDF yang dikirim ke vendor TIDAK memuat harga modal kita", async () => {
  const sebelumnya = diterimaSmtp.length;
  await jalankanWorker();
  assert.ok(diterimaSmtp.length > sebelumnya, "tidak ada surat yang keluar");

  const pesan = diterimaSmtp[diterimaSmtp.length - 1].pesan;
  const pdf = pdfDariPesan(pesan);
  assert.ok(pdf, "tidak ada lampiran PDF di pesan yang terkirim");

  const teks = await teksPdf(pdf);
  // Inti tesnya. Kalau suatu hari ada yang mengubah edisi bawaan, atau
  // menambah parameter di tengah daftar argumen renderer, tes ini gagal dengan
  // menyebut angka yang bocor.
  assert.ok(
    !teks.includes("7.777.777"),
    "harga modal PerumNet ikut terkirim ke vendor",
  );
  assert.ok(
    teks.includes("9.000.000"),
    "harga vendor justru hilang dari dokumennya",
  );
  // Nama berkasnya juga diperiksa, tapi ia bukti tambahan — bukan yang utama.
  assert.match(pesan, /filename="?[^"]*\.pdf"?/i);
  assert.ok(!/-INTERNAL\.pdf/i.test(pesan), "salinan internal yang terkirim");
});

test("riwayat ikut jadi Terkirim, dan lampirannya tercatat", async () => {
  const riwayat = await json(
    `/api/procurement-orders/${konteks.orderBeremail.id}/deliveries`,
  );
  const baris = riwayat.items[0];
  assert.equal(baris.status, "Sent");
  assert.ok(baris.sentAt, "sentAt kosong padahal statusnya Sent");
  assert.equal(baris.attachments.length, 1);
  assert.ok(baris.attachments[0].generated);
  assert.ok(baris.attachments[0].byteSize > 0);
});

test("berkas arsip TIDAK ikut terhapus saat outbox dibersihkan", async () => {
  // Outbox membuang lampirannya setelah terkirim. Arsip pengiriman memilikinya,
  // jadi berkasnya harus tetap ada — itulah gunanya penanda kepemilikan.
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${databasePath}` });
  const penunjuk = await client.execute(
    "SELECT COUNT(*) AS jumlah FROM email_attachments",
  );
  const arsip = await client.execute(
    "SELECT storage_url FROM document_delivery_attachments",
  );
  client.close();

  assert.equal(
    Number(penunjuk.rows[0].jumlah),
    0,
    "penunjuk lampiran outbox tidak dibersihkan",
  );
  assert.ok(arsip.rows.length > 0, "arsip lampiran hilang");
  const jalur = String(arsip.rows[0].storage_url ?? "");
  if (jalur.startsWith("local://")) {
    assert.ok(
      existsSync(`${uploadDirectory}/${jalur.slice("local://".length)}`),
      "berkas arsip ikut terhapus bersama outbox",
    );
  }
});

// ── Quotation dan invoice ke klien ───────────────────────────────────
//
// Sampai 20 Agustus tidak ada alamat klien di mana pun dalam skema ini; kolom
// client_email di proyek baru ditambahkan untuk ini. Karena itu tes pertamanya
// justru keadaan "belum diisi", yang akan jadi keadaan setiap proyek lama.

test("proyek tanpa email klien ditolak, dan tidak ada apa pun yang tertulis", async () => {
  const sebelumnya = diterimaSmtp.length;
  const template = await json(
    "/api/document-email-templates",
    {
      method: "POST",
      body: JSON.stringify({
        documentKind: "quotation",
        name: "Pengantar Penawaran",
        subject: "Penawaran {{nomor}} untuk {{klien}}",
        bodyHtml: "Yth. {{klien}},\n\nTerlampir penawaran {{nomor}} senilai {{nilai}}.",
        senderName: "Admin Uji",
        senderEmail: "admin.uji@perumnet.id",
      }),
    },
    201,
  );
  konteks.templateQuotation = template.id;

  const form = new FormData();
  form.set("templateId", template.id);
  const gagal = await galat(`/api/quotations/${konteks.quotationId}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(gagal.status, 409);
  assert.equal(gagal.code, "CLIENT_EMAIL_MISSING");
  assert.match(gagal.message, /Manajemen Proyek/);
  assert.equal(diterimaSmtp.length, sebelumnya, "ada surat yang terlanjur keluar");

  const riwayat = await json(`/api/quotations/${konteks.quotationId}/deliveries`);
  assert.equal(riwayat.items.length, 0);
});

test("alamat klien tersimpan di proyek dan terbaca kembali", async () => {
  const diubah = await json(`/api/projects/${konteks.projectId}`, {
    method: "PATCH",
    body: JSON.stringify({
      clientEmail: "klien@contoh.test",
      clientContactName: "Bapak Klien",
    }),
  });
  assert.equal(diubah.clientEmail, "klien@contoh.test");
  assert.equal(diubah.clientContactName, "Bapak Klien");
});

test("quotation terkirim ke klien, dan PDF-nya ikut", async () => {
  const sebelumnya = diterimaSmtp.length;
  const form = new FormData();
  form.set("templateId", konteks.templateQuotation);
  const hasil = await json(`/api/quotations/${konteks.quotationId}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(hasil.recipient, "klien@contoh.test");
  assert.equal(hasil.recipientName, "Bapak Klien");

  await jalankanWorker();
  assert.ok(diterimaSmtp.length > sebelumnya, "tidak ada surat yang keluar");
  const pdf = pdfDariPesan(diterimaSmtp[diterimaSmtp.length - 1].pesan);
  assert.ok(pdf, "tidak ada lampiran PDF");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});

test("invoice terkirim, dan statusnya TIDAK ikut diubah", async () => {
  const invoice = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: konteks.projectId,
        quotationId: konteks.quotationId,
        type: "DP",
        issueDate: "2026-08-02",
        dueDate: "2026-09-02",
        calculationMode: "Percent",
        installmentBps: 5000,
      }),
    },
    201,
  );
  const template = await json(
    "/api/document-email-templates",
    {
      method: "POST",
      body: JSON.stringify({
        documentKind: "invoice",
        name: "Pengantar Invoice",
        subject: "Invoice {{nomor}}",
        bodyHtml:
          "Yth. {{klien}},\n\nInvoice {{nomor}} senilai {{nilai}} jatuh tempo {{jatuh_tempo}}. Sisa {{sisa}}.",
        senderName: "Admin Uji",
        senderEmail: "admin.uji@perumnet.id",
      }),
    },
    201,
  );

  const form = new FormData();
  form.set("templateId", template.id);
  const hasil = await json(`/api/invoices/${invoice.id}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(hasil.status, "Queued");

  const sesudah = await json(`/api/invoices/${invoice.id}`);
  // Status invoice adalah keadaan PEMBAYARAN, bukan pengiriman. Menumpanginya
  // akan mencampur dua hal yang kebetulan sama-sama bernama "status".
  assert.equal(sesudah.status, "Belum Lunas");

  const riwayat = await json(`/api/invoices/${invoice.id}/deliveries`);
  assert.equal(riwayat.items.length, 1);
  assert.equal(riwayat.items[0].recipient, "klien@contoh.test");
});

test("quotation Draft ikut ditandai terkirim, lewat transisi yang sama", async () => {
  // Proyek sendiri: quotation-nya sengaja DIBIARKAN Draft.
  const project = await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Proyek Draft Kirim",
        client: "Klien Draft",
        clientEmail: "draft@contoh.test",
        clientContactName: "Ibu Draft",
        location: "Denpasar",
        status: "Aktif",
        value: 0,
      }),
    },
    201,
  );
  await json(
    `/api/boq/items?projectId=${project.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Jasa",
        description: "Pekerjaan draft",
        quantity: 1,
        unit: "paket",
        costPrice: 1_000_000,
        sellingPrice: 3_000_000,
      }),
    },
    201,
  );
  // Baris quotation baru dibuat saat pertama kali diminta, jadi ia harus
  // disentuh dulu. Tanpa ini tabelnya kosong dan tesnya gagal karena alasan
  // yang tidak ada hubungannya dengan yang sedang diuji.
  // PATCH-lah yang membuat barisnya, bukan GET. Diberi perubahan yang tidak
  // menyentuh status supaya ia tetap Draft — itu yang sedang diuji.
  await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ validUntil: "2099-12-31" }),
  });

  // Dibaca langsung dari database: bentuk jawaban GET /api/quotations bukan
  // yang sedang diuji di sini, dan menebaknya hanya menambah cara gagal.
  const { createClient: bukaDb } = await import("@libsql/client");
  const dbAwal = bukaDb({ url: `file:${databasePath}` });
  const cari = await dbAwal.execute({
    sql: "SELECT id,status FROM quotations WHERE project_id=? LIMIT 1",
    args: [project.id],
  });
  dbAwal.close();
  const quotationId = String(cari.rows[0]?.id ?? "");
  assert.ok(quotationId, "quotation Draft tidak ketemu");
  assert.equal(String(cari.rows[0].status), "Draft", "quotation-nya bukan Draft");

  const form = new FormData();
  form.set("templateId", konteks.templateQuotation);
  const hasil = await json(`/api/quotations/${quotationId}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(hasil.recipient, "draft@contoh.test");

  // Statusnya ikut berubah — dan lewat transisi yang SAMA dengan tombol
  // "Tandai sudah dikirim", bukan UPDATE terpisah. Transisi itu juga mengunci
  // item BoQ; salinan kedua yang melewatkannya akan mengirim penawaran yang
  // angkanya belum terkunci.
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${databasePath}` });
  const baris = await client.execute({
    sql: "SELECT status FROM quotations WHERE id=?",
    args: [quotationId],
  });
  const terkunci = await client.execute({
    sql: "SELECT COUNT(*) AS jumlah FROM quotation_items WHERE quotation_id=?",
    args: [quotationId],
  });
  client.close();

  assert.equal(String(baris.rows[0].status), "Sent");
  assert.ok(
    Number(terkunci.rows[0].jumlah) > 0,
    "item BoQ tidak ikut terkunci — transisinya dilewati",
  );
});

// ---------------------------------------------------------------------------
// Pratinjau dari sisi TEMPLATE.
//
// Layar pengelola template memegang templatenya dan menunjuk dokumen contoh —
// kebalikan dari dialog Kirim, yang memegang dokumen dan memilih templatenya.
// Endpoint ini ada supaya layar itu tidak perlu menebak isi suratnya di
// browser: placeholder, identitas perusahaan, tanda tangan, dan PDF dokumen
// semuanya dirender server.
//
// Yang dijaga di sini BUKAN "endpoint-nya menjawab 200", melainkan bahwa dua
// jalur pratinjau memulangkan surat yang SAMA. Kalau masing-masing menyusun
// sendiri, keduanya bisa menyimpang perlahan tanpa satu tes pun gagal, dan
// yang dilihat pengelola template bukan lagi yang diterima penerima.

test("pratinjau dari sisi template sama persis dengan pratinjau dari sisi dokumen (SPK)", async () => {
  const lewatDokumen = await json(
    `/api/procurement-orders/${konteks.orderBeremail.id}/send-email-preview`,
    { method: "POST", body: JSON.stringify({ templateId: konteks.templateId }) },
  );
  const lewatTemplate = await json(
    `/api/document-email-templates/${konteks.templateId}/preview`,
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "spk",
        documentId: konteks.orderBeremail.id,
      }),
    },
  );
  assert.deepEqual(lewatTemplate, lewatDokumen);
  assert.equal(lewatTemplate.recipient, "vendor@contoh.test");
  assert.ok(lewatTemplate.attachments[0].generated, "PDF resmi harus ikut terhitung");
});

test("pratinjau dari sisi template sama persis dengan pratinjau dari sisi dokumen (quotation)", async () => {
  const lewatDokumen = await json(
    `/api/quotations/${konteks.quotationId}/send-email-preview`,
    { method: "POST", body: JSON.stringify({ templateId: konteks.templateQuotation }) },
  );
  const lewatTemplate = await json(
    `/api/document-email-templates/${konteks.templateQuotation}/preview`,
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "quotation",
        documentId: konteks.quotationId,
      }),
    },
  );
  assert.deepEqual(lewatTemplate, lewatDokumen);
});

test("template SPK ditolak untuk dokumen quotation", async () => {
  const gagal = await galat(
    `/api/document-email-templates/${konteks.templateId}/preview`,
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "quotation",
        documentId: konteks.quotationId,
      }),
    },
  );
  assert.equal(gagal.status, 422);
  assert.equal(gagal.code, "TEMPLATE_KIND_MISMATCH");
  // Jenis template yang sebenarnya ikut dipulangkan, supaya layar bisa
  // menunjukkan tab mana yang benar tanpa menebak.
  assert.equal(gagal.details?.documentKind, "spk");
});

test("jenis dokumen di luar daftar ditolak sebelum menyentuh database", async () => {
  const gagal = await galat(
    `/api/document-email-templates/${konteks.templateId}/preview`,
    {
      method: "POST",
      body: JSON.stringify({ documentType: "kontrak", documentId: "apa-saja" }),
    },
  );
  assert.equal(gagal.status, 422);
});

test("pratinjau template hanya menerima POST", async () => {
  const gagal = await galat(
    `/api/document-email-templates/${konteks.templateId}/preview`,
  );
  assert.equal(gagal.status, 405);
  assert.equal(gagal.code, "METHOD_NOT_ALLOWED");
});

test("aksi yang tidak dikenal di bawah template menjawab 404, bukan memulangkan templatenya", async () => {
  const gagal = await galat(
    `/api/document-email-templates/${konteks.templateId}/entah-apa`,
  );
  assert.equal(gagal.status, 404);
});

test("dokumen yang tidak ada menjawab 404, bukan 500", async () => {
  const gagal = await galat(
    `/api/document-email-templates/${konteks.templateId}/preview`,
    {
      method: "POST",
      body: JSON.stringify({ documentType: "spk", documentId: "tidak-ada-sama-sekali" }),
    },
  );
  assert.equal(gagal.status, 404);
});

test("aturan dokumen tetap berlaku di jalur pratinjau template", async () => {
  // Pratinjau bukan pintu belakang. Dokumen yang tidak bisa dikirim juga tidak
  // bisa dipratinjau — kalau tidak, layar template jadi satu-satunya tempat di
  // aplikasi ini yang bisa merender surat untuk penerima yang tidak ada.
  const gagal = await galat(
    `/api/document-email-templates/${konteks.templateId}/preview`,
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "spk",
        documentId: konteks.orderTanpaEmail.id,
      }),
    },
  );
  assert.equal(gagal.status, 409);
  assert.equal(gagal.code, "VENDOR_EMAIL_MISSING");
});

// ── BAST: bukti serah terima ─────────────────────────────────────────────────
//
// Tiga jenis pertama DIRENDER saat tombol Kirim ditekan; BAST tidak. BAST final
// punya sidik SHA-256 yang tercatat dan halaman verifikasi publik yang
// memajangnya, jadi lampirannya harus ARSIP yang sama — bukan render baru yang
// kebetulan terlihat sama.
//
// Tes intinya karena itu bukan "ada lampiran PDF", melainkan: sidik byte yang
// benar-benar sampai lewat SMTP sama dengan `pdfHash` di database. Itu persis
// yang akan dibandingkan klien saat ia membuka tautan verifikasinya, dan
// satu-satunya tes yang akan gagal kalau suatu hari jalur ini "disederhanakan"
// kembali menjadi render ulang.

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("BAST disiapkan sampai siap difinalisasi", async () => {
  const validasi = await json(
    `/api/validations?projectId=${konteks.projectId}`,
    { method: "POST" },
    201,
  );
  await json(`/api/validations/${validasi.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Completed",
      notes: "Lulus uji.",
      items: validasi.items.map((item) => ({ ...item, checked: true })),
    }),
  });
  await json("/api/bast/settings/seal", {
    method: "PUT",
    body: JSON.stringify({
      enabled: true,
      signerName: "Direktur",
      signerRole: "Direktur",
      sealMimeType: "image/png",
      sealContentBase64: PNG_1X1,
    }),
  });
  const ttd = `data:image/png;base64,${PNG_1X1}`;
  const bast = await json(
    "/api/bast",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: konteks.projectId,
        completionDate: "2026-08-10",
        notes: "Serah terima uji.",
        installedItems: [{ name: "Access Point", quantity: "1 unit", status: "Terpasang" }],
        clientName: "Bapak Klien",
        clientRole: "Manager",
        engineerName: "Engineer Uji",
        engineerRole: "Project Manager",
        status: "Draft",
        clientSignature: ttd,
        engineerSignature: ttd,
      }),
    },
    201,
  );
  const template = await json(
    "/api/document-email-templates",
    {
      method: "POST",
      body: JSON.stringify({
        documentKind: "bast",
        name: "Pengantar BAST",
        subject: "BAST {{nomor}} untuk {{klien}}",
        bodyHtml:
          "Yth. {{klien}},\n\nTerlampir {{nomor}} proyek {{proyek}} paket {{paket}}, serah terima {{tanggal_serah_terima}}.\n\nKeaslian dokumen dapat diperiksa di {{tautan_verifikasi}} dengan sidik {{sidik_dokumen}}.",
        bodyFormat: "text",
        senderSignoff: "Hormat kami,",
        senderName: "Admin Uji",
        senderEmail: "admin.uji@perumnet.id",
      }),
    },
    201,
  );
  konteks.bastId = bast.id;
  konteks.templateBast = template.id;
  assert.equal(bast.status, "Draft");
  assert.equal(bast.finalizedAt, null);
});

test("BAST yang belum difinalisasi TIDAK bisa dikirim", async () => {
  // Dikuras lebih dulu: membuat BAST dan menyelesaikan validasi ikut
  // mengantrikan notifikasi ke pemangku proyek. Tanpa ini, hitungan SMTP naik
  // karena surat lain dan tesnya menuduh jalur yang salah.
  await jalankanWorker();
  const sebelumnya = diterimaSmtp.length;
  const form = new FormData();
  form.set("templateId", konteks.templateBast);
  const gagal = await galat(`/api/bast/${konteks.bastId}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(gagal.status, 409);
  assert.equal(gagal.code, "BAST_NOT_FINAL");
  await jalankanWorker();
  assert.equal(diterimaSmtp.length, sebelumnya, "ada surat yang terlanjur keluar");
  const riwayat = await json(`/api/bast/${konteks.bastId}/deliveries`);
  assert.equal(riwayat.items.length, 0, "ada baris riwayat yang terlanjur tertulis");
});

test("setelah ditandatangani dan difinalisasi, BAST bisa dikirim", async () => {
  const final = await json(`/api/bast/${konteks.bastId}/finalize`, { method: "POST" });
  assert.equal(final.status, "Final");
  assert.ok(final.pdfHash, "finalisasi tidak mencatat sidik dokumen");
  assert.ok(final.verificationToken, "finalisasi tidak menerbitkan token verifikasi");
  konteks.bastHash = final.pdfHash;
  konteks.bastNumber = final.number;
  konteks.bastToken = final.verificationToken;

  const sebelumnya = diterimaSmtp.length;
  const form = new FormData();
  form.set("templateId", konteks.templateBast);
  const hasil = await json(`/api/bast/${konteks.bastId}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(hasil.recipient, "klien@contoh.test");
  assert.equal(hasil.recipientName, "Bapak Klien");
  await jalankanWorker();
  assert.ok(diterimaSmtp.length > sebelumnya, "tidak ada surat yang keluar");
  konteks.pesanBast = diterimaSmtp[diterimaSmtp.length - 1].pesan;
});

// Inti fiturnya. Kalau lampirannya dirender ulang, byte-nya berbeda dan tes ini
// gagal — walaupun PDF-nya terlihat identik dan semua tes lain tetap hijau.
test("sidik lampiran yang benar-benar terkirim sama dengan pdfHash di arsip", async () => {
  const pdf = pdfDariPesan(konteks.pesanBast);
  assert.ok(pdf, "tidak ada lampiran PDF");
  const sidik = createHash("sha256").update(pdf).digest("hex");
  assert.equal(
    sidik,
    konteks.bastHash,
    "lampiran BAST bukan arsip finalnya — klien yang memeriksa tautan verifikasi akan melihat dua sidik berbeda",
  );
});

test("lampirannya byte-per-byte sama dengan arsip yang dilayani /pdf", async () => {
  const response = await request(`/api/bast/${konteks.bastId}/pdf`);
  assert.equal(response.status, 200);
  const arsip = Buffer.from(await response.arrayBuffer());
  const terkirim = pdfDariPesan(konteks.pesanBast);
  assert.equal(Buffer.compare(arsip, terkirim), 0, "arsip dan lampiran berbeda");
});

test("surat memuat nomor, sidik, dan tautan verifikasi yang sama dengan QR-nya", async () => {
  const riwayat = await json(`/api/bast/${konteks.bastId}/deliveries`);
  assert.equal(riwayat.items.length, 1);
  const kiriman = riwayat.items[0];
  assert.match(kiriman.subject, new RegExp(konteks.bastNumber.replaceAll("/", "\\/")));
  assert.ok(
    kiriman.attachments.some((a) => a.generated),
    "lampiran dokumen tidak tercatat sebagai berkas terbitan aplikasi",
  );
  // Isi suratnya dibaca dari pesan SMTP-nya, bukan dari template: yang penting
  // adalah yang sampai ke klien, sesudah placeholder dirender.
  const badan = konteks.pesanBast.replace(/=\r\n/g, "").replace(/=3D/g, "=");
  assert.match(badan, new RegExp(`/verify/bast/${konteks.bastToken}`));
  assert.match(badan, new RegExp(konteks.bastHash));
});

// Dijalankan pada BAST yang SUDAH final. Pada yang masih Draft, BAST_NOT_FINAL
// yang menjawab lebih dulu — dan itu memang urutan yang benar: template yang
// keliru bisa diganti di dialog yang sama, sedangkan "belum difinalisasi"
// menuntut pekerjaan lain sama sekali.
test("template jenis lain ditolak untuk BAST", async () => {
  const form = new FormData();
  form.set("templateId", konteks.templateId);
  const gagal = await galat(`/api/bast/${konteks.bastId}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(gagal.status, 422);
  assert.equal(gagal.code, "TEMPLATE_KIND_MISMATCH");
});

test("BAST yang sudah dicabut tidak bisa dikirim lagi", async () => {
  await json(`/api/bast/${konteks.bastId}/void`, {
    method: "POST",
    body: JSON.stringify({ reason: "Uji pencabutan" }),
  });
  const sebelumnya = diterimaSmtp.length;
  const form = new FormData();
  form.set("templateId", konteks.templateBast);
  const gagal = await galat(`/api/bast/${konteks.bastId}/send-email`, {
    method: "POST",
    body: form,
  });
  assert.equal(gagal.status, 409);
  assert.equal(gagal.code, "BAST_REVOKED");
  await jalankanWorker();
  assert.equal(diterimaSmtp.length, sebelumnya, "ada surat yang terlanjur keluar");
});
