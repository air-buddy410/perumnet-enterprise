import type { Metadata, Viewport } from "next";
import "./globals.css";
import { appPath } from "./paths";
import { publicOrigin } from "@/server/public-seo";

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
