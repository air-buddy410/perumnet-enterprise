import assert from "node:assert/strict";
import { test } from "node:test";
import {
  geminiGroundingSources,
  geminiOutputText,
  toGeminiSchema,
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

test("geminiGroundingSources extracts grounding chunks with dedupe and fallback title", () => {
  const payload = {
    candidates: [{
      groundingMetadata: {
        webSearchQueries: ["harga access point"],
        groundingChunks: [
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "tokopedia.com" } },
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "tokopedia.com terbaru" } },
          { web: { uri: "https://toko.example.co.id/produk" } },
          { web: { uri: "ftp://example.com/file", title: "Bukan http" } },
          { retrievedContext: { uri: "https://ignored.example.com", title: "Bukan web chunk" } },
        ],
      },
    }],
  };
  assert.deepEqual(geminiGroundingSources(payload), [
    {
      url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
      title: "tokopedia.com terbaru",
    },
    { url: "https://toko.example.co.id/produk", title: "toko.example.co.id" },
  ]);
});

test("geminiGroundingSources caps at 30 sources and tolerates missing metadata", () => {
  assert.deepEqual(geminiGroundingSources({}), []);
  assert.deepEqual(geminiGroundingSources({ candidates: [{}] }), []);
  const many = geminiGroundingSources({
    candidates: [{
      groundingMetadata: {
        groundingChunks: Array.from({ length: 35 }, (_, index) => ({
          web: { uri: `https://example.com/item-${index}`, title: `Sumber ${index}` },
        })),
      },
    }],
  });
  assert.equal(many.length, 30);
  assert.equal(many[0].url, "https://example.com/item-0");
  assert.equal(many[29].url, "https://example.com/item-29");
});
