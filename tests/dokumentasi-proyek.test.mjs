// Foto dan berkas proyek: unggah banyak, pemeriksaan isi, dedupe, tanggal EXIF,
// thumbnail, keterangan, hapus, dan galeri lintas proyek yang menghormati
// cakupan anggota.
//
// Server dinyalakan DI ATAS tabel project_documents versi lama (sepuluh kolom,
// tanpa taken_at/sha256/thumb) — itulah keadaan demo dan produksi saat rilis
// ini mendarat. Kolom barunya hanya bisa datang lewat ensureColumn, dan
// indeksnya harus dibuat sesudah kolomnya; tes lain mulai dari basis data
// kosong dan tidak akan pernah melihat urutan itu salah.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";
import sharp from "sharp";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";
const SANDI = "Dokumentasi-2026";
const ADMIN = "admin@perumnet.id";

/** project_documents persis seperti sebelum 22 Agustus 2026. */
const TABEL_LAMA = `
CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_url TEXT,
  content_base64 TEXT,
  uploaded_by TEXT,
  uploader_name TEXT NOT NULL,
  created_at TEXT NOT NULL
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
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
      lastError = new Error(`Health ${response.status}`);
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
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return response;
}

async function json(path, options = {}, expectedStatus = 200) {
  const response = await request(path, options);
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expectedStatus, `${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload?.data ?? payload;
}

async function galat(path, options = {}) {
  const response = await request(path, options);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, code: payload?.error?.code, message: payload?.error?.message, details: payload?.error?.details };
}

async function masuk(email, password = "perumnet123") {
  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, remember: false }) });
}

async function png(color, width = 64, height = 48) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}
async function jpegExif(dateTimeOriginal, description = "uji") {
  return sharp({ create: { width: 96, height: 64, channels: 3, background: "#cc0000" } })
    .jpeg()
    .withExif({ IFD0: { ImageDescription: description }, IFD2: { DateTimeOriginal: dateTimeOriginal } })
    .toBuffer();
}
let nomorPdf = 0;
function pdfStub() {
  nomorPdf += 1;
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Dok ${nomorPdf}>>endobj\n%%EOF`);
}
function berkas(bytes, name, type) {
  return new File([bytes], name, { type });
}
const dbClient = () => createClient({ url: `file:${databasePath}` });

const K = {};

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-dokumentasi-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-dokumentasi-uploads-${process.pid}-${Date.now()}`;
  mkdirSync(uploadDirectory, { recursive: true });

  // Tabel versi lama disiapkan SEBELUM server menyentuh basis datanya.
  const legacy = dbClient();
  await legacy.execute(TABEL_LAMA);
  await legacy.execute("CREATE INDEX IF NOT EXISTS project_documents_project_idx ON project_documents(project_id)");
  legacy.close();

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
  await masuk(ADMIN);

  K.proyekA = await json("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Dokumentasi A", client: "Klien A", location: "Ubud", status: "Aktif", value: 0 }),
  }, 201);
  K.proyekB = await json("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Dokumentasi B", client: "Klien B", location: "Kuta", status: "Aktif", value: 0 }),
  }, 201);
  K.pm = await json("/api/users", {
    method: "POST",
    body: JSON.stringify({ name: "PM Dokumentasi", email: "pm.dokumentasi@perumnet.id", password: SANDI, role: "Project Manager", status: "Aktif" }),
  }, 201);
  await json(`/api/projects/${K.proyekA.id}/access`, { method: "PUT", body: JSON.stringify({ userIds: [K.pm.id] }) });

  // Baris lama di proyek A: byte-nya di UPLOAD_DIR, kolom barunya NULL.
  K.legacyId = "legacy-foto-0001";
  K.legacyPng = await png("#336699", 40, 30);
  writeFileSync(`${uploadDirectory}/${K.legacyId}`, K.legacyPng);
  const db = dbClient();
  await db.execute({
    sql: `INSERT INTO project_documents (id,project_id,name,mime_type,size,storage_url,content_base64,uploaded_by,uploader_name,created_at)
      VALUES (?,?,?,?,?,?,NULL,NULL,?,?)`,
    args: [K.legacyId, K.proyekA.id, "lama.png", "image/png", K.legacyPng.length, `local://${K.legacyId}`, "Pengunggah Lama", "2026-03-10T02:00:00.000Z"],
  });
  db.close();

  K.bytes = {
    png: await png("#00aa00"),
    jpeg: await jpegExif("2026:05:17 09:30:00", "progres lantai 2"),
    pdf: pdfStub(),
    bohong: await png("#aa00aa"),
    lain: await png("#0000aa"),
    b: await png("#ffaa00"),
  };
}, { timeout: 180_000 });

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

