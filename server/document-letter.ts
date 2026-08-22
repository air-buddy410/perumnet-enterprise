import "server-only";

import { ApiError } from "./api/errors";
import { renderBusinessPdf } from "./api/pdf";
import { prepareGeneratedAttachment, type PreparedAttachment } from "./attachments";
import type { DatabaseClient } from "./db/client";
import { readProjectFile } from "./storage";
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
 * Arsip final BAST, apa adanya.
 *
 * BAST yang sudah ditandatangani BUKAN dokumen hidup. Saat finalisasi,
 * PDF-nya dirender sekali, disimpan, dan sidik SHA-256-nya dicatat di
 * `basts.pdf_hash` — angka yang sama yang dipajang halaman verifikasi publik
 * dan yang ditunjuk QR di dalam PDF itu sendiri.
 *
 * Karena itu surat ini melampirkan BYTE YANG TERSIMPAN, bukan hasil render
 * baru. Render ulang menghasilkan berkas yang berbeda — QR dan tata letaknya
 * boleh sama persis, tapi PDF membawa penanda yang tidak deterministik, dan
 * sidiknya tidak akan cocok. Klien yang memeriksa lampiran terhadap halaman
 * verifikasi akan melihat dua angka berbeda, lalu menyimpulkan hal yang paling
 * masuk akal: dokumennya palsu. Surat yang seharusnya menjadi bukti justru
 * menjadi alasan untuk meragukan.
 *
 * Sidiknya dihitung ulang di sini dan dibandingkan sebelum dikirim. Kalau
 * arsipnya tidak lagi cocok dengan catatannya, yang benar adalah TIDAK
 * mengirim apa pun: halaman verifikasi sudah akan menyatakan dokumen itu tidak
 * sah, dan mengirimkannya hanya memindahkan kegagalan ke tangan klien.
 */
async function lampiranBastFinal(
  client: DatabaseClient,
  id: string,
): Promise<PreparedAttachment> {
  const hasil = await client.execute({
    sql: `SELECT number,finalized_at,revoked_at,pdf_hash,
        finalized_pdf_storage_url,finalized_pdf_content_base64
      FROM basts WHERE id=? LIMIT 1`,
    args: [id],
  });
  const bast = hasil.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!bast) throw new ApiError(404, "NOT_FOUND", "BAST tidak ditemukan.");
  if (!bast.finalized_at || bast.revoked_at) {
    throw new ApiError(
      409,
      "BAST_NOT_FINAL",
      "Hanya BAST final yang aktif yang dapat dikirim sebagai bukti serah terima.",
      { finalized: Boolean(bast.finalized_at), revoked: Boolean(bast.revoked_at) },
    );
  }

  const tersimpan = bast.finalized_pdf_storage_url
    ? await readProjectFile(String(bast.finalized_pdf_storage_url))
    : null;
  const penyangga =
    tersimpan?.content ??
    (() => {
      const buf = Buffer.from(String(bast.finalized_pdf_content_base64 ?? ""), "base64");
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    })();
  if (!penyangga.byteLength) {
    throw new ApiError(
      500,
      "BAST_ARCHIVE_MISSING",
      "Arsip PDF BAST ini tidak ditemukan. Hubungi Admin sebelum mengirimnya.",
    );
  }

  const nomor = String(bast.number ?? id).replaceAll("/", "-");
  const siap = prepareGeneratedAttachment(
    `${nomor}.pdf`,
    "application/pdf",
    penyangga as ArrayBuffer,
  );
  if (String(bast.pdf_hash ?? "") !== siap.sha256) {
    throw new ApiError(
      500,
      "BAST_ARCHIVE_MISMATCH",
      "Sidik arsip BAST tidak cocok dengan catatannya. Pengiriman dibatalkan.",
      { nomor: String(bast.number ?? "") },
    );
  }
  return siap;
}

/**
 * PDF dokumen yang akan dilampirkan.
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
 *
 * Dari mana byte-nya datang juga ditentukan DI SINI, dari `kind` — bukan lewat
 * argumen tambahan yang boleh diisi pemanggil. Tiga jenis pertama dirender
 * segar; BAST diambil dari arsipnya (lihat `lampiranBastFinal`). Kalau
 * pilihannya diserahkan ke pemanggil, cepat atau lambat ada satu jalur yang
 * lupa — dan jalur itu mengirim BAST dengan sidik yang tidak cocok.
 */
export async function lampiranDokumen(
  client: DatabaseClient,
  kind: DocumentEmailKind,
  id: string,
  language: "id" | "en",
): Promise<PreparedAttachment> {
  if (kind === "bast") return lampiranBastFinal(client, id);
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
