// Bagan alur pemakaian aplikasi — SATU sumber data untuk dua tempat:
// panduan PDF (server/api/sop-pdf-content.ts, bab "Alur kerja") dan Pusat
// Bantuan (app/components/help-view.tsx). Gambarnya dirender server menjadi
// PNG (server/api/alur-png.ts) supaya kedua tempat memperlihatkan bagan yang
// persis sama; teksnya tetap tersedia di sini untuk pencarian dan pembaca layar.
//
// Kenapa bukan SVG: SVG adalah dokumen yang bisa membawa <script>, dan
// melayaninya dari origin yang sama dengan cookie sesi dianggap XSS di repo
// ini (lihat server/api/cms-router.ts). PNG tidak punya masalah itu.

export type Bilingual = readonly [string, string];

export type PeranAlur =
  | "Admin"
  | "Project Manager"
  | "Engineer"
  | "Finance"
  | "Klien"
  | "Vendor";

/** Kunci layar mengikuti `ViewKey` di app/data.ts. */
export type LayarAlur =
  | "prospects"
  | "project"
  | "boq"
  | "billing"
  | "procurement"
  | "expenses"
  | "validation"
  | "bast"
  | "finance";

export interface LangkahAlur {
  key: string;
  /** Satu kalimat pendek; dipecah otomatis menjadi dua baris di bagan. */
  label: Bilingual;
  peran: readonly PeranAlur[];
  layar: LayarAlur;
  /** Syarat yang mengunci langkah ini; tampil kecil di bawah kotak. */
  syarat?: Bilingual;
}

export interface KeputusanAlur {
  key: string;
  tanya: Bilingual;
  /** Cabang "ya" melanjutkan rantai; cabang "tidak" kembali ke langkah lain. */
  ya: Bilingual;
  tidak: Bilingual;
  /** Kunci langkah tujuan cabang "tidak" (panah putus-putus). */
  kembaliKe?: string;
}

export type SimpulAlur =
  | ({ jenis: "langkah" } & LangkahAlur)
  | ({ jenis: "keputusan" } & KeputusanAlur);

export interface FaseAlur {
  key: string;
  judul: Bilingual;
  ringkas: Bilingual;
  simpul: readonly SimpulAlur[];
}

export const ALUR_APLIKASI_VERSI = "2026-08-21";

