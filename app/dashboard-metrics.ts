/**
 * Every number the admin dashboard prints, and nothing else.
 *
 * This module exists because two of the dashboard's figures were not figures at
 * all. "2 bulan ini" under Proyek aktif and "Tepat waktu" under Proyek selesai
 * were string literals in the JSX: the first claimed two new projects every
 * month of every year regardless of the data, the second claimed everything was
 * on schedule while a project sat a fortnight past its target date. Pulling the
 * arithmetic out of the component and into a plain module is what lets a test
 * hold each figure against a fixed set of projects and a fixed date, which is
 * the only way that class of bug stays fixed.
 *
 * Three rules the functions below keep:
 *
 *   1. Scope first. The dashboard has a project picker; while one project is
 *      selected every figure must describe that project alone. `scopeProjects`
 *      is the single place that narrowing happens, and everything else takes
 *      the already-narrowed list, so a new figure cannot quietly be computed
 *      over the whole portfolio and contradict the rest of the page.
 *   2. A missing date is missing, not zero. `start_date` and `target_date` are
 *      both nullable — a project created from the dashboard's own "Proyek baru"
 *      form has neither — so each state reports how many of its projects carry
 *      the date at all alongside how many have passed it. A card that says
 *      "none past its target date" when no target date has ever been entered is
 *      the same lie in a quieter voice, and the caller needs both counts to
 *      avoid telling it.
 *   3. Dates are compared as calendar days in Asia/Makassar, taken from the
 *      server's clock. Not the browser's: a laptop with the wrong date would
 *      otherwise decide which projects are late.
 *
 * What is deliberately absent: how many projects finished this month. Nothing
 * in the data records when a project was finished. The `projects` table carries
 * `start_date`, `target_date`, `created_at` and `updated_at`, and `updated_at`
 * moves on any edit at all — renaming a project would "complete" it again. The
 * Selesai card therefore carries its count and no claim about timing, which is
 * the honest reading of what the page knows.
 */

import type { Project } from "./data";

/** Every date in this application is a WITA business day. */
export const PROJECT_TIME_ZONE = "Asia/Makassar";

/**
 * The calendar day an instant falls on in WITA, as `YYYY-MM-DD`.
 *
 * Formatted through Intl rather than by hand because the office is at UTC+8
 * while the server may not be: at 08:00 WITA on the 7th it is still the 6th in
 * UTC, and "past its target date" must follow the office, not the host.
 */
export function businessDay(instant: Date, timeZone: string = PROJECT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The `YYYY-MM-DD` head of a stored date, or null when the field is empty or
 * malformed. Two `YYYY-MM-DD` strings sort exactly as the days they name, so
 * every comparison below is a string comparison and no Date is constructed —
 * which keeps the host's own time zone out of the answer entirely.
 */
function calendarDay(value?: string | null): string | null {
  if (!value) return null;
  const day = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * The project picker at the top of the page. An empty id means "all projects",
 * which is also what the picker's own "Semua proyek" entry sends.
 */
export function scopeProjects(projects: Project[], selectedProjectId?: string): Project[] {
  if (!selectedProjectId) return projects;
  return projects.filter((project) => project.id === selectedProjectId);
}

/** One project state, and the one schedule fact the dashboard prints under it. */
export interface ProjectStateFigure {
  /** Projects in this state. */
  count: number;
  /** How many of them carry the date this state is judged by. */
  dated: number;
  /** How many of those the date has already gone past. Never exceeds `dated`. */
  overdue: number;
}

export interface DashboardStateFigures {
  /** Draft — the owner's "Deal-an". Judged by its planned start date. */
  draft: ProjectStateFigure;
  /** Aktif — "On progress". Judged by its target completion date. */
  active: ProjectStateFigure;
  /**
   * Selesai. Carries a count and nothing more: see the note at the top of this
   * file. There is no completion date to measure "this month" or "on time"
   * against, so neither is offered.
   */
  completed: { count: number };
}

function stateFigure(
  projects: Project[],
  status: Project["status"],
  dateOf: (project: Project) => string | null | undefined,
  today: string | null,
): ProjectStateFigure {
  const inState = projects.filter((project) => project.status === status);
  const days = inState.map((project) => calendarDay(dateOf(project))).filter((day): day is string => day !== null);
  return {
    count: inState.length,
    dated: days.length,
    // Without the server's day nothing can be called late yet. Reporting zero
    // overdue in that window would be a claim; the caller checks `today` too
    // and prints nothing until it has one.
    overdue: today ? days.filter((day) => day < today).length : 0,
  };
}

/**
 * The three project states, computed over an already-scoped project list.
 *
 * `today` is the WITA business day from the server clock, or null while the
 * clock is still being fetched.
 */
export function projectStateFigures(
  projects: Project[],
  today: string | null,
): DashboardStateFigures {
  return {
    draft: stateFigure(projects, "Draft", (project) => project.startDateIso, today),
    active: stateFigure(projects, "Aktif", (project) => project.targetDateIso, today),
    completed: { count: projects.filter((project) => project.status === "Selesai").length },
  };
}

export interface DashboardMoney {
  /** Contract value of the work currently in progress. */
  value: number;
  /** The share of each project's value that confirmed payments already cover. */
  paid: number;
}

/**
 * The two money figures, unchanged in meaning from the cards they came from —
 * only their position on the page moved. `paidRatio` is the posted-payment
 * share of a project's invoices, so `paid` is that share of the contract value
 * rather than a bank balance, which is what "sesuai pembayaran terkonfirmasi"
 * has always meant here.
 */
export function dashboardMoney(projects: Project[]): DashboardMoney {
  return {
    value: projects
      .filter((project) => project.status === "Aktif")
      .reduce((sum, project) => sum + project.value, 0),
    paid: projects.reduce((sum, project) => sum + project.value * (project.paidRatio / 100), 0),
  };
}

/**
 * The follow-up queue behind "Perlu perhatian". Returned whole: the panel shows
 * the first few rows, but its count badge has to count the queue rather than
 * the rows, which is the bug this replaced.
 */
export function attentionQueue(projects: Project[]): Project[] {
  return projects.filter(
    (project) =>
      project.status !== "Selesai" &&
      (project.payment === "Belum Dibayar" ||
        project.payment === "Sebagian" ||
        project.progress < 100),
  );
}
