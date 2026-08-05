import type { MetadataRoute } from "next";
import { getCmsContent } from "@/server/cms";
import { publicOrigin, servicePath } from "@/server/public-seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const content = await getCmsContent();
  const baseRoutes = ["", "/services", "/portfolio", "/testimonials", "/contact"];
  // getCmsContent already drops unpublished rows, so unpublishing a service in
  // the panel removes its two URLs from the sitemap in the same edit that makes
  // them 404. A sitemap entry that answers 404 is a crawl error, not a hint.
  const serviceRoutes = content.services.map((service) => servicePath(service.slug));
  const customRoutes = content.pages
    .filter((page) => page.isPublished)
    .map((page) => `/${page.slug}`);
  const routes = [...baseRoutes, ...serviceRoutes, ...customRoutes];
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