export const aluraplikasi: readonly FaseAlur[] = [
  {
    key: "prospek",
    judul: ["1 · Calon klien & proyek", "1 · Prospects & project"],
    ringkas: [
      "Kontak dikumpulkan tim, dihubungi, lalu dijadikan proyek begitu deal.",
      "Contacts are gathered by the team, contacted, and turned into a project once the deal lands.",
    ],
    simpul: [
      { jenis: "langkah", key: "prospek-catat", label: ["Catat calon klien (sumber wajib)", "Record the prospect (source required)"], peran: ["Admin", "Finance"], layar: "prospects" },
      { jenis: "langkah", key: "prospek-hubungi", label: ["Kirim surat perkenalan → Contacted", "Send the introduction → Contacted"], peran: ["Admin", "Finance"], layar: "prospects" },
      { jenis: "langkah", key: "prospek-proposal", label: ["Qualified → Proposal", "Qualified → Proposal"], peran: ["Admin", "Finance"], layar: "prospects" },
      { jenis: "langkah", key: "prospek-deal", label: ["Jadikan proyek (Won)", "Convert to project (Won)"], peran: ["Admin", "Project Manager"], layar: "prospects", syarat: ["Klien, PIC, email, lokasi dibawa otomatis", "Client, contact, email, location carried over"] },
      { jenis: "langkah", key: "proyek-paket", label: ["Proyek + paket komersial", "Project + commercial packages"], peran: ["Admin", "Project Manager"], layar: "project" },
    ],
  },
  {
    key: "kontrak",
    judul: ["2 · Penawaran & kontrak", "2 · Quotation & contract"],
    ringkas: [
      "BoQ menjadi Quotation; begitu klien menerima, angkanya terkunci dan ditagih per termin.",
      "The BoQ becomes a quotation; once the client accepts, the figures lock and are billed in installments.",
    ],
    simpul: [
      { jenis: "langkah", key: "boq", label: ["Susun BoQ per paket", "Build the BoQ per package"], peran: ["Project Manager", "Engineer"], layar: "boq" },
      { jenis: "langkah", key: "quotation", label: ["Quotation: diskon & pembulatan", "Quotation: discount & rounding"], peran: ["Admin", "Finance"], layar: "billing" },
      { jenis: "keputusan", key: "pajak-klien", tanya: ["Pajak aktif?", "Tax on?"], ya: ["Pilih aturan (PPN, PPh) → masuk grand total", "Choose rules (VAT, WHT) → into the grand total"], tidak: ["Tanpa baris pajak", "No tax lines"] },
      { jenis: "langkah", key: "kirim-klien", label: ["Kirim ke klien (email / tandai)", "Send to client (email / mark sent)"], peran: ["Admin", "Finance"], layar: "billing", syarat: ["Item BoQ terkunci dalam snapshot", "BoQ items frozen in a snapshot"] },
      { jenis: "keputusan", key: "klien-terima", tanya: ["Klien terima?", "Client accepts?"], ya: ["Unggah bukti → kontrak & pajak terkunci", "Upload proof → contract & taxes lock"], tidak: ["Revisi → quotation baru (-R2)", "Revise → new quotation (-R2)"], kembaliKe: "quotation" },
      { jenis: "langkah", key: "invoice", label: ["Invoice termin (%) dari grand total", "Installment invoices (%) of the grand total"], peran: ["Admin", "Finance"], layar: "billing", syarat: ["Termin terakhir menyerap pembulatan", "The final installment absorbs rounding"] },
      { jenis: "langkah", key: "bayar-klien", label: ["Pembayaran klien → Buku Kas", "Client payment → Cash Ledger"], peran: ["Finance"], layar: "billing", syarat: ["Kas = yang diterima; potongan PPh jadi piutang", "Cash = amount received; client WHT becomes receivable"] },
    ],
  },
  {
    key: "pelaksanaan",
    judul: ["3 · Pelaksanaan & vendor", "3 · Execution & vendors"],
    ringkas: [
      "Komitmen vendor lahir dari kontrak yang diterima; dibayar hanya sebesar bukti per termin.",
      "Vendor commitments come from the accepted contract; paid only as far as each term is evidenced.",
    ],
    simpul: [
      { jenis: "langkah", key: "spk", label: ["SPK / PO dari item BoQ yang diterima", "SPK / PO from accepted BoQ items"], peran: ["Project Manager", "Engineer"], layar: "procurement" },
      { jenis: "langkah", key: "setujui-spk", label: ["Ajukan → Setujui (pisah tugas)", "Submit → Approve (separation of duties)"], peran: ["Admin", "Finance"], layar: "procurement", syarat: ["Pajak vendor terkunci saat disetujui", "Vendor taxes lock at approval"] },
      { jenis: "langkah", key: "kirim-vendor", label: ["Kirim ke vendor → boleh dibayar", "Send to vendor → payable"], peran: ["Admin", "Project Manager"], layar: "procurement" },
      { jenis: "langkah", key: "verifikasi", label: ["Verifikasi progres / terima barang", "Verify progress / receive goods"], peran: ["Project Manager", "Engineer"], layar: "procurement" },
      { jenis: "langkah", key: "bayar-vendor", label: ["Bayar per termin → Buku Kas", "Pay per term → Cash Ledger"], peran: ["Finance"], layar: "procurement", syarat: ["PPh yang dipotong jadi utang pajak", "Withheld WHT becomes a tax payable"] },
      { jenis: "langkah", key: "belanja", label: ["Belanja proyek → setujui → reimburse", "Project expenses → approve → reimburse"], peran: ["Engineer", "Finance"], layar: "expenses" },
      { jenis: "keputusan", key: "addendum", tanya: ["Ada pekerjaan tambah?", "Extra work?"], ya: ["Addendum: BoQ & quotation sendiri", "Addendum: its own BoQ & quotation"], tidak: ["Lanjut serah terima", "Proceed to handover"], kembaliKe: "boq" },
    ],
  },
  {
    key: "serah-terima",
    judul: ["4 · Serah terima", "4 · Handover"],
    ringkas: [
      "Perangkat divalidasi di lokasi, BAST ditandatangani dua pihak dan dicap; semua paket selesai menutup proyek.",
      "Devices are validated on site, the certificate is signed by both parties and sealed; when every package is done the project closes.",
    ],
    simpul: [
      { jenis: "langkah", key: "validasi", label: ["Validasi perangkat & material", "Validate devices & materials"], peran: ["Project Manager", "Engineer"], layar: "validation", syarat: ["BoQ berubah → checklist kembali Draft", "BoQ change → checklist back to Draft"] },
      { jenis: "langkah", key: "bast", label: ["BAST: 2 tanda tangan + cap digital", "Certificate: 2 signatures + digital seal"], peran: ["Project Manager", "Klien"], layar: "bast", syarat: ["Final = immutable, bisa diverifikasi publik", "Final = immutable, publicly verifiable"] },
      { jenis: "keputusan", key: "semua-paket", tanya: ["Semua paket sudah BAST?", "All packages handed over?"], ya: ["Proyek Selesai", "Project Selesai (closed)"], tidak: ["Tetap Aktif", "Stays active"] },
    ],
  },
  {
    key: "keuangan",
    judul: ["5 · Kas, bank, laba & pajak", "5 · Cash, bank, profit & tax"],
    ringkas: [
      "Mutasi bank dicocokkan ke kas; laba aman dibagi dihitung dari kas nyata; kewajiban pajak disetor dan dilaporkan.",
      "Bank statements reconcile against cash; distributable profit comes from real cash; tax obligations are settled and filed.",
    ],
    simpul: [
      { jenis: "langkah", key: "bank", label: ["Impor mutasi → cocokkan (±14 hari)", "Import statement → match (±14 days)"], peran: ["Finance"], layar: "finance", syarat: ["Mutasi tak cocok tidak dihitung kas", "Unmatched lines never count as cash"] },
      { jenis: "langkah", key: "buku-kas", label: ["Buku Kas: masuk − keluar per proyek", "Cash Ledger: in − out per project"], peran: ["Finance"], layar: "finance", syarat: ["Void = reversal bertanggal asal", "Void = reversal dated at the original"] },
      { jenis: "langkah", key: "bagi-laba", label: ["Bagi laba dari laba aman", "Share profit from safe profit"], peran: ["Admin"], layar: "finance", syarat: ["− komitmen vendor − utang pajak − talangan", "− vendor commitments − tax payable − reimbursements"] },
      { jenis: "langkah", key: "pajak", label: ["Kewajiban pajak → setor → lapor", "Tax obligations → settle → file"], peran: ["Finance"], layar: "finance", syarat: ["Pelaporan hanya maju", "Filing only moves forward"] },
    ],
  },
];

