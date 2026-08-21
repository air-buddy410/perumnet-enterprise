// Mengisi `document_email_templates` dengan satu template contoh per jenis
// dokumen, supaya jalur kirim dokumen bisa dicoba ujung-ke-ujung sebelum layar
// pengelolanya (T-18a) selesai.
//
//   node scripts/seed-template-dokumen.mjs             # coba dulu, tidak menulis
//   node scripts/seed-template-dokumen.mjs --terapkan  # baru menulis
//
// Ini BUKAN pengganti layar pengelola. Setelah T-18a ada, template dibuat dan
// disunting dari sana; skrip ini hanya menyalakan fitur yang sudah selesai di
// backend tapi tabelnya masih kosong.
//
// Tidak ada nama atau alamat email pegawai di berkas ini. Repo
// `perumnet-enterprise` PUBLIK, dan riwayat git menyimpan apa pun yang pernah
// masuk walau berkasnya dihapus kemudian. Kolom sender_* sengaja dikosongkan —
// server sudah jatuh ke kontak perusahaan dari Pengaturan kalau kosong.

import { randomUUID } from "node:crypto";

const terapkan = process.argv.includes("--terapkan");

// Harus sama dengan documentEmailPlaceholders di shared/document-email.ts.
// Kalau daftar di sana bertambah, yang di sini ikut — template yang memakai
// placeholder di luar daftar akan merender {{...}} mentah di kotak masuk
// penerima, persis yang diperingatkan komentar skema.
const PLACEHOLDER_SAH = {
  spk: ["nomor", "vendor", "proyek", "nilai", "mulai", "selesai"],
  quotation: ["nomor", "klien", "proyek", "nilai", "berlaku_sampai"],
  invoice: ["nomor", "klien", "proyek", "nilai", "jatuh_tempo", "sisa"],
};

// Isi surat memakai format 'rich': **tebal**, *miring*, "- " daftar berbutir,
// "1. " daftar bernomor, baris kosong memisahkan paragraf. Penandanya diproses
// server (server/letter.ts), bukan dikirim sebagai HTML.
const TEMPLATE = [
  {
    documentKind: "spk",
    name: "Pengantar SPK ke vendor",
    subject: "SPK {{nomor}} — {{proyek}}",
    bodyHtml: `Kepada Yth. **{{vendor}}**,

Bersama surat ini kami sampaikan **Surat Perintah Kerja {{nomor}}** untuk pekerjaan pada proyek *{{proyek}}*, dengan rincian berikut.

- Nilai pekerjaan: **{{nilai}}**
- Mulai: {{mulai}}
- Selesai: {{selesai}}

Dokumen SPK terlampir pada surat ini. Mohon diperiksa, dan apabila seluruh isinya telah sesuai, kami menunggu konfirmasi kesediaan Saudara untuk memulai pekerjaan sesuai jadwal di atas.

Apabila terdapat hal yang perlu didiskusikan lebih dahulu, silakan balas surat ini.`,
  },
  {
    documentKind: "quotation",
    name: "Pengantar penawaran ke klien",
    subject: "Penawaran {{nomor}} — {{proyek}}",
    bodyHtml: `Kepada Yth. **{{klien}}**,

Terima kasih atas kesempatan yang diberikan kepada kami. Bersama surat ini kami sampaikan **penawaran {{nomor}}** untuk pekerjaan *{{proyek}}*.

- Nilai penawaran: **{{nilai}}**
- Berlaku sampai: {{berlaku_sampai}}

Rincian lengkapnya ada pada dokumen terlampir. Penawaran ini berlaku sampai tanggal tersebut di atas; setelah itu harga dan ketersediaan perangkat perlu kami tinjau kembali.

Kami dengan senang hati menjelaskan bagian mana pun yang masih perlu didiskusikan.`,
  },
  {
    documentKind: "invoice",
    name: "Pengantar invoice ke klien",
    subject: "Invoice {{nomor}} — {{proyek}}",
    bodyHtml: `Kepada Yth. **{{klien}}**,

Bersama surat ini kami sampaikan **invoice {{nomor}}** atas pekerjaan pada proyek *{{proyek}}*.

- Nilai invoice: **{{nilai}}**
- Sisa tagihan: **{{sisa}}**
- Jatuh tempo: {{jatuh_tempo}}

Dokumen invoice beserta rinciannya terlampir. Mohon pembayaran dilakukan selambat-lambatnya pada tanggal jatuh tempo di atas ke rekening yang tercantum di dalam dokumen.

Apabila pembayaran telah dilakukan sebelum surat ini diterima, mohon abaikan pemberitahuan ini dan kirimkan bukti transfernya kepada kami.`,
  },
];

