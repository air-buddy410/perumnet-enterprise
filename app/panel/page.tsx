import type { Metadata } from "next";
import { PanelApp } from "./panel-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Panel CMS",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PanelApp />;
}
