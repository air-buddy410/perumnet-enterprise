import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://perumnet-enterprise.vercel.app"),
  title: "PerumNet Enterprise — Project Operations",
  description:
    "Mini ERP untuk pengelolaan proyek, penawaran, invoice, vendor, BAST, dan pembukuan PerumNet Enterprise.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/perumnet-mark.png",
  },
  openGraph: {
    title: "PerumNet Enterprise",
    description: "Operasional proyek IT dalam satu sistem yang terukur.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "PerumNet Enterprise",
    description: "Operasional proyek IT dalam satu sistem yang terukur.",
    images: ["/og.png"],
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
