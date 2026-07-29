import type { Metadata } from "next";
import { ContactPage } from "../../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "en", "/contact", "Discuss Your IT Project", "Tell us what your site in Bali needs for Managed WiFi, Smart Home, CCTV, IP PABX, or software.");
}

export default async function Page() {
  return <ContactPage content={await getCmsContent()} language="en" />;
}
