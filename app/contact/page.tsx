import type { Metadata } from "next";
import { ContactPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "id", "/contact", "Konsultasi Proyek IT", "Sampaikan kebutuhan Managed WiFi, Smart Home, CCTV, IP PABX, atau software untuk lokasi Anda di Bali.");
}

export default async function Page() {
  const content = await getCmsContent();
  return <ContactPage content={content} language="id" />;
}
