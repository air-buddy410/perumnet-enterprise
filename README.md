# PerumNet Enterprise

Mini ERP full-stack untuk operasional proyek IT PerumNet Enterprise. Aplikasi
mencakup dashboard proyek, BoQ, quotation dan invoice, procurement, BAST
digital, pembukuan, serta manajemen pengguna berbasis peran.

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`, lalu gunakan akun demo yang sudah terisi pada
halaman login.

Database SQLite lokal `perumnet.local.db` dibuat dan di-seed otomatis saat API
pertama kali dipanggil. Akun demo:

- Email: `admin@perumnet.id`
- Kata sandi: `perumnet123`

## Database production

Deployment serverless menggunakan libSQL/Turso agar tetap kompatibel dengan
SQLite dan persisten:

```bash
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
APP_URL=https://domain-aplikasi
```

Lihat `.env.example` untuk konfigurasi email reset opsional. Schema Drizzle dan
migration tersimpan di `server/db/schema.ts` dan `drizzle/`.

Pada hosting Sites, adapter yang sama otomatis memakai D1 untuk data dan R2
untuk dokumen proyek melalui binding di `.openai/hosting.json`.

## Verifikasi

```bash
npm run lint
npm test
npm run build
```

`npm test` menjalankan integrasi end-to-end dengan database terisolasi:
autentikasi, RBAC, CRUD modul, kalkulasi keuangan, audit log, dan PDF.

## Backend

- Sesi disimpan sebagai token acak yang di-hash; cookie memakai HttpOnly,
  SameSite, dan Secure di production.
- Kata sandi di-hash dengan bcrypt dan reset token berlaku 30 menit.
- RBAC: Admin, Project Manager, Engineer, dan Finance.
- Validasi request menggunakan Zod dengan respons error terstruktur.
- Progress proyek dihitung dari tugas dan status pembayaran dihitung dari
  invoice.
- Konfirmasi pembayaran otomatis membuat transaksi pemasukan.
- Dokumen proyek menerima JPG, PNG, WebP, atau PDF hingga 5 MB.
- Quotation, invoice, SPK, dan BAST dibuat sebagai PDF di server.
- Semua mutasi penting dicatat pada audit log.