const POLA_PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Menolak template yang memakai placeholder di luar jenis dokumennya. */
function periksaPlaceholder(t) {
  const sah = PLACEHOLDER_SAH[t.documentKind];
  const dipakai = new Set();
  for (const teks of [t.subject, t.bodyHtml]) {
    for (const cocok of teks.matchAll(POLA_PLACEHOLDER)) dipakai.add(cocok[1]);
  }
  const asing = [...dipakai].filter((p) => !sah.includes(p));
  if (asing.length) {
    throw new Error(
      `Template "${t.name}" (${t.documentKind}) memakai placeholder yang tidak berlaku: ${asing.join(", ")}.\n` +
        `Yang sah untuk ${t.documentKind}: ${sah.join(", ")}.`,
    );
  }
}

for (const t of TEMPLATE) periksaPlaceholder(t);

// Pemilihan URL mengikuti aturan aplikasi (APP_MODE=demo memakai DEMO_*),
// supaya menjalankan skrip ini dari folder rilis demo tidak pernah bisa
// menulis ke database produksi. Tanpa keduanya, jatuh ke berkas lokal —
// sama seperti server/db/client.ts.
const modeDemo = process.env.APP_MODE === "demo";
const urlPostgres = modeDemo
  ? process.env.DEMO_DATABASE_URL
  : process.env.DATABASE_URL;
const urlLibsql =
  (modeDemo ? process.env.DEMO_TURSO_DATABASE_URL : process.env.TURSO_DATABASE_URL) ||
  (modeDemo ? "file:perumnet.demo.local.db" : "file:perumnet.local.db");

const tujuan = urlPostgres
  ? `${modeDemo ? "DEMO" : "PRODUKSI"} lewat PostgreSQL`
  : `${urlLibsql} lewat libSQL`;
console.log(`\n${terapkan ? "Menulis ke" : "Membaca"} ${tujuan}.`);

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

let dibuat = 0;
let dilewati = 0;

try {
  for (const t of TEMPLATE) {
    // Idempoten: dijalankan dua kali tidak menggandakan isinya. Yang sudah
    // disunting orang juga tidak ditimpa — nama + jenis dianggap identitasnya.
    const ada = await client.execute({
      sql: `SELECT id FROM document_email_templates
            WHERE document_kind=? AND name=? AND deleted_at IS NULL LIMIT 1`,
      args: [t.documentKind, t.name],
    });
    if (ada.rows.length) {
      console.log(`  lewati  ${t.documentKind.padEnd(9)} ${t.name} (sudah ada)`);
      dilewati += 1;
      continue;
    }
    console.log(`  ${terapkan ? "buat   " : "akan   "} ${t.documentKind.padEnd(9)} ${t.name}`);
    dibuat += 1;
    if (!terapkan) continue;

    const waktu = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO document_email_templates
              (id, document_kind, name, subject, body_html, body_format,
               sender_signoff, sender_name, sender_email, sender_phone,
               language, created_by, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, 'rich', 'Hormat kami,', '', '', '', 'id', NULL, ?, ?, NULL)`,
      args: [randomUUID(), t.documentKind, t.name, t.subject, t.bodyHtml, waktu, waktu],
    });
  }
} finally {
  await tutup();
}

console.log(
  `\n${dibuat} template ${terapkan ? "dibuat" : "akan dibuat"}, ${dilewati} dilewati.` +
    (terapkan || !dibuat ? "" : "\nJalankan ulang dengan --terapkan untuk menulis."),
);
