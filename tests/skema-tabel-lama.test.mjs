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

/**
 * document_email_templates & document_deliveries sebelum jenis 'bast' ada —
 * CHECK-nya hanya mengenal tiga jenis dokumen.
 *
 * Anaknya ikut dibuat DENGAN SENGAJA. Melonggarkan CHECK di SQLite menuntut
 * tabelnya dibangun ulang, dan cara yang paling jelas untuk itu — rename yang
 * lama, bikin penggantinya — MENULIS ULANG klausa REFERENCES di tabel anak,
 * meninggalkannya menunjuk nama tabel sementara yang sesudahnya di-drop.
 * Migrasi dua tabel di atas dua tabel yatim tidak akan pernah memperlihatkan
 * itu.
 */
const TEMPLATE_DOKUMEN_LAMA = `
CREATE TABLE IF NOT EXISTS document_email_templates (
  id TEXT PRIMARY KEY,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('spk', 'quotation', 'invoice')),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_format TEXT NOT NULL DEFAULT 'text'
    CHECK (body_format IN ('text', 'rich', 'html')),
  sender_signoff TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  sender_phone TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
)`;

const PENGIRIMAN_DOKUMEN_LAMA = `
CREATE TABLE IF NOT EXISTS document_deliveries (
  id TEXT PRIMARY KEY,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('spk', 'quotation', 'invoice')),
  document_id TEXT NOT NULL,
  document_number TEXT NOT NULL,
  project_id TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('vendor', 'client')),
  vendor_id TEXT,
  recipient TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  template_id TEXT REFERENCES document_email_templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en')),
  subject TEXT NOT NULL,
  body_html TEXT,
  status TEXT NOT NULL DEFAULT 'Queued'
    CHECK (status IN ('Queued', 'Sent', 'Failed', 'Skipped')),
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  failure_reason TEXT,
  outbox_id TEXT,
  document_edition TEXT NOT NULL DEFAULT 'vendor'
    CHECK (document_edition = 'vendor'),
  created_by TEXT,
  created_at TEXT NOT NULL
)`;

const LAMPIRAN_PENGIRIMAN_LAMA = `
CREATE TABLE IF NOT EXISTS document_delivery_attachments (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES document_deliveries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('document', 'extra')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  storage_url TEXT,
  content_base64 TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`;

const INDEKS_DOKUMEN_LAMA = [
  "CREATE INDEX IF NOT EXISTS document_email_templates_kind_idx ON document_email_templates(document_kind, deleted_at, name)",
  "CREATE INDEX IF NOT EXISTS document_deliveries_document_idx ON document_deliveries(document_kind, document_id, created_at)",
  "CREATE INDEX IF NOT EXISTS document_deliveries_outbox_idx ON document_deliveries(outbox_id)",
  "CREATE INDEX IF NOT EXISTS document_deliveries_status_idx ON document_deliveries(status, created_at)",
  "CREATE INDEX IF NOT EXISTS document_delivery_attachments_delivery_idx ON document_delivery_attachments(delivery_id, sort_order)",
];

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
  for (const ddl of [
    TABEL_LAMA,
    OUTBOX_LAMA,
    TEMPLATE_LAMA,
    TEMPLATE_DOKUMEN_LAMA,
    PENGIRIMAN_DOKUMEN_LAMA,
    LAMPIRAN_PENGIRIMAN_LAMA,
  ]) {
    await client.execute(ddl);
  }
  for (const indeks of INDEKS_DOKUMEN_LAMA) await client.execute(indeks);
  // Isi lebih dulu: migrasi yang membangun ulang tabel harus MEMBAWA barisnya
  // ikut pindah, dan tabel kosong tidak akan pernah membuktikan itu.
  await client.execute(
    `INSERT INTO document_email_templates
      (id,document_kind,name,subject,body_html,language,created_at,updated_at)
      VALUES ('tpl-lama','invoice','Surat invoice','Invoice {{nomor}}','Terlampir.','id','2026-08-01','2026-08-01')`,
  );
  await client.execute(
    `INSERT INTO document_deliveries
      (id,document_kind,document_id,document_number,audience,recipient,template_id,
       template_name,subject,status,scheduled_for,created_at)
      VALUES ('kirim-lama','invoice','inv-1','INV/2026/001','client','klien@contoh.test',
        'tpl-lama','Surat invoice','Invoice INV/2026/001','Sent','2026-08-01','2026-08-01')`,
  );
  await client.execute(
    `INSERT INTO document_delivery_attachments
      (id,delivery_id,kind,filename,mime_type,byte_size,sha256,sort_order,created_at)
      VALUES ('lampiran-lama','kirim-lama','document','INV-2026-001.pdf','application/pdf',
        1024,'abc',0,'2026-08-01')`,
  );
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

