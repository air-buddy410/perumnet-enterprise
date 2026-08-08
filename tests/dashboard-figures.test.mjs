// The admin dashboard's figures, and the order they are printed in.
//
// Two numbers on that page were never numbers. `"2 bulan ini"` under Proyek
// aktif and `"Tepat waktu"` under Proyek selesai were string literals in the
// JSX: the first claimed two new projects every month of every year, the second
// claimed everything was on schedule however late anything actually was. They
// survived because nothing could hold them against data — the arithmetic lived
// inside a React component, so there was nowhere for a test to stand.
//
// Every test here fails on the commit before the fix:
//
//   * the first block cannot even import app/dashboard-metrics.ts, which did
//     not exist;
//   * the source block finds "2 bulan ini" and "Tepat waktu" still in
//     app/components/dashboard-view.tsx, and finds both money figures rendered
//     above the portfolio instead of below it.
//
// Nothing here boots a server. These are pure functions and a source read, so
// the whole file runs in milliseconds and can be pointed at any date without
// waiting for a clock.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attentionQueue,
  businessDay,
  dashboardMoney,
  projectStateFigures,
  scopeProjects,
} from "../app/dashboard-metrics.ts";

const dashboardSource = readFileSync(
  new URL("../app/components/dashboard-view.tsx", import.meta.url),
  "utf8",
);
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/**
 * The component with its comments taken out.
 *
 * The comments name the two strings that used to be printed here, which is
 * worth keeping — somebody reading that file should learn why the Selesai card
 * has no small print. So the "these must not come back" check reads the code
 * only, and the file is free to go on discussing its own history.
 */
const dashboardCode = dashboardSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

/** A project carrying only the fields the dashboard's figures read. */
function project(overrides = {}) {
  return {
    id: `p-${Math.random().toString(36).slice(2, 10)}`,
    status: "Aktif",
    progress: 100,
    payment: "Lunas",
    paidRatio: 100,
    startDateIso: null,
    targetDateIso: null,
    value: 0,
    ...overrides,
  };
}

// A fixed "today" so the expectations below never move with the wall clock.
const TODAY = "2026-08-07";

// ---------------------------------------------------------------------------
// The day every date is judged against comes from the office, not the host.
// ---------------------------------------------------------------------------

test("the business day follows Asia/Makassar rather than whatever zone the host is in", () => {
  // 23:30 UTC on the 6th is already 07:30 on the 7th in the office. A dashboard
  // that used UTC would call a project due on the 7th "not yet due" for the
  // first eight hours of the working day, every working day.
  assert.equal(businessDay(new Date("2026-08-06T23:30:00Z")), "2026-08-07");
  // And the mirror case: 16:30 UTC on the 7th is 00:30 on the 8th in the office.
  assert.equal(businessDay(new Date("2026-08-07T16:30:00Z")), "2026-08-08");
  // Midnight WITA is the boundary, and it belongs to the new day.
  assert.equal(businessDay(new Date("2026-08-07T16:00:00Z")), "2026-08-08");
  assert.equal(businessDay(new Date("2026-08-07T15:59:59Z")), "2026-08-07");
});

// ---------------------------------------------------------------------------
// The figure that replaced "2 bulan ini": how many active projects are late.
// ---------------------------------------------------------------------------

test("the On progress figure counts what is past its target date, and moves when the data moves", () => {
  const onTime = [
    project({ status: "Aktif", targetDateIso: "2026-09-30" }),
    project({ status: "Aktif", targetDateIso: "2026-08-07" }),
  ];
  assert.deepEqual(projectStateFigures(onTime, TODAY).active, {
    count: 2,
    dated: 2,
    overdue: 0,
  });

  // A project due today is not late. A project due yesterday is.
  const oneLate = [...onTime, project({ status: "Aktif", targetDateIso: "2026-08-06" })];
  assert.equal(projectStateFigures(oneLate, TODAY).active.overdue, 1);

  const twoLate = [...oneLate, project({ status: "Aktif", targetDateIso: "2025-12-01" })];
  assert.equal(projectStateFigures(twoLate, TODAY).active.overdue, 2);
  assert.equal(projectStateFigures(twoLate, TODAY).active.count, 4);

  // The same list read on a later day is later still — the figure is a function
  // of the date, which is exactly what a hardcoded string could never be.
  assert.equal(projectStateFigures(twoLate, "2026-10-01").active.overdue, 4);

  // A project in another state never lands in this count, however late it is.
  const elsewhere = [
    ...twoLate,
    project({ status: "Draft", targetDateIso: "2020-01-01" }),
    project({ status: "Selesai", targetDateIso: "2020-01-01" }),
  ];
  assert.equal(projectStateFigures(elsewhere, TODAY).active.overdue, 2);
});

