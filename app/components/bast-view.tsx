"use client";

import {
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  LockKeyhole,
  Mail,
  PenLine,
  Plus,
  Save,
  ShieldCheck,
  Stamp,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import { BoqItem, CommercialPackage, Project, ViewKey } from "../data";
import type { AppLanguage } from "../i18n";
import { appPath } from "../paths";
import { SignaturePad } from "./signature-pad";
import { CommercialPackageSwitcher } from "./commercial-package-switcher";
import { DocumentPreviewModal } from "./document-preview-modal";
import { DocumentEmailDialog, type DocumentEmailTarget } from "./document-email-dialog";
import { DocumentTemplateManager } from "./document-template-manager";

interface BastViewProps {
  language: AppLanguage;
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
  projectId: string;
  canManage: boolean;
  isAdmin: boolean;
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
  packageId?: string | null;
  packageTitle?: string | null;
  deliveryCycle?: number;
  finalizedAt?: string | null;
  verificationToken?: string | null;
  revokedAt?: string | null;
}

export function BastView({
  language,
  navigate,
  notify,
  projectId,
  canManage,
  isAdmin,
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
  const [emailTarget, setEmailTarget] = useState<DocumentEmailTarget | null>(null);
  const [activeTab, setActiveTab] = useState<"bast" | "templates">("bast");
  const [validationCompleted, setValidationCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [packageId, setPackageId] = useState("");
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null);
  const [revokedAt, setRevokedAt] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showSealSettings, setShowSealSettings] = useState(false);
  const [sealEnabled, setSealEnabled] = useState(false);
  const [sealName, setSealName] = useState("PerumNet Enterprise");
  const [sealRole, setSealRole] = useState("Authorized Representative");
  const [sealFile, setSealFile] = useState<File | null>(null);
  const selectPackage = useCallback((nextPackageId: string, packages: CommercialPackage[]) => {
    void packages;
    setPackageId(nextPackageId);
  }, []);

  // When the workspace project changes, drop the previous project's package
  // selection during render so the bootstrap effect below re-resolves it.
  const [packageProjectId, setPackageProjectId] = useState(projectId);
  if (packageProjectId !== projectId) {
    setPackageProjectId(projectId);
    setPackageId("");
    setLoading(true);
  }

  // Resolve the initial commercial package here instead of waiting for the
  // CommercialPackageSwitcher: the switcher only mounts once loading is false,
  // but loading could only become false after the switcher picked a package —
  // a deadlock that left the view stuck on "Memuat BAST...".
  useEffect(() => {
    let active = true;
    api<CommercialPackage[]>(`/api/projects/${encodeURIComponent(projectId)}/packages`)
      .then((packages) => {
        if (!active) return;
        const remembered = window.localStorage.getItem(`commercial-package:${projectId}`);
        const next = packages.find((item) => item.id === remembered)?.id ?? packages[0]?.id ?? "";
        if (next) setPackageId((current) => current || next);
        else setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        notify(messageOf(error, language));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [language, notify, projectId]);

  useEffect(() => {
    if (!packageId) return;
    let active = true;
    const packageQuery = `&packageId=${encodeURIComponent(packageId)}`;
    Promise.all([
      api<Project>(`/api/projects/${encodeURIComponent(projectId)}`),
      api<{ items: BoqItem[] }>(
        `/api/boq?projectId=${encodeURIComponent(projectId)}${packageQuery}`,
      ),
      api<BastRecord[]>(
        `/api/bast?projectId=${encodeURIComponent(projectId)}${packageQuery}`,
      ),
      api<{ status: "Draft" | "Completed" }>(
        `/api/validations?projectId=${encodeURIComponent(projectId)}${packageQuery}`,
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
          setFinalizedAt(record.finalizedAt ?? null);
          setRevokedAt(record.revokedAt ?? null);
          return;
        }
        setBastId("");
        setBastNumber("");
        setBastStatus("Draft");
        setFinalizedAt(null);
        setRevokedAt(null);
        setClientSignature("");
        setEngineerSignature("");
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
  }, [id, language, notify, packageId, projectId]);

  useEffect(() => {
    if (!isAdmin) return;
    api<{ enabled: boolean; signerName: string; signerRole: string }>("/api/bast/settings/seal")
      .then((settings) => {
        setSealEnabled(settings.enabled);
        setSealName(settings.signerName);
        setSealRole(settings.signerRole);
      })
      .catch(() => undefined);
  }, [isAdmin]);

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
      packageId,
      deliveryCycle: 1,
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
    setFinalizedAt(record.finalizedAt ?? null);
    return record;
  }

  async function saveBast() {
    try {
      if (finalizedAt) throw new Error(id ? "BAST final bersifat immutable. Buat siklus atau revisi baru." : "A finalized handover is immutable. Create a new cycle or revision.");
      await persistBast("Draft");
      notify(id ? "Draft BAST dan tanda tangan berhasil disimpan." : "Handover draft and signatures saved.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function downloadBast() {
    try {
      let id = bastId;
      let number = bastNumber;
      if (canManage && !finalizedAt) {
        if (!clientSignature || !engineerSignature) {
          throw new Error(
            id
              ? "Lengkapi tanda tangan klien dan PerumNet sebelum membuat BAST final."
              : "Complete the client and PerumNet signatures before finalizing the handover.",
          );
        }
        const draft = await persistBast("Draft");
        const record = await api<BastRecord>(`/api/bast/${draft.id}/finalize`, { method: "POST" });
        id = record.id;
        number = record.number;
        setFinalizedAt(record.finalizedAt ?? null);
        setRevokedAt(record.revokedAt ?? null);
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
      setFinalizedAt(null);
      setRevokedAt(null);
      setClientSignature("");
      setEngineerSignature("");
      notify(language === "id" ? "BAST berhasil dihapus." : "The handover was deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  function openBastEmail() {
    if (!bastId || !project) {
      notify(id ? "Konteks BAST belum selesai dimuat." : "The handover context has not finished loading.");
      return;
    }
    setEmailTarget({
      kind: "bast",
      id: bastId,
      number: bastNumber,
      projectName: project.name,
      recipientName: project.clientContactName?.trim() || project.client,
      recipientEmail: project.clientEmail,
    });
  }

  async function saveSealSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      let sealContentBase64: string | undefined;
      let sealMimeType: string | undefined;
      if (sealFile) {
        if (sealFile.size > 2 * 1024 * 1024) {
          throw new Error(id ? "Gambar cap maksimal 2 MB." : "The seal image must not exceed 2 MB.");
        }
        if (!["image/png", "image/jpeg", "image/webp"].includes(sealFile.type)) {
          throw new Error(id ? "Gunakan gambar PNG, JPG, atau WebP." : "Use a PNG, JPG, or WebP image.");
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.readAsDataURL(sealFile);
        });
        sealContentBase64 = dataUrl.split(",")[1] ?? "";
        sealMimeType = sealFile.type;
      }
      await api("/api/bast/settings/seal", {
        method: "PUT",
        body: JSON.stringify({
          enabled: sealEnabled,
          signerName: sealName,
          signerRole: sealRole,
          ...(sealContentBase64 ? { sealContentBase64, sealMimeType } : {}),
        }),
      });
      setShowSealSettings(false);
      setSealFile(null);
      notify(id ? "Pengaturan cap digital disimpan." : "Digital seal settings saved.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  const signaturesComplete = Boolean(clientSignature && engineerSignature);
  const isFinal = Boolean(finalizedAt);
  const canEmail = Boolean(bastId && isFinal && !revokedAt);
  const canEdit = canManage && !isFinal;

  if (loading) {
    return <section className="panel empty-state"><p>{id ? "Memuat BAST..." : "Loading handover..."}</p></section>;
  }

  if (!packageId) {
    return (
      <section className="panel empty-state">
        <p>{id
          ? "Paket komersial proyek tidak dapat dimuat. Muat ulang halaman atau periksa koneksi Anda."
          : "The project's commercial packages could not be loaded. Reload the page or check your connection."}</p>
      </section>
    );
  }

  if (!validationCompleted && !bastId) {
    return (
      <div className="page-stack" data-testid="bast-view">
        <section className="page-title-row">
          <div>
            <span className="eyebrow">{id ? "SERAH TERIMA DIGITAL" : "DIGITAL HANDOVER"}</span>
            <h1>{id ? "BAST Digital" : "Digital Handover"}</h1>
            <p>{project ? `${project.code} · ${project.name}` : (id ? "Memuat konteks proyek..." : "Loading project context...")}</p>
          </div>
          <div className="title-actions">
            <CommercialPackageSwitcher projectId={projectId} language={language} canManage={canManage} value={packageId} onChange={selectPackage} notify={notify} />
          </div>
        </section>
        <div className="module-tabs" role="tablist" aria-label={id ? "BAST Digital" : "Digital handover"}>
          <button role="tab" aria-selected={activeTab === "bast"} className={activeTab === "bast" ? "active" : ""} type="button" onClick={() => setActiveTab("bast")}>
            <FileCheck2 size={17} /> BAST Digital
          </button>
          <button role="tab" aria-selected={activeTab === "templates"} className={activeTab === "templates" ? "active" : ""} type="button" onClick={() => setActiveTab("templates")}>
            <Mail size={17} /> {id ? "Template surat" : "Letter templates"}
          </button>
        </div>
        {activeTab === "templates" ? (
          <DocumentTemplateManager language={language} canManage={canManage} notify={notify} kinds={["bast"]} initialKind="bast" />
        ) : (
          <section className="panel empty-state validation-required-state" data-testid="bast-validation-gate">
            <ShieldCheck size={36} />
            <h2>{id ? "BAST belum dapat diterbitkan" : "Handover cannot be issued yet"}</h2>
            <p>{id ? "Selesaikan checklist pengujian seluruh Perangkat dan Material dari BoQ terlebih dahulu." : "Complete the test checklist for every Device and Material from the BoQ first."}</p>
            <button className="button primary" type="button" onClick={() => navigate("validation")}><FileCheck2 size={16} /> {id ? "Buka form validasi" : "Open validation form"}</button>
          </section>
        )}
      </div>
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
          <CommercialPackageSwitcher projectId={projectId} language={language} canManage={canManage} value={packageId} onChange={selectPackage} notify={notify} />
          {isAdmin && <button className="button secondary" type="button" onClick={() => setShowSealSettings(true)}><Stamp size={16} /> {id ? "Pengaturan cap" : "Seal settings"}</button>}
          {canEmail && <button className="button secondary" type="button" onClick={openBastEmail}><Mail size={16} /> {id ? "Kirim Email" : "Email client"}</button>}
          {canEdit && (
            <button className="button secondary" type="button" onClick={saveBast}>
              <Save size={16} /> {id ? "Simpan draft" : "Save draft"}
            </button>
          )}
          <button className="button primary" type="button" onClick={downloadBast}>
            <Download size={16} /> {canEdit ? (id ? "Finalkan & unduh" : "Finalize & download") : (id ? "Unduh PDF" : "Download PDF")}
          </button>
          {bastId && <button className="icon-button" type="button" aria-label={id ? "Pratinjau BAST" : "Preview handover"} onClick={() => setPreviewOpen(true)}><Eye size={18} /></button>}
          {canManage && bastId && !isFinal && (
            <button className="button danger" type="button" onClick={deleteBast}>
              <Trash2 size={16} /> {id ? "Hapus" : "Delete"}
            </button>
          )}
        </div>
      </section>

      <div className="module-tabs" role="tablist" aria-label={id ? "BAST Digital" : "Digital handover"}>
        <button role="tab" aria-selected={activeTab === "bast"} className={activeTab === "bast" ? "active" : ""} type="button" onClick={() => setActiveTab("bast")}>
          <FileCheck2 size={17} /> BAST Digital
        </button>
        <button role="tab" aria-selected={activeTab === "templates"} className={activeTab === "templates" ? "active" : ""} type="button" onClick={() => setActiveTab("templates")}>
          <Mail size={17} /> {id ? "Template surat" : "Letter templates"}
        </button>
      </div>

      {activeTab === "templates" ? (
        <DocumentTemplateManager language={language} canManage={canManage} notify={notify} kinds={["bast"]} initialKind="bast" />
      ) : (
        <>
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
              <img src={appPath("/perumnet-enterprise-brand.png")} alt="PerumNet Enterprise" width={120} height={126} />
              <div><strong>PERUMNET ENTERPRISE</strong><span>{id ? "Konsultan IT & Managed Services" : "IT Consulting & Managed Services"}</span><small>Gianyar, Bali · enterprise@perumnet.id</small></div>
              <span className="status-badge info"><ShieldCheck size={14} /> {isFinal ? "Final" : bastStatus}</span>
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
              <label className="field"><span>{id ? "Tanggal selesai" : "Completion date"}</span><input disabled={!canEdit} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="field"><span>{id ? "Lokasi" : "Location"}</span><input value={project?.location ?? ""} readOnly /></label>
            </section>

            <section className="installed-items">
              <div className="subsection-head">
                <div><span className="eyebrow">{id ? "ITEM TERPASANG" : "INSTALLED ITEMS"}</span><h3>{id ? "Hasil pekerjaan dari BoQ" : "Work results from the BoQ"}</h3></div>
                {canEdit && <button className="button secondary small" type="button" onClick={() => setInstalledItems((current) => [...current, { id: `new-${Date.now()}`, name: id ? "Item baru" : "New item", quantity: "1 unit", status: id ? "Terpasang" : "Installed" }])}><Plus size={14} /> {id ? "Tambah item" : "Add item"}</button>}
              </div>
              <div className="installed-item-list">
                {installedItems.map((item, index) => (
                  <div className="installed-item editable" key={item.id ?? `item-${index}`}>
                    <span className="installed-number">{index + 1}</span>
                    <div>
                      <input disabled={!canEdit} value={item.name} onChange={(event) => updateInstalledItem(index, "name", event.target.value)} aria-label={`${id ? "Nama item" : "Item name"} ${index + 1}`} />
                      <input disabled={!canEdit} value={item.quantity} onChange={(event) => updateInstalledItem(index, "quantity", event.target.value)} aria-label={`${id ? "Jumlah item" : "Item quantity"} ${index + 1}`} />
                    </div>
                    <input disabled={!canEdit} value={item.status} onChange={(event) => updateInstalledItem(index, "status", event.target.value)} aria-label={`${id ? "Status item" : "Item status"} ${index + 1}`} />
                    {canEdit && <button className="icon-button danger" type="button" aria-label={`${id ? "Hapus item" : "Delete item"} ${index + 1}`} onClick={() => setInstalledItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>}
                  </div>
                ))}
                {!installedItems.length && <div className="empty-state compact"><p>{id ? "BoQ belum memiliki item. Tambahkan item manual atau isi BoQ terlebih dahulu." : "The BoQ has no items. Add one manually or complete the BoQ first."}</p></div>}
              </div>
            </section>
            <label className="field bast-notes"><span>{id ? "Catatan serah terima" : "Handover notes"}</span><textarea disabled={!canEdit} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </article>

          <section className="panel signature-section">
            <div className="panel-head"><div><span className="eyebrow">{id ? "TANDA TANGAN DIGITAL" : "DIGITAL SIGNATURES"}</span><h2>{id ? "Persetujuan para pihak" : "Parties' approval"}</h2></div><span className="secure-label"><LockKeyhole size={14} /> {id ? "Tersimpan aman" : "Securely stored"}</span></div>
            <div className="signature-grid">
              <div>
                <div className="signer-fields">
                  <label className="field"><span>{id ? "Nama klien" : "Client name"}</span><input disabled={!canEdit} value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
                  <label className="field"><span>{id ? "Jabatan" : "Title"}</span><input disabled={!canEdit} value={clientRole} onChange={(event) => setClientRole(event.target.value)} /></label>
                </div>
                <SignaturePad language={language} label={id ? "Pihak Klien" : "Client"} signer={clientName} value={clientSignature} disabled={!canEdit} onChange={setClientSignature} />
              </div>
              <div>
                <div className="signer-fields">
                  <label className="field"><span>{id ? "Nama engineer / PM" : "Engineer / PM name"}</span><input disabled={!canEdit} value={engineerName} onChange={(event) => setEngineerName(event.target.value)} /></label>
                  <label className="field">
                    <span>{id ? "Jabatan di BAST" : "Role in handover"}</span>
                    <input
                      disabled={!canEdit}
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
                <SignaturePad language={language} label={id ? "Pihak PerumNet" : "PerumNet"} signer={engineerName} value={engineerSignature} disabled={!canEdit} onChange={setEngineerSignature} />
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
            {canEdit && <button className="button primary full-width" type="button" onClick={saveBast}><Save size={16} /> {id ? "Simpan Draft" : "Save Draft"}</button>}
            <button className="button secondary full-width" type="button" onClick={downloadBast}><Download size={16} /> {canEdit ? (id ? "Finalkan & unduh PDF" : "Finalize & download PDF") : (id ? "Unduh PDF final" : "Download final PDF")}</button>
          </section>
          <section className="security-note"><ShieldCheck size={20} /><div><strong>{id ? "Dokumen terlindungi" : "Protected document"}</strong><span>{id ? "Tanda tangan disimpan sebagai bagian dari BAST proyek." : "Signatures are stored as part of the project handover."}</span></div></section>
        </aside>
      </section>
        </>
      )}
      {emailTarget && <DocumentEmailDialog
        target={emailTarget}
        language={language}
        canManage={canManage}
        canViewHistory
        onClose={() => setEmailTarget(null)}
        onOpenRecipient={() => { setEmailTarget(null); navigate("project"); }}
        onOpenTemplateManager={() => { setEmailTarget(null); setActiveTab("templates"); }}
        onSent={async () => undefined}
      />}
      <DocumentPreviewModal open={previewOpen} url={bastId ? `/api/bast/${bastId}/pdf` : ""} title={bastNumber || "BAST"} filename={`${(bastNumber || "BAST-PerumNet").replaceAll("/", "-")}.pdf`} onClose={() => setPreviewOpen(false)} />
      {showSealSettings && (
        <div className="modal-backdrop" onMouseDown={() => setShowSealSettings(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="seal-settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">CAP DIGITAL INTERNAL</span><h2 id="seal-settings-title">{id ? "Identitas penandatangan perusahaan" : "Company signatory identity"}</h2></div><button className="icon-button" type="button" onClick={() => setShowSealSettings(false)} aria-label={id ? "Tutup" : "Close"}><X size={18} /></button></div>
            <form className="modal-form form-grid" onSubmit={saveSealSettings}>
              <label className="field full check-field"><input type="checkbox" checked={sealEnabled} onChange={(event) => setSealEnabled(event.target.checked)} /><span>{id ? "Aktifkan cap saat finalisasi" : "Enable seal during finalization"}</span></label>
              <label className="field full"><span>{id ? "Nama penandatangan" : "Signatory name"}</span><input required value={sealName} onChange={(event) => setSealName(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Jabatan" : "Title"}</span><input required value={sealRole} onChange={(event) => setSealRole(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Gambar cap (PNG/JPG/WebP, maks. 2 MB)" : "Seal image (PNG/JPG/WebP, max. 2 MB)"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setSealFile(event.target.files?.[0] ?? null)} /></label>
              <div className="security-note full"><ShieldCheck size={19} /><div><strong>{id ? "Cap internal tamper-evident" : "Tamper-evident internal seal"}</strong><span>{id ? "PDF final dikunci dengan hash SHA-256 dan QR verifikasi. Fitur ini bukan TTE tersertifikasi PSrE." : "The final PDF is locked with a SHA-256 hash and verification QR. This is not a certified PSrE signature."}</span></div></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowSealSettings(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><Stamp size={16} /> {id ? "Simpan cap" : "Save seal"}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
