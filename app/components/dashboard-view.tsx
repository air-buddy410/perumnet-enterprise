"use client";

import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  FileText,
  MapPin,
  Plus,
  Search,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { ProjectMap, STATUS_COLOUR, STATUS_LABEL, STATUS_ORDER } from "./project-map";
import {
  attentionQueue,
  businessDay,
  dashboardMoney,
  projectStateFigures,
  scopeProjects,
  type ProjectStateFigure,
} from "../dashboard-metrics";
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

/** How many rows of the follow-up queue the side panel has room for. */
const ATTENTION_ROWS = 3;

interface ScheduleWording {
  /** Not one project in this state carries the date it is judged by. */
  missing: string;
  /** Some do and some do not, and none of the dated ones has slipped. */
  untimed: (count: number) => string;
  /** Every one carries the date, and none has slipped. */
  clear: string;
  /** How many have gone past it. Outranks everything above. */
  overdue: (count: number) => string;
}

/**
 * The single line of small print under a project state.
 *
 * Returns null rather than a reassurance whenever the page cannot support one:
 * no projects in the state, or the server's own day not fetched yet. This is
 * the function that replaces "Tepat waktu" — a string that sat under Proyek
 * selesai claiming everything was on time no matter how late anything was — so
 * an empty result is a correct result, and the space it leaves is reserved in
 * the stylesheet rather than filled.
 */
