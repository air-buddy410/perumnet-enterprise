import type { NextConfig } from "next";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath =
  configuredBasePath && configuredBasePath !== "/"
    ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
    : "";

const nextConfig: NextConfig = {
  basePath,
  poweredByHeader: false,
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
