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

## Yang belum ada

- **Lampiran PDF.** Surat berisi teks dan tautan. Diputuskan 19 Agustus untuk
  menyusul, bukan ditunda tanpa batas.
- **Layar `/admin`.** Backend siap; layarnya wilayah Luna. Tugasnya ditulis di
  `HANDOFF-BACKEND-KE-FRONTEND.md`.
- **Retensi otomatis.** Prospek tidak dianonimkan sendiri seperti lead dari
  formulir publik. Diputuskan 19 Agustus: cukup catatan sumber + opt-out.
