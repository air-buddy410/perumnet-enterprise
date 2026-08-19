# Skema database

`initialize.ts` **adalah** sumber kebenaran skema. Tidak ada ORM, tidak ada file
migrasi terpisah, dan tidak ada langkah migrasi manual.

## Cara kerjanya

`getDatabase()` memanggil `initialize.ts` sekali per proses. Fungsi itu
menjalankan seluruh `schemaSql` (semuanya `CREATE TABLE IF NOT EXISTS` /
`CREATE INDEX IF NOT EXISTS`) lalu serangkaian langkah backfill idempoten.
Artinya migrasi berjalan otomatis **setiap kali proses dimulai**, baik di
libSQL/SQLite (dev & test) maupun PostgreSQL (demo & produksi).

Konsekuensinya: deploy = restart PM2 = migrasi. Tidak ada perintah terpisah yang
bisa lupa dijalankan.

## Menambah kolom — jangan sampai salah

Menambahkan kolom ke `CREATE TABLE` **tidak cukup**. Tabel yang sudah ada tidak
akan pernah dibuat ulang, jadi database lama tidak akan pernah mendapat kolom
itu dan query akan gagal di produksi meski lolos di mesin lokal yang databasenya
baru.

Selalu dua langkah:

1. Tambahkan kolom di `schemaSql` (untuk instalasi baru).
2. Tambahkan `ensureColumn(...)` yang sesuai (untuk instalasi yang sudah jalan).

Pola yang sama berlaku untuk indeks dan untuk perubahan `CHECK` — lihat
`ensureBastVoidStatus` sebagai contoh cara melonggarkan constraint pada tabel
yang sudah berisi data tanpa kehilangan baris atau indeks.

## Kenapa tidak ada Drizzle

Repo ini pernah membawa `server/db/schema.ts` (definisi Drizzle) plus
`drizzle.config.ts` dan folder `drizzle/`. Semuanya **kode mati** — tidak ada
satu pun modul aplikasi yang mengimpornya; setiap query berjalan lewat SQL
mentah di `DatabaseClient`. Karena `tsconfig.json` juga mengecualikan file-file
itu, mereka tidak pernah dicek tipe dan diam-diam melenceng dari kenyataan:
mendeklarasikan kolom yang tidak ada di database mana pun sekaligus melewatkan
kolom yang benar-benar hidup.

Yang berbahaya bukan file matinya, melainkan `npm run db:migrate` yang masih
terdaftar di `package.json`. Audit membuktikan perintah itu, jika dijalankan ke
produksi, akan **menghapus dua kolom** dan membuat 29 indeks duplikat — dan
config-nya juga salah dialek (`sqlite`, sedangkan produksi PostgreSQL).

Seluruh perangkat itu dihapus. Kalau suatu saat ORM benar-benar dibutuhkan,
adopsi secara sadar dan buat ia jadi sumber kebenaran — jangan biarkan hidup
berdampingan dengan `initialize.ts` sebagai dokumentasi kedua yang tidak
tersinkron.
