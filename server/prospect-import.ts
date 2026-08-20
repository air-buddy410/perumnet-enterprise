import "server-only";

import ExcelJS from "exceljs";
import {
  segmenDariNamaLembar,
  type ProspectSegment,
} from "../shared/prospects";

/**
 * Membaca workbook kontak jadi baris yang siap disimpan.
 *
 * Sengaja TIDAK menyentuh database: aturan "kontak seperti apa yang sah" hidup
 * di router bersama jalur tambah-manual, supaya tidak ada dua definisi yang
 * bisa berbeda diam-diam. Berkas ini hanya menerjemahkan sel jadi nilai.
 *
 * Sel yang meragukan DILAPORKAN, bukan dibuang. Membuang baris diam-diam
 * membuat 200 kontak masuk sebagai 180 tanpa ada yang tahu 20 mana yang hilang.
 */

export type ImportIssueCode =
  | "TANPA_NAMA"
  | "TANPA_EMAIL"
  /** Alamat yang sama dipakai dua baris, atau sudah dipakai prospek lain. */
  | "EMAIL_GANDA"
  /**
   * Kontak TANPA email dengan nama dan perusahaan yang sama persis dengan
   * baris lain, atau dengan prospek yang sudah ada. Tanpa email tidak ada
   * kunci unik di database, jadi tanpa pemeriksaan ini berkas yang diunggah
   * ulang menghasilkan salinan berlipat — dan berkas kontak memang sering
   * diunggah ulang setelah diperbaiki.
   */
  | "KONTAK_GANDA"
  | "EMAIL_TIDAK_SAH";

export interface ImportIssue {
  sheet: string;
  row: number;
  code: ImportIssueCode;
  detail: string;
}

export interface ImportedContact {
  sheet: string;
  segment: ProspectSegment;
  row: number;
  fullName: string;
  email: string | null;
  companyName: string;
  jobTitle: string;
  whatsapp: string;
  location: string;
  industry: string;
}

/** Nama kolom yang diterima, dalam dua bahasa dan beberapa ejaan lazim. */
type KolomKontak = keyof Omit<ImportedContact, "row" | "sheet" | "segment">;

const alias: Record<KolomKontak, string[]> = {
  fullName: ["nama", "nama lengkap", "nama kontak", "kontak", "pic", "name", "full name", "contact"],
  email: ["email", "e-mail", "alamat email", "email address", "surel"],
  companyName: ["perusahaan", "nama perusahaan", "instansi", "company", "company name", "organisasi"],
  jobTitle: ["jabatan", "posisi", "job title", "title", "position"],
  whatsapp: ["telepon", "telpon", "no telepon", "hp", "no hp", "whatsapp", "wa", "phone", "mobile"],
  location: ["kota", "lokasi", "alamat", "city", "location", "address"],
  industry: ["industri", "bidang", "sektor", "industry", "sector"],
};

/**
 * Judul dinormalkan sampai ke huruf dan angka saja: berkas sumber menulis
 * "No.Telepon" tanpa spasi dan "Nama " dengan spasi di belakang. Mencocokkan
 * apa adanya berarti kolomnya diam-diam tidak terbaca — dan nomor telepon yang
 * hilang tanpa pesan galat baru ketahuan saat ada yang perlu ditelepon.
 */
