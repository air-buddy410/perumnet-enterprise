"use client";

import { ChevronDown, Layers3, Plus, SlidersHorizontal } from "lucide-react";
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

type PackageStatus = CommercialPackage["status"];

// Mirrors the server transition table. Only an Active package accepts new
// quotations, invoices, validations, and handover certificates, so retiring one
// is the answer the delete refusal points at — and Void never comes back.
const PACKAGE_TRANSITIONS: Record<PackageStatus, readonly PackageStatus[]> = {
  Draft: ["Active", "Void"],
  Active: ["Completed", "Void"],
  Completed: ["Active", "Void"],
  Void: [],
};

function statusLabel(language: AppLanguage, status: PackageStatus) {
  const labels: Record<PackageStatus, [string, string]> = {
    Draft: ["Draft", "Draft"],
    Active: ["Aktif", "Active"],
    Completed: ["Selesai", "Completed"],
    Void: ["Batal", "Void"],
  };
  return labels[status]?.[language === "id" ? 0 : 1] ?? status;
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
  const [showStatusForm, setShowStatusForm] = useState(false);
  const [nextStatus, setNextStatus] = useState<PackageStatus>("Active");
  const [saving, setSaving] = useState(false);
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

  const current = packages.find((item) => item.id === value);
  const currentStatus: PackageStatus = current?.status ?? "Active";
  const allowedTargets = PACKAGE_TRANSITIONS[currentStatus] ?? [];

  function select(packageId: string) {
    window.localStorage.setItem(`commercial-package:${projectId}`, packageId);
    onChange(packageId, packages);
  }

  function openStatusForm() {
    setShowForm(false);
    setNextStatus(allowedTargets[0] ?? currentStatus);
    setShowStatusForm((open) => !open);
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

  async function savePackageStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || nextStatus === currentStatus) return;
    if (
      nextStatus === "Void" &&
      !window.confirm(
        id
          ? `Batalkan paket ${current.code}? Paket Batal tidak dapat diaktifkan kembali, tetapi seluruh dokumennya tetap dapat dibaca dan diunduh.`
          : `Void package ${current.code}? A voided package can never be reactivated, but every document on it stays readable and downloadable.`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const saved = await api<CommercialPackage>(
        `/api/projects/${encodeURIComponent(projectId)}/packages/${encodeURIComponent(current.id)}`,
        { method: "PATCH", body: JSON.stringify({ status: nextStatus }) },
      );
      const updated = packages.map((item) =>
        item.id === current.id ? { ...item, ...saved, status: nextStatus } : item,
      );
      setPackages(updated);
      setShowStatusForm(false);
      onChange(current.id, updated);
      notify(
        id
          ? `Status paket ${current.code} menjadi ${statusLabel(language, nextStatus)}.`
          : `Package ${current.code} is now ${statusLabel(language, nextStatus)}.`,
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="commercial-package-control">
      <Layers3 size={17} />
      <label>
        <span>
          {id ? "Paket komersial" : "Commercial package"}
          {current && currentStatus !== "Active"
            ? ` · ${statusLabel(language, currentStatus)}`
            : ""}
        </span>
        <select value={value} onChange={(event) => select(event.target.value)}>
          {packages.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} · {item.title}
              {item.status === "Active" ? "" : ` · ${statusLabel(language, item.status)}`}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </label>
      {canManage && (
        <button
          className="icon-button"
          type="button"
          onClick={openStatusForm}
          aria-expanded={showStatusForm}
          aria-label={id ? "Ubah status paket" : "Change package status"}
        >
          <SlidersHorizontal size={17} />
        </button>
      )}
      {canManage && (
        <button className="icon-button" type="button" onClick={() => { setShowStatusForm(false); setShowForm((open) => !open); }} aria-label={id ? "Tambah paket" : "Add package"}>
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
      {showStatusForm && (
        <form className="commercial-package-popover" onSubmit={savePackageStatus}>
          <strong>{id ? "Status paket" : "Package status"}</strong>
          <p className="package-status-hint">
            {id
              ? `${current?.code ?? "—"} sekarang ${statusLabel(language, currentStatus)}. Hanya paket Aktif yang menerima dokumen baru; dokumen lama tetap dapat dibaca dan diunduh apa pun statusnya.`
              : `${current?.code ?? "—"} is currently ${statusLabel(language, currentStatus)}. Only an Active package takes new documents; existing ones stay readable and downloadable whatever the status.`}
          </p>
          {allowedTargets.length ? (
            <>
              <label className="field">
                <span>{id ? "Ubah menjadi" : "Change to"}</span>
                <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value as PackageStatus)}>
                  {allowedTargets.map((status) => (
                    <option key={status} value={status}>{statusLabel(language, status)}</option>
                  ))}
                </select>
              </label>
              <p className="package-status-hint">
                {id
                  ? "Paket Selesai masih dapat diaktifkan kembali bila ada pekerjaan susulan. Batal bersifat final."
                  : "A Completed package can be reactivated when late work arrives. Void is final."}
              </p>
              <div className="modal-actions"><button className="button subtle small" type="button" onClick={() => setShowStatusForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary small" type="submit" disabled={saving}>{id ? "Simpan status" : "Save status"}</button></div>
            </>
          ) : (
            <>
              <p className="package-status-hint">
                {id
                  ? "Paket yang sudah Batal tidak dapat diaktifkan kembali. Buat paket komersial baru bila pekerjaannya berlanjut."
                  : "A voided package can never be reactivated. Create a new commercial package if the work continues."}
              </p>
              <div className="modal-actions"><button className="button subtle small" type="button" onClick={() => setShowStatusForm(false)}>{id ? "Tutup" : "Close"}</button></div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
