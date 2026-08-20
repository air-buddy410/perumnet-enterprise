// Kontrak pengiriman dokumen lewat email — dipakai server DAN layar.
//
// Dokumen resminya (quotation, invoice, SPK/PO) TIDAK diunggah: aplikasi sudah
// membuatnya sendiri dan merendernya saat tombol Kirim ditekan. Meminta orang
// mengunduh lalu mengunggah ulang bukan cuma kerja dua kali — berkas yang
// diunggah bisa versi lama sementara datanya sudah berubah, dan tidak ada yang
// memberi tahu. Unggahan di sini HANYA untuk lampiran tambahan: company
// profile, spesifikasi teknis, foto lokasi.

export const documentEmailKinds = ["quotation", "invoice", "spk"] as const;
export type DocumentEmailKind = (typeof documentEmailKinds)[number];

export const documentEmailKindLabels: Record<
  DocumentEmailKind,
  { id: string; en: string }
> = {
  quotation: { id: "Penawaran", en: "Quotation" },
  invoice: { id: "Invoice", en: "Invoice" },
  spk: { id: "SPK / PO", en: "Work order / PO" },
};

// ── Batas lampiran ───────────────────────────────────────────────────
//
// Server SMTP mengizinkan 100 MB, jadi bukan ia yang mengikat. Yang mengikat
// pekerja email: PM2 mematikannya di 180 MB, dan ia memproses 25 baris tiap
// putaran. Angka di bawah dipilih supaya satu putaran penuh tetap muat.

/** Satu berkas lampiran tambahan. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Seluruh lampiran dalam satu email, termasuk dokumen yang dirender. */
export const ATTACHMENT_TOTAL_MAX_BYTES = 25 * 1024 * 1024;

/** Lampiran TAMBAHAN per email; dokumen resminya tidak dihitung. */
export const ATTACHMENT_MAX_COUNT = 5;

/**
 * Jenis yang boleh dilampirkan. Diperiksa dari ISI berkasnya, bukan dari nama
 * atau dari tipe yang diakui peramban — keduanya ditentukan pengirim.
 */
export const ATTACHMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_ALLOWED_MIME_TYPES)[number];

export function isAllowedAttachmentMimeType(
  value: string,
): value is AttachmentMimeType {
  return (ATTACHMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** "10 MB", "25 MB" — untuk pesan galat dan keterangan di layar. */
export function formatByteLimit(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// ── Placeholder per jenis dokumen ────────────────────────────────────
//
// Semua nilainya berasal dari baris dokumen. TIDAK ADA yang mengambil dari
// masukan pemanggil: nilai yang bisa dikendalikan pemanggil di dalam HTML
// adalah jalan masuk injeksi, dan surat ini keluar atas nama perusahaan.

export const documentEmailPlaceholders: Record<
  DocumentEmailKind,
  readonly string[]
> = {
  quotation: ["nomor", "klien", "proyek", "nilai", "berlaku_sampai"],
  invoice: ["nomor", "klien", "proyek", "nilai", "jatuh_tempo", "sisa"],
  spk: ["nomor", "vendor", "proyek", "nilai", "mulai", "selesai"],
};

export const documentEmailPlaceholderHints: Record<
  string,
  { id: string; en: string }
> = {
  nomor: { id: "Nomor dokumen", en: "Document number" },
  klien: { id: "Nama klien", en: "Client name" },
  vendor: { id: "Nama vendor", en: "Vendor name" },
  proyek: { id: "Nama proyek", en: "Project name" },
  nilai: { id: "Nilai dokumen", en: "Document value" },
  berlaku_sampai: { id: "Tanggal berlaku sampai", en: "Valid until" },
  jatuh_tempo: { id: "Tanggal jatuh tempo", en: "Due date" },
  sisa: { id: "Sisa tagihan", en: "Outstanding balance" },
  mulai: { id: "Tanggal mulai", en: "Start date" },
  selesai: { id: "Tanggal selesai", en: "End date" },
};

/** `{{ nomor }}` maupun `{{nomor}}`. Sama dengan pola surat prospek. */
export const documentEmailPlaceholderPattern = /\{\{\s*([a-z_]+)\s*\}\}/g;
