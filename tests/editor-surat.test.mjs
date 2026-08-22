// Dua bug yang dilaporkan pemilik 22 Agustus 2026 pada editor isi surat.
// Keduanya tidak terlihat oleh satu pun tes yang ada: keduanya soal DOM dan
// perilaku peramban, bukan soal jawaban server.
//
// Tanpa peramban di dalam suite ini, yang bisa dijaga adalah BENTUK SUMBERNYA.
// Itu cukup, karena kedua bug ini masing-masing lahir dari satu pola yang
// terlihat jelas di teks: sebuah `<label>` yang membungkus editor, dan sebuah
// `focus()` tanpa `preventScroll`. Yang tidak bisa dijaga di sini — bahwa
// caret benar-benar mendarat — memang menuntut peramban.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// .pathname mengembalikan %20 untuk spasi di nama direktori ini.
const baca = (relatif) =>
  readFileSync(fileURLToPath(new URL(`../${relatif}`, import.meta.url)), "utf8");

const editor = baca("app/panel/rich-text-editor.tsx");
const prospek = baca("app/panel/prospects-editor.tsx");
const dokumen = baca("app/components/document-template-manager.tsx");

// `<label>` tanpa `for` meneruskan klik ke elemen labelable pertama di
// dalamnya. Toolbar editor berisi <button> dan <select>, jadi klik di
// permukaan tulis mendarat di tombol toolbar dan kotaknya tidak bisa diketik
// sama sekali — meski terlihat normal dan tidak terkunci.
test("editor surat tidak pernah dibungkus <label>", () => {
  const pemakaian = prospek.match(/<Field[^>]*>\s*<RichTextEditor/g) ?? [];
  assert.equal(pemakaian.length, 1, "jumlah Field yang membungkus editor berubah — periksa ulang");
  assert.match(
    pemakaian[0],
    /as="div"/,
    'Field yang membungkus RichTextEditor harus as="div"; sebagai <label> kotaknya tidak bisa diketik',
  );

  // Field bawaannya tetap <label> — tiga puluh kolom lain memang menginginkan
  // itu, dan mengubah bawaannya akan mematikan klik-ke-fokus di semuanya.
  assert.match(prospek, /as = "label"/, "bawaan Field harus tetap label");

  // Pintu kedua ke editor yang sama. Ia memakai <div> sejak awal; kalau suatu
  // hari ia berubah jadi <label>, bug yang sama muncul di sana.
  assert.doesNotMatch(
    dokumen,
    /<label[^>]*>[\s\S]{0,400}?<RichTextEditor/,
    "editor di pengelola template dokumen ikut terbungkus <label>",
  );
});

// focus() menggulir elemennya ke dalam pandangan. Satu ketukan tombol di
// editor ini bisa melewati tiga pemanggilan berturut-turut, dan tampilannya
// melompat naik di tengah orang mengetik.
test("setiap focus() di editor memakai preventScroll", () => {
  const panggilan = editor.match(/\.focus\([^)]*\)/g) ?? [];
  assert.ok(panggilan.length >= 4, `hanya menemukan ${panggilan.length} focus() — pola berubah`);
  for (const panggil of panggilan) {
    assert.match(
      panggil,
      /FOCUS_TANPA_GULIR|preventScroll/,
      `${panggil} menggulir tampilan; pakai focus(FOCUS_TANPA_GULIR)`,
    );
  }
  assert.match(editor, /preventScroll: true/, "konstantanya hilang");
});

// Kotak ini duduk di tengah form. Tab adalah cara orang pindah kolom; kalau ia
// disandera untuk indentasi, tidak ada jalan keluar lewat papan ketik.
test("Tab tidak disandera editor", () => {
  assert.doesNotMatch(
    editor,
    /event\.key === "Tab"/,
    "Tab dicegat lagi — pengguna papan ketik terjebak di dalam kotak isi surat",
  );
  assert.match(editor, /event\.key === "\]"/, "indentasi harus tetap tersedia lewat Ctrl/Cmd + ]");
});

// Permukaan tulis sempat mengumumkan dirinya sebagai "Toolbar" kepada pembaca
// layar, karena memakai label milik toolbar di atasnya.
test("permukaan tulis tidak memakai label toolbar", () => {
  assert.doesNotMatch(
    editor,
    /aria-label=\{labels\.toolbar\}\s*\n\s*data-placeholder/,
    "permukaan tulis memakai label toolbar",
  );
  assert.match(editor, /surface: "Isi surat"/);
  assert.match(editor, /surface: "Letter body"/);
});
