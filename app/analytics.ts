/**
 * Google Analytics 4, gated on one variable.
 *
 * Nothing here loads unless NEXT_PUBLIC_GA_MEASUREMENT_ID holds a well-formed
 * GA4 Measurement ID. With the variable unset — which is how the site ships
 * today — `measurementId()` returns null, `<SiteAnalytics>` renders nothing,
 * and next.config.ts leaves the Content-Security-Policy exactly as it was. No
 * script tag, no preload hint, no request to Google.
 *
 * The variable is read at build time (Next inlines every NEXT_PUBLIC_* literal
 * into the bundle, and custom headers are baked into the routes manifest), so
 * turning analytics on is `set the variable` + `npm run build` + restart, not
 * just a restart.
 *
 * This module is deliberately dependency-free: next.config.ts imports it to
 * decide whether the CSP needs widening, a client component imports it to know
 * which routes are eligible, and the regression test imports it directly under
 * `node --test`. Anything that pulls in React or `server-only` would break at
 * least one of those three callers.
 */

/**
 * A GA4 Measurement ID is "G-" followed by the property's short code — upper
 * case letters and digits, ten of them in practice. The guard is here to catch
 * the two mistakes an owner actually makes when pasting from the GA console: a
 * Tag Manager container ID (GTM-XXXXXXX), and a value with stray quotes or
 * whitespace around it. Anything that does not match disables analytics rather
 * than emitting a script tag that would 404 against Google and sit in the CSP
 * report as noise.
 */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

/** The single variable that turns analytics on. */
export const GA_MEASUREMENT_ID_VARIABLE = "NEXT_PUBLIC_GA_MEASUREMENT_ID";

/**
 * Trims and upper-cases a candidate ID, returning null when it is missing or
 * malformed. Upper-casing is safe: GA4 never issues an ID with a lower-case
 * letter in it, so the only value this rescues is a hand-typed one.
 */
export function normaliseMeasurementId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toUpperCase();
  if (!value) return null;
  return MEASUREMENT_ID_PATTERN.test(value) ? value : null;
}

/** The configured Measurement ID, or null when analytics is switched off. */
export function measurementId(): string | null {
  return normaliseMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
}

/**
 * Route prefixes that never get an analytics tag.
 *
 * /admin is the ERP and /panel is the CMS: the people behind that login are
 * staff doing their job, not marketing traffic, and counting them would make
 * every engagement metric on the property a lie. They already carry
 * `X-Robots-Tag: noindex` and a robots meta tag for the same reason.
 *
 * /verify is the BAST verification page a client opens from a QR code on a
 * signed handover document. It is a legal receipt, not a marketing page, and
 * the URL itself carries a document token — sending it to Google as a page
 * path would leak it into a third party's logs.
 *
 * /api never renders a document, so it cannot carry a tag anyway; it is listed
 * so the rule reads as "everything under the console is out" rather than as a
 * list someone has to reason about.
 */
export const ANALYTICS_EXCLUDED_PREFIXES = ["/admin", "/panel", "/api", "/verify"];

/**
 * True for the public marketing pages, false for everything listed above.
 *
 * Takes the pathname as `usePathname()` reports it — no origin, no query, and
 * already stripped of any configured basePath.
 */
export function isAnalyticsPath(pathname: string): boolean {
  const withoutQuery = pathname.split("?")[0].split("#")[0];
  const path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const normalised = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return !ANALYTICS_EXCLUDED_PREFIXES.some(
    (prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`),
  );
}

/**
 * The `gtag('config', …)` parameters.
 *
 * `allow_google_signals: false` keeps the property out of Google's
 * cross-device advertising graph, and `allow_ad_personalization_signals: false`
 * stops the data being reused to target ads. Both are off because this is a
 * B2B lead site: the owner wants to know which service pages bring enquiries,
 * not to build an advertising audience. Turning them off is also what keeps
 * the processing inside "web analytics" rather than "advertising", which is the
 * distinction that matters under UU PDP and for the European clients whose
 * hotels and villas we install for.
 *
 * `anonymize_ip` is redundant on GA4 — the platform drops the full address
 * before it is written — but it is set explicitly so the intent is visible to
 * anyone auditing this file or the network tab, and so a future migration back
 * to a tag that honours it does not silently start logging addresses.
 *
 * `send_page_view: true` is the default and is stated for the same reason: the
 * initial pageview comes from here, and only subsequent client-side route
 * changes are sent by hand from the component.
 */
/**
 * Decides which locations need a hand-sent pageview.
 *
 * gtag.js reports the page it loaded on and nothing else, so App Router
 * navigations — which never reload the document — have to be reported by the
 * app. The rules the returned function encodes:
 *
 *   * the first location it is ever shown returns false. `gtag('config', …)`
 *     already reported that one, and counting it twice doubles the landing
 *     page and halves the bounce rate;
 *   * the same location twice in a row returns false, so React's
 *     double-invoked effects in development cannot produce a duplicate hit;
 *   * every other change returns true, including navigating back to a location
 *     that was already visited — that is a real second view.
 *
 * The tracker is created once per document rather than per component, because
 * every public route renders its own PublicShell: a client-side navigation
 * unmounts the analytics component and mounts a fresh one, so per-component
 * state would be reset exactly when it is needed and the pageview would never
 * be sent. A full page load makes a new tracker, which is correct — that load
 * re-runs `gtag('config', …)` and gets its pageview from there.
 */
export function createPageViewTracker() {
  let lastReported: string | null = null;
  return function shouldReportPageView(location: string): boolean {
    if (location === lastReported) return false;
    const initialLocation = lastReported === null;
    lastReported = location;
    return !initialLocation;
  };
}

export const GA_CONFIG_PARAMETERS = {
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
  send_page_view: true,
} as const;
