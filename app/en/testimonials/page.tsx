import type { Metadata } from "next";
import { TestimonialsPage } from "../../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "en", "/testimonials", "Client Testimonials", "Client experiences with PerumNet Enterprise installation, integration, documentation, and support services.");
}

export default async function Page() {
  return <TestimonialsPage content={await getCmsContent()} language="en" />;
}
