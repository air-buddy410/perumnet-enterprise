#!/usr/bin/env node
// Mengimpor workbook calon klien ke instance PerumNet Enterprise yang sedang
// jalan.
//
//   node scripts/import-prospects.mjs --file "…/Data Clients Enterprise.xlsx" --dry-run
//   node scripts/import-prospects.mjs --file "…/Data Clients Enterprise.xlsx" \
//     --base-url https://enterprise.perumnet.id --source "berkas dari pemilik, 19 Agu"
//
// Skrip ini TIDAK bicara ke database. Ia masuk sebagai admin lalu mengunggah
// berkas ke POST /api/cms/prospects/import — endpoint yang sama dengan tombol
// impor di layar. Aturan tentang kontak seperti apa yang sah hidup di server
// dan tidak boleh ada duanya.
//
// Kredensial dari PROSPECT_ADMIN_EMAIL / PROSPECT_ADMIN_PASSWORD, atau
// --email / --password. Kata sandi lewat argumen terlihat di `ps`; pakai env
// kalau mesinnya dipakai bersama.
//
// Jalankan --dry-run lebih dulu. Ia melaporkan apa yang akan tersimpan dan
// baris mana yang bermasalah, tanpa menulis apa pun.

import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

function parseArguments(argv) {
  const options = {
    file: "",
    baseUrl: process.env.PROSPECT_BASE_URL ?? "http://127.0.0.1:3000",
    email: process.env.PROSPECT_ADMIN_EMAIL ?? "",
    password: process.env.PROSPECT_ADMIN_PASSWORD ?? "",
    source: "",
    dryRun: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--file") { options.file = value; index += 1; }
    else if (flag === "--base-url") { options.baseUrl = value; index += 1; }
    else if (flag === "--email") { options.email = value; index += 1; }
    else if (flag === "--password") { options.password = value; index += 1; }
    else if (flag === "--source") { options.source = value; index += 1; }
    else if (flag === "--dry-run") { options.dryRun = true; }
    else {
      console.error(`Argumen tidak dikenal: ${flag}`);
      process.exit(1);
    }
  }
  return options;
}

const options = parseArguments(process.argv);
if (!options.file || !options.email) {
  console.error(
    "Pemakaian: node scripts/import-prospects.mjs --file <berkas.xlsx> [--dry-run]\n" +
      "           [--base-url <url>] [--source <asal kontak>] [--email <alamat>]\n\n" +
      "Alamat admin dari PROSPECT_ADMIN_EMAIL atau --email.\n" +
      "Kata sandi ditanyakan kalau tidak diisi lewat PROSPECT_ADMIN_PASSWORD.",
  );
  process.exit(1);
}

/**
 * Kata sandi ditanyakan di sini kalau belum ada, bukan diminta lewat argumen:
 * argumen perintah terlihat di `ps` dan tersimpan di riwayat shell. Yang
 * diketik di prompt ini tidak lewat keduanya.
 */
if (!options.password) {
  if (!process.stdin.isTTY) {
    console.error(
      "Butuh terminal sungguhan untuk mengetik kata sandi tanpa menampilkannya.\n" +
        "Jalankan langsung di terminal, atau isi PROSPECT_ADMIN_PASSWORD.",
    );
    process.exit(1);
  }
  options.password = await new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const tanya = `Kata sandi ${options.email} (tidak akan tampil): `;
    rl._writeToOutput = (chunk) => {
      if (chunk.includes(tanya)) rl.output.write(tanya);
    };
    rl.question(tanya, (jawaban) => {
      rl.close();
      process.stdout.write("\n");
      resolve(jawaban);
    });
  });
  if (!options.password) {
    console.error("Kata sandi kosong. Tidak ada yang dikerjakan.");
    process.exit(1);
  }
}

const isi = await readFile(options.file);
const nama = basename(options.file);

const masuk = await fetch(`${options.baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: options.email,
    password: options.password,
    remember: false,
  }),
  redirect: "manual",
});
if (masuk.status !== 200) {
  const galat = await masuk.json().catch(() => null);
  console.error(`Gagal masuk (${masuk.status}): ${galat?.error?.message ?? "tanpa keterangan"}`);
  process.exit(1);
}
const cookie = masuk.headers.get("set-cookie")?.split(";")[0] ?? "";

const form = new FormData();
form.set("file", new Blob([isi]), nama);
form.set("source", options.source || `berkas ${nama}`);
if (options.dryRun) form.set("dryRun", "1");

const unggah = await fetch(`${options.baseUrl}/api/cms/prospects/import`, {
  method: "POST",
  headers: { cookie },
  body: form,
});
const jawaban = await unggah.json().catch(() => null);

if (unggah.status !== 200) {
  console.error(`Impor ditolak (${unggah.status}): ${jawaban?.error?.message ?? "tanpa keterangan"}`);
  for (const m of jawaban?.error?.details?.issues ?? []) {
    console.error(`  ${m.detail}`);
  }
  process.exit(1);
}

const d = jawaban.data;
console.log(`\nLembar    : ${d.sheets.join(", ")}`);
console.log(`Terbaca   : ${d.terbaca} kontak`);
console.log(`${d.dryRun ? "Akan disimpan" : "Disimpan"} : ${d.disimpan}`);
console.log(`Dilewati  : ${d.dilewati}`);

if (d.issues.length) {
  console.log(`\n${d.issues.length} baris perlu diperiksa:`);
  for (const m of d.issues) console.log(`  [${m.code}]  ${m.detail}`);
} else {
  console.log("\nTidak ada baris bermasalah.");
}

if (d.dryRun) {
  console.log("\nIni percobaan kering — tidak ada yang tersimpan.");
  console.log("Jalankan ulang tanpa --dry-run kalau laporannya sudah benar.");
}
