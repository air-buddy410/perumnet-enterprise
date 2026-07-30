import { type NextRequest, NextResponse } from "next/server";

const languageNeutralPrefixes = [
  "/admin",
  "/panel",
  "/api",
  "/_next",
  "/uploads",
] as const;

function dotComDestination(pathname: string) {
  const languageNeutral =
    languageNeutralPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[a-z0-9]{2,8}$/i.test(pathname);
  if (languageNeutral || pathname === "/en" || pathname.startsWith("/en/")) {
    return pathname;
  }
  return pathname === "/" ? "/en" : `/en${pathname}`;
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (
    host === "enterprise.perumnet.com" &&
    ["GET", "HEAD"].includes(request.method)
  ) {
    const destination = new URL(
      `${dotComDestination(request.nextUrl.pathname)}${request.nextUrl.search}`,
      "https://enterprise.perumnet.id",
    );
    return NextResponse.redirect(destination, 301);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