test("the Deal-an figure counts drafts that are past their planned start", () => {
  const drafts = [
    project({ status: "Draft", startDateIso: "2026-07-10" }),
    project({ status: "Draft", startDateIso: "2026-07-24" }),
    project({ status: "Draft", startDateIso: "2026-12-01" }),
  ];
  assert.deepEqual(projectStateFigures(drafts, TODAY).draft, {
    count: 3,
    dated: 3,
    overdue: 2,
  });
  assert.equal(projectStateFigures(drafts, "2026-07-01").draft.overdue, 0);
});

// ---------------------------------------------------------------------------
// A date nobody entered is not a date that has been met.
// ---------------------------------------------------------------------------

test("projects with no date are reported as undated rather than counted as on schedule", () => {
  // This is the shape production is in: "Proyek baru" on the dashboard posts a
  // name, a client and a location, and no dates at all.
  const undated = [
    project({ status: "Aktif" }),
    project({ status: "Aktif" }),
    project({ status: "Draft" }),
  ];
  const figures = projectStateFigures(undated, TODAY);
  assert.deepEqual(figures.active, { count: 2, dated: 0, overdue: 0 });
  assert.deepEqual(figures.draft, { count: 1, dated: 0, overdue: 0 });

  // Mixed: the caller can tell "one is late" from "two never had a target" and
  // print the right one of the two.
  const mixed = [
    project({ status: "Aktif", targetDateIso: "2026-08-06" }),
    project({ status: "Aktif" }),
    project({ status: "Aktif" }),
  ];
  assert.deepEqual(projectStateFigures(mixed, TODAY).active, {
    count: 3,
    dated: 1,
    overdue: 1,
  });

  // A malformed stored value is treated as absent, never as the year 0.
  const rubbish = [project({ status: "Aktif", targetDateIso: "Belum ditentukan" })];
  assert.deepEqual(projectStateFigures(rubbish, TODAY).active, {
    count: 1,
    dated: 0,
    overdue: 0,
  });
});

test("nothing is called late until the server's own day is known", () => {
  const late = [project({ status: "Aktif", targetDateIso: "2020-01-01" })];
  const figures = projectStateFigures(late, null);
  assert.equal(figures.active.count, 1);
  assert.equal(figures.active.dated, 1);
  assert.equal(figures.active.overdue, 0, "no day, no claim");
});

// ---------------------------------------------------------------------------
// The figure that was dropped rather than replaced.
// ---------------------------------------------------------------------------

test("the Selesai state carries a count and no claim about timing", () => {
  const finished = [
    project({ status: "Selesai", targetDateIso: "2026-08-02" }),
    project({ status: "Selesai", targetDateIso: "2025-01-02" }),
    project({ status: "Aktif" }),
  ];
  const completed = projectStateFigures(finished, TODAY).completed;
  assert.deepEqual(completed, { count: 2 });
  // Nothing in the data records when a project was finished, so the module must
  // not grow a "this month" or an "on time" that would have to be invented.
  assert.deepEqual(Object.keys(completed), ["count"]);
});

// ---------------------------------------------------------------------------
// Empty is zero, not NaN. Production has no projects at all.
// ---------------------------------------------------------------------------

test("an installation with no projects renders zeroes rather than NaN or a dash", () => {
  const figures = projectStateFigures([], TODAY);
  assert.deepEqual(figures, {
    draft: { count: 0, dated: 0, overdue: 0 },
    active: { count: 0, dated: 0, overdue: 0 },
    completed: { count: 0 },
  });
  for (const value of [figures.draft.overdue, figures.active.overdue, figures.completed.count]) {
    assert.ok(Number.isFinite(value), "every figure is a real number at zero projects");
  }

  const money = dashboardMoney([]);
  assert.deepEqual(money, { value: 0, paid: 0 });
  assert.ok(Number.isFinite(money.value) && Number.isFinite(money.paid));
  assert.deepEqual(attentionQueue([]), []);
});

// ---------------------------------------------------------------------------
// The project picker reaches every figure, or the page contradicts itself.
// ---------------------------------------------------------------------------

test("selecting one project narrows every figure on the page, not just the money", () => {
  const chosen = project({
    id: "chosen",
    status: "Aktif",
    targetDateIso: "2026-08-01",
    value: 40_000_000,
    paidRatio: 50,
    progress: 40,
    payment: "Sebagian",
  });
  const others = [
    project({ id: "other-1", status: "Aktif", targetDateIso: "2026-08-02", value: 90_000_000, paidRatio: 100 }),
    project({ id: "other-2", status: "Draft", startDateIso: "2026-01-01" }),
    project({ id: "other-3", status: "Selesai" }),
  ];
  const all = [chosen, ...others];

  assert.equal(scopeProjects(all, "").length, 4, "no selection means the whole portfolio");
  assert.equal(scopeProjects(all, undefined).length, 4);

  const scoped = scopeProjects(all, "chosen");
  assert.deepEqual(scoped.map((item) => item.id), ["chosen"]);

  const figures = projectStateFigures(scoped, TODAY);
  assert.deepEqual(figures.draft, { count: 0, dated: 0, overdue: 0 });
  assert.deepEqual(figures.active, { count: 1, dated: 1, overdue: 1 });
  assert.deepEqual(figures.completed, { count: 0 });

  assert.deepEqual(dashboardMoney(scoped), { value: 40_000_000, paid: 20_000_000 });
  assert.deepEqual(attentionQueue(scoped).map((item) => item.id), ["chosen"]);

  // And the unscoped view really is different, so the assertions above are not
  // passing by accident.
  assert.equal(projectStateFigures(all, TODAY).active.overdue, 2);
  assert.equal(dashboardMoney(all).value, 130_000_000);
});

