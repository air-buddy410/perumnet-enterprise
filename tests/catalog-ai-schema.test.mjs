import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRetryable,
  parseRecommendation,
  recommendationJsonSchema,
} from "../server/api/catalog-ai-schema.ts";

const validRecommendation = {
  brand: "Ruijie",
  productCategory: "Networking",
  boqRole: "Perangkat",
  nameId: "Access Point WiFi 6 Indoor",
  nameEn: "Indoor WiFi 6 Access Point",
  model: "RG-RAP2260",
  sku: "RG-RAP2260-AI",
  unit: "unit",
  specifications: ["WiFi 6 dual-band", "PoE 802.3at"],
  marketPrice: { min: 1_500_000, max: 1_900_000, currency: "IDR" },
  recommendedCostPrice: 1_600_000,
  margin1Percent: 20,
  margin2Percent: 30,
  confidence: 85,
  assumptions: ["Harga berdasarkan marketplace resmi"],
  warnings: ["Verifikasi garansi distributor"],
};

test("recommendationJsonSchema keeps the strict contract", () => {
  assert.equal(recommendationJsonSchema.type, "object");
  assert.equal(recommendationJsonSchema.additionalProperties, false);
  assert.deepEqual(
    [...recommendationJsonSchema.required].sort(),
    Object.keys(recommendationJsonSchema.properties).sort(),
  );
});

test("parseRecommendation accepts a valid payload", () => {
  const parsed = parseRecommendation(JSON.stringify(validRecommendation));
  assert.deepEqual(parsed, validRecommendation);
});

test("parseRecommendation rejects text that is not JSON", () => {
  assert.throws(
    () => parseRecommendation("bukan json"),
    /^Error: AI mengembalikan JSON yang tidak valid\.$/,
  );
});

test("parseRecommendation rejects a missing required field with a descriptive message", () => {
  const withoutSku = { ...validRecommendation };
  delete withoutSku.sku;
  assert.throws(
    () => parseRecommendation(JSON.stringify(withoutSku)),
    (error) => {
      assert.match(error.message, /Struktur rekomendasi AI tidak valid/);
      assert.match(error.message, /sku/);
      return true;
    },
  );
});

test("parseRecommendation rejects an invalid boqRole enum value", () => {
  assert.throws(
    () => parseRecommendation(JSON.stringify({ ...validRecommendation, boqRole: "Hardware" })),
    (error) => {
      assert.match(error.message, /Struktur rekomendasi AI tidak valid/);
      assert.match(error.message, /boqRole/);
      return true;
    },
  );
});

test("parseRecommendation rejects a negative cost price", () => {
  assert.throws(
    () => parseRecommendation(JSON.stringify({ ...validRecommendation, recommendedCostPrice: -1 })),
    (error) => {
      assert.match(error.message, /Struktur rekomendasi AI tidak valid/);
      assert.match(error.message, /recommendedCostPrice/);
      return true;
    },
  );
});

test("parseRecommendation rejects marketPrice.min above marketPrice.max", () => {
  assert.throws(
    () => parseRecommendation(JSON.stringify({
      ...validRecommendation,
      marketPrice: { min: 2_000_000, max: 1_000_000, currency: "IDR" },
    })),
    (error) => {
      assert.match(error.message, /Struktur rekomendasi AI tidak valid/);
      assert.match(error.message, /marketPrice/);
      return true;
    },
  );
});

test("isRetryable retries only on 429 and 5xx", () => {
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(400), false);
  assert.equal(isRetryable(404), false);
  assert.equal(isRetryable(422), false);
  assert.equal(isRetryable(200), false);
});
