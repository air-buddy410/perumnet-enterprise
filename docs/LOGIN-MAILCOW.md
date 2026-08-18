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

## Yang belum dikerjakan

- Form ganti kata sandi masih tampil di mode mailserver, padahal yang diganti
  seharusnya kata sandi email di webmail. Tugasnya ada di
  `HANDOFF-BACKEND-KE-FRONTEND.md`.
- Demo dan produksi memakai commit yang sama (lihat memory
  `demo-mirrors-production`): nyalakan di demo lebih dulu, pakai beberapa
  hari, baru produksi.
