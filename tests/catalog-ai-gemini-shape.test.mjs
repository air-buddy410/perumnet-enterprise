import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchSourcePage,
  geminiOutputText,
  htmlToText,
  toGeminiSchema,
  validateSourceUrl,
} from "../server/api/catalog-ai-gemini.ts";
import { recommendationJsonSchema } from "../server/api/catalog-ai-schema.ts";

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, keys));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

test("toGeminiSchema strips unsupported keywords everywhere", () => {
  const converted = toGeminiSchema(recommendationJsonSchema);
  const keys = collectKeys(converted);
  assert.equal(keys.has("additionalProperties"), false);
  assert.equal(keys.has("strict"), false);
  assert.equal(keys.has("$schema"), false);
  assert.equal(keys.has("propertyOrdering"), false);
});

test("toGeminiSchema keeps types, required, enums, and bounds", () => {
  const converted = toGeminiSchema(recommendationJsonSchema);
  assert.equal(converted.type, "object");
  assert.deepEqual(converted.required, [...recommendationJsonSchema.required]);
  assert.deepEqual(converted.properties.boqRole, {
    type: "string",
    enum: ["Perangkat", "Material", "Jasa", "Mobilitas"],
  });
  assert.deepEqual(converted.properties.recommendedCostPrice, { type: "integer", minimum: 0 });
  assert.deepEqual(converted.properties.confidence, { type: "integer", minimum: 0, maximum: 100 });
  assert.deepEqual(converted.properties.specifications, {
    type: "array",
    items: { type: "string" },
    maxItems: 30,
  });
});

test("toGeminiSchema recurses into nested objects and copies arrays", () => {
  const original = {
    type: "object",
    additionalProperties: false,
    strict: true,
    $schema: "http://json-schema.org/draft-07/schema#",
    propertyOrdering: ["inner"],
    required: ["inner"],
    properties: {
      inner: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { type: "string", enum: ["a", "b"] } },
      },
    },
  };
  const converted = toGeminiSchema(original);
  assert.deepEqual(converted, {
    type: "object",
    required: ["inner"],
    properties: {
      inner: {
        type: "object",
        required: ["kind"],
        properties: { kind: { type: "string", enum: ["a", "b"] } },
      },
    },
  });
  assert.notEqual(converted.required, original.required);
});

test("toGeminiSchema passes through non-object values", () => {
  assert.equal(toGeminiSchema(null), null);
  assert.equal(toGeminiSchema("text"), "text");
  assert.deepEqual(toGeminiSchema(["a"]), ["a"]);
});

test("geminiOutputText joins text parts and skips thought parts", () => {
  const payload = {
    candidates: [{
      content: {
        role: "model",
        parts: [
          { thought: true, text: "internal reasoning" },
          { text: "Bagian pertama. " },
          { functionCall: { name: "noop" } },
          { text: "Bagian kedua." },
        ],
      },
    }],
  };
  assert.equal(geminiOutputText(payload), "Bagian pertama. Bagian kedua.");
});

test("geminiOutputText returns an empty string when nothing matches", () => {
  assert.equal(geminiOutputText({}), "");
  assert.equal(geminiOutputText({ candidates: "not-an-array" }), "");
  assert.equal(geminiOutputText({ candidates: [{ content: {} }] }), "");
  assert.equal(geminiOutputText({ candidates: [{ content: { parts: [{ thought: true, text: "x" }] } }] }), "");
});

test("validateSourceUrl accepts normal public http(s) URLs", () => {
  assert.equal(validateSourceUrl("https://www.tokopedia.com/ruijie/rg-rap2260"), null);
  assert.equal(validateSourceUrl("http://example.com/produk"), null);
  // Explicit default ports normalize away and remain acceptable.
  assert.equal(validateSourceUrl("https://example.com:443/produk"), null);
  assert.equal(validateSourceUrl("http://example.com:80/produk"), null);
  // Hosts that merely start with private-looking digits are not private ranges.
  assert.equal(validateSourceUrl("https://10bet.example.com/produk"), null);
  assert.equal(validateSourceUrl("http://172.32.0.1/produk"), null);
});

test("validateSourceUrl rejects malformed URLs and non-http protocols", () => {
  assert.ok(validateSourceUrl("bukan sebuah url"));
  assert.match(validateSourceUrl("ftp://example.com/file"), /http/i);
  assert.match(validateSourceUrl("javascript:alert(1)"), /http/i);
  assert.match(validateSourceUrl("file:///etc/passwd"), /http/i);
});

test("validateSourceUrl rejects non-default ports", () => {
  assert.ok(validateSourceUrl("https://example.com:8443/produk"));
  assert.ok(validateSourceUrl("http://example.com:3000/produk"));
});

test("validateSourceUrl rejects literal private and loopback hosts", () => {
  for (const url of [
    "http://localhost/produk",
    "https://127.0.0.1/produk",
    "https://127.1.2.3/produk",
    "http://10.0.0.8/produk",
    "http://192.168.1.10/produk",
    "http://172.16.0.1/produk",
    "http://172.31.255.1/produk",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/produk",
    "http://0.0.0.0/produk",
  ]) {
    assert.ok(validateSourceUrl(url), `expected rejection for ${url}`);
  }
});

test("CATALOG_AI_ALLOW_PRIVATE_SOURCE=1 is a test-only seam that skips the private checks", () => {
  process.env.CATALOG_AI_ALLOW_PRIVATE_SOURCE = "1";
  try {
    assert.equal(validateSourceUrl("http://127.0.0.1:8123/produk"), null);
    // Protocol validation still applies even with the seam enabled.
    assert.match(validateSourceUrl("ftp://127.0.0.1/file"), /http/i);
  } finally {
    delete process.env.CATALOG_AI_ALLOW_PRIVATE_SOURCE;
  }
  assert.ok(validateSourceUrl("http://127.0.0.1:8123/produk"));
});

test("fetchSourcePage fails closed with a reason and no network for guarded URLs", async () => {
  for (const url of ["http://192.168.0.1/admin", "ftp://example.com/file", "tidak-valid"]) {
    const result = await fetchSourcePage(url);
    assert.equal(result.text, null);
    assert.ok(result.reason, `expected a reason for ${url}`);
  }
});

test("htmlToText strips script and style blocks, tags, and collapses whitespace", () => {
  const html = `<html><head><style>body { color: red }</style>
    <script>var rahasia = "MARKER-SCRIPT";</script></head>
    <body><h1>Ruijie   RG-RAP2260</h1><!-- komentar tersembunyi -->
    <p>Harga&nbsp;Rp1.600.000 &amp; garansi resmi</p></body></html>`;
  const text = htmlToText(html);
  assert.equal(text.includes("MARKER-SCRIPT"), false);
  assert.equal(text.includes("color: red"), false);
  assert.equal(text.includes("komentar tersembunyi"), false);
  assert.match(text, /Ruijie RG-RAP2260/);
  assert.match(text, /Harga Rp1\.600\.000 & garansi resmi/);
});

test("htmlToText truncates to 20000 characters", () => {
  const text = htmlToText(`<p>${"a".repeat(30_000)}</p>`);
  assert.equal(text.length, 20_000);
});
