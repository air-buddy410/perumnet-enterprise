"use client";

import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  MapPin,
  Plus,
  Search,
  TrendingUp,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import {
  formatCompactCurrency,
  formatCurrency,
  Project,
  ProjectStatus,
  ViewKey,
} from "../data";

interface DashboardViewProps {
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
  selectedProjectId?: string;
  userName: string;
  canManage: boolean;
  canUseBoq: boolean;
  canUseBilling: boolean;
  onSelectProject: (projectId: string) => void;
  onProjectCreated: (project: Project) => void;
}

const filters = ["Semua", "Aktif", "Selesai", "Draft"] as const;

function statusClass(status: ProjectStatus) {
  if (status === "Selesai") return "success";
  if (status === "Aktif") return "info";
  return "neutral";
}

function paymentClass(payment: Project["payment"]) {
  if (payment === "Lunas") return "success";
  if (payment === "Sebagian") return "warning";
  if (payment === "Belum Dibayar") return "danger";
  return "neutral";
}

export function DashboardView({
  navigate,
  notify,
  selectedProjectId = "",
  userName,
  canManage,
  canUseBoq,
  canUseBilling,
  onSelectProject,
  onProjectCreated,
}: DashboardViewProps) {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("Semua");
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [location, setLocation] = useState("");
  const firstName = userName.trim().split(/\s+/)[0] || "Rekan";

  useEffect(() => {
    let active = true;
    api<Project[]>("/api/projects")
      .then((data) => {
        if (active) setProjectList(data);
      })
      .catch((error) => notify(messageOf(error)));
    return () => {
      active = false;
    };
  }, [notify]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return projectList.filter((project) => {
      const matchesWorkspace = !selectedProjectId || project.id === selectedProjectId;
      const matchesFilter = filter === "Semua" || project.status === filter;
      const matchesQuery =
        !normalizedQuery ||
        [project.name, project.client, project.code, project.location]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesWorkspace && matchesFilter && matchesQuery;
    });
  }, [filter, projectList, query, selectedProjectId]);

  const stats = useMemo(() => {
    const scopedProjects = selectedProjectId
      ? projectList.filter((project) => project.id === selectedProjectId)
      : projectList;
    const active = scopedProjects.filter((project) => project.status === "Aktif").length;
    const completed = scopedProjects.filter((project) => project.status === "Selesai").length;
    const value = scopedProjects
      .filter((project) => project.status === "Aktif")
      .reduce((sum, project) => sum + project.value, 0);
    const paid = scopedProjects.reduce(
      (sum, project) => sum + project.value * (project.paidRatio / 100),
      0,
    );
    return { active, completed, value, paid };
  }, [projectList, selectedProjectId]);
  const scopedProjects = selectedProjectId
    ? projectList.filter((project) => project.id === selectedProjectId)
    : projectList;
  const attentionProjects = scopedProjects
    .filter(
      (project) =>
        project.status !== "Selesai" &&
        (project.payment === "Belum Dibayar" ||
          project.payment === "Sebagian" ||
          project.progress < 100),
    )
    .slice(0, 3);
  const visibleTeam = Array.from(
    new Set(
      scopedProjects.flatMap(
        (project) => project.teamNames ?? [project.manager].filter(Boolean),
      ),
    ),
  ).slice(0, 3);

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim() || !clientName.trim()) return;
    try {
      const newProject = await api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectName.trim(),
          client: clientName.trim(),
          location: location.trim() || "Bali",
          status: "Draft",
          value: 0,
        }),
      });
      setProjectList((items) => [newProject, ...items]);
      onProjectCreated(newProject);
      onSelectProject(newProject.id);
      setProjectName("");
      setClientName("");
      setLocation("");
      setShowNewProject(false);
      notify("Proyek baru berhasil ditambahkan sebagai draft.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  return (
    <div className="page-stack dashboard-view" data-testid="dashboard-view">
      <section className="welcome-strip">
        <div>
          <span className="eyebrow">SABTU, 18 JULI 2026</span>
          <h1>Selamat sore, {firstName}.</h1>
          <p>Berikut ringkasan operasional proyek PerumNet hari ini.</p>
        </div>
        {canManage && (
          <button className="button primary" type="button" onClick={() => setShowNewProject(true)}>
            <Plus size={17} /> Proyek baru
          </button>
        )}
      </section>

      <section className="metric-grid" aria-label="Ringkasan operasional">
        <article className="metric-card">
          <span className="metric-icon teal"><FolderKanban size={20} /></span>
          <div className="metric-main">
            <span>Proyek aktif</span>
            <strong>{stats.active}</strong>
          </div>
          <span className="metric-change positive"><TrendingUp size={13} /> 2 bulan ini</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue"><CircleDollarSign size={20} /></span>
          <div className="metric-main">
            <span>Nilai proyek berjalan</span>
            <strong>{formatCompactCurrency(stats.value)}</strong>
          </div>
          <span className="metric-change">{stats.active} kontrak berjalan</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><Clock3 size={20} /></span>
          <div className="metric-main">
            <span>Piutang diterima</span>
            <strong>{formatCompactCurrency(stats.paid)}</strong>
          </div>
          <span className="metric-change warning-text">Sesuai pembayaran terkonfirmasi</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon green"><CheckCircle2 size={20} /></span>
          <div className="metric-main">
            <span>Proyek selesai</span>
            <strong>{stats.completed}</strong>
          </div>
          <span className="metric-change positive">Tepat waktu</span>
        </article>
      </section>

      <section className="dashboard-layout">
        <div className="panel project-panel">
          <div className="panel-head project-panel-head">
            <div>
              <span className="eyebrow">PORTOFOLIO</span>
              <h2>Proyek terbaru</h2>
            </div>
            <div className="project-tools">
              <label className="search-field compact">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Cari proyek..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="segmented-control" aria-label="Filter status proyek">
                {filters.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={filter === item ? "active" : ""}
                    onClick={() => setFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="project-list">
            {filteredProjects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-card-main">
                  <div className="project-card-title">
                    <div>
                      <span className={`status-badge ${statusClass(project.status)}`}>
                        <span className="badge-dot" />
                        {project.status}
                      </span>
                      <span className="project-code">{project.code}</span>
                    </div>
                    <h3>{project.name}</h3>
                    <p>{project.client}</p>
                  </div>
                  <div className="project-meta">
                    <span><MapPin size={14} /> {project.location}</span>
                    <span><CalendarDays size={14} /> {project.targetDate}</span>
                    <span><UsersRound size={14} /> {project.manager}</span>
                  </div>
                  <div className="project-progress-row">
                    <div className="progress-copy">
                      <span>Progres pekerjaan</span>
                      <strong>{project.progress}%</strong>
                    </div>
                    <div className="progress-track" aria-label={`Progres ${project.progress}%`}>
                      <span style={{ width: `${project.progress}%` }} />
                    </div>
                  </div>
                </div>
                <div className="project-finance">
                  <span>Nilai proyek</span>
                  <strong>{project.payment === "Tidak Diizinkan" ? "Akses terbatas" : project.value ? formatCurrency(project.value) : "Belum ditentukan"}</strong>
                  <span className={`status-badge ${paymentClass(project.payment)}`}>
                    {project.payment === "Sebagian" ? `Terbayar ${project.paidRatio}%` : project.payment}
                  </span>
                </div>
                <div className="project-actions">
                  {canUseBoq && (
                    <button className="quick-action" type="button" onClick={() => { onSelectProject(project.id); navigate("boq"); }}>
                      <FileSpreadsheet size={16} />
                      <span>BoQ</span>
                    </button>
                  )}
                  {canUseBilling && (
                    <button className="quick-action" type="button" onClick={() => { onSelectProject(project.id); navigate("billing"); }}>
                      <FileText size={16} />
                      <span>Quotation</span>
                    </button>
                  )}
                  <button className="quick-action primary-link" type="button" onClick={() => { onSelectProject(project.id); navigate("project"); }}>
                    <span>Detail</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </article>
            ))}
            {!filteredProjects.length && (
              <div className="empty-state">
                <Search size={28} />
                <h3>Proyek tidak ditemukan</h3>
                <p>Coba ubah kata kunci atau filter status.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="dashboard-side">
          <section className="panel attention-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">PERLU PERHATIAN</span>
                <h2>Tindak lanjut</h2>
              </div>
              <span className="count-badge">{attentionProjects.length}</span>
            </div>
            {attentionProjects.map((project) => (
              <button className="attention-item" type="button" key={project.id} onClick={() => { onSelectProject(project.id); navigate(project.payment === "Belum Dibayar" || project.payment === "Sebagian" ? "billing" : "project"); }}>
                <span className={`attention-icon ${project.payment === "Belum Dibayar" ? "danger" : project.payment === "Sebagian" ? "warning" : "info"}`}><FileText size={17} /></span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.payment} · progres {project.progress}%</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
            {!attentionProjects.length && <div className="empty-state compact"><CheckCircle2 size={24} /><p>Tidak ada tindak lanjut mendesak.</p></div>}
          </section>

          <section className="panel team-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">TIM LAPANGAN</span>
                <h2>Aktivitas hari ini</h2>
              </div>
            </div>
            {visibleTeam.map((name, index) => (
              <div className="team-activity" key={name}>
                <div className={`avatar small ${index === 1 ? "coral" : index === 2 ? "navy" : ""}`}>{name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</div>
                <div><strong>{name}</strong><span>Anggota proyek yang dapat diakses</span></div>
              </div>
            ))}
            {!visibleTeam.length && <div className="empty-state compact"><UsersRound size={24} /><p>Belum ada anggota proyek.</p></div>}
          </section>
        </aside>
      </section>

      {showNewProject && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowNewProject(false)}>
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">PROYEK BARU</span>
                <h2 id="new-project-title">Buat draft proyek</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowNewProject(false)}>
                <X size={18} />
              </button>
            </div>
            <form className="form-grid" onSubmit={addProject}>
              <label className="field full">
                <span>Nama proyek</span>
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} required placeholder="Contoh: Upgrade jaringan kantor" />
              </label>
              <label className="field full">
                <span>Nama klien</span>
                <input value={clientName} onChange={(event) => setClientName(event.target.value)} required placeholder="Nama perusahaan / klien" />
              </label>
              <label className="field full">
                <span>Lokasi</span>
                <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Kota / kabupaten" />
              </label>
              <div className="modal-actions full">
                <button className="button secondary" type="button" onClick={() => setShowNewProject(false)}>Batal</button>
                <button className="button primary" type="submit"><Plus size={16} /> Simpan proyek</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
