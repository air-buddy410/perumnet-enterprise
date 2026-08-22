"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Filter,
  Images,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { Project } from "../data";
import { type AppLanguage } from "../i18n";
import { DocumentGallery, type ProjectDocumentAsset } from "./document-gallery";

interface GalleryViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projects: Project[];
}

interface GallerySummary {
  byMonth: Array<{ month: string; photos: number; files: number }>;
  byProject: Array<{ projectId: string; projectCode: string; projectName: string; photos: number; files: number; latestTakenAt: string | null }>;
}

interface GalleryResponse {
  items: ProjectDocumentAsset[];
  page: number;
  pageSize: number;
  total: number;
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function monthLabel(month: string, language: AppLanguage) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function GalleryView({ language, notify, projects }: GalleryViewProps) {
  const id = language === "id";
  const [documents, setDocuments] = useState<ProjectDocumentAsset[]>([]);
  const [summary, setSummary] = useState<GallerySummary>({ byMonth: [], byProject: [] });
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<"all" | "photo" | "file">("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 40;

  const loadGallery = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), type });
      if (projectId) params.set("projectId", projectId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (query) params.set("q", query);
      const [result, nextSummary] = await Promise.all([
        api<GalleryResponse>(`/api/documents?${params.toString()}`),
        api<GallerySummary>(`/api/documents/summary${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
      ]);
      setDocuments(result.items ?? []);
      setTotal(result.total ?? 0);
      setSummary({ byMonth: nextSummary.byMonth ?? [], byProject: nextSummary.byProject ?? [] });
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setLoading(false);
    }
  }, [from, language, notify, page, projectId, query, to, type]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadGallery(), 0);
    return () => window.clearTimeout(timer);
  }, [loadGallery]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  function selectMonth(month: string) {
    const range = monthBounds(month);
    setFrom(range.from);
    setTo(range.to);
    setPage(1);
  }

  function clearDateRange() {
    setFrom("");
    setTo("");
    setPage(1);
  }

  const activeMonth = from && to && from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : "";
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total ? ((page - 1) * pageSize) + 1 : 0;
  const lastItem = total ? Math.min(page * pageSize, total) : 0;
  const projectSummary = useMemo(() => summary.byProject.slice(0, 12), [summary.byProject]);

  return (
    <div className="page-stack" data-testid="gallery-view">
      <section className="page-title-row gallery-page-title">
        <div>
          <span className="eyebrow">{id ? "DOKUMENTASI PROYEK" : "PROJECT DOCUMENTATION"}</span>
          <h1>{id ? "Galeri Proyek" : "Project Gallery"}</h1>
          <p>{id ? "Telusuri foto dan file lapangan dari seluruh proyek dalam satu tempat." : "Browse field photos and files from every project in one place."}</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void loadGallery()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /> {id ? "Segarkan" : "Refresh"}</button>
      </section>

      <section className="gallery-summary-strip">
        <div><Images size={18} /><strong>{summary.byMonth.reduce((total, item) => total + item.photos, 0)}</strong><span>{id ? "foto tersimpan" : "photos stored"}</span></div>
        <div><FileImage size={18} /><strong>{summary.byMonth.reduce((total, item) => total + item.files, 0)}</strong><span>{id ? "file tersimpan" : "files stored"}</span></div>
        <div><strong>{summary.byProject.length}</strong><span>{id ? "proyek terdokumentasi" : "documented projects"}</span></div>
      </section>

      <section className="gallery-layout">
        <aside className="panel gallery-sidebar">
          <div className="panel-head">
            <div><span className="eyebrow">{id ? "JELAJAH" : "BROWSE"}</span><h2>{id ? "Riwayat galeri" : "Gallery history"}</h2></div>
          </div>
          <div className="gallery-sidebar-section">
            <div className="gallery-sidebar-heading"><strong>{id ? "Bulan" : "Month"}</strong>{activeMonth ? <button type="button" onClick={clearDateRange}>{id ? "Hapus" : "Clear"}</button> : null}</div>
            <div className="gallery-month-list">
              {summary.byMonth.map((item) => <button key={item.month} className={activeMonth === item.month ? "active" : ""} type="button" onClick={() => selectMonth(item.month)}><span>{monthLabel(item.month, language)}</span><small>{item.photos} {id ? "foto" : "photos"} · {item.files} {id ? "file" : "files"}</small></button>)}
              {!summary.byMonth.length ? <small className="muted">{id ? "Belum ada riwayat bulan." : "No monthly history yet."}</small> : null}
            </div>
          </div>
          <div className="gallery-sidebar-section">
            <div className="gallery-sidebar-heading"><strong>{id ? "Proyek" : "Project"}</strong></div>
            <div className="gallery-project-list">
              <button className={!projectId ? "active" : ""} type="button" onClick={() => { setProjectId(""); setPage(1); }}><span>{id ? "Semua proyek" : "All projects"}</span></button>
              {projectSummary.map((item) => <button className={projectId === item.projectId ? "active" : ""} type="button" key={item.projectId} onClick={() => { setProjectId(item.projectId); setPage(1); }}><span>{item.projectCode} · {item.projectName}</span><small>{item.photos + item.files} {id ? "item" : "items"}</small></button>)}
              {!projectSummary.length && projects.length ? projects.slice(0, 8).map((project) => <button className={projectId === project.id ? "active" : ""} type="button" key={project.id} onClick={() => { setProjectId(project.id); setPage(1); }}><span>{project.code} · {project.name}</span></button>) : null}
            </div>
          </div>
        </aside>

        <section className="panel gallery-results">
          <div className="gallery-filter-bar">
            <form className="gallery-search" onSubmit={submitSearch}>
              <Search size={16} />
              <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={id ? "Cari nama file atau keterangan..." : "Search file name or caption..."} />
              {queryInput ? <button type="button" aria-label={id ? "Hapus pencarian" : "Clear search"} onClick={() => { setQueryInput(""); setQuery(""); setPage(1); }}><X size={14} /></button> : null}
            </form>
            <label className="gallery-select"><Filter size={15} /><select value={type} onChange={(event) => { setType(event.target.value as typeof type); setPage(1); }} aria-label={id ? "Jenis dokumentasi" : "Documentation type"}><option value="all">{id ? "Semua tipe" : "All types"}</option><option value="photo">{id ? "Foto saja" : "Photos only"}</option><option value="file">{id ? "File saja" : "Files only"}</option></select></label>
            <label className="gallery-date-filter"><CalendarDays size={15} /><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label={id ? "Dari tanggal" : "From date"} /><span>—</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label={id ? "Sampai tanggal" : "To date"} /></label>
          </div>
          <div className="gallery-results-heading"><div><strong>{projectId ? projectSummary.find((item) => item.projectId === projectId)?.projectName ?? (id ? "Proyek dipilih" : "Selected project") : (id ? "Semua dokumentasi" : "All documentation")}</strong><span>{from || to ? `${from || "…"} — ${to || "…"}` : (id ? "Foto terbaru tampil lebih dulu" : "Newest photos appear first")}</span></div><span>{loading ? "…" : `${firstItem}–${lastItem} / ${total} ${id ? "item" : "items"}`}</span></div>
          {loading ? <div className="gallery-loading"><RefreshCw className="spin" size={22} /><span>{id ? "Memuat galeri..." : "Loading gallery..."}</span></div> : <DocumentGallery documents={documents} language={language} emptyTitle={id ? "Belum ada hasil" : "No results"} emptyDescription={id ? "Coba ganti pencarian, proyek, atau periode." : "Try another search, project, or date range."} />}
          <div className="gallery-pagination">
            <span>{id ? `Halaman ${page} dari ${pageCount}` : `Page ${page} of ${pageCount}`}</span>
            <div><button className="button secondary small" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} /> {id ? "Sebelumnya" : "Previous"}</button><button className="button secondary small" type="button" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>{id ? "Berikutnya" : "Next"} <ChevronRight size={14} /></button></div>
          </div>
        </section>
      </section>
    </div>
  );
}
