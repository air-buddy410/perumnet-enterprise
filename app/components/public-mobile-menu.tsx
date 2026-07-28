"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import type { PublicLanguage } from "@/server/public-language";
import { PublicLanguageSwitcher } from "./public-language-switcher";
import styles from "../site.module.css";

type MobileNavItem = {
  href: string;
  key: string;
  label: string;
};

export function PublicMobileMenu({
  items,
  whatsappUrl,
  language,
}: {
  items: MobileNavItem[];
  whatsappUrl: string;
  language: PublicLanguage;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${styles.mobileMenu} ${open ? styles.mobileMenuOpen : ""}`}>
      <PublicLanguageSwitcher language={language} compact />
      <button
        type="button"
        className={styles.mobileMenuButton}
        aria-label={open ? (language === "id" ? "Tutup menu" : "Close menu") : (language === "id" ? "Buka menu" : "Open menu")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
      {open && (
        <nav aria-label={language === "id" ? "Navigasi seluler" : "Mobile navigation"}>
          {items.map((item) => (
            <Link href={item.href} key={item.key} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            {language === "id" ? "Hubungi via WhatsApp" : "Contact via WhatsApp"} <ArrowRight size={16} />
          </a>
        </nav>
      )}
    </div>
  );
}
