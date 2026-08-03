import {
  catalogAiInstructions,
  isRetryable,
  parseRecommendation,
  recommendationJsonSchema,
} from "./catalog-ai-schema.ts";

export type CatalogAiInput = {
  query: string;
  sourceUrl?: string;
  file?: {
    name: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
    contentBase64: string;
  };
};

export const defaultGeminiModel = "gemini-2.5-flash";

// Gemini's responseSchema accepts an OpenAPI subset. Keywords outside this list
// (additionalProperties, strict, $schema, propertyOrdering, ...) are stripped so
// the request is never rejected; zod remains the real validation gate.
const supportedSchemaKeywords = new Set([
  "type", "format", "description", "enum", "properties", "required", "items",
  "minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength",
]);

export function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!supportedSchemaKeywords.has(key)) continue;
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      result.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([name, child]) => [name, toGeminiSchema(child)]),
      );
    } else if (key === "items") {
      result.items = toGeminiSchema(value);
    } else if (Array.isArray(value)) {
      result[key] = [...value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function geminiOutputText(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] as { content?: { parts?: unknown } } | undefined;
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  let text = "";
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as { text?: unknown; thought?: unknown };
    if (record.thought === true) continue;
    if (typeof record.text === "string") text += record.text;
  }
  return text;
}

export function geminiGroundingSources(payload: Record<string, unknown>) {
  const found = new Map<string, string>();
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const metadata = (candidate as { groundingMetadata?: { groundingChunks?: unknown } }).groundingMetadata;
    const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== "object") continue;
      const web = (chunk as { web?: { uri?: unknown; title?: unknown } }).web;
      const uri = typeof web?.uri === "string" ? web.uri : undefined;
      if (!uri || !/^https?:\/\//i.test(uri)) continue;
      found.set(uri, typeof web?.title === "string" && web.title ? web.title : new URL(uri).hostname);
    }
  }
  return [...found].slice(0, 30).map(([url, title]) => ({ url, title }));
}

async function geminiRequest(endpoint: string, apiKey: string, body: Record<string, unknown>) {
  const timeoutMs = Number(process.env.CATALOG_AI_TIMEOUT_MS ?? 90_000);
  let lastError = "Gemini request failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (response.ok && payload) return payload;
      lastError = String((payload?.error as { message?: unknown } | undefined)?.message ?? `Gemini merespons ${response.status}`);
      if (!isRetryable(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

// google_search grounding and responseSchema JSON mode cannot be combined in one
// generateContent request on the 2.5 model family, so the analysis runs in two
// steps: grounded free-text research first, then schema-constrained formatting.
export async function callGemini(
  input: CatalogAiInput,
  internalBenchmarks: Array<Record<string, unknown>>,
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY belum tersedia pada secret server.");
  const model = process.env.GEMINI_CATALOG_MODEL ?? defaultGeminiModel;
  const base = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const endpoint = `${base}/v1beta/models/${model}:generateContent`;
  const generationConfig: Record<string, unknown> = { maxOutputTokens: 6_000 };
  if (/^gemini-2\.5-flash/.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const requestPayload = {
    requestedProduct: input.query,
    sourceUrl: input.sourceUrl ?? null,
    anonymousInternalBenchmarks: internalBenchmarks,
  };

  const researchParts: Array<Record<string, unknown>> = [{ text: JSON.stringify(requestPayload) }];
  if (input.file) {
    researchParts.push({
      inlineData: { mimeType: input.file.mimeType, data: input.file.contentBase64 },
    });
  }
  const research = await geminiRequest(endpoint, apiKey, {
    systemInstruction: {
      parts: [{
        text: `${catalogAiInstructions} Research the requested product now and summarize the market findings as plain text, citing concrete Indonesian price points.`,
      }],
    },
    contents: [{ role: "user", parts: researchParts }],
    tools: [{ google_search: {} }],
    generationConfig,
  });
  const researchText = geminiOutputText(research);
  if (!researchText) throw new Error("Gemini tidak mengembalikan hasil riset pasar.");
  const sources = geminiGroundingSources(research);

  const formatted = await geminiRequest(endpoint, apiKey, {
    systemInstruction: {
      parts: [{
        text: `${catalogAiInstructions} Convert the provided market research into the requested JSON structure without inventing facts beyond it.`,
      }],
    },
    contents: [{
      role: "user",
      parts: [{ text: JSON.stringify({ ...requestPayload, marketResearch: researchText }) }],
    }],
    generationConfig: {
      ...generationConfig,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(recommendationJsonSchema),
    },
  });
  const formattedText = geminiOutputText(formatted);
  if (!formattedText) throw new Error("Gemini tidak mengembalikan structured output.");
  return {
    model: String(research.modelVersion ?? formatted.modelVersion ?? model),
    recommendation: parseRecommendation(formattedText),
    sources,
  };
}
