import "server-only";

import type { DatabaseClient } from "./db/client";
import { applicationUrl } from "./email";
import {
  prospectPlaceholderPattern,
  type ProspectLetterFormat,
} from "../shared/prospects";

/**
 * Menyusun surat penawaran yang benar-benar dikirim ke calon klien.
 *
 * Sebelum berkas ini ada, isi template dikirim apa adanya: admin harus menulis
 * HTML sendiri, dan yang sampai ke calon klien adalah potongan HTML telanjang
 * tanpa logo, tanpa tanda tangan, tanpa cara berhenti dihubungi. Pratinjau
 * menampilkan potongan yang sama, jadi tidak ada satu pun layar yang
 * memperlihatkan surat utuh sebelum terkirim.
 *
 * Sekarang admin cukup mengetik teks biasa. Kop, tanda tangan, dan catatan kaki
 * ditempelkan DI SINI — satu fungsi yang dipakai pratinjau maupun pengiriman,
 * supaya yang dilihat admin persis yang diterima calon klien. Kalau keduanya
 * memanggil jalur berbeda, perbedaannya baru ketahuan setelah surat terkirim.
 */

const TEAL = "#0b817b";
const TEAL_TERANG = "#42beb9";
const TINTA = "#203f4d";
const ABU = "#5d737c";
const ABU_MUDA = "#809097";
const GARIS = "#e8efef";

export interface SenderIdentity {
  companyName: string;
  tagline: string;
  email: string;
  phone: string;
  address: string;
  websiteUrl: string;
}

/**
 * Dipakai kalau `cms_site_settings` belum terisi — instalasi baru, atau
 * database uji. Nilai sungguhannya diedit lewat Pengaturan di panel, dan
 * begitu diedit tanda tangan surat ikut berubah tanpa menyentuh kode.
 */
const IDENTITAS_BAWAAN: SenderIdentity = {
  companyName: "PerumNet Enterprise",
  tagline: "Konsultan IT untuk operasional yang lebih andal",
  email: "enterprise@perumnet.id",
  phone: "0851 5502 6889",
  address: "BTN Kecicang Indah Blok A5, Bungaya Kangin, Karangasem, Bali 80813",
  websiteUrl: "https://www.perumnet.id/",
};

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Identitas pengirim dibaca dari `cms_site_settings` — sumber yang sama dengan
 * footer situs publik. Satu tempat edit, bukan dua: nomor telepon yang diubah
 * di Pengaturan tidak boleh tetap lama di dalam surat penawaran.
 */
export async function muatIdentitas(
  client: DatabaseClient,
  language: "id" | "en" = "id",
): Promise<SenderIdentity> {
  const hasil = await client.execute(
    "SELECT key_name,value_content,value_content_en FROM cms_site_settings",
  );
  const peta = new Map<string, string>();
  for (const row of hasil.rows as unknown as Record<string, unknown>[]) {
    const kunci = String(row.key_name ?? "");
    if (!kunci) continue;
    const id = String(row.value_content ?? "").trim();
    const en = String(row.value_content_en ?? "").trim();
    const dipakai = language === "en" ? en || id : id;
    if (dipakai) peta.set(kunci, dipakai);
  }
  return {
    companyName: peta.get("company_name") ?? IDENTITAS_BAWAAN.companyName,
    tagline: peta.get("company_tagline") ?? IDENTITAS_BAWAAN.tagline,
    email: peta.get("email") ?? IDENTITAS_BAWAAN.email,
    phone: peta.get("phone") ?? IDENTITAS_BAWAAN.phone,
    address: peta.get("address") ?? IDENTITAS_BAWAAN.address,
    // Surat menunjuk portofolio Enterprise, bukan situs induk perumnet.id yang
    // dipakai footer situs publik. Keduanya benar di tempatnya masing-masing.
    websiteUrl: applicationUrl("/"),
  };
}

function isiPlaceholder(sumber: string, nilai: Record<string, string>) {
  return sumber.replace(prospectPlaceholderPattern, (utuh, kunci: string) =>
    kunci in nilai ? escapeHtml(nilai[kunci]) : utuh,
  );
}

/**
 * Teks biasa jadi paragraf HTML. Baris kosong memisahkan paragraf, satu baris
 * baru jadi pindah baris — aturan yang sama dengan yang orang harapkan saat
 * mengetik di kotak teks mana pun.
 */
export function teksKeParagraf(teks: string) {
  return teks
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((blok) => blok.trim())
    .filter(Boolean)
    .map(
      (blok) =>
        `<p style="margin:0 0 14px;color:${ABU};font-size:15px;line-height:1.75">${blok.replaceAll("\n", "<br />")}</p>`,
    )
    .join("");
}

/**
 * Isi surat: placeholder diisi, lalu dijadikan HTML sesuai formatnya.
 *
 * Untuk format teks, isinya di-escape LEBIH DULU baru placeholder diisi.
 * Urutan itu penting: `{{` dan `}}` selamat dari escaping, sedangkan nilai
 * yang disisipkan tetap lewat escape-nya sendiri. Dibalik, admin yang mengetik
 * `<b>` akan menghasilkan HTML sungguhan dari kotak yang dijanjikan sebagai
 * teks biasa.
 */
export function renderIsiSurat(
  sumber: string,
  format: ProspectLetterFormat,
  nilai: Record<string, string>,
) {
  if (format === "html") return isiPlaceholder(sumber, nilai);
  return teksKeParagraf(isiPlaceholder(escapeHtml(sumber), nilai));
}

