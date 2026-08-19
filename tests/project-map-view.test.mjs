// Where the project map points itself.
//
// The owner's ask was "saat workspace dirubah, maps otomatis akan
// memperlihatkan lokasi proyek tersebut" — change the workspace and the map
// shows that project — "dan jika nanti project sudah banyak, saat ada di semua
// project dia akan zoom out untuk memperlihatkan semua project". Following the
// picker is the easy half. The hard half is everything that must NOT move the
// map: a language toggle, a pin being placed, a project being created, the
// list being refetched. Each of those hands the component a brand-new
// `projects` array, and a map that re-fits on every new array quietly throws
// away a pan the operator performed on purpose, over and over.
//
// Before this change the component re-fitted on exactly that signal — array
// identity — inside the effect that draws the markers, so all of the above did
// move it. The rule now lives in app/map-framing.ts as two pure functions, and
// this file holds it against the sequences that used to get it wrong. Nothing
// here boots a server: it is arithmetic and a source read, and it runs in
// milliseconds.
//
// The second block is the clustering. Its behaviour is Leaflet's and belongs in
// a browser, but three decisions about it are ours, are invisible from a
// screenshot, and would be silently undone by a well-meaning edit: the cluster
// radius is not the plugin's default, the plugin's own colour-by-size badges
// are not imported, and the badge counts read in both languages.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideFrame, frameKey } from "../app/map-framing.ts";

const mapSource = readFileSync(
  new URL("../app/components/project-map.tsx", import.meta.url),
  "utf8",
);
const clusterSource = readFileSync(
  new URL("../app/components/project-map-cluster.ts", import.meta.url),
  "utf8",
);
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/**
 * Source with the comments taken out, so prose cannot satisfy a check.
 *
 * Both files discuss the things they must not do — importing the plugin's own
 * badge stylesheet, leaving the radius at 80 — and should go on discussing
 * them, so the "these must not come back" checks read the code only.
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const mapCode = stripComments(mapSource);
const clusterCode = stripComments(clusterSource);

const pin = (id, latitude, longitude) => ({ id, latitude, longitude });

const DENPASAR = pin("denpasar", -8.65, 115.2167);
const UBUD = pin("ubud", -8.5069, 115.2625);
const KARANGASEM = pin("karangasem", -8.4489, 115.6122);

/**
 * The component's own bookkeeping, in eight lines, so a sequence of selections
 * can be played through the real decision function rather than described.
 *
 * `moves` records what the view actually did, which is the thing under test —
 * "fit" means it moved, and the flag says whether it flew or jumped.
 */
function mapView() {
  let applied = null;
  let framed = false;
  const moves = [];
  return {
    moves,
    show(pins) {
      const key = frameKey(pins);
      const decision = decideFrame(key, applied);
      if (decision === "fit") {
        moves.push(framed ? "fly" : "jump");
        framed = true;
      } else {
        moves.push(decision);
      }
      if (decision !== "skip") applied = key;
      return decision;
    },
  };
}

// ---------------------------------------------------------------------------
// frameKey — what counts as "the same view".
// ---------------------------------------------------------------------------

test("the frame a set of pins asks for does not depend on the order they arrive in", () => {
  assert.equal(
    frameKey([DENPASAR, UBUD, KARANGASEM]),
    frameKey([KARANGASEM, DENPASAR, UBUD]),
    "the server is free to re-sort the project list; that is not a reason to move the map",
  );
  assert.equal(frameKey([]), "", "no pins is the empty frame, whichever projects were filtered out");
  assert.notEqual(frameKey([DENPASAR]), frameKey([DENPASAR, UBUD]));
});

test("a pin that moves is a new frame, and a pin that only looks different is not", () => {
  const moved = pin("denpasar", -8.71, 115.19);
  assert.notEqual(
    frameKey([DENPASAR]),
    frameKey([moved]),
    "the same project pinned somewhere else has to be re-framed",
  );
  // The API stores six decimals and the key keeps five, so two values that mean
  // the same place to within a metre must not read as two different frames.
  assert.equal(frameKey([pin("a", -8.650001, 115.216701)]), frameKey([pin("a", -8.650002, 115.2167)]));
});

// ---------------------------------------------------------------------------
// decideFrame — the whole rule.
// ---------------------------------------------------------------------------

test("the view follows the picker: one project frames it, all projects frame them all", () => {
  const view = mapView();

  // The dashboard mounts, the project list arrives. First framing, no animation
  // — the map is arriving at its subject, not travelling between two of them.
  assert.equal(view.show([DENPASAR, UBUD, KARANGASEM]), "fit");

  // The workspace picker narrows to one project. This is the ask, and it is the
  // case that has to animate.
  assert.equal(view.show([UBUD]), "fit");

  // Back to all projects.
  assert.equal(view.show([DENPASAR, UBUD, KARANGASEM]), "fit");

  assert.deepEqual(view.moves, ["jump", "fly", "fly"]);
});

test("nothing but the selection moves the map", () => {
  const view = mapView();
  view.show([DENPASAR, UBUD]);

  // Every one of these hands the component a fresh array with the same pins in
  // it — a language toggle, a refetch, a re-render after an unrelated edit, and
  // the picker being pointed at the project it is already pointed at. Before
  // this change each of them re-fitted, and each of them threw away whatever
  // the operator had panned to.
  for (const repeat of [
    [DENPASAR, UBUD],
    [UBUD, DENPASAR],
    [{ ...DENPASAR }, { ...UBUD }],
  ]) {
    assert.equal(view.show(repeat), "skip");
  }

  assert.deepEqual(view.moves, ["jump", "skip", "skip", "skip"]);
});