function scheduleFact(figure: ProjectStateFigure, today: string | null, wording: ScheduleWording) {
  if (!figure.count || !today) return null;
  if (!figure.dated) return { text: wording.missing, urgent: false };
  if (figure.overdue) return { text: wording.overdue(figure.overdue), urgent: true };
  if (figure.dated < figure.count) {
    return { text: wording.untimed(figure.count - figure.dated), urgent: false };
  }
  return { text: wording.clear, urgent: false };
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

  // Narrowed once, here, and handed to every figure below. The project picker
  // at the top of the page has to reach all of them or the page argues with
  // itself the moment a single project is selected.
  const scopedProjects = useMemo(
    () => scopeProjects(projectList, selectedProjectId),
    [projectList, selectedProjectId],
  );

  // The server's own calendar day in WITA. Null until /api/system/time answers,
  // which is what keeps a browser with the wrong date from deciding which
  // projects are late.
  const today = serverNow ? businessDay(serverNow) : null;

  const states = useMemo(
    () => projectStateFigures(scopedProjects, today),
    [scopedProjects, today],
  );
  const money = useMemo(() => dashboardMoney(scopedProjects), [scopedProjects]);

  // Keyed by status and rendered through STATUS_ORDER, so this block and the
  // map legend directly above it can never fall into different orders.
  const stateCards: Record<
    ProjectStatus,
    { count: number; fact: { text: string; urgent: boolean } | null }
  > = {
    Draft: {
      count: states.draft.count,
      fact: scheduleFact(states.draft, today, {
        missing: id ? "Tanggal mulai belum diisi" : "No planned start recorded",
        untimed: (count) =>
          id ? `${count} tanpa tanggal mulai` : `${count} with no planned start`,
        clear: id ? "Belum ada yang lewat rencana mulai" : "None past its planned start",
        overdue: (count) =>
          id ? `${count} lewat rencana mulai` : `${count} past the planned start`,
      }),
    },
    Aktif: {
      count: states.active.count,
      fact: scheduleFact(states.active, today, {
        missing: id ? "Tanggal target belum diisi" : "No target date recorded",
        untimed: (count) =>
          id ? `${count} tanpa tanggal target` : `${count} with no target date`,
        clear: id ? "Belum ada yang lewat target" : "None past its target date",
        overdue: (count) =>
          id ? `${count} lewat tanggal target` : `${count} past the target date`,
      }),
    },
    Selesai: {
      count: states.completed.count,
      // Left empty on purpose. Nothing in the data records when a project was
      // finished, so neither "selesai bulan ini" nor the "Tepat waktu" that
      // used to sit here can be computed from this page. An empty line is the
      // honest one; see the note at the top of app/dashboard-metrics.ts.
      fact: null,
    },
  };

  const attentionProjects = attentionQueue(scopedProjects);
  const visibleTeam = Array.from(
    new Set(
      scopedProjects.flatMap(
        (project) => project.teamNames ?? [project.manager].filter(Boolean),
      ),
    ),
  ).slice(0, 3);

  // The map hands back a point the operator clicked. Sending it as a normal
  // project PATCH is what marks the pin as placed by a person, which is what
  // stops a later geocode of the same location text from moving it.
  const placePin = useCallback(
    async (projectId: string, latitude: number, longitude: number) => {
      try {
        const updated = await api<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          body: JSON.stringify({ latitude, longitude }),
        });
        setProjectList((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        notify(id ? "Titik peta proyek tersimpan." : "The project's map pin was saved.");
      } catch (error) {
        notify(messageOf(error, language));
      }
    },
    [id, language, notify],
  );

  const openProject = useCallback(
    (projectId: string) => {
      onSelectProject(projectId);
      navigate("project");
    },
    [navigate, onSelectProject],
  );

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

      <ProjectMap
        language={language}
        projects={scopedProjects}
        canManage={canManage}
        onOpenProject={openProject}
        onPlacePin={placePin}
      />

      {/* Directly under the map, and reading in the same three colours as its
          pins: the state of the work is what the owner opens this page for.
          The legend above already gives the bare counts, so each card here
          carries the one schedule fact that would make somebody act on it. */}
      <section
        className="project-state-grid"
        aria-label={id ? "Status proyek" : "Project states"}
        data-testid="project-state-grid"
      >
        {STATUS_ORDER.map((status) => (
          <article className="project-state-card" key={status} data-status={status}>
            <span className="project-state-dot" style={{ background: STATUS_COLOUR[status] }} />
            <span className="project-state-label">{STATUS_LABEL[status][id ? "id" : "en"]}</span>
            <strong className="project-state-count">{stateCards[status].count}</strong>
            <span
              className={`project-state-fact${stateCards[status].fact?.urgent ? " warning-text" : ""}`}
            >
              {stateCards[status].fact?.text ?? ""}
            </span>
          </article>
        ))}
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
              <div className="segmented-control" role="group" aria-label={id ? "Filter status proyek" : "Filter project status"}>
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
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={id ? "Progres proyek" : "Project progress"}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={project.progress}
                    >
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
              {/* The queue, not the rows. The badge used to be the length of a
                  list that had already been cut to three, so a portfolio with
                  seven follow-ups outstanding reported three of them. */}
              <span className="count-badge">{attentionProjects.length}</span>
            </div>
            {attentionProjects.slice(0, ATTENTION_ROWS).map((project) => (
              <button className="attention-item" type="button" key={project.id} onClick={() => { onSelectProject(project.id); navigate(project.payment === "Belum Dibayar" || project.payment === "Sebagian" ? "billing" : "project"); }}>
                <span className={`attention-icon ${project.payment === "Belum Dibayar" ? "danger" : project.payment === "Sebagian" ? "warning" : "info"}`}><FileText size={17} /></span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{localizedLabel(language, project.payment)} · {id ? "progres" : "progress"} {project.progress}%</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
            {attentionProjects.length > ATTENTION_ROWS && (
              <p className="attention-more">
                {id
                  ? `${attentionProjects.length - ATTENTION_ROWS} lainnya menunggu tindak lanjut.`
                  : `${attentionProjects.length - ATTENTION_ROWS} more are waiting for follow-up.`}
              </p>
            )}
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

      {/* The money, last on the page and below the fold on purpose.
          The owner asked for the map and the three project states to lead and
          for these two figures to be something you scroll to, so they sit under
          the portfolio they summarise rather than above it — one labelled
          section with a sentence saying what each figure counts, instead of two
          bare cards stranded at the bottom. Both follow the project picker like
          everything else on the page. */}
      <section
        className="panel finance-strip"
        aria-label={id ? "Ringkasan keuangan proyek" : "Project financial summary"}
        data-testid="dashboard-finance"
      >
        <div className="panel-head">
          <div>
            <span className="eyebrow">{id ? "RINGKASAN KEUANGAN" : "FINANCIAL SUMMARY"}</span>
            <h2>{id ? "Nilai dan piutang" : "Value and receivables"}</h2>
          </div>
        </div>
        <div className="finance-strip-body">
          <article className="finance-figure">
            <span className="metric-icon blue"><CircleDollarSign size={20} /></span>
            <div className="finance-figure-main">
              <span>{id ? "Nilai proyek berjalan" : "Active project value"}</span>
              <strong>{formatCompactCurrency(money.value, language)}</strong>
              <small>
                {states.active.count}{" "}
                {id ? "kontrak berjalan" : states.active.count === 1 ? "active contract" : "active contracts"}
              </small>
            </div>
          </article>
          <article className="finance-figure">
            <span className="metric-icon orange"><Wallet size={20} /></span>
            <div className="finance-figure-main">
              <span>{id ? "Piutang diterima" : "Receivables collected"}</span>
              <strong>{formatCompactCurrency(money.paid, language)}</strong>
              <small className="warning-text">
                {id ? "Sesuai pembayaran terkonfirmasi" : "Based on confirmed payments"}
              </small>
            </div>
          </article>
          <p className="finance-strip-note">
            {id
              ? "Nilai proyek berjalan menjumlahkan kontrak yang berstatus On progress. Piutang diterima mengikuti porsi setiap proyek yang sudah tertutup pembayaran terkonfirmasi."
              : "Active project value adds up the contracts that are in progress. Receivables collected follows the share of each project that confirmed payments already cover."}
          </p>
        </div>
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