test("CHECK document_kind dilonggarkan supaya BAST bisa dikirim", async () => {
  const client = createClient({ url: `file:${databasePath}` });
  try {
    await client.execute(
      `INSERT INTO document_email_templates
        (id,document_kind,name,subject,body_html,language,created_at,updated_at)
        VALUES ('tpl-bast','bast','Surat BAST','BAST {{nomor}}','Terlampir.','id','2026-08-22','2026-08-22')`,
    );
    await client.execute(
      `INSERT INTO document_deliveries
        (id,document_kind,document_id,document_number,audience,recipient,template_id,
         template_name,subject,status,scheduled_for,created_at)
        VALUES ('kirim-bast','bast','bast-1','BAST/2026/001','client','klien@contoh.test',
          'tpl-bast','Surat BAST','BAST BAST/2026/001','Sent','2026-08-22','2026-08-22')`,
    );
  } finally {
    client.close();
  }
});

// `DROP TABLE` menjalankan `DELETE FROM` implisit saat penegakan foreign key
// menyala — dan di libSQL ia menyala secara bawaan. Tanpa penjagaan, membuang
// document_deliveries akan MENGHAPUS arsip lampirannya lewat ON DELETE CASCADE
// dan membuang document_email_templates akan mengosongkan template_id setiap
// baris riwayat lewat ON DELETE SET NULL — dua arsip yang justru disimpan
// permanen. Semua langkah migrasinya tetap melaporkan sukses.
test("membangun ulang tabel tidak menghilangkan barisnya", async () => {
  const client = createClient({ url: `file:${databasePath}` });
  const template = await client.execute(
    "SELECT name FROM document_email_templates WHERE id='tpl-lama'",
  );
  const kiriman = await client.execute(
    "SELECT document_number,template_id FROM document_deliveries WHERE id='kirim-lama'",
  );
  const lampiran = await client.execute(
    "SELECT filename FROM document_delivery_attachments WHERE id='lampiran-lama'",
  );
  client.close();
  assert.equal(String(template.rows[0]?.name ?? ""), "Surat invoice");
  assert.equal(String(kiriman.rows[0]?.document_number ?? ""), "INV/2026/001");
  assert.equal(
    String(lampiran.rows[0]?.filename ?? ""),
    "INV-2026-001.pdf",
    "arsip lampiran terhapus oleh ON DELETE CASCADE saat tabel dibangun ulang",
  );
  assert.equal(
    String(kiriman.rows[0]?.template_id ?? ""),
    "tpl-lama",
    "template_id riwayat dikosongkan oleh ON DELETE SET NULL saat tabel dibangun ulang",
  );
});

// Inilah yang membedakan migrasi ini dari dua migrasi CHECK sebelumnya di
// initialize.ts. Keduanya memakai `ALTER TABLE ... RENAME TO` pada tabel yang
// tidak punya anak. Di sini anaknya ada, dan rename akan MENULIS ULANG klausa
// REFERENCES-nya menjadi nama tabel sementara — yang beberapa baris kemudian
// di-drop. Skemanya tetap bisa dibaca, insert tetap jalan, dan tidak ada satu
// pun tes lain yang akan menyadarinya.
test("klausa REFERENCES tabel anak tidak ikut ditulis ulang", async () => {
  const client = createClient({ url: `file:${databasePath}` });
  const ddl = async (nama) => {
    const r = await client.execute({
      sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
      args: [nama],
    });
    return String(r.rows[0]?.sql ?? "");
  };
  const lampiran = await ddl("document_delivery_attachments");
  const kiriman = await ddl("document_deliveries");
  const sisa = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_kind_migration'",
  );
  client.close();

  assert.match(
    lampiran,
    /REFERENCES\s+"?document_deliveries"?\s*\(/i,
    `document_delivery_attachments kehilangan induknya: ${lampiran}`,
  );
  assert.match(
    kiriman,
    /REFERENCES\s+"?document_email_templates"?\s*\(/i,
    `document_deliveries kehilangan rujukan templatenya: ${kiriman}`,
  );
  assert.equal(
    sisa.rows.length,
    0,
    `tabel sementara migrasi tertinggal: ${sisa.rows.map((r) => String(r.name)).join(", ")}`,
  );
});

test("indeks kembali setelah tabelnya dibangun ulang", async () => {
  const client = createClient({ url: `file:${databasePath}` });
  const r = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='index'
      AND tbl_name IN ('document_email_templates','document_deliveries')`,
  );
  client.close();
  const nama = r.rows.map((x) => String(x.name));
  for (const perlu of [
    "document_email_templates_kind_idx",
    "document_deliveries_document_idx",
    "document_deliveries_outbox_idx",
    "document_deliveries_status_idx",
  ]) {
    assert.ok(nama.includes(perlu), `indeks ${perlu} hilang. Yang ada: ${nama.join(", ")}`);
  }
});
