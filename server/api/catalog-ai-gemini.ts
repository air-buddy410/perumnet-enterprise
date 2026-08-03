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

// The catalog AI runs entirely on the Gemini free tier: no google_search tool
// (paid-only). Instead, the user-supplied product URL is fetched server-side and
// its text is handed to the model as source material.

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (["localhost", "0.0.0.0", "::1", "[::1]"].includes(host)) return true;
  return /^(127|10|169\.254|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\./.test(host);
}

// String-level URL guard: http/https on default ports, no literal private or
// loopback hosts. This is intentionally not a full SSRF defense (no DNS
// resolution checks) because the endpoint is restricted to Admin/Finance users.
// Returns a rejection reason, or null when the URL is acceptable.
export function validateSourceUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "URL sumber tidak valid.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Hanya URL http atau https yang didukung.";
  }
  // Test-only seam: lets automated tests point sourceUrl at a local mock page
  // server. Never enable in production.
  if (process.env.CATALOG_AI_ALLOW_PRIVATE_SOURCE === "1") return null;
  if (url.port !== "") return "Hanya port default http(s) yang didukung.";
  if (isPrivateHost(url.hostname)) return "Host privat atau loopback tidak diizinkan.";
  return null;
}

// Crude HTML-to-text: drop script/style/comment blocks, strip tags, decode the
// most common entities, collapse whitespace, cap the length for the prompt.
export function htmlToText(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

const maxSourcePageBytes = 300 * 1024;

// Fetches the user-supplied product page and returns its text content. Never
// throws: on any failure the analysis proceeds without page content and the
// reason explains why.
export async function fetchSourcePage(
  rawUrl: string,
): Promise<{ text: string | null; reason: string | null }> {
  const guardError = validateSourceUrl(rawUrl);
  if (guardError) return { text: null, reason: guardError };
  try {
    const response = await fetch(rawUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { text: null, reason: `Halaman sumber merespons ${response.status}.` };
    }
    let raw = "";
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let bytes = 0;
      while (bytes < maxSourcePageBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        raw += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
      raw += decoder.decode();
    }
    const text = htmlToText(raw);
    if (!text) return { text: null, reason: "Halaman sumber tidak berisi teks yang dapat dibaca." };
    return { text, reason: null };
  } catch (error) {
    return { text: null, reason: error instanceof Error ? error.message : String(error) };
  }
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

// The analysis keeps a two-step shape: free-text analysis of the supplied
// material first, then schema-constrained formatting. This keeps the long page
// text out of the responseSchema request and lets step 2 stay a small, cheap
// conversion — both requests run on the free tier (no tools).
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
  const sourcePage = input.sourceUrl ? await fetchSourcePage(input.sourceUrl) : null;
  const requestPayload: Record<string, unknown> = {
    requestedProduct: input.query,
    sourceUrl: input.sourceUrl ?? null,
    anonymousInternalBenchmarks: internalBenchmarks,
  };
  if (sourcePage?.text) {
    requestPayload.sourcePageText = sourcePage.text;
  } else if (sourcePage) {
    requestPayload.sourcePageFetchError = sourcePage.reason;
  }
  const hasSourceMaterial = Boolean(sourcePage?.text) || Boolean(input.file);
  const researchDirective = [
    catalogAiInstructions,
    "Analyze the requested product now from the supplied material and your own product knowledge, and summarize the market findings as plain text with concrete Indonesian price points.",
    sourcePage?.text
      ? "Prioritize the fetched product page text provided in sourcePageText, combined with your own knowledge."
      : "",
    hasSourceMaterial
      ? ""
      : "No product page content or file was supplied: state clearly that every price figure is an ESTIMATE from prior knowledge, and include an explicit warning about the missing source material so it is carried into the final warnings list.",
  ].filter(Boolean).join(" ");

  const researchParts: Array<Record<string, unknown>> = [{ text: JSON.stringify(requestPayload) }];
  if (input.file) {
    researchParts.push({
      inlineData: { mimeType: input.file.mimeType, data: input.file.contentBase64 },
    });
  }
  const research = await geminiRequest(endpoint, apiKey, {
    systemInstruction: { parts: [{ text: researchDirective }] },
    contents: [{ role: "user", parts: researchParts }],
    generationConfig,
  });
  const researchText = geminiOutputText(research);
  if (!researchText) throw new Error("Gemini tidak mengembalikan hasil riset pasar.");
  const sources = input.sourceUrl && sourcePage?.text
    ? [{ url: input.sourceUrl, title: new URL(input.sourceUrl).hostname }]
    : [];

  const formatted = await geminiRequest(endpoint, apiKey, {
    systemInstruction: {
      parts: [{
        text: `${catalogAiInstructions} Convert the provided market research into the requested JSON structure without inventing facts beyond it.`,
      }],
    },
    contents: [{
      role: "user",
      parts: [{
        text: JSON.stringify({
          requestedProduct: input.query,
          sourceUrl: input.sourceUrl ?? null,
          anonymousInternalBenchmarks: internalBenchmarks,
          marketResearch: researchText,
        }),
      }],
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
