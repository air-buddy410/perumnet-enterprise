"use client";

import { ChevronDown, Layers3, Plus } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api, messageOf } from "../api-client";
import type { CommercialPackage } from "../data";
import type { AppLanguage } from "../i18n";

interface CommercialPackageSwitcherProps {
  projectId: string;
  language: AppLanguage;
  canManage: boolean;
  value: string;
  onChange: (packageId: string, packages: CommercialPackage[]) => void;
  notify: (message: string) => void;
}

export function CommercialPackageSwitcher({
  projectId,
  language,
  canManage,
  value,
  onChange,
  notify,
}: CommercialPackageSwitcherProps) {
  const id = language === "id";
  const [packages, setPackages] = useState<CommercialPackage[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    let active = true;
    api<CommercialPackage[]>(`/api/projects/${encodeURIComponent(projectId)}/packages`)
      .then((items) => {
        if (!active) return;
        setPackages(items);
        const remembered = window.localStorage.getItem(`commercial-package:${projectId}`);
        const next = items.find((item) => item.id === value)?.id ??
          items.find((item) => item.id === remembered)?.id ?? items[0]?.id ?? "";
        if (next) onChange(next, items);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => { active = false; };
  }, [language, notify, onChange, projectId, value]);

  function select(packageId: string) {
    window.localStorage.setItem(`commercial-package:${projectId}`, packageId);
    onChange(packageId, packages);
  }

  async function createPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await api<CommercialPackage>(
        `/api/projects/${encodeURIComponent(projectId)}/packages`,
        {
          method: "POST",
          body: JSON.stringify({ title, code: code || undefined }),
        },
      );
      const next = [...packages, created];
      setPackages(next);
      setTitle("");
      setCode("");
      setShowForm(false);
      select(created.id);
      notify(id ? "Paket komersial berhasil dibuat." : "Commercial package created.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="commercial-package-control">
      <Layers3 size={17} />
      <label>
        <span>{id ? "Paket komersial" : "Commercial package"}</span>
        <select value={value} onChange={(event) => select(event.target.value)}>
          {packages.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
        </select>
        <ChevronDown size={14} />
      </label>
      {canManage && (
        <button className="icon-button" type="button" onClick={() => setShowForm((current) => !current)} aria-label={id ? "Tambah paket" : "Add package"}>
          <Plus size={17} />
        </button>
      )}
      {showForm && (
        <form className="commercial-package-popover" onSubmit={createPackage}>
          <strong>{id ? "Paket baru" : "New package"}</strong>
          <label className="field"><span>{id ? "Nama paket" : "Package name"}</span><input required minLength={2} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Managed WiFi" /></label>
          <label className="field"><span>{id ? "Kode (opsional)" : "Code (optional)"}</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="WIFI" /></label>
          <div className="modal-actions"><button className="button subtle small" type="button" onClick={() => setShowForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary small" type="submit">{id ? "Buat" : "Create"}</button></div>
        </form>
      )}
    </div>
  );
}
