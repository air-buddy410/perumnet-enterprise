// Login satu pintu lewat mailcow (AUTH_PROVIDER=MAILSERVER).
//
// Yang diuji di sini adalah keputusan yang paling mahal kalau salah: ketika
// mailserver tidak terjawab, login harus GAGAL — bukan diam-diam jatuh balik
// ke hash lokal. Tanpa aturan itu, mematikan mailbox seseorang tidak lagi
// berarti mencabut aksesnya, dan itu justru alasan utama memakai mailcow
// sebagai sumber identitas.
//
// Mailserver-nya sengaja dibuat TIDAK ADA: MAILSERVER_URL menunjuk 127.0.0.1,
// yang port 993-nya tertutup, jadi setiap percobaan berakhir ECONNREFUSED.
// Tidak ada mailcow sungguhan yang disentuh dan tidak ada kata sandi asli yang
// dikirim ke mana pun.

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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError ?? new Error("Server did not become ready.");
}

/** `ip` memilih ember throttle, supaya tes tidak saling menjatuhkan. */
async function masuk(email, password, ip) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password, remember: false }),
    redirect: "manual",
  });
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    code: payload?.error?.code,
    message: payload?.error?.message,
    setCookie: response.headers.get("set-cookie"),
  };
}

async function setelAkunDarurat(email, nilai) {
  const client = createClient({ url: `file:${databasePath}` });
  await client.execute({
    sql: "UPDATE users SET allow_local_login=? WHERE lower(email)=lower(?)",
    args: [nilai, email],
  });
  client.close();
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-mailserver-login-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-mailserver-login-uploads-${process.pid}-${Date.now()}`;
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
        MAIL_BRANDING_MODE: "capture",
        AUTH_PROVIDER: "MAILSERVER",
        // Port 993 di alamat ini tertutup: setiap percobaan berakhir ditolak
        // koneksi, yaitu persis keadaan "mailserver tidak bisa dihubungi".
        MAILSERVER_URL: "https://127.0.0.1",
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

test("mailserver mati → login DITOLAK walau kata sandi lokalnya benar", async () => {
  await setelAkunDarurat(ADMIN, 0);
  const hasil = await masuk(ADMIN, ADMIN_PASSWORD, "10.1.0.1");

  // Kata sandi lokalnya benar. Kalau ada jalan mundur diam-diam ke hash lokal,
  // tes ini yang menangkapnya.
  assert.equal(hasil.status, 503);
  assert.equal(hasil.code, "MAILSERVER_UNREACHABLE");
  assert.equal(hasil.setCookie, null);
});

test("pesannya tidak menuduh kata sandi salah, dan tidak membocorkan nama host", async () => {
  await setelAkunDarurat(ADMIN, 0);
  const hasil = await masuk(ADMIN, ADMIN_PASSWORD, "10.1.0.2");

  // Menyebut "kata sandi salah" saat mailserver-nya yang mati membuat orang
  // mereset kata sandi email yang sebenarnya tidak bermasalah.
  assert.match(hasil.message, /Mailserver sedang tidak bisa dihubungi/);
  assert.ok(!hasil.message.includes("127.0.0.1"));
  assert.ok(!/ECONNREFUSED/i.test(hasil.message));
});

test("akun darurat tetap bisa masuk dengan kata sandi lokal saat mailserver mati", async () => {
  await setelAkunDarurat(ADMIN, 1);
  const hasil = await masuk(ADMIN, ADMIN_PASSWORD, "10.1.0.3");

  assert.equal(hasil.status, 200);
  assert.ok(hasil.setCookie);
});

test("akun darurat dengan kata sandi lokal salah tetap ditolak", async () => {
  await setelAkunDarurat(ADMIN, 1);
  const hasil = await masuk(ADMIN, "bukan-kata-sandinya", "10.1.0.4");

  assert.equal(hasil.status, 401);
  assert.equal(hasil.code, "INVALID_CREDENTIALS");
});

test("ganti kata sandi diarahkan ke mailcow, bukan ke hash lokal", async () => {
  // Untuk bisa punya sesi tanpa mailcow hidup, akunnya dijadikan akun darurat
  // sebentar, lalu dikembalikan jadi akun biasa sambil sesinya dipegang. Yang
  // diuji adalah keputusan rutenya, bukan cara masuknya.
  await setelAkunDarurat(ADMIN, 1);
  const masukDulu = await masuk(ADMIN, ADMIN_PASSWORD, "10.1.0.6");
  assert.equal(masukDulu.status, 200);
  const cookie = masukDulu.setCookie.split(";")[0];

  await setelAkunDarurat(ADMIN, 0);
  const response = await fetch(`${baseUrl}/api/profile/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      currentPassword: ADMIN_PASSWORD,
      newPassword: "kata-sandi-baru-yang-panjang",
    }),
  });
  const payload = await response.json().catch(() => null);

  // MAILCOW_API_KEY sengaja tidak diisi di lingkungan tes: yang dibuktikan
  // adalah permintaannya BERBELOK ke mailcow. Kalau ia masih menulis ke hash
  // lokal, jawabannya 200 dan tes ini gagal — dan form ganti kata sandi akan
  // berpura-pura bekerja padahal akses orangnya tidak berubah sama sekali.
  assert.equal(response.status, 503);
  assert.equal(payload?.error?.code, "MAILCOW_NOT_CONFIGURED");

  await setelAkunDarurat(ADMIN, 1);
});