const unggah = (projectId, files, caption, expected = 201) => {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (caption) form.set("caption", caption);
  return json(`/api/projects/${projectId}/documents`, { method: "POST", body: form }, expected);
};

test("migrasi: kolom dan indeks baru hadir di atas tabel versi lama", async () => {
  const db = dbClient();
  const kolom = (await db.execute("PRAGMA table_info(project_documents)")).rows.map((r) => String(r.name));
  for (const nama of ["caption", "taken_at", "sha256", "width", "height", "thumb_storage_url", "thumb_content_base64"]) {
    assert.ok(kolom.includes(nama), `kolom ${nama} tidak ditambahkan`);
  }
  const indeks = (await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='project_documents'")).rows.map((r) => String(r.name));
  for (const nama of ["project_documents_project_created_idx", "project_documents_project_taken_idx", "project_documents_project_sha_idx"]) {
    assert.ok(indeks.includes(nama), `indeks ${nama} tidak ada; yang ada: ${indeks.join(", ")}`);
  }
  const lama = await db.execute({ sql: "SELECT taken_at, created_at FROM project_documents WHERE id=?", args: [K.legacyId] });
  db.close();
  // Baris yang disisipkan tes SETELAH migrasi tidak di-backfill — dan daftar
  // harus tetap memperlakukannya dengan benar (lihat skenario baris lama).
  assert.equal(lama.rows[0].taken_at, null);
});

test("unggah tiga berkas sekaligus: keterangan, dimensi, thumbnail, tanggal EXIF", async () => {
  await masuk(ADMIN);
  const hasil = await unggah(K.proyekA.id, [
    berkas(K.bytes.png, "hijau.png", "image/png"),
    berkas(K.bytes.jpeg, "IMG_0517.jpg", "image/jpeg"),
    berkas(K.bytes.pdf, "gambar-kerja.pdf", "application/pdf"),
  ], "Tarik kabel lantai 2");
  assert.equal(hasil.uploaded.length, 3, JSON.stringify(hasil.skipped));
  assert.equal(hasil.skipped.length, 0);
  const [pngDoc, jpegDoc, pdfDoc] = hasil.uploaded;
  for (const doc of hasil.uploaded) {
    assert.equal(doc.caption, "Tarik kabel lantai 2");
    assert.match(doc.takenAt, /\+08:00$/);
    assert.equal(doc.projectCode, K.proyekA.code);
  }
  assert.equal(pngDoc.type, "image");
  assert.equal(pngDoc.width, 64);
  assert.equal(pngDoc.height, 48);
  assert.match(pngDoc.thumbUrl, /variant=thumb$/);
  assert.equal(jpegDoc.takenAt, "2026-05-17T09:30:00+08:00", "tanggal EXIF tidak terbaca");
  assert.equal(pdfDoc.type, "file");
  assert.equal(pdfDoc.thumbUrl, null);
  assert.ok(Math.abs(new Date(pdfDoc.takenAt).getTime() - Date.now()) < 60_000, "PDF memakai waktu unggah");
  K.pngDoc = pngDoc;
  K.jpegDoc = jpegDoc;
  K.pdfDoc = pdfDoc;

  const db = dbClient();
  const audit = await db.execute("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='project_document' AND action='upload'");
  db.close();
  assert.equal(Number(audit.rows[0].n), 3, "satu baris audit per berkas");
});

test("PNG yang mengaku JPEG dilewati dengan IMAGE_TYPE_MISMATCH, yang lain tetap masuk", async () => {
  const hasil = await unggah(K.proyekA.id, [
    berkas(K.bytes.bohong, "bukan.jpg", "image/jpeg"),
    berkas(K.bytes.lain, "lain.png", "image/png"),
  ]);
  assert.equal(hasil.uploaded.length, 1);
  assert.equal(hasil.skipped.length, 1);
  assert.equal(hasil.skipped[0].code, "IMAGE_TYPE_MISMATCH");
  assert.equal(hasil.skipped[0].name, "bukan.jpg");
  K.lainDoc = hasil.uploaded[0];
});

test("byte yang sama ditolak sebagai DUPLICATE dan menunjuk dokumen yang ada", async () => {
  const sendiri = await galat(`/api/projects/${K.proyekA.id}/documents`, {
    method: "POST",
    body: (() => { const f = new FormData(); f.append("files", berkas(K.bytes.png, "hijau-lagi.png", "image/png")); return f; })(),
  });
  assert.equal(sendiri.status, 422);
  assert.equal(sendiri.code, "NO_FILE_ACCEPTED");
  assert.equal(sendiri.details?.skipped?.[0]?.code, "DUPLICATE");
  assert.equal(sendiri.details?.skipped?.[0]?.details?.documentId, K.pngDoc.id);
});

test("thumbnail WebP 480 px, nosniff, cache sehari; PDF tidak punya thumbnail", async () => {
  const thumb = await request(`/api/documents/${K.jpegDoc.id}/content?variant=thumb`);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get("content-type"), "image/webp");
  assert.equal(thumb.headers.get("x-content-type-options"), "nosniff");
  assert.equal(thumb.headers.get("cache-control"), "private, max-age=86400");
  const body = Buffer.from(await thumb.arrayBuffer());
  assert.equal(body.subarray(0, 4).toString(), "RIFF");
  assert.equal(body.subarray(8, 12).toString(), "WEBP");
  const meta = await sharp(body).metadata();
  assert.ok(meta.width <= 480, `lebar thumb ${meta.width}`);

  const asli = await request(`/api/documents/${K.jpegDoc.id}/content`);
  assert.equal(asli.status, 200);
  assert.equal(asli.headers.get("content-type"), "image/jpeg");
  assert.equal(asli.headers.get("x-content-type-options"), "nosniff", "rute asli juga harus nosniff");
  const asliBody = Buffer.from(await asli.arrayBuffer());
  assert.equal(Buffer.compare(asliBody, K.bytes.jpeg), 0, "byte asli harus utuh");

  const pdf = await galat(`/api/documents/${K.pdfDoc.id}/content?variant=thumb`);
  assert.equal(pdf.code, "NO_THUMBNAIL");
});

