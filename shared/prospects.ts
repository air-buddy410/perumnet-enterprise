// Kontrak calon klien (prospek) yang dipakai server DAN layar.
//
// Prospek berbeda dari `cms_leads`. `cms_leads` diisi pengunjung situs yang
// mencentang kotak privasi; prospek dikumpulkan tim sendiri — dari kartu nama,
// telepon masuk, atau berkas yang diserahkan pemilik. Orangnya tidak pernah
// meminta dihubungi, jadi dua hal wajib menempel padanya: catatan tertulis dari
// mana kontaknya didapat, dan cara berhenti dihubungi.

export const prospectStatuses = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal",
  "Won",
  "Lost",
] as const;
export type ProspectStatus = (typeof prospectStatuses)[number];

export const prospectStatusLabels: Record<
  ProspectStatus,
  { id: string; en: string }
> = {
  New: { id: "Baru", en: "New" },
  Contacted: { id: "Sudah dihubungi", en: "Contacted" },
  Qualified: { id: "Memenuhi syarat", en: "Qualified" },
  Proposal: { id: "Penawaran terkirim", en: "Proposal sent" },
  Won: { id: "Jadi klien", en: "Won" },
  Lost: { id: "Tidak jadi", en: "Lost" },
};

export const prospectSegments = [
  "perumahan",
  "apartemen",
  "perkantoran",
  "ruko",
  "hotel",
  "pendidikan",
  "kesehatan",
  "pemerintahan",
  "industri",
  "lainnya",
] as const;
export type ProspectSegment = (typeof prospectSegments)[number];

export const prospectSegmentLabels: Record<
  ProspectSegment,
  { id: string; en: string }
> = {
  perumahan: { id: "Perumahan", en: "Residential" },
  apartemen: { id: "Apartemen", en: "Apartment" },
  perkantoran: { id: "Perkantoran", en: "Office" },
  ruko: { id: "Ruko", en: "Shophouse" },
  hotel: { id: "Hotel", en: "Hotel" },
  pendidikan: { id: "Pendidikan", en: "Education" },
  kesehatan: { id: "Kesehatan", en: "Healthcare" },
  pemerintahan: { id: "Pemerintahan", en: "Government" },
  industri: { id: "Industri", en: "Industrial" },
  lainnya: { id: "Lainnya", en: "Other" },
};

// ── Template surat ───────────────────────────────────────────────────
//
// Placeholder sengaja sedikit dan semuanya berasal dari baris prospek. Tidak
// ada yang mengambil dari input pemanggil: template dirender di server, dan
// nilai yang bisa dikendalikan pemanggil di dalam HTML adalah jalan masuk
// injeksi.

export const prospectPlaceholders = [
  "nama",
  "perusahaan",
  "jabatan",
  "kota",
  "segmen",
] as const;
export type ProspectPlaceholder = (typeof prospectPlaceholders)[number];

export const prospectPlaceholderHints: Record<
  ProspectPlaceholder,
  { id: string; en: string }
> = {
  nama: { id: "Nama lengkap kontak", en: "Contact full name" },
  perusahaan: { id: "Nama perusahaan", en: "Company name" },
  jabatan: { id: "Jabatan", en: "Job title" },
  kota: { id: "Lokasi / kota", en: "Location / city" },
  segmen: { id: "Segmen pasar", en: "Market segment" },
};

/**
 * `{{ nama }}` maupun `{{nama}}`. Sengaja hanya huruf kecil dan garis bawah —
 * pola yang lebih longgar akan ikut menangkap potongan HTML dan mengubah
 * render jadi tebak-tebakan.
 */
export const prospectPlaceholderPattern = /\{\{\s*([a-z_]+)\s*\}\}/g;

// ── Batas pengiriman ─────────────────────────────────────────────────
//
// Mailcow yang membawa email penawaran ini juga membawa invoice dan tautan
// reset kata sandi. Kalau reputasi domainnya rusak karena satu kampanye,
// keduanya ikut tidak sampai — dan itu baru ketahuan saat ada yang tidak bisa
// masuk atau tidak menerima tagihan.

/** Jeda bawaan antar pesan dalam satu batch, dalam detik. */
export const PROSPECT_DEFAULT_SPACING_SECONDS = 60;

/** Jeda terbesar yang boleh diminta: 1 jam. */
export const PROSPECT_MAX_SPACING_SECONDS = 3_600;

/** Penerima terbanyak dalam satu permintaan kirim. */
export const PROSPECT_MAX_RECIPIENTS_PER_BATCH = 200;

/** Panjang minimal catatan "dari mana kontak ini didapat". */
export const PROSPECT_SOURCE_MIN_LENGTH = 2;
