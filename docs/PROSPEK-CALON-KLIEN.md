# Calon klien (prospek) & kirim penawaran — Enterprise

Admin menyusun daftar calon klien, lalu mengirimi mereka penawaran dari dalam
aplikasi. Layarnya di `/admin`.

## Kenapa tabel sendiri, bukan `cms_leads`

`cms_leads` milik **formulir pengunjung**. Kolomnya menuntut itu: `whatsapp`,
`location`, `service_interest`, `message`, dan `privacy_consent_at` semuanya
`NOT NULL`, plus `idempotency_key` yang unik.

Prospek dikumpulkan tim sendiri — dari kartu nama, telepon masuk, atau berkas
yang diserahkan pemilik — dan sering hanya punya nama, perusahaan, dan email.
Orangnya **tidak pernah mencentang kotak privasi**. Memaksakannya ke
`cms_leads` berarti mengisi nilai penambal dan membuat `privacy_consent_at`
bermakna ganda; kolom itu justru yang paling mahal kalau salah dibaca nanti.

Tiga tabel baru, `cms_leads` tidak disentuh:

| Tabel | Isi |
|---|---|
| `cms_prospects` | kontaknya |
| `cms_prospect_templates` | template surat |
| `cms_prospect_outreach` | riwayat surat yang benar-benar dikirim |

## Dua hal yang menempel pada tiap prospek

1. **`source` wajib** — dari mana kontaknya didapat. Ini bukan formalitas:
   orang itu tidak pernah meminta dihubungi, jadi catatan tertulis inilah
   satu-satunya jawaban yang bisa dipertanggungjawabkan atas *"dari mana Anda
   dapat alamat email saya"*. Server menolak kontak tanpa itu.
2. **Opt-out** — `optOut: true` lewat PATCH mengisi `opt_out_at`, dan server
   **menolak** mengirim ke baris itu selamanya sesudahnya.

Layar mendapat field **`emailable`** yang sudah menghitung ketiganya (punya
email, tidak opt-out, belum dihapus). Pakai field itu untuk mematikan
checkbox — jangan menghitung ulang di layar, karena server menolak dengan
aturan yang sama dan hasilnya harus sama persis.

## Endpoint

Semuanya Admin-only.

| Endpoint | Guna |
|---|---|
| `GET /api/cms/prospects` | daftar; `q`, `status`, `segment`, `emailable=1`, `optOut=1`, `page`, `pageSize` |
| `POST /api/cms/prospects` | tambah satu kontak |
| `GET /api/cms/prospects/:id` | detail + `outreach[]` |
| `PATCH /api/cms/prospects/:id` | ubah data, status, opt-out |
| `DELETE /api/cms/prospects/:id` | soft delete |
| `POST /api/cms/prospects/import` | unggah `.xlsx` (multipart: `file`, `source`, `dryRun`) |
| `POST /api/cms/prospects/outreach` | kirim — satu atau banyak sekaligus |
| `GET/POST /api/cms/prospect-templates` | daftar & buat template |
| `GET/PATCH/DELETE /api/cms/prospect-templates/:id` | satu template |
| `POST /api/cms/prospect-templates/:id/preview` | render untuk satu prospek, tanpa mengirim |

### Kode galat

| Status | Kode | Artinya |
|---|---|---|
| 409 | `EMAIL_ALREADY_LISTED` | alamat sudah dipakai prospek lain; `details.prospectId` untuk tautan "buka yang sudah ada" |
| 422 | `NO_ELIGIBLE_RECIPIENTS` | tidak ada penerima yang lolos; `details.skipped[]` menyebut alasan per prospek (`OPTED_OUT`, `NO_EMAIL`, `NOT_FOUND`) |
| 422 | `INVALID_FILE` | bukan `.xlsx`, atau lebih dari 5 MB |
| 422 | `EMPTY_WORKBOOK` | tidak ada kontak terbaca — biasanya judul kolomnya tidak dikenali |

## Pengiriman

Satu endpoint untuk keduanya: kirim ke satu orang adalah batch berisi satu.
Body `{ prospectIds[], templateId? , subject?, bodyHtml?, spacingSeconds? }` —
pakai `templateId`, **atau** `subject` + `bodyHtml` untuk surat langsung.

