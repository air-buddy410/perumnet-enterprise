import type { MetadataRoute } from "next";
import { getCmsContent } from "@/server/cms";
import { publicOrigin } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const content = await getCmsContent();
  const baseRoutes = ["", "/services", "/portfolio", "/testimonials", "/contact"];
  const customRoutes = content.pages
    .filter((page) => page.isPublished)
    .map((page) => `/${page.slug}`);
  const routes = [...baseRoutes, ...customRoutes];
  const lastModified = new Date();
  return routes.flatMap((route) => [
    {
      url: `${publicOrigin}${route || "/"}`,
      lastModified,
      changeFrequency: route ? "monthly" : "weekly",
      priority: route ? 0.8 : 1,
      alternates: {
        languages: {
          id: `${publicOrigin}${route || "/"}`,
          en: `${publicOrigin}/en${route}`,
        },
      },
    },
    {
      url: `${publicOrigin}/en${route}`,
      lastModified,
      changeFrequency: route ? "monthly" : "weekly",
      priority: route ? 0.75 : 0.9,
      alternates: {
        languages: {
          id: `${publicOrigin}${route || "/"}`,
          en: `${publicOrigin}/en${route}`,
        },
      },
    },
  ]);
}
