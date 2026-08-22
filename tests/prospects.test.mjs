// Calon klien (prospek) dan pengiriman penawaran dari dalam aplikasi.
//
// Yang diuji di sini adalah keputusan yang paling mahal kalau salah: siapa
// yang BOLEH dikirimi surat, dan apakah puluhan surat benar-benar diberi jeda.
// Mailcow yang membawa penawaran ini juga membawa invoice dan tautan reset
// kata sandi; kampanye yang tiba sekaligus membahayakan keduanya.
//
// Email tidak pernah benar-benar terkirim: worker outbox adalah proses
// terpisah dan tidak dijalankan di sini. `RESEND_API_KEY` sengaja diisi nilai
// palsu supaya baris antrean berstatus Pending — di mode capture semuanya
// menjadi Skipped dan jeda tidak bisa diamati.

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
let cookie = "";

const ADMIN = "admin@perumnet.id";
const ADMIN_PASSWORD = "perumnet123";

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
      lastError = new Error(`Health endpoint returned ${response.status}`);
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
  return {
    status: response.status,
    data: payload?.data,
    code: payload?.error?.code,
    message: payload?.error?.message,
    details: payload?.error?.details,
  };
}

function db() {
  return createClient({ url: `file:${databasePath}` });
}

let urutan = 0;
async function tambahProspek(perubahan = {}) {
  urutan += 1;
  return await api("/api/cms/prospects", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Kontak ${urutan}`,
      email: `kontak${urutan}@contoh.test`,
      companyName: `PT Contoh ${urutan}`,
      source: "kartu nama pameran properti",
      ...perubahan,
    }),
  });
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-prospects-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-prospects-uploads-${process.pid}-${Date.now()}`;
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
        // Mode live + kunci palsu: baris masuk antrean sebagai Pending, dan
        // tidak ada yang mengirimnya karena worker tidak dijalankan di sini.
        RESEND_API_KEY: "uji-tidak-pernah-dipakai",
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
      server.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
});

// ── Menyimpan kontak ─────────────────────────────────────────────────

test("kontak tersimpan, dan sumbernya ikut tercatat", async () => {
  const hasil = await tambahProspek({ source: "telepon masuk 19 Agustus" });
  assert.equal(hasil.status, 201);
  assert.equal(hasil.data.source, "telepon masuk 19 Agustus");
  assert.equal(hasil.data.status, "New");
  assert.equal(hasil.data.emailable, true);
});

test("tanpa catatan sumber, kontak DITOLAK", async () => {
  const hasil = await tambahProspek({ source: "" });

  // Orang ini tidak pernah mencentang kotak privasi. Kalau sumbernya boleh
  // kosong, pertanyaan "dari mana Anda dapat alamat email saya" tidak punya
  // jawaban yang bisa dipertanggungjawabkan.
  assert.equal(hasil.status, 422);
});

test("alamat yang sudah terdaftar ditolak, dan menunjuk yang lama", async () => {
  const pertama = await tambahProspek({ email: "kembar@contoh.test" });
  assert.equal(pertama.status, 201);

  const kedua = await tambahProspek({ email: "KEMBAR@contoh.test" });
  assert.equal(kedua.status, 409);
  assert.equal(kedua.code, "EMAIL_ALREADY_LISTED");
  // Layar butuh ini untuk menawarkan "buka prospek yang sudah ada".
  assert.equal(kedua.details.prospectId, pertama.data.id);
});

test("bukan Admin tidak bisa melihat daftar prospek", async () => {
  const response = await fetch(`${baseUrl}/api/cms/prospects`);
  assert.equal(response.status, 401);
});

// ── Siapa yang boleh dikirimi ────────────────────────────────────────

test("opt-out membuat emailable false dan pengiriman ditolak", async () => {
  const prospek = await tambahProspek();
  const ubah = await api(`/api/cms/prospects/${prospek.data.id}`, {
    method: "PATCH",
    body: JSON.stringify({ optOut: true, optOutReason: "minta berhenti lewat telepon" }),
  });
  assert.equal(ubah.status, 200);
  assert.equal(ubah.data.emailable, false);
  assert.ok(ubah.data.optOutAt);

  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      subject: "Penawaran",
      bodyHtml: "<p>Halo {{nama}}</p>",
    }),
  });
  assert.equal(kirim.status, 422);
  assert.equal(kirim.code, "NO_ELIGIBLE_RECIPIENTS");
  assert.equal(kirim.details.skipped[0].reason, "OPTED_OUT");
});

test("batch melebihi batas ditolak sebelum satu pesan pun diantre", async () => {
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: Array.from({ length: 201 }, () => "11111111-1111-4111-8111-111111111111"),
      subject: "Penawaran",
      bodyHtml: "<p>Halo</p>",
    }),
  });
  assert.equal(kirim.status, 422);
});

// ── Jeda antar pesan ─────────────────────────────────────────────────

