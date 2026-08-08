import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { appPath } from "./paths";
import { publicOrigin } from "@/server/public-seo";

// The two brand typefaces, served from this origin.
//
// They used to come from a <link> to fonts.googleapis.com, which meant every
// visitor made three off-site requests before the first paint and the policy in
// next.config.ts had to name two Google origins. They are now committed under
// app/fonts and emitted by next/font into /_next/static/media, so nothing
// leaves for Google at runtime and both origins are gone from the policy.
//
// next/font/local rather than next/font/google on purpose: next/font/google
// downloads from Google during `next build`, and this project builds on the VPS
// twice per release. Committed files keep the build reproducible and working
// when Google is not reachable.
//
// Provenance — these are the exact woff2 files fonts.gstatic.com was serving to
// a current Chrome, so the glyphs are unchanged:
//
//   DM Sans           v17, font version 4.004  (variable, wght 100–1000)
//   Plus Jakarta Sans v12, font version 2.071   (variable, wght 200–800)
//
// Both are SIL Open Font License 1.1 — the licenceURL in each font's name table
// is https://scripts.sil.org/OFL, and the licence text is committed next to the
// files as DMSans-OFL.txt and PlusJakartaSans-OFL.txt.
//
// Two things below look redundant and are not:
//
//   * Each family is loaded twice, once per subset. Google splits latin from
//     latin-ext and gates each with a unicode-range so a page that never renders
//     an extended-Latin glyph never fetches that file. Keeping the split keeps
//     that property: an Indonesian or English page downloads the latin file
//     only. `declarations` is shared by every face in one call, so a second
//     unicode-range needs a second call. Cyrillic and Vietnamese are dropped.
//
//   * The weights are pinned one face at a time rather than declared as a
//     range, even though these are variable fonts. That is deliberate: the CSS
//     asks for weights these families were never served at — h1 is font-weight
//     400 in Plus Jakarta Sans, several rules ask for 750, 800 and 850 — and
//     with a range the browser would interpolate the exact weight and render
//     visibly lighter or heavier text. Pinning 400/500/600/700 and 600/700/800
//     reproduces what Google served, so those rules keep snapping to the same
//     face they snap to today. All four faces of a family still point at one
//     file; it is emitted once.
//
// `declarations` also carries font-family. Without it next/font names the face
// after the JavaScript identifier instead, and the ~70 `font-family: "DM Sans"`
// / `"Plus Jakarta Sans"` declarations across globals.css and the three CSS
// modules would all have to be rewritten to a variable. Naming the face gives
// the same rendering with no churn.
//
// That is also why nothing below uses `.className`, `variable` or
// `adjustFontFallback`. Turbopack builds all three from the identifier — the
// generated class reads `font-family: dmSans, dmSans Fallback, …` — so with the
// face named "DM Sans" they point at a family that does not exist, and anything
// styled with them would render in the fallback permanently. The cost is
// next/font's metric-adjusted fallback: it is only ever reached through those
// same handles, so it cannot be switched on without moving every rule above
// onto a CSS variable. Google Fonts did not provide one either, so first paint
// behaves exactly as it does today — but it is the one item on the wishlist
// this approach cannot buy.

const dmSans = localFont({
  src: [
    { path: "./fonts/DMSans-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/DMSans-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/DMSans-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/DMSans-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "DM Sans" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const dmSansExtended = localFont({
  src: [
    { path: "./fonts/DMSans-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./fonts/DMSans-latin-ext.woff2", weight: "500", style: "normal" },
    { path: "./fonts/DMSans-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "./fonts/DMSans-latin-ext.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  // Gated behind a unicode-range no Indonesian or English page reaches, so
  // preloading it would download bytes the page never draws with.
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "DM Sans" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const plusJakartaSans = localFont({
  src: [
    { path: "./fonts/PlusJakartaSans-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/PlusJakartaSans-latin.woff2", weight: "700", style: "normal" },
    { path: "./fonts/PlusJakartaSans-latin.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Plus Jakarta Sans" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const plusJakartaSansExtended = localFont({
  src: [
    { path: "./fonts/PlusJakartaSans-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "./fonts/PlusJakartaSans-latin-ext.woff2", weight: "700", style: "normal" },
    { path: "./fonts/PlusJakartaSans-latin-ext.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Plus Jakarta Sans" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

// The four calls are made for their side effect — the @font-face rules and the
// woff2 files copied into /_next/static/media. Every rule in the app reaches
// those faces by name, so the handles are collected here only to keep the
// bindings live; a `localFont()` call has to be assigned to something.
export const brandTypefaces = [
  dmSans,
  dmSansExtended,
  plusJakartaSans,
  plusJakartaSansExtended,
];

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: {
    default: "PerumNet Enterprise — Konsultan IT Bali",
    template: "%s — PerumNet Enterprise",
  },
  description:
    "PerumNet Enterprise membantu hotel, villa, kantor, sekolah, dan area komersial di Bali menata Managed WiFi, Smart Home, CCTV, IP PABX, dan sistem perangkat lunak.",
  icons: {
    icon: appPath("/favicon.png"),
    shortcut: appPath("/favicon.png"),
    apple: appPath("/apple-touch-icon.png"),
  },
  openGraph: {
    title: "PerumNet Enterprise — Konsultan IT Bali",
    description: "Layanan IT untuk hotel, villa, kantor, sekolah, dan area komersial di Bali.",
    url: "/",
    siteName: "PerumNet Enterprise",
    type: "website",
    images: [appPath("/og.png")],
  },
  twitter: {
    card: "summary_large_image",
    title: "PerumNet Enterprise — Konsultan IT Bali",
    description: "Layanan IT untuk hotel, villa, kantor, sekolah, dan area komersial di Bali.",
    images: [appPath("/og.png")],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#04a99f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
