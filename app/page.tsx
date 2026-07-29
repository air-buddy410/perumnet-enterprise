import type { Metadata } from "next";
import { HomePage } from "./components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getCmsContent();
  return publicMetadata(content, "id", "/", "PerumNet Enterprise — Konsultan IT Bali", "Managed WiFi, Smart Home, CCTV, IP PABX, dan software untuk hotel, villa, kantor, sekolah, serta area komersial di Bali.");
}

export default async function Page() {
  const content = await getCmsContent();
  return <HomePage content={content} language="id" />;
}
