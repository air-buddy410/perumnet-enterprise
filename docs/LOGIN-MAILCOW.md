# Login satu pintu lewat mailcow — Enterprise

Sumber kebenaran kata sandi ditentukan `AUTH_PROVIDER`. Bawaannya `LOCAL` —
**tidak ada yang berubah sampai variabel ini diubah.**

| Nilai | Kata sandi yang berlaku |
|---|---|
| `LOCAL` (bawaan) | hash bcrypt di kolom `users.password_hash` |
| `MAILSERVER` | kata sandi EMAIL di mailcow, lewat IMAPS 993 |

Endpoint login tidak berubah: `POST /api/auth/login` dengan
`{ email, password, remember }`. Yang berubah hanya **di mana** kata sandinya
diperiksa, plus satu kode galat baru.

## Kode jawaban

| Status | Kode | Kapan |
|---|---|---|
| 200 | — | diterima; cookie sesi ikut |
| 401 | `INVALID_CREDENTIALS` | mailcow menolak, atau alamatnya tidak punya akun di sini |
| 403 | `ACCOUNT_INACTIVE` | akun dinonaktifkan |
| 429 | (throttle) | terlalu banyak percobaan — ember IP & identitas |
| **503** | **`MAILSERVER_UNREACHABLE`** | **mailserver tidak terjawab** |

**503 bukan "kata sandi salah".** Menyamakan keduanya membuat orang mereset
kata sandi email yang sebenarnya tidak bermasalah. Pesan yang dikembalikan
sudah ditulis untuk dibaca pengguna; nama host dan penyebab teknisnya
sengaja tidak ikut — itu hanya masuk log server.

## Empat aturan yang dijaga kode ini

1. **Mailserver tak terjawab ≠ lolos.** Tidak ada jalan mundur diam-diam ke
   hash lokal. Kalau ada, mematikan mailbox seseorang tidak lagi berarti
   mencabut aksesnya — padahal itu justru alasan memakai mailcow.
2. **Alamat tanpa akun tidak pernah dikirim ke mailcow.** Kalau dikirim,
   aplikasi ini berubah jadi alat menebak mailbox orang lain.
3. **Kata sandi tidak pernah masuk log, audit, maupun basis data.** TLS wajib
   diperiksa; CR/LF pada kredensial ditolak sebelum satu byte pun terkirim.
4. **Akun darurat tetap ada.** Baris dengan `users.allow_local_login = 1`
   memakai hash lokal walau mode mailserver menyala.

Ketiga aturan pertama diuji di `tests/mailserver-login.test.mjs`; penjagaan
kredensialnya di `tests/mail-auth.test.mjs`.

## Urutan menyalakan — jangan dibalik

1. **Kolom `users.allow_local_login` sudah otomatis dibuat** saat server start
   (`ensureMailserverAuthSchema`). Aman: default 0, tidak mengubah baris lama.
2. **Daftarkan akun tim.** Daftarnya ada di `APP-Perumnet/AKUN-TIM.md`, **di
   luar repo ini** — repo ini publik di GitHub, jadi nama dan alamat pegawai
   tidak boleh masuk ke sini.
   ```
   node scripts/seed-akun-tim.mjs ../AKUN-TIM.md             # lihat dulu
   node scripts/seed-akun-tim.mjs ../AKUN-TIM.md --terapkan  # baru menulis
   ```
   Akun baru dibuat tanpa kata sandi lokal yang bisa dipakai; yang sudah ada
   hanya diperbarui peran dan penanda daruratnya — kata sandinya tidak
   disentuh.
3. **Pastikan akun darurat punya kata sandi yang benar-benar bisa dipakai.**
   ```sql
   SELECT email FROM users WHERE allow_local_login = 1;
   ```
   `admin@perumnet.id` ditandai darurat oleh skrip, tapi ditandai saja tidak
   cukup — kata sandinya harus diketahui. Setel lewat alur reset **sebelum**
   langkah berikutnya. Tanpa ini, mailserver yang mati berarti tidak ada jalan
   masuk sama sekali.
