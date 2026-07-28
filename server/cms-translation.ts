import "server-only";

const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";

function parseTranslation(payload: unknown) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return "";
  return payload[0]
    .map((segment) => (Array.isArray(segment) ? String(segment[0] ?? "") : ""))
    .join("")
    .trim();
}

export async function translateIndonesianToEnglish(value: string) {
  const source = value.trim();
  if (!source) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const params = new URLSearchParams({
      client: "gtx",
      sl: "id",
      tl: "en",
      dt: "t",
      q: source,
    });
    const response = await fetch(TRANSLATE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: params,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Layanan terjemahan merespons ${response.status}.`);
    }
    const translated = parseTranslation(await response.json());
    if (!translated) throw new Error("Layanan terjemahan tidak mengembalikan hasil.");
    return translated;
  } finally {
    clearTimeout(timeout);
  }
}

export async function translateMany(values: string[]) {
  const results: string[] = [];
  for (const value of values) {
    results.push(await translateIndonesianToEnglish(value));
  }
  return results;
}
