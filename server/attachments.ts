import "server-only";

import { createHash } from "node:crypto";
import { ApiError } from "./api/errors";
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_TOTAL_MAX_BYTES,
  formatByteLimit,
  isAllowedAttachmentMimeType,
} from "../shared/document-email";

/**
 * Pemeriksaan lampiran, satu tempat untuk semua yang mengirimnya.
 *
 * Nama berkas dan tipe MIME yang diakui peramban sama-sama ditentukan
 * pengirim, jadi keduanya tidak membuktikan apa pun. Yang diperiksa isinya.
 */

export interface PreparedAttachment {
  filename: string;
  mimeType: string;
  content: ArrayBuffer;
  byteSize: number;
  sha256: string;
  /** Dokumen yang dirender aplikasi, bukan yang diunggah orang. */
  generated: boolean;
}

/**
 * Beberapa byte pertama tiap format. Disalin dari pemeriksaan lampiran belanja
 * proyek (`server/api/project-expense-router.ts`) dan dijadikan milik bersama —
 * dua salinan aturan keamanan berarti satu di antaranya akan tertinggal.
 */
export function assertMagicBytes(buffer: Buffer, mimeType: string) {
  const valid =
    (mimeType === "application/pdf" && buffer.subarray(0, 4).toString() === "%PDF") ||
    (mimeType === "image/png" &&
      buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") ||
    (mimeType === "image/jpeg" && buffer.subarray(0, 3).toString("hex") === "ffd8ff") ||
    (mimeType === "image/webp" &&
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP");
  if (!valid) {
    throw new ApiError(
      415,
      "INVALID_FILE_CONTENT",
      "Isi berkas tidak sesuai dengan jenisnya.",
    );
  }
}

/**
 * Membuang jalur direktori dan karakter yang berbahaya di header email.
 *
 * CR dan LF di dalam nama berkas mendarat di header MIME, dan baris baru di
 * sana berarti header tambahan yang ditulis orang lain.
 */
export function safeAttachmentFilename(raw: string, fallback: string) {
  const dasar = raw.split(/[\\/]/).pop() ?? "";
  const bersih = dasar
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // Kutip ganda memutus header Content-Disposition di MIME.
    .replace(/"/g, "")
    .trim()
    .slice(0, 180);
  return bersih || fallback;
}

/**
 * Memeriksa satu berkas unggahan dan menyiapkannya untuk dilampirkan.
 * Melempar `ApiError` dengan kode yang sudah dijanjikan ke layar (T-16).
 */
export function prepareUploadedAttachment(
  filename: string,
  mimeType: string,
  content: ArrayBuffer,
): PreparedAttachment {
  const nama = safeAttachmentFilename(filename, "lampiran");
  if (!isAllowedAttachmentMimeType(mimeType)) {
    throw new ApiError(
      415,
      "INVALID_FILE_CONTENT",
      `Jenis berkas ${mimeType || "tidak dikenal"} tidak bisa dilampirkan. Yang boleh: ${ATTACHMENT_ALLOWED_MIME_TYPES.join(", ")}.`,
      { filename: nama },
    );
  }
  if (content.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new ApiError(
      413,
      "ATTACHMENT_TOO_LARGE",
      `${nama} melebihi ${formatByteLimit(ATTACHMENT_MAX_BYTES)} per berkas.`,
      { filename: nama, byteSize: content.byteLength, limit: ATTACHMENT_MAX_BYTES },
    );
  }
  const buffer = Buffer.from(content);
  assertMagicBytes(buffer, mimeType);
  return {
    filename: nama,
    mimeType,
    content,
    byteSize: content.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    generated: false,
  };
}

/**
 * Dokumen yang dirender aplikasi sendiri. Tidak diperiksa jenisnya — kita yang
 * membuatnya, dan memeriksanya hanya akan menyembunyikan bug renderer di balik
 * pesan galat yang menyalahkan pengguna.
 */
export function prepareGeneratedAttachment(
  filename: string,
  mimeType: string,
  content: ArrayBuffer,
): PreparedAttachment {
  const buffer = Buffer.from(content);
  return {
    filename: safeAttachmentFilename(filename, "dokumen.pdf"),
    mimeType,
    content,
    byteSize: content.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    generated: true,
  };
}

/**
 * Batas yang berlaku untuk SATU email.
 *
 * Jumlahnya hanya menghitung lampiran tambahan: dokumen yang dirender aplikasi
 * bukan sesuatu yang dipilih orang, jadi menghitungnya akan memakan jatah tanpa
 * alasan. Totalnya menghitung semuanya, karena yang dibatasi di sana adalah
 * memori pekerja email — dan ia tidak peduli berkasnya dari mana.
 */
export function assertAttachmentBudget(attachments: PreparedAttachment[]) {
  const tambahan = attachments.filter((a) => !a.generated);
  if (tambahan.length > ATTACHMENT_MAX_COUNT) {
    throw new ApiError(
      422,
      "ATTACHMENT_TOO_MANY",
      `Maksimal ${ATTACHMENT_MAX_COUNT} lampiran tambahan per email.`,
      { count: tambahan.length, limit: ATTACHMENT_MAX_COUNT },
    );
  }
  const total = attachments.reduce((jumlah, a) => jumlah + a.byteSize, 0);
  if (total > ATTACHMENT_TOTAL_MAX_BYTES) {
    throw new ApiError(
      413,
      "ATTACHMENT_TOTAL_TOO_LARGE",
      `Seluruh lampiran berjumlah ${formatByteLimit(total)}, melebihi batas ${formatByteLimit(ATTACHMENT_TOTAL_MAX_BYTES)} per email.`,
      { byteSize: total, limit: ATTACHMENT_TOTAL_MAX_BYTES },
    );
  }
}
