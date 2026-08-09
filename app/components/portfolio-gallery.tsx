"use client";

import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { CmsPortfolioImage } from "@/server/cms";
import type { PublicLanguage } from "@/server/public-language";
import styles from "../site.module.css";
import { PublicPortfolioImage } from "./public-portfolio-image";

function copy(language: PublicLanguage, indonesian: string, english: string) {
  return language === "en" ? english : indonesian;
}

export function PortfolioGallery({
  images,
  title,
  language,
}: {
  images: CmsPortfolioImage[];
  title: string;
  language: PublicLanguage;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerStart = useRef<number | null>(null);
  const active = images[activeIndex] ?? images[0];
  const cover = images.find((image) => image.isCover) ?? images[0];
  const hasImages = images.length > 0;

  const close = () => setOpen(false);
  const previous = () => setActiveIndex((index) => (index - 1 + images.length) % images.length);
  const next = () => setActiveIndex((index) => (index + 1) % images.length);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    const goPrevious = () => setActiveIndex((index) => (index - 1 + images.length) % images.length);
    const goNext = () => setActiveIndex((index) => (index + 1) % images.length);
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (images.length > 1 && event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (images.length > 1 && event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable?.length) return;
      const items = Array.from(focusable);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [images.length, open]);

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={styles.portfolioImageTrigger}
      onClick={() => { setActiveIndex(0); setOpen(true); }}
      disabled={!hasImages}
      aria-haspopup="dialog"
      aria-label={copy(language, `Buka galeri ${title}`, `Open ${title} gallery`)}
    >
      <PublicPortfolioImage src={cover?.url ?? ""} alt={title} />
      {images.length > 1 && <span className={styles.portfolioGalleryCount}><Images size={14} aria-hidden="true" /> {images.length}</span>}
    </button>
    {open && active && typeof document !== "undefined" && createPortal(
      <div className={styles.portfolioLightboxBackdrop} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialogRef} className={styles.portfolioLightbox} role="dialog" aria-modal="true" aria-label={copy(language, `Galeri ${title}`, `${title} gallery`)}>
          <div className={styles.portfolioLightboxTopline}>
            <span>{title}</span>
            <span>{activeIndex + 1} / {images.length}</span>
            <button ref={closeRef} type="button" className={styles.portfolioLightboxClose} onClick={close} aria-label={copy(language, "Tutup galeri", "Close gallery")}><X size={22} /></button>
          </div>
          <div
            className={styles.portfolioLightboxStage}
            onPointerDown={(event) => { if (event.pointerType === "touch") pointerStart.current = event.clientX; }}
            onPointerUp={(event) => {
              if (event.pointerType !== "touch" || pointerStart.current === null || images.length < 2) return;
              const delta = event.clientX - pointerStart.current;
              pointerStart.current = null;
              if (Math.abs(delta) < 48) return;
              if (delta > 0) previous(); else next();
            }}
          >
            <img src={active.url} alt={`${title} — ${activeIndex + 1}`} />
            {images.length > 1 && <>
              <button type="button" className={`${styles.portfolioLightboxArrow} ${styles.portfolioLightboxArrowPrevious}`} onClick={previous} aria-label={copy(language, "Foto sebelumnya", "Previous photo")}><ChevronLeft size={26} /></button>
              <button type="button" className={`${styles.portfolioLightboxArrow} ${styles.portfolioLightboxArrowNext}`} onClick={next} aria-label={copy(language, "Foto berikutnya", "Next photo")}><ChevronRight size={26} /></button>
            </>}
          </div>
          {images.length > 1 && <div className={styles.portfolioLightboxThumbs} aria-label={copy(language, "Pilih foto", "Choose photo")}>
            {images.map((image, index) => <button key={image.id} type="button" onClick={() => setActiveIndex(index)} aria-label={copy(language, `Tampilkan foto ${index + 1}`, `Show photo ${index + 1}`)} aria-current={index === activeIndex ? "true" : undefined}>
              <img src={image.url} alt="" />
            </button>)}
          </div>}
        </div>
      </div>,
      document.body,
    )}
  </>;
}