4. **Samakan alamat email.** Login mencocokkan lewat email; alamat di tabel
   `users` harus sama persis dengan mailbox di mailcow. Yang tidak cocok tidak
   bisa masuk, dan gejalanya membingungkan — mailcow menerima kata sandinya,
   tapi aplikasinya tidak mengenali orangnya.
5. Baru set di `.env` server, lalu restart:
   ```
   AUTH_PROVIDER=MAILSERVER
   MAILSERVER_URL=https://mail.perumnet.id
   ```
   Uji dengan satu akun biasa **dan** akun darurat.

## Rollback

Kembalikan `AUTH_PROVIDER=LOCAL` lalu restart. Kolom `allow_local_login` boleh
ditinggal — tidak berpengaruh di mode LOCAL. Akun yang dibuat skrip seed
**tidak punya kata sandi lokal**, jadi setelah rollback mereka perlu memakai
alur reset kata sandi sebelum bisa masuk.

## Ganti kata sandi ikut pindah ke mailcow

`PATCH /api/profile/password` di mode `MAILSERVER` **tidak lagi menyentuh
`users.password_hash`** — ia mengganti kata sandi mailbox di mailcow. Kalau
tidak begitu, form itu berpura-pura bekerja: orangnya merasa sudah mengganti
kata sandi, padahal yang menentukan aksesnya sama sekali tidak berubah.

Butuh satu variabel tambahan, dipasang **olehmu sendiri** di `.env.production`
tiap rilis:

```
MAILCOW_API_KEY=<API key read-write dari mailcow>
```

Tanpa itu, jalurnya menjawab **503 `MAILCOW_NOT_CONFIGURED`** — menolak dengan
jelas, bukan diam-diam mengganti kata sandi yang salah.

Tiga penjagaannya, sama seperti CRM:

1. Alamat mailbox diambil dari baris pengguna yang sedang login, **tidak
   pernah dari input**. Dengan API key read-write, satu alamat yang bisa
   dikendalikan pemanggil berarti siapa pun bisa mengganti kata sandi mailbox
   siapa pun.
2. **Kata sandi lama diverifikasi ke mailserver lebih dulu.** Tanpa itu, sesi
   aplikasi yang dibajak cukup untuk mengambil alih kotak surat seseorang.
3. Nilai kata sandinya tidak pernah masuk log maupun pesan galat.

**Akun darurat dikecualikan** — justru kata sandi lokalnya yang berarti,
karena ia jalan masuk saat mailserver mati.

| Status | Kode | Kapan |
|---|---|---|
| 200 | — | kata sandi mailbox diganti; sesi lain dicabut |
| 400 | `INVALID_PASSWORD` | kata sandi email saat ini salah |
| 502 | `MAILCOW_REJECTED` | mailcow menolak — paling sering API key read-only |
| 503 | `MAILCOW_NOT_CONFIGURED` | `MAILCOW_API_KEY` belum dipasang |
| 503 | `MAILSERVER_UNREACHABLE` | mailserver tidak terjawab |

## Reset kata sandi mati di mode mailserver

`POST /api/auth/forgot-password` dan `POST /api/auth/reset-password` menjawab
**409 `PASSWORD_RESET_UNAVAILABLE`** selama `AUTH_PROVIDER=MAILSERVER`.

Sebabnya sama dengan alasan ganti kata sandi dipindah ke mailcow:
`reset-password` menulis `users.password_hash`, kolom yang di mode ini tidak
dibaca untuk akun biasa. Tanpa penjaga itu, orang yang terkunci menempuh
seluruh alur, melihat "berhasil", **tetap tidak bisa masuk** — dan sesinya ikut
terhapus, jadi ia justru lebih terkunci daripada sebelum mencoba.

Penjaganya berjalan **sebelum** akun dicari, supaya jawabannya sama untuk
alamat terdaftar maupun tidak; kalau dipasang sesudah, bedanya jawaban akan
membocorkan siapa saja yang punya akun.

Akun darurat ikut ditolak, dengan sengaja: kata sandinya disetel lewat
`scripts/setel-akun-darurat.mjs`, dan tautan reset ke kotak suratnya sendiri
tetap butuh kata sandi email — berputar tanpa jalan keluar.