// ---------------------------------------------------------------------------
// The money keeps its meaning where it lands.
// ---------------------------------------------------------------------------

test("active project value sums only work in progress, and receivables follow the paid share", () => {
  const portfolio = [
    project({ status: "Aktif", value: 100_000_000, paidRatio: 25 }),
    project({ status: "Aktif", value: 50_000_000, paidRatio: 0 }),
    project({ status: "Draft", value: 900_000_000, paidRatio: 0 }),
    project({ status: "Selesai", value: 80_000_000, paidRatio: 100 }),
  ];
  const money = dashboardMoney(portfolio);
  assert.equal(money.value, 150_000_000, "a draft is not a running contract");
  assert.equal(money.paid, 25_000_000 + 0 + 0 + 80_000_000, "every state contributes what it has been paid");
});

// ---------------------------------------------------------------------------
// The follow-up badge counts the queue, not the rows on screen.
// ---------------------------------------------------------------------------

test("the follow-up queue is returned whole so the count badge cannot understate it", () => {
  const queue = [
    project({ status: "Aktif", payment: "Belum Dibayar", progress: 100 }),
    project({ status: "Aktif", payment: "Sebagian", progress: 100 }),
    project({ status: "Aktif", payment: "Lunas", progress: 40 }),
    project({ status: "Draft", payment: "Belum Ada Tagihan", progress: 0 }),
    project({ status: "Aktif", payment: "Belum Dibayar", progress: 10 }),
    // Neither of these belongs in the queue.
    project({ status: "Selesai", payment: "Belum Dibayar", progress: 100 }),
    project({ status: "Aktif", payment: "Lunas", progress: 100 }),
  ];
  assert.equal(attentionQueue(queue).length, 5, "all five, not the three the panel has room for");
});

// ---------------------------------------------------------------------------
// The page itself: the invented strings are gone, and the money is below.
// ---------------------------------------------------------------------------

test("the dashboard no longer prints a figure it did not compute", () => {
  for (const invented of ["2 bulan ini", "2 this month", "Tepat waktu", "On schedule"]) {
    assert.ok(
      !dashboardCode.includes(invented),
      `"${invented}" was a hardcoded claim and must not come back`,
    );
  }

  // The Selesai card is the one that lost its line. It must be rendering an
  // explicit nothing rather than a fresh reassurance in its place.
  assert.match(
    dashboardCode,
    /Selesai:\s*\{[^}]*fact:\s*null,/,
    "the Selesai state prints no schedule claim, because there is no completion date to base one on",
  );
});

test("the map and the three project states lead; the money is below the portfolio", () => {
  const at = (marker) => {
    const index = dashboardSource.indexOf(marker);
    assert.notEqual(index, -1, `expected to find ${marker} in the dashboard`);
    return index;
  };

  const map = at("<ProjectMap");
  const states = at('data-testid="project-state-grid"');
  const portfolio = at('className="dashboard-layout"');
  const finance = at('data-testid="dashboard-finance"');

  assert.ok(map < states, "the map still opens the page");
  assert.ok(states < portfolio, "the three project states sit directly under the map");
  assert.ok(portfolio < finance, "the money sits below the portfolio it summarises");

  // Both money figures, and the only compact-currency formatting on the page,
  // are inside that bottom section — nothing about money renders above it.
  for (const label of ["Nilai proyek berjalan", "Piutang diterima", "Active project value", "Receivables collected"]) {
    assert.ok(at(label) > portfolio, `"${label}" must render below the portfolio`);
  }
  for (
    let index = dashboardSource.indexOf("formatCompactCurrency(");
    index !== -1;
    index = dashboardSource.indexOf("formatCompactCurrency(", index + 1)
  ) {
    // The import at the top of the file is the one permitted occurrence.
    if (index < map) continue;
    assert.ok(index > finance, "a compact currency figure is rendered above the finance section");
  }

  // The receivables hint keeps the meaning it always had.
  assert.ok(dashboardSource.includes("Sesuai pembayaran terkonfirmasi"));
  assert.ok(dashboardSource.includes("Based on confirmed payments"));
});

test("the empty line under Selesai still holds its height so the three cards line up", () => {
  assert.match(
    stylesheet,
    /\.project-state-fact\s*\{[^}]*min-height:\s*\d+px;/,
    "the Selesai card prints no fact, and the row it leaves must not collapse",
  );
});
