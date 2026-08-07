import type { NextConfig } from "next";
import { measurementId } from "./app/analytics";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath =
  configuredBasePath && configuredBasePath !== "/"
    ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
    : "";

const isDevelopment = process.env.NODE_ENV !== "production";

// Content Security Policy.
//
// What this buys: a script that reaches this origin cannot call an off-site
// endpoint, the app cannot be framed (so no clickjacking of /admin or /panel),
// and <object>/<embed> are gone entirely.
//
// What is deliberately left permissive, and why:
//
//   script-src 'unsafe-inline'  Next.js emits inline bootstrap and flight-data
//                               scripts on every page. Removing this needs a
//                               per-request nonce from middleware, which is a
//                               separate change with its own failure mode (a
//                               nonce that does not reach a streamed chunk
//                               blanks the page). Left as follow-up work.
//   script-src 'unsafe-eval'    Development only — Turbopack's HMR runtime
//                               evaluates module code. The production build
//                               does not get it.
//   style-src  'unsafe-inline'  The CMS public pages style elements inline from
//                               editable site settings (colours, carousel
//                               speed), and Next injects inline <style> for
//                               critical CSS.
//
// challenges.cloudflare.com is the Turnstile widget on the public lead form: it
// loads a script, opens an iframe, and posts the token back.
const cloudflareTurnstile = "https://challenges.cloudflare.com";

// Cloudflare Web Analytics. Cloudflare injects this beacon into the HTML on its
// way through the proxy, so it arrives whether or not the application asks for
// it — blocking it did not stop the injection, it only stopped the owner's own
// Cloudflare dashboard from receiving anything. The script loads from
// static.cloudflareinsights.com and reports to cloudflareinsights.com; both are
// needed, since a script that cannot report is the same as no script at all.
// Turning the feature off in the Cloudflare dashboard is the alternative if the
// owner would rather carry one less third-party script than have the data.
const cloudflareInsightsScript = "https://static.cloudflareinsights.com";
const cloudflareInsightsBeacon = "https://cloudflareinsights.com";

// Google Analytics 4, and only when it is actually switched on.
//
// The whole policy below is unchanged when NEXT_PUBLIC_GA_MEASUREMENT_ID is
// unset — which is how the demo build and the current production build ship —
// so no origin is opened up for a tag that is not there. `next build` bakes
// custom headers into the routes manifest, so this is decided at build time,
// the same moment Next inlines the NEXT_PUBLIC_* value into the bundle. The two
// cannot drift.
//
// Each entry is what gtag.js actually reaches for, nothing wider:
//
//   script-src  www.googletagmanager.com   The gtag.js loader. next/script
//                                          appends a <script src> for it after
//                                          hydration and React emits a
//                                          <link rel=preload as=script> for the
//                                          same URL, and both are governed by
//                                          script-src. The inline bootstrap
//                                          needs nothing new — it is covered by
//                                          the 'unsafe-inline' already here.
//   connect-src *.google-analytics.com     The measurement endpoint. GA4 sends
//                                          /g/collect to www. or to a regional
//                                          host (region1., region5., …), so the
//                                          host cannot be pinned exactly.
//   connect-src *.analytics.google.com     Where gtag.js redirects collection
//                                          for some regions and where it posts
//                                          the server-side consent ping.
//   connect-src *.googletagmanager.com     gtag.js fetches its own remote
//                                          config (/gtag/destination) over
//                                          fetch, not as a script tag.
//   img-src     *.google-analytics.com     The fallback beacon. When fetch and
//                                          sendBeacon are both unavailable —
//                                          old in-app browsers, which on this
//                                          site means WhatsApp's — GA4 falls
//                                          back to a 1x1 GIF.
//
// Deliberately NOT added: googleads.g.doubleclick.net, google.com/ads and the
// rest of the remarketing set. They are only reached when Google Signals is on,
// and app/analytics.ts turns it off.
const googleTagManager = "https://www.googletagmanager.com";
const analyticsEnabled = measurementId() !== null;
const analyticsScriptSources = analyticsEnabled ? ` ${googleTagManager}` : "";
const analyticsConnectSources = analyticsEnabled
  ? " https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com"
  : "";
const analyticsImageSources = analyticsEnabled ? " https://*.google-analytics.com" : "";

// OpenStreetMap raster tiles for the project map on the admin dashboard. Tiles
// are PNGs, so this belongs in img-src and nowhere else: Leaflet is bundled
// from npm, and its stylesheet and marker assets are emitted under /_next,
// which 'self' already covers. The canonical single host is used rather than
// the legacy a/b/c. subdomains — the OSMF tile policy asks for exactly that,
// and it keeps the directive to one named origin instead of a wildcard.
const openStreetMapTiles = "https://tile.openstreetmap.org";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // data: covers inline SVG icons and generated QR codes; blob: covers the
  // client-side object URLs used to hand a generated PDF or XLSX to the user.
  `img-src 'self' data: blob: ${openStreetMapTiles}${analyticsImageSources}`,
  // The brand typefaces are committed to the repo and emitted by next/font into
  // /_next/static/media, so 'self' is the whole of it — no Google origin here.
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} ${cloudflareTurnstile} ${cloudflareInsightsScript}${analyticsScriptSources}`,
  `connect-src 'self' ${cloudflareTurnstile} ${cloudflareInsightsBeacon}${analyticsConnectSources}${isDevelopment ? " ws: wss:" : ""}`,
  `frame-src 'self' ${cloudflareTurnstile}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Belt and braces with frame-ancestors: older browsers honour only this one.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

// Keeps every authenticated surface out of the search index.
//
// The obvious place for this is robots.txt, and `app/robots.ts` does disallow
// /admin, /panel and /api — but that file is never what a crawler reads.
// Cloudflare serves its own managed robots.txt on enterprise.perumnet.id, and
// it carries `User-agent: * / Allow: /` with no Disallow lines at all. The
// origin's version is replaced at the edge.
//
// A response header is written by the origin per request, so the edge does not
// substitute it. The pages themselves also carry `<meta name="robots">` via the
// Metadata API; this covers what a meta tag cannot — /api responses are JSON
// with no document head, and any future sub-route under /admin or /panel gets
// it without having to remember to export metadata.
const noIndexHeaders = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  basePath,
  poweredByHeader: false,
  serverExternalPackages: ["pdf-parse"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // `:path*` matches zero segments too, so these cover the bare /admin,
      // /panel and /api paths as well as everything beneath them.
      { source: "/admin/:path*", headers: noIndexHeaders },
      { source: "/panel/:path*", headers: noIndexHeaders },
      { source: "/api/:path*", headers: noIndexHeaders },
      // The two endpoints that hand back operator-uploaded bytes. New uploads
      // are validated and rasterised, but rows written before that landed can
      // still be an SVG — a document with <script> in it. They are served as an
      // opaque download; this makes the surrounding policy match.
      {
        source: "/api/cms/:kind(media|partner-media)/:id*",
        headers: [
          ...securityHeaders.filter((header) => header.key !== "Content-Security-Policy"),
          { key: "Content-Security-Policy", value: "default-src 'none'; sandbox" },
        ],
      },
    ];
  },
};

export default nextConfig;
