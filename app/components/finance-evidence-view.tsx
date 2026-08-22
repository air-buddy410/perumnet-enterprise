"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  Filter,
  LoaderCircle,
  Paperclip,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, messageOf } from "../api-client";
import { formatCurrency, Project } from "../data";
import { type AppLanguage, localizedDate, localizedTimestamp } from "../i18n";
import { appPath } from "../paths";
import {
  financeEvidenceKindLabels,
  financeEvidenceKinds,
  type FinanceEvidenceKind,
} from "@/shared/finance-evidence";

interface FinanceEvidenceViewProps {
  language: AppLanguage;
  projects: Project[];
  initialProjectId?: string;
  initialQuery?: string;
  initialKind?: FinanceEvidenceKind;
  canManageEvidenceKind: (kind: FinanceEvidenceKind) => boolean;
  notify: (message: string) => void;
}

interface EvidenceAttachment {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  note: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  url: string;
}

interface EvidenceItem {
  kind: FinanceEvidenceKind;
  id: string;
  evidenceId: string;
  date: string;
  amount: number | null;
  direction: "Pemasukan" | "Pengeluaran" | null;
  reversal: boolean;
  status: string | null;
  project: { id: string; code: string; name: string } | null;
  title: string;
  counterparty: string | null;
  reference: string | null;
  document: { kind: string; id: string; number: string | null; pdfUrl: string | null } | null;
  proof: {
    hasProof: boolean;
    legacy: Array<{ name: string; mimeType: string; url: string }>;
    attachments: EvidenceAttachment[];
  };
  createdAt: string;
}

interface EvidenceSummary {
  byKind: Record<string, { total: number; withoutProof: number }>;
  withoutProof: number;
  kinds: FinanceEvidenceKind[];
}

interface EvidenceResponse {
  items: EvidenceItem[];
  page: number;
  pageSize: number;
  total: number;
  summary: EvidenceSummary;
}

