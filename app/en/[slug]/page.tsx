import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DynamicContentPage } from "../../components/cms-public";
import { getCmsContent, getCmsPageBySlug } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  const [page, content] = await Promise.all([getCmsPageBySlug(slug), getCmsContent()]);
  return page
    ? publicMetadata(content, "en", `/${slug}`, page.titleEn || page.title, page.excerptEn || page.excerpt)
    : {};
}

export default async function Page({ params }: Props) {
  const page = await getCmsPageBySlug((await params).slug);
  if (!page) notFound();
  return <DynamicContentPage content={await getCmsContent()} page={page} language="en" />;
}
