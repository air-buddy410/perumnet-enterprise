"use client";

import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileCheck2,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import type { CommercialPackage, ViewKey } from "../data";
import { localizedLabel, type AppLanguage } from "../i18n";
import { CommercialPackageSwitcher } from "./commercial-package-switcher";
import { DocumentPreviewModal } from "./document-preview-modal";

interface ValidationItem {
  id: string;
  boqItemId?: string;
  category: "Perangkat" | "Material";
  description: string;
  quantity: number;
  unit: string;
  checked: boolean;
  notes: string;
}

interface ProjectValidation {
  id: string | null;
  number: string | null;
  projectId: string;
  packageId?: string | null;
  packageTitle?: string | null;
  deliveryCycle?: number;
  project?: string;
  client?: string;
  location?: string;
  status: "Draft" | "Completed";
  notes: string;
  validatedBy?: string;
  completedAt?: string | null;
  items: ValidationItem[];
  checkedCount: number;
  totalCount: number;
}

interface ValidationViewProps {
  projectId: string;
  language: AppLanguage;
  canManage: boolean;
  notify: (message: string) => void;
  navigate: (view: ViewKey) => void;
}

export function ValidationView({
  projectId,
  language,
  canManage,
  notify,
  navigate,
}: ValidationViewProps) {
  const id = language === "id";
  const [validation, setValidation] = useState<ProjectValidation | null>(null);
  const [items, setItems] = useState<ValidationItem[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packageId, setPackageId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectPackage = useCallback((nextPackageId: string, packages: CommercialPackage[]) => {
    void packages;
    setPackageId(nextPackageId);
  }, []);

  // When the workspace project changes, drop the previous project's package
  // selection during render so the bootstrap effect below re-resolves it.
  const [packageProjectId, setPackageProjectId] = useState(projectId);
  if (packageProjectId !== projectId) {
    setPackageProjectId(projectId);
    setPackageId("");
    setLoading(true);
  }

  // Resolve the initial commercial package here instead of waiting for the
  // CommercialPackageSwitcher: the switcher only mounts once loading is false,
  // but loading could only become false after the switcher picked a package —
  // a deadlock that left the view stuck on "Memuat form validasi...".
  useEffect(() => {
    let active = true;
    api<CommercialPackage[]>(`/api/projects/${encodeURIComponent(projectId)}/packages`)
      .then((packages) => {
        if (!active) return;
        const remembered = window.localStorage.getItem(`commercial-package:${projectId}`);
        const next = packages.find((item) => item.id === remembered)?.id ?? packages[0]?.id ?? "";
        if (next) setPackageId((current) => current || next);
        else setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        notify(messageOf(error, language));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [language, notify, projectId]);

  const load = useCallback(async () => {
    if (!packageId) return;
    try {
      setLoading(true);
      const data = await api<ProjectValidation>(
        `/api/validations?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`,
        canManage ? { method: "POST" } : undefined,
      );
      setValidation(data);
      setItems(data.items);
      setNotes(data.notes);
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setLoading(false);
    }
  }, [canManage, language, notify, packageId, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const checkedCount = items.filter((item) => item.checked).length;
  const allChecked = items.length > 0 && checkedCount === items.length;
  const progress = items.length ? Math.round((checkedCount / items.length) * 100) : 0;
  const completed = validation?.status === "Completed";

  const grouped = useMemo(
    () => ["Perangkat", "Material"].map((category) => ({
      category,
      items: items.filter((item) => item.category === category),
    })).filter((group) => group.items.length),
    [items],
  );

  function updateItem(itemId: string, values: Partial<ValidationItem>) {
    if (!canManage || completed) return;
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...values } : item));
  }

  async function save(status: "Draft" | "Completed") {
    if (!validation?.id) return;
    if (status === "Completed" && !allChecked) {
      notify(id ? "Centang seluruh Perangkat dan Material terlebih dahulu." : "Check every Device and Material first.");
      return;
    }
    try {
      setSaving(true);
      const updated = await api<ProjectValidation>(`/api/validations/${validation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, notes, items }),
      });
      setValidation(updated);
      setItems(updated.items);
      notify(status === "Completed"
        ? id ? "Validasi selesai. BAST sekarang dapat diterbitkan." : "Validation completed. The handover certificate can now be issued."
        : id ? "Draft validasi berhasil disimpan." : "Validation draft saved.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    if (!validation?.id) return;
    try {
      await downloadApiFile(
        `/api/validations/${validation.id}/pdf`,
        `${(validation.number ?? "VALIDATION").replaceAll("/", "-")}.pdf`,
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  if (loading) {
    return <section className="panel empty-state"><p>{id ? "Memuat form validasi..." : "Loading validation form..."}</p></section>;
  }

  if (!packageId) {
    return (
      <section className="panel empty-state">
        <p>{id
          ? "Paket komersial proyek tidak dapat dimuat. Muat ulang halaman atau periksa koneksi Anda."
          : "The project's commercial packages could not be loaded. Reload the page or check your connection."}</p>
      </section>
    );
  }

  return (
    <div className="page-stack validation-view" data-testid="validation-view">
      <section className="project-hero validation-hero">
        <div className="project-hero-main">
          <div className="project-hero-badges">
            <span className={`status-badge ${completed ? "success" : "warning"}`}><span className="badge-dot" /> {completed ? id ? "Selesai" : "Completed" : "Draft"}</span>
            <span className="project-code">{validation?.number ?? (id ? "Belum diterbitkan" : "Not issued")}</span>
          </div>
          <h1>{id ? "Validasi Perangkat & Material" : "Device & Material Validation"}</h1>
          <p>{validation?.project} · {validation?.client}</p>
        </div>
        <div className="project-hero-progress">
          <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{progress}%</strong><small>{id ? "divalidasi" : "validated"}</small></span>
          </div>
          <div><strong>{checkedCount} / {items.length} {id ? "item" : "items"}</strong><span>{validation?.location}</span></div>
        </div>
        <CommercialPackageSwitcher projectId={projectId} language={language} canManage={canManage} value={packageId} onChange={selectPackage} notify={notify} />
      </section>

      <section className={`validation-gate ${completed ? "complete" : "pending"}`}>
        {completed ? <CheckCircle2 size={22} /> : <ShieldCheck size={22} />}
        <div>
          <strong>{completed
            ? id ? "Gerbang BAST terbuka" : "Handover gate unlocked"
            : id ? "Validasi wajib sebelum BAST" : "Validation required before handover"}</strong>
          <span>{completed
            ? id ? "Semua perangkat dan material telah diperiksa." : "All devices and materials have been inspected."
            : id ? "BAST hanya dapat dibuat setelah seluruh checklist selesai." : "The handover certificate can only be created after the checklist is complete."}</span>
        </div>
        {completed && <button className="button primary" type="button" onClick={() => navigate("bast")}>{id ? "Buka BAST" : "Open Handover"}</button>}
      </section>

      <section className="panel validation-panel">
        <div className="panel-head">
          <div><span className="eyebrow">{id ? "CHECKLIST PENGUJIAN" : "TEST CHECKLIST"}</span><h2>{id ? "Item dari BoQ" : "Items from BoQ"}</h2></div>
          <span className="status-badge info"><ClipboardCheck size={14} /> {checkedCount}/{items.length}</span>
        </div>
        {!items.length ? (
          <div className="empty-state compact"><FileCheck2 size={28} /><p>{id ? "BoQ belum memiliki kategori Perangkat atau Material." : "The BoQ has no Device or Material items."}</p></div>
        ) : grouped.map((group) => (
          <div className="validation-group" key={group.category}>
            <h3>{language === "en" && group.category === "Perangkat" ? "Devices" : group.category}</h3>
            <div className="validation-list">
              {group.items.map((item) => (
                <article className={`validation-row ${item.checked ? "checked" : ""}`} key={item.id}>
                  <label className="validation-check">
                    <input type="checkbox" checked={item.checked} disabled={!canManage || completed} onChange={(event) => updateItem(item.id, { checked: event.target.checked })} />
                    <span>{item.checked && <Check size={16} />}</span>
                  </label>
                  <div className="validation-item-copy"><strong>{item.description}</strong><span>{item.quantity} {localizedLabel(language, item.unit)} · {localizedLabel(language, item.category)}</span></div>
                  <input aria-label={id ? `Catatan ${item.description}` : `Notes for ${item.description}`} disabled={!canManage || completed} value={item.notes} onChange={(event) => updateItem(item.id, { notes: event.target.value })} placeholder={id ? "Catatan pengujian (opsional)" : "Test notes (optional)"} />
                </article>
              ))}
            </div>
          </div>
        ))}
        <label className="field full validation-notes"><span>{id ? "Catatan umum validasi" : "General validation notes"}</span><textarea rows={3} disabled={!canManage || completed} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={id ? "Kondisi lokasi, hasil pengujian, atau tindak lanjut..." : "Site condition, test results, or follow-up..."} /></label>
        <div className="validation-actions">
          {canManage && !completed && <button className="button secondary" disabled={saving} type="button" onClick={() => save("Draft")}><Save size={16} /> {id ? "Simpan draft" : "Save draft"}</button>}
          {canManage && !completed && <button className="button primary" disabled={saving || !allChecked} type="button" onClick={() => save("Completed")}><CheckCircle2 size={16} /> {id ? "Selesaikan validasi" : "Complete validation"}</button>}
          {validation?.id && <button className="icon-button" type="button" aria-label={id ? "Pratinjau validasi" : "Preview validation"} onClick={() => setPreviewOpen(true)}><Eye size={17} /></button>}
          {validation?.id && <button className="button secondary" type="button" onClick={downloadPdf}><Download size={16} /> {id ? "Unduh PDF" : "Download PDF"}</button>}
        </div>
      </section>
      <DocumentPreviewModal open={previewOpen} url={validation?.id ? `/api/validations/${validation.id}/pdf` : ""} title={validation?.number ?? (id ? "Form Validasi" : "Validation Form")} filename={`${(validation?.number ?? "VALIDATION").replaceAll("/", "-")}.pdf`} onClose={() => setPreviewOpen(false)} />
    </div>
  );
}
