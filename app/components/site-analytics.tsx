"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { GA_CONFIG_PARAMETERS, createPageViewTracker, isAnalyticsPath } from "../analytics";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * The gtag bootstrap, verbatim from Google except for two things: the config
 * parameters come from app/analytics.ts so the privacy choices live in one
 * readable place, and `gtag` is pinned onto `window` explicitly. The stock
 * snippet relies on a bare function declaration becoming a global, which holds
 * for a classic <script> but is exactly the kind of assumption that breaks
 * silently, and the route-change effect below needs `window.gtag` to exist.
 *
 * `arguments` — not a rest parameter — is deliberate: gtag.js reads the raw
 * Arguments object off dataLayer, and an array does not stand in for it.
 */
function bootstrapSnippet(id: string) {
  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){window.dataLayer.push(arguments);}",
    "window.gtag=gtag;",
    "gtag('js',new Date());",
    `gtag('config',${JSON.stringify(id)},${JSON.stringify(GA_CONFIG_PARAMETERS)});`,
  ].join("");
}

/**
 * One tracker per document, not per component instance.
 *
 * Each public route renders its own PublicShell, so a client-side navigation
 * unmounts this component and mounts a fresh one rather than re-rendering it.
 * Held in a useRef, the "have I reported this yet" state would be reset exactly
 * when it is needed and the route-change pageview would never be sent — that
 * was verified failing against a production build before this moved to module
 * scope.
 */
const shouldReportPageView = createPageViewTracker();

function AnalyticsTag({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const eligible = isAnalyticsPath(pathname);

  /**
   * App Router navigations do not reload the document, so a pageview has to be
   * sent by hand for each one. The very first location this component sees is
   * skipped, because the `gtag('config', …)` call below already reported it.
   *
   * REQUIRES: "Page changes based on browser history events" must be OFF in the
   * GA4 stream's Enhanced Measurement settings. It is ON for every new web
   * stream, and while it is on gtag.js fires its own pageview for each
   * history change — measured on a production build of this app: five
   * /g/collect hits went out for a landing page plus two navigations, of which
   * only three came from dataLayer. The other two were gtag's, carrying `ae=a`
   * and the previous page as `dr`. Leave both sources on and every non-landing
   * pageview is counted twice.
   *
   * The app is the source of truth rather than the GA console toggle because
   * this way the reported path and title come from the router and the rendered
   * document, and the behaviour is fixed in the repository instead of depending
   * on a third-party default that can be changed by anyone with GA access.
   */
  useEffect(() => {
    if (!eligible) return;
    const query = searchParams.toString();
    const location = query ? `${pathname}?${query}` : pathname;
    if (!shouldReportPageView(location)) return;
    window.gtag?.("event", "page_view", {
      page_location: window.location.href,
      page_path: location,
      page_title: document.title,
    });
  }, [eligible, pathname, searchParams]);

  // Belt and braces with the server-side placement. Today <SiteAnalytics> is
  // only rendered from PublicShell, which no console route uses, so this can
  // never fire — but it means a future page that reaches for this component
  // cannot accidentally put the tag on /admin, /panel or the BAST receipt.
  if (!eligible) return null;

  return (
    <>
      <Script
        id="ga4-tag"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
      />
      <Script id="ga4-config" strategy="afterInteractive">
        {bootstrapSnippet(measurementId)}
      </Script>
    </>
  );
}

/**
 * Google Analytics 4 for the public marketing pages.
 *
 * `measurementId` is resolved on the server from NEXT_PUBLIC_GA_MEASUREMENT_ID.
 * PublicShell does not render this component at all when that resolves to null,
 * so nothing here reaches an unconfigured build; the null guard below is what
 * makes that safe for any future caller rather than the primary gate.
 *
 * `useSearchParams()` needs a Suspense boundary above it or the surrounding
 * page opts out of static rendering; the public pages are already
 * force-dynamic, but the boundary keeps that a local decision.
 */
export function SiteAnalytics({ measurementId }: { measurementId: string | null }) {
  if (!measurementId) return null;
  return (
    <Suspense fallback={null}>
      <AnalyticsTag measurementId={measurementId} />
    </Suspense>
  );
}
