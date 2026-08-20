// Menyalakan server di atas database yang tabelnya SUDAH ADA tapi belum punya
// kolom-kolom baru — persis keadaan demo dan produksi setiap kali rilis baru
// mendarat.
//
// Ini bukan uji teoretis. Pada 2026-08-20 demo DAN produksi mati sekitar empat
// menit karena satu baris `CREATE INDEX ... (batch_id, ...)` diletakkan di
// dalam `schemaSql`. Blok itu berjalan lebih dulu; pada database yang tabelnya
// sudah ada, `CREATE TABLE IF NOT EXISTS` adalah no-op sehingga kolomnya belum
// ada — indeksnya gagal, dan SELURUH initializeDatabase ikut gagal. Semua
// jalur yang menyentuh database menjawab 500.
//
// Seluruh tes lain di repo ini mulai dari database KOSONG, jadi tidak satu pun
// bisa melihatnya: pada database kosong `CREATE TABLE` benar-benar berjalan
// dan kolomnya ada. Yang membedakan tes ini cuma satu hal — ia menyiapkan
// tabel versi lama lebih dulu.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;

/** DDL cms_prospect_outreach sebelum 68c1684 — tanpa batch_id. */
const TABEL_LAMA = `
CREATE TABLE IF NOT EXISTS cms_prospect_outreach (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  template_id TEXT,
  template_name TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT,
  status TEXT NOT NULL DEFAULT 'Queued'
    CHECK (status IN ('Queued', 'Sent', 'Failed', 'Skipped')),
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  failure_reason TEXT,
  outbox_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
)`;

/** email_outbox sebelum 2f3a51d — tanpa reply_to. */
const OUTBOX_LAMA = `
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  sender_profile TEXT NOT NULL DEFAULT 'operational',
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Processing', 'Sent', 'Failed', 'Skipped')),
  provider TEXT,
  provider_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  locked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
)`;

/** cms_prospect_templates sebelum 22ae0cc — tanpa body_format & tanda tangan. */
const TEMPLATE_LAMA = `
CREATE TABLE IF NOT EXISTS cms_prospect_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'id',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
)`;

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
      lastError = new Error(`Health mengembalikan ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError ?? new Error("Server tidak pernah siap.");
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-skema-lama-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-skema-lama-uploads-${process.pid}-${Date.now()}`;

  // Database DISIAPKAN LEBIH DULU dengan tabel versi lama, sebelum server
  // pernah menyentuhnya.
  const client = createClient({ url: `file:${databasePath}` });
  for (const ddl of [TABEL_LAMA, OUTBOX_LAMA, TEMPLATE_LAMA]) {
    await client.execute(ddl);
  }
  client.close();

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
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
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

test("server naik di atas tabel versi lama, bukan 500 di setiap jalur", async () => {
  // waitForServer sudah menuntut /api/health 200, tapi ditegaskan lagi di sini
  // supaya kegagalannya menyebut sendiri apa yang rusak.
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200, "initializeDatabase gagal di atas skema lama");

  const beranda = await fetch(`${baseUrl}/`);
  assert.equal(beranda.status, 200, "halaman publik ikut mati");
});

test("kolom yang belum ada ditambahkan, bukan diabaikan", async () => {
  const client = createClient({ url: `file:${databasePath}` });
  const kolom = async (tabel) => {
    const r = await client.execute(`PRAGMA table_info(${tabel})`);
    return r.rows.map((x) => String(x.name));
  };

  const outreach = await kolom("cms_prospect_outreach");
  assert.ok(outreach.includes("batch_id"), "batch_id tidak ditambahkan");

  const outbox = await kolom("email_outbox");
  assert.ok(outbox.includes("reply_to"), "reply_to tidak ditambahkan");

  const template = await kolom("cms_prospect_templates");
  for (const nama of ["body_format", "sender_signoff", "sender_name", "sender_email", "sender_phone"]) {
    assert.ok(template.includes(nama), `${nama} tidak ditambahkan`);
  }
  client.close();
});

test("indeks atas kolom baru ikut terbentuk", async () => {
  const client = createClient({ url: `file:${databasePath}` });
  const r = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cms_prospect_outreach'",
  );
  const nama = r.rows.map((x) => String(x.name));
  client.close();
  // Indeksnya harus dibuat SETELAH kolomnya ada — kalau ia hidup di schemaSql,
  // tes ini tidak akan pernah sampai di sini: servernya gagal naik.
  assert.ok(
    nama.includes("cms_prospect_outreach_batch_idx"),
    `indeks batch tidak ada. Yang ada: ${nama.join(", ")}`,
  );
});
