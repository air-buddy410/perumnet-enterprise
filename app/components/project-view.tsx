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
  Trash2,
  UploadCloud,
  UsersRound,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { Project, ViewKey } from "../data";

interface ProjectViewProps {
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
  projectId: string;
  project?: Project;
  canManage: boolean;
  canDelete: boolean;
  onProjectDeleted: (projectId: string) => void;
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

function taskStatusClass(status: ProjectTask["status"]) {
  if (status === "Selesai") return "success";
  if (status === "Berjalan") return "info";
  return "neutral";
}

export function ProjectView({
  navigate,
  notify,
  projectId,
  project,
  canManage,
  canDelete,
  onProjectDeleted,
}: ProjectViewProps) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [viewMode, setViewMode] = useState<"timeline" | "tasks">("timeline");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [taskOwner, setTaskOwner] = useState("");
  const [taskDate, setTaskDate] = useState(new Date().toISOString().slice(0, 10));

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
      notify("Status tugas dan progres proyek diperbarui.");
    } catch (error) {
      notify(messageOf(error));
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
      notify("Tugas baru ditambahkan ke timeline.");
    } catch (error) {
      notify(messageOf(error));
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
      notify("Dokumentasi berhasil ditambahkan ke proyek.");
    } catch (error) {
      notify(messageOf(error));
    } finally {
      event.target.value = "";
    }
  }

  async function deleteProject() {
    if (
      !window.confirm(
        `Hapus proyek "${project?.name ?? projectId}" beserta BOQ, Quotation, Invoice, SPK, BAST, tugas, dan dokumentasinya?`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      onProjectDeleted(projectId);
      navigate("dashboard");
      notify("Proyek dan seluruh data turunannya berhasil dihapus.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  return (
    <div className="page-stack" data-testid="project-view">
      <section className="project-hero">
        <div className="project-hero-main">
          <div className="project-hero-badges">
            <span className={`status-badge ${project?.status === "Selesai" ? "success" : project?.status === "Aktif" ? "info" : "neutral"}`}><span className="badge-dot" /> {project?.status ?? "Draft"}</span>
            <span className="project-code">{project?.code ?? "Memuat..."}</span>
          </div>
          <h1>{project?.name ?? "Memuat proyek..."}</h1>
          <p>{project?.client ?? "Memuat klien..."}</p>
          <div className="project-hero-meta">
            <span><MapPin size={15} /> {project?.location ?? "Ubud, Gianyar"}</span>
            <span><CalendarDays size={15} /> {project?.startDate ?? "Belum ditentukan"} — {project?.targetDate ?? "Belum ditentukan"}</span>
            <span><UsersRound size={15} /> {project?.teamNames?.length ?? project?.team.length ?? 0} anggota tim</span>
          </div>
        </div>
        <div className="project-hero-progress">
          <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{progress}%</strong><small>selesai</small></span>
          </div>
          <div>
            <strong>{completed} dari {tasks.length} tugas</strong>
            <span>Target selesai {project?.targetDate ?? "belum ditentukan"}</span>
          </div>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={() => navigate("boq")}>
            <FileText size={16} /> Lihat BoQ
          </button>
          <button className="button primary" type="button" onClick={() => navigate("bast")}>
            Buat BAST <ArrowRight size={16} />
          </button>
          {canDelete && (
            <button className="button danger" type="button" onClick={deleteProject}>
              <Trash2 size={16} /> Hapus proyek
            </button>
          )}
        </div>
      </section>

      <section className="project-summary-grid">
        <article>
          <span className="summary-dot success" />
          <div><strong>{completed}</strong><span>Tugas selesai</span></div>
        </article>
        <article>
          <span className="summary-dot info" />
          <div><strong>{active}</strong><span>Sedang berjalan</span></div>
        </article>
        <article>
          <span className="summary-dot neutral" />
          <div><strong>{remaining}</strong><span>Belum dimulai</span></div>
        </article>
        <article>
          <span className="summary-dot warning" />
          <div><strong>14</strong><span>Hari tersisa</span></div>
        </article>
      </section>

      <section className="panel timeline-panel">
        <div className="panel-head timeline-head">
          <div>
            <span className="eyebrow">JADWAL PROYEK</span>
            <h2>Timeline & tugas lapangan</h2>
          </div>
          <div className="timeline-controls">
            <div className="segmented-control icon-segmented" aria-label="Mode tampilan jadwal">
              <button className={viewMode === "timeline" ? "active" : ""} type="button" onClick={() => setViewMode("timeline")}>
                <LayoutList size={15} /> Timeline
              </button>
              <button className={viewMode === "tasks" ? "active" : ""} type="button" onClick={() => setViewMode("tasks")}>
                <ListChecks size={15} /> Daftar
              </button>
            </div>
            {canManage && (
              <button className="button primary small" type="button" onClick={() => setShowTaskForm(true)}>
                <Plus size={15} /> Tambah tugas
              </button>
            )}
          </div>
        </div>

        {viewMode === "timeline" ? (
          <div className="gantt-wrap">
            <div className="gantt-header">
              <span>Tugas</span>
              <div className="gantt-months">
                <span>8 Jul</span><span>13 Jul</span><span>18 Jul</span><span>23 Jul</span><span>28 Jul</span><span>2 Agu</span>
              </div>
            </div>
            <div className="gantt-body">
              {tasks.map((task) => (
                <div className="gantt-row" key={task.id}>
                  <div className="gantt-task">
                    <button
                      className={`task-check ${task.status === "Selesai" ? "checked" : ""}`}
                      type="button"
                      aria-label={`${task.status === "Selesai" ? "Batalkan selesai" : "Tandai selesai"} ${task.name}`}
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
                    <span className="today-marker"><small>Hari ini</small></span>
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
                  <span className={`status-badge ${taskStatusClass(task.status)}`}>{task.status}</span>
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
              <span className="eyebrow">DOKUMENTASI LAPANGAN</span>
              <h2>Foto & file proyek</h2>
            </div>
            {canManage && (
              <label className="button primary small file-upload-button">
                <UploadCloud size={15} /> Unggah file
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
              <span className="eyebrow">AKTIVITAS</span>
              <h2>Pembaruan terbaru</h2>
            </div>
          </div>
          <div className="activity-timeline">
            {documents.slice(0, 2).map((document) => (
              <div className="activity-event" key={document.id}>
                <span className="activity-event-icon teal"><Camera size={15} /></span>
                <div><strong>{document.name}</strong><span>{document.uploader} · Dokumentasi lapangan</span><small>{document.date}</small></div>
              </div>
            ))}
            {tasks.slice(0, Math.max(0, 3 - documents.length)).map((task) => (
              <div className="activity-event" key={task.id}>
                <span className={`activity-event-icon ${task.status === "Selesai" ? "green" : "orange"}`}>{task.status === "Selesai" ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}</span>
                <div><strong>{task.name}</strong><span>{task.owner} · {task.status}</span><small>{task.startLabel}</small></div>
              </div>
            ))}
            {!documents.length && !tasks.length && <div className="empty-state compact"><p>Belum ada aktivitas proyek.</p></div>}
          </div>
        </aside>
      </section>

      {showTaskForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowTaskForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">TUGAS BARU</span><h2 id="task-form-title">Tambahkan tugas proyek</h2></div>
              <button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowTaskForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={addTask}>
              <label className="field full"><span>Nama tugas</span><input required value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="Contoh: Testing coverage area" /></label>
              <label className="field full"><span>Penanggung jawab</span><select required value={taskOwner || availableOwners[0] || ""} onChange={(event) => setTaskOwner(event.target.value)}>{availableOwners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
              <label className="field full"><span>Tanggal mulai</span><input type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} /></label>
              <div className="modal-actions full">
                <button className="button secondary" type="button" onClick={() => setShowTaskForm(false)}>Batal</button>
                <button className="button primary" type="submit"><Plus size={16} /> Tambah tugas</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
