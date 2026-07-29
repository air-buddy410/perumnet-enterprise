import type { Metadata } from "next";
import { PortfolioPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "id", "/portfolio", "Portofolio Proyek IT", "Lihat dokumentasi proyek jaringan, keamanan, komunikasi, otomatisasi bangunan, dan perangkat lunak PerumNet Enterprise.");
}

export default async function Page() {
  const content = await getCmsContent();
  return <PortfolioPage content={content} language="id" />;
}