**Pesan diberi jeda, tidak dikirim serentak.** Pesan ke-N dijadwalkan N × jeda
ke depan lewat `next_attempt_at` di `email_outbox`; worker hanya mengambil
baris yang waktunya sudah lewat. Bawaannya 60 detik, maksimal 3.600, dan
maksimal 200 penerima sekali kirim.

Alasannya bukan kesopanan: **Mailcow yang membawa penawaran ini juga membawa
invoice dan tautan reset kata sandi.** Kalau reputasi domain rusak karena satu
kampanye, keduanya ikut tidak sampai — dan itu baru ketahuan saat ada yang
tidak bisa masuk atau tidak menerima tagihan.

Mengirim menaikkan status `New` → `Contacted` dan mengisi `last_outreach_at`.

### Template

Placeholder: `{{nama}}`, `{{perusahaan}}`, `{{jabatan}}`, `{{kota}}`,
`{{segmen}}`. Semuanya berasal dari baris prospek — tidak ada yang mengambil
dari input pemanggil, karena nilai yang bisa dikendalikan pemanggil di dalam
HTML adalah jalan masuk injeksi.

Dua aturan render yang disengaja:

- **Nilai di-escape.** Nama bisa berasal dari berkas Excel pihak lain; sel
  berisi `<script>` yang lolos ke badan surat adalah injeksi yang dikirim ke
  kotak surat orang lain atas nama kita.
- **Placeholder tak dikenal dibiarkan utuh.** Salah ketik `{{prusahaan}}` yang
  diam-diam jadi string kosong akan terkirim ke ratusan orang tanpa ada yang
  menyadarinya; yang tertinggal utuh terlihat pada pratinjau pertama.

### Bentuk surat — kop, tanda tangan, catatan kaki

Sampai 20 Agustus isi template dikirim apa adanya: admin harus menulis HTML
sendiri, dan yang sampai ke calon klien adalah potongan HTML telanjang tanpa
logo dan tanpa tanda tangan. Pratinjau menampilkan potongan yang sama, jadi
tidak ada satu pun layar yang memperlihatkan surat utuh sebelum ia terkirim.

Sekarang **admin mengetik teks biasa**, dan `server/prospect-letter.ts`
menyusun suratnya:

| Bagian | Dari mana |
|---|---|
| Kop berlogo | `/perumnet-enterprise-logo.png` lewat `APP_URL` |
| Isi | template, teks biasa; baris kosong = paragraf baru |
| Salam penutup + nama | `senderSignoff`, `senderName` pada template |
| Telepon / email | `senderPhone`, `senderEmail`; kosong = kontak perusahaan |
| Nama & alamat perusahaan | `cms_site_settings` — sumber yang sama dengan footer situs |
| Catatan cara berhenti | ditempel selalu; kontaknya tidak pernah meminta disurati |

`bodyFormat` menentukan cara isi dibaca:

- **`"text"` (bawaan)** — seluruh tag di-escape lalu dipecah jadi paragraf.
  `<b>` sampai ke penerima sebagai tulisan `<b>`, bukan huruf tebal. Escaping
  dilakukan **sebelum** placeholder diisi, supaya `{{` dan `}}` selamat
  sementara nilai yang disisipkan tetap lewat escape-nya sendiri.
- **`"html"`** — isi dipercaya sebagai markup. Hanya untuk surat yang memang
  disusun sebagai HTML.

**Pratinjau dan pengiriman memanggil fungsi yang sama.** `POST
/api/cms/prospect-templates/:id/preview` memulangkan dokumen HTML lengkap —
persis yang disimpan ke `cms_prospect_outreach.body_html` saat dikirim. Ada tes
yang membandingkan keduanya huruf demi huruf; kalau suatu saat jalurnya
dipisah, perbedaannya baru ketahuan setelah surat sampai ke calon klien.

`GET /api/cms/prospect-templates` juga memulangkan `defaults`: naskah awal
(`starter`) supaya kotak template tidak pernah terbuka kosong, dan tanda tangan
yang sudah terisi dari akun yang sedang masuk. **Nama dan email pegawai tidak
ada di dalam kode** — repositori ini publik; keduanya datang dari sesi.

