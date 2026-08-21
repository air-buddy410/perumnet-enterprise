# Project Instructions — PerumNet Enterprise

**Luna (Codex) = FRONTEND. Opus (Claude Code) = BACKEND, SERVER, DATABASE.**

Aturan lengkap, batas wilayah, alur per fase, dan peta seluruh aplikasi
PerumNet ada di **`docs/WORKFLOW-TIM.md`**. Baca itu sebelum mengubah apa pun.

- Permintaan Luna → Opus: `docs/PERMINTAAN-FRONTEND-KE-BACKEND.md`
- Kontrak Opus → Luna: `docs/HANDOFF-BACKEND-KE-FRONTEND.md`

Ringkas:

- Aturan domain ditegakkan di server, bukan UI.
- Skema ditambah, bukan diubah; migrasi baru, jangan edit migrasi lama.
- Halaman publik menghadap internet — isian pengunjung tidak dipercaya.
- Jangan pernah membaca atau mencetak isi `.env`.
- Direktori kerja dipakai bersama: stage per-berkas, jangan `git add -A`, jangan `git reset --hard`.
