import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssPath = new URL("../deploy/mailcow/themes/perumnet.css", import.meta.url);

test("PerumNet Mail keeps the primary logo centered in a square badge", async () => {
  const css = await readFile(cssPath, "utf8");

  assert.match(css, /\.overlay::before\s*\{[\s\S]*?left:\s*50%;[\s\S]*?aspect-ratio:\s*1\s*\/\s*1;/);
  assert.match(css, /\.overlay::before\s*\{[\s\S]*?transform:\s*translateX\(-50%\);/);
  assert.match(css, /\.overlay::after\s*\{[\s\S]*?text-align:\s*center;/);
  assert.match(css, /body:has\(#login_user\)::before\s*\{[\s\S]*?content:\s*"PERUMNET MAIL";/);
  assert.match(css, /body:has\(#login_user\)::after\s*\{[\s\S]*?font-weight:\s*500;/);
  assert.match(css, /\.mailcow-logo\s*\{[\s\S]*?justify-content:\s*center;[\s\S]*?text-align:\s*center\s*!important;/);
});

test("PerumNet Mail ships concise operational login copy", async () => {
  const css = await readFile(cssPath, "utf8");

  assert.match(css, /Email perusahaan untuk komunikasi kerja\./);
  assert.match(css, /Masuk untuk membuka email, kalender, dan kontak kerja PerumNet\./);
  assert.doesNotMatch(css, /rapi dan selalu terhubung/i);
});
