import type { Metadata } from "next";
import { PortfolioPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { getPublicLanguage } from "@/server/public-language";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portofolio" };

export default async function Page() {
  const [content, language] = await Promise.all([getCmsContent(), getPublicLanguage()]);
  return <PortfolioPage content={content} language={language} />;
}
