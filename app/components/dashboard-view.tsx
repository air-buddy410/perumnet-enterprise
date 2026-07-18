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
  projects as seedProjects,
  ProjectStatus,
  ViewKey,
} from "../data";

interface DashboardViewProps {
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
  selectedProjectId?: string;
  userName: string;
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

export function DashboardView({ navigate, notify, selectedProjectId = "", userName }: DashboardViewProps) {
  const [projectList, setProjectList] = useState(seedProjects);
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
        <button className="button primary" type="button" onClick={() => setShowNewProject(true)}>
          <Plus size={17} /> Proyek baru
        </button>
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
          <span className="metric-change">3 kontrak berjalan</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><Clock3 size={20} /></span>
          <div className="metric-main">
            <span>Piutang diterima</span>
            <strong>{formatCompactCurrency(stats.paid)}</strong>
          </div>
          <span className="metric-change warning-text">2 invoice jatuh tempo</span>
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
                  <strong>{project.value ? formatCurrency(project.value) : "Belum ditentukan"}</strong>
                  <span className={`status-badge ${paymentClass(project.payment)}`}>
                    {project.payment === "Sebagian" ? `Terbayar ${project.paidRatio}%` : project.payment}
                  </span>
                </div>
                <div className="project-actions">
                  <button className="quick-action" type="button" onClick={() => navigate("boq")}>
                    <FileSpreadsheet size={16} />
                    <span>BoQ</span>
                  </button>
                  <button className="quick-action" type="button" onClick={() => navigate("billing")}>
                    <FileText size={16} />
                    <span>Quotation</span>
                  </button>
                  <button className="quick-action primary-link" type="button" onClick={() => navigate("project")}>
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
              <span className="count-badge">3</span>
            </div>
            <button className="attention-item" type="button" onClick={() => navigate("billing")}>
              <span className="attention-icon danger"><FileText size={17} /></span>
              <span>
                <strong>Invoice jatuh tempo</strong>
                <small>INV/PN/VII/2026/044 · 2 Agu</small>
              </span>
              <ArrowRight size={15} />
            </button>
            <button className="attention-item" type="button" onClick={() => navigate("project")}>
              <span className="attention-icon warning"><Clock3 size={17} /></span>
              <span>
                <strong>2 tugas terlambat</strong>
                <small>Warehouse · backbone network</small>
              </span>
              <ArrowRight size={15} />
            </button>
            <button className="attention-item" type="button" onClick={() => navigate("bast")}>
              <span className="attention-icon info"><CheckCircle2 size={17} /></span>
              <span>
                <strong>BAST siap ditandatangani</strong>
                <small>Villa Complex · 100% selesai</small>
              </span>
              <ArrowRight size={15} />
            </button>
          </section>

          <section className="panel team-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">TIM LAPANGAN</span>
                <h2>Aktivitas hari ini</h2>
              </div>
            </div>
            <div className="team-activity">
              <div className="avatar small">AS</div>
              <div>
                <strong>Agus Suardana</strong>
                <span>Upload 8 foto dokumentasi</span>
              </div>
              <small>14:28</small>
            </div>
            <div className="team-activity">
              <div className="avatar small coral">KP</div>
              <div>
                <strong>Kadek Putra</strong>
                <span>Menyelesaikan terminasi AP</span>
              </div>
              <small>12:06</small>
            </div>
            <div className="team-activity">
              <div className="avatar small navy">AP</div>
              <div>
                <strong>Ayu Pramesti</strong>
                <span>Memperbarui timeline proyek</span>
              </div>
              <small>09:42</small>
            </div>
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