function normalkanJudul(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teks(value: unknown) {
  if (value === null || value === undefined) return "";
  // ExcelJS memulangkan objek untuk sel hyperlink dan rich text.
  if (typeof value === "object") {
    const obj = value as { text?: unknown; hyperlink?: unknown; result?: unknown };
    if (typeof obj.text === "string") return obj.text.trim();
    if (typeof obj.result === "string") return obj.result.trim();
    if (typeof obj.hyperlink === "string") {
      return obj.hyperlink.replace(/^mailto:/i, "").trim();
    }
    return "";
  }
  return String(value).trim();
}

/**
 * Excel menyimpan "08123456789" sebagai ANGKA dan nol di depannya hilang.
 * Yang hilang itu dikembalikan.
 *
 * Berlaku untuk nomor tetap juga, bukan cuma HP: berkas kontak ini memuat
 * "3619346511" yang seharusnya "03619346511" (kode area Bali 0361). Aturan
 * sebelumnya hanya mengenali awalan 8 dan diam-diam melewatkan seluruh nomor
 * kantor.
 *
 * Yang sudah berbentuk teks dengan nol di depan, atau memakai +62, tidak
 * disentuh — di sana tidak ada yang hilang.
 */
export function perbaikiNomor(mentah: unknown) {
  const nilai = teks(mentah).replace(/\s+/g, "");
  if (!nilai) return "";
  const angkaMurni = typeof mentah === "number" || /^\d+$/.test(nilai);
  if (angkaMurni && !nilai.startsWith("0") && /^\d{9,13}$/.test(nilai)) {
    return `0${nilai}`;
  }
  return nilai;
}

const polaEmail = /[^\s,;<>()]+@[^\s,;<>()]+\.[a-z]{2,}/gi;

export function bacaWorkbookProspek(buffer: ArrayBuffer) {
  const kontak: ImportedContact[] = [];
  const masalah: ImportIssue[] = [];
  return (async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // SEMUA lembar, bukan hanya yang pertama. Workbook kontak yang sebenarnya
    // memisahkan segmen pasar per lembar; membaca satu saja berarti 18 dari 37
    // kontak hilang tanpa satu pun pesan galat.
    const lembar = workbook.worksheets.filter((ws) => ws.rowCount > 1);
    if (!lembar.length) return { kontak, masalah, sheets: [] as string[] };

    for (const sheet of lembar) {
      const segment = segmenDariNamaLembar(sheet.name);
      const judul = sheet.getRow(1).values as unknown[];
      const kolom = new Map<KolomKontak, number>();
      judul.forEach((nilai, index) => {
        const nama = normalkanJudul(nilai);
        if (!nama) return;
        for (const [field, daftar] of Object.entries(alias)) {
          const kunci = field as KolomKontak;
          if (kolom.has(kunci)) continue;
          if (daftar.some((a) => normalkanJudul(a) === nama)) kolom.set(kunci, index);
        }
      });

      const ambil = (
        nilai: unknown[],
        field: KolomKontak,
      ) => {
        const index = kolom.get(field);
        return index === undefined ? "" : teks(nilai[index]);
      };

      sheet.eachRow((row, index) => {
        if (index === 1) return;
        const nilai = row.values as unknown[];
        const namaKolom = ambil(nilai, "fullName");
        const perusahaanKolom = ambil(nilai, "companyName");
        if (!namaKolom && !perusahaanKolom) return;

        if (!namaKolom && perusahaanKolom) {
          masalah.push({
            sheet: sheet.name,
            row: index,
            code: "TANPA_NAMA",
            detail: `${sheet.name} baris ${index}: tidak ada nama kontak, hanya "${perusahaanKolom}".`,
          });
          return;
        }

        const selEmail = ambil(nilai, "email");
        const cocok = selEmail.match(polaEmail) ?? [];
        let email: string | null = null;
        if (cocok.length > 1) {
          masalah.push({
            sheet: sheet.name,
            row: index,
            code: "EMAIL_GANDA",
            detail: `${sheet.name} baris ${index}: memuat ${cocok.length} alamat (${cocok.join(", ")}). Kontak disimpan TANPA email — pilih salah satu lalu isi manual.`,
          });
        } else if (cocok.length === 1) {
          email = cocok[0].toLowerCase();
        } else if (selEmail) {
          masalah.push({
            sheet: sheet.name,
            row: index,
            code: "EMAIL_TIDAK_SAH",
            detail: `${sheet.name} baris ${index}: "${selEmail}" bukan alamat email. Kontak disimpan tanpa email.`,
          });
        } else {
          masalah.push({
            sheet: sheet.name,
            row: index,
            code: "TANPA_EMAIL",
            detail: `${sheet.name} baris ${index}: tidak ada email, kontak tidak bisa dikirimi penawaran.`,
          });
        }

        const indexTelepon = kolom.get("whatsapp");

        kontak.push({
          sheet: sheet.name,
          segment,
          row: index,
          fullName: namaKolom,
          email,
          // Berkas kontak B2B menaruh NAMA PERUSAHAAN di kolom "Nama" dan tidak
          // punya kolom perusahaan tersendiri. Tanpa penyalinan ini,
          // {{perusahaan}} di surat penawaran akan kosong pada seluruh 37
          // kontak — dan itu baru terlihat setelah suratnya terkirim.
          companyName: perusahaanKolom || namaKolom,
          jobTitle: ambil(nilai, "jobTitle"),
          whatsapp:
            indexTelepon === undefined ? "" : perbaikiNomor(nilai[indexTelepon]),
          location: ambil(nilai, "location"),
          industry: ambil(nilai, "industry"),
        });
      });
    }

    return { kontak, masalah, sheets: lembar.map((ws) => ws.name) };
  })();
}
