// Mendaftarkan akun tim ke tabel `users` untuk login satu pintu mailcow.
//
// Daftar orangnya TIDAK disimpan di repo ini. Repo `perumnet-enterprise`
// bersifat PUBLIK di GitHub; menaruh nama dan alamat email pegawai di dalamnya
// berarti menerbitkannya ke internet, dan riwayat git menyimpannya walau
// berkasnya dihapus kemudian. Jadi daftarnya dibaca dari luar:
//
//   node scripts/seed-akun-tim.mjs ../AKUN-TIM.md            # coba dulu
//   node scripts/seed-akun-tim.mjs ../AKUN-TIM.md --terapkan # baru menulis
//
// Berkas sumbernya berisi tabel markdown; yang dibaca hanya baris dengan
// alamat email dan peran di bagian aplikasi ini.
//
// Akun yang dibuat di mode mailserver TIDAK punya kata sandi lokal yang bisa
// dipakai: kolomnya diisi hash yang tidak cocok dengan apa pun. Satu-satunya
// kata sandi yang berlaku adalah kata sandi email di mailcow.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const [, , berkas, ...bendera] = process.argv;
const terapkan = bendera.includes("--terapkan");

if (!berkas) {
  console.error(
    "Pemakaian: node scripts/seed-akun-tim.mjs <berkas-daftar.md> [--terapkan]",
  );
  process.exit(1);
}

// Nothing hashes to this. Akun mailserver memang tidak boleh punya kata sandi
// lokal yang bisa dipakai — pola yang sama dengan ABSENT_ACCOUNT_PASSWORD_HASH
// di server/auth.ts.
const HASH_TIDAK_TERPAKAI =
  "$2b$12$hrZ1mh6YKsTSNlHAQsAzy.gvJYs4rUXP2sAoADK/jNt00Im9gQXWq";

const PERAN_SAH = ["Admin", "Project Manager", "Engineer", "Finance"];

/** Akun darurat: tetap boleh masuk dengan kata sandi lokal saat mailcow mati. */
const AKUN_DARURAT = "admin@perumnet.id";

function bacaDaftar(path) {
  const teks = readFileSync(path, "utf8");
  // Ambil hanya bagian "## Enterprise" sampai judul "##" berikutnya.
  const bagian = teks.split(/^## /m).find((b) => b.startsWith("Enterprise"));
  if (!bagian) {
    throw new Error(`Bagian "## Enterprise" tidak ditemukan di ${path}`);
  }

  const akun = [];
  for (const baris of bagian.split("\n")) {
    const kolom = baris.split("|").map((k) => k.trim());
    if (kolom.length < 4) continue;
    const email = kolom[1].toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    // Kolom terakhir memuat peran kode, mis. "`Admin` — **akun darurat**".
    const peran = PERAN_SAH.find((p) => kolom[3].includes(`\`${p}\``));
    if (!peran) {
      throw new Error(`Peran tidak dikenali untuk ${email}: ${kolom[3]}`);
    }
    akun.push({ email, peran, nama: namaDariEmail(email) });
  }
  if (akun.length === 0) throw new Error("Tidak ada akun terbaca.");
  return akun;
}

/** "nama_belakang@contoh.id" → "Nama Belakang". Bisa diperbaiki lewat UI. */
function namaDariEmail(email) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join(" ");
}

const akun = bacaDaftar(berkas);
console.log(`Terbaca ${akun.length} akun dari ${berkas}:\n`);
for (const a of akun) {
  const tanda = a.email === AKUN_DARURAT ? "  ← akun darurat" : "";
  console.log(`  ${a.email.padEnd(34)} ${a.peran.padEnd(16)} ${a.nama}${tanda}`);
}

if (!terapkan) {
  console.log(
    "\nBelum ada yang ditulis. Tambahkan --terapkan untuk benar-benar menyimpan.",
  );
  process.exit(0);
}

// Bicara langsung ke database, TIDAK lewat server/db/client.ts: berkas itu
// mengimpor `server-only`, yang memang tugasnya menolak dijalankan di luar
// Next — jadi skrip baris perintah tidak akan pernah bisa memakainya.
//
// Pemilihan URL-nya mengikuti aturan yang sama dengan aplikasi (APP_MODE=demo
// memakai DEMO_*), supaya menjalankan skrip ini dari folder rilis demo tidak
// pernah bisa menulis ke database produksi.
const modeDemo = process.env.APP_MODE === "demo";
const urlPostgres = modeDemo
  ? process.env.DEMO_DATABASE_URL
  : process.env.DATABASE_URL;
const urlLibsql = modeDemo
  ? process.env.DEMO_TURSO_DATABASE_URL
  : process.env.TURSO_DATABASE_URL;

if (!urlPostgres && !urlLibsql) {
  console.error(
    `Database belum ditunjuk. Sumber env yang dipakai: ${
      modeDemo ? "DEMO_DATABASE_URL / DEMO_TURSO_DATABASE_URL" : "DATABASE_URL / TURSO_DATABASE_URL"
    }.\nJalankan dari folder rilis dengan .env.production di-source lebih dulu.`,
  );
  process.exit(1);
}

console.log(
  `\nMenulis ke ${modeDemo ? "DEMO" : "PRODUKSI"} lewat ${urlPostgres ? "PostgreSQL" : "libSQL"}.`,
);

/** `?` → `$1`, sama seperti postgresQuery() di server/db/client.ts. */
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
const sekarang = new Date().toISOString();
let dibuat = 0;
let diperbarui = 0;

for (const a of akun) {
  const ada = await client.execute({
    sql: "SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1",
    args: [a.email],
  });
  const darurat = a.email === AKUN_DARURAT ? 1 : 0;

  if (ada.rows[0]) {
    // Kata sandi yang sudah ada TIDAK disentuh: akun darurat yang sudah punya
    // kata sandi kerja tidak boleh kehilangan jalan masuknya karena skrip ini.
    await client.execute({
      sql: "UPDATE users SET role=?,allow_local_login=?,updated_at=? WHERE id=?",
      args: [a.peran, darurat, sekarang, ada.rows[0].id],
    });
    diperbarui += 1;
    continue;
  }

  await client.execute({
    sql: `INSERT INTO users (id,name,email,password_hash,role,status,allow_local_login,created_at,updated_at)
          VALUES (?,?,?,?,?,'Aktif',?,?,?)`,
    args: [
      randomUUID(),
      a.nama,
      a.email,
      HASH_TIDAK_TERPAKAI,
      a.peran,
      darurat,
      sekarang,
      sekarang,
    ],
  });
  dibuat += 1;
}

await tutup();

console.log(`\nSelesai: ${dibuat} dibuat, ${diperbarui} diperbarui.`);
if (akun.some((a) => a.email === AKUN_DARURAT)) {
  console.log(
    `\nPERHATIAN: ${AKUN_DARURAT} ditandai akun darurat tapi belum tentu punya
kata sandi lokal yang bisa dipakai. Setel kata sandinya lewat alur reset
sebelum AUTH_PROVIDER=MAILSERVER dinyalakan — kalau tidak, mailserver yang
mati berarti tidak ada jalan masuk sama sekali.`,
  );
}
