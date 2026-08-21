import "server-only";

import sharp from "sharp";
import type { AuthUser } from "../auth";
import {
  ALUR_APLIKASI_VERSI,
  LEBAR_BAGAN,
  susunSvg,
  type Language,
} from "../../shared/alur-aplikasi";
import { ApiError } from "./errors";

/**
 * Bagan alur pemakaian aplikasi sebagai PNG.
 *
 * Data bagannya di shared/alur-aplikasi.ts dan tata letaknya di
 * bagian bawah berkas yang sama (murni, deterministik). Berkas ini hanya merasterisasi,
 * meng-cache per bahasa selama proses hidup, dan melayani PNG — SVG-nya TIDAK
 * pernah keluar ke peramban (kebijakan repo: SVG bisa membawa <script>).
 *
 * Font: DejaVu Sans tersedia di server produksi (fontconfig); di mesin lain
 * librsvg jatuh ke sans-serif apa pun yang ada. Hanya metrik teks yang
 * berubah, bukan tata letaknya, karena lebar kotak tetap.
 */

export interface GambarAlur {
  png: Buffer;
  width: number;
  height: number;
}

const cache = new Map<string, Promise<GambarAlur>>();

/** PNG per bahasa, di-cache selama proses hidup (datanya statis per deploy). */
export function renderAlurPng(language: Language): Promise<GambarAlur> {
  const kunci = `${language}:${ALUR_APLIKASI_VERSI}`;
  const ada = cache.get(kunci);
  if (ada) return ada;
  const janji = (async () => {
    const svg = susunSvg(language);
    // density 144 = dua kali resolusi nominal SVG: tajam di layar retina dan
    // di PDF, tanpa membengkak (latar putih & bidang datar terkompresi baik).
    const png = await sharp(Buffer.from(svg), { density: 144 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const meta = await sharp(png).metadata();
    return { png, width: meta.width ?? LEBAR_BAGAN * 2, height: meta.height ?? 0 };
  })();
  cache.set(kunci, janji);
  janji.catch(() => cache.delete(kunci));
  return janji;
}

export async function handleAlurPng(request: Request, user: AuthUser) {
  if (request.method !== "GET") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  const diminta = new URL(request.url).searchParams.get("language");
  const language: Language =
    diminta === "id" || diminta === "en" ? diminta : user.preferredLanguage;
  const gambar = await renderAlurPng(language);
  return new Response(new Uint8Array(gambar.png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(gambar.png.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Alur-Versi": ALUR_APLIKASI_VERSI,
    },
  });
}
