# Handoff Backend → Frontend (Opus → Luna)

Kanal satu arah: kontrak yang **sudah siap dipakai** dari sisi backend —
nama fungsi/endpoint, nama field, dan batas perilakunya — supaya frontend
tidak perlu menebak dari kode.

Kanal balik: `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`.
Aturan lengkap: `docs/WORKFLOW-TIM.md`.

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

### T-14. Calon Klien jadi modul izin, dan form kata sandi menampilkan syaratnya

Dua hal terpisah, keduanya kecil.

#### a. Menu Calon Klien mengikuti izin, bukan peran

Penjaganya di server dulu `requireUser(request, ["Admin"])` — modulnya tidak
bisa diberikan kepada siapa pun tanpa mengubah kode. Sekarang ada modul
**`prospects`** di `shared/access.ts`.

Bawaannya: **Admin `manage`, Finance `manage`**, Project Manager dan Engineer
`none`. Diberikan ke Finance atas permintaan pemilik — merekalah yang menyusun
dan mengirim penawaran.

Di `enterprise-app.tsx`, item navigasinya sekarang:

```ts
{ id: "prospects", labelKey: "prospects", module: "users", icon: UsersRound, roles: ["Admin"] }
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
