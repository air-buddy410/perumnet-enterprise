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

import { createInterface } from "node:readline";
import { hash } from "bcryptjs";

const [, , email] = process.argv;
if (!email) {
  console.error("Pemakaian: node scripts/setel-akun-darurat.mjs <email>");
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

console.log(`\nMenyetel kata sandi akun darurat di ${modeDemo ? "DEMO" : "PRODUKSI"}.`);
console.log(`Akun: ${email}\n`);

let sandi;
let ulang;
try {
  sandi = await tanya("Kata sandi baru (tidak akan tampil): ", { sembunyikan: true });
  ulang = await tanya("Ketik ulang untuk memastikan: ", { sembunyikan: true });
} catch (error) {
  // Pesannya sudah ditulis untuk dibaca manusia; jejak tumpukan hanya bikin
  // orang mengira ada yang rusak.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (sandi !== ulang) {
  console.error("Tidak sama. Tidak ada yang diubah.");
  process.exit(1);
}
if (sandi.length < MIN_PANJANG) {
  console.error(`Minimal ${MIN_PANJANG} karakter — ini kunci cadangan ke seluruh aplikasi.`);
  process.exit(1);
}
if (/[\r\n\0]/.test(sandi)) {
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
  sql: "SELECT id,allow_local_login FROM users WHERE lower(email)=lower(?) LIMIT 1",
  args: [email],
});
if (!ada.rows[0]) {
  console.error(`Tidak ada akun dengan alamat ${email}.`);
  await tutup();
  process.exit(1);
}

await client.execute({
  sql: "UPDATE users SET password_hash=?,allow_local_login=1,updated_at=? WHERE id=?",
  args: [await hash(sandi, 12), new Date().toISOString(), ada.rows[0].id],
});
await tutup();

console.log(`\nSelesai. ${email} kini akun darurat dengan kata sandi yang baru kamu ketik.`);
console.log(
  "Simpan di pengelola kata sandi — ini satu-satunya jalan masuk kalau mailcow mati.",
);
