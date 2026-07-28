import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DynamicContentPage } from "../components/cms-public";
import { getCmsContent, getCmsPageBySlug } from "@/server/cms";
import { getPublicLanguage } from "@/server/public-language";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [page, language] = await Promise.all([
    getCmsPageBySlug((await params).slug),
    getPublicLanguage(),
  ]);
  return page ? {
    title: language === "en" && page.titleEn ? page.titleEn : page.title,
    description: language === "en" && page.excerptEn ? page.excerptEn : page.excerpt,
  } : {};
}

export default async function Page({ params }: Props) {
  const page = await getCmsPageBySlug((await params).slug);
  if (!page) notFound();
  const [content, language] = await Promise.all([getCmsContent(), getPublicLanguage()]);
  return <DynamicContentPage content={content} page={page} language={language} />;
}
