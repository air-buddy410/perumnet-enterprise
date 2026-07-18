import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the PerumNet Enterprise login experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>PerumNet Enterprise — Project Operations<\/title>/i);
  assert.match(html, /PERUMNET ENTERPRISE/i);
  assert.match(html, /Kelola proyek IT/i);
  assert.match(html, /Selamat datang kembali/i);
  assert.match(html, /admin@perumnet\.id/i);
  assert.match(html, /Masuk ke Dashboard/i);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("includes responsive and accessible application metadata", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /lang="id"/i);
  assert.match(html, /name="viewport"/i);
  assert.match(html, /theme-color/i);
  assert.match(html, /favicon\.png/i);
  assert.match(html, /PerumNet Enterprise — Project Operations/i);
});