Logo dimuat dari URL publik, bukan data URI: Gmail membuang gambar data URI.
Konsekuensinya logo baru muncul setelah penerima mengizinkan gambar, jadi
`alt`-nya ditulis penuh supaya nama merek tetap terbaca saat gambar diblokir.

### Riwayat surat

`cms_prospect_outreach` menyimpan surat yang benar-benar dikirim, menempel
pada prospek. Tabel sendiri, **bukan menumpang `email_outbox`** — outbox
membuang isi pesan begitu barisnya final lalu dipangkas, sedangkan *"surat apa
yang sudah kita kirim ke mereka"* adalah pertanyaan yang muncul berbulan-bulan
kemudian. `hasBody: false` berarti isinya sudah hilang; jangan tawarkan tombol
"lihat isi surat".

## Impor workbook

Kolom dipetakan dari **judulnya**, bukan posisinya — susunan berkas sumber
tidak bisa ditebak. Yang dikenali (dua bahasa): nama, email, perusahaan,
jabatan, telepon/HP/WhatsApp, kota/lokasi, industri.

**Sel yang meragukan dilaporkan, bukan dibuang** — lengkap dengan nomor baris.
Membuang baris diam-diam membuat 200 kontak masuk sebagai 180 tanpa ada yang
tahu 20 mana yang hilang.

| Kode | Perlakuan |
|---|---|
| `EMAIL_GANDA` | dua alamat dalam satu sel — hampir selalu salah tempel. Kontak **tetap masuk tanpa email**; memilih salah satunya berarti menebak |
| `EMAIL_TIDAK_SAH` | isinya bukan alamat. Kontak tetap masuk tanpa email |
| `TANPA_EMAIL` | selnya kosong. Kontak masuk, tapi tidak bisa dikirimi penawaran |
| `TANPA_NAMA` | hanya ada nama perusahaan — baris dilewati, tidak ada yang bisa disimpan |

Alamat yang **sudah dipakai prospek lain** membuat barisnya dilewati dan
dilaporkan. Dua perusahaan berbagi satu alamat adalah salah tempel di berkas
sumber, bukan duplikat yang boleh digabung.

Nomor telepon yang kehilangan nol di depan karena Excel menyimpannya sebagai
angka dikembalikan: `8123456789` → `08123456789`.

### Dari terminal

```
node scripts/import-prospects.mjs --file "<berkas>.xlsx" --dry-run
```

Kredensial dari `PROSPECT_ADMIN_EMAIL` / `PROSPECT_ADMIN_PASSWORD`.
`--dry-run` melaporkan apa yang akan tersimpan dan baris mana yang bermasalah
tanpa menulis apa pun — **jalankan itu dulu.**

Skrip ini tidak bicara ke database; ia mengunggah ke endpoint yang sama dengan
tombol impor di layar, supaya aturan "kontak seperti apa yang sah" tidak ada
duanya.

## Tugas layar untuk Luna (T-6 … T-10)

Backend semuanya sudah jalan dan bertes; yang tersisa murni tampilan di
`/admin`. Nomor dilanjutkan dari T-5 di `HANDOFF-BACKEND-KE-FRONTEND.md`.

> Ditulis di berkas ini, bukan di HANDOFF, karena HANDOFF sedang disunting di
> direktori kerja bersama saat ini. Penunjuk satu baris menyusul ke sana.

### T-6. Layar daftar prospek

- **Butuh:** `GET /api/cms/prospects` — sudah punya paginasi, `q`, `status`,
  `segment`, `emailable=1`, `optOut=1`.
- Tab per segmen memakai `prospectSegmentLabels` dari `shared/prospects.ts`;
  **jangan menulis nama segmen sebagai teks di layar** — daftarnya berasal dari
  nama lembar workbook dan akan bertambah.
- Checkbox pemilih penerima **dimatikan saat `emailable === false`**. Jangan
  menghitung ulang syaratnya di layar: server menolak dengan aturan yang sama,
  dan dua perhitungan yang bisa berbeda adalah cara membuat tombol yang
  menjanjikan sesuatu lalu gagal.
