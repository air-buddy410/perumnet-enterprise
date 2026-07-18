import type { Metadata, Viewport } from "next";
import "./globals.css";
import { appPath } from "./paths";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://perumnet-enterprise.vercel.app"),
  title: "PerumNet Enterprise — Project Operations",
  description:
    "Mini ERP untuk pengelolaan proyek, penawaran, invoice, vendor, BAST, dan pembukuan PerumNet Enterprise.",
  icons: {
    icon: appPath("/favicon.png"),
    shortcut: appPath("/favicon.png"),
    apple: appPath("/perumnet-mark.png"),
  },
  openGraph: {
    title: "PerumNet Enterprise",
    description: "Operasional proyek IT dalam satu sistem yang terukur.",
    type: "website",
    images: [appPath("/og.png")],
  },
  twitter: {
    card: "summary_large_image",
    title: "PerumNet Enterprise",
    description: "Operasional proyek IT dalam satu sistem yang terukur.",
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
