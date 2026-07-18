"use client";

import { Check, ChevronDown, Files, FolderKanban } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../data";
import type { AppLanguage } from "../i18n";
import { translate } from "../i18n";

interface WorkspaceSwitcherProps {
  projects: Project[];
  selectedProjectId: string;
  language: AppLanguage;
  onSelect: (projectId: string) => void;
}

export function WorkspaceSwitcher({
  projects,
  selectedProjectId,
  language,
  onSelect,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = projects.find((project) => project.id === selectedProjectId);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="workspace-anchor" ref={rootRef}>
      <button
        className={`workspace-switcher ${open ? "active" : ""}`}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-icon"><Files size={17} /></span>
        <span><small>{translate(language, "workspace")}</small><strong>{selected?.name ?? translate(language, "allProjects")}</strong></span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="workspace-menu">
          <div><strong>{translate(language, "workspace")}</strong><small>{language === "id" ? "Pilih konteks proyek aktif" : "Choose the active project context"}</small></div>
          <button
            type="button"
            className={!selectedProjectId ? "active" : ""}
            onClick={() => { onSelect(""); setOpen(false); }}
          >
            <span className="workspace-option-icon"><Files size={16} /></span>
            <span><strong>{translate(language, "allProjects")}</strong><small>{projects.length} {language === "id" ? "proyek tersedia" : "projects available"}</small></span>
            {!selectedProjectId && <Check size={16} />}
          </button>
          {projects.map((project) => (
            <button
              type="button"
              className={selectedProjectId === project.id ? "active" : ""}
              key={project.id}
              onClick={() => { onSelect(project.id); setOpen(false); }}
            >
              <span className="workspace-option-icon"><FolderKanban size={16} /></span>
              <span><strong>{project.name}</strong><small>{project.code} · {project.client}</small></span>
              {selectedProjectId === project.id && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
