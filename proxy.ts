import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (
    host === "enterprise.perumnet.com" &&
    ["GET", "HEAD"].includes(request.method)
  ) {
    const destination = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      "https://enterprise.perumnet.id",
    );
    return NextResponse.redirect(destination, 301);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
