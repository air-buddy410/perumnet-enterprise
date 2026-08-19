import "server-only";

import ExcelJS from "exceljs";

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
  | "EMAIL_GANDA"
  | "EMAIL_TIDAK_SAH";

export interface ImportIssue {
  row: number;
  code: ImportIssueCode;
  detail: string;
}

export interface ImportedContact {
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
const alias: Record<keyof Omit<ImportedContact, "row">, string[]> = {
  fullName: ["nama", "nama lengkap", "nama kontak", "kontak", "pic", "name", "full name", "contact"],
  email: ["email", "e-mail", "alamat email", "email address", "surel"],
  companyName: ["perusahaan", "nama perusahaan", "instansi", "company", "company name", "organisasi"],
  jobTitle: ["jabatan", "posisi", "job title", "title", "position"],
  whatsapp: ["telepon", "telpon", "no telepon", "no. telepon", "hp", "no hp", "whatsapp", "wa", "phone", "mobile"],
  location: ["kota", "lokasi", "alamat", "city", "location", "address"],
  industry: ["industri", "bidang", "sektor", "industry", "sector"],
};

function normalkanJudul(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
 * Excel menyimpan "08123456789" sebagai angka dan nol di depannya hilang.
 * Nomor Indonesia yang tersisa dimulai dari 8 dan panjangnya 9–13 digit;
 * itulah yang dikembalikan nolnya. Nomor yang sudah berbentuk teks, atau yang
 * memakai +62, tidak disentuh.
 */
export function perbaikiNomor(mentah: unknown) {
  const nilai = teks(mentah);
  if (!nilai) return "";
  if (typeof mentah === "number" || /^\d+$/.test(nilai)) {
    if (/^8\d{8,12}$/.test(nilai)) return `0${nilai}`;
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
    const sheet = workbook.worksheets[0];
    if (!sheet) return { kontak, masalah, sheetName: "" };

    const judul = sheet.getRow(1).values as unknown[];
    const kolom = new Map<keyof Omit<ImportedContact, "row">, number>();
    judul.forEach((nilai, index) => {
      const nama = normalkanJudul(nilai);
      if (!nama) return;
      for (const [field, daftar] of Object.entries(alias)) {
        if (kolom.has(field as keyof Omit<ImportedContact, "row">)) continue;
        if (daftar.includes(nama)) {
          kolom.set(field as keyof Omit<ImportedContact, "row">, index);
        }
      }
    });

    const ambil = (
      nilai: unknown[],
      field: keyof Omit<ImportedContact, "row">,
    ) => {
      const index = kolom.get(field);
      return index === undefined ? "" : teks(nilai[index]);
    };

    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const nilai = row.values as unknown[];
      const fullName = ambil(nilai, "fullName");
      const companyName = ambil(nilai, "companyName");
      if (!fullName && !companyName) return; // baris kosong, bukan masalah

      if (!fullName) {
        masalah.push({
          row: index,
          code: "TANPA_NAMA",
          detail: `Baris ${index} tidak punya nama kontak; hanya "${companyName}".`,
        });
        return;
      }

      const selEmail = ambil(nilai, "email");
      const cocok = selEmail.match(polaEmail) ?? [];
      let email: string | null = null;
      if (cocok.length > 1) {
        // Dua alamat dalam satu sel hampir selalu salah tempel di berkas
        // sumber. Memilih salah satunya berarti menebak; kontaknya tetap masuk
        // supaya tidak hilang, tanpa email supaya tidak salah kirim.
        masalah.push({
          row: index,
          code: "EMAIL_GANDA",
          detail: `Baris ${index} memuat ${cocok.length} alamat: ${cocok.join(", ")}. Kontak disimpan tanpa email.`,
        });
      } else if (cocok.length === 1) {
        email = cocok[0].toLowerCase();
      } else if (selEmail) {
        masalah.push({
          row: index,
          code: "EMAIL_TIDAK_SAH",
          detail: `Baris ${index}: "${selEmail}" bukan alamat email. Kontak disimpan tanpa email.`,
        });
      } else {
        masalah.push({
          row: index,
          code: "TANPA_EMAIL",
          detail: `Baris ${index} tidak punya email; kontak tidak bisa dikirimi penawaran.`,
        });
      }

      kontak.push({
        row: index,
        fullName,
        email,
        companyName,
        jobTitle: ambil(nilai, "jobTitle"),
        whatsapp: perbaikiNomor(
          kolom.get("whatsapp") === undefined
            ? ""
            : (row.values as unknown[])[kolom.get("whatsapp")!],
        ),
        location: ambil(nilai, "location"),
        industry: ambil(nilai, "industry"),
      });
    });

    return { kontak, masalah, sheetName: sheet.name };
  })();
}
