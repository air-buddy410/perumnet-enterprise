# PerumNet Enterprise

Frontend operasional proyek IT PerumNet Enterprise. Aplikasi mencakup dashboard
proyek, BoQ, quotation dan invoice, procurement, BAST digital, pembukuan, serta
manajemen pengguna berbasis peran.

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`, lalu gunakan akun demo yang sudah terisi pada
halaman login.

## Verifikasi

```bash
npm run lint
npm test
```

`npm test` menjalankan build produksi dan pemeriksaan HTML hasil render.

## Catatan implementasi

- Antarmuka responsif dari viewport mobile 320 px hingga desktop lebar.
- Data dan aksi bersifat simulasi frontend sesuai PRD.
- Dokumen quotation, invoice, SPK, dan BAST dapat dibuat sebagai PDF.
- Ekspor pembukuan tersedia dalam format CSV.
