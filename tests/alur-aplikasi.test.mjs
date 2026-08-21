// Bagan alur aplikasi (shared/alur-aplikasi.ts) — pemeriksaan statis, tanpa
// server.
//
// Yang dijaga: setiap langkah punya kedua bahasa, setiap `layar` benar-benar
// ada sebagai view di /admin (dibaca dari sumber enterprise-app.tsx seperti
// countGuideChapters membaca daftar bab), setiap cabang "kembali ke" menunjuk
// langkah yang ada, dan SVG-nya memuat seluruh label — karena itulah yang
// akhirnya dirasterisasi ke PNG yang dilihat pengguna.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const { aluraplikasi, semuaLangkah, susunSvg } = await import("../shared/alur-aplikasi.ts");

const enterpriseApp = readFileSync(
  fileURLToPath(new URL("../app/components/enterprise-app.tsx", import.meta.url)),
  "utf8",
);
const viewDiAdmin = new Set(
  [...enterpriseApp.matchAll(/currentView === "([a-z-]+)"/g)].map((m) => m[1]),
);

test("setiap langkah lengkap dua bahasa dan menunjuk layar yang ada di /admin", () => {
  const langkah = semuaLangkah();
  assert.ok(langkah.length >= 20, `bagan punya cukup langkah (${langkah.length})`);
  for (const l of langkah) {
    assert.ok(l.label[0].trim() && l.label[1].trim(), `${l.key}: label dua bahasa`);
    assert.ok(l.peran.length >= 1, `${l.key}: ada peran`);
    assert.ok(viewDiAdmin.has(l.layar), `${l.key}: layar "${l.layar}" ada di enterprise-app`);
    if (l.syarat) assert.ok(l.syarat[0].trim() && l.syarat[1].trim(), `${l.key}: syarat dua bahasa`);
  }
});

test("cabang keputusan menunjuk langkah yang ada, dan kuncinya unik", () => {
  const kunci = new Set();
  for (const fase of aluraplikasi) {
    for (const simpul of fase.simpul) {
      assert.equal(kunci.has(simpul.key), false, `kunci ganda: ${simpul.key}`);
      kunci.add(simpul.key);
    }
  }
  for (const fase of aluraplikasi) {
    for (const simpul of fase.simpul) {
      if (simpul.jenis === "keputusan" && simpul.kembaliKe) {
        assert.ok(kunci.has(simpul.kembaliKe), `${simpul.key} kembali ke ${simpul.kembaliKe} yang ada`);
      }
    }
  }
});

test("SVG memuat setiap label langkah dan pertanyaan keputusan, di kedua bahasa, dan deterministik", () => {
  for (const [indeks, language] of ["id", "en"].entries()) {
    const svg = susunSvg(language);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal(svg, susunSvg(language), "dua kali menyusun → byte yang sama");
    for (const fase of aluraplikasi) {
      assert.ok(svg.includes(fase.judul[indeks].slice(0, 12)), `${language}: judul fase ${fase.key}`);
      for (const simpul of fase.simpul) {
        const teks = simpul.jenis === "langkah" ? simpul.label[indeks] : simpul.tanya[indeks];
        // Label panjang dipecah per kata; cukup pastikan kata pertamanya ada.
        const kataPertama = teks.split(/\s+/)[0].replace(/[&<>"]/g, "");
        assert.ok(svg.includes(kataPertama), `${language}: ${simpul.key} (${kataPertama})`);
      }
    }
    assert.doesNotMatch(svg, /<script/i, "tidak ada skrip di dalam SVG");
  }
});
