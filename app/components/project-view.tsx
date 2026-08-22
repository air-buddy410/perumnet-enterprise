"use client";

import {
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  LoaderCircle,
  LayoutList,
  ListChecks,
  MapPin,
  Plus,
  ReceiptText,
  Trash2,
  UploadCloud,
  UsersRound,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { Project, ViewKey } from "../data";
import { type AppLanguage, localizedDate, localizedLabel } from "../i18n";
import { DocumentGallery, type ProjectDocumentAsset } from "./document-gallery";

interface ProjectViewProps {
  language: AppLanguage;
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
  projectId: string;
  project?: Project;
  canManage: boolean;
  canDelete: boolean;
  canManageAccess: boolean;
  onProjectDeleted: (projectId: string) => void;
}

interface ProjectAccessUser {
  id: string;
  name: string;
  email: string;
  role: "Project Manager" | "Engineer";
  status: "Aktif" | "Nonaktif";
  assigned: boolean;
  isManager: boolean;
  isCreator: boolean;
}

interface ProjectTask {
  id: string;
  name: string;
  owner: string;
  start: number;
  duration: number;
  startLabel: string;
  endLabel: string;
  status: "Selesai" | "Berjalan" | "Belum Mulai";
  startDate?: string;
  endDate?: string;
}

interface ProcurementSummary {
  budgetBoq: number;
  committedVendorCost: number;
  verifiedPayable: number;
  paid: number;
  outstanding: number;
  variance: number;
}

interface DocumentUploadIssue {
  name: string;
  code: string;
  message: string;
}

const DOCUMENT_UPLOAD_MAX_FILES = 10;
const DOCUMENT_UPLOAD_MAX_BATCH_BYTES = 25 * 1024 * 1024;

function splitDocumentUploadBatches(files: File[]) {
  const batches: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;
  for (const file of files) {
    if (
      current.length > 0 &&
      (current.length >= DOCUMENT_UPLOAD_MAX_FILES || currentBytes + file.size > DOCUMENT_UPLOAD_MAX_BATCH_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function taskStatusClass(status: ProjectTask["status"]) {
  if (status === "Selesai") return "success";
  if (status === "Berjalan") return "info";
  return "neutral";
}

export function ProjectView({
  language,
  navigate,
  notify,
  projectId,
  project,
  canManage,
  canDelete,
  canManageAccess,
  onProjectDeleted,
}: ProjectViewProps) {
  const id = language === "id";
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [documents, setDocuments] = useState<ProjectDocumentAsset[]>([]);
  const [documentCaption, setDocumentCaption] = useState("");
  const [documentUploadIssues, setDocumentUploadIssues] = useState<DocumentUploadIssue[]>([]);
  const [documentUploadBusy, setDocumentUploadBusy] = useState(false);
  const [viewMode, setViewMode] = useState<"timeline" | "tasks">("timeline");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [taskOwner, setTaskOwner] = useState("");
  const [taskDate, setTaskDate] = useState(new Date().toISOString().slice(0, 10));
  const [accessUsers, setAccessUsers] = useState<ProjectAccessUser[]>([]);
  const [procurementSummary, setProcurementSummary] = useState<ProcurementSummary | null>(null);
  const [serverToday, setServerToday] = useState("");
  const [clientContactName, setClientContactName] = useState(project?.clientContactName ?? "");
  const [clientEmail, setClientEmail] = useState(project?.clientEmail ?? "");
  const [clientContactSaving, setClientContactSaving] = useState(false);

  useEffect(() => {
    const update = window.setTimeout(() => {
      setClientContactName(project?.clientContactName ?? "");
      setClientEmail(project?.clientEmail ?? "");
    }, 0);
    return () => window.clearTimeout(update);
  }, [project?.clientContactName, project?.clientEmail, project?.id]);

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await api<ProjectTask[]>(`/api/projects/${projectId}/tasks`));
    } catch (error) {
      notify(messageOf(error));
    }
  }, [notify, projectId]);

  const refreshDocuments = useCallback(async () => {
    try {
      setDocuments(await api<ProjectDocumentAsset[]>(`/api/projects/${projectId}/documents`));
    } catch (error) {
      notify(messageOf(error));
    }
  }, [notify, projectId]);

  useEffect(() => {
    const update = window.setTimeout(() => {
      void refreshTasks();
      void refreshDocuments();
    }, 0);
    return () => window.clearTimeout(update);
  }, [refreshDocuments, refreshTasks]);

  useEffect(() => {
    if (!canManageAccess) return;
    api<ProjectAccessUser[]>(`/api/projects/${projectId}/access`)
      .then(setAccessUsers)
      .catch((error) => notify(messageOf(error, language)));
  }, [canManageAccess, language, notify, projectId]);

  useEffect(() => {
    Promise.all([
      api<ProcurementSummary>(`/api/procurement-orders?projectId=${encodeURIComponent(projectId)}&summary=1`),
      api<{ today: string }>("/api/system/time"),
    ])
      .then(([summary, time]) => {
        setProcurementSummary(summary);
        setServerToday(time.today);
      })
      .catch((error) => notify(messageOf(error, language)));
  }, [language, notify, projectId]);

  const availableOwners = project?.teamNames?.length
    ? project.teamNames
    : project?.manager
      ? [project.manager]
      : [];

  const progress = useMemo(
    () => tasks.length
      ? Math.round((tasks.filter((task) => task.status === "Selesai").length / tasks.length) * 100)
      : project?.status === "Selesai"
        ? 100
        : 0,
    [project?.status, tasks],
  );
  const completed = tasks.filter((task) => task.status === "Selesai").length;
  const active = tasks.filter((task) => task.status === "Berjalan").length;
  const remaining = tasks.filter((task) => task.status === "Belum Mulai").length;
  const daysRemaining = project?.targetDateIso && serverToday
    ? Math.max(0, Math.ceil((new Date(`${project.targetDateIso}T23:59:59`).getTime() - new Date(`${serverToday}T00:00:00`).getTime()) / 86_400_000))
    : 0;
  const money = (value: number) => new Intl.NumberFormat(language === "id" ? "id-ID" : "en-US", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

  async function toggleTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const status = task.status === "Selesai" ? "Berjalan" : "Selesai";
    try {
      await api(`/api/projects/${projectId}/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setTasks((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
      notify(id ? "Status tugas dan progres proyek diperbarui." : "Task status and project progress updated.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskName.trim()) return;
    try {
      await api(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          name: taskName.trim(),
          owner: taskOwner || availableOwners[0],
          startDate: taskDate,
          status: "Belum Mulai",
        }),
      });
      await refreshTasks();
      setTaskName("");
      setShowTaskForm(false);
      notify(id ? "Tugas baru ditambahkan ke timeline." : "A new task was added to the timeline.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function uploadDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length || documentUploadBusy) return;
    const batches = splitDocumentUploadBatches(files);
    const uploaded: ProjectDocumentAsset[] = [];
    const skipped: DocumentUploadIssue[] = [];
    setDocumentUploadBusy(true);
    setDocumentUploadIssues([]);
    try {
      for (const batch of batches) {
        const form = new FormData();
        batch.forEach((file) => form.append("files", file));
        if (documentCaption.trim()) form.set("caption", documentCaption.trim());
        try {
          const result = await api<{ uploaded: ProjectDocumentAsset[]; skipped: DocumentUploadIssue[] }>(`/api/projects/${projectId}/documents`, {
            method: "POST",
            body: form,
          });
          uploaded.push(...(result.uploaded ?? []));
          skipped.push(...(result.skipped ?? []));
        } catch (error) {
          const message = messageOf(error, language);
          skipped.push(...batch.map((file) => ({ name: file.name, code: "UPLOAD_FAILED", message })));
        }
      }
      if (uploaded.length) {
        setDocuments((current) => {
          const known = new Set(uploaded.map((item) => item.id));
          return [...uploaded, ...current.filter((item) => !known.has(item.id))];
        });
      }
      setDocumentUploadIssues(skipped);
      if (uploaded.length && !skipped.length) {
        notify(id ? `${uploaded.length} dokumentasi berhasil diunggah.` : `${uploaded.length} documents uploaded successfully.`);
      } else if (uploaded.length) {
        notify(id ? `${uploaded.length} dokumentasi berhasil; sebagian file perlu diperiksa.` : `${uploaded.length} documents uploaded; review the skipped files.`);
      } else if (skipped.length) {
        notify(id ? "Tidak ada file yang berhasil diunggah. Periksa alasan di bawah." : "No files were uploaded. Review the reasons below.");
      }
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setDocumentUploadBusy(false);
      event.target.value = "";
    }
  }

  async function updateDocumentCaption(document: ProjectDocumentAsset, caption: string) {
    try {
      const updated = await api<ProjectDocumentAsset>(`/api/projects/${projectId}/documents/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify({ caption: caption || null }),
      });
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      notify(id ? "Keterangan dokumentasi diperbarui." : "Document caption updated.");
    } catch (error) {
      notify(messageOf(error, language));
      throw error;
    }
  }

  async function deleteDocument(document: ProjectDocumentAsset) {
    try {
      await api(`/api/projects/${projectId}/documents/${document.id}`, { method: "DELETE" });
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      notify(id ? "Dokumentasi dihapus." : "Documentation deleted.");
    } catch (error) {
      notify(messageOf(error, language));
      throw error;
    }
  }

  async function deleteProject() {
    if (
      !window.confirm(
        id
          ? `Hapus proyek "${project?.name ?? projectId}" beserta BOQ, Quotation, Invoice, SPK, BAST, tugas, dan dokumentasinya?`
          : `Delete project "${project?.name ?? projectId}" and its BoQ, Quotation, Invoice, Work Order, Handover, tasks, and documentation?`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      onProjectDeleted(projectId);
      navigate("dashboard");
      notify(id ? "Proyek dan seluruh data turunannya berhasil dihapus." : "The project and all related data were deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function saveProjectAccess() {
    try {
      const userIds = accessUsers
        .filter((candidate) => candidate.status === "Aktif" && candidate.assigned)
        .map((candidate) => candidate.id);
      await api(`/api/projects/${projectId}/access`, {
        method: "PUT",
        body: JSON.stringify({ userIds }),
      });
      notify(id ? "Akses proyek berhasil diperbarui." : "Project access updated.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function saveClientContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientContactSaving(true);
    try {
      const updated = await api<Project>(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          clientContactName: clientContactName.trim(),
          clientEmail: clientEmail.trim(),
        }),
      });
      setClientContactName(updated.clientContactName ?? "");
      setClientEmail(updated.clientEmail ?? "");
      notify(id ? "Kontak klien berhasil disimpan." : "Client contact saved.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setClientContactSaving(false);
    }
  }

  return (
    <div className="page-stack" data-testid="project-view">
      <section className="project-hero">
        <div className="project-hero-main">
          <div className="project-hero-badges">
            <span className={`status-badge ${project?.status === "Selesai" ? "success" : project?.status === "Aktif" ? "info" : "neutral"}`}><span className="badge-dot" /> {localizedLabel(language, project?.status ?? "Draft")}</span>
            <span className="project-code">{project?.code ?? (id ? "Memuat..." : "Loading...")}</span>
          </div>
          <h1>{project?.name ?? (id ? "Memuat proyek..." : "Loading project...")}</h1>
          <p>{project?.client ?? (id ? "Memuat klien..." : "Loading client...")}</p>
          <div className="project-hero-meta">
            <span><MapPin size={15} /> {project?.location ?? "Ubud, Gianyar"}</span>
            <span><CalendarDays size={15} /> {localizedDate(language, project?.startDateIso)} — {localizedDate(language, project?.targetDateIso)}</span>
            <span><UsersRound size={15} /> {project?.teamNames?.length ?? project?.team.length ?? 0} {id ? "anggota tim" : "team members"}</span>
          </div>
        </div>
        <div className="project-hero-progress">
          <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{progress}%</strong><small>{id ? "selesai" : "complete"}</small></span>
          </div>
          <div>
            <strong>{completed} {id ? "dari" : "of"} {tasks.length} {id ? "tugas" : "tasks"}</strong>
            <span>{id ? "Target selesai" : "Target completion"} {localizedDate(language, project?.targetDateIso)}</span>
          </div>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={() => navigate("expenses")}>
            <ReceiptText size={16} /> {id ? "Catat belanja" : "Record expense"}
          </button>
          <button className="button secondary" type="button" onClick={() => navigate("boq")}>
            <FileText size={16} /> {id ? "Lihat BoQ" : "View BoQ"}
          </button>
          <button className="button primary" type="button" onClick={() => navigate("validation")}>
            {id ? "Mulai validasi" : "Start validation"} <ArrowRight size={16} />
          </button>
          <button className="button secondary" type="button" onClick={() => navigate("bast")}>
            {id ? "Buka BAST" : "Open handover"}
          </button>
          {canDelete && (
            <button className="button danger" type="button" onClick={deleteProject}>
              <Trash2 size={16} /> {id ? "Hapus proyek" : "Delete project"}
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">{id ? "KONTAK KLIEN" : "CLIENT CONTACT"}</span>
            <h2>{id ? "Penerima quotation & invoice" : "Quotation & invoice recipient"}</h2>
            <p className="panel-description">
              {id
                ? "Email ini menjadi penerima resmi saat admin mengirim quotation atau invoice dari Billing."
                : "This email becomes the official recipient when an admin sends a quotation or invoice from Billing."}
            </p>
          </div>
        </div>
        {canManage ? (
          <form className="form-grid" onSubmit={saveClientContact}>
            <label className="field">
              <span>{id ? "Nama kontak" : "Contact name"}</span>
              <input value={clientContactName} maxLength={160} onChange={(event) => setClientContactName(event.target.value)} placeholder={project?.client ?? (id ? "Nama klien" : "Client name")} />
            </label>
            <label className="field">
              <span>{id ? "Email klien" : "Client email"}</span>
              <input type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="client@example.com" />
            </label>
            <p className="form-hint full">{id ? "Boleh dikosongkan untuk menghapus alamat. Validasi format dan aturan penerima tetap dilakukan server." : "Leave it blank to remove the address. The server still validates the format and recipient rules."}</p>
            <div className="modal-actions full">
              <button className="button primary" type="submit" disabled={clientContactSaving || !project}>{clientContactSaving ? (id ? "Menyimpan..." : "Saving...") : (id ? "Simpan kontak" : "Save contact")}</button>
            </div>
          </form>
        ) : (
          <div className="document-recipient">
            <span>{id ? "Penerima tersimpan" : "Saved recipient"}</span>
            <strong>{clientContactName || project?.client || "—"}</strong>
            <small>{clientEmail || (id ? "Email belum diisi" : "Email not configured")}</small>
          </div>
        )}
      </section>

      {canManageAccess && (
        <section className="panel project-access-panel">
          <div className="panel-head">
            <div className="project-access-heading">
              <span className="eyebrow">{id ? "AKSES PROYEK" : "PROJECT ACCESS"}</span>
              <h2>{id ? "Project Manager & Engineer" : "Project Managers & Engineers"}</h2>
              <p className="panel-description">
                {id
                  ? "Pilih secara eksplisit Project Manager dan Engineer yang boleh melihat proyek ini. Admin dapat mencabut akses pembuat maupun manager; Admin dan Finance tetap memiliki cakupan global."
                  : "Explicitly select the Project Managers and Engineers who may view this project. An Admin may revoke creator or manager access; Admin and Finance retain global scope."}
              </p>
            </div>
            <button className="button primary small" type="button" onClick={saveProjectAccess}><Check size={15} /> {id ? "Simpan akses" : "Save access"}</button>
          </div>
          <div className="project-access-grid">
            {accessUsers.map((candidate) => (
              <label className={`project-access-user ${candidate.assigned ? "selected" : ""}`} key={candidate.id}>
                <input type="checkbox" checked={candidate.assigned} disabled={candidate.status !== "Aktif"} onChange={(event) => setAccessUsers((current) => current.map((item) => item.id === candidate.id ? { ...item, assigned: event.target.checked } : item))} />
                <span className="task-check">{candidate.assigned && <Check size={14} />}</span>
                <span><strong>{candidate.name}</strong><small>{candidate.role} · {localizedLabel(language, candidate.status)}{candidate.isCreator ? (id ? " · Pembuat proyek" : " · Project creator") : ""}{candidate.isManager ? (id ? " · Manager tercatat" : " · Assigned manager") : ""}</small></span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="project-summary-grid">
        <article>
          <span className="summary-dot success" />
          <div><strong>{completed}</strong><span>{id ? "Tugas selesai" : "Completed tasks"}</span></div>
        </article>
        <article>
          <span className="summary-dot info" />
          <div><strong>{active}</strong><span>{id ? "Sedang berjalan" : "In progress"}</span></div>
        </article>
        <article>
          <span className="summary-dot neutral" />
          <div><strong>{remaining}</strong><span>{id ? "Belum dimulai" : "Not started"}</span></div>
        </article>
        <article>
          <span className="summary-dot warning" />
          <div><strong>{daysRemaining}</strong><span>{id ? "Hari tersisa" : "Days remaining"}</span></div>
        </article>
      </section>

      {procurementSummary && (
        <section className="panel project-procurement-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">{id ? "POSISI PROCUREMENT" : "PROCUREMENT POSITION"}</span>
              <h2>{id ? "Budget, komitmen, dan kewajiban vendor" : "Vendor budget, commitments, and liabilities"}</h2>
              <p className="panel-description">
                {id
                  ? "Komitmen yang belum dibayar tetap dicatat sebagai kewajiban dan belum menjadi arus kas keluar."
                  : "Unpaid commitments remain liabilities and are not recorded as cash outflows yet."}
              </p>
            </div>
          </div>
          <div className="project-procurement-grid">
            {[
              [id ? "Budget BoQ" : "BoQ budget", procurementSummary.budgetBoq],
              [id ? "Komitmen vendor" : "Vendor committed", procurementSummary.committedVendorCost],
              [id ? "Layak dibayar" : "Verified payable", procurementSummary.verifiedPayable],
              [id ? "Sudah dibayar" : "Paid", procurementSummary.paid],
              [id ? "Belum dibayar" : "Outstanding", procurementSummary.outstanding],
              [id ? "Sisa budget" : "Budget variance", procurementSummary.variance],
            ].map(([label, value]) => (
              <article key={String(label)}>
                <span>{label}</span>
                <strong>{money(Number(value))}</strong>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel timeline-panel">
        <div className="panel-head timeline-head">
          <div>
            <span className="eyebrow">{id ? "JADWAL PROYEK" : "PROJECT SCHEDULE"}</span>
            <h2>{id ? "Timeline & tugas lapangan" : "Timeline & field tasks"}</h2>
          </div>
          <div className="timeline-controls">
            <div className="segmented-control icon-segmented" role="group" aria-label={id ? "Mode tampilan jadwal" : "Schedule view mode"}>
              <button className={viewMode === "timeline" ? "active" : ""} type="button" onClick={() => setViewMode("timeline")}>
                <LayoutList size={15} /> Timeline
              </button>
              <button className={viewMode === "tasks" ? "active" : ""} type="button" onClick={() => setViewMode("tasks")}>
                <ListChecks size={15} /> {id ? "Daftar" : "List"}
              </button>
            </div>
            {canManage && (
              <button className="button primary small" type="button" onClick={() => setShowTaskForm(true)}>
                <Plus size={15} /> {id ? "Tambah tugas" : "Add task"}
              </button>
            )}
          </div>
        </div>

        {viewMode === "timeline" ? (
          <div className="gantt-wrap">
            <div className="gantt-header">
              <span>{id ? "Tugas" : "Tasks"}</span>
              <div className="gantt-months">
                <span>8 Jul</span><span>13 Jul</span><span>18 Jul</span><span>23 Jul</span><span>28 Jul</span><span>2 {id ? "Agu" : "Aug"}</span>
              </div>
            </div>
            <div className="gantt-body">
              {tasks.map((task) => (
                <div className="gantt-row" key={task.id}>
                  <div className="gantt-task">
                    <button
                      className={`task-check ${task.status === "Selesai" ? "checked" : ""}`}
                      type="button"
                      aria-label={`${task.status === "Selesai" ? (id ? "Batalkan selesai" : "Mark incomplete") : (id ? "Tandai selesai" : "Mark complete")} ${task.name}`}
                      onClick={() => canManage && toggleTask(task.id)}
                      disabled={!canManage}
                    >
                      {task.status === "Selesai" ? <Check size={14} /> : <Circle size={14} />}
                    </button>
                    <div><strong>{task.name}</strong><small>{task.owner}</small></div>
                  </div>
                  <div className="gantt-track">
                    <span
                      className={`gantt-bar ${task.status === "Selesai" ? "done" : task.status === "Berjalan" ? "active" : "pending"}`}
                      style={{ left: `${task.start}%`, width: `${task.duration}%` }}
                    >
                      <small>{task.startLabel} — {task.endLabel}</small>
                    </span>
                    <span className="today-marker"><small>{id ? "Hari ini" : "Today"}</small></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="task-list-view">
            {tasks.map((task) => (
              <article className="task-list-item" key={task.id}>
                <button className={`task-check large ${task.status === "Selesai" ? "checked" : ""}`} type="button" disabled={!canManage} onClick={() => canManage && toggleTask(task.id)}>
                  {task.status === "Selesai" ? <Check size={16} /> : <Circle size={16} />}
                </button>
                <div className="task-list-primary">
                  <strong>{task.name}</strong>
                  <span>{task.owner}</span>
                </div>
                <div>
                  <span className={`status-badge ${taskStatusClass(task.status)}`}>{localizedLabel(language, task.status)}</span>
                </div>
                <div className="task-date"><CalendarDays size={14} /> {task.startLabel} — {task.endLabel}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="documentation-layout">
        <div className="panel documentation-panel">
          <div className="panel-head documentation-head">
            <div>
              <span className="eyebrow">{id ? "DOKUMENTASI LAPANGAN" : "FIELD DOCUMENTATION"}</span>
              <h2>{id ? "Foto & file proyek" : "Project photos & files"}</h2>
              <p className="panel-description">{id ? "Unggah hingga 10 file per batch. Tambahkan keterangan agar foto mudah ditemukan kembali." : "Upload up to 10 files per batch. Add a caption so photos remain easy to find."}</p>
            </div>
            {canManage && (
              <div className="documentation-upload-controls">
                <label className="field document-caption-field">
                  <span>{id ? "Keterangan untuk semua file" : "Caption for all files"}</span>
                  <input value={documentCaption} maxLength={500} onChange={(event) => setDocumentCaption(event.target.value)} placeholder={id ? "Contoh: Instalasi lantai 2" : "Example: Second-floor installation"} disabled={documentUploadBusy} />
                </label>
                <label className={`button primary small file-upload-button ${documentUploadBusy ? "is-loading" : ""}`}>
                  {documentUploadBusy ? <LoaderCircle className="spin" size={15} /> : <UploadCloud size={15} />} {documentUploadBusy ? (id ? "Mengunggah..." : "Uploading...") : (id ? "Unggah banyak" : "Upload multiple")}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={uploadDocuments} disabled={documentUploadBusy} />
                </label>
              </div>
            )}
          </div>
          {documentUploadIssues.length ? (
            <div className="document-upload-issues" role="status">
              <strong>{id ? "File yang perlu diperiksa" : "Files to review"}</strong>
              <ul>{documentUploadIssues.map((issue, index) => <li key={`${issue.name}-${issue.code}-${index}`}><span>{issue.name}</span><small>{issue.code} · {issue.message}</small></li>)}</ul>
            </div>
          ) : null}
          <DocumentGallery
            documents={documents}
            language={language}
            canManage={canManage}
            onUpdateCaption={updateDocumentCaption}
            onDelete={deleteDocument}
            emptyTitle={id ? "Belum ada dokumentasi" : "No documentation yet"}
            emptyDescription={id ? "Unggah foto atau file pertama untuk mulai membangun riwayat proyek." : "Upload the first photo or file to build the project history."}
          />
        </div>

        <aside className="panel project-activity-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">{id ? "AKTIVITAS" : "ACTIVITY"}</span>
              <h2>{id ? "Pembaruan terbaru" : "Latest updates"}</h2>
            </div>
          </div>
          <div className="activity-timeline">
            {documents.slice(0, 2).map((document) => (
              <div className="activity-event" key={document.id}>
                <span className="activity-event-icon teal"><Camera size={15} /></span>
                <div><strong>{document.name}</strong><span>{document.uploader} · {id ? "Dokumentasi lapangan" : "Field documentation"}</span><small>{document.date}</small></div>
              </div>
            ))}
            {tasks.slice(0, Math.max(0, 3 - documents.length)).map((task) => (
              <div className="activity-event" key={task.id}>
                <span className={`activity-event-icon ${task.status === "Selesai" ? "green" : "orange"}`}>{task.status === "Selesai" ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}</span>
                <div><strong>{task.name}</strong><span>{task.owner} · {localizedLabel(language, task.status)}</span><small>{task.startLabel}</small></div>
              </div>
            ))}
            {!documents.length && !tasks.length && <div className="empty-state compact"><p>{id ? "Belum ada aktivitas proyek." : "No project activity yet."}</p></div>}
          </div>
        </aside>
      </section>

      {showTaskForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowTaskForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "TUGAS BARU" : "NEW TASK"}</span><h2 id="task-form-title">{id ? "Tambahkan tugas proyek" : "Add project task"}</h2></div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowTaskForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={addTask}>
              <label className="field full"><span>{id ? "Nama tugas" : "Task name"}</span><input required value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder={id ? "Contoh: Testing coverage area" : "Example: Coverage area testing"} /></label>
              <label className="field full"><span>{id ? "Penanggung jawab" : "Owner"}</span><select required value={taskOwner || availableOwners[0] || ""} onChange={(event) => setTaskOwner(event.target.value)}>{availableOwners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
              <label className="field full"><span>{id ? "Tanggal mulai" : "Start date"}</span><input type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} /></label>
              <div className="modal-actions full">
                <button className="button secondary" type="button" onClick={() => setShowTaskForm(false)}>{id ? "Batal" : "Cancel"}</button>
                <button className="button primary" type="submit"><Plus size={16} /> {id ? "Tambah tugas" : "Add task"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
