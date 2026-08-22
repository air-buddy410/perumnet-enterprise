# Handoff Backend → Frontend (Opus → Luna)

Kanal satu arah: kontrak yang **sudah siap dipakai** dari sisi backend —
nama fungsi/endpoint, nama field, dan batas perilakunya — supaya frontend
tidak perlu menebak dari kode.

Kanal balik: `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`.
Aturan lengkap: `docs/WORKFLOW-TIM.md`.

---

## 🔴 Yang sedang menunggumu

**22 Agustus 2026, sore.** Tiga tugas baru dari pemilik, dan kamu **bisa mulai
sekarang** tanpa menunggu saya: kontraknya sudah dikunci di rencana yang
disetujui pemilik, dan kode server sedang saya tulis mengikuti kontrak itu —
bukan sebaliknya. Kalau ada yang terpaksa berubah, saya tulis blok "PERUBAHAN"
di kepala bagian tugasnya dan menyebut tanggalnya.

| Tugas | Layar | Status backend |
|---|---|---|
| **T-29** Arsip Bukti di Pembukuan | `finance-view.tsx` (tab/section baru) | **selesai & ter-deploy** — kontrak di §T-29 |
| **T-30** Foto proyek: unggah banyak, keterangan, galeri per proyek | `project-view.tsx` | **selesai & ter-deploy** — §T-30 |
| **T-31** Galeri Proyek lintas proyek | `ViewKey` baru `gallery` | **selesai & ter-deploy** — §T-31 |

Urutan yang saya sarankan: **T-30 dulu** (paling banyak dipakai PM sehari-hari),
lalu T-29, lalu T-31. Ketiga kontrak lengkap ada di bagian bawah berkas ini —
dan ketiganya **sudah berjalan di demo dan produksi**, jadi kamu bisa memukul
endpoint sungguhan saat mengembangkan. Tidak ada yang berubah dari kontrak yang
ditulis tadi siang; dua catatan kecil ditambahkan di bawah judul T-30.

Konteks singkat supaya kamu tahu kenapa: sampai hari ini **tujuh jenis bukti
yang diunggah orang tidak pernah bisa dibuka dari mana pun** — bukti transfer
invoice, bukti bayar vendor, bukti setor pajak, tanda terima quotation.
Diunggah, disimpan, hanya namanya yang pernah tampil. T-29 adalah layar
pertama yang bisa membukanya. Dan foto proyek sekarang diunggah satu-satu tanpa
thumbnail: galeri 50 foto memuat 250 MB. T-30/T-31 memperbaiki keduanya.

Soal editor surat (T-27/T-28) sudah selesai — arsipnya di bawah.

---

<details>
<summary>T-27 dan T-28 — diagnosis lengkapnya (arsip)</summary>

### T-27 — Editor "Isi surat" di Calon Klien tidak bisa diketik sama sekali (BUG, prioritas)

Dilaporkan pemilik 22 Agustus 2026 saat menguji. Klik di kotak isi surat pada
**Calon Klien → template outreach** tidak memunculkan kursor dan tidak ada satu
huruf pun masuk. Kotaknya TIDAK terlihat terkunci — warnanya normal, toolbarnya
aktif. Bukan soal izin.

**Sebabnya: editor itu dibungkus `<label>`.**

`Field` (`app/panel/prospects-editor.tsx:427-441`) merender `<label>`, dan satu
pemakaiannya membungkus komponen, bukan input:

```tsx
<Field label="Isi surat" required wide hint="…">
  <RichTextEditor … />
</Field>
```

`RichTextEditor` menaruh toolbar lebih dulu (`rich-text-editor.tsx:489`), dan
toolbar itu berisi `<button>` dan `<select>` — keduanya elemen labelable.
Sebuah `<label>` tanpa atribut `for` mengambil **elemen labelable pertama di
dalamnya** sebagai kontrol yang ia wakili. Jadi klik di permukaan tulis
diperlakukan sebagai klik pada label: fokus dilempar ke tombol toolbar pertama,
dan caret tidak pernah mendarat di `contentEditable`. Persis gejalanya.

**Kenapa di Template surat dokumen tidak rusak:** di sana pembungkusnya `<div
className={\`field \${styles.full}\`}>` (`document-template-manager.tsx:530`),
bukan `<label>`. Editornya sendiri sama persis — jangan ikut diubah.

**Perbaikan yang saya sarankan:** beri `Field` prop `as?: "label" | "div"`
dengan bawaan `"label"`, lalu pakai `as="div"` HANYA untuk field "Isi surat".
Tiga puluh `Field` lain membungkus `<input>`/`<select>` biasa — di sana
`<label>` justru yang benar dan harus tetap. Saya sudah periksa: hanya "Isi
surat" yang membungkus komponen.

Karena bungkusnya tidak lagi `<label>`, sambungkan kaptionnya lewat `id` +
`aria-labelledby`, atau setidaknya perbaiki `aria-label` permukaan tulis di
`rich-text-editor.tsx:538` — sekarang ia memakai `labels.toolbar` ("Toolbar"),
yang menyesatkan pembaca layar untuk sebuah kotak isian.

Tolong uji juga dengan mengetik di kotak yang sama pada **Template surat
dokumen**, untuk memastikan perbaikannya tidak menyentuh yang sudah jalan.

### T-28 — Menekan Tab di editor melompatkan tampilan ke atas (BUG)

Dilaporkan pemilik 22 Agustus 2026, terlihat di tab **BAST, Invoice, dan
Quotation** — yaitu di mana pun `DocumentTemplateManager` dipakai. Sedang
mengetik di tengah surat, tekan Tab, tampilan malah melompat naik.

**Sebabnya `focus()` tanpa `preventScroll`, dan Tab yang membuatnya terasa.**

`HTMLElement.focus()` secara bawaan menggulir elemennya ke dalam pandangan.
Ada empat pemanggilan di `app/panel/rich-text-editor.tsx` yang semuanya polos:
baris **367** (akhir `restoreSelection`), **401** (`runCommand`), **410**
(`insertText`), dan **429** (`focus` yang diekspor lewat ref).

Menekan Tab sekali memicu rantai ini:

```
handleKeyDown → insertText()
                  → restoreSelection()   → editor.focus()   ← gulir #1
                  → editorRef.focus()                        ← gulir #2
                  → emitHtml()
                       → (bila sanitize mengubah HTML)
                         restoreSelection() → editor.focus() ← gulir #3
```

Tiga kali "gulirkan editor ke dalam pandangan" dalam satu ketukan tombol.
Karena `.richTextSurface` sendiri punya `max-height: 620px; overflow: auto`
(`prospects.module.css:327`), yang tergulir bukan cuma halamannya tapi juga
isi editornya.

Ini BUKAN bug baru — keempat `focus()` itu sudah ada sejak T-17. Yang berubah
di `b492ec5` adalah Tab kini memanggil `insertText`, dan Tab ditekan justru
saat sedang mengetik jauh di dalam surat. Lewat tombol toolbar gejalanya nyaris
tidak terasa karena toolbarnya memang sudah di pandangan.

**Perbaikan:** `focus({ preventScroll: true })` pada keempatnya. Caret yang
baru berpindah tetap akan terlihat sendiri tanpa perlu memaksa gulir.

**Satu pertanyaan desain, tolong dipertimbangkan sekalian.** Tab sekarang
disandera editor: di form ini ada Nama template → Bahasa → Subjek → Isi surat,
dan orang menekan Tab untuk berpindah kolom. Sejak `b492ec5` Tab menyisipkan
empat spasi dan **tidak ada lagi jalan keluar dari editor lewat papan ketik** —
pengguna papan ketik dan pembaca layar terjebak di sana. Saya menduga inilah
yang sebenarnya dilakukan pemilik saat menemukan bug ini: menekan Tab untuk
pindah kolom, bukan untuk membuat indentasi.

Saran: kembalikan Tab ke fungsi bawaannya (pindah fokus), dan pindahkan
indentasi ke tombol toolbar atau pintasan yang tidak bertabrakan (`Ctrl+]` /
`Cmd+]`). Kalau Tab tetap ingin dipakai untuk indentasi, minimal sediakan
`Escape` lalu Tab sebagai jalan keluar — pola yang dipakai editor kode di web.
Keputusannya ada padamu; yang wajib diperbaiki adalah gulirnya.

Uji di tab BAST, Invoice, Quotation, dan juga Calon Klien (T-27 menyentuh
berkas yang sama).

</details>

---

## ✅ Sudah selesai

**T-24, T-25, dan T-26 sudah selesai** (`7b8cd6b`), dan sudah berjalan di demo
maupun produksi bersama backend-nya (`7b8cd6b`, 370 tes lulus). Kontraknya
tetap ditinggal di bawah sebagai rujukan — jangan dikerjakan ulang.

Papan `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md` juga kosong; tidak ada yang
menunggu saya dari sisimu.

---

### T-25 — "Sisa dapat ditagihkan" memakai dasar yang keliru (BUG, prioritas)

`app/components/billing-view.tsx:948` menghitung sisa dari **subtotal sebelum
diskon**, padahal invoice-nya berdenominasi **grand total**:

```tsx
formatCurrency(Math.max(0, quotationTotal - invoicedTotal), language)
//                        ^^^^^^^^^^^^^^ salah
```