test("baris lama: tampil dengan tanggal unggahnya, thumbnail dibuat saat pertama diminta lalu disimpan", async () => {
  const daftar = await json(`/api/projects/${K.proyekA.id}/documents`);
  const lama = daftar.find((d) => d.id === K.legacyId);
  assert.ok(lama, "baris lama tidak muncul di daftar");
  assert.equal(lama.takenAt, lama.createdAt);
  assert.equal(lama.uploader, "Pengunggah Lama");

  const thumb = await request(`/api/documents/${K.legacyId}/content?variant=thumb`);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get("content-type"), "image/webp");
  assert.ok(existsSync(`${uploadDirectory}/${K.legacyId}-thumb`), "thumbnail baris lama harus disimpan");
  const db = dbClient();
  const baris = await db.execute({ sql: "SELECT thumb_storage_url FROM project_documents WHERE id=?", args: [K.legacyId] });
  db.close();
  assert.equal(baris.rows[0].thumb_storage_url, `local://${K.legacyId}-thumb`);
});

test("jalur lama: satu `file` tetap memulangkan objek tunggal dengan kunci lama", async () => {
  const form = new FormData();
  form.set("file", berkas(await png("#112233"), "tunggal.png", "image/png"));
  const doc = await json(`/api/projects/${K.proyekA.id}/documents`, { method: "POST", body: form }, 201);
  for (const kunci of ["id", "name", "type", "date", "uploader", "preview", "thumbUrl", "takenAt"]) {
    assert.ok(kunci in doc, `kunci ${kunci} hilang dari balasan jalur lama`);
  }
  assert.equal(doc.preview, doc.url);
  K.tunggalDoc = doc;
});

test("PM hanya melihat proyeknya: konten, daftar, dan ringkasan proyek lain tidak ada", async () => {
  await masuk(ADMIN);
  const diB = await unggah(K.proyekB.id, [berkas(K.bytes.b, "b.png", "image/png")], "Proyek B");
  K.bDoc = diB.uploaded[0];

  await masuk(K.pm.email, SANDI);
  assert.equal((await galat(`/api/documents/${K.bDoc.id}/content`)).status, 404);
  const semua = await json("/api/documents?pageSize=100");
  assert.ok(semua.items.length > 0);
  for (const item of semua.items) assert.equal(item.projectId, K.proyekA.id);
  assert.equal((await galat(`/api/documents?projectId=${K.proyekB.id}`)).status, 404);
  const ringkas = await json("/api/documents/summary");
  assert.deepEqual(ringkas.byProject.map((p) => p.projectId), [K.proyekA.id]);
});

