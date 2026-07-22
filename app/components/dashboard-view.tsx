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
import { type AppLanguage, localizedDate, localizedLabel } from "../i18n";

interface DashboardViewProps {
  language: AppLanguage;
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
  language,
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
  const id = language === "id";
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("Semua");
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [location, setLocation] = useState("");
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const firstName = userName.trim().split(/\s+/)[0] || (id ? "Rekan" : "Colleague");

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    api<{ now: string; timeZone: string }>("/api/system/time")
      .then((result) => {
        if (!active) return;
        const serverStartedAt = new Date(result.now).getTime();
        const clientStartedAt = Date.now();
        const update = () => setServerNow(new Date(serverStartedAt + (Date.now() - clientStartedAt)));
        update();
        timer = window.setInterval(update, 30_000);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [language, notify]);

  const serverHour = serverNow
    ? Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Makassar" }).format(serverNow))
    : 12;
  const greeting = serverHour < 11
    ? id ? "Selamat pagi" : "Good morning"
    : serverHour < 15
      ? id ? "Selamat siang" : "Good afternoon"
      : serverHour < 19
        ? id ? "Selamat sore" : "Good afternoon"
        : id ? "Selamat malam" : "Good evening";
  const serverDateLabel = serverNow
    ? new Intl.DateTimeFormat(id ? "id-ID" : "en-US", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Makassar",
      }).format(serverNow).toUpperCase()
    : id ? "MEMUAT WAKTU SERVER..." : "LOADING SERVER TIME...";

