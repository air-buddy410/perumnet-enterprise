"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Images,
  LoaderCircle,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { appPath } from "../paths";
import { type AppLanguage, localizedTimestamp } from "../i18n";

export interface ProjectDocumentAsset {
  id: string;
  projectId: string;
  projectCode?: string | null;
  projectName?: string | null;
  name: string;
  type: "image" | "file";
  mimeType: string;
  size: number;
  caption?: string | null;
  takenAt?: string | null;
  createdAt?: string | null;
  date: string;
  uploader: string;
  width?: number | null;
  height?: number | null;
  url: string;
  thumbUrl?: string | null;
  /** Kept for compatibility with the legacy project-document payload. */
  preview?: string;
}

interface DocumentGalleryProps {
  documents: ProjectDocumentAsset[];
  language: AppLanguage;
  canManage?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onUpdateCaption?: (document: ProjectDocumentAsset, caption: string) => Promise<void>;
  onDelete?: (document: ProjectDocumentAsset) => Promise<void>;
}

function formatFileSize(bytes: number, language: AppLanguage) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toLocaleString(language === "id" ? "id-ID" : "en-US", { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

function documentDate(document: ProjectDocumentAsset, language: AppLanguage) {
  if (document.takenAt) return localizedTimestamp(language, document.takenAt);
  if (document.createdAt) return localizedTimestamp(language, document.createdAt);
  return document.date;
}

function documentAlt(document: ProjectDocumentAsset, index: number, language: AppLanguage) {
  const position = language === "id" ? `Foto ${index + 1}` : `Photo ${index + 1}`;
  return document.caption ? `${position}: ${document.caption}` : `${position}: ${document.name}`;
}

export function DocumentGallery({
  documents,
  language,
  canManage = false,
  emptyTitle,
  emptyDescription,
  onUpdateCaption,
  onDelete,
}: DocumentGalleryProps) {
  const id = language === "id";
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [caption, setCaption] = useState("");
  const [savingCaption, setSavingCaption] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerStart = useRef<number | null>(null);
  const active = documents[activeIndex] ?? documents[0];
  const activeIndexRef = useRef(0);
  const documentsRef = useRef(documents);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const goToDocument = useCallback((index: number) => {
    const next = documentsRef.current[index];
    if (!next) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
    setCaption(next.caption ?? "");
  }, []);

  useEffect(() => {
    if (!open || !documents.length) return;
    const previousOverflow = document.body.style.overflow;
    const goPrevious = () => goToDocument((activeIndexRef.current - 1 + documents.length) % documents.length);
    const goNext = () => goToDocument((activeIndexRef.current + 1) % documents.length);
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (documents.length > 1 && event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (documents.length > 1 && event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
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
      triggerRef.current?.focus();
    };
  }, [documents.length, goToDocument, open]);

  function openDocument(index: number, trigger: HTMLElement) {
    goToDocument(index);
    triggerRef.current = trigger;
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  async function saveCaption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !onUpdateCaption || savingCaption) return;
    setSavingCaption(true);
    try {
      await onUpdateCaption(active, caption.trim());
    } finally {
      setSavingCaption(false);
    }
  }

  async function removeDocument() {
    if (!active || !onDelete || deleting) return;
    const confirmed = window.confirm(
      id
        ? `Hapus ${active.name} dari dokumentasi proyek?`
        : `Remove ${active.name} from project documentation?`,
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await onDelete(active);
      if (documents.length <= 1) {
        setOpen(false);
      } else {
        goToDocument(Math.min(activeIndexRef.current, documents.length - 2));
      }
    } finally {
      setDeleting(false);
    }
  }

  if (!documents.length) {
    return (
      <div className="document-gallery-empty">
        <Images size={25} />
        <strong>{emptyTitle ?? (id ? "Belum ada dokumentasi" : "No documentation yet")}</strong>
        <span>{emptyDescription ?? (id ? "Unggah foto atau file pertama untuk mulai membangun riwayat proyek." : "Upload the first photo or file to build the project history.")}</span>
      </div>
    );
  }

  return (
    <>
      <div className="document-gallery-grid">
        {documents.map((document, index) => {
          const thumbnail = document.type === "image" && document.thumbUrl
            ? appPath(document.thumbUrl)
            : null;
          const card = (
            <>
              <div className={`document-gallery-thumb ${document.type === "file" ? "file" : ""}`}>
                {thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <FileText size={28} />}
                <span className="document-gallery-type">{document.type === "image" ? "PHOTO" : (document.mimeType.split("/")[1]?.toUpperCase() || "FILE")}</span>
              </div>
              <div className="document-gallery-copy">
                <strong title={document.name}>{document.name}</strong>
                {document.caption ? <p title={document.caption}>{document.caption}</p> : <p className="muted">{id ? "Tanpa keterangan" : "No caption"}</p>}
                <small>{document.projectName ? `${document.projectCode ? `${document.projectCode} · ` : ""}${document.projectName}` : document.uploader}</small>
                <small>{document.date}</small>
              </div>
            </>
          );
          if (document.type === "image") {
            return (
              <button
                className="document-gallery-card"
                type="button"
                key={document.id}
                onClick={(event) => openDocument(index, event.currentTarget)}
                aria-label={id ? `Buka ${document.name}` : `Open ${document.name}`}
              >
                {card}
              </button>
            );
          }
          return (
            <a
              className="document-gallery-card"
              href={appPath(document.url)}
              target="_blank"
              rel="noreferrer"
              key={document.id}
            >
              {card}
              <ExternalLink className="document-gallery-open-icon" size={15} />
            </a>
          );
        })}
      </div>

      {open && active && typeof document !== "undefined" && createPortal(
        <div className="document-lightbox-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section ref={dialogRef} className="document-lightbox" role="dialog" aria-modal="true" aria-label={id ? `Dokumentasi ${active.projectName ?? "proyek"}` : `Documentation for ${active.projectName ?? "project"}`}>
            <header className="document-lightbox-header">
              <div>
                <span className="eyebrow">{active.projectCode ?? (id ? "DOKUMENTASI PROYEK" : "PROJECT DOCUMENTATION")}</span>
                <h2>{active.caption || active.name}</h2>
                <small>{activeIndex + 1} / {documents.length} · {documentDate(active, language)}</small>
              </div>
              <button ref={closeRef} className="icon-button" type="button" onClick={close} aria-label={id ? "Tutup dokumentasi" : "Close documentation"}><X size={19} /></button>
            </header>
            <div
              className="document-lightbox-stage"
              onPointerDown={(event) => { if (event.pointerType === "touch") pointerStart.current = event.clientX; }}
              onPointerUp={(event) => {
                if (event.pointerType !== "touch" || pointerStart.current === null || documents.length < 2) return;
                const delta = event.clientX - pointerStart.current;
                pointerStart.current = null;
                if (Math.abs(delta) < 48) return;
                goToDocument(delta > 0 ? (activeIndex - 1 + documents.length) % documents.length : (activeIndex + 1) % documents.length);
              }}
            >
              {active.type === "image" ? (
                <img src={appPath(active.url)} alt={documentAlt(active, activeIndex, language)} />
              ) : (
                <div className="document-lightbox-file">
                  <FileText size={52} />
                  <strong>{active.name}</strong>
                  <span>{formatFileSize(active.size, language)}</span>
                  <a className="button primary" href={appPath(active.url)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> {id ? "Buka file" : "Open file"}</a>
                </div>
              )}
              {documents.length > 1 && <>
                <button className="document-lightbox-arrow previous" type="button" onClick={() => goToDocument((activeIndex - 1 + documents.length) % documents.length)} aria-label={id ? "Dokumentasi sebelumnya" : "Previous document"}><ChevronLeft size={25} /></button>
                <button className="document-lightbox-arrow next" type="button" onClick={() => goToDocument((activeIndex + 1) % documents.length)} aria-label={id ? "Dokumentasi berikutnya" : "Next document"}><ChevronRight size={25} /></button>
              </>}
            </div>
            <footer className="document-lightbox-footer">
              <div className="document-lightbox-meta">
                <span>{active.uploader} · {formatFileSize(active.size, language)}</span>
                {active.projectName ? <span>{active.projectCode ? `${active.projectCode} · ` : ""}{active.projectName}</span> : null}
              </div>
              {canManage && onUpdateCaption ? (
                <form className="document-caption-editor" onSubmit={saveCaption}>
                  <label htmlFor={`document-caption-${active.id}`}>{id ? "Keterangan" : "Caption"}</label>
                  <div>
                    <input id={`document-caption-${active.id}`} maxLength={500} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder={id ? "Contoh: Penarikan kabel lantai 2" : "Example: Cable installation, second floor"} />
                    <button className="button secondary small" type="submit" disabled={savingCaption || caption.trim() === (active.caption ?? "").trim()}>{savingCaption ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} {id ? "Simpan" : "Save"}</button>
                  </div>
                </form>
              ) : (
                <p className="document-lightbox-caption">{active.caption || (id ? "Belum ada keterangan." : "No caption yet.")}</p>
              )}
              <div className="document-lightbox-actions">
                <a className="button secondary small" href={appPath(active.url)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {id ? "Buka asli" : "Open original"}</a>
                {canManage && onDelete ? <button className="button secondary small danger-text" type="button" onClick={() => void removeDocument()} disabled={deleting}>{deleting ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} {id ? "Hapus" : "Delete"}</button> : null}
              </div>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
