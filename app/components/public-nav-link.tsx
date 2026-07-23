"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

export function PublicNavLink({
  href,
  children,
  className,
  current,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  current?: boolean;
}) {
  if (!href.startsWith("#")) {
    return (
      <Link href={href} className={className} aria-current={current ? "page" : undefined}>
        {children}
      </Link>
    );
  }

  const scroll = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.pushState(null, "", href);
  };

  return (
    <a
      href={href}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={scroll}
    >
      {children}
    </a>
  );
}