test("pesan dalam satu batch dijadwalkan berjenjang, bukan serentak", async () => {
  const a = await tambahProspek();
  const b = await tambahProspek();
  const c = await tambahProspek();
  const ids = [a.data.id, b.data.id, c.data.id];

  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: ids,
      subject: "Penawaran untuk {{perusahaan}}",
      bodyHtml: "<p>Halo {{nama}}</p>",
      spacingSeconds: 30,
    }),
  });
  assert.equal(kirim.status, 200);
  assert.equal(kirim.data.queued, 3);

  const client = db();
  const baris = await client.execute({
    sql: `SELECT next_attempt_at FROM email_outbox
      WHERE event_type='prospect_outreach' ORDER BY next_attempt_at`,
  });
  client.close();
  assert.equal(baris.rows.length, 3);

  const waktu = baris.rows.map((r) => Date.parse(String(r.next_attempt_at)));
  // Yang penting bukan angka persisnya, tapi bahwa ketiganya BERBEDA dan
  // berjarak. Kalau enqueue mengabaikan notBefore, ketiganya akan sama.
  assert.ok(waktu[1] - waktu[0] >= 29_000, `jeda 1→2 terlalu kecil: ${waktu[1] - waktu[0]}ms`);
  assert.ok(waktu[2] - waktu[1] >= 29_000, `jeda 2→3 terlalu kecil: ${waktu[2] - waktu[1]}ms`);
});

// ── Render template ──────────────────────────────────────────────────

test("placeholder yang dikenal diisi, yang tidak dikenal dibiarkan utuh", async () => {
  const prospek = await tambahProspek({ fullName: "Budi", companyName: "PT Maju" });
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      subject: "Untuk {{perusahaan}}",
      bodyHtml: "<p>Halo {{nama}}, salam {{prusahaan}}</p>",
      bodyFormat: "html",
    }),
  });
  assert.equal(kirim.status, 200);

  const client = db();
  const baris = await client.execute({
    sql: "SELECT subject,body_html FROM cms_prospect_outreach WHERE prospect_id=? LIMIT 1",
    args: [prospek.data.id],
  });
  client.close();

  assert.equal(String(baris.rows[0].subject), "Untuk PT Maju");
  assert.match(String(baris.rows[0].body_html), /Halo Budi/);
  // Salah ketik dibiarkan terlihat. Kalau diam-diam dikosongkan, kesalahan itu
  // terkirim ke ratusan orang tanpa ada yang menyadarinya.
  assert.match(String(baris.rows[0].body_html), /\{\{prusahaan\}\}/);
});

test("nilai yang disisipkan di-escape, bukan dipercaya", async () => {
  const prospek = await tambahProspek({ fullName: "<script>alert(1)</script>" });
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      subject: "Halo",
      bodyHtml: "<p>{{nama}}</p>",
      bodyFormat: "html",
    }),
  });
  assert.equal(kirim.status, 200);

  const client = db();
  const baris = await client.execute({
    sql: "SELECT body_html FROM cms_prospect_outreach WHERE prospect_id=? LIMIT 1",
    args: [prospek.data.id],
  });
  client.close();

  const isi = String(baris.rows[0].body_html);
  assert.ok(!isi.includes("<script>"), "tag script lolos ke badan surat");
  assert.match(isi, /&lt;script&gt;/);
});

// ── Riwayat surat ────────────────────────────────────────────────────

