// Apa yang terjadi pada riwayat pengiriman ketika kredensial pengirim HILANG
// setelah surat sudah masuk antrean.
//
// Ini bukan kasus karangan. Barisnya masuk antrean saat SMTP masih terpasang,
// lalu seseorang mencabutnya dari .env — atau menyalakan ulang aplikasi dengan
// berkas env yang keliru. Saat itu `dispatchEmailOutbox` menandai barisnya
// Skipped dan selesai; tidak ada lagi yang akan menyentuhnya.
//
// Sebelum perbaikan 20 Agustus, cabang itu TIDAK memberi tahu riwayat prospek.
// Akibatnya baris riwayatnya tetap "Queued" selamanya, laporan terus berkata
// "Masih diproses", dan `selesai` sebuah batch tidak pernah menjadi true —
// persis kebohongan yang laporan itu dibangun untuk mencegah, dan ia muncul
// justru saat orang paling butuh laporannya benar.
//
// Berkas tes sendiri karena servernya harus dijalankan TANPA kredensial email,
// sementara berkas laporan pengiriman menuntut sebaliknya. Next menolak dua
// dev server di satu direktori, jadi keduanya tidak bisa berbagi satu proses.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";

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

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-kredensial-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-kredensial-uploads-${process.pid}-${Date.now()}`;
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
        // Sengaja KOSONG. Inilah keadaan yang sedang diuji.
        SMTP_HOST: "",
        SMTP_PORT: "",
        SMTP_USER: "",
        SMTP_PASS: "",
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
}, { timeout: 60_000 });

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      server.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
});

test("riwayat ikut final saat kredensial pengirim hilang, tidak menggantung", async () => {
  const prospek = await api("/api/cms/prospects", {
    method: "POST",
    body: JSON.stringify({
      fullName: "Kontak Kredensial",
      email: "kredensial@contoh.test",
      companyName: "PT Kredensial",
      source: "uji kredensial hilang",
    }),
  });
  assert.equal(prospek.status, 201);

  // Baris Pending ditulis langsung, meniru keadaan "sudah masuk antrean waktu
  // kredensial masih ada". Lewat API tidak bisa: sendEmailDelivery memeriksa
  // konfigurasi LEBIH DULU dan akan menandainya Skipped sejak awal — cabang
  // yang berbeda, bukan yang sedang diuji.
  const client = db();
  const outboxId = randomUUID();
  const batchId = randomUUID();
  const sekarang = new Date(Date.now() - 60_000).toISOString();
  await client.execute({
    sql: `INSERT INTO email_outbox
      (id,event_type,sender_profile,recipient,subject,body_html,status,provider,
       attempt_count,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'Pending','smtp',0,?,?,?)`,
    args: [
      outboxId,
      "prospect_outreach",
      "operational",
      "kredensial@contoh.test",
      "Uji kredensial hilang",
      "<p>isi</p>",
      sekarang,
      sekarang,
      sekarang,
    ],
  });
  await client.execute({
    sql: `INSERT INTO cms_prospect_outreach
      (id,prospect_id,template_name,recipient,subject,body_html,status,batch_id,
       scheduled_for,outbox_id,created_at)
      VALUES (?,?,?,?,?,?,'Queued',?,?,?,?)`,
    args: [
      randomUUID(),
      prospek.data.id,
      "Surat uji",
      "kredensial@contoh.test",
      "Uji kredensial hilang",
      "<p>isi</p>",
      batchId,
      sekarang,
      outboxId,
      sekarang,
    ],
  });
  client.close();

  const jalan = await fetch(`${baseUrl}/api/internal/email-dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(jalan.status, 200);

  const periksa = db();
  const outbox = await periksa.execute({
    sql: "SELECT status FROM email_outbox WHERE id=?",
    args: [outboxId],
  });
  const riwayat = await periksa.execute({
    sql: "SELECT status,failure_reason FROM cms_prospect_outreach WHERE outbox_id=?",
    args: [outboxId],
  });
  periksa.close();

  assert.equal(String(outbox.rows[0].status), "Skipped", "outbox harus sudah final");
  // Inti tesnya. Sebelum perbaikan nilainya "Queued", dan tidak ada satu pun
  // yang akan mengubahnya lagi selamanya.
  assert.notEqual(
    String(riwayat.rows[0].status),
    "Queued",
    "riwayat menggantung di Masih diproses padahal outbox sudah final",
  );
  assert.equal(String(riwayat.rows[0].status), "Skipped");
  assert.ok(
    String(riwayat.rows[0].failure_reason ?? "").length > 0,
    "tidak ada alasan yang bisa dibaca orang",
  );

  const batches = await api("/api/cms/prospects/outreach/batches");
  const batch = batches.data.items.find((x) => x.batchId === batchId);
  assert.ok(batch, "batch tidak muncul di laporan");
  assert.equal(batch.selesai, true, "batch tidak pernah dianggap selesai");
});
