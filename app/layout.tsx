import type { Metadata, Viewport } from "next";
import { DM_Sans, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { appPath } from "./paths";
import { publicOrigin } from "@/server/public-seo";

// The brand faces, downloaded at build time and served from this origin.
//
// They used to be a <link rel=stylesheet> to fonts.googleapis.com, which the
// Content-Security-Policy in next.config.ts blocked outright (`style-src
// 'self' 'unsafe-inline'`), so every visitor got Arial. Self-hosting fixes that
// without opening the policy up: no fonts.googleapis.com in style-src, no
// fonts.gstatic.com in font-src, and no render-blocking round trip to Google
// from Indonesia before the first paint.
//
// No `weight` here on purpose — that pulls the variable font, one file per
// family covering the whole weight range, instead of seven static cuts. It is
// the smaller download, and weights the CSS asks for that were never in the
// old link tag (`font: 750 …` in the mail login editor) now render as written
// rather than snapping to the nearest cut.
//
// `variable` hands each family to CSS as a custom property, and the
// stylesheets ask for var(--font-dm-sans) instead of naming the family. That
// is not just ceremony: the property expands to `"DM Sans", "DM Sans
// Fallback"`, where the second entry is a local face next/font size-adjusts to
// match the real one's metrics, so text does not reflow when the woff2 lands.
// Spelling "DM Sans" in the CSS would resolve today but skip that fallback,
// and it leans on a generated name next/font does not promise to keep.
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta-sans",
});

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
    <html lang="id" className={`${dmSans.variable} ${plusJakartaSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
