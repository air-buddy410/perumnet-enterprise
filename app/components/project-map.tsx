"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { MapPinned, MapPinPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Project, ProjectStatus } from "../data";
import { type AppLanguage } from "../i18n";
import { decideFrame, frameKey } from "../map-framing";

/**
 * The project map on the admin dashboard.
 *
 * Three things about this component are load-bearing rather than incidental.
 *
 * Scope: it never queries anything. Every pin comes from the `projects` array
 * the dashboard already holds, which is the response of `GET /api/projects` —
 * a list the server has already narrowed with `projectScopeCondition`. A map is
 * exactly the kind of feature that grows its own "give me all the pins" API and
 * quietly hands a Project Manager the coordinates of work they cannot otherwise
 * see; there is no such endpoint, and there must not be one.
 *
 * Loading: Leaflet touches `window` the moment it is imported, so it is pulled
 * in with a dynamic `import()` inside an effect. That keeps it out of the server
 * render and out of the initial JavaScript for /admin — measured: the sign-in
 * screen never fetches the chunk, and the dashboard fetches it once. The marker
 * clustering plugin rides in the same deferred chunk, behind
 * `./project-map-cluster`, for the same reason and with the same measurement.
 * Leaflet's stylesheet is a static import and so does ship with the page (about
 * 2.7 kB gzipped), which is the price of the panel and its empty state
 * rendering correctly on the server instead of popping in after hydration; the
 * plugin's stylesheet is not needed until the map exists and so does not.
 *
 * Framing: the view follows the workspace picker, and only the workspace
 * picker. `app/map-framing.ts` holds the rule and explains why it is a rule
 * rather than "re-fit whenever `projects` changes".
 */

// Bali, framed so the whole island and the near parts of Lombok fit. Used when
// there is nothing to fit the view to yet, which on a fresh installation is
// what the owner sees first.
const BALI_CENTRE: [number, number] = [-8.42, 115.16];
const BALI_ZOOM = 9;

// The three colours are the ones the status badges already use elsewhere in the
// application, so a project reads the same on the map as it does on its card.
// Exported because the project-state block sits directly under the map and has
// to agree with it: one definition, or the dot beside "On progress" drifts away
// from the pins it is describing.
export const STATUS_COLOUR: Record<ProjectStatus, string> = {
  Draft: "#6d7b7d",
  Aktif: "#007a74",
  Selesai: "#267653",
};

// The owner's own words for the three states, and their English equivalents.
export const STATUS_LABEL: Record<ProjectStatus, { id: string; en: string }> = {
  Draft: { id: "Deal-an", en: "In negotiation" },
  Aktif: { id: "On progress", en: "In progress" },
  Selesai: { id: "Selesai", en: "Completed" },
};

// Deal-an, then On progress, then Selesai — the order the work moves in, and
// the order the legend and the state block under it both read in.
export const STATUS_ORDER: ProjectStatus[] = ["Draft", "Aktif", "Selesai"];

// Asymmetric on purpose: the extra room at the bottom keeps the southernmost
// pin clear of the attribution strip, which is required to be there and which
// paints over anything underneath it.
const FIT_OPTIONS = {
  paddingTopLeft: [30, 30] as [number, number],
  paddingBottomRight: [30, 48] as [number, number],
  // Close enough to place a single site in its village, far enough not to look
  // like a mistake when only one project has a pin.
  maxZoom: 13,
};

// Long enough to read as one continuous move across the island, short enough
// not to make somebody wait for their own click. Leaflet's own default is
// distance-dependent and can run well past a second on a long hop.
const FLY_SECONDS = 0.7;

/**
 * How close two pins have to be before they are drawn as one badge.
 *
 * The plugin's default is 80px, which is wrong for Bali specifically. The
 * island fits this panel at about zoom 9, where 80px is roughly 24km — Denpasar
 * and Ubud are 17km apart and would collapse into a single badge in the default
 * view, hiding two pins that were perfectly legible side by side. That is the
 * failure mode clustering is supposed to cure, not cause.
 *
 * 32px is the honest threshold instead: a pin is 22px across, so two pins whose
 * centres are 32px apart are already overlapping and one of them is already
 * partly hidden. Below that, merging them shows more than leaving them; above
 * it, merging them shows less. At the all-Bali view that keeps Denpasar, Ubud,
 * Karangasem, Singaraja and Nusa Penida as five separate pins while grouping
 * the sites *within* each of those towns, which is what the owner asked for.
 */
