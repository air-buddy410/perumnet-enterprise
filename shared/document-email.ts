// Kontrak pengiriman dokumen lewat email — dipakai server DAN layar.
//
// Dokumen resminya TIDAK PERNAH diunggah: aplikasi sudah memilikinya. Meminta
// orang mengunduh lalu mengunggah ulang bukan cuma kerja dua kali — berkas yang
// diunggah bisa versi lama sementara datanya sudah berubah, dan tidak ada yang
// memberi tahu. Unggahan di sini HANYA untuk lampiran tambahan: company
// profile, spesifikasi teknis, foto lokasi.
//
// Dari mana byte-nya diambil berbeda per jenis, dan bedanya penting:
//
//   quotation, invoice, spk : DIRENDER saat tombol Kirim ditekan. Dokumennya
//                             masih hidup — nilainya bisa berubah sampai detik
//                             terakhir, jadi yang benar adalah yang terbaru.
//   bast                    : DIAMBIL dari arsip final. BAST yang sudah
//                             ditandatangani punya sidik SHA-256 yang tercatat
//                             dan halaman verifikasi publik yang memajangnya.
//                             Render ulang menghasilkan byte yang berbeda,
//                             jadi sidiknya tidak akan cocok — dan surat yang
//                             seharusnya menjadi BUKTI justru membawa dokumen
//                             yang tidak bisa dibuktikan.

export const documentEmailKinds = [
  "quotation",
  "invoice",
  "spk",
  "bast",
] as const;
export type DocumentEmailKind = (typeof documentEmailKinds)[number];

export const documentEmailKindLabels: Record<
  DocumentEmailKind,
  { id: string; en: string }
> = {
  quotation: { id: "Penawaran", en: "Quotation" },
  invoice: { id: "Invoice", en: "Invoice" },
  spk: { id: "SPK / PO", en: "Work order / PO" },
  bast: { id: "BAST", en: "Handover" },
};

// ── Kategori penerima ────────────────────────────────────────────────
//
// Surat keluar aplikasi ini punya TIGA penerima yang berbeda sifatnya, dan
// itulah pengelompokan yang masuk akal di layar — bukan "semua template" dalam
// satu daftar panjang:
//
//   calon-klien : orang yang belum jadi klien. Template & aturannya terpisah
//                 sama sekali (cms_prospect_templates): ada opt-out, ada jeda
//                 kirim, penandanya {{nama}}/{{perusahaan}}/{{segmen}}, dan
//                 tidak ada dokumen resmi yang dilampirkan.
//   klien       : Quotation, Invoice, dan BAST. Izinnya Quotation & Invoice
//                 untuk dua yang pertama, BAST Digital untuk yang terakhir.
//   vendor      : SPK dan PO. Izinnya Procurement & Vendor.
//
// Dua yang terakhir hidup di tabel yang sama (document_email_templates) karena
// bentuk suratnya sama — yang membedakan penanda dan izinnya. `calon-klien`
// sengaja TIDAK dilebur ke sini: menyatukannya berarti template perkenalan
// bisa terpilih untuk invoice, lalu {{jatuh_tempo}} tidak pernah terisi.

export type DocumentEmailAudience = "klien" | "vendor";

export const documentEmailAudience: Record<
  DocumentEmailKind,
  DocumentEmailAudience
> = {
  quotation: "klien",
  invoice: "klien",
  spk: "vendor",
  bast: "klien",
};

export const documentEmailAudienceLabels: Record<
  DocumentEmailAudience,
  { id: string; en: string }
> = {
  klien: { id: "Surat ke klien", en: "Letters to clients" },
  vendor: { id: "Surat ke vendor", en: "Letters to vendors" },
};

// ── Batas lampiran ───────────────────────────────────────────────────
//
// Server SMTP mengizinkan 100 MB, jadi bukan ia yang mengikat.
//
// KOREKSI 20 Agu: yang mengikat BUKAN pekerja email. Proses PM2
// `perumnet-enterprise-email-worker` (jatah 180 MB) hanya memanggil satu
// `fetch` ke /api/internal/email-dispatch — ia tidak pernah menyentuh byte
// lampiran. Yang benar-benar menampung byte adalah `perumnet-enterprise`,
// jatah 700 MB, proses yang SAMA yang melayani pengguna dan merender PDF.
//
// Itu membuat batasnya lebih penting, bukan kurang: kehabisan memori di sana
// menjatuhkan permintaan pengguna yang sedang berjalan, dan meninggalkan baris
// outbox berstatus Processing yang baru diambil ulang 10 menit kemudian —
// sambil dihitung satu percobaan. Lima kali begitu, suratnya gagal permanen
// karena memori, bukan karena surat.

/** Satu berkas lampiran tambahan. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Seluruh lampiran dalam satu email, termasuk dokumen yang dirender.
 *
 * Diturunkan dari 25 MB ke 10 MB setelah menghitung memorinya. Untuk SMTP,
 * satu pesan menahan buffer-nya (N) plus hasil encode base64 nodemailer
 * (~1,37N) — sekitar 2,4N transien, di dalam proses yang juga melayani
 * pengguna. Lewat Resend lebih boros lagi karena JSON.stringify menyalinnya
 * sekali lagi.
 *
 * Alasan kedua yang berdiri sendiri: banyak gateway email perusahaan membuang
 * lampiran di atas 10 MB tanpa memberi tahu siapa pun. Surat yang "Terkirim"
 * tapi lampirannya dicopot di tengah jalan adalah kegagalan paling sulit
 * dilacak yang bisa dibuat fitur ini.
 */
export const ATTACHMENT_TOTAL_MAX_BYTES = 10 * 1024 * 1024;

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
  // BAST tidak punya nilai uang, dan sengaja tidak dikarang dari quotation:
  // surat ini adalah bukti serah terima, bukan tagihan. Yang dibawanya justru
  // dua hal yang membuatnya BISA DIBUKTIKAN — sidik SHA-256 arsip final dan
  // tautan halaman verifikasi publik, sama persis dengan yang tercetak di QR
  // pada PDF-nya.
  bast: [
    "nomor",
    "klien",
    "proyek",
    "paket",
    "tanggal_serah_terima",
    "sidik_dokumen",
    "tautan_verifikasi",
  ],
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
  paket: { id: "Paket pekerjaan", en: "Work package" },
  tanggal_serah_terima: { id: "Tanggal serah terima", en: "Handover date" },
  sidik_dokumen: {
    id: "Sidik digital arsip (SHA-256)",
    en: "Archive fingerprint (SHA-256)",
  },
  tautan_verifikasi: {
    id: "Tautan verifikasi publik",
    en: "Public verification link",
  },
};

/** `{{ nomor }}` maupun `{{nomor}}`. Sama dengan pola surat prospek. */
export const documentEmailPlaceholderPattern = /\{\{\s*([a-z_]+)\s*\}\}/g;
