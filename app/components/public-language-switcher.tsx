"use client";

import { useRouter } from "next/navigation";
import type { PublicLanguage } from "@/server/public-language";
import styles from "../site.module.css";

export function PublicLanguageSwitcher({
  language,
  compact = false,
}: {
  language: PublicLanguage;
  compact?: boolean;
}) {
  const router = useRouter();

  const select = (next: PublicLanguage) => {
    if (next === language) return;
    document.cookie = `perumnet_language=${next}; path=/; max-age=31536000; SameSite=Lax`;
    router.refresh();
  };

  return (
    <div className={`${styles.languageSwitcher} ${compact ? styles.languageSwitcherCompact : ""}`} aria-label={language === "id" ? "Pilih bahasa" : "Choose language"}>
      <button type="button" className={language === "id" ? styles.activeLanguage : ""} onClick={() => select("id")} aria-pressed={language === "id"}>ID</button>
      <span aria-hidden="true">/</span>
      <button type="button" className={language === "en" ? styles.activeLanguage : ""} onClick={() => select("en")} aria-pressed={language === "en"}>EN</button>
    </div>
  );
}