test("galeri lintas proyek: saring jenis, rentang tanggal EXIF, kata kunci, halaman, ringkasan bulan", async () => {
  await masuk(ADMIN);
  const foto = await json("/api/documents?type=photo&pageSize=100");
  assert.ok(!foto.items.some((d) => d.type === "file"), "type=photo masih memuat PDF");
  const mei = await json("/api/documents?from=2026-05-17&to=2026-05-17");
  assert.deepEqual(mei.items.map((d) => d.id), [K.jpegDoc.id], "rentang harus mengikuti tanggal EXIF");
  const kata = await json("/api/documents?q=LANTAI%202&pageSize=100");
  assert.ok(kata.items.length >= 3 && kata.items.every((d) => /lantai 2/i.test(d.caption ?? "")));
  const halaman = await json("/api/documents?pageSize=10&page=1");
  assert.equal(halaman.pageSize, 10);
  assert.ok(halaman.total >= 7);
  const ringkas = await json(`/api/documents/summary?projectId=${K.proyekA.id}`);
  const bulanMei = ringkas.byMonth.find((m) => m.month === "2026-05");
  assert.equal(bulanMei?.photos, 1, "bulan EXIF harus dihitung, bukan bulan unggah");
  assert.equal(ringkas.byProject.length, 1);
  assert.ok(ringkas.byProject[0].photos >= 5);
  assert.equal(ringkas.byProject[0].files, 1);
});

test("PATCH keterangan dan tanggal foto dinormalkan ke waktu Makassar; yang tak sah ditolak", async () => {
  const ubah = await json(`/api/projects/${K.proyekA.id}/documents/${K.lainDoc.id}`, {
    method: "PATCH",
    body: JSON.stringify({ caption: "Panel utama", takenAt: "2026-06-01T08:00" }),
  });
  assert.equal(ubah.caption, "Panel utama");
  assert.equal(ubah.takenAt, "2026-06-01T08:00:00+08:00");
  const salah = await galat(`/api/projects/${K.proyekA.id}/documents/${K.lainDoc.id}`, {
    method: "PATCH",
    body: JSON.stringify({ takenAt: "kemarin sore" }),
  });
  assert.equal(salah.code, "INVALID_TAKEN_AT");
  const dicari = await json("/api/documents?q=panel%20utama");
  assert.deepEqual(dicari.items.map((d) => d.id), [K.lainDoc.id]);
});

test("hapus: baris, berkas asli, dan thumbnail ikut hilang", async () => {
  const id = K.pngDoc.id;
  assert.ok(existsSync(`${uploadDirectory}/${id}`));
  assert.ok(existsSync(`${uploadDirectory}/${id}-thumb`));
  const hapus = await request(`/api/projects/${K.proyekA.id}/documents/${id}`, { method: "DELETE" });
  assert.equal(hapus.status, 204);
  assert.equal((await galat(`/api/documents/${id}/content`)).status, 404);
  assert.equal(existsSync(`${uploadDirectory}/${id}`), false, "berkas asli tertinggal");
  assert.equal(existsSync(`${uploadDirectory}/${id}-thumb`), false, "thumbnail tertinggal");
  const db = dbClient();
  const audit = await db.execute({ sql: "SELECT COUNT(*) AS n FROM audit_logs WHERE entity='project_document' AND action='delete' AND entity_id=?", args: [id] });
  db.close();
  assert.equal(Number(audit.rows[0].n), 1);
});

test("batas: sebelas berkas ditolak, berkas 5 MB lebih dilewati", async () => {
  const sebelas = [];
  for (let i = 0; i < 11; i += 1) sebelas.push(berkas(pdfStub(), `d${i}.pdf`, "application/pdf"));
  const terlalu = await galat(`/api/projects/${K.proyekA.id}/documents`, {
    method: "POST",
    body: (() => { const f = new FormData(); for (const x of sebelas) f.append("files", x); return f; })(),
  });
  assert.equal(terlalu.code, "TOO_MANY_FILES");

  const besar = berkas(Buffer.alloc(5 * 1024 * 1024 + 1, 1), "besar.png", "image/png");
  const hasil = await unggah(K.proyekA.id, [besar, berkas(pdfStub(), "kecil.pdf", "application/pdf")]);
  assert.equal(hasil.uploaded.length, 1);
  assert.equal(hasil.skipped[0].code, "FILE_TOO_LARGE");
});
