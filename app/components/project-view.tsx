"use client";

import {
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileImage,
  FileText,
  LayoutList,
  ListChecks,
  MapPin,
  Paperclip,
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

interface ProjectDocument {
  id: string;
  name: string;
  type: "image" | "file";
  date: string;
  uploader: string;
  preview?: string;
}

interface ProcurementSummary {
  budgetBoq: number;
  committedVendorCost: number;
  verifiedPayable: number;
  paid: number;
  outstanding: number;
  variance: number;
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
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [viewMode, setViewMode] = useState<"timeline" | "tasks">("timeline");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [taskOwner, setTaskOwner] = useState("");
  const [taskDate, setTaskDate] = useState(new Date().toISOString().slice(0, 10));
  const [accessUsers, setAccessUsers] = useState<ProjectAccessUser[]>([]);
  const [procurementSummary, setProcurementSummary] = useState<ProcurementSummary | null>(null);
  const [serverToday, setServerToday] = useState("");

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await api<ProjectTask[]>(`/api/projects/${projectId}/tasks`));
    } catch (error) {
      notify(messageOf(error));
    }
  }, [notify, projectId]);

  const refreshDocuments = useCallback(async () => {
    try {
      setDocuments(await api<ProjectDocument[]>(`/api/projects/${projectId}/documents`));
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

  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    try {
      const document = await api<ProjectDocument>(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: form,
      });
      setDocuments((current) => [document, ...current]);
      notify(id ? "Dokumentasi berhasil ditambahkan ke proyek." : "Documentation was added to the project.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      event.target.value = "";
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
          <div className="panel-head">
            <div>
              <span className="eyebrow">{id ? "DOKUMENTASI LAPANGAN" : "FIELD DOCUMENTATION"}</span>
              <h2>{id ? "Foto & file proyek" : "Project photos & files"}</h2>
            </div>
            {canManage && (
              <label className="button primary small file-upload-button">
                <UploadCloud size={15} /> {id ? "Unggah file" : "Upload file"}
                <input type="file" accept="image/*,.pdf" onChange={uploadDocument} />
              </label>
            )}
          </div>
          <div className="document-grid">
            {documents.map((document, index) => (
              <article className="field-document-card" key={document.id}>
                <div className={`document-thumb variant-${index % 3}`}>
                  {document.preview ? (
                    // User-selected local preview; native img avoids Next Image blob URL constraints.
                    <img src={document.preview} alt={document.name} />
                  ) : document.type === "image" ? (
                    <><Camera size={30} /><span>Dokumentasi {index + 1}</span></>
                  ) : (
                    <><FileText size={30} /><span>PDF</span></>
                  )}
                  <span className="document-type-icon">
                    {document.type === "image" ? <FileImage size={14} /> : <Paperclip size={14} />}
                  </span>
                </div>
                <div className="field-document-copy">
                  <strong>{document.name}</strong>
                  <span>{document.uploader}</span>
                  <small>{document.date}</small>
                </div>
              </article>
            ))}
          </div>
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
