import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServiceDetailPage } from "../../../components/cms-public";
import { getCmsContent, getCmsServiceBySlug } from "@/server/cms";
import { serviceMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  const [service, content] = await Promise.all([getCmsServiceBySlug(slug), getCmsContent()]);
  return service ? serviceMetadata(content, "en", service) : {};
}

export default async function Page({ params }: Props) {
  const service = await getCmsServiceBySlug((await params).slug);
  if (!service) notFound();
  return <ServiceDetailPage content={await getCmsContent()} service={service} language="en" />;
}
