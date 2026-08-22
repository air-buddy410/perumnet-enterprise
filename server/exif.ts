/**
 * Pembaca EXIF seadanya: hanya tanggal pengambilan foto.
 *
 * Tidak ada paket EXIF di dependensi, dan yang dibutuhkan cuma tiga tag
 * tanggal plus satu tag zona. Menulis pembacanya ~70 baris; menarik paket
 * berarti menambah permukaan serang pada jalur yang memproses berkas kiriman
 * orang. Pembaca ini memperlakukan setiap offset sebagai tidak terpercaya:
 * apa pun yang keluar batas buffer berarti "tidak ada tanggal", bukan galat.
 *
 * EXIF tidak menyimpan zona waktu kecuali kamera mengisi OffsetTimeOriginal
 * (jarang). Foto proyek ini diambil di Bali, jadi yang tanpa zona diartikan
 * Asia/Makassar. Keluaran selalu `YYYY-MM-DDTHH:mm:ss+08:00` — waktu dinding
 * Makassar dengan offset eksplisit — supaya `substr(taken_at,1,7)` di SQL
 * adalah bulan Makassar, dan urutan leksikografis sama dengan urutan waktu.
 *
 * Sengaja tidak `server-only`: murni, tanpa permintaan, tanpa rahasia, dan
 * tesnya mengimpor langsung.
 */

const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TYPE_ASCII = 2;
/** Cukup untuk kamera mana pun; IFD dengan ribuan entri adalah berkas sampah. */
const MAX_IFD_ENTRIES = 512;
export const MAKASSAR_OFFSET = "+08:00";

interface Tiff {
  buf: Buffer;
  littleEndian: boolean;
  /** Offset awal header TIFF di dalam buffer; semua offset EXIF relatif ke sini. */
  base: number;
}

function u16(t: Tiff, offset: number) {
  if (offset < 0 || offset + 2 > t.buf.length) throw new RangeError("EXIF terpotong");
  return t.littleEndian ? t.buf.readUInt16LE(offset) : t.buf.readUInt16BE(offset);
}

function u32(t: Tiff, offset: number) {
  if (offset < 0 || offset + 4 > t.buf.length) throw new RangeError("EXIF terpotong");
  return t.littleEndian ? t.buf.readUInt32LE(offset) : t.buf.readUInt32BE(offset);
}

/** Memetakan tag yang dicari → offset entrinya (12 byte per entri). */
function walkIfd(t: Tiff, ifdOffset: number, wanted: ReadonlySet<number>) {
  const found = new Map<number, number>();
  const count = Math.min(u16(t, ifdOffset), MAX_IFD_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > t.buf.length) break;
    const tag = u16(t, entry);
    if (wanted.has(tag)) found.set(tag, entry);
  }
  return found;
}

function readAscii(t: Tiff, entry: number | undefined) {
  if (entry === undefined) return null;
  if (u16(t, entry + 2) !== TYPE_ASCII) return null;
  const count = u32(t, entry + 4);
  if (count === 0 || count > 64) return null;
  // Nilai ≤ 4 byte disimpan di tempat; selebihnya di offset relatif base.
  const valueOffset = count > 4 ? t.base + u32(t, entry + 8) : entry + 8;
  if (valueOffset < 0 || valueOffset + count > t.buf.length) return null;
  return t.buf.subarray(valueOffset, valueOffset + count).toString("latin1").replace(/\0+$/, "");
}

function validDateParts(y: number, mo: number, d: number, h: number, mi: number, s: number) {
  const thisYear = new Date().getUTCFullYear();
  return (
    y >= 1990 && y <= thisYear + 1 &&
    mo >= 1 && mo <= 12 &&
    d >= 1 && d <= 31 &&
    h <= 23 && mi <= 59 && s <= 59
  );
}

/**
 * "YYYY:MM:DD HH:MM:SS" (bentuk EXIF) → ISO dengan offset. Kamera yang belum
 * disetel menulis `0000:00:00 00:00:00`; itu bukan tanggal.
 */
function exifDateToIso(raw: string | null, offset: string | null) {
  if (!raw) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (!validDateParts(+y, +mo, +d, +h, +mi, +s)) return null;
  const zone = offset && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : MAKASSAR_OFFSET;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`;
  // Tanggal seperti 30 Februari lolos pemeriksaan komponen tapi bukan tanggal.
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const kembali = makassarIso(parsed, zone);
  return kembali.slice(0, 10) === iso.slice(0, 10) ? iso : null;
}

/**
 * Tanggal pengambilan dari blok EXIF mentah (`sharp().metadata().exif`).
 * Prioritas: DateTimeOriginal, DateTimeDigitized, lalu DateTime (tanggal
 * penyuntingan terakhir — lebih baik daripada tidak ada).
 */
export function readExifTakenAt(exif?: Buffer | Uint8Array | null): string | null {
  if (!exif || exif.length < 14) return null;
  try {
    const buf = Buffer.isBuffer(exif) ? exif : Buffer.from(exif);
    const base = buf.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
    const order = buf.subarray(base, base + 2).toString("latin1");
    if (order !== "II" && order !== "MM") return null;
    const t: Tiff = { buf, littleEndian: order === "II", base };
    if (u16(t, base + 2) !== 42) return null;
    const ifd0 = base + u32(t, base + 4);
    const tags0 = walkIfd(t, ifd0, new Set([TAG_DATETIME, TAG_EXIF_IFD]));

    let original: string | null = null;
    let digitized: string | null = null;
    let offset: string | null = null;
    const pointer = tags0.get(TAG_EXIF_IFD);
    if (pointer !== undefined) {
      const exifIfd = base + u32(t, pointer + 8);
      const tagsExif = walkIfd(
        t,
        exifIfd,
        new Set([TAG_DATETIME_ORIGINAL, TAG_DATETIME_DIGITIZED, TAG_OFFSET_TIME_ORIGINAL]),
      );
      original = readAscii(t, tagsExif.get(TAG_DATETIME_ORIGINAL));
      digitized = readAscii(t, tagsExif.get(TAG_DATETIME_DIGITIZED));
      offset = readAscii(t, tagsExif.get(TAG_OFFSET_TIME_ORIGINAL));
    }
    const dateTime = readAscii(t, tags0.get(TAG_DATETIME));
    return (
      exifDateToIso(original, offset) ??
      exifDateToIso(digitized, offset) ??
      exifDateToIso(dateTime, null)
    );
  } catch {
    return null;
  }
}

/** Instan nyata → waktu dinding Makassar dengan offset eksplisit. */
export function makassarIso(date: Date = new Date(), offset = MAKASSAR_OFFSET) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: offset === MAKASSAR_OFFSET ? "Asia/Makassar" : undefined,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(offset === MAKASSAR_OFFSET ? date : new Date(date.getTime() + offsetMinutes(offset) * 60_000));
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}${offset}`;
}

function offsetMinutes(offset: string) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return 8 * 60;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Masukan pengguna untuk tanggal foto (PATCH): `YYYY-MM-DD`,
 * `YYYY-MM-DDTHH:mm[:ss]` (diartikan Makassar), atau ISO beroffset/Z
 * (dikonversi ke waktu dinding Makassar). Selain itu → null.
 */
export function normalizeTakenAt(input: string): string | null {
  const value = input.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return exifDateToIso(`${m[1]}:${m[2]}:${m[3]} 00:00:00`, null);
  m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (m) return exifDateToIso(`${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] ?? "00"}`, null);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getUTCFullYear();
    if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
    return makassarIso(parsed);
  }
  return null;
}
