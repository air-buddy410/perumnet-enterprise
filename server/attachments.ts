import "server-only";

import { createHash } from "node:crypto";
import sharp, { type Metadata as SharpMetadata } from "sharp";
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
  /**
   * Berkasnya SUDAH tersimpan dan ada arsip lain yang memilikinya.
   *
   * Dipakai pengiriman dokumen: arsip pengiriman menyimpan byte-nya sekali dan
   * memilikinya selamanya, sedangkan baris outbox cukup menunjuk ke berkas yang
   * sama dan menandai dirinya bukan pemilik. Saat outbox dibersihkan, yang
   * dibuang penunjuknya saja.
   *
   * Kosong berarti baris outbox yang menyimpan dan memiliki berkasnya sendiri —
   * perilaku setiap pemanggil yang tidak punya arsip.
   */
  tersimpanDiArsip?: { storageUrl: string | null; contentBase64: string | null };
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

// ── Gambar ───────────────────────────────────────────────────────────────
//
// Foto yang diunggah orang diperiksa ISINYA oleh sharp, bukan tipe yang
// diakui peramban: tipe yang tersimpan adalah yang nanti dipakai sebagai
// Content-Type saat berkas dilayani kembali, dan membiarkan pengunggah
// menentukannya berarti membiarkan pengunggah menentukan apa yang dijalankan
// peramban orang lain. Pola ini diangkat dari `preparePortfolioImage`
// (cms-router) — dengan dua perbedaan: batas sisinya 12.000 px, karena foto
// HP masa kini 4032×3024 dan kamera DSLR lebih lebar lagi; dan gambar animasi
// ditolak, karena thumbnail dari frame pertama menyesatkan.

/** Sisi terpanjang yang diterima. */
export const IMAGE_MAX_SIDE = 12_000;
/** Batas piksel total — 40 MP terdekode ≈ 160 MB RGBA, di proses 700 MB. */
export const IMAGE_MAX_PIXELS = 40_000_000;
/** Lebar thumbnail galeri. Cukup untuk petak 3–4 kolom di layar retina. */
export const THUMBNAIL_WIDTH = 480;

const SHARP_FORMAT_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface PreparedImage extends PreparedAttachment {
  /** Dimensi seperti yang DILIHAT, sudah memperhitungkan orientasi EXIF. */
  width: number;
  height: number;
  orientation: number | null;
  /** Blok EXIF mentah bila ada — untuk tanggal pengambilan. */
  exif: Buffer | null;
}

export async function prepareUploadedImage(
  filename: string,
  declaredMime: string,
  content: ArrayBuffer,
): Promise<PreparedImage> {
  const nama = safeAttachmentFilename(filename, "foto");
  if (!Object.values(SHARP_FORMAT_MIME).includes(declaredMime)) {
    throw new ApiError(
      415,
      "UNSUPPORTED_FILE",
      "Gunakan gambar JPG, PNG, atau WebP.",
      { filename: nama },
    );
  }
  const buffer = Buffer.from(content);
  let metadata: SharpMetadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: IMAGE_MAX_PIXELS,
    }).metadata();
  } catch {
    throw new ApiError(415, "INVALID_IMAGE", "Isi berkas bukan gambar yang valid.", {
      filename: nama,
    });
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new ApiError(415, "ANIMATED_IMAGE", "Gambar animasi tidak didukung.", {
      filename: nama,
    });
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE || width * height > IMAGE_MAX_PIXELS) {
    throw new ApiError(
      422,
      "IMAGE_DIMENSIONS",
      `Dimensi gambar maksimal ${IMAGE_MAX_SIDE} piksel per sisi dan ${IMAGE_MAX_PIXELS / 1_000_000} megapiksel.`,
      { filename: nama, width, height },
    );
  }
  if (SHARP_FORMAT_MIME[metadata.format ?? ""] !== declaredMime) {
    throw new ApiError(
      415,
      "IMAGE_TYPE_MISMATCH",
      "Tipe file tidak sesuai dengan isi gambarnya.",
      { filename: nama, declared: declaredMime, actual: metadata.format ?? null },
    );
  }
  const orientation = metadata.orientation ?? null;
  const diputar = orientation !== null && orientation >= 5;
  return {
    filename: nama,
    mimeType: declaredMime,
    content,
    byteSize: content.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    generated: false,
    width: diputar ? height : width,
    height: diputar ? width : height,
    orientation,
    exif: metadata.exif ?? null,
  };
}

/**
 * Thumbnail WebP selebar THUMBNAIL_WIDTH, sudah diputar sesuai EXIF.
 * Dipanggil sekali saat unggah dan disimpan; galeri tidak pernah memuat
 * foto asli untuk petak-petaknya.
 */
export async function makeThumbnail(content: ArrayBuffer) {
  return sharp(Buffer.from(content), {
    failOn: "error",
    limitInputPixels: IMAGE_MAX_PIXELS,
  })
    .rotate()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

/** Header Content-Disposition untuk berkas yang dilayani kembali. */
export function inlineDisposition(name: string, fallback = "berkas") {
  return `inline; filename*=UTF-8''${encodeURIComponent(safeAttachmentFilename(name, fallback))}`;
}
