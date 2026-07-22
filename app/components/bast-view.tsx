"use client";

import {
  Check,
  CheckCircle2,
  Download,
  FileCheck2,
  LockKeyhole,
  PenLine,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import { BoqItem, Project, ViewKey } from "../data";
import type { AppLanguage } from "../i18n";
import { appPath } from "../paths";
import { SignaturePad } from "./signature-pad";

interface BastViewProps {
  language: AppLanguage;
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
  projectId: string;
  canManage: boolean;
  userName: string;
  onProjectUpdated: (project: Project) => void;
}

interface InstalledItem {
  id?: string;
  name: string;
  quantity: string;
  status: string;
}

function localizeBastSystemText(value: string, language: AppLanguage) {
  if (language === "id") return value;
  const translations: Record<string, string> = {
    "Perwakilan Klien": "Client Representative",
    "Terpasang & diuji": "Installed & tested",
    Terpasang: "Installed",
    "Seluruh pekerjaan telah diuji dan berfungsi sesuai lingkup pekerjaan yang disepakati.":
      "All work has been tested and is functioning according to the agreed scope.",
  };
  return translations[value] ?? value;
}

interface BastRecord {
  id: string;
  number: string;
  completionDate: string;
  notes: string;
  installedItems: InstalledItem[];
  clientName: string;
  clientRole: string;
  clientSignature: string;
  engineerName: string;
  engineerRole: string;
  engineerSignature: string;
  status: "Draft" | "Final";
}

export function BastView({
  language,
  navigate,
  notify,
  projectId,
  canManage,
  userName,
  onProjectUpdated,
}: BastViewProps) {
  const id = language === "id";
  const [project, setProject] = useState<Project | null>(null);
  const [installedItems, setInstalledItems] = useState<InstalledItem[]>([]);
  const [clientName, setClientName] = useState("");
  const [clientRole, setClientRole] = useState(id ? "Perwakilan Klien" : "Client Representative");
  const [engineerName, setEngineerName] = useState(userName);
  const [engineerRole, setEngineerRole] = useState("Project Manager");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(
    id
      ? "Seluruh pekerjaan telah diuji dan berfungsi sesuai lingkup pekerjaan yang disepakati."
      : "All work has been tested and is functioning according to the agreed scope.",
  );
  const [clientSignature, setClientSignature] = useState("");
  const [engineerSignature, setEngineerSignature] = useState("");
  const [bastStatus, setBastStatus] = useState<"Draft" | "Final">("Draft");
  const [bastId, setBastId] = useState("");
  const [bastNumber, setBastNumber] = useState("");
  const [validationCompleted, setValidationCompleted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<Project>(`/api/projects/${encodeURIComponent(projectId)}`),
      api<{ items: BoqItem[] }>(
        `/api/boq?projectId=${encodeURIComponent(projectId)}`,
      ),
      api<BastRecord[]>(
        `/api/bast?projectId=${encodeURIComponent(projectId)}`,
      ),
      api<{ status: "Draft" | "Completed" }>(
        `/api/validations?projectId=${encodeURIComponent(projectId)}`,
      ),
    ])
      .then(([projectData, boq, records, validation]) => {
        if (!active) return;
        setValidationCompleted(validation.status === "Completed");
        setProject(projectData);
        const record = records[0];
        if (record) {
          setBastId(record.id);
          setBastNumber(record.number);
          setDate(record.completionDate);
          setNotes(localizeBastSystemText(record.notes, language));
          setInstalledItems(
            record.installedItems.map((item, index) => ({
              ...item,
              status: localizeBastSystemText(item.status, language),
              id: `saved-${index}-${item.name}`,
            })),
          );
          setClientName(record.clientName);
          setClientRole(localizeBastSystemText(record.clientRole, language));
          setClientSignature(record.clientSignature);
          setEngineerName(record.engineerName);
          setEngineerRole(record.engineerRole);
          setEngineerSignature(record.engineerSignature);
          setBastStatus(record.status);
          return;
        }
        setClientName(projectData.client);
        setClientRole(id ? "Perwakilan Klien" : "Client Representative");
        setNotes(
          id
            ? "Seluruh pekerjaan telah diuji dan berfungsi sesuai lingkup pekerjaan yang disepakati."
            : "All work has been tested and is functioning according to the agreed scope.",
        );
        setInstalledItems(
          boq.items.map((item) => ({
            id: item.id,
            name: item.description,
            quantity: `${item.quantity} ${item.unit}`,
            status: id ? "Terpasang & diuji" : "Installed & tested",
          })),
        );
      })
      .catch((error) => notify(messageOf(error, language)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, language, notify, projectId]);

  function updateInstalledItem(
    index: number,
    field: keyof InstalledItem,
    value: string,
  ) {
    setInstalledItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  }

  async function persistBast(status: "Draft" | "Final") {
    if (!installedItems.length) {
      throw new Error(
        id
          ? "BAST membutuhkan minimal satu item terpasang. Isi BoQ atau tambahkan item manual."
          : "The handover certificate needs at least one installed item. Complete the BoQ or add an item.",
      );
    }
    const payload = {
      projectId,
      completionDate: date,
      notes,
      installedItems: installedItems.map(({ name, quantity, status }) => ({
        name,
        quantity,
        status,
      })),
      clientName,
      clientRole,
      clientSignature,
      engineerName,
      engineerRole,
      engineerSignature,
      status,
    };
    const record = await api<BastRecord>(
      bastId ? `/api/bast/${bastId}` : "/api/bast",
      {
        method: bastId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    setBastId(record.id);
    setBastNumber(record.number);
    setBastStatus(record.status);
    return record;
  }

  async function saveBast() {
    try {
      await persistBast(bastStatus);
      notify(
        bastStatus === "Final"
          ? id ? "Perubahan BAST final berhasil disimpan." : "Final handover changes saved."
          : id ? "Draft BAST dan tanda tangan berhasil disimpan." : "Handover draft and signatures saved.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function downloadBast() {
    try {
      let id = bastId;
      let number = bastNumber;
      if (canManage) {
        if (!clientSignature || !engineerSignature) {
          throw new Error(
            id
              ? "Lengkapi tanda tangan klien dan PerumNet sebelum membuat BAST final."
              : "Complete the client and PerumNet signatures before finalizing the handover.",
          );
        }
        const record = await persistBast("Final");
        id = record.id;
        number = record.number;
        const updatedProject = await api<Project>(
          `/api/projects/${encodeURIComponent(projectId)}`,
        );
        setProject(updatedProject);
        onProjectUpdated(updatedProject);
      }
      if (!id) throw new Error(language === "id" ? "Simpan BAST terlebih dahulu." : "Save the handover first.");
      await downloadApiFile(
        `/api/bast/${id}/pdf`,
        `${number.replaceAll("/", "-") || "BAST-PerumNet"}.pdf`,
      );
      notify(language === "id" ? "BAST PDF bertanda tangan berhasil dibuat." : "The signed handover PDF was created.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteBast() {
    if (!bastId || !window.confirm(`${language === "id" ? "Hapus" : "Delete"} ${bastNumber || (language === "id" ? "BAST ini" : "this handover")}?`)) return;
    try {
      await api(`/api/bast/${bastId}`, { method: "DELETE" });
      setBastId("");
      setBastNumber("");
      setBastStatus("Draft");
      setClientSignature("");
      setEngineerSignature("");
      notify(language === "id" ? "BAST berhasil dihapus." : "The handover was deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  const signaturesComplete = Boolean(clientSignature && engineerSignature);
  const isFinal = bastStatus === "Final";

  if (loading) {
    return <section className="panel empty-state"><p>{id ? "Memuat BAST..." : "Loading handover..."}</p></section>;
  }

  if (!validationCompleted && !bastId) {
    return (
      <section className="panel empty-state validation-required-state" data-testid="bast-validation-gate">
        <ShieldCheck size={36} />
        <h2>{id ? "BAST belum dapat diterbitkan" : "Handover cannot be issued yet"}</h2>
        <p>{id ? "Selesaikan checklist pengujian seluruh Perangkat dan Material dari BoQ terlebih dahulu." : "Complete the test checklist for every Device and Material from the BoQ first."}</p>
        <button className="button primary" type="button" onClick={() => navigate("validation")}><FileCheck2 size={16} /> {id ? "Buka form validasi" : "Open validation form"}</button>
      </section>
    );
  }

  return (
    <div className="page-stack" data-testid="bast-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">{id ? "SERAH TERIMA DIGITAL" : "DIGITAL HANDOVER"}</span>
          <h1>{id ? "BAST Digital" : "Digital Handover"}</h1>
          <p>
            {project
              ? `${project.code} · ${project.name}`
              : id ? "Memuat konteks proyek..." : "Loading project context..."}
          </p>
        </div>
        <div className="title-actions">
          {canManage && (
            <button className="button secondary" type="button" onClick={saveBast}>
              <Save size={16} /> {isFinal ? (id ? "Simpan perubahan" : "Save changes") : (id ? "Simpan draft" : "Save draft")}
            </button>
          )}
          <button className="button primary" type="button" onClick={downloadBast}>
            <Download size={16} /> {canManage ? (id ? "Finalkan & unduh" : "Finalize & download") : (id ? "Unduh PDF" : "Download PDF")}
          </button>
          {canManage && bastId && (
            <button className="button danger" type="button" onClick={deleteBast}>
              <Trash2 size={16} /> {id ? "Hapus" : "Delete"}
            </button>
          )}
        </div>
      </section>

      <section className="bast-stepper" aria-label={id ? "Tahapan BAST" : "Handover stages"}>
        <div className="done"><span><Check size={15} /></span><div><strong>{id ? "Data proyek" : "Project data"}</strong><small>{id ? "Sinkron" : "Synced"}</small></div></div>
        <div className="line done" />
        <div className={installedItems.length ? "done" : "active"}><span><Check size={15} /></span><div><strong>{id ? "Item terpasang" : "Installed items"}</strong><small>{installedItems.length} {id ? "item" : "items"}</small></div></div>
        <div className={`line ${signaturesComplete ? "done" : ""}`} />
        <div className={signaturesComplete ? "done" : "active"}><span><PenLine size={15} /></span><div><strong>{id ? "Tanda tangan" : "Signatures"}</strong><small>{signaturesComplete ? (id ? "Lengkap" : "Complete") : (id ? "Dalam proses" : "In progress")}</small></div></div>
        <div className={`line ${isFinal ? "done" : ""}`} />
        <div className={isFinal ? "done" : ""}><span><FileCheck2 size={15} /></span><div><strong>{id ? "Dokumen final" : "Final document"}</strong><small>{isFinal ? (id ? "Siap diunduh" : "Ready to download") : (id ? "Masih Draft" : "Still Draft")}</small></div></div>
      </section>

      <section className="bast-layout">
        <div className="bast-main">
          <article className="panel bast-document">
            <header className="bast-letterhead">
              <img src={appPath("/perumnet-enterprise-logo.png")} alt="PerumNet Enterprise" width={120} height={126} />
              <div><strong>PERUMNET ENTERPRISE</strong><span>{id ? "Konsultan IT & Managed Services" : "IT Consulting & Managed Services"}</span><small>Gianyar, Bali · it@perumnet.id</small></div>
              <span className="status-badge info"><ShieldCheck size={14} /> {bastStatus}</span>
            </header>
            <div className="bast-title">
              <span>{id ? "BERITA ACARA SERAH TERIMA" : "HANDOVER CERTIFICATE"}</span>
              <h2>{project?.name ?? (id ? "Proyek" : "Project")}</h2>
              <small>{id ? "Nomor" : "Number"}: {bastNumber || (id ? "Dibuat saat BAST disimpan" : "Created when the handover is saved")}</small>
            </div>
            <div className="bast-intro">
              {id
                ? "Para pihak menerangkan bahwa pekerjaan berikut telah diselesaikan dan diserahterimakan dalam kondisi baik sesuai lingkup kerja yang disepakati."
                : "The parties confirm that the following work has been completed and handed over in good condition according to the agreed scope."}
            </div>
            <section className="bast-data-grid">
              <label className="field"><span>{id ? "Nama proyek" : "Project name"}</span><input value={project?.name ?? ""} readOnly /></label>
              <label className="field"><span>{id ? "Klien" : "Client"}</span><input value={project?.client ?? ""} readOnly /></label>
              <label className="field"><span>{id ? "Tanggal selesai" : "Completion date"}</span><input disabled={!canManage} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="field"><span>{id ? "Lokasi" : "Location"}</span><input value={project?.location ?? ""} readOnly /></label>
            </section>

            <section className="installed-items">
              <div className="subsection-head">
                <div><span className="eyebrow">{id ? "ITEM TERPASANG" : "INSTALLED ITEMS"}</span><h3>{id ? "Hasil pekerjaan dari BoQ" : "Work results from the BoQ"}</h3></div>
                {canManage && <button className="button secondary small" type="button" onClick={() => setInstalledItems((current) => [...current, { id: `new-${Date.now()}`, name: id ? "Item baru" : "New item", quantity: "1 unit", status: id ? "Terpasang" : "Installed" }])}><Plus size={14} /> {id ? "Tambah item" : "Add item"}</button>}
              </div>
              <div className="installed-item-list">
                {installedItems.map((item, index) => (
                  <div className="installed-item editable" key={item.id ?? `item-${index}`}>
                    <span className="installed-number">{index + 1}</span>
                    <div>
                      <input disabled={!canManage} value={item.name} onChange={(event) => updateInstalledItem(index, "name", event.target.value)} aria-label={`${id ? "Nama item" : "Item name"} ${index + 1}`} />
                      <input disabled={!canManage} value={item.quantity} onChange={(event) => updateInstalledItem(index, "quantity", event.target.value)} aria-label={`${id ? "Jumlah item" : "Item quantity"} ${index + 1}`} />
                    </div>
                    <input disabled={!canManage} value={item.status} onChange={(event) => updateInstalledItem(index, "status", event.target.value)} aria-label={`${id ? "Status item" : "Item status"} ${index + 1}`} />
                    {canManage && <button className="icon-button danger" type="button" aria-label={`${id ? "Hapus item" : "Delete item"} ${index + 1}`} onClick={() => setInstalledItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>}
                  </div>
                ))}
                {!installedItems.length && <div className="empty-state compact"><p>{id ? "BoQ belum memiliki item. Tambahkan item manual atau isi BoQ terlebih dahulu." : "The BoQ has no items. Add one manually or complete the BoQ first."}</p></div>}
              </div>
            </section>
            <label className="field bast-notes"><span>{id ? "Catatan serah terima" : "Handover notes"}</span><textarea disabled={!canManage} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </article>

          <section className="panel signature-section">
            <div className="panel-head"><div><span className="eyebrow">{id ? "TANDA TANGAN DIGITAL" : "DIGITAL SIGNATURES"}</span><h2>{id ? "Persetujuan para pihak" : "Parties' approval"}</h2></div><span className="secure-label"><LockKeyhole size={14} /> {id ? "Tersimpan aman" : "Securely stored"}</span></div>
            <div className="signature-grid">
              <div>
                <div className="signer-fields">
                  <label className="field"><span>{id ? "Nama klien" : "Client name"}</span><input disabled={!canManage} value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
                  <label className="field"><span>{id ? "Jabatan" : "Title"}</span><input disabled={!canManage} value={clientRole} onChange={(event) => setClientRole(event.target.value)} /></label>
                </div>
                <SignaturePad language={language} label={id ? "Pihak Klien" : "Client"} signer={clientName} value={clientSignature} disabled={!canManage} onChange={setClientSignature} />
              </div>
              <div>
                <div className="signer-fields">
                  <label className="field"><span>{id ? "Nama engineer / PM" : "Engineer / PM name"}</span><input disabled={!canManage} value={engineerName} onChange={(event) => setEngineerName(event.target.value)} /></label>
                  <label className="field">
                    <span>{id ? "Jabatan di BAST" : "Role in handover"}</span>
                    <input
                      disabled={!canManage}
                      list="bast-engineer-roles"
                      value={engineerRole}
                      onChange={(event) => setEngineerRole(event.target.value)}
                    />
                    <datalist id="bast-engineer-roles">
                      <option value="Project Manager" />
                      <option value="Engineer" />
                    </datalist>
                  </label>
                </div>
                <SignaturePad language={language} label={id ? "Pihak PerumNet" : "PerumNet"} signer={engineerName} value={engineerSignature} disabled={!canManage} onChange={setEngineerSignature} />
              </div>
            </div>
            <div className={`signature-completion ${signaturesComplete ? "complete" : ""}`}>
              {signaturesComplete ? <CheckCircle2 size={18} /> : <PenLine size={18} />}
              <div><strong>{signaturesComplete ? (id ? "Tanda tangan lengkap" : "Signatures complete") : (id ? "Menunggu tanda tangan" : "Waiting for signatures")}</strong><span>{signaturesComplete ? (id ? "Dokumen siap difinalkan dan diunduh." : "The document is ready to finalize and download.") : (id ? "Klien dan perwakilan PerumNet perlu menandatangani." : "The client and PerumNet representative must sign.")}</span></div>
            </div>
          </section>
        </div>

        <aside className="bast-side">
          <section className="panel bast-summary">
            <div className="panel-head"><div><span className="eyebrow">{id ? "RINGKASAN" : "SUMMARY"}</span><h2>{id ? "Status dokumen" : "Document status"}</h2></div></div>
            <div className="bast-status-list">
              <div><span><Check size={14} /></span><div><strong>{id ? "Data proyek" : "Project data"}</strong><small>{id ? "Terisi otomatis" : "Auto-filled"}</small></div></div>
              <div className={installedItems.length ? "" : "pending"}><span><Check size={14} /></span><div><strong>{installedItems.length} {id ? "item pekerjaan" : "work items"}</strong><small>{id ? "Disinkronkan dari BoQ" : "Synced from BoQ"}</small></div></div>
              <div className={clientSignature ? "" : "pending"}><span>{clientSignature ? <Check size={14} /> : <PenLine size={14} />}</span><div><strong>{id ? "Tanda tangan klien" : "Client signature"}</strong><small>{clientSignature ? (id ? "Tersimpan" : "Saved") : (id ? "Belum ada" : "Missing")}</small></div></div>
              <div className={engineerSignature ? "" : "pending"}><span>{engineerSignature ? <Check size={14} /> : <PenLine size={14} />}</span><div><strong>{id ? "Tanda tangan PerumNet" : "PerumNet signature"}</strong><small>{engineerSignature ? (id ? "Tersimpan" : "Saved") : (id ? "Belum ada" : "Missing")}</small></div></div>
            </div>
            {canManage && <button className="button primary full-width" type="button" onClick={saveBast}><Save size={16} /> {isFinal ? (id ? "Simpan Perubahan" : "Save Changes") : (id ? "Simpan Draft" : "Save Draft")}</button>}
            <button className="button secondary full-width" type="button" onClick={downloadBast}><Download size={16} /> {canManage ? (id ? "Finalkan & unduh PDF" : "Finalize & download PDF") : (id ? "Unduh PDF final" : "Download final PDF")}</button>
          </section>
          <section className="security-note"><ShieldCheck size={20} /><div><strong>{id ? "Dokumen terlindungi" : "Protected document"}</strong><span>{id ? "Tanda tangan disimpan sebagai bagian dari BAST proyek." : "Signatures are stored as part of the project handover."}</span></div></section>
        </aside>
      </section>
    </div>
  );
}