Yang harus dilakukan orang yang lupa: **reset kata sandi emailnya lewat
webmail atau hubungi IT.** Setelah itu ia langsung bisa masuk, karena yang
diperiksa memang kata sandi email.

## Login menerima username tanpa @

`budi` dan `budi@perumnet.id` menuju akun yang sama. Field-nya tetap bernama
`email`; yang berubah hanya apa yang boleh diisi.

Pemetaannya lewat baris yang **ada di tabel `users`**, bukan dengan
menempelkan domain bawaan. Menempelkan domain berarti mengarang alamat, dan
alamat karangan itulah yang akan dikirim ke mailcow — persis yang dilarang
aturan kedua di atas.

Kalau dua akun punya bagian-lokal yang sama, tidak ada yang dipilih: jawabannya
401. Menebak di situ berarti seseorang bisa masuk ke akun orang lain hanya
karena username-nya kebetulan sama.

Throttle memakai ember yang sama untuk kedua ejaan — kalau dipisah, satu akun
bisa dicoba dua kali lipat hanya dengan berganti ejaan.


## Akun darurat — kata sandinya harus DIKETAHUI

Ditandai `allow_local_login = 1` saja tidak cukup. Setel kata sandinya
sendiri; nilainya tidak pernah lewat siapa pun:

```
cd <folder rilis>
set -a && . ./.env.production && set +a
node scripts/setel-akun-darurat.mjs admin@perumnet.id
```

Skrip itu meminta kata sandi diketik langsung di terminal — tidak lewat
argumen perintah (yang terlihat di `ps`), tidak masuk riwayat shell, tidak
dicetak. Minimal 12 karakter, dan simpan di pengelola kata sandi.

**Kalau host-nya tidak punya TTY** (lewat pipa, atau dipanggil skrip deploy),
prompt tersembunyi tidak bisa dipakai dan skrip berhenti dengan pesan yang
menjelaskan itu. Jalur penggantinya:

```
node scripts/setel-akun-darurat.mjs admin@perumnet.id --dari-berkas /jalan/ke/berkas
```

Baris pertama berkas dipakai sebagai kata sandi, lalu **berkasnya langsung
dihapus**. Nilainya tetap tidak pernah lewat argumen perintah. Batas 12
karakter dan penolakan CR/LF tetap berlaku; yang dilewati hanya konfirmasi
ketik-ulang — jadi salah ketik tidak akan ketahuan, periksa isinya dulu.

`--periksa` menampilkan keadaan akun tanpa mengubah apa pun.

## Yang belum dikerjakan

- ~~Teks form ganti kata sandi~~ — **selesai 2026-08-18**. `settings-view.tsx`
  sudah berbunyi "password email", menyebut webmail dan aplikasi PerumNet
  lain, dan memakai `target: "mailcow"` untuk memilih kalimat suksesnya.
- ~~Nyalakan di demo lebih dulu, lalu produksi~~ — **sudah dijalankan
  2026-08-19.** Demo dan produksi keduanya `AUTH_PROVIDER=MAILSERVER` pada
  release `aebc599`. Login lewat mailcow terbukti di produksi (sesi non-darurat
  13:19:54Z); di demo baru akun darurat yang dipakai. Kata sandi akun darurat
  disetel di kedua lingkungan hari itu juga, dan `MAILCOW_API_KEY` terpasang di
  keduanya. Cadangan `.env` untuk rollback ada di tiap folder rilis, bertanda
  `sebelum-mailserver-` dan `sebelum-apikey-`.
- **Layar belum menyesuaikan.** Tautan "Lupa kata sandi?" masih tampil padahal
  alurnya kini dijawab 409, kolom login masih berlabel "Email" padahal username
  sudah diterima, dan judul form ganti kata sandi menyebut kata sandi email
  untuk akun darurat juga. Ketiganya ada di
  `HANDOFF-BACKEND-KE-FRONTEND.md` sebagai T-3, T-4, T-5.
