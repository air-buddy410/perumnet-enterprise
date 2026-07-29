import type { Metadata } from "next";
import { HomePage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "en", "/", "PerumNet Enterprise — IT Consultant in Bali", "Managed WiFi, Smart Home, CCTV, IP PABX, and software services for hotels, villas, offices, schools, and commercial sites in Bali.");
}

export default async function Page() {
  return <HomePage content={await getCmsContent()} language="en" />;
}
