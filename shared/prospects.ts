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

// Segmen diambil dari nama lembar di workbook kontak milik pemilik, bukan
// dikarang: itu pembagian pasar yang benar-benar dipakai tim.
export const prospectSegments = [
  "konstruksi-arsitektur",
  "developer",
  "smart-home",
  "hotel-villa",
  "lainnya",
] as const;
export type ProspectSegment = (typeof prospectSegments)[number];

export const prospectSegmentLabels: Record<
  ProspectSegment,
  { id: string; en: string }
> = {
  "konstruksi-arsitektur": {
    id: "Konstruksi & Arsitektur",
    en: "Construction & Architecture",
  },
  developer: { id: "Developer", en: "Developer" },
  "smart-home": { id: "Smart Home", en: "Smart Home" },
  "hotel-villa": { id: "Hotel & Villa", en: "Hotel & Villa" },
  lainnya: { id: "Lainnya", en: "Other" },
};

/**
 * Nama lembar workbook -> segmen. Dicocokkan setelah huruf dikecilkan dan
 * yang bukan huruf/angka dibuang, supaya "Kontruksi & Arsitektur" (salah ketik
 * di berkas sumber) dan "Konstruksi dan Arsitektur" sama-sama kena.
 */
export function segmenDariNamaLembar(nama: string): ProspectSegment {
  const kunci = nama.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (kunci.includes("arsitek") || kunci.includes("kontruksi") || kunci.includes("konstruksi")) {
    return "konstruksi-arsitektur";
  }
  if (kunci.includes("develop")) return "developer";
  if (kunci.includes("smarthome") || kunci.includes("smart")) return "smart-home";
  if (kunci.includes("hotel") || kunci.includes("villa")) return "hotel-villa";
  return "lainnya";
}

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

// ── Status pengiriman surat ──────────────────────────────────────────
//
// Daftar ini sempat hidup dua kali — satu di router, satu lagi di layar —
// tanpa keduanya tahu. Kalau suatu saat berbeda, server diam-diam mengabaikan
// nilai penyaring yang tidak dikenalnya: filternya terlihat berfungsi, tapi
// tidak mempersempit apa pun. Kegagalan yang tidak berbunyi seperti itu yang
// paling lama tidak ketahuan.

export const prospectOutreachStatuses = [
  "Queued",
  "Sent",
  "Failed",
  "Skipped",
] as const;
export type ProspectOutreachStatus = (typeof prospectOutreachStatuses)[number];

export const prospectOutreachStatusLabels: Record<
  ProspectOutreachStatus,
  { id: string; en: string }
> = {
  // "Masih diproses", bukan "Menunggu": baris ini juga menampung kegagalan
  // yang masih punya sisa percobaan, dan menyebutnya menunggu membuat orang
  // mengira tidak ada yang pernah salah.
  Queued: { id: "Masih diproses", en: "In progress" },
  Sent: { id: "Terkirim", en: "Sent" },
  Failed: { id: "Gagal", en: "Failed" },
  Skipped: { id: "Tidak dikirim", en: "Not sent" },
};

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

// ── Bentuk isi surat ─────────────────────────────────────────────────
//
// Admin mengetik TEKS BIASA. Kop berlogo, tanda tangan, dan catatan kaki
// ditempelkan server (lihat `server/prospect-letter.ts`), jadi tidak ada yang
// perlu menulis HTML untuk mengirim surat yang rapi.
//
// `rich` untuk surat yang butuh huruf tebal, miring, daftar, dan tautan.
// Yang disimpan BUKAN HTML: ia penanda ringan (`**tebal**`, `- daftar`,
// `[teks](url)`) yang diubah server menjadi HTML dari kumpulan tag yang
// tertutup. Jadi tidak ada satu pun tag yang berasal dari pengetik.
//
// Itu keputusan yang disengaja, bukan kemalasan. Repo ini tidak punya
// penyanitasi HTML, dan menulis penyanitasi sendiri adalah jenis kode yang
// terlihat benar sampai suatu hari tidak. Menempel dari Word juga membawa
// markup yang merusak tampilan di klien email dan menaikkan skor spam. Dengan
// menghasilkan seluruh tag-nya sendiri, aman-nya berasal dari bentuk kodenya,
// bukan dari daftar larangan yang harus selalu lengkap.
//
// `html` masih ada untuk surat yang memang disusun sebagai markup oleh orang
// yang tahu persis apa yang ia tulis. Ia TIDAK disanitasi — jangan pernah
// menjadikannya keluaran sebuah editor.

export const prospectLetterFormats = ["text", "rich", "html"] as const;
export type ProspectLetterFormat = (typeof prospectLetterFormats)[number];

export const PROSPECT_DEFAULT_LETTER_FORMAT: ProspectLetterFormat = "text";

/**
 * Naskah perkenalan milik PerumNet Enterprise, supaya kotak template tidak
 * pernah dibuka dalam keadaan kosong.
 *
 * Isinya dari tim, bukan karangan: ini surat yang memang dipakai. Yang diubah
 * hanya salah ketik yang jelas (konstruksi, efisiensi, operasional, dijalankan)
 * dan satu tanda kurung yang tidak pernah ditutup.
 *
 * TIDAK ADA tanda tangan di sini. Repositori ini publik, dan nama serta email
 * pegawai tidak boleh masuk ke dalamnya. Tanda tangan diisi di aplikasi,
 * bawaannya dari akun yang sedang masuk.
 */
export const PROSPECT_STARTER_TEMPLATE = {
  name: "Perkenalan PerumNet Enterprise",
  subject: "Perkenalan PerumNet Enterprise untuk {{perusahaan}}",
  body: `Yth. Bapak/Ibu,
{{nama}}

Salam Hormat dari PerumNet Enterprise.
Perkenankan kami memperkenalkan PerumNet Enterprise sebagai penyedia solusi infrastruktur teknologi jaringan dan sistem terintegrasi (jaringan WiFi, CCTV, smart home/building automation) di Bali yang dirancang untuk mendukung kebutuhan proyek di sektor arsitektur, konstruksi, developer, dan lainnya.

Kami memahami bahwa perkembangan industri saat ini menuntut penerapan teknologi yang mampu meningkatkan konektivitas, keamanan, efisiensi operasional, serta kenyamanan pengguna. Maka dari itu, kami percaya bahwa solusi yang kami tawarkan dapat menjadi nilai tambah dalam mendukung pengembangan proyek yang sedang maupun yang akan dilaksanakan oleh perusahaan Bapak/Ibu.

Untuk mengenal lebih jauh tentang PerumNet Enterprise, silakan cek portofolio kami di enterprise.perumnet.id, di mana terdapat beberapa proyek yang sudah kami jalankan, salah satunya Sandy House Project. Kami berharap dapat menjalin komunikasi lebih lanjut untuk mendiskusikan peluang kolaborasi yang dapat memberikan manfaat bagi kedua belah pihak.

Terima kasih atas perhatian dan kerja samanya.`,
  signoff: "Best Regards,",
} as const;
