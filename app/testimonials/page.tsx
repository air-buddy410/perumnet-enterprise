import type { Metadata } from "next";
import { TestimonialsPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Testimoni" };

export default async function Page() {
  return <TestimonialsPage content={await getCmsContent()} />;
}
