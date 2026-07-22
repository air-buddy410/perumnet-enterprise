import type { Metadata } from "next";
import { PortfolioPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portofolio" };

export default async function Page() {
  return <PortfolioPage content={await getCmsContent()} />;
}
