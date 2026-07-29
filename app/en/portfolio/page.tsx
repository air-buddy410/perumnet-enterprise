import type { Metadata } from "next";
import { PortfolioPage } from "../../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "en", "/portfolio", "IT Project Portfolio", "Explore network, security, communication, building automation, and software projects delivered by PerumNet Enterprise.");
}

export default async function Page() {
  return <PortfolioPage content={await getCmsContent()} language="en" />;
}