/** Semua langkah (tanpa keputusan), untuk daftar teks dan pengujian. */
export function semuaLangkah() {
  return aluraplikasi.flatMap((fase) =>
    fase.simpul.filter((simpul): simpul is { jenis: "langkah" } & LangkahAlur => simpul.jenis === "langkah"),
  );
}

// ── Penyusun SVG ─────────────────────────────────────────────────────
//
// MURNI dan deterministik, tanpa dependensi server, supaya bisa diuji tanpa
// Next. Rasterisasi ke PNG (sharp) dan endpoint-nya ada di
// server/api/alur-png.ts. SVG ini tidak pernah dilayani apa adanya ke peramban.

export type Language = "id" | "en";

export const LEBAR_BAGAN = 1400;
const LEBAR = LEBAR_BAGAN;
const TEPI = 40;
const KOLOM_JUDUL = 240;
const LEBAR_SIMPUL = 230;
const TINGGI_SIMPUL = 96;
const JARAK_X = 50;
const TINGGI_BARIS = 190;
const SIMPUL_PER_BARIS = 4;
const TINGGI_KEPALA = 88;

const WARNA = {
  tinta: "#142a3b",
  teks: "#3e5566",
  aksen: "#3fbeb8",
  tealGelap: "#127671",
  tealLembut: "#e7f8f6",
  amber: "#b7791f",
  amberLembut: "#fff6e0",
  garis: "#d5e3e8",
  pita: "#f5fafb",
};

function pilih(language: Language, teks: readonly [string, string]) {
  return language === "en" ? teks[1] : teks[0];
}

