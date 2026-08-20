// Mengirim SPK/PO ke vendor lewat email, dengan PDF-nya sebagai lampiran.
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