test("selecting a project that has no pin keeps the view instead of blanking it", () => {
  const view = mapView();
  view.show([DENPASAR, UBUD, KARANGASEM]);

  // The picker lands on a project whose location was never recognised. There is
  // nothing to frame; flying off to the whole island would be movement in
  // response to there being nothing to look at, underneath the overlay that
  // already says so in words.
  assert.equal(view.show([]), "hold");

  // And coming back out of it still moves — the hold must not have convinced
  // the map it was already showing the portfolio.
  assert.equal(view.show([DENPASAR, UBUD, KARANGASEM]), "fit");
  assert.deepEqual(view.moves, ["jump", "hold", "fly"]);
});

test("a map that has never shown anything opens on Bali, and does so exactly once", () => {
  const view = mapView();
  // /api/projects has not answered yet, so the first render has no projects at
  // all. There is no earlier view to preserve, so the default frame is right.
  assert.equal(view.show([]), "reset");
  assert.equal(view.show([]), "skip", "and it is not re-applied on every render while it waits");

  // When the pins do arrive this is still the map's first sight of them, so it
  // settles on them rather than flying.
  assert.equal(view.show([DENPASAR, UBUD]), "fit");
  assert.deepEqual(view.moves, ["reset", "skip", "jump"]);
});

test("a zero-project dashboard never leaves the default view", () => {
  const view = mapView();
  view.show([]);
  view.show([]);
  view.show([]);
  assert.deepEqual(view.moves, ["reset", "skip", "skip"]);
});

// ---------------------------------------------------------------------------
// The decisions in the component that a screenshot cannot show.
// ---------------------------------------------------------------------------

test("the component fits through the rule rather than on every render", () => {
  assert.match(
    mapCode,
    /decideFrame\(frame, frameRef\.current\)/,
    "the marker effect asks map-framing whether it is allowed to move",
  );
  assert.doesNotMatch(
    mapCode.slice(mapCode.indexOf("const frame = frameKey")),
    /applyView\([^)]*\)\s*;\s*\n\s*\}, \[id, mapped, ready\]/,
    "no unconditional re-fit at the end of the marker effect",
  );
  // The transition, and the one case that must not have one.
  assert.match(mapCode, /flyToBounds/, "a changed selection flies rather than teleports");
  assert.match(mapCode, /prefers-reduced-motion: reduce/);
  assert.match(
    mapCode,
    /framedRef\.current && !prefersReducedMotion\(\)/,
    "reduced motion, and the very first framing, both get the jump",
  );
  // The reasoning behind maxZoom 13 is load-bearing for a single selected
  // project and has to survive.
  assert.match(mapSource, /maxZoom: 13/);
  assert.match(mapSource, /single site in its village/);
  // The two deliberate input restrictions the map has always carried.
  assert.match(mapCode, /scrollWheelZoom: false/);
  assert.match(mapCode, /dragging: !leaflet\.Browser\.mobile/);
});

test("clustering is tuned for Bali rather than left on the plugin's default", () => {
  assert.match(mapCode, /const CLUSTER_RADIUS = 32/);
  assert.match(mapCode, /maxClusterRadius: CLUSTER_RADIUS/);
  assert.ok(
    !/maxClusterRadius:\s*80/.test(mapCode),
    "80px is a quarter of Bali at the default view and would swallow Denpasar and Ubud together",
  );
  assert.match(mapCode, /zoomToBoundsOnClick: true/, "clicking a badge opens what is under it");
});

test("the cluster badge wears no state colour, and says its mix in both languages", () => {
  // The plugin's own badges are green/yellow/orange by size, which on a map
  // whose entire language is "a colour is a state" would be a lie. Importing
  // that stylesheet is the easy accident; this is the guard against it.
  assert.match(clusterCode, /leaflet\.markercluster\/dist\/MarkerCluster\.css/);
  assert.ok(
    !clusterCode.includes("MarkerCluster.Default.css"),
    "the plugin's colour-by-size badges must not be imported",
  );
  // Leaflet has to have run before the plugin, which reads a bare global `L`.
  // ES modules evaluate in import order, so the order of these two lines is the
  // whole of the guarantee — swapping them is a ReferenceError at load.
  assert.ok(
    clusterCode.indexOf('from "leaflet"') < clusterCode.indexOf('from "leaflet.markercluster"'),
    "the plugin is imported after Leaflet, or it throws on evaluation",
  );
  // And the group is built from the plugin's own export, not from the Leaflet
  // namespace: `L.markerClusterGroup` is undefined once this is bundled.
  assert.match(clusterCode, /new MarkerClusterGroup\(options\)/);
  assert.ok(
    !/Leaflet\.markerClusterGroup/.test(clusterCode),
    "the augmented Leaflet namespace does not carry the factory after bundling",
  );

  assert.match(mapCode, /proyek di area ini/, "Indonesian count");
  assert.match(mapCode, /in this area/, "English count");
  assert.match(mapCode, /total === 1 \? "project" : "projects"/, "and the English plural is real");

  // The badge is named and reachable, not just drawn.
  assert.match(mapCode, /element\.setAttribute\("aria-label", label\)/);
  assert.match(mapCode, /keyboard: true/);
  assert.match(mapCode, /marker\.on\("keypress"/, "Enter opens a pin, as it does a badge");

  assert.match(stylesheet, /\.project-map-cluster \{/, "the badge is styled by this application");
  assert.match(
    stylesheet,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.project-map-canvas \.leaflet-cluster-anim/,
    "and the plugin's own split/merge animation is stood down for reduced motion",
  );
});
