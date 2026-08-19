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

### Selesai

- **T-1** — `auth-screen.tsx` dan `panel-app.tsx` membedakan 503
  `MAILSERVER_UNREACHABLE` dari 401. Diverifikasi dari kode.
- **T-2** — `settings-view.tsx` mempertahankan form dan endpoint yang sama,
  menjelaskan password email MailCow untuk webmail/aplikasi PerumNet lain,
  memakai `{ target: "mailcow" }` untuk copy sukses, dan meneruskan pesan
  backend untuk empat kode error MailCow. Form/copy dan error kredensial
  diverifikasi melalui browser; submit sukses MailCow tidak dijalankan karena
  memerlukan perubahan password nyata.
