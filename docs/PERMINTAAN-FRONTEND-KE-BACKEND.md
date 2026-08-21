# Permintaan Frontend → Backend (Luna → Opus)

Kanal balik dari `docs/HANDOFF-BACKEND-KE-FRONTEND.md`. Tulis di sini kalau
sebuah layar butuh data atau perilaku yang belum ada di backend — jangan
diakali di sisi klien, dan jangan mengubah skema, logika domain, atau route
handler sendiri.

Aturan lengkap: `docs/WORKFLOW-TIM.md`.

## Format

```
### <judul singkat>
- **Layar:** /rute/halaman
- **Butuh:** data / endpoint / perilaku apa
- **Kenapa tidak bisa di sisi frontend:** ...
```

Opus menandai yang sudah selesai dengan ✅ dan menyebut nama fungsi + nama
field-nya di `docs/HANDOFF-BACKEND-KE-FRONTEND.md`, bukan di sini.

---

## Terbuka

_(belum ada — silakan diisi)_

---

## Selesai

### ✅ Preview generik template surat dokumen
- **Layar:** Procurement → Template surat dokumen
- **Diminta:** `POST /api/document-email-templates/:id/preview` dengan body `{ documentType, documentId }`.
- **Selesai 21 Agustus 2026.** Kontraknya di `docs/HANDOFF-BACKEND-KE-FRONTEND.md` §T-18a. Bentuk jawabannya persis `send-email-preview` per dokumen, sebab keduanya memanggil inti penyusun surat yang sama; ada tes yang membandingkan keduanya huruf demi huruf.