const CLUSTER_RADIUS = 32;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function applyView(map: Leaflet.Map, bounds: Leaflet.LatLngBounds | null, animate: boolean) {
  if (!bounds) {
    map.setView(BALI_CENTRE, BALI_ZOOM);
    return;
  }
  // A map that teleports between two places on the same island reads as a
  // different map; the same map moving reads as the same map moving. Under
  // `prefers-reduced-motion` the caller asks for the jump, and gets it.
  if (animate) map.flyToBounds(bounds, { ...FIT_OPTIONS, duration: FLY_SECONDS });
  else map.fitBounds(bounds, FIT_OPTIONS);
}

function isMapped(project: Project): project is Project & { latitude: number; longitude: number } {
  return typeof project.latitude === "number" && typeof project.longitude === "number";
}

/** A marker that remembers which state it is drawing, so a cluster can tally. */
type ProjectMarker = Leaflet.Marker & { projectStatus?: ProjectStatus };

/**
 * A DivIcon that carries its own accessible name.
 *
 * Leaflet applies `title` to a marker element but never `aria-label`, and a div
 * icon gets no `alt` either — which is why this component has always set the
 * attribute by hand after adding the marker. Clustering breaks that approach:
 * markercluster destroys and rebuilds a marker's element every time a group
 * opens or closes, so an attribute set once is gone after the first zoom, and a
 * cluster badge has no element to set anything on until it appears. Stamping it
 * inside `createIcon` is the one place that covers every element Leaflet will
 * ever build for this icon.
 */
function labelledIcon(
  leaflet: typeof Leaflet,
  options: Leaflet.DivIconOptions,
  label: string,
): Leaflet.DivIcon {
  const icon = leaflet.divIcon(options);
  const create = icon.createIcon.bind(icon);
  icon.createIcon = (oldIcon?: HTMLElement) => {
    const element = create(oldIcon);
    element.setAttribute("aria-label", label);
    element.setAttribute("title", label);
    return element;
  };
  return icon;
}

/**
 * The badge a cluster wears.
 *
 * A cluster stands for several projects and they will usually not all be in the
 * same state, so it cannot take one of the three state colours: a green badge
 * over two deals and a finished job is the map saying something untrue. The
 * plugin's own `MarkerCluster.Default.css` is no help — its badges are green,
 * yellow and orange *by size*, which on this map reads as precisely the thing
 * it does not mean, and is why that stylesheet is not imported.
 *
 * So the badge is neutral where it counts: a white disc carrying the number, in
 * the same ink and weight as the tallies in the legend above. The mix is told
 * by the ring around it, split into arcs in proportion to the states inside, in
 * the same three colours as the pins — three drafts wear a solid grey ring, a
 * mixed group wears a divided one. That costs no extra space, because a badge
 * on a map needed an outline anyway, and it adds no text. Colour is not the
 * only channel: the accessible name and the hover tooltip both spell the
 * breakdown out in words, in the reading language.
 */
function clusterIcon(
  leaflet: typeof Leaflet,
  cluster: Leaflet.MarkerCluster,
  id: boolean,
): Leaflet.DivIcon {
  const tally: Record<ProjectStatus, number> = { Draft: 0, Aktif: 0, Selesai: 0 };
  for (const child of cluster.getAllChildMarkers()) {
    const status = (child as ProjectMarker).projectStatus;
    if (status) tally[status] += 1;
  }
  const total = cluster.getChildCount();
  const counted = STATUS_ORDER.reduce((sum, status) => sum + tally[status], 0);

  const arcs: string[] = [];
  let cursor = 0;
  for (const status of STATUS_ORDER) {
    if (!tally[status]) continue;
    const from = (cursor / counted) * 100;
    cursor += tally[status];
    const to = (cursor / counted) * 100;
    arcs.push(`${STATUS_COLOUR[status]} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
  }

  // A cluster whose children all somehow arrived without a state cannot happen
  // from this component, but a ring built from nothing would be an invalid
  // gradient and the badge would silently lose its outline over pale tiles.
  const ring = arcs.length ? `conic-gradient(${arcs.join(",")})` : STATUS_COLOUR.Draft;

  const breakdown = STATUS_ORDER.filter((status) => tally[status])
    .map((status) => `${tally[status]} ${STATUS_LABEL[status][id ? "id" : "en"]}`)
    .join(", ");
  // Indonesian does not inflect the noun for number and a cluster is never one
  // project, but the singular is spelled out rather than assumed away.
  const label = id
    ? `${total} proyek di area ini: ${breakdown}.`
    : `${total} ${total === 1 ? "project" : "projects"} in this area: ${breakdown}.`;

  return labelledIcon(
    leaflet,
    {
      className: "project-map-cluster-icon",
      html: `<span class="project-map-cluster" style="background:${ring}"><b>${total}</b></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    },
    label,
  );
}

