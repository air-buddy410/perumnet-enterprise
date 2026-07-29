import type { Metadata } from "next";
import { ServicesPage } from "../../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "en", "/services", "IT Services for Businesses in Bali", "Managed WiFi, Smart Home & Building Automation, CCTV, IP PABX, and software development with clear installation and documentation.");
}

export default async function Page() {
  return <ServicesPage content={await getCmsContent()} language="en" />;
}
