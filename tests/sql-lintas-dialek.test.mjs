// Konstruksi SQL yang berperilaku BERBEDA antara SQLite dan PostgreSQL.
//
// Seluruh tes di repo ini berjalan di atas libSQL/SQLite, sedangkan demo dan
// produksi berjalan di atas PostgreSQL. Artinya ada satu kelas kesalahan yang
// tidak bisa ditangkap satu pun tes lain: SQL yang sah di SQLite, lulus 307
// tes, lalu ditolak server begitu naik.
//
// Itu bukan kekhawatiran teoretis. Pada 21 Agustus 2026 kueri
//
//   AND (? IS NULL OR q.scope_id=?)
//
// masuk ke jalur GET /api/quotations. SQLite menerimanya; PostgreSQL menolak
// dengan 42P18 "could not determine data type of parameter", karena parameter
// telanjang di posisi IS NULL tidak punya tipe yang bisa disimpulkan. Layar
// Quotation memuat lima permintaan sekaligus lewat Promise.all, jadi satu yang
// gagal membuat SELURUH layar kosong: quotationnya terlihat "hilang".
//
// Syarat opsional dirakit di JavaScript, bukan dititipkan ke SQL.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

function berkasTs(direktori) {
  const hasil = [];
  for (const nama of readdirSync(direktori)) {
    const jalur = join(direktori, nama);
    if (statSync(jalur).isDirectory()) {
      hasil.push(...berkasTs(jalur));
    } else if (nama.endsWith(".ts") || nama.endsWith(".mjs")) {
      hasil.push(jalur);
    }
  }
  return hasil;
}

test("tidak ada parameter telanjang di dalam uji IS NULL", () => {
  // fileURLToPath, bukan .pathname: direktori kerja ini mengandung spasi dan
  // .pathname memulangkannya sebagai %20.
  const akar = fileURLToPath(new URL("../server", import.meta.url));
  const pelanggaran = [];
  for (const berkas of berkasTs(akar)) {
    const isi = readFileSync(berkas, "utf8");
    isi.split("\n").forEach((baris, index) => {
      // Baris komentar memang menyebut polanya untuk menjelaskan; yang dilarang
      // adalah pemakaiannya di dalam SQL.
      const bersih = baris.trim();
      if (bersih.startsWith("//") || bersih.startsWith("*")) return;
      if (/\?\s+IS\s+(NOT\s+)?NULL/i.test(baris)) {
        pelanggaran.push(`${berkas.replace(akar, "server")}:${index + 1}: ${bersih}`);
      }
    });
  }
  assert.deepEqual(
    pelanggaran,
    [],
    `PostgreSQL menolak parameter telanjang di posisi IS NULL (42P18).\n` +
      `Rakit syaratnya di JavaScript:\n` +
      `  sql: \`... \${nilai ? "AND kolom=?" : ""} ...\`,\n` +
      `  args: nilai ? [...lain, nilai] : [...lain],\n\n` +
      pelanggaran.join("\n"),
  );
});
