import type { MetadataRoute } from "next";
import { publicOrigin } from "@/server/public-seo";

export default function robots(): MetadataRoute.Robots {
  const demo = process.env.APP_MODE === "demo" || process.env.DEMO_MODE === "true";
  if (demo) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/panel", "/api"],
      },
    ],
    sitemap: `${publicOrigin}/sitemap.xml`,
    host: publicOrigin,
  };
}