export interface ProjectMapProps {
  language: AppLanguage;
  projects: Project[];
  canManage: boolean;
  onOpenProject: (projectId: string) => void;
  onPlacePin: (projectId: string, latitude: number, longitude: number) => void;
}

export function ProjectMap({
  language,
  projects,
  canManage,
  onOpenProject,
  onPlacePin,
}: ProjectMapProps) {
  const id = language === "id";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const markersRef = useRef(new Map<string, Leaflet.Marker>());
  const clusterRef = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const boundsRef = useRef<Leaflet.LatLngBounds | null>(null);
  // The frame the view was last pointed at, and whether it has ever been
  // pointed at pins at all. Together they are what keeps the map from moving
  // for any reason other than the selection changing — see ../map-framing.
  const frameRef = useRef<string | null>(null);
  const framedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pinTarget, setPinTarget] = useState("");

  const mapped = useMemo(() => projects.filter(isMapped), [projects]);
  const unmapped = useMemo(() => projects.filter((project) => !isMapped(project)), [projects]);
  const counts = useMemo(() => {
    const tally: Record<ProjectStatus, number> = { Draft: 0, Aktif: 0, Selesai: 0 };
    for (const project of mapped) tally[project.status] += 1;
    return tally;
  }, [mapped]);

  // Held in refs so the map's own listeners — registered once, when the map is
  // built — always reach the current props and state without the map having to
  // be torn down and rebuilt on every render.
  const placeHandler = useRef<(latitude: number, longitude: number) => void>(() => {});
  const openHandler = useRef(onOpenProject);
  // The cluster group's `iconCreateFunction` is registered once, when the map
  // is built, but the badge it draws is bilingual.
  const languageRef = useRef(id);

  useEffect(() => {
    languageRef.current = id;
  }, [id]);

  useEffect(() => {
    placeHandler.current = (latitude, longitude) => {
      if (!pinMode || !pinTarget) return;
      setPinMode(false);
      onPlacePin(pinTarget, Number(latitude.toFixed(6)), Number(longitude.toFixed(6)));
    };
    openHandler.current = onOpenProject;
  }, [onOpenProject, onPlacePin, pinMode, pinTarget]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    const markers = markersRef.current;
    if (!container) return;

    void (async () => {
      try {
        const leaflet = await import("leaflet");
        // Sequential, and it has to stay that way: the clustering plugin reads
        // the global `L` that Leaflet's own bundle installs on evaluation. See
        // ./project-map-cluster for the whole of that story.
        const { createClusterGroup } = await import("./project-map-cluster");
        if (cancelled || !containerRef.current) return;
        leafletRef.current = leaflet;
        const map = leaflet.map(containerRef.current, {
          center: BALI_CENTRE,
          zoom: BALI_ZOOM,
          // The map sits at the top of a long, scrollable page. A wheel that
          // zooms instead of scrolling past is the classic embedded-map trap,
          // and on a phone a one-finger drag that pans the map is the same trap
          // with no way out — Leaflet's own advice for an embedded map is to
          // leave dragging to pointer devices. Both zoom buttons and pinch
          // still work everywhere, and the view is fitted to the pins anyway.
          scrollWheelZoom: false,
          dragging: !leaflet.Browser.mobile,
          attributionControl: true,
        });
        // Leaflet's default attribution prefix is its own branding — a Ukrainian
        // flag and a link to leafletjs.com — which is the library advertising
        // itself, not a credit anyone is owed. Dropping the prefix leaves the
        // OpenStreetMap credit added by the tile layer below, which IS required
        // by the tile usage policy and must never be removed.
        map.attributionControl.setPrefix(false);
        leaflet
          .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 18,
            // Required by the OpenStreetMap tile usage policy.
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          })
          .addTo(map);
        map.on("click", (event: Leaflet.LeafletMouseEvent) => {
          placeHandler.current(event.latlng.lat, event.latlng.lng);
        });

        const clusters = createClusterGroup({
          maxClusterRadius: CLUSTER_RADIUS,
          // The hover hull is the plugin's most decorative feature and the one
          // nobody asked for: a polygon that flashes over the island whenever
          // the pointer crosses a badge. The badge already says how many, and
          // clicking it shows exactly where.
          showCoverageOnHover: false,
          // Clicking a cluster zooms to its contents; at the tile layer's
          // deepest zoom, sites that are genuinely on top of each other fan out
          // instead, because there is no zoom left to separate them with.
          zoomToBoundsOnClick: true,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: (cluster) => clusterIcon(leaflet, cluster, languageRef.current),
        });
        clusters.addTo(map);

        mapRef.current = map;
        clusterRef.current = clusters;
        setReady(true);
      } catch {
        // A chunk that will not load must not take the rest of the dashboard
        // with it; the panel says so instead of rendering an empty grey box.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markers.clear();
      frameRef.current = null;
      framedRef.current = false;
      setReady(false);
    };
  }, []);

  // The container is inside a responsive grid and beside a collapsible sidebar,
  // so its width changes without the window ever resizing. Leaflet caches the
  // size it was built at and renders half a map until it is told otherwise —
  // and a frame of a different shape needs the pins framed again, or the ones
  // near the edge end up cropped.
  useEffect(() => {
    const container = containerRef.current;
    if (!ready || !container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize();
      // Never animated, and never when there is nothing to frame: a resize is a
      // correction to the view the operator is already looking at, not a
      // journey to a new one, and with no pins there is nothing to correct —
      // dropping back to the whole island would throw away a pan they made.
      if (boundsRef.current) applyView(map, boundsRef.current, false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const clusters = clusterRef.current;
    if (!ready || !leaflet || !map || !clusters) return;

    const markers = markersRef.current;
    const seen = new Set<string>();
    const added: Leaflet.Marker[] = [];

    for (const project of mapped) {
      seen.add(project.id);
      const position: [number, number] = [project.latitude, project.longitude];
      const colour = STATUS_COLOUR[project.status];
      const label = `${project.name} — ${STATUS_LABEL[project.status][id ? "id" : "en"]}`;
      const icon = labelledIcon(
        leaflet,
        {
          className: "project-map-marker",
          html: `<span class="project-map-pin" style="background:${colour}"></span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        },
        label,
      );
      const existing = markers.get(project.id) as ProjectMarker | undefined;
      if (existing) {
        existing.setLatLng(position);
        existing.setIcon(icon);
        existing.options.title = label;
        existing.projectStatus = project.status;
        continue;
      }
      const marker = leaflet.marker(position, {
        icon,
        title: label,
        alt: label,
        riseOnHover: true,
        keyboard: true,
      }) as ProjectMarker;
      marker.projectStatus = project.status;
      marker.on("click", () => openHandler.current(project.id));
      // Leaflet gives a marker `tabindex="0"` and `role="button"` but stops
      // there: a div is not a button, so Enter did nothing. The cluster badge
      // next to it does respond to Enter — markercluster binds
      // `clusterkeypress` — and a map where a keyboard can open five projects
      // at once but not one of them on its own is worse than either.
      marker.on("keypress", (event) => {
        const key = (event as Leaflet.LeafletKeyboardEvent).originalEvent?.key;
        if (key === "Enter") openHandler.current(project.id);
      });
      markers.set(project.id, marker);
      added.push(marker);
    }

    const dropped: Leaflet.Marker[] = [];
    for (const [projectId, marker] of markers) {
      if (seen.has(projectId)) continue;
      dropped.push(marker);
      markers.delete(projectId);
    }

    // In bulk rather than one at a time: every single add or remove re-runs the
    // clustering pass, and the picker swapping the whole portfolio for one
    // project is the common case, not the rare one.
    if (dropped.length) clusters.removeLayers(dropped);
    if (added.length) clusters.addLayers(added);
    // A status change repaints a pin and a language change rewrites its label;
    // the badges above them have to be told, or a cluster keeps yesterday's mix
    // in its ring and the other language in its accessible name.
    if (markers.size) clusters.refreshClusters();

    boundsRef.current = mapped.length
      ? leaflet.latLngBounds(
          mapped.map((project) => [project.latitude, project.longitude] as [number, number]),
        )
      : null;

    const frame = frameKey(mapped);
    const decision = decideFrame(frame, frameRef.current);
    if (decision === "fit") {
      // The first framing is the map arriving at its subject and should simply
      // be there. Every one after it is the view following the picker, and that
      // is the one worth animating.
      applyView(map, boundsRef.current, framedRef.current && !prefersReducedMotion());
      framedRef.current = true;
    } else if (decision === "reset") {
      applyView(map, null, false);
    }
    // "hold" records the frame too: the map is now standing for this selection,
    // it just did not have to move to do it.
    if (decision !== "skip") frameRef.current = frame;
  }, [id, mapped, ready]);

  useEffect(() => {
    if (!pinMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinMode]);

  const startPinMode = useCallback(
    (projectId?: string) => {
      const target = projectId ?? unmapped[0]?.id ?? projects[0]?.id ?? "";
      if (!target) return;
      setPinTarget(target);
      setPinMode(true);
    },
    [projects, unmapped],
  );

  return (
    <section
      className={`panel project-map-panel${pinMode ? " placing" : ""}`}
      data-testid="project-map"
      aria-label={id ? "Peta proyek" : "Project map"}
    >
      <div className="panel-head project-map-head">
        <div>
          <span className="eyebrow">{id ? "SEBARAN PEKERJAAN" : "WHERE THE WORK IS"}</span>
          <h2>{id ? "Peta proyek" : "Project map"}</h2>
        </div>
        <ul className="project-map-legend">
          {STATUS_ORDER.map((status) => (
            <li key={status}>
              <span className="legend-dot" style={{ background: STATUS_COLOUR[status] }} />
              {STATUS_LABEL[status][id ? "id" : "en"]}
              <small>{counts[status]}</small>
            </li>
          ))}
        </ul>
      </div>

      <div className="project-map-frame">
        <div className="project-map-canvas" ref={containerRef} role="application" />

        {failed && (
          <div className="project-map-overlay">
            <MapPinned size={26} />
            <h3>{id ? "Peta tidak dapat dimuat" : "The map could not load"}</h3>
            <p>
              {id
                ? "Daftar proyek di bawah tetap lengkap. Muat ulang halaman untuk mencoba lagi."
                : "The project list below is unaffected. Reload the page to try again."}
            </p>
          </div>
        )}

        {!failed && !projects.length && (
          <div className="project-map-overlay">
            <MapPinned size={26} />
            <h3>{id ? "Peta menunggu proyek pertama" : "The map is waiting for its first project"}</h3>
            <p>
              {id
                ? "Setiap proyek baru muncul di sini secara otomatis begitu lokasinya dikenali. Titiknya juga bisa diatur sendiri kapan saja."
                : "Every new project appears here automatically once its location is recognised, and the pin can always be placed by hand."}
            </p>
          </div>
        )}

        {/* Stood down while a pin is being placed: this panel is the thing that
            invites the operator to place one, and it must not then sit between
            them and the map they have to click. */}
        {!failed && !pinMode && Boolean(projects.length) && !mapped.length && (
          <div className="project-map-overlay">
            <MapPinned size={26} />
            <h3>{id ? "Belum ada proyek dengan titik peta" : "No project has a map pin yet"}</h3>
            <p>
              {id
                ? "Lokasi proyek belum dapat dikenali otomatis. Letakkan titiknya sendiri agar pekerjaan tampil di peta."
                : "The project locations could not be recognised automatically. Place the pins by hand so the work shows up here."}
            </p>
            {canManage && (
              <button className="button secondary" type="button" onClick={() => startPinMode()}>
                <MapPinPlus size={16} /> {id ? "Letakkan titik" : "Place a pin"}
              </button>
            )}
          </div>
        )}

        {pinMode && (
          <div className="project-map-placing" role="status">
            <MapPinPlus size={16} />
            <span>{id ? "Klik peta untuk menaruh titik" : "Click the map to drop the pin"}</span>
            <select
              value={pinTarget}
              onChange={(event) => setPinTarget(event.target.value)}
              aria-label={id ? "Proyek yang titiknya diatur" : "Project being pinned"}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {isMapped(project) ? "" : id ? " · belum ada titik" : " · not pinned"}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              type="button"
              aria-label={id ? "Batal" : "Cancel"}
              onClick={() => setPinMode(false)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="project-map-foot">
        {/* A map that quietly drops what it cannot place is a map that lies. */}
        <p>
          {mapped.length
            ? id
              ? `${mapped.length} dari ${projects.length} proyek tampil di peta.`
              : `${mapped.length} of ${projects.length} projects shown on the map.`
            : id
              ? "Belum ada proyek yang tampil di peta."
              : "No projects are shown on the map yet."}
          {unmapped.length > 0 && (
            <>
              {" "}
              <strong>
                {id
                  ? `${unmapped.length} proyek belum punya titik.`
                  : `${unmapped.length} ${unmapped.length === 1 ? "project has" : "projects have"} no pin yet.`}
              </strong>
            </>
          )}
        </p>
        {canManage && Boolean(projects.length) && !pinMode && (
          <button className="text-button" type="button" onClick={() => startPinMode()}>
            <MapPinPlus size={15} /> {id ? "Atur titik peta" : "Set a map pin"}
          </button>
        )}
      </div>
    </section>
  );
}