function fileSize(bytes: number, language: AppLanguage) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toLocaleString(language === "id" ? "id-ID" : "en-US", { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

function kindLabel(language: AppLanguage, kind: FinanceEvidenceKind) {
  return financeEvidenceKindLabels[kind][language];
}

export function FinanceEvidenceView({
  language,
  projects,
  initialProjectId,
  initialQuery,
  initialKind,
  canManageEvidenceKind,
  notify,
}: FinanceEvidenceViewProps) {
  const id = language === "id";
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [summary, setSummary] = useState<EvidenceSummary>({ byKind: {}, withoutProof: 0, kinds: [] });
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState(initialQuery ?? "");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [selectedKinds, setSelectedKinds] = useState<FinanceEvidenceKind[]>(initialKind ? [initialKind] : []);
  const [direction, setDirection] = useState("");
  const [proof, setProof] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const [attachmentTarget, setAttachmentTarget] = useState<EvidenceItem | null>(null);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentNote, setAttachmentNote] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) params.set("q", query);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (projectId) params.set("projectId", projectId);
      if (selectedKinds.length) params.set("kind", selectedKinds.join(","));
      if (direction) params.set("direction", direction);
      if (proof) params.set("proof", proof);
      const response = await api<EvidenceResponse>(`/api/finance/evidence?${params.toString()}`);
      setItems(response.items ?? []);
      setTotal(response.total ?? 0);
      setSummary({ byKind: response.summary?.byKind ?? {}, withoutProof: response.summary?.withoutProof ?? 0, kinds: response.summary?.kinds ?? [] });
      setSelectedKinds((current) => {
        const next = current.filter((kind) => (response.summary?.kinds ?? []).includes(kind));
        return next.length === current.length && next.every((kind, index) => kind === current[index]) ? current : next;
      });
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setLoading(false);
    }
  }, [direction, from, language, notify, page, projectId, proof, query, selectedKinds, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEvidence(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEvidence]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  function toggleKind(kind: FinanceEvidenceKind) {
    setPage(1);
    setSelectedKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
  }

  function clearFilters() {
    setQueryInput("");
    setQuery("");
    setFrom("");
    setTo("");
    setProjectId("");
    setSelectedKinds([]);
    setDirection("");
    setProof("");
    setPage(1);
  }

  function openAttachmentDialog(item: EvidenceItem) {
    setAttachmentTarget(item);
    setAttachmentFiles([]);
    setAttachmentNote("");
  }

  async function uploadAttachments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!attachmentTarget || !attachmentFiles.length || attachmentBusy) return;
    if (attachmentFiles.length > 5) {
      notify(id ? "Maksimal 5 file dapat diunggah sekaligus." : "You can upload at most 5 files at once.");
      return;
    }
    setAttachmentBusy(true);
    try {
      const form = new FormData();
      attachmentFiles.forEach((file) => form.append("files", file));
      if (attachmentNote.trim()) form.set("note", attachmentNote.trim());
      await api<{ items: EvidenceAttachment[] }>(`/api/finance/evidence/${attachmentTarget.kind}/${attachmentTarget.evidenceId}/attachments`, { method: "POST", body: form });
      setAttachmentTarget(null);
      setAttachmentFiles([]);
      setAttachmentNote("");
      await loadEvidence();
      notify(id ? "Lampiran bukti berhasil ditambahkan." : "Evidence attachments uploaded.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function deleteAttachment(attachment: EvidenceAttachment) {
    if (!window.confirm(id ? `Hapus lampiran ${attachment.filename}?` : `Delete attachment ${attachment.filename}?`)) return;
    try {
      await api(`/api/finance/evidence/attachments/${attachment.id}`, { method: "DELETE" });
      await loadEvidence();
      notify(id ? "Lampiran dihapus." : "Attachment deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  const availableKinds = useMemo(() => financeEvidenceKinds.filter((kind) => summary.kinds.includes(kind)), [summary.kinds]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total ? (page - 1) * pageSize + 1 : 0;
  const lastItem = total ? Math.min(page * pageSize, total) : 0;

  return (
    <section className="panel finance-evidence-archive" data-testid="finance-evidence-archive">
      <div className="panel-head finance-evidence-head">
        <div>
          <span className="eyebrow">{id ? "ARSIP KEUANGAN" : "FINANCE ARCHIVE"}</span>
          <h2>{id ? "Arsip Bukti" : "Evidence archive"}</h2>
          <p>{id ? "Satu tempat untuk membuka bukti pembayaran, dokumen kontrak, dan lampiran audit." : "One place to open payment proofs, contract evidence, and audit attachments."}</p>
        </div>
        <div className="finance-evidence-alert"><AlertCircle size={16} /><strong>{summary.withoutProof}</strong><span>{id ? "belum punya bukti" : "without proof"}</span></div>
      </div>

      <div className="finance-evidence-summary">
        {availableKinds.map((kind) => {
          const stat = summary.byKind[kind] ?? { total: 0, withoutProof: 0 };
          return <button key={kind} className={selectedKinds.includes(kind) ? "active" : ""} type="button" onClick={() => toggleKind(kind)}><span>{kindLabel(language, kind)}</span><strong>{stat.total}</strong><small>{stat.withoutProof ? `${stat.withoutProof} ${id ? "tanpa bukti" : "without proof"}` : (id ? "lengkap" : "complete")}</small></button>;
        })}
      </div>

      <div className="finance-evidence-filters">
        <form className="evidence-search" onSubmit={submitSearch}><Search size={16} /><input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={id ? "Cari judul, pihak, referensi, nomor, atau nominal..." : "Search title, party, reference, number, or amount..."} />{queryInput ? <button type="button" aria-label={id ? "Hapus pencarian" : "Clear search"} onClick={() => { setQueryInput(""); setQuery(""); setPage(1); }}><X size={14} /></button> : null}</form>
        <button className={`button subtle small ${filterOpen ? "active" : ""}`} type="button" onClick={() => setFilterOpen((value) => !value)} aria-expanded={filterOpen}><Filter size={15} /> {id ? "Filter" : "Filters"}</button>
        {(query || from || to || projectId || selectedKinds.length || direction || proof) ? <button className="button subtle small" type="button" onClick={clearFilters}>{id ? "Bersihkan" : "Clear"}</button> : null}
      </div>
      {filterOpen ? <div className="finance-evidence-filter-panel">
        <label className="field"><span>{id ? "Proyek" : "Project"}</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setPage(1); }}><option value="">{id ? "Semua proyek" : "All projects"}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label>
        <label className="field"><span>{id ? "Dari" : "From"}</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
        <label className="field"><span>{id ? "Sampai" : "To"}</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        <label className="field"><span>{id ? "Arah" : "Direction"}</span><select value={direction} onChange={(event) => { setDirection(event.target.value); setPage(1); }}><option value="">{id ? "Semua arah" : "All directions"}</option><option value="Pemasukan">{id ? "Pemasukan" : "Income"}</option><option value="Pengeluaran">{id ? "Pengeluaran" : "Expense"}</option></select></label>
        <label className="field"><span>{id ? "Bukti" : "Proof"}</span><select value={proof} onChange={(event) => { setProof(event.target.value); setPage(1); }}><option value="">{id ? "Semua" : "All"}</option><option value="with">{id ? "Ada bukti" : "With proof"}</option><option value="without">{id ? "Tanpa bukti" : "Without proof"}</option></select></label>
      </div> : null}

      <div className="finance-evidence-list-wrap">
        <div className="finance-evidence-list-head"><span>{id ? "Bukti & transaksi" : "Evidence & transaction"}</span><span>{loading ? "…" : `${firstItem}–${lastItem} / ${total}`}</span></div>
        {loading ? <div className="evidence-loading"><LoaderCircle className="spin" size={22} /> {id ? "Memuat arsip bukti..." : "Loading evidence archive..."}</div> : items.length ? <div className="finance-evidence-list">
          {items.map((item) => {
            const canAttach = canManageEvidenceKind(item.kind);
            const hasProof = item.proof.hasProof;
            return <article className={`finance-evidence-row ${item.reversal ? "is-reversal" : ""}`} key={`${item.kind}-${item.id}`}>
              <div className="finance-evidence-main">
                <div className="finance-evidence-title"><span className={`evidence-kind-dot ${hasProof ? "complete" : item.reversal ? "reversal" : "missing"}`} /><div><strong>{item.title}</strong><small>{kindLabel(language, item.kind)}{item.reference ? ` · ${item.reference}` : ""}</small></div></div>
                <div className="finance-evidence-meta"><span>{localizedDate(language, item.date)}</span><span>{item.project ? `${item.project.code} · ${item.project.name}` : (id ? "Tingkat perusahaan" : "Company level")}</span><span>{item.counterparty || "—"}</span></div>
              </div>
              <div className="finance-evidence-amount"><strong>{item.amount === null ? "—" : `${item.direction === "Pengeluaran" ? "−" : item.direction === "Pemasukan" ? "+" : ""}${formatCurrency(item.amount, language)}`}</strong><small>{item.status || (id ? "Dokumen kontrak" : "Contract document")}</small></div>
              <div className="finance-evidence-proof">
                <div className="evidence-proof-status">{item.reversal ? <span className="status-badge neutral">{id ? "Pembatalan" : "Reversal"}</span> : hasProof ? <span className="status-badge success"><FileCheck2 size={12} /> {id ? "Ada bukti" : "Proof attached"}</span> : <span className="status-badge warning"><AlertCircle size={12} /> {id ? "Tanpa bukti" : "Missing proof"}</span>}</div>
                <div className="evidence-proof-links">{item.proof.legacy.map((proofItem) => <a key={`${proofItem.name}-${proofItem.url}`} href={appPath(proofItem.url)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {proofItem.name}</a>)}{item.proof.attachments.map((attachment) => <span className="evidence-attachment" key={attachment.id}><a href={appPath(attachment.url)} target="_blank" rel="noreferrer"><Paperclip size={13} /> {attachment.filename}</a><small>{fileSize(attachment.byteSize, language)} · {localizedTimestamp(language, attachment.createdAt)}</small>{canAttach ? <button type="button" onClick={() => void deleteAttachment(attachment)} aria-label={id ? `Hapus ${attachment.filename}` : `Delete ${attachment.filename}`}><Trash2 size={12} /></button> : null}</span>)}</div>
                {!item.proof.legacy.length && !item.proof.attachments.length ? <small className="muted">{id ? "Belum ada file yang terhubung." : "No file linked yet."}</small> : null}
              </div>
              <div className="finance-evidence-actions">{item.document?.pdfUrl ? <a className="button subtle small" href={appPath(item.document.pdfUrl)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> PDF</a> : null}{canAttach ? <button className="button secondary small" type="button" onClick={() => openAttachmentDialog(item)}><FilePlus2 size={14} /> {id ? "Lampirkan" : "Attach"}</button> : null}</div>
            </article>;
          })}
        </div> : <div className="evidence-empty"><FileCheck2 size={26} /><strong>{id ? "Tidak ada arsip yang cocok" : "No matching evidence"}</strong><span>{id ? "Coba ubah pencarian atau filter yang dipilih." : "Try changing the search or filters."}</span></div>}
      </div>
      <div className="finance-evidence-pagination"><span>{id ? `Halaman ${page} dari ${pageCount}` : `Page ${page} of ${pageCount}`}</span><div><button className="button secondary small" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} /> {id ? "Sebelumnya" : "Previous"}</button><button className="button secondary small" type="button" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>{id ? "Berikutnya" : "Next"} <ChevronRight size={14} /></button></div></div>

      {attachmentTarget ? <div className="modal-backdrop" role="presentation" onMouseDown={() => !attachmentBusy && setAttachmentTarget(null)}><section className="modal-card evidence-attachment-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-attachment-title" onMouseDown={(event) => event.stopPropagation()}><header className="modal-head"><div><span className="eyebrow">{kindLabel(language, attachmentTarget.kind)}</span><h2 id="evidence-attachment-title">{id ? "Lampirkan bukti" : "Attach evidence"}</h2><p>{attachmentTarget.title}</p></div><button className="icon-button" type="button" onClick={() => setAttachmentTarget(null)} disabled={attachmentBusy} aria-label={id ? "Tutup" : "Close"}><X size={18} /></button></header><form className="form-grid" onSubmit={uploadAttachments}><label className="field full"><span>{id ? "File bukti (maksimal 5)" : "Evidence files (up to 5)"}</span><input ref={attachmentInputRef} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setAttachmentFiles(Array.from(event.target.files ?? []))} disabled={attachmentBusy} /><small>{attachmentFiles.length ? `${attachmentFiles.length} ${id ? "file dipilih" : "files selected"}` : (id ? "PDF, PNG, JPEG, atau WebP · maksimal 10 MB per file" : "PDF, PNG, JPEG, or WebP · up to 10 MB per file")}</small></label><label className="field full"><span>{id ? "Catatan (opsional)" : "Note (optional)"}</span><textarea maxLength={300} rows={3} value={attachmentNote} onChange={(event) => setAttachmentNote(event.target.value)} placeholder={id ? "Contoh: Bukti transfer termin pertama" : "Example: First installment transfer proof"} disabled={attachmentBusy} /></label><div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setAttachmentTarget(null)} disabled={attachmentBusy}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit" disabled={attachmentBusy || !attachmentFiles.length}>{attachmentBusy ? <LoaderCircle className="spin" size={15} /> : <FilePlus2 size={15} />} {id ? "Simpan lampiran" : "Upload attachments"}</button></div></form></section></div> : null}
    </section>
  );
}
