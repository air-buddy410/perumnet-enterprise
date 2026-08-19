# Aturan kerja tim — PerumNet Enterprise

**Berlaku sejak:** 2026-08-13. Aturan yang sama dipasang di semua aplikasi
PerumNet (lihat §6), supaya pindah aplikasi tidak berarti pindah kebiasaan.
Sumber aslinya: `../crm/docs/WORKFLOW-TIM.md`.

---

## 1. Pembagian peran

| | **Luna** (OpenCode) | **Opus** (Claude Code) |
|---|---|---|
| Tanggung jawab | **FRONTEND** | **BACKEND · SERVER · DATABASE** |
| Yang dikerjakan | Halaman & komponen, design system, tata letak, responsif, aksesibilitas, teks antarmuka, state di sisi klien | Skema database & migrasi, logika domain, API, autentikasi & hak akses, worker email, deploy |
| Berkas khas di repo ini | `app/**` (tampilan), `design/**`, aset di `public/**` | `db/schema.ts` + `db/index.ts`, `server/**`, `shared/**`, `worker/**`, `proxy.ts`, `scripts/**`, `tests/**` |

Satu aturan yang menyelesaikan sebagian besar tabrakan: **yang menulis ke
database adalah Opus, yang menulis ke mata pengguna adalah Luna.**

## 2. Batas yang tidak boleh dilanggar

**Opus tidak mengubah berkas presentasi.** Tidak menata ulang komponen, tema,
atau aset milik Luna. Kalau sebuah fase butuh perubahan tampilan, tulis
permintaannya di §5 — jangan kerjakan sendiri. Halaman baru boleh dibuat
Opus, tapi **hanya memakai komponen dan token gaya yang sudah ada**.

**Luna tidak mengubah aturan domain.** Tidak menyentuh `db/schema.ts`,
`server/**`, atau `shared/**`. Kalau sebuah layar butuh data yang belum ada,
tulis permintaannya di §5. Validasi di form itu kenyamanan; **penegakannya
tetap di sisi server**.

Khusus aplikasi ini: **halaman publik menghadap internet.** Apa pun yang
diisi pengunjung dianggap tidak dipercaya. Nilai berawalan `= + - @` diberi
kutip sebelum masuk Excel/CSV, dan tidak ada data pelanggan yang masuk query
string.

## 3. Alur per fase (urutan yang sudah terbukti)

1. Baca dokumen desain/PRD fase itu — jangan mulai dari tebakan.
2. Buat branch sendiri.
3. Skema **ditambah**, bukan diubah; migrasi baru, jangan edit migrasi lama.
4. Terapkan ke database dev, pastikan naik bersih dari nol juga.
5. Logika domain di `server/**` atau `shared/**`, bukan di komponen.
6. API tipis, hak akses diperiksa di server.
7. Halaman UI memakai komponen yang ada; entri nav **ditambahkan**, tidak menata ulang.
8. `npm run lint` + `npm run build`.
9. `npm test` — kasus positif **dan** negatif.
10. Smoke di browser, termasuk **viewport 375 px**.
11. Perbarui README/dokumen, lalu commit + PR.

## 4. Aturan yang mahal kalau dilanggar

Lahir dari kesalahan yang benar-benar terjadi di proyek PerumNet, bukan teori.

- **Aturan domain ditegakkan di server, bukan UI.** Yang ditegakkan di UI bisa dilewati lewat request langsung.
- **Sebelum percaya sebuah tes, jalankan juga terhadap kode SEBELUM perbaikan.** Tes yang "lolos" di kedua sisi berarti tidak menguji apa pun.
- **JANGAN PERNAH `git reset --hard` di direktori kerja bersama.** Pada 2026-08-12 perintah itu menghapus 13 berkas yang belum di-stage di repo CRM; tidak ada yang bisa dipulihkan. Pakai `git reset --soft` atau `git cherry-pick`.
- **Stage per-berkas, jangan `git add -A`.**
- **Jangan pakai `--delete-branch` saat merge PR.** Merge di remote, lalu `git checkout` + `git pull --ff-only`.
- **Jangan pernah membaca atau mencetak isi `.env`.** Kredensial disimpan sebagai *nama environment variable*, bukan nilainya.
- **Berkas database lokal (`*.local.db`) tidak pernah di-commit** dan tidak pernah dipakai sebagai sumber kebenaran.

## 5. Papan permintaan antar-peran

Tulis permintaan di sini, jangan kerjakan wilayah orang lain.

- **Opus → Luna:** `docs/HANDOFF-BACKEND-KE-FRONTEND.md`
- **Luna → Opus:** `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`

Format: **layar mana**, **butuh apa**, **kenapa tidak bisa diakali di sisi sendiri**.

## 6. Peta aplikasi PerumNet

| App | Folder | Stack | Database |
|---|---|---|---|
| CRM | `APP-Perumnet/crm` | Next.js 15 + Prisma | PostgreSQL (Docker `perumnet-postgres`, port 5433) |
| Monitoring NOC | `APP-Perumnet/monitoring-noc` | Next.js + Drizzle + better-auth | pglite / SQLite |
| **Enterprise** (ini) | `APP-Perumnet/enterprise` | Next.js + Drizzle | libsql |
| Captive Portal | `APP-Perumnet/captive-portal` | Node (`server.mjs`) | berkas di `data/` |
| ~~PRTG PerumNet~~ | `APP-Perumnet/_arsip/prtg-lama` | — | **usang**, sudah dilanjutkan oleh Monitoring NOC |

Kelima folder di atas **sudah dipindahkan** ke dalam folder payung
`~/Dev Project/APP-Perumnet/` pada 2026-08-13. Tiap app tetap repo, database,
dan deploy sendiri — tidak ada monorepo, tidak ada paket bersama.
