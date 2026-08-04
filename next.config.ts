import type { NextConfig } from "next";

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

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // data: covers inline SVG icons and generated QR codes; blob: covers the
  // client-side object URLs used to hand a generated PDF or XLSX to the user.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} ${cloudflareTurnstile}`,
  `connect-src 'self' ${cloudflareTurnstile}${isDevelopment ? " ws: wss:" : ""}`,
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

const nextConfig: NextConfig = {
  basePath,
  poweredByHeader: false,
  serverExternalPackages: ["pdf-parse"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
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