- Tampilkan `source` di baris atau detail. Itu jawaban atas "dari mana Anda
  dapat alamat email saya" dan harus mudah dilihat, bukan tersembunyi.

### T-7. Form tambah calon klien

- **Butuh:** `POST /api/cms/prospects`.
- **`source` wajib.** Beri label seperti *"Dari mana kontak ini didapat?"*
  dengan contoh: kartu nama pameran properti, telepon masuk, berkas Data
  Clients Enterprise.xlsx. Server menolak yang kosong (422).
- **409 `EMAIL_ALREADY_LISTED`** → `details.prospectId` untuk tombol "buka
  prospek yang sudah ada". Jangan tampilkan sebagai kegagalan buntu.

### T-8. Layar hasil impor

- **Butuh:** `POST /api/cms/prospects/import` (multipart: `file`, `source`,
  `dryRun`).
- **Tawarkan `dryRun` sebagai langkah pertama, bukan opsi tersembunyi.** Ia
  melaporkan tanpa menyimpan; itu satu-satunya kesempatan memeriksa sebelum
  ratusan baris masuk.
- Jawabannya memuat `sheets[]`, `terbaca`, `disimpan`, `dilewati`, dan
  `issues[]`. **Tampilkan `issues` sebagai daftar yang bisa dibaca**, jangan
  diringkas jadi satu angka — tiap baris menyebut lembar dan nomor baris supaya
  bisa dibetulkan di berkas sumber.
- `EMAIL_GANDA` berarti kontaknya masuk **tanpa email**; arahkan pengguna
  memilih salah satu alamat lalu mengisinya lewat T-7/detail.

### T-9. Komposer email

- **Butuh:** `POST /api/cms/prospects/outreach` dengan
  `{ prospectIds[], templateId | (subject + bodyHtml), spacingSeconds? }`.
  Kirim ke satu orang adalah batch berisi satu — tidak ada endpoint terpisah.
- **Tampilkan jedanya, jangan sembunyikan.** Bawaan 60 detik, maksimal 200
  penerima. Beri tahu perkiraan selesai: 40 penerima × 60 detik = 40 menit.
  Orang yang tidak tahu ini akan mengira pengiriman macet.
- Pratinjau lewat `POST /api/cms/prospect-templates/:id/preview` dengan satu
  `prospectId` — **wajibkan melihat pratinjau sebelum tombol kirim aktif.**
  Placeholder salah ketik dibiarkan utuh oleh server justru supaya terlihat di
  sini; kalau pratinjau dilewati, ia terkirim ke semua orang.
- **422 `NO_ELIGIBLE_RECIPIENTS`** → `details.skipped[]` menyebut alasan per
  prospek (`OPTED_OUT`, `NO_EMAIL`, `NOT_FOUND`). Tampilkan per orang, bukan
  satu pesan umum.

### T-10. Pengelola template

- **Butuh:** CRUD `/api/cms/prospect-templates` + `:id/preview`.
- Sisipkan placeholder lewat tombol, jangan mengandalkan orang mengetik
  `{{nama}}` dengan benar. Daftarnya dan penjelasannya ada di
  `prospectPlaceholders` dan `prospectPlaceholderHints`.
- Editor isi surat menghasilkan HTML. Nilai yang disisipkan sudah di-escape di
  server; yang **tidak** di-escape adalah template itu sendiri — itu memang
  disengaja supaya bisa diformat, jadi jangan tempelkan HTML dari sumber luar
  ke dalamnya.

### Belum ada, dan memang belum diminta

Lampiran PDF. Surat berisi teks dan tautan. Jangan membuat tombol lampiran
yang tidak punya endpoint.

## Yang belum ada

- **Lampiran PDF.** Surat berisi teks dan tautan. Diputuskan 19 Agustus untuk
  menyusul, bukan ditunda tanpa batas.
- **Layar `/admin`.** Sudah tersedia di `app/components/enterprise-app.tsx`
  melalui `app/panel/prospects-editor.tsx`; backend tetap menjadi penegak
  akses dan seluruh aturan domain.
- **Retensi otomatis.** Prospek tidak dianonimkan sendiri seperti lead dari
  formulir publik. Diputuskan 19 Agustus: cukup catatan sumber + opt-out.