test("riwayat menempel pada prospek dan selamat saat outbox dipangkas", async () => {
  const prospek = await tambahProspek();
  await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      subject: "Penawaran",
      bodyHtml: "<p>Isi surat yang harus bertahan</p>",
    }),
  });

  // Outbox membuang isi pesan begitu barisnya final, lalu barisnya sendiri
  // dipangkas. Riwayat klien tidak boleh ikut hilang bersamanya.
  const client = db();
  await client.execute("DELETE FROM email_outbox WHERE event_type='prospect_outreach'");
  client.close();

  const detail = await api(`/api/cms/prospects/${prospek.data.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.outreach.length, 1);
  assert.equal(detail.data.outreach[0].hasBody, true);
  assert.equal(detail.data.outreach[0].subject, "Penawaran");
});

test("mengirim menaikkan status New menjadi Contacted", async () => {
  const prospek = await tambahProspek();
  assert.equal(prospek.data.status, "New");
  await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({
      prospectIds: [prospek.data.id],
      subject: "Penawaran",
      bodyHtml: "<p>Halo</p>",
    }),
  });
  const detail = await api(`/api/cms/prospects/${prospek.data.id}`);
  assert.equal(detail.data.status, "Contacted");
  assert.ok(detail.data.lastOutreachAt);
});

// ── Impor workbook ───────────────────────────────────────────────────

async function workbook(baris) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Kontak");
  sheet.addRow(["Nama", "Email", "Perusahaan", "Jabatan", "No HP", "Kota"]);
  for (const r of baris) sheet.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function unggah(buffer, extra = {}) {
  const form = new FormData();
  form.set("file", new Blob([buffer]), "kontak.xlsx");
  form.set("source", "berkas Data Clients Enterprise.xlsx");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const response = await fetch(`${baseUrl}/api/cms/prospects/import`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, data: payload?.data, code: payload?.error?.code };
}

test("impor membaca kolom dari judulnya, bukan dari posisinya", async () => {
  const buffer = await workbook([
    ["Siti Rahma", "siti@impor.test", "PT Satu", "Direktur", "08123456789", "Denpasar"],
  ]);
  const hasil = await unggah(buffer);

  assert.equal(hasil.status, 200);
  assert.equal(hasil.data.disimpan, 1);

  const cari = await api("/api/cms/prospects?q=siti@impor.test");
  const prospek = cari.data.items[0];
  assert.equal(prospek.fullName, "Siti Rahma");
  assert.equal(prospek.companyName, "PT Satu");
  assert.equal(prospek.source, "berkas Data Clients Enterprise.xlsx");
});

test("nol di depan nomor telepon dikembalikan", async () => {
  // Excel menyimpan 08123... sebagai angka dan nolnya hilang. Yang tersimpan
  // di sel jadi 8123456789.
  const buffer = await workbook([
    ["Agus Nol", "agus.nol@impor.test", "PT Nol", "", 8123456789, "Badung"],
  ]);
  assert.equal((await unggah(buffer)).status, 200);

  const cari = await api("/api/cms/prospects?q=agus.nol@impor.test");
  assert.equal(cari.data.items[0].whatsapp, "08123456789");
});

test("dua alamat dalam satu sel: kontak tetap masuk, tanpa email, dilaporkan", async () => {
  const buffer = await workbook([
    ["Dwi Ganda", "a@impor.test, b@impor.test", "PT Ganda", "", "", "Gianyar"],
  ]);
  const hasil = await unggah(buffer);

  assert.equal(hasil.status, 200);
  assert.equal(hasil.data.disimpan, 1);
  const masalah = hasil.data.issues.find((i) => i.code === "EMAIL_GANDA");
  // Nomor barisnya harus ikut — tanpa itu tidak ada yang bisa membetulkannya
  // di berkas sumber.
  assert.equal(masalah.row, 2);
  assert.match(masalah.detail, /a@impor\.test/);

  const cari = await api("/api/cms/prospects?q=Dwi Ganda");
  assert.equal(cari.data.items[0].email, "");
  assert.equal(cari.data.items[0].emailable, false);
});

test("alamat yang sudah dipakai dilewati dan dilaporkan dengan nomor baris", async () => {
  await tambahProspek({ email: "sudah.ada@impor.test" });
  const buffer = await workbook([
    ["Baru Satu", "baru.satu@impor.test", "PT Baru", "", "", ""],
    ["Kembar Lagi", "sudah.ada@impor.test", "PT Kembar", "", "", ""],
  ]);
  const hasil = await unggah(buffer);

  assert.equal(hasil.status, 200);
  assert.equal(hasil.data.disimpan, 1);
  assert.equal(hasil.data.dilewati, 1);
  assert.ok(hasil.data.issues.some((i) => i.row === 3 && /sudah dipakai/.test(i.detail)));
});

test("dry-run melaporkan tanpa menyimpan apa pun", async () => {
  const buffer = await workbook([
    ["Coba Kering", "coba.kering@impor.test", "PT Kering", "", "", ""],
  ]);
  const hasil = await unggah(buffer, { dryRun: "1" });

  assert.equal(hasil.status, 200);
  assert.equal(hasil.data.dryRun, true);
  assert.equal(hasil.data.disimpan, 1);

  const cari = await api("/api/cms/prospects?q=coba.kering@impor.test");
  assert.equal(cari.data.items.length, 0);
});

test("berkas tanpa judul kolom yang dikenali ditolak dengan penjelasan", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Entah");
  sheet.addRow(["kolom1", "kolom2"]);
  sheet.addRow(["apa", "entah"]);
  const hasil = await unggah(Buffer.from(await wb.xlsx.writeBuffer()));

  assert.equal(hasil.status, 422);
  assert.equal(hasil.code, "EMPTY_WORKBOOK");
});

// ── Bentuk berkas yang sebenarnya ────────────────────────────────────
//
// Workbook kontak milik pemilik memisahkan segmen per LEMBAR, menulis judul
// "No.Telepon" tanpa spasi dan "Nama " dengan spasi di belakang, menaruh nama
// PERUSAHAAN di kolom "Nama", dan menyimpan sebagian nomor sebagai angka
// sehingga nol di depannya hilang. Keempatnya pernah membuat impor kehilangan
// data tanpa satu pun pesan galat.

async function workbookAsli() {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const buat = (nama, baris) => {
    const ws = wb.addWorksheet(nama);
    ws.addRow(["No", "Nama ", "Bidang", "Alamat Email", "No.Telepon"]);
    for (const r of baris) ws.addRow(r);
  };
  buat("Kontruksi & Arsitektur", [
    [1, "IBUKU Studio (Badung) ", "Arsitektur dan desain", "info@ibuku.test", "0361980999"],
  ]);
  buat("Developer", [
    [1, "Mirah Investment", "Properti premium", "info@mirah.test\t", "03619347733"],
  ]);
  buat("Smart Home", [
    [1, "Domotics Bali", "Smart home", "info@domotics.test", 3619346511],
  ]);
  buat("Hotel & Villa", [
    [1, "Coz Bali Management", "Hospitality", " cozbali@hotel.test", " 085190053526"],
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("keempat lembar terbaca, bukan hanya yang pertama", async () => {
  const hasil = await unggah(await workbookAsli());

  assert.equal(hasil.status, 200);
  // Membaca satu lembar saja akan memulangkan 1, bukan 4 — dan tiga lembar
  // lainnya hilang tanpa jejak.
  assert.equal(hasil.data.terbaca, 4);
  assert.equal(hasil.data.disimpan, 4);
  assert.equal(hasil.data.sheets.length, 4);
});

test("segmen diambil dari nama lembar", async () => {
  const cari = await api("/api/cms/prospects?q=info@domotics.test");
  assert.equal(cari.data.items[0].segment, "smart-home");

  const hotel = await api("/api/cms/prospects?q=cozbali@hotel.test");
  assert.equal(hotel.data.items[0].segment, "hotel-villa");

  const arsitek = await api("/api/cms/prospects?q=info@ibuku.test");
  // Lembar sumbernya salah ketik "Kontruksi"; pencocokan harus tetap kena.
  assert.equal(arsitek.data.items[0].segment, "konstruksi-arsitektur");
});

test("judul No.Telepon tanpa spasi tetap terbaca, dan nol nomor tetap kembali", async () => {
  const domotics = await api("/api/cms/prospects?q=info@domotics.test");
  // Disimpan Excel sebagai angka 3619346511; kode area Bali 0361.
  assert.equal(domotics.data.items[0].whatsapp, "03619346511");

  const ibuku = await api("/api/cms/prospects?q=info@ibuku.test");
  // Sudah berbentuk teks dengan nol — tidak boleh disentuh.
  assert.equal(ibuku.data.items[0].whatsapp, "0361980999");

  const hotel = await api("/api/cms/prospects?q=cozbali@hotel.test");
  // Spasi di depan dibuang, nolnya sudah ada.
  assert.equal(hotel.data.items[0].whatsapp, "085190053526");
});

test("kolom Nama jadi perusahaan juga saat tidak ada kolom perusahaan", async () => {
  const cari = await api("/api/cms/prospects?q=info@ibuku.test");
  const p = cari.data.items[0];
  assert.equal(p.fullName, "IBUKU Studio (Badung)");
  // Tanpa penyalinan ini, {{perusahaan}} di surat penawaran kosong pada
  // SELURUH kontak — dan itu baru terlihat setelah suratnya terkirim.
  assert.equal(p.companyName, "IBUKU Studio (Badung)");
});

test("tab dan spasi liar di sel email tidak ikut tersimpan", async () => {
  const cari = await api("/api/cms/prospects?q=info@mirah.test");
  assert.equal(cari.data.items[0].email, "info@mirah.test");
});

test("dua baris beralamat sama dalam SATU berkas: kering dan sungguhan sepakat", async () => {
  const baris = [
    ["GFAB Architects", "kembar@satuberkas.test", "PT GFAB", "", "", ""],
    ["Bali Home Immo", "kembar@satuberkas.test", "PT Immo", "", "", ""],
  ];

  const kering = await unggah(await workbook(baris), { dryRun: "1" });
  assert.equal(kering.status, 200);
  // Uji kering pernah memulangkan 2 di sini: ia hanya bertanya ke database,
  // dan saat kering tidak ada yang tersimpan sehingga dua baris kembar tidak
  // pernah bertemu. Laporannya lalu menjanjikan lebih banyak daripada yang
  // sungguhan tersimpan.
  assert.equal(kering.data.disimpan, 1);
  assert.equal(kering.data.dilewati, 1);
  assert.ok(kering.data.issues.some((i) => /berkas yang sama/.test(i.detail)));

  const sungguhan = await unggah(await workbook(baris));
  assert.equal(sungguhan.data.disimpan, 1);
  assert.equal(sungguhan.data.dilewati, 1);
});

// ── Surat utuh: kop berlogo dan tanda tangan ─────────────────────────
//
// Sebelumnya isi template dikirim apa adanya. Admin harus menulis HTML sendiri,
// dan yang sampai ke calon klien adalah potongan HTML telanjang: tanpa logo,
// tanpa tanda tangan, tanpa cara berhenti dihubungi. Pratinjau menampilkan
// potongan yang sama, jadi tidak ada satu pun layar yang memperlihatkan surat
// utuh sebelum ia terkirim.

async function buatTemplate(perubahan = {}) {
  return await api("/api/cms/prospect-templates", {
    method: "POST",
    body: JSON.stringify({
      name: `Template ${Math.random().toString(36).slice(2, 8)}`,
      subject: "Perkenalan untuk {{perusahaan}}",
      bodyHtml: "Yth. Bapak/Ibu,\n{{nama}}\n\nSalam hormat dari kami.",
      ...perubahan,
    }),
  });
}

test("template baru bawaannya teks biasa, bukan HTML", async () => {
  const t = await buatTemplate();
  assert.equal(t.status, 201);
  // Yang mengisi formulir ini bukan orang yang menulis HTML. Kalau bawaannya
  // html, tanda kurung siku yang dia ketik jadi markup diam-diam.
  assert.equal(t.data.bodyFormat, "text");
});

test("pratinjau memuat logo dan tanda tangan, bukan potongan telanjang", async () => {
  const prospek = await tambahProspek({ fullName: "Budi", companyName: "PT Maju" });
  const t = await buatTemplate({
    senderName: "Suci",
    senderSignoff: "Best Regards,",
    senderEmail: "orang@contoh.test",
    senderPhone: "+62 800-0000-0000",
  });

  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });
  assert.equal(lihat.status, 200);
  const surat = lihat.data.bodyHtml;

  assert.match(surat, /perumnet-enterprise-logo\.png/, "logo tidak ada di pratinjau");
  assert.match(surat, /Suci/, "nama penandatangan tidak ada");
  assert.match(surat, /Best Regards,/, "salam penutup tidak ada");
  assert.match(surat, /PerumNet Enterprise/, "nama perusahaan tidak ada");
  assert.match(surat, /Karangasem/, "alamat perusahaan tidak ada");
  // Cara berhenti dihubungi wajib ada: kontaknya tidak pernah meminta disurati.
  assert.match(surat, /BERHENTI/);
  assert.equal(lihat.data.subject, "Perkenalan untuk PT Maju");
});

test("yang dilihat di pratinjau adalah yang terkirim, huruf demi huruf", async () => {
  const prospek = await tambahProspek({ fullName: "Wayan", companyName: "CV Bali" });
  const t = await buatTemplate({ senderName: "Suci" });

  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({ prospectIds: [prospek.data.id], templateId: t.data.id }),
  });
  assert.equal(kirim.status, 200);

  const client = db();
  const baris = await client.execute({
    sql: "SELECT subject,body_html FROM cms_prospect_outreach WHERE prospect_id=? LIMIT 1",
    args: [prospek.data.id],
  });
  client.close();

  // Pratinjau dan pengiriman memanggil fungsi yang sama. Kalau suatu saat
  // dipisah, perbedaannya baru ketahuan setelah surat sampai ke calon klien —
  // dan saat itu tidak ada lagi yang bisa ditarik kembali.
  assert.equal(String(baris.rows[0].body_html), lihat.data.bodyHtml);
  assert.equal(String(baris.rows[0].subject), lihat.data.subject);
});

test("baris kosong jadi paragraf tanpa admin menulis satu tag pun", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({
    bodyHtml: "Paragraf satu.\n\nParagraf dua.\n\nParagraf tiga.",
  });
  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });

  const paragraf = lihat.data.bodyHtml.match(/<p style="margin:0 0 14px/g) ?? [];
  assert.equal(paragraf.length, 3);
  assert.match(lihat.data.bodyHtml, /Paragraf tiga\./);
});

test("tag yang diketik di kotak teks tetap terbaca sebagai teks", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({ bodyHtml: "Harga <b>khusus</b> untuk Anda." });
  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });

  // Kotaknya dijanjikan sebagai teks biasa. Kalau <b> diam-diam jadi tebal,
  // maka <script> juga jadi skrip — janji yang sama, akibat yang jauh berbeda.
  assert.match(lihat.data.bodyHtml, /&lt;b&gt;khusus&lt;\/b&gt;/);
  assert.ok(!lihat.data.bodyHtml.includes("<b>khusus</b>"));
});

test("tanda tangan memakai kontak orang, bukan kontak umum perusahaan", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({
    senderName: "Suci",
    senderEmail: "orang@contoh.test",
    senderPhone: "+62 800-0000-0000",
  });
  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });

  assert.match(lihat.data.bodyHtml, /orang@contoh\.test/);
  assert.match(lihat.data.bodyHtml, /\+62 800-0000-0000/);
  // Balasan penawaran harus sampai ke orang yang mengirimnya. Alamat umum
  // perusahaan memindahkan balasan ke kotak masuk yang tidak menunggunya.
  assert.ok(!lihat.data.bodyHtml.includes("enterprise@perumnet.id"));
});

test("tanda tangan yang dikosongkan jatuh ke kontak perusahaan", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({ senderName: "Suci" });
  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });

  assert.match(lihat.data.bodyHtml, /enterprise@perumnet\.id/);
});

test("daftar template membawa naskah awal dan tanda tangan dari akun yang masuk", async () => {
  const daftar = await api("/api/cms/prospect-templates");
  assert.equal(daftar.status, 200);
  const bawaan = daftar.data.defaults;

  // Kotak template tidak pernah dibuka kosong.
  assert.ok(bawaan.starter.bodyHtml.includes("PerumNet Enterprise"));
  assert.match(bawaan.starter.bodyHtml, /\{\{nama\}\}/);
  assert.equal(bawaan.starter.bodyFormat, "text");
  // Nama dan email pegawai datang dari sesi, bukan dari kode: repositori ini
  // publik dan tidak boleh memuat daftar pegawai.
  assert.equal(bawaan.senderEmail, ADMIN);
  assert.ok(bawaan.senderName.length > 0);
});

// ── Balasan mengikuti tanda tangan ───────────────────────────────────
//
// Surat keluar dari alamat sistem (EMAIL_FROM), tapi yang menandatangani
// adalah orang. Menekan Reply adalah cara paling wajar calon klien membalas;
// kalau balasannya mendarat di kotak masuk umum, orang yang menunggu balasan
// itu tidak pernah tahu balasannya sudah datang.

test("balasan diarahkan ke penanda tangan, bukan ke alamat umum", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({
    senderName: "Suci",
    senderEmail: "orang@contoh.test",
  });
  const kirim = await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({ prospectIds: [prospek.data.id], templateId: t.data.id }),
  });
  assert.equal(kirim.status, 200);

  const client = db();
  const baris = await client.execute({
    sql: "SELECT reply_to FROM email_outbox WHERE recipient=? LIMIT 1",
    args: [prospek.data.email],
  });
  client.close();

  assert.equal(String(baris.rows[0].reply_to), '"Suci" <orang@contoh.test>');
});

test("tanda tangan tanpa email tidak mengarang alamat balasan", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({ senderName: "Suci" });
  await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({ prospectIds: [prospek.data.id], templateId: t.data.id }),
  });

  const client = db();
  const baris = await client.execute({
    sql: "SELECT reply_to FROM email_outbox WHERE recipient=? LIMIT 1",
    args: [prospek.data.email],
  });
  client.close();

  // NULL berarti "pakai bawaan EMAIL_REPLY_TO", bukan alamat tebakan.
  assert.equal(baris.rows[0].reply_to, null);
});

test("baris baru di nama penanda tangan tidak menyelundupkan header", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({
    senderName: "Suci\r\nBcc: diam-diam@contoh.test",
    senderEmail: "orang@contoh.test",
  });
  await api("/api/cms/prospects/outreach", {
    method: "POST",
    body: JSON.stringify({ prospectIds: [prospek.data.id], templateId: t.data.id }),
  });

  const client = db();
  const baris = await client.execute({
    sql: "SELECT reply_to FROM email_outbox WHERE recipient=? LIMIT 1",
    args: [prospek.data.email],
  });
  client.close();

  const nilai = String(baris.rows[0].reply_to);
  // CR/LF di header email mentah berarti header tambahan yang ditulis orang
  // lain. Nilainya boleh jelek, tapi tidak boleh berbaris ganda.
  assert.ok(!/[\r\n]/.test(nilai), `reply_to memuat baris baru: ${JSON.stringify(nilai)}`);
  // Sisa teksnya boleh ikut, asal tetap di dalam nama tampilan yang dikutip —
  // di sana ia cuma tulisan, bukan header.
  assert.match(nilai, /^"[^"]*" <orang@contoh\.test>$/);
});

test("surat keamanan TIDAK pernah memakai alamat balasan dari pemanggil", async () => {
  const sebelum = db();
  const awal = await sebelum.execute(
    "SELECT count(*) AS n FROM email_outbox WHERE sender_profile='security'",
  );
  sebelum.close();

  const minta = await api("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN }),
  });
  assert.ok([200, 202, 204, 409].includes(minta.status), `status tak terduga: ${minta.status}`);

  const client = db();
  const baris = await client.execute(
    "SELECT reply_to FROM email_outbox WHERE sender_profile='security' ORDER BY created_at DESC LIMIT 1",
  );
  const sesudah = await client.execute(
    "SELECT count(*) AS n FROM email_outbox WHERE sender_profile='security'",
  );
  client.close();

  if (Number(sesudah.rows[0].n) === Number(awal.rows[0].n)) return; // mode mailserver: tidak ada baris
  // Tautan reset kata sandi harus membalas ke alamat milik sistem. Kalau kolom
  // ini bisa diisi pemanggil, jalur pemulihan akun ikut bisa diarahkan.
  assert.equal(baris.rows[0].reply_to, null);
});

// ── Kontak tanpa email juga disaring kembarnya ───────────────────────
//
// Alamat email punya indeks unik di database, jadi kembarnya selalu tertangkap.
// Kontak TANPA email tidak punya kunci unik apa pun — dan itu bukan kasus
// pinggiran: baris yang selnya memuat dua alamat sengaja disimpan tanpa email.
// Sebelum pemeriksaan ini ada, mengunggah ulang berkas yang sama (hal yang
// wajar setelah berkasnya diperbaiki) menghasilkan salinan berlipat.

test("baris tanpa email yang sama persis dilewati, bukan disalin berkali-kali", async () => {
  const baris = [
    ["Kontak Kembar", "", "PT Kembar", "", "", ""],
    ["Kontak Kembar", "", "PT Kembar", "", "", ""],
  ];
  const hasil = await unggah(await workbook(baris));
  assert.equal(hasil.data.disimpan, 1);
  assert.equal(hasil.data.dilewati, 1);
  assert.ok(hasil.data.issues.some((i) => i.code === "KONTAK_GANDA"));
});

test("mengunggah ulang berkas yang sama tidak menambah satu baris pun", async () => {
  const baris = [
    ["Ulang Tanpa Email", "", "PT Ulang", "", "", ""],
    ["Ulang Punya Email", "ulang@contoh.test", "PT Ulang", "", "", ""],
  ];
  const pertama = await unggah(await workbook(baris));
  assert.equal(pertama.data.disimpan, 2);

  const kedua = await unggah(await workbook(baris));
  // Nol. Berkas kontak sering diunggah ulang setelah diperbaiki; kalau yang
  // tanpa email lolos, daftarnya menggembung tanpa ada yang menyadarinya.
  assert.equal(kedua.data.disimpan, 0);
  assert.equal(kedua.data.dilewati, 2);
});

test("nama dan perusahaan dibandingkan tanpa peduli huruf besar dan spasi", async () => {
  const baris = [
    ["Ejaan Beda", "", "PT Ejaan", "", "", ""],
    ["  ejaan beda  ", "", "  pt ejaan  ", "", "", ""],
  ];
  const hasil = await unggah(await workbook(baris));
  assert.equal(hasil.data.disimpan, 1);
  assert.equal(hasil.data.dilewati, 1);
});

test("nama berbeda di perusahaan yang sama TIDAK dianggap kembar", async () => {
  const baris = [
    ["Orang Pertama", "", "PT Bersama", "", "", ""],
    ["Orang Kedua", "", "PT Bersama", "", "", ""],
  ];
  const hasil = await unggah(await workbook(baris));
  // Dua orang di satu kantor memang dua kontak. Penyaring yang kebablasan
  // menghapus kontak yang sah, dan itu tidak terlihat sampai ada yang mencari.
  assert.equal(hasil.data.disimpan, 2);
  assert.equal(hasil.data.dilewati, 0);
});

test("uji kering dan impor sungguhan sepakat untuk kontak tanpa email", async () => {
  const baris = [
    ["Sepakat Satu", "", "PT Sepakat", "", "", ""],
    ["Sepakat Satu", "", "PT Sepakat", "", "", ""],
    ["Sepakat Dua", "", "PT Sepakat", "", "", ""],
  ];
  const kering = await unggah(await workbook(baris), { dryRun: "1" });
  const sungguhan = await unggah(await workbook(baris));
  assert.equal(kering.data.disimpan, sungguhan.data.disimpan);
  assert.equal(kering.data.dilewati, sungguhan.data.dilewati);
  assert.equal(sungguhan.data.disimpan, 2);
});

test("alamat kembar dilaporkan sebagai EMAIL_GANDA, bukan alamat tidak sah", async () => {
  const baris = [
    ["Kode Satu", "kode@contoh.test", "PT A", "", "", ""],
    ["Kode Dua", "KODE@Contoh.TEST", "PT B", "", "", ""],
  ];
  const hasil = await unggah(await workbook(baris));
  // Alamat kembar itu sah bentuknya; yang salah adalah dipakai dua kali.
  // Layar yang bercabang pada kode ini akan menampilkan alasan yang keliru.
  assert.ok(hasil.data.issues.some((i) => i.code === "EMAIL_GANDA"));
  assert.ok(!hasil.data.issues.some((i) => i.code === "EMAIL_TIDAK_SAH"));
});

// ── Format "rich": penanda ringan, bukan HTML ────────────────────────
//
// Editor kaya menuntut huruf tebal, daftar, dan tautan. Yang TIDAK boleh ikut
// adalah markup yang datang dari luar: menempel dari Word atau dari halaman web
// membawa skrip, gaya, dan gambar pelacak.
//
// Repo ini tidak punya penyanitasi HTML, dan menulis sendiri adalah jenis kode
// yang terlihat benar sampai suatu hari tidak. Jadi jalannya dibalik: yang
// disimpan penanda ringan, dan SELURUH tag di keluaran ditulis server. Tes di
// bawah menjaga sifat itu — bukan menjaga daftar larangan.

async function pratinjauRich(body, perubahan = {}) {
  const prospek = await tambahProspek(perubahan.prospek ?? {});
  const t = await buatTemplate({ bodyHtml: body, bodyFormat: "rich" });
  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });
  assert.equal(lihat.status, 200);
  return lihat.data.bodyHtml;
}

test("tebal, miring, dan daftar jadi tag yang benar", async () => {
  const html = await pratinjauRich(
    "Ini **tebal** dan *miring*.\n\nDaftarnya:\n\n- satu\n- dua\n\n1. pertama\n2. kedua",
  );
  assert.match(html, /<strong>tebal<\/strong>/);
  assert.match(html, /<em>miring<\/em>/);
  assert.match(html, /<ul[^>]*>\s*<li>satu<\/li><li>dua<\/li><\/ul>/);
  assert.match(html, /<ol[^>]*>\s*<li>pertama<\/li><li>kedua<\/li><\/ol>/);
});

test("HTML yang ditempel TIDAK pernah jadi HTML", async () => {
  const html = await pratinjauRich(
    "Sebelum <script>alert(1)</script> sesudah <img src=x onerror=alert(1)> akhir",
  );
  // Ini inti seluruh rancangannya: masukan sudah di-escape sebelum penanda
  // diproses, jadi tidak ada satu pun tag yang bisa berasal dari pengetik.
  // Yang diuji: apakah ia pernah menjadi ELEMEN. Kata "onerror" yang muncul
  // sebagai tulisan justru bukti keberhasilan — ia tampil, tidak berjalan.
  assert.ok(!html.includes("<script>"), "tag script lolos");
  assert.ok(!/<img[^>]*onerror/i.test(html), "img dengan onerror terbentuk");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror/);
  // Sengaja TIDAK memeriksa "<img" di seluruh dokumen: kop suratnya memang
  // memuat satu <img> untuk logo, dan pemeriksaan seperti itu akan gagal
  // karena alasan yang salah.
});

test("tautan http dan mailto boleh; javascript dan data ditolak", async () => {
  const html = await pratinjauRich(
    "Situs [portofolio](https://enterprise.perumnet.id) dan [surel](mailto:it@perumnet.id).\n\n" +
      "Jahat [klik](javascript:alert(1)) dan [muat](data:text/html;base64,PHNjcmlwdD4=)",
  );
  assert.match(html, /<a href="https:\/\/enterprise\.perumnet\.id"[^>]*>portofolio<\/a>/);
  assert.match(html, /<a href="mailto:it@perumnet\.id"[^>]*>surel<\/a>/);
  // `javascript:` sudah jelas. `data:` yang lebih sering terlewat — ia bisa
  // membawa satu halaman HTML utuh di dalam sebuah tautan.
  assert.ok(!/<a[^>]+href="javascript:/i.test(html), "anchor javascript terbentuk");
  assert.ok(!/<a[^>]+href="data:/i.test(html), "anchor data terbentuk");
  // Ditolak berarti tampil sebagai tulisan, bukan hilang. Yang hilang diam-diam
  // tidak pernah diperbaiki siapa pun.
  assert.match(html, /\[klik\]/);
});

test("nilai prospek tidak bisa menyuntikkan penanda", async () => {
  const html = await pratinjauRich("Halo {{nama}}, salam.", {
    prospek: { fullName: "**Budi**" },
  });
  // Penanda diproses SEBELUM placeholder diisi. Kalau dibalik, satu nama yang
  // kebetulan memuat dua bintang akan menebalkan separuh surat — dan nama itu
  // berasal dari berkas Excel yang diserahkan pihak lain.
  assert.ok(!html.includes("<strong>Budi</strong>"), "nilai prospek jadi tag");
  assert.match(html, /\*\*Budi\*\*/);
});

test("format teks biasa tidak ikut berubah oleh penanda", async () => {
  const prospek = await tambahProspek();
  const t = await buatTemplate({ bodyHtml: "Harga **khusus** untuk Anda." });
  const lihat = await api(`/api/cms/prospect-templates/${t.data.id}/preview`, {
    method: "POST",
    body: JSON.stringify({ prospectId: prospek.data.id }),
  });
  // Template lama bawaannya "text" dan harus tetap apa adanya. Bintangnya
  // tampil sebagai bintang.
  assert.ok(!lihat.data.bodyHtml.includes("<strong>"), "format text ikut ditafsirkan");
  assert.match(lihat.data.bodyHtml, /\*\*khusus\*\*/);
});

// Bentuk DETAIL prospek harus sama di GET, POST, PATCH, dan convert.
//
// Layar detail menaruh respons PATCH langsung ke state-nya lalu merender
// `outreach.length`. Ketika PATCH memulangkan baris kontaknya saja — tanpa
// `outreach` — render meledak SESUDAH data tersimpan: pengguna melihat tabnya
// mati padahal simpanannya berhasil. Ditemukan pemilik pada 22 Agustus 2026
// saat menyunting calon klien di demo.
test("GET, POST, PATCH, dan convert memulangkan bentuk detail yang sama", async () => {
  const dibuat = await tambahProspek({ fullName: "Kontak Bentuk", companyName: "PT Bentuk Sama", location: "Denpasar" });
  assert.equal(dibuat.status, 201);
  assert.ok(Array.isArray(dibuat.data.outreach), "POST membawa riwayat outreach");

  const dibaca = await api(`/api/cms/prospects/${dibuat.data.id}`);
  assert.equal(dibaca.status, 200);
  assert.ok(Array.isArray(dibaca.data.outreach), "GET membawa riwayat outreach");

  const disunting = await api(`/api/cms/prospects/${dibuat.data.id}`, {
    method: "PATCH",
    body: JSON.stringify({ jobTitle: "Direktur" }),
  });
  assert.equal(disunting.status, 200);
  assert.equal(disunting.data.jobTitle, "Direktur");
  assert.ok(Array.isArray(disunting.data.outreach), "PATCH membawa riwayat outreach");

  // Kunci-kunci yang sama persis: satu bentuk, bukan tiga yang mirip.
  assert.deepEqual(Object.keys(disunting.data).sort(), Object.keys(dibaca.data).sort());

  const hasil = await api(`/api/cms/prospects/${dibuat.data.id}/convert`, {
    method: "POST",
    body: JSON.stringify({ status: "Aktif" }),
  });
  assert.equal(hasil.status, 201);
  assert.ok(Array.isArray(hasil.data.prospect.outreach), "convert membawa riwayat outreach");
  assert.deepEqual(Object.keys(hasil.data.prospect).sort(), Object.keys(dibaca.data).sort());
});
