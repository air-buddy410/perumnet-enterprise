// Aturan kata sandi harus SAMA dengan yang ditegakkan mailcow.
//
// Di mode MAILSERVER, yang benar-benar diganti orang lewat Pengaturan adalah
// kata sandi mailbox-nya di mailcow — bukan kolom di database ini. Jadi ada dua
// pihak yang berhak menolak.
//
// Kalau aplikasi lebih longgar daripada mailcow, penolakannya datang TERLAMBAT:
// kata sandi lama sudah terlanjur diverifikasi ke mailserver, orangnya sudah
// mengetik dua kali, lalu yang muncul galat mailcow yang tidak menyebut syarat
// mana yang kurang. Kalau aplikasi lebih longgar TANPA ada yang sadar, itu
// pelemahan diam-diam.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import {
  APP_PASSWORD_MIN_LENGTH,
  describePasswordPolicy,
  mergePasswordPolicy,
  passwordProblems,
} from "../shared/password-policy.ts";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";

const ADMIN = "admin@perumnet.id";
const ADMIN_PASSWORD = "perumnet123";

// ── Bagian murni: tidak perlu server ─────────────────────────────────

test("syarat mailcow yang lebih longgar TIDAK menurunkan lantai aplikasi", () => {
  // Kebijakan asli mailcow PerumNet per 2026-08-20: panjang 6, sisanya mati.
  const policy = mergePasswordPolicy({
    length: "6",
    chars: "0",
    special_chars: "0",
    lowerupper: "0",
    numbers: "0",
  });
  assert.equal(policy.minLength, APP_PASSWORD_MIN_LENGTH);
  assert.equal(policy.requireNumbers, false);
});

test("syarat mailcow yang lebih ketat MENAIKKAN syarat aplikasi", () => {
  const policy = mergePasswordPolicy({
    length: "16",
    chars: "1",
    special_chars: "1",
    lowerupper: "1",
    numbers: "1",
  });
  assert.equal(policy.minLength, 16);
  assert.equal(policy.requireNumbers, true);
  assert.equal(policy.requireSpecialChars, true);
  assert.equal(policy.requireMixedCase, true);
  assert.equal(policy.requireLetters, true);
});

test("mailcow tak terjawab jatuh ke aturan aplikasi, bukan ke tanpa aturan", () => {
  const policy = mergePasswordPolicy(null);
  assert.equal(policy.minLength, APP_PASSWORD_MIN_LENGTH);
  assert.equal(policy.source, "app");
  // Yang penting: bukan 0, dan bukan 6.
  assert.ok(policy.minLength >= APP_PASSWORD_MIN_LENGTH);
});

test("angka mailcow yang datang sebagai string tetap terbaca", () => {
  // mailcow memulangkan {"length":"6"} — string, bukan number. Number("6")
  // bekerja, tapi kalau suatu saat dibaca dengan cara yang menganggapnya sudah
  // angka, "16" bisa berakhir jadi NaN dan syaratnya hilang tanpa bunyi.
  assert.equal(mergePasswordPolicy({ length: "24" }).minLength, 24);
  assert.equal(mergePasswordPolicy({ length: 24 }).minLength, 24);
  assert.equal(mergePasswordPolicy({ length: "bukan angka" }).minLength, APP_PASSWORD_MIN_LENGTH);
});

test("semua syarat yang kurang dilaporkan sekaligus, bukan satu per satu", () => {
  const policy = mergePasswordPolicy({
    length: "12",
    numbers: "1",
    special_chars: "1",
    lowerupper: "1",
  });
  const masalah = passwordProblems("abc", policy);
  // Menyuruh orang menebak satu per satu adalah cara membuat mereka menyerah
  // dan memakai kata sandi seadanya.
  assert.ok(masalah.length >= 4, `hanya ${masalah.length} syarat dilaporkan`);
  assert.ok(masalah.some((m) => m.includes("12 karakter")));
  assert.ok(masalah.some((m) => m.includes("angka")));
  assert.ok(masalah.some((m) => m.includes("spesial")));
});

test("kata sandi yang memenuhi syarat tidak melaporkan masalah apa pun", () => {
  const policy = mergePasswordPolicy({ length: "12", numbers: "1", lowerupper: "1" });
  assert.deepEqual(passwordProblems("Rahasia2026aman", policy), []);
});

test("kalimat syaratnya bisa dibaca orang, bukan daftar bidang", () => {
  const kalimat = describePasswordPolicy(
    mergePasswordPolicy({ length: "12", numbers: "1" }),
  );
  assert.match(kalimat, /^Kata sandi harus /);
  assert.match(kalimat, /12 karakter/);
  assert.match(kalimat, /angka/);
  assert.match(kalimat, /\.$/);
});

// ── Bagian yang menyentuh server ─────────────────────────────────────

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
  return {
    status: response.status,
    data: payload?.data,
    code: payload?.error?.code,
    message: payload?.error?.message,
    details: payload?.error?.details,
  };
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-kata-sandi-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-kata-sandi-uploads-${process.pid}-${Date.now()}`;
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

test("syaratnya bisa ditanyakan sebelum orang mengetik, bukan dihukum sesudahnya", async () => {
  const lihat = await api("/api/auth/password-policy");
  assert.equal(lihat.status, 200);
  assert.equal(typeof lihat.data.policy.minLength, "number");
  assert.ok(lihat.data.policy.minLength >= APP_PASSWORD_MIN_LENGTH);
  assert.match(lihat.data.description, /Kata sandi harus /);
});

test("kata sandi baru yang terlalu pendek ditolak, dan tidak ada yang berubah", async () => {
  const ganti = await api("/api/profile/password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: "pendek" }),
  });

  // 422 dari skema, bukan 400 dari pemeriksaan kebijakan: lantai aplikasi
  // (APP_PASSWORD_MIN_LENGTH) sudah ada di skema Zod dan menangkapnya lebih
  // dulu. Keduanya benar — yang penting ia ditolak SEBELUM apa pun dikirim ke
  // mailserver.
  //
  // Cabang 400 PASSWORD_TOO_WEAK hanya bisa dicapai kalau mailcow menuntut
  // LEBIH dari lantai aplikasi. Di lingkungan tes mode-nya LOCAL dan tidak ada
  // mailcow, jadi logika penggabungan dan pelaporannya diuji sebagai fungsi
  // murni di atas — bukan dipura-purakan lewat HTTP.
  assert.ok(ganti.status >= 400 && ganti.status < 500, `status tak terduga: ${ganti.status}`);

  // Kata sandi lama harus tetap berlaku.
  const masuk = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: ADMIN_PASSWORD, remember: false }),
    redirect: "manual",
  });
  assert.equal(masuk.status, 200, "kata sandi lama ikut rusak oleh permintaan yang ditolak");
});
