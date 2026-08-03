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

Buka `http://localhost:3000`, lalu gunakan akun pengembangan berikut.

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

## Mode demo terisolasi

Jangan membuat akun demo pada database live. Jalankan instance kedua dengan
database terpisah:

```bash
APP_MODE=demo
NEXT_PUBLIC_DEMO_MODE=true
DEMO_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/perumnet_enterprise_demo
DEMO_ACCOUNT_PASSWORD=kata-sandi-demo-yang-berbeda
```

Saat database demo masih kosong, aplikasi membuat
`demo@perumnet.id` sebagai Admin demo. Startup akan ditolak apabila
`DEMO_DATABASE_URL` sama dengan `DATABASE_URL`. Email keluar juga otomatis
dinonaktifkan pada mode demo. Gunakan process/container dan domain demo sendiri
agar cache build `NEXT_PUBLIC_DEMO_MODE` tidak bercampur dengan aplikasi live.

## Rekening bank dan arus kas

Admin dapat menambahkan rekening BCA atau bank lain dari modul Finance. Finance
dapat memperbarui saldo dan mutasi melalui dua jalur:

- Upload PDF atau CSV bulanan. PDF e-statement BCA yang memiliki teks dapat
  dibaca langsung, termasuk detail transfer multi-baris, penanda debit/kredit,
  saldo akhir, periode, dan verifikasi empat digit terakhir nomor rekening.
  PDF hasil scan/foto tidak diproses tanpa OCR. Parser CSV menerima format
  BCA/generic dengan kolom tanggal, keterangan, mutasi atau debit/kredit, saldo,
  dan referensi. Impor bersifat idempoten; baris duplikat dilewati dan
  transaksi Invoice/SPK yang cocok dalam jendela settlement tiga hari
  direkonsiliasi agar tidak dihitung dua kali. Kasus ambigu dapat ditinjau,
  dicocokkan, atau dikecualikan secara manual dari tabel mutasi.
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

Hanya Admin dapat menghapus mutasi rekening. Finance tetap dapat mengimpor,
mencocokkan, mengecualikan, dan mengembalikan mutasi, tetapi tidak memiliki
endpoint atau tombol hapus. Setiap penghapusan Admin masuk ke audit log.

Bonus pegawai dan fee pemberi kerja dicatat sebagai biaya proyek. Pembagian
keuntungan menggunakan alur Draft, persetujuan Admin, lalu pembayaran oleh
Admin/Finance. Persentase total dibatasi 100%, jumlah penerima tidak dibatasi
empat orang, dan pembayaran baru masuk arus kas setelah status Paid. Laba yang
boleh dibagikan juga dikurangi komitmen vendor aktif yang belum dibayar.

## Procurement berbasis BoQ

Alur procurement kanonis adalah:

`BoQ Original/Addendum → Quotation Accepted → SPK/PO → termin atau penerimaan → pembayaran aktual`

- SPK mengambil item Jasa/Mobilitas; PO mengambil Perangkat/Material.
- Vendor diklasifikasikan sebagai Supplier, Jasa, atau Hybrid dan dapat memiliki
  beberapa kategori yang dikelola Admin/Finance.
- Quotation Accepted wajib memiliki tanggal dan lampiran bukti persetujuan.
  Scope yang sudah diterima dikunci dari edit/hapus.
- Nilai kontrak dihitung dari baris item dan harga negosiasi vendor. Alokasi
  aktif lintas SPK/PO tidak dapat melampaui kuantitas BoQ.
- Finance tidak dapat menyetujui draft yang dibuat atau diajukannya sendiri.
  Admin dapat override dengan alasan yang masuk audit log.
- DP dapat dibayar setelah approval. Termin jasa berikutnya memerlukan
  verifikasi progres; pembayaran supplier mengikuti nilai barang yang sudah
  diterima dan memperhitungkan DP sebagai uang muka.
- Setiap pembayaran aktual membuat satu kas keluar. Void membuat reversal dan
  pembayaran yang sudah direkonsiliasi harus dilepas terlebih dahulu.

Endpoint kanonis tersedia di `/api/procurement-orders`. Endpoint `/api/spks`
tetap menyediakan akses baca/PDF untuk kompatibilitas data lama. Mutasi melalui
endpoint lama dibuat read-only pada production agar bukti, approval, dan audit
procurement baru tidak dapat dilewati.

## Notifikasi email

Production menggunakan SMTP privat Mailcow melalui Tailscale, sedangkan Mailcow
merelay email keluar domain `perumnet.id` melalui Brevo. Enterprise tidak
menyimpan SMTP key Brevo; aplikasi hanya memakai app password Mailcow khusus:

```bash
EMAIL_MODE=live
SMTP_HOST=100.65.248.6
SMTP_PORT=465
SMTP_SECURE=true
SMTP_TLS_SERVERNAME=mail.perumnet.id
SMTP_USER=enterprise@perumnet.id
SMTP_PASS=app-password-khusus-enterprise
EMAIL_FROM="PerumNet Enterprise <enterprise@perumnet.id>"
EMAIL_REPLY_TO="PerumNet Enterprise <enterprise@perumnet.id>"
SECURITY_SMTP_USER=no-reply@perumnet.id
SECURITY_SMTP_PASS=app-password-khusus-security-enterprise
SECURITY_EMAIL_FROM="PerumNet <no-reply@perumnet.id>"
SECURITY_EMAIL_REPLY_TO="PerumNet Enterprise <enterprise@perumnet.id>"
EMAIL_WORKER_SECRET=secret-random-internal
EMAIL_WORKER_APP_URL=http://127.0.0.1:3100
```

Pesan masuk ke transactional outbox lebih dahulu sehingga kegagalan SMTP tidak
membatalkan transaksi bisnis. Worker PM2 mencoba ulang setelah 1, 5, 15, dan 60
menit, maksimal lima percobaan. Admin dapat melihat status Pending, Sent,
Failed, atau Skipped serta mencoba ulang email gagal dari Pengaturan. Resend
tetap didukung sebagai fallback kompatibilitas bila SMTP belum dikonfigurasi.

Notifikasi mencakup pembuatan akun dan reset kata sandi, akses proyek,
Quotation/Invoice, approval dan pembayaran SPK/PO, verifikasi atau penerimaan,
void, validasi, serta BAST. Preferensi pengguna dan RBAC memfilter penerima;
email keamanan tidak bergantung pada preferensi notifikasi bisnis. Mode demo
selalu capture dan tidak pernah mengirim pesan keluar.

## Pajak opsional

Modul Finance → Pajak nonaktif secara default. Admin mengaktifkan switch global
dan mengelola master aturan; Admin/Finance kemudian memilih pajak per
Quotation, Invoice, SPK, atau PO. Preset PPN, PPh 21, PPh 23, PPh 4(2), dan
pajak lain dimulai dengan tarif nol dan status nonaktif—tarif serta perlakuan
akhir wajib ditentukan perusahaan.

Snapshot dikunci saat Quotation diterima, procurement disetujui, atau
pembayaran Invoice diposting. Buku Kas hanya mencatat kas aktual:

```text
Bruto = dasar pengenaan + pajak tambah
Kas bersih = bruto - pajak potong
```

Utang/piutang pajak dilacak terpisah sampai settlement. Settlement atau
pembayaran yang sudah direkonsiliasi dengan mutasi bank harus dilepas dahulu
sebelum void. PDF/CSV bisnis dan laporan keuangan menampilkan dasar pengenaan,
setiap pajak, bruto, potongan, kas bersih, posisi, dan outstanding. Utang pajak
aktif mengurangi laba yang boleh dibagikan; pajak recoverable tidak dianggap
sebagai laba.

## Belanja proyek

PM dan Engineer mencatat nota lapangan dari proyek yang dapat mereka akses,
kemudian Finance memverifikasi pengajuan sebelum pembukuan berubah. Bukti dapat
berupa JPG, PNG, WebP, atau PDF hingga 10 MB per file dan maksimal lima file.
Hash file, kesamaan proyek/tanggal/toko/nominal, serta pembayaran procurement
terkait diperiksa untuk mengurangi pencatatan ganda.

Sumber dana menentukan perlakuan keuangan:

- Rekening perusahaan membuat satu kas keluar aktual ketika disetujui.
- Uang muka proyek mengurangi saldo pertanggungjawaban tanpa membuat kas keluar
  kedua; sisa dikembalikan sebagai kas masuk dan kelebihan menjadi utang
  reimbursement.
- Uang pribadi pegawai menjadi kewajiban reimbursement dan baru membuat kas
  keluar saat dibayar, termasuk pembayaran sebagian.

Pengajuan yang sudah disetujui dikunci. Admin melakukan void melalui reversal,
sedangkan transaksi yang telah direkonsiliasi harus dilepas terlebih dahulu.
Outstanding reimbursement ikut mengurangi laba yang boleh dibagikan. Laporan
proyek dan Finance dapat diekspor dalam PDF atau CSV berbahasa Indonesia maupun
Inggris.

Quotation Draft memiliki switch **Gunakan Pajak** per dokumen. Admin/Finance
memilih aturan dari master pajak tanpa tarif legal yang di-hardcode. Saat
Quotation Original atau Addendum diterima, tarif dan nominal menjadi snapshot
terkunci dan diwariskan ke Invoice.

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
- AI Catalog Assistant memakai Google Gemini sebagai satu-satunya provider
  (free tier via `GEMINI_API_KEY` dari aistudio.google.com; model diatur
  lewat `GEMINI_CATALOG_MODEL`, default `gemini-2.5-flash`).
- Dokumen proyek menerima JPG, PNG, WebP, atau PDF hingga 5 MB.
- Quotation, invoice, SPK, dan BAST dibuat sebagai PDF di server.
- Semua mutasi penting dicatat pada audit log.
