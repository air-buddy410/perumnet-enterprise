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
