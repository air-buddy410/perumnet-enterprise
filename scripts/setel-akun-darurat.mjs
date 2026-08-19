// Menyetel kata sandi akun darurat (users.allow_local_login = 1).
//
// Akun darurat adalah satu-satunya jalan masuk ketika mailcow mati. Kalau
// kata sandinya tidak diketahui siapa pun, pintu kebakarannya terkunci — dan
// itu baru ketahuan persis pada saat paling buruk.
//
// Kata sandinya diketik LANGSUNG oleh kamu di terminal ini. Ia tidak pernah
// lewat argumen perintah (yang terlihat di `ps`), tidak masuk riwayat shell,
// tidak dicetak ke layar, dan tidak dikirim ke mana pun. Yang tersimpan di
// database hanya hash bcrypt-nya.
//
//   cd <folder rilis>
//   set -a && . ./.env.production && set +a
//   node scripts/setel-akun-darurat.mjs admin@perumnet.id
//
// Di host tanpa TTY (pipa, skrip deploy) prompt tersembunyi tidak bisa
// dipakai. Untuk itu ada `--dari-berkas <path>`: baris pertama berkas dibaca
// sebagai kata sandi, lalu BERKASNYA LANGSUNG DIHAPUS. Ia tetap tidak lewat
// argumen perintah. Batas panjang dan penolakan CR/LF tetap berlaku; yang
// dilewati hanya konfirmasi ketik-ulang.

import { createInterface } from "node:readline";
import { readFileSync, unlinkSync } from "node:fs";
import { hash } from "bcryptjs";

const [, , email, ...bendera] = process.argv;
const hanyaPeriksa = bendera.includes("--periksa");
const berkasSandi = (() => {
  const i = bendera.indexOf("--dari-berkas");
  return i >= 0 ? bendera[i + 1] : null;
})();
if (!email) {
  console.error(
    "Pemakaian: node scripts/setel-akun-darurat.mjs <email> [--periksa] [--dari-berkas <path>]",
  );
  process.exit(1);
}

// Kata sandi akun darurat lebih panjang dari minimum biasa DENGAN SENGAJA: ia
// tidak dipakai sehari-hari, jadi tidak ada alasan memilih yang mudah diketik,
// dan ia satu-satunya penjaga saat semua jalur lain mati.
const MIN_PANJANG = 12;

function tanya(pertanyaan, { sembunyikan = false } = {}) {
  return new Promise((resolve, reject) => {
    if (sembunyikan && !process.stdin.isTTY) {
      reject(
        new Error(
          "Butuh terminal sungguhan untuk mengetik kata sandi tanpa menampilkannya.\n" +
            "Jalankan langsung di terminal, jangan lewat pipa atau skrip lain.",
        ),
      );
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (sembunyikan) {
      // Tulis ulang prompt tanpa gema karakternya.
      rl._writeToOutput = (chunk) => {
        if (chunk.includes(pertanyaan)) rl.output.write(pertanyaan);
      };
    }
    rl.question(pertanyaan, (jawaban) => {
      rl.close();
      if (sembunyikan) process.stdout.write("\n");
      resolve(jawaban);
    });
  });
}

/**
 * Jalur tanpa TTY: kata sandi dibaca dari berkas, lalu berkasnya DIHAPUS.
 *
 * Ada karena tidak semua terminal menyediakan TTY — panel web, tempelan
 * perintah, dan sebagian klien SSH tidak. Tanpa jalur ini skrip berhenti di
 * pemeriksaan TTY dengan pesan yang mudah terlewat, dan orang mengira kata
 * sandinya sudah tersetel padahal belum.
 *
 * Tetap tidak lewat argumen perintah (yang terlihat di `ps`) dan tidak masuk
 * riwayat shell, asalkan berkasnya dibuat dengan editor, bukan dengan `echo`.
 */
function dariBerkas(path) {
  const isi = readFileSync(path, "utf8").split("\n")[0].trim();
  try {
    unlinkSync(path);
  } catch {
    /* berkas sudah hilang */
  }
  if (!isi) throw new Error(`Berkas ${path} kosong.`);
  return isi;
}

const modeDemo = process.env.APP_MODE === "demo";
const urlPostgres = modeDemo ? process.env.DEMO_DATABASE_URL : process.env.DATABASE_URL;
const urlLibsql = modeDemo
  ? process.env.DEMO_TURSO_DATABASE_URL
  : process.env.TURSO_DATABASE_URL;

if (!urlPostgres && !urlLibsql) {
  console.error(
    "Database belum ditunjuk. Jalankan dari folder rilis dengan .env.production di-source lebih dulu.",
  );
  process.exit(1);
}

// Banner ini sempat selalu berbunyi "Menyetel" — termasuk saat --periksa,
// yang tidak mengubah apa pun. Orang membacanya sebagai bukti kata sandinya
// sudah tersimpan, padahal belum.
console.log(
  `\n${hanyaPeriksa ? "Memeriksa" : "Menyetel"} kata sandi akun darurat di ${modeDemo ? "DEMO" : "PRODUKSI"}.`,
);
console.log(`Akun: ${email}\n`);

let sandi;
let ulang;
if (berkasSandi) {
  sandi = ulang = dariBerkas(berkasSandi);
} else if (!hanyaPeriksa) try {
  sandi = await tanya("Kata sandi baru (tidak akan tampil): ", { sembunyikan: true });
  ulang = await tanya("Ketik ulang untuk memastikan: ", { sembunyikan: true });
} catch (error) {
  // Pesannya sudah ditulis untuk dibaca manusia; jejak tumpukan hanya bikin
  // orang mengira ada yang rusak.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!hanyaPeriksa && sandi !== ulang) {
  console.error("Tidak sama. Tidak ada yang diubah.");
  process.exit(1);
}
if (!hanyaPeriksa && sandi.length < MIN_PANJANG) {
  console.error(`Minimal ${MIN_PANJANG} karakter — ini kunci cadangan ke seluruh aplikasi.`);
  process.exit(1);
}
if (!hanyaPeriksa && /[\r\n\0]/.test(sandi)) {
  console.error("Kata sandi memuat karakter yang tidak diizinkan.");
  process.exit(1);
}

function kueriPostgres(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

let client;
let tutup = async () => {};
if (urlPostgres) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: urlPostgres });
  client = {
    execute: async ({ sql, args = [] }) => ({
      rows: (await pool.query(kueriPostgres(sql), args)).rows,
    }),
  };
  tutup = () => pool.end();
} else {
  const { createClient } = await import("@libsql/client");
  const libsql = createClient({ url: urlLibsql });
  client = { execute: (stmt) => libsql.execute(stmt) };
  tutup = async () => libsql.close();
}

