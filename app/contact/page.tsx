import type { Metadata } from "next";
import { ContactPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kontak" };

export default async function Page() {
  return <ContactPage content={await getCmsContent()} />;
}
