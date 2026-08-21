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

### Preview generik template surat dokumen
- **Layar:** Procurement → Template surat dokumen
- **Butuh:** `POST /api/document-email-templates/:id/preview` dengan body `{ documentType: "spk" | "quotation" | "invoice", documentId }`, yang mengembalikan `subject`, `bodyHtml`, `recipient`, `recipientName`, dan `attachments` seperti kontrak di `docs/HANDOFF-BACKEND-KE-FRONTEND.md` §T-16.
- **Kenapa tidak bisa di sisi frontend:** preview harus memakai placeholder, identitas perusahaan, tanda tangan, penerima, dan PDF dokumen yang dirender server. Endpoint tersebut tertulis di handoff, tetapi `dispatchDocumentEmailTemplateApi` saat ini belum menangani path `/:id/preview` dan menjawab 404. Jangan merender atau menebak surat lengkap di browser.

---

## Selesai

_(kosong)_