const ada = await client.execute({
  sql: "SELECT id,allow_local_login,password_hash,updated_at FROM users WHERE lower(email)=lower(?) LIMIT 1",
  args: [email],
});
if (!ada.rows[0]) {
  console.error(`Tidak ada akun dengan alamat ${email}.`);
  await tutup();
  process.exit(1);
}

if (hanyaPeriksa) {
  // Tanpa tahu kata sandinya, yang bisa dijawab cuma dua: apakah barisnya
  // ditandai darurat, dan kapan terakhir ditulis. `terakhir ditulis` yang
  // masih sama dengan waktu seed berarti kata sandinya belum pernah disetel
  // di sini — dan itu artinya pintu daruratnya belum benar-benar ada.
  console.log(`allow_local_login : ${ada.rows[0].allow_local_login}`);
  console.log(`terakhir ditulis  : ${ada.rows[0].updated_at ?? "-"}`);
  await tutup();
  process.exit(0);
}

const sebelum = String(ada.rows[0].password_hash);
await client.execute({
  sql: "UPDATE users SET password_hash=?,allow_local_login=1,updated_at=? WHERE id=?",
  args: [await hash(sandi, 12), new Date().toISOString(), ada.rows[0].id],
});

// Membuktikan sendiri, bukan menganggap berhasil: baca ulang barisnya dan
// cocokkan dengan kata sandi yang barusan diketik. Empat percobaan sebelumnya
// gagal tanpa disadari karena skrip ini berhenti di penjaga tanpa menulis.
const sesudah = await client.execute({
  sql: "SELECT password_hash,updated_at FROM users WHERE id=?",
  args: [ada.rows[0].id],
});
const { compare } = await import("bcryptjs");
const cocok = await compare(sandi, String(sesudah.rows[0].password_hash));
const berubah = String(sesudah.rows[0].password_hash) !== sebelum;
await tutup();

if (!cocok || !berubah) {
  console.error("\nGAGAL: kata sandi tidak tersimpan. Tidak ada yang berubah.");
  process.exit(1);
}

console.log(`\n✓ TERBUKTI TERSIMPAN — dibaca ulang dari database dan cocok.`);
console.log(`  akun    : ${email}`);
console.log(`  ditulis : ${sesudah.rows[0].updated_at}`);
console.log(
  "\nSimpan di pengelola kata sandi — ini satu-satunya jalan masuk kalau mailcow mati.",
);
