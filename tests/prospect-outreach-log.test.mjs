// Laporan pengiriman: berhasil, gagal, atau masih diproses.
//
// Yang diuji di sini adalah satu klaim yang mudah dipercaya tanpa bukti:
// bahwa status yang ditampilkan layar benar-benar mengikuti apa yang terjadi
// pada surat. Sebelum berkas ini ada, riwayat outreach ditulis sekali saat
// tombol Kirim ditekan dan tidak pernah disentuh lagi — ia bilang "Queued"
// selamanya, bahkan setelah suratnya terkirim atau gagal permanen.
//
// Karena itu tesnya menjalankan server SMTP sungguhan (palsu, tapi benar-benar
// bicara SMTP) dan memakai endpoint pengiriman yang dipakai worker. Menandai
// baris langsung di database hanya akan menguji SQL milik tes itu sendiri.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";

let server;
let smtp;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";
let smtpPort;
const diterimaSmtp = [];
let tolakSemua = false;

const ADMIN = "admin@perumnet.id";
const ADMIN_PASSWORD = "perumnet123";
const WORKER_SECRET = "rahasia-worker-uji";

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

/**
 * SMTP paling sederhana yang cukup untuk membuat nodemailer senang: sapaan,
 * EHLO, AUTH LOGIN, MAIL/RCPT/DATA, lalu QUIT. Tanpa TLS — port bukan 465 dan
 * SMTP_SECURE=false, jadi jalurnya polos.
 */
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

        // DATA diakhiri titik sendirian di satu baris. Ia harus diproses
        // sebagai blok, bukan per baris perintah.
        if (dalamData) {
          const penutup = buffer.indexOf("\r\n.\r\n");
          if (penutup === -1) return;
          pesan += buffer.slice(0, penutup);
          buffer = buffer.slice(penutup + 5);
          dalamData = false;
          if (tolakSemua) {
            balas("550 5.7.1 ditolak untuk keperluan uji");
          } else {
            diterimaSmtp.push({ penerima, pesan });
            balas("250 2.0.0 OK diterima");
          }
          pesan = "";
        }

        let potong;
        while (!dalamData && (potong = buffer.indexOf("\r\n")) !== -1) {
          const baris = buffer.slice(0, potong);
          buffer = buffer.slice(potong + 2);
          const perintah = baris.toUpperCase();

          if (perintah.startsWith("EHLO") || perintah.startsWith("HELO")) {
            // HANYA AUTH PLAIN yang diiklankan. PLAIN selesai dalam satu
            // langkah; LOGIN butuh dua tantangan base64 dan salah satunya
            // mudah terlewat, yang berakhir jadi timeout 15 detik — terbaca
            // seperti server menolak, padahal servernya yang salah jawab.
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
            balas("354 Kirim isinya, akhiri dengan <CRLF>.<CRLF>");
          } else if (perintah.startsWith("QUIT")) {
            balas("221 2.0.0 Selamat tinggal");
            socket.end();
          } else if (perintah.startsWith("RSET") || perintah.startsWith("NOOP")) {
            balas("250 2.0.0 OK");
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("Server tidak pernah siap.");
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, data: payload?.data, code: payload?.error?.code };
}

function db() {
  return createClient({ url: `file:${databasePath}` });
}

/** Menjalankan satu putaran worker lewat endpoint yang dipakai worker asli. */
async function jalankanWorker() {
  const response = await fetch(`${baseUrl}/api/internal/email-dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify({}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

let urutan = 0;
async function tambahProspek() {
  urutan += 1;
  return await api("/api/cms/prospects", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Kontak ${urutan}`,
      email: `kontak${urutan}@contoh.test`,
      companyName: `PT Contoh ${urutan}`,
      source: "uji laporan pengiriman",
    }),
  });
}

async function buatTemplate() {
  return await api("/api/cms/prospect-templates", {
    method: "POST",
    body: JSON.stringify({
      name: `Template ${urutan}-${Math.random().toString(36).slice(2, 7)}`,
      subject: "Perkenalan untuk {{perusahaan}}",
      bodyHtml: "Yth. {{nama}},\n\nSalam hormat dari kami.",
      senderName: "Suci",
      senderEmail: "orang@contoh.test",
    }),
  });
}

