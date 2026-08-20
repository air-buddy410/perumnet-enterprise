import "server-only";

import { ApiError } from "./api/errors";
import { renderBusinessPdf } from "./api/pdf";
import { prepareGeneratedAttachment, type PreparedAttachment } from "./attachments";
import type { DatabaseClient } from "./db/client";
import {
  muatIdentitas,
  renderIsiSurat,
  renderSubjek,
  susunSurat,
  type Penandatangan,
} from "./letter";
import {
  documentEmailPlaceholderPattern,
  type DocumentEmailKind,
} from "../shared/document-email";
import type { LetterBodyFormat } from "../shared/email-delivery";

/**
 * Surat pengantar dokumen resmi, dan lampiran PDF-nya.
 *
 * Kop, tanda tangan, dan penanda ringan memakai perender yang sama dengan surat
 * prospek (`server/letter.ts`) — dua salinan berarti satu di antaranya akan
 * tertinggal. Yang berbeda cuma catatan kakinya: surat prospek menutup dengan
 * cara berhenti dihubungi, karena penerimanya tidak pernah meminta disurati.
 * Vendor yang sedang mengerjakan SPK sudah punya hubungan dengan kita;
 * menyuruhnya membalas "BERHENTI" terbaca seperti kita tidak tahu sedang
 * berbicara dengan siapa.
 */

export interface SumberSuratDokumen {
  subject: string;
  body: string;
  format: LetterBodyFormat;
  language: "id" | "en";
  penandatangan: Penandatangan;
}

/**
 * Merender PDF dokumen untuk dilampirkan.
 *
 * SENGAJA TIDAK punya parameter edisi. SPK punya edisi internal yang memuat
 * kolom Budget — harga modal PerumNet per item — dan `pdf.ts` sendiri sudah
 * memperingatkan bahwa "edisi yang harus diingat pemanggil adalah edisi yang
 * bocor pertama kali ada yang lupa". Argumen yang tidak ada tidak bisa
 * diteruskan keliru.
 *
 * Nama berkasnya tetap diperiksa sesudahnya. Itu bukan paranoia berlebihan:
 * `edition` punya nilai bawaan, dan nilai bawaan adalah hal yang berubah
 * diam-diam saat seseorang menambah parameter di tengah daftar.
 */
export async function renderDokumenLampiran(
  kind: DocumentEmailKind,
  id: string,
  language: "id" | "en",
): Promise<PreparedAttachment> {
  const jawaban = await renderBusinessPdf(kind, id, language);
  const disposisi = jawaban.headers.get("Content-Disposition") ?? "";
  const cocok = disposisi.match(/filename="?([^";]+)"?/i);
  const namaBerkas = cocok ? cocok[1] : `${kind}-${id}.pdf`;

  if (/-INTERNAL\.pdf$/i.test(namaBerkas)) {
    throw new ApiError(
      500,
      "DOCUMENT_EDITION_LEAK",
      "Salinan internal tidak boleh dikirim keluar. Pengiriman dibatalkan.",
      { filename: namaBerkas },
    );
  }

  const isi = await jawaban.arrayBuffer();
  if (!isi.byteLength) {
    throw new ApiError(
      500,
      "DOCUMENT_RENDER_EMPTY",
      "Dokumen gagal dirender: berkasnya kosong.",
    );
  }
  return prepareGeneratedAttachment(namaBerkas, "application/pdf", isi);
}

/**
 * Satu surat utuh: subjek + HTML lengkap dengan kop dan tanda tangan.
 *
 * Pratinjau dan pengiriman sama-sama lewat sini. Kalau keduanya dirender
 * terpisah, perbedaannya baru ketahuan setelah surat sampai ke vendor — dan
 * saat itu tidak ada lagi yang bisa ditarik kembali.
 */
export async function susunUntukDokumen(
  client: DatabaseClient,
  nilai: Record<string, string>,
  sumber: SumberSuratDokumen,
) {
  const identitas = await muatIdentitas(client, sumber.language);
  return {
    subject: renderSubjek(sumber.subject, nilai),
    html: susunSurat({
      isiHtml: renderIsiSurat(sumber.body, sumber.format, nilai),
      identitas,
      language: sumber.language,
      penandatangan: sumber.penandatangan,
      // Tanpa catatan opt-out. Lihat alasannya di kepala berkas ini.
      catatanKaki: null,
    }),
  };
}

/**
 * Placeholder yang tidak dikenal dibiarkan UTUH, sama seperti surat prospek.
 *
 * Salah ketik `{{jatuh_tempoo}}` yang diam-diam jadi string kosong akan
 * terkirim ke vendor tanpa ada yang menyadarinya; yang tertinggal utuh terlihat
 * pada pratinjau pertama.
 */
export function placeholderTidakDikenal(
  sumber: string,
  dikenal: readonly string[],
) {
  const asing = new Set<string>();
  for (const cocok of sumber.matchAll(documentEmailPlaceholderPattern)) {
    if (!dikenal.includes(cocok[1])) asing.add(cocok[1]);
  }
  return [...asing];
}
