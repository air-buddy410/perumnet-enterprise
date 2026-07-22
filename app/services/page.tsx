import type { Metadata } from "next";
import { ServicesPage } from "../components/cms-public";
import { getCmsContent } from "@/server/cms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Layanan" };

export default async function Page() {
  return <ServicesPage content={await getCmsContent()} />;
}
