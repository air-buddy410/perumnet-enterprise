# PerumNet Enterprise

Mini ERP full-stack untuk operasional proyek IT PerumNet Enterprise. Aplikasi
mencakup dashboard proyek, BoQ, quotation dan invoice, procurement, BAST
digital, pembukuan dan rekonsiliasi rekening, serta manajemen pengguna berbasis
peran.

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

Deployment VPS direkomendasikan memakai PostgreSQL. Dokumen proyek disimpan di
volume lokal, sedangkan metadata dan seluruh data operasional disimpan di
PostgreSQL:

```bash
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/perumnet_enterprise
UPLOAD_DIR=/var/lib/perumnet-enterprise/uploads
NEXT_PUBLIC_BASE_PATH=
APP_URL=https://enterprise.perumnet.com
APP_ALLOWED_ORIGINS=https://enterprise.perumnet.id
SEED_ADMIN_PASSWORD=kata-sandi-awal-yang-kuat
```

`SEED_ADMIN_PASSWORD` hanya diperlukan saat database masih kosong dan sebaiknya
dihapus setelah akun administrator berhasil dibuat. Akun selain administrator
yang berasal dari data awal dibuat nonaktif pada production.

Lihat `.env.example` untuk konfigurasi lengkap dan email reset opsional. Schema
SQLite/libSQL Drizzle dan migration tersimpan di `server/db/schema.ts` dan
`drizzle/`; runtime PostgreSQL menjalankan schema idempotent yang sama.

Deployment serverless tetap dapat menggunakan libSQL/Turso:

```bash
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

Pada hosting Sites, adapter yang sama otomatis memakai D1 untuk data dan R2
untuk dokumen proyek melalui binding di `.openai/hosting.json`.

Template PM2, Nginx, dan backup harian PostgreSQL untuk VPS tersedia di folder
`deploy/`.

## Rekening bank dan arus kas

Admin dapat menambahkan rekening BCA atau bank lain dari modul Finance. Finance
dapat memperbarui saldo dan mutasi melalui dua jalur:

- Upload CSV bulanan. Parser menerima format BCA/generic dengan kolom tanggal,
  keterangan, mutasi atau debit/kredit, saldo, dan referensi. Impor bersifat
  idempoten; baris duplikat dilewati dan transaksi Invoice/SPK yang cocok
  dalam jendela settlement tiga hari direkonsiliasi agar tidak dihitung dua
  kali. Kasus ambigu dapat ditinjau, dicocokkan, atau dikecualikan secara
  manual dari tabel mutasi.
- Konektor API read-only. Isi `BANK_SYNC_API_URL` dan `BANK_SYNC_API_TOKEN` pada
  environment server. Credential bank tidak pernah dikirim ke browser atau
  disimpan di tabel aplikasi.

Endpoint connector menerima:

```json
{
  "accountId": "provider-account-id",
  "from": "2026-07-01",
  "to": "2026-07-27"
}
```

dan mengembalikan:

```json
{
  "balance": 125000000,
  "balanceUpdatedAt": "2026-07-27T10:30:00.000Z",
  "entries": [
    {
      "date": "2026-07-27",
      "description": "PEMBAYARAN INVOICE",
      "direction": "credit",
      "amount": 15000000,
      "balance": 125000000,
      "reference": "BANK-REFERENCE"
    }
  ]
}
```

Integrasi langsung BCA SNAP tetap memerlukan proses onboarding serta credential
resmi dari BCA. Gunakan adapter server pada `BANK_SYNC_API_URL`; jangan pernah
menaruh client secret, private key, atau access token BCA di frontend.

## Notifikasi email

Jika `RESEND_API_KEY` tersedia, aplikasi mengirim dan mencatat notifikasi untuk
pembuatan akun, perubahan akses proyek, quotation terkirim, invoice dibuat atau
dibayar, SPK dibuat/dikirim/selesai/dibayar, validasi selesai, dan BAST final.
Setiap pengguna dapat menonaktifkan notifikasi bisnis, mengirim email uji, serta
melihat status pengiriman terbaru. Email keamanan reset kata sandi tetap
dikirim terlepas dari preferensi notifikasi.

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
- Konfirmasi pembayaran Invoice membuat kas masuk; penyelesaian pekerjaan SPK
  tidak dianggap kas keluar sampai pembayaran vendor dikonfirmasi terpisah.
- Konfirmasi dan koreksi pembayaran membutuhkan izin `finance:manage`, memakai
  tanggal mutasi aktual, dan mempertahankan mutasi bank yang sudah direkonsiliasi.
- Dokumen proyek menerima JPG, PNG, WebP, atau PDF hingga 5 MB.
- Quotation, invoice, SPK, dan BAST dibuat sebagai PDF di server.
- Semua mutasi penting dicatat pada audit log.
