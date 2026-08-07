"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { MapPinned, MapPinPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Project, ProjectStatus } from "../data";
import { type AppLanguage } from "../i18n";

/**
 * The project map on the admin dashboard.
 *
 * Two things about this component are load-bearing rather than incidental.
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
 * screen never fetches the chunk, and the dashboard fetches it once. Its
 * stylesheet is a static import and so does ship with the page (about 2.7 kB
 * gzipped), which is the price of the panel and its empty state rendering
 * correctly on the server instead of popping in after hydration.
 */

// Bali, framed so the whole island and the near parts of Lombok fit. Used when
// there is nothing to fit the view to yet, which on a fresh installation is
// what the owner sees first.
const BALI_CENTRE: [number, number] = [-8.42, 115.16];
const BALI_ZOOM = 9;

// The three colours are the ones the status badges already use elsewhere in the
// application, so a project reads the same on the map as it does on its card.
const STATUS_COLOUR: Record<ProjectStatus, string> = {
  Draft: "#6d7b7d",
  Aktif: "#007a74",
  Selesai: "#267653",
};

// The owner's own words for the three states, and their English equivalents.
const STATUS_LABEL: Record<ProjectStatus, { id: string; en: string }> = {
  Draft: { id: "Deal-an", en: "In negotiation" },
  Aktif: { id: "On progress", en: "In progress" },
  Selesai: { id: "Selesai", en: "Completed" },
};

const STATUS_ORDER: ProjectStatus[] = ["Draft", "Aktif", "Selesai"];

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

function applyView(map: Leaflet.Map, bounds: Leaflet.LatLngBounds | null) {
  if (bounds) map.fitBounds(bounds, FIT_OPTIONS);
  else map.setView(BALI_CENTRE, BALI_ZOOM);
}

function isMapped(project: Project): project is Project & { latitude: number; longitude: number } {
  return typeof project.latitude === "number" && typeof project.longitude === "number";
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
  const boundsRef = useRef<Leaflet.LatLngBounds | null>(null);
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
        mapRef.current = map;
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
      markers.clear();
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
      applyView(map, boundsRef.current);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !leaflet || !map) return;

    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const project of mapped) {
      seen.add(project.id);
      const position: [number, number] = [project.latitude, project.longitude];
      const colour = STATUS_COLOUR[project.status];
      const label = `${project.name} — ${STATUS_LABEL[project.status][id ? "id" : "en"]}`;
      const icon = leaflet.divIcon({
        className: "project-map-marker",
        html: `<span class="project-map-pin" style="background:${colour}"></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const existing = markers.get(project.id);
      if (existing) {
        existing.setLatLng(position);
        existing.setIcon(icon);
        existing.options.title = label;
        existing.getElement()?.setAttribute("title", label);
        existing.getElement()?.setAttribute("aria-label", label);
        continue;
      }
      const marker = leaflet
        .marker(position, { icon, title: label, alt: label, riseOnHover: true, keyboard: true })
        .addTo(map);
      marker.on("click", () => openHandler.current(project.id));
      marker.getElement()?.setAttribute("aria-label", label);
      markers.set(project.id, marker);
    }

    for (const [projectId, marker] of markers) {
      if (seen.has(projectId)) continue;
      marker.remove();
      markers.delete(projectId);
    }

    boundsRef.current = mapped.length
      ? leaflet.latLngBounds(
          mapped.map((project) => [project.latitude, project.longitude] as [number, number]),
        )
      : null;
    applyView(map, boundsRef.current);
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