before(async () => {
  const port = await freePort();
  smtpPort = await freePort();
  smtp = await mulaiSmtpPalsu(smtpPort);
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-outreach-log-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-outreach-log-uploads-${process.pid}-${Date.now()}`;
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

  const masuk = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: ADMIN_PASSWORD, remember: false }),
    redirect: "manual",
  });
  assert.equal(masuk.status, 200);
  cookie = masuk.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie, "cookie sesi admin tidak didapat");
}, { timeout: 60_000 });

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

test("surat yang benar-benar terkirim berubah jadi Sent di laporan", async () => {
  tolakSemua = false;
  const prospek = await tambahProspek();
  const tpl = await buatTemplate();
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      templateId: tpl.data.id,
      spacingSeconds: 0,
    }),
  });
  assert.equal(kirim.status, 200);
  assert.ok(kirim.data.batchId, "batchId tidak dipulangkan");

  const sebelum = await api(`/api/cms/prospects/outreach?batchId=${kirim.data.batchId}`);
  // Sebelum worker jalan: masih diproses, bukan diam-diam dianggap sukses.
  assert.equal(sebelum.data.items[0].status, "Queued");
  assert.equal(sebelum.data.items[0].sentAt, null);

  const worker = await jalankanWorker();
  assert.equal(worker.status, 200);
  assert.equal(diterimaSmtp.length, 1, "server SMTP tidak menerima apa pun");

  const sesudah = await api(`/api/cms/prospects/outreach?batchId=${kirim.data.batchId}`);
  const baris = sesudah.data.items[0];
  assert.equal(baris.status, "Sent");
  assert.ok(baris.sentAt, "sentAt kosong padahal statusnya Sent");
  assert.equal(baris.failureReason, "");
  assert.equal(baris.prospectName, prospek.data.fullName);
  assert.equal(sesudah.data.summary.Sent, 1);
});

test("surat yang ditolak server tetap Queued selama masih ada sisa percobaan", async () => {
  tolakSemua = true;
  const prospek = await tambahProspek();
  const tpl = await buatTemplate();
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      templateId: tpl.data.id,
      spacingSeconds: 0,
    }),
  });
  await jalankanWorker();

  const lihat = await api(`/api/cms/prospects/outreach?batchId=${kirim.data.batchId}`);
  // Menandainya gagal sekarang membuat orang mengejar sesuatu yang sebentar
  // lagi berhasil sendiri.
  assert.equal(lihat.data.items[0].status, "Queued");
  tolakSemua = false;
});

test("setelah percobaannya habis, laporannya berkata Gagal dan menyebut alasannya", async () => {
  tolakSemua = true;
  const prospek = await tambahProspek();
  const tpl = await buatTemplate();
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      templateId: tpl.data.id,
      spacingSeconds: 0,
    }),
  });

  // Percobaan ke-5 adalah yang terakhir. Dipercepat lewat database supaya tes
  // tidak menunggu jeda ulang yang sebenarnya berjam-jam.
  const client = db();
  await client.execute({
    sql: `UPDATE email_outbox SET attempt_count=4, next_attempt_at=?
      WHERE id=(SELECT outbox_id FROM cms_prospect_outreach WHERE batch_id=?)`,
    args: [new Date(Date.now() - 60_000).toISOString(), kirim.data.batchId],
  });
  client.close();

  await jalankanWorker();

  const lihat = await api(`/api/cms/prospects/outreach?batchId=${kirim.data.batchId}`);
  const baris = lihat.data.items[0];
  assert.equal(baris.status, "Failed");
  assert.ok(baris.failureReason.length > 0, "gagal tanpa alasan yang bisa dibaca");
  assert.equal(lihat.data.summary.Failed, 1);
  tolakSemua = false;
});

test("ringkasan selalu memuat keempat status, termasuk yang nol", async () => {
  const lihat = await api("/api/cms/prospects/outreach?q=tidak-akan-pernah-cocok-xyz");
  // Layar yang membaca summary.Failed tidak boleh menampilkan "kosong" hanya
  // karena kebetulan belum ada yang gagal.
  for (const kunci of ["Queued", "Sent", "Failed", "Skipped", "total"]) {
    assert.equal(typeof lihat.data.summary[kunci], "number", `${kunci} bukan angka`);
  }
  assert.equal(lihat.data.summary.total, 0);
});

test("satu penekanan tombol Kirim jadi satu baris batch, bukan tiga baris terpisah", async () => {
  tolakSemua = false;
  const a = await tambahProspek();
  const b = await tambahProspek();
  const c = await tambahProspek();
  const tpl = await buatTemplate();
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [a.data.id, b.data.id, c.data.id],
      templateId: tpl.data.id,
      spacingSeconds: 0,
    }),
  });
  assert.equal(kirim.data.queued, 3);

  const batches = await api("/api/cms/prospects/outreach/batches");
  const batch = batches.data.items.find((x) => x.batchId === kirim.data.batchId);
  assert.ok(batch, "batch tidak muncul di daftar");
  assert.equal(batch.total, 3);
  assert.equal(batch.queued, 3);
  assert.equal(batch.selesai, false);

  await jalankanWorker();

  const sesudah = await api("/api/cms/prospects/outreach/batches");
  const jadi = sesudah.data.items.find((x) => x.batchId === kirim.data.batchId);
  assert.equal(jadi.sent, 3);
  assert.equal(jadi.queued, 0);
  // "Selesai" dihitung server supaya dua layar tidak menjawab berbeda untuk
  // pertanyaan yang sama.
  assert.equal(jadi.selesai, true);
});

test("penyaringan per status memulangkan hanya status itu", async () => {
  const gagal = await api("/api/cms/prospects/outreach?status=Failed");
  assert.ok(gagal.data.items.every((x) => x.status === "Failed"));
  const terkirim = await api("/api/cms/prospects/outreach?status=Sent");
  assert.ok(terkirim.data.items.every((x) => x.status === "Sent"));
  assert.ok(terkirim.data.items.length >= 1);
});

test("bukan Admin tidak bisa membaca laporan pengiriman", async () => {
  const response = await fetch(`${baseUrl}/api/cms/prospects/outreach`);
  assert.equal(response.status, 401);
});


// ── Lampiran benar-benar keluar di kawat ─────────────────────────────
//
// Baris database yang berkata "1 lampiran" tidak membuktikan apa pun. Yang
// diuji di sini isi pesan SMTP-nya: apakah benar ada bagian multipart berisi
// PDF, dengan nama berkas yang benar.
//
// Barisnya ditulis langsung ke database karena belum ada endpoint yang
// mengirim lampiran — itu Fase 2. Yang sedang diuji jalur pengirimnya, dan
// bentuk barisnya sama persis dengan yang akan ditulis endpoint itu nanti.

const PDF_UJI = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

test("lampiran ikut terkirim, lalu berkasnya dibersihkan", async () => {
  tolakSemua = false;
  const prospek = await tambahProspek();
  const sebelumnya = diterimaSmtp.length;

  const outboxId = randomUUID();
  const lampiranId = `lampiran-${randomUUID()}`;
  mkdirSync(uploadDirectory, { recursive: true });
  const jalurBerkas = `${uploadDirectory}/${lampiranId}`;
  writeFileSync(jalurBerkas, PDF_UJI);

  const sekarang = new Date(Date.now() - 60_000).toISOString();
  const client = db();
  await client.execute({
    sql: `INSERT INTO email_outbox
      (id,event_type,sender_profile,recipient,subject,body_html,status,provider,
       attempt_count,attachment_count,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'Pending','smtp',0,1,?,?,?)`,
    args: [
      outboxId,
      "document_email",
      "operational",
      prospek.data.email,
      "Surat dengan lampiran",
      "<p>Terlampir dokumennya.</p>",
      sekarang,
      sekarang,
      sekarang,
    ],
  });
  await client.execute({
    sql: `INSERT INTO email_attachments
      (id,outbox_id,filename,mime_type,byte_size,sha256,storage_url,
       content_base64,generated,sort_order,created_at)
      VALUES (?,?,?,?,?,?,?,NULL,1,0,?)`,
    args: [
      lampiranId,
      outboxId,
      "SPK-UJI-001.pdf",
      "application/pdf",
      PDF_UJI.byteLength,
      "sha-uji",
      `local://${lampiranId}`,
      sekarang,
    ],
  });
  client.close();

  await jalankanWorker();

  assert.ok(diterimaSmtp.length > sebelumnya, "server SMTP tidak menerima apa pun");
  const pesan = diterimaSmtp[diterimaSmtp.length - 1].pesan;

  // Isi pesannya, bukan status barisnya.
  assert.match(pesan, /Content-Type: multipart\/mixed/i, "pesannya bukan multipart");
  assert.match(pesan, /filename="?SPK-UJI-001\.pdf"?/i, "nama berkas tidak ada di pesan");
  assert.match(pesan, /Content-Type: application\/pdf/i, "tipe lampiran salah");
  // Isinya benar-benar PDF-nya, bukan sekadar header yang menjanjikannya.
  assert.ok(
    pesan.replace(/\r?\n/g, "").includes(PDF_UJI.toString("base64").slice(0, 40)),
    "isi PDF tidak ada di badan pesan",
  );

  const periksa = db();
  const barisOutbox = await periksa.execute({
    sql: "SELECT status FROM email_outbox WHERE id=?",
    args: [outboxId],
  });
  const sisaLampiran = await periksa.execute({
    sql: "SELECT COUNT(*) AS jumlah FROM email_attachments WHERE outbox_id=?",
    args: [outboxId],
  });
  periksa.close();

  assert.equal(String(barisOutbox.rows[0].status), "Sent");
  // Setelah final, penunjuk DAN berkasnya ikut dibuang. Kalau salah satu
  // tertinggal, PDF menumpuk di disk tanpa ada yang membacanya lagi.
  assert.equal(Number(sisaLampiran.rows[0].jumlah), 0, "penunjuk lampiran tertinggal");
  assert.ok(!existsSync(jalurBerkas), "berkas lampiran tertinggal di disk");
});