  useEffect(() => {
    let active = true;
    api<Project[]>("/api/projects")
      .then((data) => {
        if (active) setProjectList(data);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify]);

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
      notify(id ? "Proyek baru berhasil ditambahkan sebagai draft." : "The new project was added as a draft.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack dashboard-view" data-testid="dashboard-view">
      <section className="welcome-strip">
        <div>
          <span className="eyebrow">{serverDateLabel}</span>
          <h1>{greeting}, {firstName}.</h1>
          <p>{id ? "Berikut ringkasan operasional proyek PerumNet hari ini." : "Here is today's PerumNet project operations summary."}</p>
        </div>
        {canManage && (
          <button className="button primary" type="button" onClick={() => setShowNewProject(true)}>
            <Plus size={17} /> {id ? "Proyek baru" : "New project"}
          </button>
        )}
      </section>

      <section className="metric-grid" aria-label={id ? "Ringkasan operasional" : "Operations summary"}>
        <article className="metric-card">
          <span className="metric-icon teal"><FolderKanban size={20} /></span>
          <div className="metric-main">
            <span>{id ? "Proyek aktif" : "Active projects"}</span>
            <strong>{stats.active}</strong>
          </div>
          <span className="metric-change positive"><TrendingUp size={13} /> {id ? "2 bulan ini" : "2 this month"}</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue"><CircleDollarSign size={20} /></span>
          <div className="metric-main">
            <span>{id ? "Nilai proyek berjalan" : "Active project value"}</span>
            <strong>{formatCompactCurrency(stats.value, language)}</strong>
          </div>
          <span className="metric-change">{stats.active} {id ? "kontrak berjalan" : "active contracts"}</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><Clock3 size={20} /></span>
          <div className="metric-main">
            <span>{id ? "Piutang diterima" : "Receivables collected"}</span>
            <strong>{formatCompactCurrency(stats.paid, language)}</strong>
          </div>
          <span className="metric-change warning-text">{id ? "Sesuai pembayaran terkonfirmasi" : "Based on confirmed payments"}</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon green"><CheckCircle2 size={20} /></span>
          <div className="metric-main">
            <span>{id ? "Proyek selesai" : "Completed projects"}</span>
            <strong>{stats.completed}</strong>
          </div>
          <span className="metric-change positive">{id ? "Tepat waktu" : "On schedule"}</span>
        </article>
      </section>

      <section className="dashboard-layout">
        <div className="panel project-panel">
          <div className="panel-head project-panel-head">
            <div>
              <span className="eyebrow">{id ? "PORTOFOLIO" : "PORTFOLIO"}</span>
              <h2>{id ? "Proyek terbaru" : "Recent projects"}</h2>
            </div>
            <div className="project-tools">
              <label className="search-field compact">
                <Search size={16} />
                <input
                  type="search"
                  placeholder={id ? "Cari proyek..." : "Search projects..."}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="segmented-control" aria-label={id ? "Filter status proyek" : "Filter project status"}>
                {filters.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={filter === item ? "active" : ""}
                    onClick={() => setFilter(item)}
                  >
                    {localizedLabel(language, item)}
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
                        {localizedLabel(language, project.status)}
                      </span>
                      <span className="project-code">{project.code}</span>
                    </div>
                    <h3>{project.name}</h3>
                    <p>{project.client}</p>
                  </div>
                  <div className="project-meta">
                    <span><MapPin size={14} /> {project.location}</span>
                    <span><CalendarDays size={14} /> {localizedDate(language, project.targetDateIso) }</span>
                    <span><UsersRound size={14} /> {project.manager}</span>
                  </div>
                  <div className="project-progress-row">
                    <div className="progress-copy">
                      <span>{id ? "Progres pekerjaan" : "Work progress"}</span>
                      <strong>{project.progress}%</strong>
                    </div>
                    <div className="progress-track" aria-label={`${id ? "Progres" : "Progress"} ${project.progress}%`}>
                      <span style={{ width: `${project.progress}%` }} />
                    </div>
                  </div>
                </div>
                <div className="project-finance">
                  <span>{id ? "Nilai proyek" : "Project value"}</span>
                  <strong>{project.payment === "Tidak Diizinkan" ? (id ? "Akses terbatas" : "Restricted") : project.value ? formatCurrency(project.value, language) : (id ? "Belum ditentukan" : "Not specified")}</strong>
                  <span className={`status-badge ${paymentClass(project.payment)}`}>
                    {project.payment === "Sebagian" ? `${id ? "Terbayar" : "Paid"} ${project.paidRatio}%` : localizedLabel(language, project.payment)}
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
                      <span>{id ? "Quotation" : "Quotation"}</span>
                    </button>
                  )}
                  <button className="quick-action primary-link" type="button" onClick={() => { onSelectProject(project.id); navigate("project"); }}>
                    <span>{id ? "Detail" : "Details"}</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </article>
            ))}
            {!filteredProjects.length && (
              <div className="empty-state">
                <Search size={28} />
                <h3>{id ? "Proyek tidak ditemukan" : "No projects found"}</h3>
                <p>{id ? "Coba ubah kata kunci atau filter status." : "Try changing the keyword or status filter."}</p>
              </div>
            )}
          </div>
        </div>

        <aside className="dashboard-side">
          <section className="panel attention-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">{id ? "PERLU PERHATIAN" : "NEEDS ATTENTION"}</span>
                <h2>{id ? "Tindak lanjut" : "Follow-up"}</h2>
              </div>
              <span className="count-badge">{attentionProjects.length}</span>
            </div>
            {attentionProjects.map((project) => (
              <button className="attention-item" type="button" key={project.id} onClick={() => { onSelectProject(project.id); navigate(project.payment === "Belum Dibayar" || project.payment === "Sebagian" ? "billing" : "project"); }}>
                <span className={`attention-icon ${project.payment === "Belum Dibayar" ? "danger" : project.payment === "Sebagian" ? "warning" : "info"}`}><FileText size={17} /></span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{localizedLabel(language, project.payment)} · {id ? "progres" : "progress"} {project.progress}%</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
            {!attentionProjects.length && <div className="empty-state compact"><CheckCircle2 size={24} /><p>{id ? "Tidak ada tindak lanjut mendesak." : "No urgent follow-up."}</p></div>}
          </section>

          <section className="panel team-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">{id ? "TIM LAPANGAN" : "FIELD TEAM"}</span>
                <h2>{id ? "Aktivitas hari ini" : "Today's activity"}</h2>
              </div>
            </div>
            {visibleTeam.map((name, index) => (
              <div className="team-activity" key={name}>
                <div className={`avatar small ${index === 1 ? "coral" : index === 2 ? "navy" : ""}`}>{name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</div>
                <div><strong>{name}</strong><span>{id ? "Anggota proyek yang dapat diakses" : "Accessible project member"}</span></div>
              </div>
            ))}
            {!visibleTeam.length && <div className="empty-state compact"><UsersRound size={24} /><p>{id ? "Belum ada anggota proyek." : "No project members yet."}</p></div>}
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
                <span className="eyebrow">{id ? "PROYEK BARU" : "NEW PROJECT"}</span>
                <h2 id="new-project-title">{id ? "Buat draft proyek" : "Create project draft"}</h2>
              </div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowNewProject(false)}>
                <X size={18} />
              </button>
            </div>
            <form className="form-grid" onSubmit={addProject}>
              <label className="field full">
                <span>{id ? "Nama proyek" : "Project name"}</span>
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} required placeholder={id ? "Contoh: Upgrade jaringan kantor" : "Example: Office network upgrade"} />
              </label>
              <label className="field full">
                <span>{id ? "Nama klien" : "Client name"}</span>
                <input value={clientName} onChange={(event) => setClientName(event.target.value)} required placeholder={id ? "Nama perusahaan / klien" : "Company / client name"} />
              </label>
              <label className="field full">
                <span>{id ? "Lokasi" : "Location"}</span>
                <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={id ? "Kota / kabupaten" : "City / district"} />
              </label>
              <div className="modal-actions full">
                <button className="button secondary" type="button" onClick={() => setShowNewProject(false)}>{id ? "Batal" : "Cancel"}</button>
                <button className="button primary" type="submit"><Plus size={16} /> {id ? "Simpan proyek" : "Save project"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