function xml(teks: string) {
  return teks
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Pecah per kata ke maksimal `maks` baris; baris terakhir dipotong dengan …. */
function bungkus(teks: string, perBaris: number, maks: number) {
  const kata = teks.split(/\s+/).filter(Boolean);
  const baris: string[] = [];
  let sekarang = "";
  for (const k of kata) {
    const calon = sekarang ? `${sekarang} ${k}` : k;
    if (calon.length > perBaris && sekarang) {
      baris.push(sekarang);
      sekarang = k;
    } else {
      sekarang = calon;
    }
  }
  if (sekarang) baris.push(sekarang);
  if (baris.length > maks) {
    const sisa = baris.slice(0, maks);
    sisa[maks - 1] = `${sisa[maks - 1].slice(0, Math.max(1, perBaris - 1))}…`;
    return sisa;
  }
  return baris;
}

interface Letak {
  simpul: SimpulAlur;
  x: number;
  y: number;
}

function tataFase(fase: FaseAlur, yAwal: number) {
  const letak: Letak[] = [];
  const xAwal = TEPI + KOLOM_JUDUL;
  fase.simpul.forEach((simpul, index) => {
    const baris = Math.floor(index / SIMPUL_PER_BARIS);
    const kolom = index % SIMPUL_PER_BARIS;
    letak.push({
      simpul,
      x: xAwal + kolom * (LEBAR_SIMPUL + JARAK_X),
      y: yAwal + 24 + baris * TINGGI_BARIS,
    });
  });
  const jumlahBaris = Math.max(1, Math.ceil(fase.simpul.length / SIMPUL_PER_BARIS));
  const tinggi = 24 + jumlahBaris * TINGGI_BARIS + 16;
  return { letak, tinggi };
}

function panah(x1: number, y1: number, x2: number, y2: number, putus = false) {
  const gaya = putus
    ? `stroke="${WARNA.amber}" stroke-width="2.5" stroke-dasharray="8 6"`
    : `stroke="${WARNA.aksen}" stroke-width="3"`;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${gaya} marker-end="url(#${putus ? "panahAmber" : "panahTeal"})"/>`;
}

function garisPutus(titik: Array<[number, number]>) {
  const d = titik.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return `<path d="${d}" fill="none" stroke="${WARNA.amber}" stroke-width="2.5" stroke-dasharray="8 6" marker-end="url(#panahAmber)"/>`;
}

function teksBaris(
  baris: string[],
  x: number,
  yTengah: number,
  ukuran: number,
  opsi: { tebal?: boolean; warna?: string; anchor?: "middle" | "start" } = {},
) {
  const jarak = ukuran * 1.25;
  const yMulai = yTengah - ((baris.length - 1) * jarak) / 2;
  return baris
    .map(
      (b, i) =>
        `<text x="${x}" y="${(yMulai + i * jarak).toFixed(1)}" font-size="${ukuran}" ${opsi.tebal ? 'font-weight="700"' : ""} fill="${opsi.warna ?? WARNA.tinta}" text-anchor="${opsi.anchor ?? "middle"}" dominant-baseline="middle">${xml(b)}</text>`,
    )
    .join("");
}

function gambarLangkah(language: Language, l: Letak, nomor: number) {
  if (l.simpul.jenis !== "langkah") return "";
  const s = l.simpul;
  const tengahX = l.x + LEBAR_SIMPUL / 2;
  const label = bungkus(pilih(language, s.label), 24, 2);
  const peran = s.peran.join(" · ");
  const syarat = s.syarat ? bungkus(pilih(language, s.syarat), 34, 2) : [];
  return [
    `<rect x="${l.x}" y="${l.y}" width="${LEBAR_SIMPUL}" height="${TINGGI_SIMPUL}" rx="12" fill="${WARNA.tealLembut}" stroke="${WARNA.aksen}" stroke-width="2"/>`,
    `<circle cx="${l.x + 2}" cy="${l.y + 2}" r="14" fill="${WARNA.tealGelap}" stroke="#ffffff" stroke-width="2"/>`,
    `<text x="${l.x + 2}" y="${l.y + 3}" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${nomor}</text>`,
    teksBaris(label, tengahX, l.y + 38, 16, { tebal: true }),
    teksBaris([peran], tengahX, l.y + TINGGI_SIMPUL - 16, 11.5, { warna: WARNA.tealGelap }),
    syarat.length
      ? teksBaris(syarat, tengahX, l.y + TINGGI_SIMPUL + 18, 11, { warna: WARNA.teks })
      : "",
  ].join("");
}

function gambarKeputusan(language: Language, l: Letak) {
  if (l.simpul.jenis !== "keputusan") return "";
  const k = l.simpul;
  const cx = l.x + LEBAR_SIMPUL / 2;
  const cy = l.y + TINGGI_SIMPUL / 2;
  const setengahLebar = LEBAR_SIMPUL / 2;
  const setengahTinggi = TINGGI_SIMPUL / 2 + 6;
  const titik = `${cx},${cy - setengahTinggi} ${cx + setengahLebar},${cy} ${cx},${cy + setengahTinggi} ${cx - setengahLebar},${cy}`;
  const tanya = bungkus(pilih(language, k.tanya), 18, 2);
  const ya = bungkus(`${language === "en" ? "Yes" : "Ya"}: ${pilih(language, k.ya)}`, 34, 2);
  const tidak = bungkus(`${language === "en" ? "No" : "Tidak"}: ${pilih(language, k.tidak)}`, 34, 2);
  return [
    `<polygon points="${titik}" fill="${WARNA.amberLembut}" stroke="${WARNA.amber}" stroke-width="2"/>`,
    teksBaris(tanya, cx, cy, 14, { tebal: true, warna: WARNA.amber }),
    teksBaris(ya, cx, l.y + TINGGI_SIMPUL + 20, 10.5, { warna: WARNA.tealGelap }),
    teksBaris(tidak, cx, l.y + TINGGI_SIMPUL + 20 + ya.length * 13 + 6, 10.5, { warna: WARNA.amber }),
  ].join("");
}

function gambarSambungan(letak: Letak[], semuaLetak: Map<string, Letak>, language: Language) {
  const bagian: string[] = [];
  for (let i = 0; i < letak.length - 1; i += 1) {
    const a = letak[i];
    const b = letak[i + 1];
    if (a.y === b.y) {
      bagian.push(panah(a.x + LEBAR_SIMPUL, a.y + TINGGI_SIMPUL / 2, b.x - 4, b.y + TINGGI_SIMPUL / 2));
    } else {
      // Pindah baris: keluar dari sisi kanan kotak, turun lewat luar kotak,
      // menyusur celah di bawah teks keterangan, lalu turun ke simpul pertama
      // baris bawah. Lewat tengah kotak akan melintasi teks keterangannya.
      const xSamping = a.x + LEBAR_SIMPUL + 14;
      const yTengahKotak = a.y + TINGGI_SIMPUL / 2;
      const yAntar = b.y - 14;
      const xTujuan = b.x + LEBAR_SIMPUL / 2;
      bagian.push(
        `<path d="M${a.x + LEBAR_SIMPUL} ${yTengahKotak} L${xSamping} ${yTengahKotak} L${xSamping} ${yAntar} L${xTujuan} ${yAntar} L${xTujuan} ${b.y - 4}" fill="none" stroke="${WARNA.aksen}" stroke-width="3" marker-end="url(#panahTeal)"/>`,
      );
    }
  }
  // Cabang "tidak" yang kembali ke langkah lain: panah putus-putus amber.
  for (const l of letak) {
    if (l.simpul.jenis !== "keputusan" || !l.simpul.kembaliKe) continue;
    const tujuan = semuaLetak.get(l.simpul.kembaliKe);
    if (!tujuan) continue;
    const dariX = l.x + LEBAR_SIMPUL / 2;
    const dariY = l.y + TINGGI_SIMPUL + 30;
    if (tujuan.y === l.y) {
      const yBawah = l.y + TINGGI_BARIS - 22;
      const xTujuan = tujuan.x + LEBAR_SIMPUL - 24;
      bagian.push(
        garisPutus([
          [dariX, dariY + 36],
          [dariX, yBawah],
          [xTujuan, yBawah],
          [xTujuan, tujuan.y + TINGGI_SIMPUL + 4],
        ]),
      );
    } else {
      // Tujuan di fase lain: tulis arah kembalinya saja, tanpa panah panjang
      // yang akan melintasi fase-fase di antaranya.
      const label = tujuan.simpul.jenis === "langkah" ? pilih(language, tujuan.simpul.label) : "";
      bagian.push(
        `<text x="${dariX}" y="${dariY + 42}" font-size="10.5" fill="${WARNA.amber}" text-anchor="middle">↺ ${xml(label)}</text>`,
      );
    }
  }
  return bagian.join("");
}

/** Murni dan deterministik: SVG lengkap untuk satu bahasa. */
export function susunSvg(language: Language) {
  const fase = aluraplikasi;
  const tataLetak: Array<{ fase: FaseAlur; y: number; tinggi: number; letak: Letak[] }> = [];
  let y = TINGGI_KEPALA;
  for (const f of fase) {
    const hasil = tataFase(f, y);
    tataLetak.push({ fase: f, y, tinggi: hasil.tinggi, letak: hasil.letak });
    y += hasil.tinggi;
  }
  const tinggiTotal = y + 36;
  const semuaLetak = new Map<string, Letak>();
  for (const t of tataLetak) for (const l of t.letak) semuaLetak.set(l.simpul.key, l);

  const bagian: string[] = [];
  bagian.push(`<rect x="0" y="0" width="${LEBAR}" height="${tinggiTotal}" fill="#ffffff"/>`);
  bagian.push(
    `<text x="${TEPI}" y="40" font-size="26" font-weight="700" fill="${WARNA.tinta}">${xml(language === "en" ? "How PerumNet Enterprise is used — from prospect to profit" : "Alur pemakaian PerumNet Enterprise — dari calon klien sampai laba")}</text>`,
  );
  bagian.push(
    `<text x="${TEPI}" y="64" font-size="13" fill="${WARNA.teks}">${xml(language === "en" ? "Each stage locks the one before it. Amber diamonds are decisions; dashed arrows go back to an earlier step." : "Setiap tahap mengunci tahap sebelumnya. Belah ketupat amber = keputusan; panah putus-putus = kembali ke langkah sebelumnya.")}</text>`,
  );

  let nomor = 0;
  tataLetak.forEach((t, indeks) => {
    if (indeks % 2 === 0) {
      bagian.push(`<rect x="0" y="${t.y}" width="${LEBAR}" height="${t.tinggi}" fill="${WARNA.pita}"/>`);
    }
    bagian.push(`<line x1="0" y1="${t.y}" x2="${LEBAR}" y2="${t.y}" stroke="${WARNA.garis}" stroke-width="1"/>`);
    const judul = bungkus(pilih(language, t.fase.judul), 20, 2);
    const ringkas = bungkus(pilih(language, t.fase.ringkas), 32, 4);
    bagian.push(teksBaris(judul, TEPI, t.y + 44, 18, { tebal: true, anchor: "start", warna: WARNA.tealGelap }));
    bagian.push(teksBaris(ringkas, TEPI, t.y + 44 + judul.length * 12 + 40, 11.5, { anchor: "start", warna: WARNA.teks }));
    bagian.push(gambarSambungan(t.letak, semuaLetak, language));
    for (const l of t.letak) {
      if (l.simpul.jenis === "langkah") {
        nomor += 1;
        bagian.push(gambarLangkah(language, l, nomor));
      } else {
        bagian.push(gambarKeputusan(language, l));
      }
    }
    // Penghubung antarfase: dari simpul terakhir turun ke simpul pertama fase berikutnya.
    const berikut = tataLetak[indeks + 1];
    if (berikut && t.letak.length && berikut.letak.length) {
      const akhir = t.letak[t.letak.length - 1];
      const awal = berikut.letak[0];
      const xSamping = akhir.x + LEBAR_SIMPUL + 14;
      const yTengahKotak = akhir.y + TINGGI_SIMPUL / 2;
      const yTengah = berikut.y + 10;
      const xKe = awal.x + LEBAR_SIMPUL / 2;
      bagian.push(
        `<path d="M${akhir.x + LEBAR_SIMPUL} ${yTengahKotak} L${xSamping} ${yTengahKotak} L${xSamping} ${yTengah} L${xKe} ${yTengah} L${xKe} ${awal.y - 4}" fill="none" stroke="${WARNA.aksen}" stroke-width="3" marker-end="url(#panahTeal)"/>`,
      );
    }
  });
  bagian.push(
    `<text x="${LEBAR - TEPI}" y="${tinggiTotal - 14}" font-size="10.5" fill="${WARNA.teks}" text-anchor="end">PerumNet Enterprise · ${xml(language === "en" ? "flow version" : "versi alur")} ${ALUR_APLIKASI_VERSI}</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LEBAR}" height="${tinggiTotal}" viewBox="0 0 ${LEBAR} ${tinggiTotal}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif">
<defs>
<marker id="panahTeal" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 z" fill="${WARNA.aksen}"/></marker>
<marker id="panahAmber" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 z" fill="${WARNA.amber}"/></marker>
</defs>
${bagian.join("\n")}
</svg>`;
}
