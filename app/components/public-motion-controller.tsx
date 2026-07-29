"use client";

import { useLayoutEffect } from "react";

export function PublicMotionController({ enabled }: { enabled: boolean }) {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-public-site-root]");
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!enabled || reducedMotion) {
      root.dataset.motion = "disabled";
      items.forEach((item) => {
        item.dataset.revealed = "true";
      });
      return;
    }

    root.dataset.motion = "enabled";
    items.forEach((item) => {
      item.dataset.revealed = "false";
      const delay = Number(item.dataset.revealDelay || "0");
      item.style.setProperty("--reveal-delay", `${Number.isFinite(delay) ? Math.max(0, delay) : 0}ms`);
    });
    root.dataset.motionReady = "true";

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    items.forEach((item) => observer.observe(item));

    return () => {
      observer.disconnect();
      delete root.dataset.motionReady;
      items.forEach((item) => {
        delete item.dataset.revealed;
      });
    };
  }, [enabled]);

  return null;
}
