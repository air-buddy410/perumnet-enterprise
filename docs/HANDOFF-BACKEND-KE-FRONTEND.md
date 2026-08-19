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

### T-3. Layar login: sembunyikan "Lupa kata sandi?" saat mode mailserver

- **Layar:** `app/components/auth-screen.tsx:251` dan
  `app/panel/panel-app.tsx:396`.
- **Butuh:** saat mode mailserver menyala, tautan itu menuju alur yang kini
  dijawab **409 `PASSWORD_RESET_UNAVAILABLE`**. Sembunyikan tautannya, dan
  ganti dengan satu kalimat yang menyebut kata sandi email direset lewat
  webmail atau IT. Kalau tautannya tetap ditampilkan, tampilkan `message` dari
  409 apa adanya — jangan sebagai kegagalan yang bisa dicoba lagi.
- **Datanya dari mana:** `GET /api/auth/mode` — lihat kontrak di §Siap dipakai.
- **Kenapa tidak bisa diakali di sisi backend:** servernya sudah menolak; yang
  tersisa tautan yang menjanjikan sesuatu yang tidak akan terjadi.

### T-4. Kolom login menerima username

- **Layar:** form masuk (admin & panel).
- **Butuh:** label kolomnya masih berbunyi "Email". Backend kini menerima
  username tanpa `@` pada field yang sama. Ubah labelnya jadi menyebut
  keduanya, dan lepas `type="email"` kalau masih dipasang — atribut itu
  membuat peramban menolak `budi` sebelum permintaan terkirim.
- **Kenapa tidak bisa diakali di sisi backend:** penolakannya terjadi di
  peramban, sebelum ada permintaan yang sampai ke server.

### T-5. Judul form ganti kata sandi untuk akun darurat

- **Layar:** `app/components/settings-view.tsx:256`.
- **Butuh:** judulnya berbunyi "Keamanan password email — dipakai untuk webmail
  dan aplikasi PerumNet lain" untuk **semua orang**. Untuk akun darurat
  (`allowLocalLogin: true` dari `GET /api/auth/mode`), yang berganti justru
  kata sandi **lokal** aplikasi ini, bukan mailbox — jadi kalimat itu tidak
  benar untuknya. Satu akun saja, tapi itu akun yang kata sandinya paling
  penting dipahami dengan benar.
- **Kenapa tidak bisa diakali di sisi backend:** backend sudah membedakan
  jalurnya dan sudah membocorkan statusnya lewat endpoint di atas.

### Selesai

- **T-1** — `auth-screen.tsx` dan `panel-app.tsx` membedakan 503
  `MAILSERVER_UNREACHABLE` dari 401. Diverifikasi dari kode.
- **T-2** — `settings-view.tsx` mempertahankan form dan endpoint yang sama,
  menjelaskan password email MailCow untuk webmail/aplikasi PerumNet lain,
  memakai `{ target: "mailcow" }` untuk copy sukses, dan meneruskan pesan
  backend untuk empat kode error MailCow. Form/copy dan error kredensial
  diverifikasi melalui browser; submit sukses MailCow tidak dijalankan karena
  memerlukan perubahan password nyata.