test("akun darurat tetap mengganti kata sandi LOKAL-nya, bukan mailbox", async () => {
  await setelAkunDarurat(ADMIN, 1);
  const masukDulu = await masuk(ADMIN, ADMIN_PASSWORD, "10.1.0.7");
  const cookie = masukDulu.setCookie.split(";")[0];

  const response = await fetch(`${baseUrl}/api/profile/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      currentPassword: ADMIN_PASSWORD,
      newPassword: "kata-sandi-darurat-baru",
    }),
  });

  // Justru kata sandi lokal akun darurat yang berarti — ia jalan masuk saat
  // mailserver mati. Jadi jalur ini TIDAK boleh ikut berbelok ke mailcow.
  assert.equal(response.status, 200);

  // Kembalikan supaya tes lain yang memakai kata sandi lama tetap jalan.
  const balik = await masuk(ADMIN, "kata-sandi-darurat-baru", "10.1.0.8");
  assert.equal(balik.status, 200);
});

test("alamat tanpa akun ditolak 401, tidak pernah dikirim ke mailcow", async () => {
  const hasil = await masuk("orangasing@perumnet.id", "apa-saja", "10.1.0.5");

  // 401, bukan 503: alamat yang tidak punya akun di sini tidak pernah
  // ditanyakan ke mailserver. Kalau ditanyakan, aplikasi ini berubah jadi alat
  // menebak mailbox milik orang lain.
  assert.equal(hasil.status, 401);
  assert.equal(hasil.code, "INVALID_CREDENTIALS");
});

// ── Jalur reset ditutup saat kata sandi hidup di mailcow ──────────────
//
// `reset-password` menulis `users.password_hash`, kolom yang di mode
// MAILSERVER tidak dibaca untuk akun biasa. Tanpa penjaga, orang yang
// terkunci menempuh seluruh alur, melihat "berhasil", tetap tidak bisa
// masuk, DAN kehilangan semua sesinya.

test("forgot-password ditolak 409 saat mode mailserver", async () => {
  const response = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.1.0.20" },
    body: JSON.stringify({ email: ADMIN }),
  });
  const payload = await response.json().catch(() => null);

  assert.equal(response.status, 409);
  assert.equal(payload?.error?.code, "PASSWORD_RESET_UNAVAILABLE");
  // Pesannya harus mengarahkan ke tempat kata sandinya benar-benar hidup.
  assert.match(payload?.error?.message ?? "", /kata sandi email/i);
});

test("jawaban forgot-password sama untuk alamat yang tidak terdaftar", async () => {
  const asing = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.1.0.21" },
    body: JSON.stringify({ email: "bukan-siapa-siapa@perumnet.id" }),
  });
  const payload = await asing.json().catch(() => null);

  // Penjaganya dipasang sebelum akun dicari. Kalau dipasang sesudah, jawaban
  // yang berbeda antara alamat terdaftar dan tidak akan membocorkan siapa saja
  // yang punya akun di sini.
  assert.equal(asing.status, 409);
  assert.equal(payload?.error?.code, "PASSWORD_RESET_UNAVAILABLE");
});

test("reset-password ditolak tanpa menyentuh token sama sekali", async () => {
  const response = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.1.0.22" },
    body: JSON.stringify({ token: "x".repeat(64), password: "kata-sandi-baru-1" }),
  });
  const payload = await response.json().catch(() => null);

  // 409, bukan 400 INVALID_RESET_TOKEN: penjaganya berjalan lebih dulu, jadi
  // token yang sudah terlanjur dibagikan sebelum saklar dinyalakan pun mati.
  assert.equal(response.status, 409);
  assert.equal(payload?.error?.code, "PASSWORD_RESET_UNAVAILABLE");
});

// ── Login dengan username tanpa @ ─────────────────────────────────────
//
// Pembedanya memakai fixture "mailserver mati" di berkas ini: username yang
// BERHASIL dipetakan ke akun akan menempuh jalur mailcow dan berakhir 503,
// sedangkan yang tidak dikenali berhenti di 401 tanpa pernah dikirim ke sana.

test("username tanpa @ dipetakan ke akun yang ada", async () => {
  await setelAkunDarurat(ADMIN, 0);
  const hasil = await masuk("admin", "apa-saja-yang-penting-panjang", "10.1.0.23");

  assert.equal(hasil.status, 503);
  assert.equal(hasil.code, "MAILSERVER_UNREACHABLE");
});

test("username yang tidak dikenali berhenti 401, tidak dikirim ke mailcow", async () => {
  const hasil = await masuk("tidakadaorangini", "apa-saja-yang-penting", "10.1.0.24");

  assert.equal(hasil.status, 401);
  assert.equal(hasil.code, "INVALID_CREDENTIALS");
});

test("username yang cocok ke dua akun tidak ditebak", async () => {
  const client = createClient({ url: `file:${databasePath}` });
  await client.execute({
    sql: `INSERT INTO users (id,name,email,password_hash,role,status,created_at,updated_at,allow_local_login)
          SELECT 'uji-ambigu','Kembar','admin@contoh.test',password_hash,role,status,created_at,updated_at,0
          FROM users WHERE lower(email)=lower(?)`,
    args: [ADMIN],
  });
  try {
    const hasil = await masuk("admin", "apa-saja-yang-penting", "10.1.0.25");

    // 401, bukan 503: dua akun berbagi bagian-lokal yang sama, jadi tidak ada
    // yang dipilih. Menebak di sini berarti seseorang bisa masuk ke akun orang
    // lain hanya karena username-nya kebetulan sama.
    assert.equal(hasil.status, 401);
    assert.equal(hasil.code, "INVALID_CREDENTIALS");
  } finally {
    await client.execute({ sql: "DELETE FROM users WHERE id='uji-ambigu'" });
    client.close();
  }
});

// ── GET /api/auth/mode ────────────────────────────────────────────────

test("mode terbaca tanpa masuk, tapi status darurat tidak", async () => {
  const response = await fetch(`${baseUrl}/api/auth/mode`);
  const payload = await response.json().catch(() => null);

  assert.equal(response.status, 200);
  assert.equal(payload?.data?.mode, "MAILSERVER");
  // Tanpa sesi, `allowLocalLogin` TIDAK ikut. Kalau ikut, siapa pun bisa
  // menanyakan akun mana yang jadi pintu darurat — dan itu justru akun yang
  // paling berharga untuk diserang saat mailserver dimatikan.
  assert.equal("allowLocalLogin" in (payload?.data ?? {}), false);
});

test("dengan sesi, status darurat ikut terbaca", async () => {
  await setelAkunDarurat(ADMIN, 1);
  const masukLagi = await masuk(ADMIN, "kata-sandi-darurat-baru", "10.1.0.26");
  assert.equal(masukLagi.status, 200);

  const cookie = masukLagi.setCookie?.split(";")[0] ?? "";
  const response = await fetch(`${baseUrl}/api/auth/mode`, { headers: { cookie } });
  const payload = await response.json().catch(() => null);

  assert.equal(response.status, 200);
  assert.equal(payload?.data?.mode, "MAILSERVER");
  assert.equal(payload?.data?.allowLocalLogin, true);
});
