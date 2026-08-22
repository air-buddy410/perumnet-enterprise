// Pembaca EXIF seadanya (server/exif.ts): hanya tanggal pengambilan foto.
//
// JPEG ber-EXIF dibuat sungguhan lewat sharp — pembaca dan penulisnya dari dua
// pihak berbeda (libvips menulis, kode kita membaca), jadi lulusnya tes ini
// berarti formatnya benar, bukan sekadar konsisten dengan dirinya sendiri.
// Tanpa server: modulnya murni.

import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { makassarIso, normalizeTakenAt, readExifTakenAt } from "../server/exif.ts";

async function jpegDenganExif(exif, { width = 8, height = 6 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: "#c00000" } })
    .jpeg()
    .withExif(exif)
    .toBuffer();
}

async function exifDari(jpeg) {
  const metadata = await sharp(jpeg).metadata();
  assert.ok(metadata.exif, "sharp tidak menyertakan blok EXIF");
  return metadata.exif;
}

test("DateTimeOriginal dibaca dan diartikan sebagai waktu Makassar", async () => {
  const exif = await exifDari(
    await jpegDenganExif({ IFD2: { DateTimeOriginal: "2026:05:17 09:30:00" } }),
  );
  // libvips menulis EXIF diawali "Exif\0\0" lalu header TIFF little-endian.
  assert.equal(exif.subarray(0, 4).toString("latin1"), "Exif");
  assert.equal(readExifTakenAt(exif), "2026-05-17T09:30:00+08:00");
});

test("OffsetTimeOriginal dihormati bila kamera mengisinya", async () => {
  const exif = await exifDari(
    await jpegDenganExif({
      IFD2: { DateTimeOriginal: "2026:05:17 09:30:00", OffsetTimeOriginal: "+07:00" },
    }),
  );
  assert.equal(readExifTakenAt(exif), "2026-05-17T09:30:00+07:00");
});

test("tanpa DateTimeOriginal, jatuh ke DateTime di IFD0", async () => {
  const exif = await exifDari(
    await jpegDenganExif({ IFD0: { DateTime: "2025:12:31 23:59:59" } }),
  );
  assert.equal(readExifTakenAt(exif), "2025-12-31T23:59:59+08:00");
});

test("kamera yang belum disetel (0000:00:00) bukan tanggal", async () => {
  const exif = await exifDari(
    await jpegDenganExif({ IFD2: { DateTimeOriginal: "0000:00:00 00:00:00" } }),
  );
  assert.equal(readExifTakenAt(exif), null);
});

test("30 Februari dan tahun di masa depan jauh ditolak", async () => {
  const feb = await exifDari(
    await jpegDenganExif({ IFD2: { DateTimeOriginal: "2026:02:30 10:00:00" } }),
  );
  assert.equal(readExifTakenAt(feb), null);
  const jauh = await exifDari(
    await jpegDenganExif({ IFD2: { DateTimeOriginal: "2099:01:01 10:00:00" } }),
  );
  assert.equal(readExifTakenAt(jauh), null);
});

test("JPEG tanpa EXIF, buffer sampah, dan buffer terpotong semuanya null", async () => {
  const polos = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } })
    .jpeg()
    .toBuffer();
  const metadata = await sharp(polos).metadata();
  assert.equal(readExifTakenAt(metadata.exif ?? null), null);
  assert.equal(readExifTakenAt(Buffer.from("bukan exif sama sekali, cuma teks")), null);
  assert.equal(readExifTakenAt(null), null);
  // Header sah, tapi offset IFD0 menunjuk jauh di luar buffer.
  const terpotong = Buffer.concat([
    Buffer.from("Exif\0\0II", "latin1"),
    Buffer.from([0x2a, 0x00, 0xff, 0xff, 0xff, 0x7f]),
  ]);
  assert.equal(readExifTakenAt(terpotong), null);
});

test("big-endian (MM) dibaca sama seperti little-endian", async () => {
  // Dirakit tangan: header TIFF MM, IFD0 satu entri DateTime (tag 0x0132,
  // ASCII, 20 byte) yang nilainya di offset 26.
  const nilai = Buffer.from("2024:08:15 12:34:56\0", "latin1");
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 di offset 8
  tiff.writeUInt16BE(1, 8); // satu entri
  tiff.writeUInt16BE(0x0132, 10);
  tiff.writeUInt16BE(2, 12); // ASCII
  tiff.writeUInt32BE(nilai.length, 14);
  tiff.writeUInt32BE(26, 18); // offset nilai (relatif header TIFF)
  tiff.writeUInt32BE(0, 22); // IFD berikutnya: tidak ada
  const exif = Buffer.concat([tiff, nilai]);
  assert.equal(readExifTakenAt(exif), "2024-08-15T12:34:56+08:00");
});

test("makassarIso menulis waktu dinding Makassar dengan offset eksplisit", () => {
  // 2026-08-22T01:02:03Z = 09:02:03 WITA.
  assert.equal(makassarIso(new Date("2026-08-22T01:02:03Z")), "2026-08-22T09:02:03+08:00");
});

test("normalizeTakenAt menerima tiga bentuk dan menolak sisanya", () => {
  assert.equal(normalizeTakenAt("2026-06-01"), "2026-06-01T00:00:00+08:00");
  assert.equal(normalizeTakenAt("2026-06-01T08:00"), "2026-06-01T08:00:00+08:00");
  assert.equal(normalizeTakenAt("2026-06-01T08:00:30"), "2026-06-01T08:00:30+08:00");
  assert.equal(normalizeTakenAt("2026-06-01T00:00:00Z"), "2026-06-01T08:00:00+08:00");
  assert.equal(normalizeTakenAt("2026-06-01T10:00:00+07:00"), "2026-06-01T11:00:00+08:00");
  assert.equal(normalizeTakenAt("kemarin"), null);
  assert.equal(normalizeTakenAt("2026-13-01"), null);
  assert.equal(normalizeTakenAt("01/06/2026"), null);
});