`quotationTotal` (baris 331) adalah `quotation.total` — subtotal pekerjaan,
yang di baris 872 kamu beri label "Subtotal pekerjaan". Sementara nilai invoice
dihitung dari `quotationGrossTotal` (baris 644 dan 1019: "Nilai termin dari
Grand Total"). Membandingkan keduanya membandingkan dua dasar yang berbeda,
dan selisihnya persis sebesar diskon + pembulatan.

Terlihat di demo pada proyek **PN-2608-004 · Sandy House**, angka sungguhan
dari database:

| | |
|---|---|
| `quotations.total` (subtotal) | 275.766.900 |
| diskon 10% | −27.576.690 |
| pembulatan | −90.210 |
| `quotations.grand_total` | **248.100.000** |
| invoice (100%, Lunas) | 248.100.000 |

Layar menampilkan **"Sisa dapat ditagihkan Rp 27.666.900 · Dari Rp
275.766.900"** pada proyek yang sudah ditagih penuh dan dibayar penuh.

Server sudah benar dan tidak perlu diubah:
`assertInvoiceAmountWithinQuotation` (`server/api/router.ts:3181`) memakai
`CASE WHEN grand_total>0 THEN grand_total ELSE total END`, jadi invoice
berikutnya memang akan ditolak — hanya angkanya yang berbohong.

**Perbaikannya:** pakai `quotationGrossTotal` di kedua tempat pada baris 948 —
nilai sisanya dan keterangan "Dari". Kartu "Subtotal pekerjaan" di baris 872
tetap memakai `quotationTotal`; itu memang subtotal.

### T-24 — Kirim BAST final ke klien lewat email

Backend sudah siap (lihat §T-24 di bawah untuk kontrak lengkapnya). Yang
diperlukan di layar **BAST Digital**:

1. Tombol **Kirim Email** pada BAST, **hanya muncul bila `finalizedAt` terisi
   dan `revokedAt` kosong**. Pada BAST Draft jangan ditampilkan sama sekali —
   servernya menolak, tapi tombol yang selalu gagal lebih buruk daripada tombol
   yang tidak ada.
2. Dialognya bisa memakai `document-email-dialog.tsx` yang sudah ada; jenisnya
   `bast`, endpointnya `/api/bast/:id/...` (pola sama persis dengan invoice).
3. Tab **Template surat** untuk jenis `bast` di layar BAST Digital, memakai
   `document-template-manager.tsx` yang sudah ada dengan `kinds={["bast"]}`.
   Izinnya modul `bast`, bukan `billing` — server yang menegakkan, dan
   `manageableKinds` dari `GET /api/document-email-templates` sudah
   memberitahumu jenis mana yang boleh dikelola akun yang sedang masuk.

**Satu baris di wilayahmu sudah saya sentuh**, maaf: `document-template-manager.tsx:73`
`emptyPlaceholders` wajib memuat semua kunci `DocumentEmailKind`, jadi
`bast: []` saya tambahkan — tanpa itu `tsc` gagal dan build tidak jalan. Murni
kelengkapan tipe, tidak ada keputusan UI di dalamnya.

---

## ✅ Tidak ada tugas frontend yang tertunda

Pemilik menemukan ini saat menguji: ia membuat template "Mengirim Dokumen
Quotation" di **Calon Klien**, lalu heran template itu tidak muncul di dialog
Kirim Quotation. Memang dua sistem berbeda — dan itu benar — tetapi pengelola
template dokumen hanya punya SATU pintu, di Procurement & Vendor. Orang yang
mengirim quotation bekerja di layar Quotation & Invoice dan tidak akan pernah
menemukannya di sana.

Sisi server sudah saya kerjakan (commit `template surat: izin per jenis`), dan
layar T-23 juga sudah selesai. Izin mengikuti JENIS dokumen, daftar disaring
per izin, dan respons membawa `viewableKinds`, `manageableKinds`, serta
`audience`.

T-20, T-21, dan T-22 sudah selesai (`f32fdca`).

---

**T-18a, pengelola template surat dokumen, sudah dikerjakan.**
Implementasinya ada di `app/components/document-template-manager.tsx` dan
menjadi tab di Procurement. T-16, T-18b, dan T-18c juga sudah selesai, tidak
perlu disentuh lagi. Permintaanmu soal endpoint pratinjau juga sudah jadi —
lihat §T-18a.

Tiga hal yang berubah sejak terakhir kamu membaca berkas ini:

1. **Database sudah berisi tiga template contoh** (`spk`, `quotation`,
   `invoice`), diisi lewat `scripts/seed-template-dokumen.mjs`. Layar ini bisa
   kamu uji terhadap data sungguhan sejak baris pertama.
2. **T-17 punyamu sudah di-commit** (`5a6d77e`). Empat berkas editor kaya
   sempat menggantung belum masuk git; sudah saya kunci setelah lint dan build
   lulus. Tidak ada yang berubah dari kodemu.
3. **Ini bukan pekerjaan yang bisa ditunda diam-diam.** `2fe93bb` sudah
   berjalan di produksi, jadi tombol Kirim dokumen **sudah tampil di sana**
   dengan daftar template kosong. Belum melukai siapa pun karena produksi masih
   kosong (10 pengguna, nol proyek) — tapi berubah begitu data operasional
   masuk.

Satu koreksi kecil di luar T-18a: `document-email-dialog.tsx:475` membaca
`defaults?.starter`, dan endpoint template dokumen tidak pernah mengirim field
itu. Cabang mati, tidak merusak apa pun. Buang saja saat kebetulan lewat.

## Format

```
### <nama kontrak>
- **Dipakai untuk:** layar/fitur apa
- **Cara pakai:** nama fungsi atau endpoint + parameter
- **Field:** nama field persis (bukan perkiraan)
- **Batas perilaku:** apa yang ditolak, dan pesan errornya
```

Setiap nama di dokumen ini **wajib diverifikasi langsung dari sumbernya**,
bukan dari ingatan.

---

## Siap dipakai

### Login — `POST /api/auth/login`

- **Dipakai untuk:** halaman masuk (admin & panel).
- **Cara pakai:** body `{ email, password, remember }`. **Alamatnya tidak
  berubah** — yang berubah hanya di mana kata sandi diperiksa, dan satu kode
  galat baru.
- **Field jawaban:** `{ data: { user } }` saat berhasil; galat selalu
  `{ error: { code, message } }`.
- **Batas perilaku:**
  | Status | Kode | Artinya di layar |
  |---|---|---|
  | 200 | — | masuk; cookie sesi sudah ikut di jawaban |
  | 401 | `INVALID_CREDENTIALS` | tampilkan `message` apa adanya |
  | 403 | `ACCOUNT_INACTIVE` | akun dinonaktifkan |
  | 429 | throttle | terlalu banyak percobaan; sebutkan tunggu beberapa menit |
  | **503** | **`MAILSERVER_UNREACHABLE`** | **mailserver mati — BUKAN kata sandi salah** |

  **503 harus dibedakan di layar.** Jangan tampilkan sebagai kata sandi salah
  dan jangan tawarkan "lupa kata sandi": orang akan mereset kata sandi email
  yang sebenarnya tidak bermasalah. Tampilkan `message` apa adanya.

  Selengkapnya: `docs/LOGIN-MAILCOW.md`.


### Ganti kata sandi — `PATCH /api/profile/password`

- **Dipakai untuk:** blok "Keamanan password email" di layar Pengaturan.
- **Cara pakai:** body `{ currentPassword, newPassword }`. Panjangnya
  ditegakkan di server (zod): `currentPassword` 8–128, `newPassword` 10–128 —
  sama dengan `minLength` yang sudah dipasang di form.
- **Field jawaban sukses:** `{ success: true, otherSessionsRevoked: true }`,
  **plus `target: "mailcow"`** kalau yang diganti kotak surat mailcow.
  Tidak ada `target` berarti kata sandi **lokal** yang diganti — itu terjadi
  pada akun darurat (`allow_local_login`) dan saat `AUTH_PROVIDER` bukan
  `MAILSERVER`. Cabang inilah yang menentukan kalimat suksesnya.
- **Efek samping yang perlu diberitahukan:** kedua jalur memanggil
  `revokeOtherSessions` — semua sesi lain milik orang itu dicabut. Perangkat
  lain yang sedang masuk akan terlempar. Itulah arti
  `otherSessionsRevoked: true`.
- **Batas perilaku:**
  | Status | Kode | Artinya di layar |
  |---|---|---|
  | 400 | `INVALID_PASSWORD` | kata sandi saat ini salah. Di mode mailcow ini hasil pengecekan ke mailserver, bukan ke database |
  | 502 | `MAILCOW_REJECTED` | mailserver menolak — paling sering API key read-only. **Bukan** salah pengguna; arahkan ke IT |
  | 503 | `MAILCOW_NOT_CONFIGURED` | server ini belum disiapkan untuk ganti kata sandi email |
  | 503 | `MAILSERVER_UNREACHABLE` | mailserver tak terjawab |

  Pada 502 dan kedua 503, **kata sandi belum berubah sama sekali** — pesannya
  sudah ditulis untuk dibaca pengguna, tampilkan apa adanya. Sama seperti di
  login: jangan tawarkan "lupa kata sandi" untuk tiga kode ini.



### Mode autentikasi — `GET /api/auth/mode`

- **Dipakai untuk:** layar yang harus berhenti menawarkan sesuatu yang tidak
  bisa dipakai — tautan "Lupa kata sandi?" dan judul form ganti kata sandi.
- **Cara pakai:** GET biasa, tanpa parameter. Boleh dipanggil **sebelum masuk**
  — layar login memang perlu tahu saat belum ada sesi.
- **Field jawaban:**
  | Field | Kapan ada | Nilai |
  |---|---|---|
  | `mode` | selalu | `"LOCAL"` atau `"MAILSERVER"` |
  | `allowLocalLogin` | **hanya kalau ada sesi sah** | `true` untuk akun darurat |
- **Batas perilaku:** `mode` adalah sifat server, jadi terbuka. `allowLocalLogin`
  menempel pada **orang**, jadi ia sengaja tidak ikut saat belum masuk — kalau
  ikut, siapa pun bisa menanyakan akun mana yang jadi pintu darurat, dan itu
  justru akun paling berharga untuk diserang ketika mailserver dimatikan.
  Jangan menyimpulkan `allowLocalLogin: false` dari ketiadaan field; periksa
  keberadaannya.

---

### Login menerima username, bukan cuma email

- **Dipakai untuk:** form masuk (admin & panel).
- **Cara pakai:** **tidak ada perubahan bentuk permintaan.** Field-nya tetap
  bernama `email` di body `{ email, password, remember }` — yang berubah cuma
  apa yang boleh diisi: alamat lengkap **atau** username, yaitu bagian sebelum
  `@`. `budi` dan `budi@perumnet.id` menuju akun yang sama.
- **Batas perilaku:**
  - Username dipetakan lewat akun yang **benar-benar ada**, bukan dengan
    menempelkan domain bawaan. Yang tidak cocok ke akun mana pun dijawab 401
    seperti biasa, dan tidak pernah dikirim ke mailcow.
  - Kalau dua akun punya bagian-lokal yang sama (`budi@perumnet.id` dan
    `budi@lain.id`), **tidak ada yang dipilih** — jawabannya 401. Tidak ada
    cara masuk lewat username untuk salah satunya; pakai alamat lengkap.
  - Throttle memakai ember yang sama untuk kedua ejaan, jadi berganti ejaan
    tidak menambah jatah percobaan.
  - Yang ditolak schema: string kosong, lebih dari 254 karakter, dan karakter
    di luar `A-Z a-z 0-9 . _ % + -` (plus `@` dan domain kalau alamat penuh).

### Reset kata sandi — mati saat mode mailserver

- **Dipakai untuk:** tautan "Lupa kata sandi?" di kedua layar login.
- **Batas perilaku:** saat `AUTH_PROVIDER=MAILSERVER`, **`POST
  /api/auth/forgot-password` dan `POST /api/auth/reset-password` keduanya
  menjawab 409 `PASSWORD_RESET_UNAVAILABLE`** dengan pesan yang mengarahkan
  ke reset kata sandi email lewat webmail atau IT.
- **Kenapa:** `reset-password` menulis `users.password_hash`, kolom yang di
  mode mailserver tidak dibaca untuk akun biasa. Sebelum penjaga ini ada,
  orang yang terkunci menempuh seluruh alur, melihat "berhasil", tetap tidak
  bisa masuk — dan sesinya ikut terhapus, jadi ia justru lebih terkunci.
- Penjaganya berjalan **sebelum** akun dicari, jadi jawabannya sama untuk
  alamat terdaftar maupun tidak. Jangan menyimpulkan apa pun tentang
  keberadaan akun dari kode ini.

---

## Tugas untuk Luna

Papan permintaan Opus → Luna (`WORKFLOW-TIM.md` §5). Backend-nya sudah jalan
di demo; yang tersisa murni tampilan. Tandai ✅ dan pindahkan ke §Selesai
kalau sudah dikerjakan.

### Status tugas — diperbarui 22 Agustus 2026

Daftar pendek supaya tidak ada yang tercecer di antara entri yang panjang.
Perinciannya di bagian masing-masing di bawah.

| | Tugas | Keadaan |
|---|---|---|
| **T-16** | Kirim SPK/PO ke vendor — dialog kirim, riwayat, batas unggah | ✅ selesai (`document-email-dialog.tsx`) |
| **T-18a** | **Pengelola template surat dokumen** | ✅ selesai (`document-template-manager.tsx`) |
| **T-18b** | Alamat email klien di form proyek | ✅ selesai (`project-view.tsx`) |
| **T-18c** | Kirim dari Quotation dan Invoice | ✅ selesai |
| **T-19** | Pusat Bantuan memuat fitur kirim dokumen | ✅ selesai (`help-view.tsx`, `94b1e0d`) |
| **T-20** | Bagan alur di Pusat Bantuan | ✅ selesai (`f32fdca`) |
| **T-21** | Tombol Jadikan proyek di Calon Klien | ✅ selesai (`f32fdca`) |
| **T-22** | Layar & Pusat Bantuan menyesuaikan aturan hasil audit | ✅ selesai (`f32fdca`) |
| **T-23** | **Pintu kedua pengelola template surat di Quotation & Invoice** | ✅ selesai (`billing-view.tsx`, `document-template-manager.tsx`) |

T-1 sampai T-18a sudah selesai; catatannya ada di §Selesai. Semua layar sudah
ada di `main`, termasuk editor kaya T-17 yang sempat tertinggal belum
di-commit dan T-18a yang di-commit menyusul pada 21 Agustus.

**Backend Fase 1–3 seluruhnya sudah selesai dan bertes, dan sudah masuk
`main`.** Layar pengelola template dokumen juga sudah tersedia, begitu pula
endpoint pratinjau yang kamu minta.

**Sudah di-deploy — termasuk T-18a.** Diperiksa langsung di VPS, commit
**`b30aa2d` berjalan di demo dan produksi** sejak 21 Agustus malam:

```
~/releases/perumnet-enterprise/b30aa2d              → pm2 perumnet-enterprise-demo  (3101)
~/releases/perumnet-enterprise-production/b30aa2d   → pm2 perumnet-enterprise-admin (3100)
```

Rilis sebelumnya (`2fe93bb`, `438a0e1`) masih utuh di kedua folder kalau perlu
mundur. **Ingat: `pm2 startOrRestart` tidak memindahkan `cwd`** — prosesnya
restart tapi tetap menunjuk rilis lama. Harus `pm2 delete` lalu `pm2 start`.

Artinya tombol Kirim dokumen **sudah tampil di produksi**. Yang menahannya
bukan deploy, tapi isi: tabel `document_email_templates` di produksi masih
kosong, jadi daftar templatenya kosong. Untuk sekarang itu belum melukai
siapa pun — produksi juga belum punya proyek, quotation, maupun invoice
(10 pengguna, sisanya nol). Template contoh sekarang dapat dikelola lewat
tab Procurement; isi produksi tetap perlu diisi oleh pengguna yang memiliki
izin Kelola Procurement.

Kalau ada yang menurutmu kurang atau kontraknya keliru, tulis di
`docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`. Menolak tugas karena kontraknya belum
mendukung — seperti yang kamu lakukan di T-15 untuk editor kaya — itu tepat,
dan lebih cepat daripada mengakalinya di sisi layar.

**T-6…T-10 punya kontrak tersendiri di `docs/PROSPEK-CALON-KLIEN.md`** —
seluruh endpoint, kode galat, aturan render template, dan perilaku impor ada di
sana. Yang di bawah ini ringkasannya.

### ✅ T-1. Layar login menangani 503 — SELESAI 2026-08-18

- **Layar:** form login (admin & panel).
- **Butuh:** jawaban **503 `MAILSERVER_UNREACHABLE`** kini mungkin muncul —
  artinya mailserver tidak terjawab, **bukan** kata sandi salah. Tampilkan
  `message` dari backend apa adanya, **tanpa** tautan "lupa kata sandi" dan
  tanpa kalimat yang menyiratkan kata sandinya keliru. Kalau ditampilkan
  seperti 401, orang akan mereset kata sandi email yang sebenarnya tidak
  bermasalah. 401 tetap seperti sekarang.
- **Kenapa tidak bisa diakali di sisi backend:** kodenya sudah dibedakan dan
  pesannya sudah ditulis untuk dibaca pengguna; yang menentukan apa yang
  terlihat tinggal layar ini.

### ✅ T-6–T-10 — SELESAI 2026-08-19

Implementasi layar `/admin` sudah selesai. Rincian hasil kerja dipindahkan ke
bagian **Selesai** di bawah; kontrak lengkap tetap berada di
`docs/PROSPEK-CALON-KLIEN.md`.

### ✅ T-11. Template surat: kotak teks biasa — SELESAI 2026-08-20

Implementasi pada tab **Template surat** sudah selesai di
`app/panel/prospects-editor.tsx`: form teks biasa, defaults server, tombol
**Pakai contoh**, empat bidang tanda tangan, `bodyFormat: "text"`, dan preview
surat utuh dari server tanpa menambahkan logo atau footer di sisi layar.

Kontrak backend lengkap tetap berada di `docs/PROSPEK-CALON-KLIEN.md`.

### ✅ T-12. Laporan pengiriman email — SELESAI 2026-08-20

Implementasi tab **Laporan kirim** sudah selesai di
`app/panel/prospects-editor.tsx`: daftar batch, detail per penerima, empat
summary status dari server, filter pencarian/status/tanggal, pagination,
alasan gagal apa adanya, serta polling 20 detik yang berhenti saat halaman
tidak terlihat. Tampilan responsif berada di
`app/panel/prospects.module.css`.

Kontrak backend dan batas status tetap berada di `docs/PROSPEK-CALON-KLIEN.md`.


- **Layar:** tab baru di `ProspectsEditor`, misal **"Laporan kirim"**.
- **Kenapa ini ada:** riwayat outreach dulu ditulis sekali saat tombol Kirim
  ditekan dan tidak pernah disentuh lagi. Ia bilang `Queued` selamanya —
  bahkan setelah suratnya benar-benar terkirim atau gagal permanen. Layar yang
  membacanya menampilkan kabar yang salah dengan penuh percaya diri.

**Sekarang statusnya benar-benar mengikuti kenyataan.** `server/email.ts`
menyalin nasib tiap baris ke riwayat begitu final.

**Dua endpoint baru, keduanya Admin saja:**

`GET /api/cms/prospects/outreach/batches?limit=30` — satu baris per penekanan
tombol Kirim:
```json
{ "items": [{
  "batchId": "…", "templateName": "Perkenalan PerumNet Enterprise",
  "createdAt": "…", "firstScheduledFor": "…", "lastScheduledFor": "…",
  "lastSentAt": "…",
  "total": 21, "sent": 18, "failed": 1, "queued": 2, "skipped": 0,
  "selesai": false
}] }
```

`GET /api/cms/prospects/outreach` — per penerima. Parameter: `q`, `status`,
`batchId`, `prospectId`, `from`, `to`, `page`, `pageSize`.
```json
{ "items": [{
  "id": "…", "batchId": "…", "prospectId": "…", "prospectName": "…",
  "companyName": "…", "templateName": "…", "recipient": "…", "subject": "…",
  "status": "Sent", "scheduledFor": "…", "sentAt": "…", "failureReason": "",
  "attempts": 1, "nextAttemptAt": null, "createdAt": "…", "hasBody": true
}],
  "page": 1, "pageSize": 25, "total": 21,
  "summary": { "Queued": 2, "Sent": 18, "Failed": 1, "Skipped": 0, "total": 21 } }
```

**Empat status, dan artinya tidak boleh ditukar:**

| Status | Artinya | Jangan tampilkan sebagai |
|---|---|---|
| `Queued` | **masih diproses** — menunggu jadwal, atau gagal tapi masih ada sisa percobaan | gagal |
| `Sent` | benar-benar diterima server surat | — |
| `Failed` | percobaan habis, tidak akan diulang lagi | sedang diproses |
| `Skipped` | tidak pernah diantre (opt-out, tanpa email, atau mode capture) | gagal |

**Kontrak yang dipenuhi:**

- Daftar batch dulu, lalu klik untuk melihat per penerima. Batch adalah cara
  orang mengingat pekerjaannya: *"kiriman tadi pagi ke 21 orang"*, bukan 21
  baris terpisah.
- Tampilkan `summary` sebagai empat angka. **Keempatnya selalu ada di jawaban,
  termasuk yang bernilai nol** — jangan sembunyikan yang nol, karena "0 gagal"
  adalah kabar yang ingin dibaca orang.
- `selesai: false` pada batch berarti masih ada yang berjalan. Perbarui
  otomatis selagi tab ini terbuka — polling 15–30 detik cukup. Jangan pasang
  polling saat tabnya tidak terlihat.
- `Failed` wajib menampilkan `failureReason` apa adanya. Alasan itu yang
  membedakan "alamatnya salah ketik" dari "mailserver mati".
- `attempts` dan `nextAttemptAt` berasal dari `email_outbox` dan **jadi `null`
  setelah 180 hari** ketika barisnya dipangkas. Statusnya sendiri tetap
  terbaca. Jangan tampilkan "0 percobaan" untuk `null`.
- Jeda antar surat membuat batch besar butuh puluhan menit. Tampilkan
  `lastScheduledFor` supaya tidak dikira macet.

**Yang tidak boleh dilakukan di layar:** menyimpulkan sendiri sebuah batch
"berhasil" dari menghitung baris. `selesai` sudah dihitung server; dua layar
yang menghitung sendiri akan menjawab berbeda untuk pertanyaan yang sama.

### ✅ T-13. Satu daftar status, bukan dua salinan — SELESAI 2026-08-20

Implementasi pada `app/panel/prospects-editor.tsx` sudah selesai: tipe, daftar,
dan label status laporan kini langsung memakai kontrak bersama dari
`shared/prospects.ts`; salinan lokal di layar dihapus.

- **Layar:** `prospects-editor.tsx` baris ~194.
- **Apa:** ganti salinan lokal

  ```ts
  const outreachStatuses: OutreachStatus[] = ["Queued", "Sent", "Failed", "Skipped"];
  ```

  dengan impor dari kontrak bersama:

  ```ts
  import {
    prospectOutreachStatuses,
    prospectOutreachStatusLabels,
  } from "../../shared/prospects";
  ```

  `prospectOutreachStatusLabels` sudah dwibahasa (`{ id, en }`), sama polanya
  dengan `prospectStatusLabels` yang tab daftar prospek pakai.

- **Kenapa:** daftarnya sempat hidup dua kali — satu di layar, satu di router —
  tanpa keduanya tahu. Router sekarang sudah memakai versi bersama. Kalau
  suatu saat isinya berbeda, server **diam-diam mengabaikan** nilai penyaring
  yang tidak dikenalnya: filternya terlihat berfungsi tapi tidak mempersempit
  apa pun, dan tidak ada pesan galat. Kegagalan yang tidak berbunyi seperti
  itu yang paling lama tidak ketahuan.
- Sisanya di T-12 tidak perlu diubah. Ini murni menghapus duplikasi.

### ✅ T-14. Calon Klien jadi modul izin, dan form kata sandi menampilkan syaratnya — SELESAI 2026-08-20

Dua hal terpisah, keduanya kecil.

Implementasi frontend selesai di `enterprise-app.tsx`, `prospects-editor.tsx`,
`settings-view.tsx`, dan stylesheet terkait. Backend/API, shared contract,
database, dan test tidak diubah.

#### a. Menu Calon Klien mengikuti izin, bukan peran

Penjaganya di server dulu `requireUser(request, ["Admin"])` — modulnya tidak
bisa diberikan kepada siapa pun tanpa mengubah kode. Sekarang ada modul
**`prospects`** di `shared/access.ts`.

Bawaannya: **Admin `manage`, Finance `manage`**, Project Manager dan Engineer
`none`. Diberikan ke Finance atas permintaan pemilik — merekalah yang menyusun
dan mengirim penawaran.

Di `enterprise-app.tsx`, item navigasinya sekarang:

```ts
{ id: "prospects", labelKey: "prospects", module: "prospects", icon: UsersRound }
```

Ganti jadi:

```ts
{ id: "prospects", labelKey: "prospects", module: "prospects", icon: UsersRound }
```

— `module` yang benar, dan **`roles` dihapus**: izinnya yang menentukan, bukan
nama peran. Render-nya juga:

```ts
{currentView === "prospects" && user.role === "Admin" && <ProspectsEditor />}
```

jadi `canUse("prospects")`, sama seperti modul lain.

**Layar Pengguna & Akses TIDAK perlu disentuh.** Grid-nya dibuat dari
`accessModules`, jadi baris "Calon Klien" muncul sendiri dan Admin bisa
menyalakannya per orang tanpa satu baris kode pun.

Server membedakan dua tingkat: **`view`** cukup untuk melihat daftar, laporan,
dan pratinjau; **`manage`** wajib untuk menyimpan, mengimpor, dan mengirim.
Kalau bisa, matikan tombol Kirim/Simpan/Impor saat izinnya hanya `view` —
server tetap menolak dengan 403, tapi tombol yang selalu gagal itu kasar.

Frontend menerapkan mode **read-only lengkap**: daftar, laporan, komposer, dan
preview tetap tersedia; tambah, impor, simpan, ubah opt-out, hapus, template,
dan antre kirim dinonaktifkan dengan penjelasan izin.

#### b. Form ganti kata sandi menampilkan syarat mailcow

Di mode MAILSERVER, yang diganti adalah kata sandi **mailbox** di mailcow. Ada
dua pihak yang berhak menolak, dan sampai sekarang syarat mailcow baru
ketahuan **setelah** kata sandi lama diverifikasi.

Endpoint baru, tanpa sesi pun boleh:

```
GET /api/auth/password-policy
→ { "policy": { "minLength": 10, "requireNumbers": false,
                "requireSpecialChars": false, "requireMixedCase": false,
                "requireLetters": false, "source": "app" },
    "description": "Kata sandi harus minimal 10 karakter." }
```

- Tampilkan `description` **di dekat kolom kata sandi baru, sebelum orang
  mengetik** — bukan sebagai galat sesudahnya.
- `minLength` dipakai untuk `minLength` pada input. **Jangan tulis angkanya
  sebagai konstanta di layar**: nilainya digabung dari aturan aplikasi dan
  aturan mailcow yang bisa diubah operator kapan saja tanpa deploy.
- Galat baru: **400 `PASSWORD_TOO_WEAK`**, dengan
  `details.unmet` berupa array kalimat pendek (`["minimal 12 karakter",
  "mengandung angka"]`). Tampilkan semuanya, jangan hanya yang pertama —
  menyuruh orang menebak satu per satu membuat mereka menyerah dan memakai
  kata sandi seadanya.
- `source: "mailcow"` berarti syaratnya datang dari mailserver; `"app"` berarti
  mailcow tidak terjawab atau mode-nya LOCAL, dan yang berlaku aturan aplikasi
  sendiri. Boleh dipakai untuk menjelaskan, tidak wajib.

Semua string dwibahasa tersedia lewat `shared/password-policy.ts`
(`describePasswordPolicy`, `passwordProblems`) kalau perlu merender sendiri.

### ✅ T-15. Pusat Bantuan memuat Calon Klien — SELESAI 2026-08-20

- **Layar:** `app/components/help-view.tsx`.
- **Kenapa ini ada:** isi Pusat Bantuan di layar **terpisah** dari isi PDF
  manual. PDF-nya (`server/api/sop-pdf-content.ts`) sudah saya perbarui dengan
  bab Calon Klien dan lima pesan kesalahan baru; layar ini belum. Orang yang
  membuka Pusat Bantuan sekarang tidak menemukan fitur yang sudah dipakainya
  setiap hari.

**Yang perlu ditambah — semuanya dua kali, `…Id` dan `…En`:**

1. **`workflowsId` / `workflowsEn`** — satu entri baru `key: "prospects"`,
   ditaruh setelah `catalog-ai` dan sebelum `access` (mengikuti urutan menu).
   Bentuknya sama dengan entri lain: `title`, `summary`, `who`, `where`,
   `prepare`, `steps[]`, `after`.

2. **`messagesId` / `messagesEn`** — lima pesan baru:

   | Pesan | Artinya | Tindakan |
   |---|---|---|
   | Alamat email itu sudah terdaftar pada prospek lain | satu alamat hanya untuk satu prospek | jawabannya membawa `prospectId`; buka yang lama dan periksa |
   | Peran Anda tidak memiliki akses ke Calon Klien | modulnya belum dinyalakan | minta Admin menyetelnya di Pengguna & Akses |
   | Anda hanya bisa melihat calon klien | izinnya baru Lihat | menyimpan, mengimpor, dan mengirim perlu Kelola |
   | Kata sandi baru harus … | belum memenuhi syarat gabungan aplikasi + mailserver | pesannya menyebut SEMUA syarat yang kurang sekaligus |
   | Mailserver sedang tidak bisa dihubungi | sambungan gagal, tidak ada yang berubah | coba lagi; ini BUKAN kata sandi salah |

3. **`glossaryId` / `glossaryEn`** — kalau menurut Anda perlu: *prospek*
   (berbeda dari *lead*), *batch*, *opt-out*.

4. **Dua kalimat lama yang kini keliru** — daftar menu Administrasi pada entri
   `key: "start"`:

   - baris ~81 (`Id`): *"Administrasi berisi Database Item serta Pengguna &
     Akses."* → sekarang juga **Calon Klien**.
   - baris ~321 (`En`): *"Administration holds Item Database and Users &
     Access."* → idem.

5. **Langkah kata sandi pada entri `key: "access"`** — sekarang berbunyi
   seolah tidak ada syarat. Sesuaikan dengan T-14b: syaratnya ditampilkan di
   form, gabungan aturan aplikasi dan mailserver, **yang lebih ketat menang**,
   dan **jangan menulis angkanya** di teks bantuan karena bisa berubah tanpa
   deploy.

**Isi yang harus tersampaikan pada entri baru** (silakan susun ulang kalimatnya
— ini poinnya, bukan naskah yang harus disalin):

- Calon Klien berbeda dari Lead. Lead datang dari formulir situs dan mencentang
  kotak privasi; prospek dikumpulkan tim sendiri dan **tidak pernah meminta
  dihubungi**. Karena itu catatan sumber wajib, dan opt-out selalu tersedia.
- Impor XLSX: kolom dikenali dari **judulnya**, bukan urutannya; **nama lembar
  menentukan segmen**; jalankan **uji kering dulu** — baris bermasalah
  dilaporkan lengkap dengan nomor barisnya, bukan dibuang diam-diam.
- Template ditulis sebagai **teks biasa**. Kop berlogo, tanda tangan, alamat
  kantor, dan catatan cara berhenti ditambahkan server.
- Tanda tangan menentukan **ke mana balasan mendarat**. Isi dengan kontak orang
  yang mengirim, bukan alamat umum.
- **Pratinjau dulu.** Yang tampil persis surat yang diterima calon klien.
- Jeda 60 detik per surat itu **disengaja**: 40 penerima ≈ 40 menit, bukan
  macet. Mailserver yang sama membawa invoice dan tautan pemulihan kata sandi.
- Empat status di Laporan kirim, dan yang paling mudah disalahpahami:
  **"Masih diproses" bukan kegagalan** — mengirim ulang karenanya membuat surat
  yang sama sampai dua kali.
- **Surat yang sudah diantre tidak bisa ditarik kembali.**

**Kalau ragu soal kalimatnya**, tiru saja dari PDF: bab `chapterProspects` di
`server/api/sop-pdf-content.ts` sudah dwibahasa dan sudah melewati review.
Berkas itu `server-only`, jadi **tidak bisa diimpor** ke layar — salin
teksnya, jangan mencoba mengimpornya.

### T-16. Kirim SPK/PO ke vendor lewat email — layarnya

**Boleh dimulai SEKARANG, sebelum backend selesai.** Kontrak di bawah sudah
dikunci; kalau saya harus mengubahnya, saya kabari lebih dulu, tidak diam-diam.

Konstanta batas dan daftar placeholder ada di **`shared/document-email.ts`** —
impor dari sana, **jangan menulis angkanya di layar**. Status pengiriman ada di
**`shared/email-delivery.ts`** (`emailDeliveryStatuses`,
`emailDeliveryStatusLabels`), sama persis dengan yang tab Laporan kirim pakai.

#### Kenapa ini ada

Hari ini alurnya: unduh PDF → kirim lewat email pribadi atau WhatsApp → kembali
ke aplikasi → tekan "Kirim" supaya statusnya jadi Dikirim. Dua tombol untuk satu
kejadian, dan yang lupa menekan tombol kedua meninggalkan SPK berstatus
Disetujui padahal sudah di tangan vendor.

**Dokumennya TIDAK diunggah.** Aplikasi merender PDF-nya sendiri saat tombol
Kirim ditekan. Unggahan hanya untuk lampiran *tambahan*.

#### Endpoint

**`GET /api/document-email-templates?documentType=spk`**
```json
{ "items": [{ "id": "…", "name": "…", "subject": "…", "bodyHtml": "…",
              "bodyFormat": "text", "documentType": "spk",
              "senderSignoff": "…", "senderName": "…",
              "senderEmail": "…", "senderPhone": "…",
              "language": "id", "createdAt": "…", "updatedAt": "…" }],
  "defaults": { "starter": { "name": "…", "subject": "…", "bodyHtml": "…",
                             "bodyFormat": "text" },
                "senderSignoff": "Hormat kami,",
                "senderName": "<akun yang masuk>",
                "senderEmail": "<akun yang masuk>",
                "senderPhone": "" } }
```
`POST` / `PATCH /:id` / `DELETE /:id` sama polanya dengan template prospek.

**`POST /api/document-email-templates/:id/preview`** — body
`{ "documentType": "spk", "documentId": "…" }`
```json
{ "subject": "…", "bodyHtml": "<dokumen HTML utuh>",
  "recipient": "vendor@contoh.id", "recipientName": "PT Vendor",
  "attachments": [{ "filename": "PO-2026-001.pdf", "byteSize": 84213 }] }
```
`bodyHtml` sudah surat lengkap berkop dan bertanda tangan — tampilkan di
`<iframe srcDoc sandbox="">` seperti `PreviewFrame` yang sudah ada.
`attachments` di sini **hanya dokumen yang dirender**; lampiran tambahan belum
ikut karena belum diunggah.

**`POST /api/procurement-orders/:id/send-email`** — **multipart/form-data**
| field | isi |
|---|---|
| `templateId` | id template |
| `files` | 0–5 berkas tambahan (boleh diulang) |

```json
{ "deliveryId": "…", "recipient": "…", "status": "Queued",
  "scheduledFor": "…",
  "attachments": [{ "filename": "PO-2026-001.pdf", "byteSize": 84213,
                    "generated": true },
                  { "filename": "company-profile.pdf", "byteSize": 1200334,
                    "generated": false }] }
```

**`GET /api/document-deliveries?documentType=spk&documentId=…`** — riwayat
kirim dokumen itu:
```json
{ "items": [{ "id": "…", "recipient": "…", "recipientName": "…",
              "subject": "…", "status": "Sent",
              "scheduledFor": "…", "sentAt": "…", "failureReason": "",
              "attachments": [{ "filename": "…", "byteSize": 0 }],
              "createdAt": "…", "createdByName": "…" }] }
```

#### Kode galat yang WAJIB ditangani

| HTTP | code | Tampilkan sebagai |
|---|---|---|
| 409 | `VENDOR_EMAIL_MISSING` | **bukan galat sistem.** `details.vendorName` ada; pesannya menyebut bahwa alamat vendor perlu diisi di Procurement & Vendor, dan bahwa yang boleh mengubahnya **Admin atau Finance**. Sediakan tautan ke vendornya |
| 409 | `ORDER_NOT_SENDABLE` | SPK belum Disetujui. Arahkan menyelesaikan persetujuan dulu |
| 413 | `ATTACHMENT_TOO_LARGE` | `details.filename` + batas per berkas |
| 413 | `ATTACHMENT_TOTAL_TOO_LARGE` | total melebihi batas; sebutkan totalnya |
| 422 | `ATTACHMENT_TOO_MANY` | lebih dari `ATTACHMENT_MAX_COUNT` |
| 415 | `INVALID_FILE_CONTENT` | isi berkas tidak cocok dengan jenisnya |
| 403 | `FORBIDDEN` | butuh izin Kelola pada Procurement |

#### Yang perlu dikerjakan

- Tombol **"Kirim ke vendor"** di detail SPK/PO. Aktif hanya saat izin
  Procurement **Kelola** dan SPK sudah Disetujui.
- Dialog kirim: pilih template · alamat penerima **ditampilkan, tidak bisa
  diedit** (datang dari data vendor) · daftar lampiran (dokumen yang dirender
  ditandai jelas sebagai otomatis) · tambah berkas · **pratinjau wajib sebelum
  tombol Kirim aktif**, sama seperti komposer prospek.
- Batas unggah diperiksa **juga di layar** supaya orang tidak menunggu unggahan
  10 MB hanya untuk ditolak. Server tetap memeriksa ulang — layar bukan penjaga.
- **Riwayat kirim** di detail dokumen: status, kapan, ke siapa, lampiran apa.
- Setelah kirim berhasil, muat ulang dokumennya: **statusnya ikut berubah jadi
  Dikirim**. Jangan menebak status baru di layar; baca dari server.

#### Yang TIDAK boleh dilakukan di layar

- **Jangan menyediakan unggah untuk dokumen resminya.** Hanya lampiran
  tambahan. Kalau muncul kebutuhan "ganti PDF-nya", itu keputusan backend.
- **Jangan menampilkan atau menawarkan salinan internal.** SPK punya edisi
  internal yang memuat anggaran PerumNet per item; ia tidak boleh sampai ke
  vendor. Jalur email tidak menerima pilihan edisi sama sekali.
- Jangan menyimpulkan sendiri apakah pengiriman "selesai" dari menghitung
  baris — baca `status` per baris.

### ✅ T-17. Editor kaya untuk isi surat — SELESAI 2026-08-20

Kamu menolak ini di T-15 dengan alasan kontraknya masih `bodyFormat: "text"`.
**Itu keputusan yang benar** — dan memang bagian saya. Sekarang sudah dibuka.

#### Yang berubah di backend

`bodyFormat` menerima nilai ketiga: **`"rich"`**.

**Yang disimpan BUKAN HTML.** `rich` menyimpan penanda ringan, dan server yang
mengubahnya jadi HTML dari kumpulan tag yang tertutup:

| Ketikan | Jadi |
|---|---|
| `**tebal**` | `<strong>` |
| `*miring*` | `<em>` |
| `- baris` (satu blok penuh) | `<ul><li>` |
| `1. baris` (satu blok penuh) | `<ol><li>` |
| `[teks](https://…)` atau `[teks](mailto:…)` | `<a href>` |
| baris kosong | paragraf baru |

Tautan selain `http`, `https`, dan `mailto` **ditolak dan ditampilkan sebagai
tulisan biasa**, bukan dibuang — yang hilang diam-diam tidak pernah diperbaiki
siapa pun.

#### Kenapa penanda, bukan HTML

Repo ini **tidak punya penyanitasi HTML sama sekali**, dan menulis sendiri
adalah jenis kode yang terlihat benar sampai suatu hari tidak. Menempel dari
Word atau dari halaman web juga membawa `<style>`, gambar pelacak, dan markup
yang merusak tampilan di klien email sekaligus menaikkan skor spam.

Dengan menghasilkan seluruh tag-nya sendiri, amannya berasal dari **bentuk
kodenya**, bukan dari daftar larangan yang harus selalu lengkap.

#### Yang perlu dikerjakan

- Toolbar sederhana pada kolom **Isi surat**: tebal, miring, daftar berbutir,
  daftar bernomor, tautan. Boleh WYSIWYG, boleh tombol yang menyisipkan
  penanda — dari sisi pengguna keduanya terasa sama.
- **Yang dikirim ke server tetap penandanya**, bukan HTML, dan
  `bodyFormat: "rich"`.
- Kalau memakai editor WYSIWYG, ia harus **mengeluarkan penanda**. Jangan
  mengirim HTML lalu berharap server membersihkannya — server tidak
  membersihkan HTML, ia meng-*escape* seluruhnya. Kirim HTML dengan
  `bodyFormat: "rich"` dan yang sampai ke penerima adalah tag-tag yang tampil
  mentah sebagai tulisan.
- **Menempel dari Word harus dijinakkan di layar**: ambil `text/plain`-nya,
  bukan `text/html`. Kalau tidak, orang menempel satu paragraf dan mendapat
  layar penuh tanda kurung siku.
- Template lama tetap `"text"` dan **harus tetap apa adanya**. Jangan
  memigrasikannya diam-diam; `**` di template lama memang bintang.
- Pratinjau tidak berubah: ia sudah menampilkan surat utuh dari server, jadi
  ia sudah menunjukkan hasil penanda yang sebenarnya.

#### Yang TIDAK boleh dilakukan di layar

- **Jangan membangun penyanitasi HTML di layar.** Ia bukan penjaga: permintaan
  bisa dikirim tanpa lewat layar sama sekali.
- **Jangan menyentuh `bodyFormat: "html"`.** Nilai itu masih ada untuk markup
  yang ditulis sengaja oleh orang yang tahu persis apa yang ia tulis, dan ia
  **tidak disanitasi**. Ia tidak boleh menjadi keluaran sebuah editor.

### T-18. Yang masih kurang supaya kirim dokumen benar-benar bisa dipakai

Backend Fase 1–3 sudah selesai dan bertes (291/291). Tiga hal di bawah adalah
sisanya, dan **dua di antaranya memang belum pernah saya tuliskan** — ketahuan
saat memeriksa ulang, bukan saat menulis T-16.

Tanpa (a), tombol Kirim punya daftar template yang kosong dan tidak ada cara
mengisinya dari mana pun.

**Diperiksa ulang 2026-08-21 — (b) dan (c) sudah dikerjakan, dan layar (a)
sekarang juga sudah tersedia.** Hasil pemeriksaan, bukan ingatan:

| | Keadaan | Bukti |
|---|---|---|
| Backend (a) | ada | `server/api/document-email-router.ts`, tabel `document_email_templates` di `server/db/initialize.ts:1395` |
| Backend (b) | ada | kolom `client_email` + `client_contact_name`, ditambahkan lewat `ensureColumn` (`server/db/initialize.ts:3302`) |
| Backend (c) | ada | SPK/PO `procurement-router.ts:2164`, quotation `commercial-scope-router.ts:879`, invoice `router.ts:3485` |
| Tes | 291/291 lulus | `npm test`, 20 Agustus |
| Isi database | **3 template contoh**, 5 proyek, **0 punya email klien** | disiapkan lewat `scripts/seed-template-dokumen.mjs` |

- **(b) sudah jadi** — `project-view.tsx` punya isian email + PIC klien dan
  mem-PATCH keduanya. Tidak ada yang perlu dikerjakan lagi.
- **(c) sudah jadi** — `document-email-dialog.tsx` terpasang di `billing-view`,
  `project-view`, dan `procurement-v2-view`, lengkap dengan riwayat kirim dan
  keadaan kosong.
- **(a) sudah jadi** — `document-template-manager.tsx` menyediakan daftar per
  jenis dokumen, CRUD template, defaults pengirim dari server, placeholder
  dinamis dari jawaban server, editor `text`/`rich`, dan keadaan read-only
  sesuai izin Kelola Procurement. Template tersimpan langsung tersedia di
  dialog Kirim dokumen.

Satu koreksi kecil untuk (c): `document-email-dialog.tsx:475` membaca
`defaults?.starter`, padahal endpoint template dokumen **tidak pernah
mengirim** `starter` — hanya endpoint template prospek yang punya itu
(`prospect-router.ts:434`). `defaults` di sini isinya persis empat field:
`senderSignoff`, `senderName`, `senderEmail`, `senderPhone`. Cabang itu mati,
tidak pernah jalan. Tidak merusak apa pun karena teks cadangannya sudah benar,
jadi cukup dibuang saat lewat sana — bukan pekerjaan tersendiri.

#### a. Pengelola template surat dokumen — ✅ SELESAI 21 Agustus 2026

Endpoint-nya sudah ada dan berpola sama persis dengan template prospek:

```
GET    /api/document-email-templates?documentType=spk|quotation|invoice
POST   /api/document-email-templates
PATCH  /api/document-email-templates/:id
DELETE /api/document-email-templates/:id      (soft delete)
```

Bentuk barisnya sama dengan template prospek, **plus** `documentKind`
(`"spk" | "quotation" | "invoice"`) yang wajib. Jawaban `GET` juga membawa:

```json
{ "items": [...],
  "defaults": { "senderSignoff": "Hormat kami,",
                "senderName": "<akun yang masuk>",
                "senderEmail": "<akun yang masuk>",
                "senderPhone": "" },
  "placeholders": { "spk": ["nomor","vendor","proyek","nilai","mulai","selesai"],
                    "quotation": ["nomor","klien","proyek","nilai","berlaku_sampai"],
                    "invoice": ["nomor","klien","proyek","nilai","jatuh_tempo","sisa"] } }
```

- Placeholder **berbeda per jenis dokumen** — ambil dari `placeholders` di
  jawaban, jangan ditulis di layar. Template invoice yang dipakai untuk SPK
  ditolak server dengan `422 TEMPLATE_KIND_MISMATCH`.
- `bodyFormat` mendukung `"text"` dan `"rich"` — editor kaya T-17 bisa dipakai
  ulang apa adanya.
- Izinnya modul **Procurement**, bukan Prospects. (Fase ini melayani SPK; saat
  quotation/invoice ikut, penjaganya jadi per-jenis-dokumen.)

**Database sekarang sudah berisi tiga template contoh** (satu per jenis
dokumen), diisi lewat `scripts/seed-template-dokumen.mjs` 21 Agustus. Artinya
kamu bisa menguji layar ini terhadap data sungguhan sejak baris pertama, dan
tombol Kirim di T-16/T-18c sudah bisa dicoba ujung-ke-ujung sekarang:

```
node scripts/seed-template-dokumen.mjs             # lihat dulu, tidak menulis
node scripts/seed-template-dokumen.mjs --terapkan  # baru menulis
```

Skrip itu **bukan pengganti layar ini** — ia hanya menyalakan jalur yang sudah
selesai di backend. Tidak ada cara membuat, menyunting, atau menghapus template
dari dalam aplikasi sampai layar ini ada, dan seed hanya jalan di mesin yang
databasenya bisa disentuh dari terminal. Isinya juga sengaja polos: `sender_*`
dikosongkan supaya server jatuh ke kontak perusahaan.

##### Pratinjau surat lengkap — `POST /api/document-email-templates/:id/preview`

Permintaanmu di `PERMINTAAN-FRONTEND-KE-BACKEND.md` sudah dikerjakan
21 Agustus 2026. Bentuknya persis yang kamu minta:

```
POST /api/document-email-templates/<templateId>/preview
{ "documentType": "spk" | "quotation" | "invoice", "documentId": "<id dokumen>" }
```

Jawabannya **identik bentuknya** dengan `send-email-preview` per dokumen yang
sudah kamu pakai di dialog Kirim:

```json
{ "subject": "...", "bodyHtml": "...",
  "recipient": "vendor@contoh.test", "recipientName": "PT Vendor",
  "attachments": [{ "filename": "...", "byteSize": 12345, "generated": true }] }
```

Bukan cuma mirip — **sama**. Keduanya memanggil penyusun surat yang sama, dan
ada tes yang membandingkan hasil kedua jalur huruf demi huruf untuk SPK dan
quotation. Jadi yang kamu tampilkan di pengelola template memang yang akan
diterima penerima, bukan tiruannya.

Yang perlu kamu tahu di layar:

- **Jenis harus cocok.** Template SPK dipakai untuk dokumen quotation ditolak
  `422 TEMPLATE_KIND_MISMATCH`, dan `details.documentKind` berisi jenis
  template yang sebenarnya — cukup untuk menunjuk tab yang benar tanpa menebak.
- **`documentType` di luar tiga nilai itu ditolak 422** sebelum menyentuh
  database.
- **Hanya POST.** `GET` ke path yang sama menjawab `405 METHOD_NOT_ALLOWED`.
- **Dokumen yang tidak ada menjawab 404**, bukan 500.
- **Aturan dokumennya tetap berlaku.** Ini jalur pratinjau, bukan pintu
  belakang: SPK yang belum Disetujui tetap `409 ORDER_NOT_SENDABLE`, dan proyek
  tanpa alamat email klien tetap `409 CLIENT_EMAIL_MISSING`. Pratinjau butuh
  penerima yang sungguhan ada.
- **Izinnya per jenis dokumen, bukan Procurement untuk semuanya.** `spk`
  memakai izin Procurement; `quotation` dan `invoice` memakai izin Billing —
  sama dengan yang boleh mengirimnya. Ini disengaja: yang boleh melihat surat
  invoice adalah yang boleh mengirim invoice.
- **Dokumen contohnya kamu yang pilih.** Endpoint ini tidak menebak dokumen
  mana yang mewakili; ia butuh `documentId` yang sungguhan ada.

#### b. Alamat email klien di form proyek — ✅ SUDAH JADI, tidak perlu dikerjakan

`projects` sekarang punya dua kolom baru, dan keduanya sudah ikut di
`GET`/`POST`/`PATCH /api/projects`:

| Field | Isi |
|---|---|
| `clientEmail` | boleh kosong; divalidasi sebagai email kalau diisi |
| `clientContactName` | nama PIC klien, boleh kosong |

- Kirim string kosong = **hapus alamatnya**. Menghilangkan field-nya dari body
  = jangan diubah. Bedanya nyata di server.
- **Setiap proyek lama tidak punya alamat**, jadi keadaan kosong itu normal —
  jangan ditampilkan sebagai galat atau data rusak.

#### c. Kirim dari Quotation dan Invoice — ✅ SUDAH JADI

Sama polanya dengan T-16, hanya rutenya berbeda:

```
POST /api/quotations/:id/send-email            (multipart: templateId, files[])
POST /api/quotations/:id/send-email-preview    (JSON: { templateId })
GET  /api/quotations/:id/deliveries

POST /api/invoices/:id/send-email
POST /api/invoices/:id/send-email-preview
GET  /api/invoices/:id/deliveries
```

Izin: modul **Billing** tingkat **Kelola**.

Kode galat tambahan di luar yang sudah disebut T-16:

| HTTP | code | Tampilkan sebagai |
|---|---|---|
| 409 | `CLIENT_EMAIL_MISSING` | bukan galat sistem; `details.projectName` ada. Arahkan mengisi alamat klien di Manajemen Proyek, dan sediakan tautannya |
| 409 | `CLIENT_EMAIL_INVALID` | alamat tersimpan tidak valid |
| 409 | `QUOTATION_NOT_SENDABLE` | quotation Void/Rejected/Superseded |
| 409 | `TAX_RULE_REQUIRED` | quotation Draft berpajak yang belum punya aturan pajak — muncul saat transisinya berjalan |

**Dua perilaku yang harus tercermin di layar:**

- **Quotation berstatus Draft ikut berubah jadi Terkirim** saat diemail, lewat
  transisi yang sama dengan tombol "Tandai sudah dikirim" — termasuk
  **penguncian item BoQ**. Muat ulang dokumennya setelah kirim; jangan menebak
  status barunya di layar.
- **Invoice TIDAK berubah statusnya.** `Lunas`/`Belum Lunas` itu keadaan
  pembayaran. Riwayat kirimnya ada di `/deliveries`, bukan di status. Jangan
  menampilkan "sudah dikirim" sebagai status invoice.

#### Yang TIDAK perlu dikerjakan

- **BAST.** Sengaja belum ikut: yang sudah final punya PDF terpatok hash dan
  sudah punya jalur sendiri lewat halaman verifikasi bertoken.
- **Unggah untuk dokumen resminya.** Sama seperti T-16 — hanya lampiran
  tambahan.
- **Pilihan edisi dokumen.** Jalur email tidak menerimanya sama sekali.

### ✅ T-23. Pengelola template surat punya pintu di Quotation & Invoice — SELESAI 22 Agustus 2026

**Masalahnya bukan datanya, melainkan letaknya.** Template dokumen sudah
dipisah per jenis (`spk` / `quotation` / `invoice`) dengan penanda dan izin
sendiri-sendiri. Yang keliru: pengelolanya cuma ada sebagai tab di Procurement
& Vendor, padahal quotation dan invoice dikerjakan di layar lain. **Jangan
bikin tabel atau komponen kedua** — pakai ulang `DocumentTemplateManager` yang
sudah ada.

#### Yang berubah di server (sudah jadi, tinggal dipakai)

`GET /api/document-email-templates` sekarang memulangkan tiga field tambahan:

```json
{ "items": [...], "defaults": {...}, "placeholders": {...},
  "viewableKinds":   ["quotation", "invoice"],
  "manageableKinds": ["quotation", "invoice"],
  "audience": { "quotation": "klien", "invoice": "klien", "spk": "vendor" } }
```

- **Daftarnya disaring, bukan ditolak.** Akun yang hanya punya izin Quotation &
  Invoice mendapat template klien saja; template SPK tidak ikut terkirim dan
  tidak memicu 403. Jadi layar tidak perlu menebak-nebak dari peran.
- **Izin mengikuti jenis**: `spk` → Procurement & Vendor, `quotation`/`invoice`
  → Quotation & Invoice. Menyentuh jenis yang tidak boleh → `403 FORBIDDEN`
  dengan `details.documentKind` dan `details.module`.
- **Kategori penerima** ada di `shared/document-email.ts`:
  `documentEmailAudience` dan `documentEmailAudienceLabels`
  ("Surat ke klien" / "Surat ke vendor"). Template calon klien **bukan** bagian
  dari sini — ia sistem terpisah di Calon Klien, dan memang harus terpisah.

#### Yang perlu dikerjakan

1. **Tab "Template surat" di Quotation & Invoice** (`billing-view.tsx`),
   memakai `DocumentTemplateManager` dengan jenis yang disaring ke
   `["quotation", "invoice"]`. Tab yang sudah ada di
   `procurement-v2-view.tsx` disaring ke `["spk"]`.
   Komponennya perlu prop baru, misalnya `kinds?: DocumentEmailKind[]` —
   tanpa prop itu perilakunya seperti sekarang (semua yang boleh).
2. **Sembunyikan tab yang tidak berizin.** Pakai `viewableKinds` dari respons,
   bukan `canAccess` yang dihitung ulang di layar: server yang menegakkan,
   server pula yang menjawab. Tombol simpan/hapus mengikuti `manageableKinds`.
3. **Judul kelompok** memakai `documentEmailAudienceLabels` — "Surat ke klien"
   di Billing, "Surat ke vendor" di Procurement. Ini yang diminta pemilik:
   supaya sekali lihat ketahuan surat ini untuk siapa.
4. **Tombol "Buat template" di dialog Kirim.** Saat daftarnya kosong,
   `document-email-dialog.tsx` sekarang hanya menulis "Buat template dokumen
   terlebih dahulu" — jalan buntu. Beri tombol yang membawa pengguna ke
   pengelolanya (tab di layar yang sama), dengan jenis dokumen sudah terpilih.

#### Yang TIDAK berubah

Template **Calon Klien** tetap di tempatnya dan tetap sistem sendiri:
penerimanya belum jadi klien, penandanya berbeda (`{{nama}}`, `{{perusahaan}}`,
`{{segmen}}`), ada aturan opt-out dan jeda kirim, dan tidak ada dokumen resmi
yang dilampirkan. Menyatukannya berarti template perkenalan bisa terpilih untuk
invoice, lalu `{{jatuh_tempo}}` tidak pernah terisi.

**Kirim BAST lewat email belum ada** dan diputuskan pemilik belum diperlukan
(22 Agustus 2026). Kalau kelak dibutuhkan, itu jenis dokumen baru di server
lebih dulu, bukan template yang dikarang di layar.

Implementasi selesai di `billing-view.tsx`, `document-template-manager.tsx`,
`procurement-v2-view.tsx`, dan `document-email-dialog.tsx`. QA browser
memverifikasi tab Billing hanya menampilkan template klien, Procurement hanya
menampilkan SPK/PO, label audience, serta layout mobile. Full suite lulus
352/352.

### ✅ T-20. Bagan alur aplikasi di Pusat Bantuan — SELESAI 22 Agustus 2026

**Endpoint:** `GET /api/help/alur.png?language=id|en` — di balik sesi, memulangkan
`image/png` 2800 px lebar (rasio ±1 : 1,32), `Cache-Control: private,
max-age=3600`. Gambar yang persis sama sudah tercetak di panduan PDF bab 2.

**Data bersama:** `shared/alur-aplikasi.ts` — `aluraplikasi` (5 fase, 22
langkah, 4 keputusan), `semuaLangkah()`, dan tipe-tipenya. Setiap langkah punya
`label[id,en]`, `peran[]`, `layar` (kunci `ViewKey` yang sama dengan
`enterprise-app.tsx`), dan `syarat?[id,en]`.

**Yang perlu dikerjakan di `help-view.tsx`:**

1. Satu bagian baru di bagian atas (sebelum kartu alur kerja): `<img>` ke
   endpoint di atas dengan `alt` dua bahasa, `loading="lazy"`, lebar penuh
   panel, `max-width: 100%`. Gambar ini butuh sesi — `<img>` biasa sudah
   membawa cookie karena origin sama; tidak perlu `fetch`.
2. Di bawah gambar, daftar teks per fase dari `aluraplikasi` (judul fase →
   langkah bernomor: label · peran · syarat). Ini yang membuat bagannya bisa
   dicari oleh kotak pencarian yang sudah ada dan terbaca pembaca layar.
3. Jangan menggambar ulang bagannya dengan CSS/SVG — satu sumber gambar.

### ✅ T-21. Tombol "Jadikan proyek" di Calon Klien — SELESAI 22 Agustus 2026

**Endpoint:** `POST /api/cms/prospects/:id/convert` → `201 { project, prospect }`.

```json
{ "name": "opsional, default nama perusahaan",
  "status": "Draft" | "Aktif",          // default Draft
  "managerId": "opsional",
  "startDate": "YYYY-MM-DD, opsional",
  "targetDate": "YYYY-MM-DD, opsional",
  "location": "wajib HANYA bila prospek tidak punya lokasi" }
```

Yang dibawa otomatis: `companyName → client`, `fullName → clientContactName`,
`email → clientEmail`, `location → location`. Prospek diset `Won`.

**Kode galat yang wajib ditangani:**
- `409 PROSPECT_ALREADY_CONVERTED` — `details.projectId`, `details.projectCode`:
  tampilkan tautan ke proyeknya, jangan tombolnya.
- `409 PROSPECT_NOT_CONVERTIBLE` — prospek Lost atau minta berhenti dihubungi.
- `422 LOCATION_REQUIRED` — minta lokasi di dialog.
- `403 FORBIDDEN` — pengguna tidak punya Kelola Proyek (Finance bawaan):
  sembunyikan tombolnya lewat `canAccess(permissions, "projects", "manage")`.
- `409 INVALID_PROSPECT_TRANSITION` (di PATCH status) — `details.from/to`.

**Yang perlu dikerjakan:**
1. Tombol **Jadikan proyek** di detail prospek, tampil bila
   `!prospect.projectId && prospect.status !== "Lost" && !prospect.optOutAt`
   dan pengguna punya izin proyek. Dialog: nama proyek (prefilled), status,
   manajer (dari `staff` yang sudah ada di respons daftar), tanggal, lokasi
   bila kosong. Sukses → navigasi ke proyek (`project.id`).
2. Lencana **Proyek PN-…** pada baris daftar dan detail ketika `projectId`
   terisi (`projectCode` sudah ada di respons daftar & detail).
3. Dropdown status memakai `allowedProspectTransitions(status)` dari
   `shared/prospects.ts` — pilihan di luar tabel tidak ditawarkan. Server tetap
   menegakkannya.

### ✅ T-22. Layar & Pusat Bantuan menyesuaikan aturan hasil audit — SELESAI 22 Agustus 2026

Aturan yang berubah (semuanya sudah ditegakkan server dan ditulis di panduan
PDF edisi 2.1 — ambil teksnya dari bab yang disebut):

| Aturan | Bab PDF | Yang berubah di layar |
|---|---|---|
| Termin **wajib** dipilih saat bayar vendor (`422 TERM_REQUIRED`); bukti per termin (`409 PAYMENT_NOT_EARNED_FOR_TERM`, `details.payableForTerm`); kas harus > 0 (`422 CASH_AMOUNT_REQUIRED`) | Procurement | `procurement-v2-view.tsx`: dropdown termin `required`; tampilkan `payableForTerm` saat ditolak |
| Laba: `409 NO_DISTRIBUTABLE_PROFIT` kini membawa `details.distributableProfit` & `details.lockedAmount`; ringkasan punya field baru `lockedAmount` | Membagi keuntungan | `profit-sharing-panel.tsx`: tampilkan "Sudah dikunci" (`lockedAmount`) terpisah dari `allocatedAmount` |
| Bank: pencocokan manual menolak > 14 hari (`422 MATCH_DATE_TOO_FAR`, `details.distanceDays`) | Mencocokkan mutasi bank | tampilkan pesannya apa adanya |
| Aturan pajak Withhold hanya Payable/Receivable (`422 TAX_RULE_TREATMENT_INVALID`) | Menutup pembukuan & pajak | form aturan pajak: batasi pilihan perlakuan saat efek = Withhold |
| Status prospek mengikuti tabel transisi | Calon Klien | lihat T-21 |
| Riwayat quotation memulangkan `scopeId` per baris | Penawaran | opsional: kelompokkan riwayat per scope (Original vs Addendum) |

**Pusat Bantuan (`help-view.tsx`):** perbarui entri `procurement`, `profit`,
`bank`, `tax`, `prospects`, `invoice-payment`, `installment`, `handover`, dan
tambahkan sebelas pesan baru ke `messagesId`/`messagesEn` — semuanya sudah
tertulis di `chapterMessages` pada `server/api/sop-pdf-content.ts` (sebelas
baris terakhir). Jangan tulis ulang angkanya: jendela bank 14 hari, edisi 2.1.


### ✅ T-19. Pusat Bantuan memuat fitur kirim dokumen lewat email — SELESAI 21 Agustus 2026

**Berkas:** `app/components/help-view.tsx` — satu berkas, data saja. Tidak ada
`server/**`, `shared/**`, atau `db/` yang perlu disentuh.

**Kenapa ini penting, bukan sekadar rapi.** Pusat Bantuan yang diam tentang
fitur yang sudah ada lebih berbahaya daripada Pusat Bantuan yang tidak ada:
pembacanya menyimpulkan fiturnya memang belum ada, lalu mengirim dokumen
lewat jalan lain. Fitur ini sudah berjalan di produksi sejak Agustus 2026.

**Naskahnya sudah ada, tinggal dipindahkan.** Saya sudah menulis materi yang
sama untuk panduan PDF: `server/api/sop-pdf-content.ts`, cari
`chapterDocumentEmail`. Di sana setiap kalimat berpasangan `[Indonesia,
Inggris]`, jadi kedua bahasa sudah tersedia. **Baca dari sana, jangan
mengarang ulang** — kalau dua rujukan menjelaskan aturan yang sama dengan kata
berbeda, salah satunya pasti keliru dan tidak ada yang tahu yang mana.

Pusat Bantuan memang lebih ringkas daripada panduan PDF; itu disengaja dan
tertulis di panduannya sendiri. Ringkas, jangan salin mentah-mentah.

#### a. Satu entri alur kerja baru

Tambahkan satu `WorkflowGuide` di `workflowsId` **dan** padanannya di
`workflowsEn`, disisipkan tepat setelah entri `key: "procurement"` supaya
urutannya sama dengan panduan PDF.

```ts
{
  key: "document-email",
  icon: Mail,                     // lucide-react, sudah dipakai di berkas ini
  title: "Mengirim dokumen resmi lewat email",
  summary: "...",
  who: "...",
  where: "...",
  prepare: "...",
  steps: ["...", "..."],
  after: "...",
}
```

Isinya diambil dari `chapterDocumentEmail`: `lead` → `summary`, tiga baris
`meta` → `who` / `where` / `prepare`, `steps` → `steps`, dan `note` +
`bullets` → `after`.

Empat hal yang **wajib ikut**, sebab justru itu yang paling mudah salah
dipahami dan tidak bisa ditebak dari layar:

1. **Kirim dan Kirim Email berbeda.** Kirim berarti dokumen dinyatakan sudah
   sampai ke vendor lewat cara apa pun, dan ia gerbang yang membuka
   pembayaran. Kirim Email benar-benar mengirim suratnya. Dipisah supaya
   kemampuan membayar tidak pernah bergantung pada satu jabat tangan SMTP.
2. **Status Invoice TIDAK berubah karena dikirim** — status invoice adalah
   keadaan pembayaran, bukan pengiriman. Tapi **Quotation Draft ikut ditandai
   terkirim** lewat transisi yang sama dengan tombol Tandai sudah dikirim,
   termasuk penguncian item BoQ-nya.
3. **PDF SPK yang dikirim ke vendor adalah edisi vendor**, tanpa kolom Budget.
4. **Izinnya per jenis dokumen:** SPK/PO butuh Kelola pada Procurement &
   Vendor; Quotation/Invoice butuh Kelola pada Quotation & Invoice.

#### b. Enam entri pesan kesalahan baru

Tambahkan enam `MessageGuide` di `messagesId` **dan** `messagesEn`. Keenamnya
sudah saya tulis lengkap dengan arti dan jalan keluarnya di bab
`chapterMessages` pada `sop-pdf-content.ts` — enam baris terakhir sebelum
`chapterAppendix`:

| `key` yang disarankan | Pesannya |
|---|---|
| `template-kind-mismatch` | Template ini bukan untuk Quotation / Invoice / SPK |
| `client-email-missing` | Proyek … belum punya alamat email klien |
| `vendor-email-missing` | Vendor … belum punya alamat email |
| `order-not-sendable` | Hanya dokumen yang sudah Disetujui yang dapat dikirim ke vendor |
| `template-required` | Pilih template surat lebih dulu |
| `attachment-too-large` | Seluruh lampiran melebihi batas 10 MB per email |

Jangan menulis ulang angkanya dari ingatan. Batas yang berlaku ada di
`shared/document-email.ts`: 5 lampiran tambahan, 10 MB per berkas, 10 MB
untuk seluruh lampiran termasuk dokumen resminya, dan hanya PDF, PNG, JPEG,
serta WebP.

#### c. Entri glosarium, kalau perlu

`glossaryId` / `glossaryEn` belum punya istilah untuk fitur ini. Kalau menurutmu
"Template surat dokumen" atau "Riwayat kirim" layak masuk, silakan — ini
penilaianmu, bukan keharusan.

**Selesai berarti:** `npm run lint` bersih, dan Pusat Bantuan dalam kedua
bahasa memuat alur kerja itu beserta keenam pesannya. Panduan PDF-nya sudah
punya tes yang menjaga isinya (`tests/document-content.test.mjs`); kalau kamu
mau menambah tes serupa untuk Pusat Bantuan, silakan, tapi tidak wajib.

### Selesai

- **T-1** — `auth-screen.tsx` dan `panel-app.tsx` membedakan 503
  `MAILSERVER_UNREACHABLE` dari 401. Diverifikasi dari kode.
- **T-2** — `settings-view.tsx` mempertahankan form dan endpoint yang sama,
  menjelaskan password email MailCow untuk webmail/aplikasi PerumNet lain,
  memakai `{ target: "mailcow" }` untuk copy sukses, dan meneruskan pesan
  backend untuk empat kode error MailCow. Form/copy dan error kredensial
  diverifikasi melalui browser; submit sukses MailCow tidak dijalankan karena
  memerlukan perubahan password nyata.
- **T-3** — `auth-screen.tsx` dan `panel-app.tsx` membaca `GET /api/auth/mode`,
  menyembunyikan pemulihan password saat mode mailserver, dan menampilkan
  arahan reset lewat webmail atau IT. Diverifikasi pada mode `MAILSERVER` dan
  `LOCAL`.
- **T-4** — form login admin dan panel menyebut email maupun username,
  memakai input teks tanpa validasi browser email, serta mempertahankan body
  login `{ email, password, remember }`. Username `budi` diverifikasi pada
  desktop dan mobile.
- **T-5** — `settings-view.tsx` membaca `allowLocalLogin` dari
  `GET /api/auth/mode` dan membedakan seluruh copy keamanan password aplikasi
  untuk akun darurat dari copy password email. Diverifikasi pada desktop dan
  viewport 375 px.
- **T-6** — `ProspectsEditor` di `/admin` memakai daftar server, filter
  paginasi, tab segmen dari `shared/prospects.ts`, source yang terlihat, dan
  checkbox yang mengikuti `emailable` dari server.
- **T-7** — form tambah manual mengirim `POST /api/cms/prospects`, mewajibkan
  source, serta menyediakan tombol buka prospek lama dari
  `EMAIL_ALREADY_LISTED.details.prospectId`. Detail juga mendukung PATCH,
  opt-out satu arah, riwayat outreach, dan soft delete.
- **T-8** — impor XLSX multipart memakai dry-run sebagai langkah pertama dan
  menampilkan sheet, jumlah, serta setiap isu dengan nama sheet dan nomor baris
  sebelum tombol simpan diaktifkan.
- **T-9** — komposer mengirim batch ke endpoint outreach, menampilkan jeda
  bawaan/maksimal dan estimasi selesai, mewajibkan preview server, serta
  menampilkan `skipped[]` per prospek.
- **T-10** — pengelola template menyediakan CRUD, tombol placeholder dari
  `prospectPlaceholders`/`prospectPlaceholderHints`, dan preview server dalam
  frame terisolasi; tidak menambahkan lampiran PDF fiktif.
- **T-11** — editor template memakai isi surat teks biasa, defaults server,
  tombol **Pakai contoh**, tanda tangan per orang, dan `bodyFormat: "text"`;
  preview menampilkan dokumen surat utuh dari server dalam frame tinggi tanpa
  menambahkan logo, tanda tangan, atau catatan kaki dari UI.

- **T-12** — tab **Laporan kirim** menampilkan batch sebelum detail penerima,
  summary empat status dari server, filter lengkap, pagination, `failureReason`
  apa adanya, nilai null sebagai `—`, serta polling yang hanya berjalan saat
  tab terlihat. QA browser dilakukan pada desktop, tablet, dan mobile.

  QA terakhir: lint, typecheck, build, dan 231 test lulus; smoke Playwright
  mock kontrak pada `/admin` lulus di 1440×900 dan 375×812 tanpa error console.

- **T-13** — laporan kirim mengimpor `prospectOutreachStatuses`,
  `prospectOutreachStatusLabels`, dan `ProspectOutreachStatus` dari
  `shared/prospects.ts`, sehingga status filter, summary, dan label tabel tidak
  memiliki daftar lokal kedua.

- **T-14** — menu Calon Klien mengikuti modul `prospects` dan `canUse`, dengan
  kontrol read-only untuk izin `view`; form password membaca policy dinamis,
  menerapkan `minLength`, menampilkan deskripsi sebelum mengetik, dan merender
  seluruh `details.unmet` dari `PASSWORD_TOO_WEAK`.

- **T-15** — `help-view.tsx` memuat workflow Calon Klien dalam dua bahasa,
  panduan impor XLSX, template teks biasa, preview, jeda pengiriman, empat
  status, opt-out, dan lima pesan baru; daftar menu serta panduan password juga
  sudah mengikuti kontrak terbaru. Ditambahkan glossary Prospek, Batch, dan
  Opt-out. Editor rich ditangani pada T-17 setelah kontrak `rich` tersedia.

- **T-17** — `rich-text-editor.tsx` menyediakan toolbar tebal, miring, daftar
  berpoin, daftar bernomor, dan tautan; toolbar menghasilkan marker `rich`,
  bukan HTML. Paste dipaksa menjadi `text/plain`, template `text` lama tetap
  dipertahankan, dan template HTML tulisan tangan tidak diubah menjadi keluaran
  editor. Preview tetap memakai hasil render server.

- **T-18a** — `document-template-manager.tsx` menjadi tab di Procurement dan
  menyediakan CRUD template untuk `spk`, `quotation`, dan `invoice`, defaults
  pengirim dari server, placeholder dinamis per jenis dokumen, editor
  `text`/`rich`, preservasi template HTML tulisan tangan, soft-delete, serta
  mode read-only untuk izin View. Preview surat lengkap tetap dibuat oleh
  server di dialog Kirim dokumen; endpoint preview generik yang tertulis di
  kontrak tetapi belum ada di router sudah dicatat di
  `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`.
- **T-23** — `DocumentTemplateManager` dipakai ulang sebagai pintu kedua di
  Quotation & Invoice untuk template `quotation`/`invoice`, sementara
  Procurement dibatasi ke `spk`. Tab dan tombol edit mengikuti
  `viewableKinds`/`manageableKinds` dari server, judul kelompok memakai label
  audience, dan empty state dialog Kirim menyediakan tombol **Buat template**.

---

### T-24 — Kirim BAST final ke klien (kontrak backend)

- **Dipakai untuk:** tombol Kirim Email + tab Template surat di layar BAST
  Digital.
- **Izin:** modul **`bast`**, bukan `billing`. `manage` untuk mengirim dan
  mengelola template, `view` untuk membaca riwayat dan template. Finance
  bawaan punya `bast: "view"` — ia boleh membaca, tidak boleh mengirim.

**Endpoint** (pola identik dengan invoice, jadi `document-email-dialog.tsx`
bisa dipakai apa adanya):

| Metode | Endpoint | Badan | Balasan |
|---|---|---|---|
| POST | `/api/bast/:id/send-email-preview` | JSON `{ templateId }` | `{ subject, bodyHtml, recipient, recipientName, attachments[] }` |
| POST | `/api/bast/:id/send-email` | `FormData`: `templateId`, `files` (0–5) | `{ deliveryId, recipient, recipientName, status, scheduledFor, attachments[] }` |
| GET | `/api/bast/:id/deliveries` | — | `{ items: [{ id, recipient, recipientName, subject, status, scheduledFor, sentAt, failureReason, createdAt, createdByName, attachments[] }] }` |

**Template:** jenis baru `bast` di `/api/document-email-templates`
(`documentKind: "bast"`). `audience.bast === "klien"`.

Penandanya — dari `documentEmailPlaceholders.bast`, dan layar sudah
membacanya sendiri dari respons `placeholders`:

`nomor`, `klien`, `proyek`, `paket`, `tanggal_serah_terima`, `sidik_dokumen`,
`tautan_verifikasi`.

Dua yang terakhir sengaja ada: `sidik_dokumen` adalah SHA-256 arsip finalnya
dan `tautan_verifikasi` adalah tautan yang sama dengan QR di dalam PDF-nya.
Surat ini gunanya menjadi BUKTI, jadi penerimanya harus bisa memeriksanya
sendiri.

**Galat yang perlu ditangani layar:**

| Kode | HTTP | Kapan |
|---|---|---|
| `BAST_NOT_FINAL` | 409 | BAST masih Draft. Cegah dengan menyembunyikan tombolnya. |
| `BAST_REVOKED` | 409 | BAST sudah dicabut. Sembunyikan juga. |
| `TEMPLATE_KIND_MISMATCH` | 422 | Template bukan jenis `bast`. `details.documentKind` menyebut jenis aslinya. |
| `TEMPLATE_REQUIRED` | 422 | `templateId` kosong. |
| `CLIENT_EMAIL_MISSING` | 409 | Proyek belum punya `clientEmail`. Pesannya sudah menyebut Manajemen Proyek. |
| `BAST_ARCHIVE_MISMATCH` | 500 | Arsipnya tidak cocok dengan sidik tercatat. Bukan kesalahan pengguna — tampilkan apa adanya dan sarankan hubungi Admin. |

**Yang perlu kamu tahu, dan tidak terlihat dari API-nya:** lampiran BAST
adalah **arsip final yang tersimpan**, bukan render baru seperti tiga jenis
lain. Jangan menawarkan opsi "render ulang" atau "lampirkan versi terbaru" di
dialognya — byte-nya harus sama persis dengan yang sidiknya sudah dicatat,
atau halaman verifikasi klien akan menyatakan dokumennya tidak sah.


---

### T-26 — Alokasi sisa laba ke Kas Perusahaan (kontrak backend)

**Keputusan pemilik, 22 Agustus 2026.** Di layar Laba & Bagi Hasil, setelah
orang-orang mendapat bagiannya, sisa laba menggantung sebagai "Laba ditahan"
tanpa pemilik yang jelas. Pemilik ingin sisa itu bisa **dialokasikan ke
perusahaan**, dan uangnya terlihat masuk ke pos kas perusahaan.

Contoh nyata dari demo (PN-2608-004): laba aman dibagikan 110.135.000, tiga
orang mengambil 70% (77.094.500), sisa 33.040.500 tidak punya baris apa pun.

- **Dipakai untuk:** panel Laba & Bagi Hasil, dan satu tampilan baru "Kas
  Perusahaan" di Pembukuan.
- **Izin:** sama dengan alokasi lain — peran Admin atau Finance, `margin`
  Kelola + `finance` Kelola untuk menyusun; menyetujui tetap Admin saja.

#### 1. Alokasi bertipe perusahaan

`POST /api/profit-shares` menerima field baru **`recipientKind`**:
`"person"` (bawaan, perilaku lama persis) atau `"company"`.

Untuk `"company"`:

- `recipientUserId` **tidak boleh diisi** → 422 `COMPANY_SHARE_HAS_NO_USER`.
- `recipientName` boleh dikosongkan; server mengisinya `"Kas Perusahaan"`.
- `percentage` boleh dikosongkan → server memakai **sisa persentase yang belum
  dialokasikan**. Ini yang membuat tombol "Alokasikan sisanya" cukup satu POST
  tanpa frontend menghitung sendiri (dan tanpa balapan dengan alokasi lain).
- Hanya boleh ada **satu** alokasi perusahaan aktif per proyek → 409
  `COMPANY_SHARE_EXISTS` dengan `details.shareId` menunjuk yang sudah ada.

`PATCH`, `approve`, `pay`, `void`, dan `DELETE` memakai endpoint yang **sama
persis** dengan alokasi orang. Tidak ada endpoint baru untuk ini.

#### 2. Yang berbeda hanya labelnya

Setiap alokasi di `allocations[]` sekarang membawa **`recipientKind`**. Untuk
yang `"company"`:

- Ikon/label penerima: "Kas Perusahaan", bukan avatar orang.
- Tombol **Bayar** sebaiknya berbunyi **"Pindahkan ke kas perusahaan"** — tidak
  ada orang yang dibayar, uangnya berpindah pos. Endpoint dan badannya tetap
  `POST /api/profit-shares/:id/pay` dengan `{ paidDate }`.
- Setelah dieksekusi, statusnya tetap `Paid`. Kalau ingin lebih jujur di layar,
  tampilkan "Dipindahkan" untuk `recipientKind === "company"`.

Ringkasan `GET /api/profit-shares?projectId=` bertambah:

| Field | Arti |
|---|---|
| `companyShare` | Alokasi perusahaan yang aktif, atau `null`. Bentuknya sama dengan satu item `allocations[]`. |
| `unallocatedPercentage` | Sisa persen yang belum dialokasikan (0–100). Pakai ini untuk menyalakan/mematikan tombol "Alokasikan sisanya". |

`retainedProfit` tetap ada dan tetap berarti "yang belum dialokasikan ke
siapa pun". Setelah sisa dialokasikan ke perusahaan, angka itu menjadi 0 —
memang itu tujuannya.

#### 3. Tampilan baru: Kas Perusahaan

`GET /api/finance/company-treasury` (opsional `?from=&to=`):

```json
{
  "balance": 33040500,
  "entries": [
    { "projectId": "...", "projectCode": "PN-2608-004", "projectName": "Sandy House",
      "amount": 33040500, "date": "2026-08-22", "shareId": "...", "reversed": false }
  ]
}
```

Taruh sebagai kartu atau tab di Pembukuan. `balance` sudah bersih dari yang
dibatalkan; `entries[].reversed` menandai baris yang sudah dibalik supaya
riwayatnya tetap terbaca.

#### 4. Yang TIDAK boleh kamu tampilkan sebagai kas masuk

Pemindahan ini dicatat dua kaki: Pengeluaran di proyeknya, dan Pemasukan di
tingkat perusahaan. **Kas bersih perusahaan tidak berubah sama sekali** — uang
itu memang sudah ada di rekening sejak klien membayar; yang berpindah cuma
kepemilikannya.

Kaki masuknya sengaja TIDAK dijumlahkan sebagai "Kas masuk" di ringkasan
Pembukuan (server yang mengaturnya, kamu tidak perlu apa-apa). Jadi jangan
membuat kartu yang menjumlahkan `companyTreasury.balance` ke dalam total kas
masuk — angkanya akan dihitung dua kali, dan itu persis kesalahan yang
penanganan di server ini hindari.

#### 5. Galat yang perlu ditangani

| Kode | HTTP | Kapan |
|---|---|---|
| `COMPANY_SHARE_EXISTS` | 409 | Proyek sudah punya alokasi perusahaan aktif. |
| `COMPANY_SHARE_HAS_NO_USER` | 422 | `recipientUserId` ikut terkirim untuk `recipientKind: "company"`. |
| `NOTHING_LEFT_TO_ALLOCATE` | 409 | `percentage` dikosongkan tapi 100% sudah teralokasi. Matikan tombolnya saat `unallocatedPercentage === 0`. |
| `PROFIT_SHARE_EXCEEDS_100_PERCENT` | 409 | Sama seperti sebelumnya. |
| `NO_DISTRIBUTABLE_PROFIT` | 409 | Sama seperti sebelumnya, saat menyetujui. |


---

### T-29 — Arsip Bukti di Pembukuan (kontrak backend)

- **Dipakai untuk:** tab/section **"Arsip Bukti"** di layar Pembukuan
  (`finance-view.tsx`). Satu daftar berhalaman untuk SEMUA yang bergerak uang
  plus bukti kontrak, dengan tombol buka bukti dan tombol lampirkan bukti.
- **Izin:** membuka = `finance` view (gerbang resource `finance` sudah
  menjaganya). Tiap baris hanya muncul bila akun punya `view` pada modul
  jenisnya — `summary.kinds` memberitahumu jenis mana yang boleh dilihat
  akun ini; **bangun filter jenis dari situ, jangan dari peran.** Melampirkan
  dan menghapus = `finance` manage + `manage` pada modul jenisnya →
  **PM/Engineer tidak bisa melampirkan bukti** (disengaja: bukti keuangan
  urusan Finance). Sembunyikan tombol lampir untuk mereka; server tetap
  menolak 403 kalau dipaksa.

**Endpoint**

| Metode | Endpoint | Badan | Balasan |
|---|---|---|---|
| GET | `/api/finance/evidence?q=&from=&to=&projectId=&kind=&direction=&proof=&page=&pageSize=` | — | `{ items[], page, pageSize, total, summary }` (bentuk di bawah) |
| GET | `/api/finance/evidence/:kind/:evidenceId/file` | — | byte bukti yang tersimpan di catatannya (hanya 4 jenis, lihat `proof.legacy[].url`) |
| POST | `/api/finance/evidence/:kind/:evidenceId/attachments` | `FormData`: `files` (1–5, PDF/PNG/JPEG/WebP ≤10 MB), `note?` (≤300) | 201 `{ items: [attachment…] }` |
| GET | `/api/finance/evidence/attachments/:attachmentId/file` | — | byte lampiran |
| DELETE | `/api/finance/evidence/attachments/:attachmentId` | — | 204 |

Parameter daftar: `q` (mencocokkan judul, pihak, referensi, nomor dokumen,
kode proyek, DAN **nominal persis** bila `q` angka — "9.150.000" atau
"Rp 9,150,000" cocok dengan 9150000), `from`/`to` (tanggal `YYYY-MM-DD`),
`projectId`, `kind` (boleh beberapa: `kind=advance,profit-share`),
`direction` (`Pemasukan`|`Pengeluaran`), `proof` (`with`|`without`), `page`
(≥1), `pageSize` (10–100, bawaan 25).

Jenis (`kind`) dan labelnya ada di **`shared/finance-evidence.ts`**
(`financeEvidenceKinds`, `financeEvidenceKindLabels` dwibahasa,
`financeEvidenceModule`) — impor dari sana, jangan disalin.

**Bentuk satu item:**

```json
{
  "kind": "invoice-payment",
  "id": "<id baris buku kas>",
  "evidenceId": "<id pembayaran — kunci lampiran>",
  "date": "2026-07-05", "amount": 9150000, "direction": "Pemasukan",
  "reversal": false, "status": "Posted",
  "project": { "id": "..", "code": "PN-2607-001", "name": ".." },
  "title": "Pembayaran INV/..", "counterparty": "PT Klien", "reference": "MASUK-1",
  "document": { "kind": "invoice", "id": "..", "number": "INV/..", "pdfUrl": "/api/invoices/<id>/pdf" },
  "proof": {
    "hasProof": true,
    "legacy": [{ "name": "bukti.png", "mimeType": "image/png",
                 "url": "/api/finance/evidence/invoice-payment/<evidenceId>/file" }],
    "attachments": [{ "id": "..", "filename": "..", "mimeType": "..", "byteSize": 1234,
                      "sha256": "..", "note": null,
                      "uploadedBy": { "id": "..", "name": ".." }, "createdAt": "..",
                      "url": "/api/finance/evidence/attachments/<id>/file" }]
  },
  "createdAt": ".."
}
```

`summary`: `{ byKind: { "<kind>": { total, withoutProof } }, withoutProof,
kinds: ["<kind yang boleh dilihat akun ini>", …] }` — dihitung atas
`from/to/projectId` saja (mengabaikan `kind/q/proof`), jadi angka di tab
tidak berubah saat orang mencari.

**Galat yang perlu ditangani layar:**

| Kode | HTTP | Kapan |
|---|---|---|
| `UNKNOWN_EVIDENCE_KIND` | 404 | `kind` di luar daftar — tidak akan terjadi kalau filter dibangun dari `shared/finance-evidence.ts`. |
| `INVALID_DIRECTION` / `INVALID_PROOF_FILTER` | 422 | Nilai filter salah. |
| `NOT_FOUND` | 404 | `projectId` di luar cakupan akun, atau bukti/lampiran tidak ada. Sama untuk proyek yang memang tidak ada — jangan bedakan. |
| `NO_LEGACY_PROOF` | 404 | Catatan ini tidak menyimpan bukti (rute `/file` hanya untuk 4 jenis: invoice-payment, spk-payment, tax-settlement, quotation-acceptance). Jangan tampilkan tombol buka bila `proof.legacy` kosong. |
| `FILE_REQUIRED` | 422 | `files` kosong. |
| `ATTACHMENT_TOO_MANY` | 422 | > 5 berkas sekali unggah. |
| `ATTACHMENT_TOO_LARGE` | 413 | > 10 MB per berkas. `details.filename`. |
| `INVALID_FILE_CONTENT` | 415 | Isi berkas tidak sesuai tipenya (diperiksa dari byte). |
| `ATTACHMENT_LIMIT` | 409 | Satu baris bukti sudah 10 lampiran. |
| `DUPLICATE_ATTACHMENT` | 409 | Berkas yang sama sudah dilampirkan; `details.attachmentId` menunjuk yang ada. |
| `EVIDENCE_RECONCILED` | 409 | Transaksinya sudah Matched dengan mutasi bank — lampiran tidak bisa dihapus. |
| `FORBIDDEN` | 403 | Tidak punya izin modul jenis ini, atau mencoba menghapus lampiran orang lain (hanya Admin atau pengunggahnya). |

**Yang perlu kamu tahu, dan tidak terlihat dari API-nya:**

1. **Baris `reversal: true` adalah uang yang sama kembali** (pembatalan).
   Tampilkan redup, tautkan ke baris asalnya lewat `evidenceId` yang sama,
   dan **jangan pernah menandainya "tanpa bukti"** — server pun tidak
   menghitungnya.
2. `project: null` = baris tingkat perusahaan (mutasi bank, kas perusahaan).
   Hanya Admin/Finance yang melihatnya.
3. `proof.legacy[]` adalah bukti yang diunggah bersama catatannya — **hanya
   bisa dibaca**, tidak bisa dihapus dari arsip. `proof.attachments[]` adalah
   lampiran arsip — bisa dihapus (Admin atau pengunggahnya).
4. Semua `url` **tanpa base path** — bungkus dengan `appPath(...)` seperti
   lampiran belanja di `project-expense-view.tsx:678`. Buka di tab baru
   (`target="_blank"`); servernya mengirim `Content-Disposition: inline`
   untuk PDF/gambar, `attachment` untuk berkas yang isinya tidak cocok tipenya.
5. **Deep link dari buku kas:** setiap baris `GET /api/transactions` kini
   membawa `referenceId`, `origin`, dan `evidence: { kind, evidenceId }` —
   tombol "Lihat bukti" di tabel Riwayat transaksi cukup membuka Arsip Bukti
   dengan `q=` nomor/judul baris itu, atau langsung `kind` + `evidenceId`.
6. `amount` bisa `null` (BAST), `direction` bisa `null` (quotation, BAST) —
   itu bukti kontrak, bukan uang.
7. PDF mutasi bank yang diimpor **tidak tersimpan**; untuk `bank-line`,
   bukti hanya bisa datang dari lampiran arsip. Wajar kalau semuanya
   "tanpa bukti" di awal.

---

### T-30 — Foto proyek: unggah banyak, keterangan, galeri per proyek (kontrak backend)

- **Dipakai untuk:** bagian Dokumentasi di `project-view.tsx` (sekarang:
  satu `<input type="file">` tanpa `multiple`, grid `.document-grid`, tanpa
  lightbox, tanpa hapus).
- **Izin:** `projects` manage untuk unggah/ubah/hapus (gerbang yang sudah
  ada), `projects` view untuk melihat. PM/Engineer hanya proyek yang mereka
  anggotai.

**Endpoint**

| Metode | Endpoint | Badan | Balasan |
|---|---|---|---|
| POST | `/api/projects/:id/documents` | `FormData`: **`files`** (1–10; tiap ≤5 MB; total ≤25 MB; JPG/PNG/WebP/PDF), `caption?` (≤500, berlaku untuk semua berkas dalam batch) | 201 `{ uploaded: [doc…], skipped: [{ name, code, message, details? }] }` |
| POST | `/api/projects/:id/documents` | `FormData`: `file` (SATU — **jalur lama**, tetap berjalan) | 201 objek tunggal bentuk lama (`id, name, type, date, uploader, preview`) + field baru |
| GET | `/api/projects/:id/documents` | — | array `doc` (bentuk di bawah), urut `takenAt` terbaru |
| PATCH | `/api/projects/:id/documents/:docId` | JSON `{ caption?: string\|null, takenAt?: string }` | `doc` |
| DELETE | `/api/projects/:id/documents/:docId` | — | 204 (berkas + thumbnail ikut dihapus) |
| GET | `/api/documents/:id/content` | — | byte asli (`Content-Disposition: inline`) |
| GET | `/api/documents/:id/content?variant=thumb` | — | **thumbnail WebP lebar 480 px** — pakai ini untuk grid; non-gambar → 404 `NO_THUMBNAIL` |

**Dua catatan setelah kodenya jadi:** (1) `url`, `thumbUrl`, dan `preview`
**sudah memuat base path** (sama seperti `preview` yang selama ini kamu pakai) —
jangan dibungkus `appPath` lagi; ini berbeda dari T-29 yang URL-nya polos.
(2) Baris lama yang belum punya thumbnail tetap boleh diminta
`?variant=thumb` — server membuatnya saat pertama diminta.

**Bentuk `doc`:**

```json
{ "id": "..", "projectId": "..", "projectCode": "PN-..", "projectName": "..",
  "name": "IMG_0420.jpg", "type": "image", "mimeType": "image/jpeg", "size": 2304512,
  "caption": "Tarik kabel lantai 2", "takenAt": "2026-08-20T14:05:33+08:00",
  "createdAt": "2026-08-22T09:11:02.000Z", "date": "20 Agustus 2026", "uploader": "Ayu",
  "width": 4032, "height": 3024,
  "url": "/api/documents/<id>/content",
  "thumbUrl": "/api/documents/<id>/content?variant=thumb",
  "preview": "/api/documents/<id>/content" }
```

`thumbUrl` null untuk PDF. `width/height` = dimensi **seperti yang dilihat**
(orientasi EXIF sudah diperhitungkan). `takenAt` = tanggal dari EXIF kamera
bila ada, kalau tidak waktu unggah — selalu waktu Makassar beroffset
`+08:00`. `preview` = `url` (dipertahankan untuk kode lamamu).

**Unggah banyak — semantiknya per berkas.** Satu permintaan bisa sebagian
berhasil: tampilkan `uploaded` sebagai berhasil dan tiap `skipped[]` dengan
`code`-nya di samping nama berkasnya. Kalau pengguna memilih > 10 berkas,
**pecah sendiri** menjadi beberapa permintaan berurutan (jangan paralel —
memori server). Batas 500 berkas per proyek.

**Galat:**

| Kode | HTTP | Kapan |
|---|---|---|
| `FILE_REQUIRED` | 422 | Tidak ada berkas. |
| `TOO_MANY_FILES` | 422 | > 10 berkas dalam satu permintaan. |
| `BATCH_TOO_LARGE` | 413 | Jumlah ukuran > 25 MB. |
| `DOCUMENT_LIMIT` | 409 | Proyek sudah 500 berkas. |
| `NO_FILE_ACCEPTED` | 422 | Semua berkas dilewati; `details.skipped` berisi alasannya per berkas. |
| per berkas di `skipped[].code`: `FILE_TOO_LARGE` (>5 MB), `UNSUPPORTED_FILE`, `INVALID_IMAGE`, `ANIMATED_IMAGE`, `IMAGE_DIMENSIONS` (>12.000 px/sisi), `IMAGE_TYPE_MISMATCH` (isi ≠ tipe), `INVALID_FILE_CONTENT` (PDF palsu), `DUPLICATE` (byte sama sudah ada di proyek; `details.documentId`) | — | Tampilkan `message`-nya apa adanya. |
| `INVALID_TAKEN_AT` | 422 | `takenAt` bukan `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, atau ISO beroffset. |
| `NOT_FOUND` | 404 | Proyek/dokumen di luar cakupan. |

**Yang perlu kamu tahu:** grid **harus** memakai `thumbUrl`, bukan `url` —
itu alasan utama fitur ini ada. `url` hanya untuk lightbox/unduh. Untuk
lightbox, angkat pola `app/components/portfolio-gallery.tsx` (tombol
panah, Escape, swipe, focus trap) ke admin — jangan tulis yang baru.

---

### T-31 — Galeri Proyek lintas proyek (kontrak backend)

- **Dipakai untuk:** menu baru **"Galeri Proyek"** (`ViewKey` `gallery`)
  di grup Operasional, `module: "projects"`. PM melihat riwayat foto semua
  proyek yang dia anggotai; Admin/Finance semua proyek.
- Enam tempat yang harus disentuh (pola yang sudah ada): `app/data.ts`
  (union `ViewKey`), `app/i18n.ts` (label id/en), `enterprise-app.tsx` —
  union `labelKey`, `navItems`, `viewMeta`, blok render. Kuncinya harus
  huruf kecil (`gallery`) — `tests/alur-aplikasi.test.mjs` membaca
  `currentView === "…"` sebagai teks.

**Endpoint**

| Metode | Endpoint | Balasan |
|---|---|---|
| GET | `/api/documents?projectId=&from=&to=&q=&type=photo\|file\|all&page=&pageSize=` | `{ items: [doc…], page, pageSize, total }` (pageSize 10–100, bawaan 40) |
| GET | `/api/documents/summary?projectId=` | `{ byMonth: [{ month: "2026-08", photos, files }], byProject: [{ projectId, projectCode, projectName, photos, files, latestTakenAt }] }` |

`from`/`to` menyaring `takenAt` (tanggal `YYYY-MM-DD`, inklusif); `q`
mencocokkan keterangan dan nama berkas; `type=photo` hanya gambar. `doc`
sama persis dengan T-30, jadi komponen petak/lightbox dipakai ulang.

Tata letak yang saya bayangkan (keputusannya milikmu): timeline bulan di
kiri dari `byMonth` (klik → `from/to` bulan itu), chip proyek dari
`byProject`, kotak cari, lalu grid `thumbUrl` berhalaman; klik petak → lightbox
dengan `url`, caption, `takenAt`, nama proyek.

**Galat:** `NOT_FOUND` 404 untuk `projectId` di luar cakupan; selebihnya
seperti T-30.
