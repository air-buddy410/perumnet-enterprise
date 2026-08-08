"use client";

import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadApiFile } from "../api-client";

interface DocumentPreviewModalProps {
  open: boolean;
  url: string;
  title: string;
  filename: string;
  onClose: () => void;
}

export function DocumentPreviewModal({
  open,
  url,
  title,
  filename,
  onClose,
}: DocumentPreviewModalProps) {
  const [loaded, setLoaded] = useState({ key: "", objectUrl: "", error: "" });
  const requestKey = open && url ? url : "";
  const objectUrl = loaded.key === requestKey ? loaded.objectUrl : "";
  const error = loaded.key === requestKey ? loaded.error : "";

  useEffect(() => {
    if (!open || !url) return;
    const controller = new AbortController();
    let createdUrl = "";
    fetch(url, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error?.message ?? payload?.message ?? "Dokumen tidak dapat dimuat.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        createdUrl = URL.createObjectURL(blob);
        setLoaded({ key: url, objectUrl: createdUrl, error: "" });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setLoaded({
            key: url,
            objectUrl: "",
            error: reason instanceof Error ? reason.message : "Dokumen tidak dapat dimuat.",
          });
        }
      });
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    document.documentElement.classList.add("document-preview-open");
    return () => {
      document.removeEventListener("keydown", close);
      document.documentElement.classList.remove("document-preview-open");
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="document-preview-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="document-preview-shell">
        <header className="document-preview-header">
          <div>
            <span className="eyebrow">PRATINJAU DOKUMEN</span>
            <h2>{title}</h2>
          </div>
          <div className="document-preview-actions">
            {objectUrl && (
              <a className="button secondary" href={objectUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> Buka tab baru
              </a>
            )}
            <button className="button secondary" type="button" onClick={() => void downloadApiFile(url, filename)}>
              <Download size={16} /> Unduh
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Tutup pratinjau">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="document-preview-body">
          {!objectUrl && !error && <div className="document-preview-state"><Loader2 className="spin" size={28} /> Memuat dokumen…</div>}
          {error && <div className="document-preview-state error-state">{error}</div>}
          {objectUrl && (
            // An <iframe> is deliberate here: Chrome's <object type="application/pdf">
            // intermittently falls back to its unsupported-content children on
            // re-render or large blobs, which surfaced as a bogus "browser does not
            // support PDF" message. The iframe never misfires; genuine load failures
            // are already covered by the fetch error state above.
            <iframe src={objectUrl} title={title} className="document-preview-frame" />
          )}
        </div>
      </div>
    </div>
  );
}
