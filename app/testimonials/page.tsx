import type { Metadata } from "next";
import { TestimonialsPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";
import { publicMetadata } from "@/server/public-seo";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(await getCmsContent(), "id", "/testimonials", "Testimoni Klien", "Pengalaman klien dalam menggunakan layanan instalasi, integrasi, dokumentasi, dan dukungan PerumNet Enterprise.");
}

export default async function Page() {
  const content = await getCmsContent();
  return <TestimonialsPage content={content} language="id" />;
}