test("lampiran yang tidak lengkap membatalkan pengiriman, bukan mengirim setengah", async () => {
  tolakSemua = false;
  const prospek = await tambahProspek();
  const sebelumnya = diterimaSmtp.length;

  // attachment_count berkata 2, tapi hanya satu baris yang ada — persis yang
  // tertinggal kalau penulisannya terputus di tengah.
  const outboxId = randomUUID();
  const sekarang = new Date(Date.now() - 60_000).toISOString();
  const client = db();
  await client.execute({
    sql: `INSERT INTO email_outbox
      (id,event_type,sender_profile,recipient,subject,body_html,status,provider,
       attempt_count,attachment_count,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'Pending','smtp',0,2,?,?,?)`,
    args: [
      outboxId,
      "document_email",
      "operational",
      prospek.data.email,
      "Surat yang lampirannya kurang",
      "<p>Terlampir dua dokumen.</p>",
      sekarang,
      sekarang,
      sekarang,
    ],
  });
  await client.execute({
    sql: `INSERT INTO email_attachments
      (id,outbox_id,filename,mime_type,byte_size,sha256,storage_url,
       content_base64,generated,sort_order,created_at)
      VALUES (?,?,?,?,?,?,NULL,?,1,0,?)`,
    args: [
      `lampiran-${randomUUID()}`,
      outboxId,
      "SATU-SAJA.pdf",
      "application/pdf",
      PDF_UJI.byteLength,
      "sha-uji",
      PDF_UJI.toString("base64"),
      sekarang,
    ],
  });
  client.close();

  await jalankanWorker();

  // Tidak dikirim sama sekali. Surat pengantar yang sampai ke vendor TANPA
  // dokumennya adalah kegagalan terburuk yang bisa dibuat fitur ini, dan
  // satu-satunya yang tidak menimbulkan galat apa pun kalau dibiarkan.
  assert.equal(diterimaSmtp.length, sebelumnya, "surat tetap terkirim tanpa lampirannya");

  const periksa = db();
  const baris = await periksa.execute({
    sql: "SELECT status,last_error FROM email_outbox WHERE id=?",
    args: [outboxId],
  });
  periksa.close();
  assert.equal(String(baris.rows[0].status), "Failed");
  assert.match(String(baris.rows[0].last_error ?? ""), /lampiran tidak lengkap/i);
});
