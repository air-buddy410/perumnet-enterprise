"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import styles from "../site.module.css";

type MobileNavItem = {
  href: string;
  key: string;
  label: string;
};

export function PublicMobileMenu({
  items,
  whatsappUrl,
}: {
  items: MobileNavItem[];
  whatsappUrl: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${styles.mobileMenu} ${open ? styles.mobileMenuOpen : ""}`}>
      <button
        type="button"
        className={styles.mobileMenuButton}
        aria-label={open ? "Tutup menu" : "Buka menu"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
      {open && (
        <nav aria-label="Navigasi seluler">
          {items.map((item) => (
            <Link href={item.href} key={item.key} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            WhatsApp <ArrowRight size={16} />
          </a>
        </nav>
      )}
    </div>
  );
}
