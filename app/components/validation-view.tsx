"use client";

import {
  Check,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  CircleDashed,
  Download,
  Eye,
  FileCheck2,
  ListFilter,
  LoaderCircle,
  NotebookPen,
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

const VALIDATION_CATEGORIES: ValidationItem["category"][] = ["Perangkat", "Material"];

function readableItemDescription(description: string) {
  const parts = description.split(/\s+—\s+|\s+-\s+/).map((part) => part.trim());
  return parts.length === 2 && parts[0] === parts[1] ? parts[0] : description;
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
  const [itemFilter, setItemFilter] = useState<"all" | "open" | "checked">("all");
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
  const remainingCount = Math.max(0, items.length - checkedCount);
  const completed = validation?.status === "Completed";

  const categoryStats = useMemo(
    () => VALIDATION_CATEGORIES.map((category) => {
      const categoryItems = items.filter((item) => item.category === category);
      return {
        category,
        allItems: categoryItems,
        total: categoryItems.length,
        checked: categoryItems.filter((item) => item.checked).length,
      };
    }).filter((group) => group.total),
    [items],
  );

  const grouped = useMemo(() => categoryStats.map((group) => ({
    ...group,
    items: group.allItems.filter((item) => itemFilter === "all" || (itemFilter === "checked" ? item.checked : !item.checked)),
  })).filter((group) => group.items.length), [categoryStats, itemFilter]);

  function updateItem(itemId: string, values: Partial<ValidationItem>) {
    if (!canManage || completed) return;
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...values } : item));
  }

  function setAllItemsChecked(checked: boolean) {
    if (!canManage || completed) return;
    setItems((current) => current.map((item) => ({ ...item, checked })));
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

  const filterOptions = [
    { key: "all" as const, label: id ? "Semua" : "All", count: items.length },
    { key: "open" as const, label: id ? "Belum dicek" : "Open", count: remainingCount },
    { key: "checked" as const, label: id ? "Selesai" : "Checked", count: checkedCount },
  ];

  return (
    <div className="page-stack validation-view" data-testid="validation-view">
      <section className="project-hero validation-hero">
        <div className="project-hero-main validation-hero-main">
          <div className="project-hero-badges">
            <span className={`status-badge ${completed ? "success" : "warning"}`}><span className="badge-dot" /> {completed ? id ? "Selesai" : "Completed" : "Draft"}</span>
            <span className="project-code">{validation?.number ?? (id ? "Belum diterbitkan" : "Not issued")}</span>
          </div>
          <h1>{id ? "Validasi Perangkat & Material" : "Device & Material Validation"}</h1>
          <p>{validation?.project} · {validation?.client}</p>
          <div className="validation-context">
            <span><ClipboardCheck size={14} /> {validation?.location || (id ? "Lokasi belum diisi" : "Location not set")}</span>
            <span><FileCheck2 size={14} /> {items.length} {id ? "item dari BoQ" : "BoQ items"}</span>
          </div>
        </div>
        <div className="validation-progress-card">
          <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{progress}%</strong><small>{id ? "divalidasi" : "validated"}</small></span>
          </div>
          <div className="validation-progress-copy">
            <strong>{checkedCount} / {items.length} {id ? "item selesai" : "items complete"}</strong>
            <span>{remainingCount ? `${remainingCount} ${id ? "item masih perlu dicek" : "items still need review"}` : (id ? "Semua item sudah dicek" : "Every item is checked")}</span>
            <div className="validation-progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          </div>
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

      <section className="validation-control-bar" aria-label={id ? "Kontrol checklist" : "Checklist controls"}>
        <div className="validation-control-summary">
          <span className="validation-control-icon"><ListFilter size={18} /></span>
          <div><strong>{id ? "Checklist lapangan" : "Field checklist"}</strong><span>{remainingCount ? `${remainingCount} ${id ? "item perlu perhatian" : "items need attention"}` : (id ? "Semua item siap disimpan" : "All items are ready to save")}</span></div>
        </div>
        <div className="validation-filter" role="group" aria-label={id ? "Saring item checklist" : "Filter checklist items"}>
          {filterOptions.map((filter) => (
            <button key={filter.key} type="button" className={itemFilter === filter.key ? "active" : ""} aria-pressed={itemFilter === filter.key} onClick={() => setItemFilter(filter.key)}>
              <span>{filter.label}</span><strong>{filter.count}</strong>
            </button>
          ))}
        </div>
        {canManage && !completed && (
          <div className="validation-bulk-actions">
            <button className="button subtle small" type="button" disabled={saving || !items.length} onClick={() => setAllItemsChecked(!allChecked)}>
              {allChecked ? <CircleDashed size={15} /> : <CheckCheck size={15} />} {allChecked ? (id ? "Kosongkan semua" : "Clear all") : (id ? "Tandai semua" : "Check all")}
            </button>
            <button className="button secondary small" disabled={saving} type="button" onClick={() => save("Draft")}>
              {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} {id ? "Simpan draft" : "Save draft"}
            </button>
            <button className="button primary small" disabled={saving || !allChecked} type="button" onClick={() => save("Completed")}>
              <CheckCircle2 size={15} /> {id ? "Selesaikan" : "Complete"}
            </button>
          </div>
        )}
      </section>

      <section className="panel validation-panel">
        <div className="panel-head validation-panel-head">
          <div><span className="eyebrow">{id ? "CHECKLIST PENGUJIAN" : "TEST CHECKLIST"}</span><h2>{id ? "Periksa perangkat & material" : "Inspect devices & materials"}<small>{id ? "Centang setelah item diuji di lapangan. Catatan bisa diisi per item." : "Check each item after on-site inspection. Add a note when useful."}</small></h2></div>
          <div className="validation-panel-count"><ClipboardCheck size={16} /><strong>{checkedCount}/{items.length}</strong><span>{id ? "selesai" : "complete"}</span></div>
        </div>
        {!items.length ? (
          <div className="empty-state compact"><FileCheck2 size={28} /><p>{id ? "BoQ belum memiliki kategori Perangkat atau Material." : "The BoQ has no Device or Material items."}</p></div>
        ) : !grouped.length ? (
          <div className="validation-filter-empty"><CircleDashed size={25} /><strong>{itemFilter === "checked" ? (id ? "Belum ada item selesai" : "No checked items yet") : (id ? "Semua item sudah selesai" : "All items are complete")}</strong><span>{id ? "Pilih filter lain untuk melihat item yang tersedia." : "Choose another filter to see the available items."}</span></div>
        ) : grouped.map((group) => (
          <section className="validation-group" key={group.category}>
            <div className="validation-group-head">
              <div><span className="validation-group-kicker">{group.category === "Perangkat" ? (id ? "PERANGKAT" : "DEVICES") : (id ? "MATERIAL" : "MATERIALS")}</span><h3>{group.category === "Perangkat" ? (id ? "Perangkat" : "Devices") : (id ? "Material" : "Materials")}</h3></div>
              <span className="validation-group-progress"><strong>{group.checked}/{group.total}</strong> {id ? "selesai" : "complete"}</span>
            </div>
            <div className="validation-list">
              {group.items.map((item) => (
                <article className={`validation-row ${item.checked ? "checked" : ""}`} key={item.id}>
                  <label className="validation-check" aria-label={id ? `Tandai ${readableItemDescription(item.description)}` : `Mark ${readableItemDescription(item.description)}`}>
                    <input type="checkbox" checked={item.checked} disabled={!canManage || completed} onChange={(event) => updateItem(item.id, { checked: event.target.checked })} />
                    <span>{item.checked && <Check size={16} />}</span>
                  </label>
                  <div className="validation-item-copy"><div className="validation-item-title"><strong>{readableItemDescription(item.description)}</strong>{item.checked && <span className="validation-item-status"><Check size={12} /> {id ? "Sudah dicek" : "Checked"}</span>}</div><span className="validation-item-meta">{item.quantity} {localizedLabel(language, item.unit)}</span></div>
                  <label className="validation-note-field"><span><NotebookPen size={13} /> {id ? "Catatan pengujian" : "Test note"}</span><input aria-label={id ? `Catatan ${readableItemDescription(item.description)}` : `Notes for ${readableItemDescription(item.description)}`} disabled={!canManage || completed} value={item.notes} onChange={(event) => updateItem(item.id, { notes: event.target.value })} placeholder={id ? "Tambahkan catatan bila perlu" : "Add a note if useful"} /></label>
                </article>
              ))}
            </div>
          </section>
        ))}
        <label className="field full validation-notes"><span>{id ? "Catatan umum validasi" : "General validation notes"}<small>{id ? "Opsional · kondisi lokasi, hasil pengujian, atau tindak lanjut" : "Optional · site condition, test results, or follow-up"}</small></span><textarea rows={3} disabled={!canManage || completed} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={id ? "Tulis ringkasan hasil pemeriksaan..." : "Summarize the inspection results..."} /></label>
        <div className="validation-actions">
          {validation?.id && <button className="button secondary" type="button" onClick={() => setPreviewOpen(true)}><Eye size={16} /> {id ? "Pratinjau" : "Preview"}</button>}
          {validation?.id && <button className="button secondary" type="button" onClick={downloadPdf}><Download size={16} /> {id ? "Unduh PDF" : "Download PDF"}</button>}
        </div>
      </section>
      <DocumentPreviewModal open={previewOpen} url={validation?.id ? `/api/validations/${validation.id}/pdf` : ""} title={validation?.number ?? (id ? "Form Validasi" : "Validation Form")} filename={`${(validation?.number ?? "VALIDATION").replaceAll("/", "-")}.pdf`} onClose={() => setPreviewOpen(false)} />
    </div>
  );
}
