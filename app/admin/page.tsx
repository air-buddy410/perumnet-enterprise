import type { Metadata } from "next";
import { EnterpriseApp } from "../components/enterprise-app";

export const dynamic = "force-dynamic";

/**
 * The ERP behind the login must never reach a search index, and until now
 * nothing stopped it: this page exported no metadata at all, so it inherited
 * the public marketing title and description from the root layout and emitted
 * no robots directive.
 *
 * `app/robots.ts` does disallow /admin, but that file never reaches a crawler.
 * Cloudflare serves its own managed robots.txt on enterprise.perumnet.id —
 * content-signal directives, `User-agent: * / Allow: /`, an AI-crawler block
 * list, and no Disallow lines — which replaces ours at the edge. A robots meta
 * tag is rendered by the origin into the document, so the edge cannot swap it
 * out. Same reasoning as app/panel/page.tsx and app/verify/bast/[token].
 */
export const metadata: Metadata = {
  title: "Konsol Enterprise",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <EnterpriseApp />;
}