/** Subjek selalu teks biasa — tidak ada HTML di baris subjek email. */
export function renderSubjek(sumber: string, nilai: Record<string, string>) {
  return sumber.replace(prospectPlaceholderPattern, (utuh, kunci: string) =>
    kunci in nilai ? nilai[kunci] : utuh,
  );
}

export interface Penandatangan {
  /** "Best Regards," atau "Hormat kami," — kalimat penutup di atas nama. */
  signoff: string;
  /** Nama orang yang menandatangani, misalnya "Suci". */
  name: string;
  /** Email orang itu. Kosong = pakai email perusahaan dari Pengaturan. */
  email: string;
  /** Nomor orang itu. Kosong = pakai nomor perusahaan dari Pengaturan. */
  phone: string;
}

export const PENANDATANGAN_KOSONG: Penandatangan = {
  signoff: "",
  name: "",
  email: "",
  phone: "",
};

function tautanEmail(nilai: string) {
  return `<a href="mailto:${escapeHtml(nilai)}" style="color:${TEAL};text-decoration:none">${escapeHtml(nilai)}</a>`;
}

function tautanSitus(nilai: string) {
  const terlihat = nilai.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `<a href="${escapeHtml(nilai)}" style="color:${TEAL};text-decoration:none">${escapeHtml(terlihat)}</a>`;
}

/**
 * Baris kontak di kaki tanda tangan.
 *
 * Kontak ORANG didahulukan, kontak perusahaan jadi cadangan. Surat penawaran
 * dibalas ke orang yang mengirimnya; menaruh alamat umum perusahaan di sana
 * memindahkan balasan ke kotak masuk yang tidak menunggunya.
 */
function barisKontak(
  identitas: SenderIdentity,
  penandatangan: Penandatangan,
  language: "id" | "en",
) {
  const telepon = penandatangan.phone || identitas.phone;
  const email = penandatangan.email || identitas.email;
  const labelTelepon = language === "en" ? "Phone" : "Telepon";
  const labelEmail = "Email";
  const labelWeb = "Web";
  const bagian = [
    telepon ? `${labelTelepon} : ${escapeHtml(telepon)}` : "",
    email ? `${labelEmail} : ${tautanEmail(email)}` : "",
    identitas.websiteUrl ? `${labelWeb} : ${tautanSitus(identitas.websiteUrl)}` : "",
  ].filter(Boolean);
  return bagian.join(" &nbsp;|&nbsp; ");
}

export interface LetterInput {
  isiHtml: string;
  identitas: SenderIdentity;
  language?: "id" | "en";
  penandatangan?: Penandatangan;
}

/**
 * Surat utuh: kop berlogo, isi, tanda tangan, catatan kaki.
 *
 * Logo dimuat dari URL publik, bukan ditempel sebagai data URI — Gmail dan
 * beberapa klien lain membuang gambar data URI diam-diam. Konsekuensinya
 * gambar baru muncul setelah penerima mengizinkan gambar, jadi `alt`-nya
 * ditulis penuh supaya nama merek tetap terbaca saat gambarnya diblokir.
 */
export function susunSurat(input: LetterInput) {
  const language = input.language ?? "id";
  const { identitas } = input;
  const penandatangan = input.penandatangan ?? PENANDATANGAN_KOSONG;
  const logo = applicationUrl("/perumnet-enterprise-logo.png");
  const salam =
    penandatangan.signoff || (language === "en" ? "Best regards," : "Hormat kami,");
  const catatanKaki =
    language === "en"
      ? `You received this message because ${escapeHtml(identitas.companyName)} recorded your business contact details. Reply with the word STOP and we will not contact you again.`
      : `Anda menerima surat ini karena kontak bisnis Anda tercatat pada ${escapeHtml(identitas.companyName)}. Balas dengan kata BERHENTI, dan kami tidak akan menghubungi Anda lagi.`;

  const namaOrang = penandatangan.name
    ? `<div style="margin:0 0 2px;color:${TINTA};font-size:15px;font-weight:700">${escapeHtml(penandatangan.name)}</div>`
    : "";

  return `<!doctype html>
<html lang="${language}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f3f8f8">
  <div style="background:#f3f8f8;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:${TINTA}">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #d9e7e7;border-radius:16px;overflow:hidden">
      <div style="height:6px;background:${TEAL_TERANG}"></div>
      <div style="padding:28px 30px 6px;text-align:center">
        <img src="${escapeHtml(logo)}" alt="${escapeHtml(identitas.companyName)}" width="132" height="139" style="display:inline-block;border:0;outline:none;text-decoration:none;max-width:132px;height:auto" />
      </div>
      <div style="padding:10px 30px 0">
        ${input.isiHtml}
      </div>
      <div style="padding:0 30px 26px">
        <div style="margin:18px 0 0">
          <div style="margin:0 0 12px;color:${ABU};font-size:15px">${escapeHtml(salam)}</div>
          ${namaOrang}
          <div style="margin:0;color:${TEAL};font-size:15px;font-weight:700;letter-spacing:0.3px">${escapeHtml(identitas.companyName)}</div>
        </div>
        <div style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${GARIS}">
          <div style="margin:0 0 3px;color:${TINTA};font-size:13px;font-weight:700">${escapeHtml(identitas.companyName)}</div>
          <div style="margin:0 0 6px;color:${ABU_MUDA};font-size:12px;line-height:1.6">${escapeHtml(identitas.address)}</div>
          <div style="color:${ABU};font-size:12px;line-height:1.8">${barisKontak(identitas, penandatangan, language)}</div>
        </div>
        <p style="margin:20px 0 0;padding-top:14px;border-top:1px solid ${GARIS};color:${ABU_MUDA};font-size:11px;line-height:1.6">${catatanKaki}</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
