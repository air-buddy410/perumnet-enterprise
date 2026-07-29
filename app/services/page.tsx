import type { Metadata } from "next";
import { ServicesPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "id", "/services", "Layanan IT untuk Bisnis di Bali", "Managed WiFi, Smart Home & Building Automation, CCTV, IP PABX, dan pengembangan software dengan proses instalasi serta dokumentasi yang jelas.");
}

export default async function Page() {
  const content = await getCmsContent();
  return <ServicesPage content={content} language="id" />;
}
