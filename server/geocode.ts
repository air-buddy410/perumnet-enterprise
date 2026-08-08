import "server-only";

/**
 * Turns the free-text `projects.location` into coordinates for the dashboard
 * map, using Nominatim — OpenStreetMap's own geocoder, no API key, no billing.
 *
 * The Nominatim usage policy is a condition of being allowed to call it at all,
 * not a recommendation, so every clause it states is implemented here rather
 * than assumed:
 *
 *   "No heavy uses (an absolute maximum of 1 request per second)."
 *       One process-wide slot queue, `MIN_INTERVAL_MS` apart. Every caller
 *       waits its turn; nothing can burst past it.
 *   "Provide a valid HTTP Referer or User-Agent identifying the application
 *    and a valid email address."
 *       `userAgent()` names this application, its deployment URL, and a contact
 *       address a Nominatim operator can actually write to.
 *   "No bulk geocoding."
 *       There is deliberately no backfill loop anywhere in this repository. A
 *       lookup happens only when a person saves one project, and only when that
 *       project's location text has not already been asked about.
 *
 * The other half of the contract is towards the person pressing Save: this
 * module is allowed to give up, and never allowed to fail. Every path returns
 * either a result or `null`; nothing here throws. Callers must treat `null` as
 * "no coordinates today" and save the project regardless.
 */

const DEFAULT_ENDPOINT = "https://nominatim.openstreetmap.org/search";

// The policy ceiling is one request per second. The extra 100 ms absorbs clock
// jitter so a burst of saves cannot round down to two requests inside a second.
const MIN_INTERVAL_MS = 1_100;

// Generous — Nominatim answers a single-line query in a few hundred
// milliseconds and this leaves room for a bad minute — but firm: the deadline
// covers the queue wait as well as the request, so a save can never be held up
// for longer than this no matter how many other saves are ahead of it.
const DEFAULT_TIMEOUT_MS = 4_000;

const CONTACT_FALLBACK = "it@perumnet.id";
const APP_URL_FALLBACK = "https://enterprise.perumnet.id";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Nominatim's own `display_name`, stored so a wrong pin is diagnosable. */
  label: string;
}

declare global {
  var __perumnetGeocodeSlot: number | undefined;
}

function endpoint() {
  return process.env.NOMINATIM_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
}

function timeoutMs() {
  const configured = Number(process.env.NOMINATIM_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

/**
 * Off only when switched off. The automated suite sets this to "false" so the
 * tests never reach a third-party service; everywhere else the feature works
 * without anybody having to remember an environment variable.
 */
export function geocodingEnabled() {
  return process.env.GEOCODING_ENABLED?.trim().toLowerCase() !== "false";
}

function userAgent() {
  const contact = process.env.NOMINATIM_CONTACT_EMAIL?.trim() || CONTACT_FALLBACK;
  const site = process.env.APP_URL?.trim() || APP_URL_FALLBACK;
  return `PerumNetEnterprise/1.0 (+${site}; ${contact})`;
}

/**
 * Claims the next free second on the shared queue.
 *
 * Returns the timestamp the caller may fire at, or `null` when the queue is
 * already longer than the caller's own deadline — in which case the right
 * answer is to skip the lookup entirely rather than to make somebody wait for a
 * slot that will have expired by the time it arrives.
 */
function claimSlot(deadline: number) {
  const now = Date.now();
  const slot = Math.max(now, globalThis.__perumnetGeocodeSlot ?? 0);
  if (slot >= deadline) return null;
  globalThis.__perumnetGeocodeSlot = slot + MIN_INTERVAL_MS;
  return slot;
}

function coordinate(value: unknown, limit: number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

/**
 * Looks up one location string. Never throws, never retries.
 *
 * A retry belongs to the next time somebody saves the project, not to this
 * request: retrying inside the request path is how a slow geocoder turns into a
 * slow Save button, and how one unreachable host turns into a burst of traffic
 * at exactly the moment the operator least wants it.
 */
export async function geocodeLocation(location: string): Promise<GeocodeResult | null> {
  const query = location.trim();
  if (!query || !geocodingEnabled()) return null;

  const deadline = Date.now() + timeoutMs();
  const slot = claimSlot(deadline);
  if (slot === null) return null;

  try {
    const wait = slot - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;

    const url = new URL(endpoint());
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    // Every site this company installs at is in Indonesia. Without the filter
    // "Ubud" is also a street in Europe and "Denpasar" resolves against a much
    // larger candidate set; with it, a location that genuinely is not in
    // Indonesia returns nothing and the project simply waits for a manual pin.
    url.searchParams.set("countrycodes", "id");

    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent(),
        Accept: "application/json",
        "Accept-Language": "id,en",
      },
      signal: AbortSignal.timeout(remaining),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    if (!first || typeof first !== "object") return null;

    const record = first as Record<string, unknown>;
    const latitude = coordinate(record.lat, 90);
    const longitude = coordinate(record.lon, 180);
    if (latitude === null || longitude === null) return null;

    const label = typeof record.display_name === "string" ? record.display_name.slice(0, 300) : "";
    return { latitude, longitude, label };
  } catch {
    // A timeout, a DNS failure, a 429, malformed JSON — the answer to all of
    // them is the same and it is never an exception reaching the caller.
    return null;
  }
}
