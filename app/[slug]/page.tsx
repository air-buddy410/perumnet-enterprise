import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DynamicContentPage } from "../components/cms-public";
import { getCmsContent, getCmsPageBySlug } from "@/server/cms";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getCmsPageBySlug((await params).slug);
  return page ? { title: page.title, description: page.excerpt } : {};
}

export default async function Page({ params }: Props) {
  const page = await getCmsPageBySlug((await params).slug);
  if (!page) notFound();
  return <DynamicContentPage content={await getCmsContent()} page={page} />;
}
