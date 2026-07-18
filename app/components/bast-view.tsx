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
import { BoqItem, Project } from "../data";
import { appPath } from "../paths";
import { SignaturePad } from "./signature-pad";

interface BastViewProps {
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
  notify,
  projectId,
  canManage,
  userName,
  onProjectUpdated,
}: BastViewProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [installedItems, setInstalledItems] = useState<InstalledItem[]>([]);
  const [clientName, setClientName] = useState("");
  const [clientRole, setClientRole] = useState("Perwakilan Klien");
  const [engineerName, setEngineerName] = useState(userName);
  const [engineerRole, setEngineerRole] = useState("Project Manager");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(
    "Seluruh pekerjaan telah diuji dan berfungsi sesuai lingkup pekerjaan yang disepakati.",
  );
  const [clientSignature, setClientSignature] = useState("");
  const [engineerSignature, setEngineerSignature] = useState("");
  const [bastStatus, setBastStatus] = useState<"Draft" | "Final">("Draft");
  const [bastId, setBastId] = useState("");
  const [bastNumber, setBastNumber] = useState("");

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
    ])
      .then(([projectData, boq, records]) => {
        if (!active) return;
        setProject(projectData);
        const record = records[0];
        if (record) {
          setBastId(record.id);
          setBastNumber(record.number);
          setDate(record.completionDate);
          setNotes(record.notes);
          setInstalledItems(
            record.installedItems.map((item, index) => ({
              ...item,
              id: `saved-${index}-${item.name}`,
            })),
          );
          setClientName(record.clientName);
          setClientRole(record.clientRole);
          setClientSignature(record.clientSignature);
          setEngineerName(record.engineerName);
          setEngineerRole(record.engineerRole);
          setEngineerSignature(record.engineerSignature);
          setBastStatus(record.status);
          return;
        }
        setClientName(projectData.client);
        setClientRole("Perwakilan Klien");
        setInstalledItems(
          boq.items.map((item) => ({
            id: item.id,
            name: item.description,
            quantity: `${item.quantity} ${item.unit}`,
            status: "Terpasang & diuji",
          })),
        );
      })
      .catch((error) => notify(messageOf(error)));
    return () => {
      active = false;
    };
  }, [notify, projectId]);

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
        "BAST membutuhkan minimal satu item terpasang. Isi BoQ atau tambahkan item manual.",
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
          ? "Perubahan BAST final berhasil disimpan."
          : "Draft BAST dan tanda tangan berhasil disimpan.",
      );
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function downloadBast() {
    try {
      let id = bastId;
      let number = bastNumber;
      if (canManage) {
        if (!clientSignature || !engineerSignature) {
          throw new Error(
            "Lengkapi tanda tangan klien dan PerumNet sebelum membuat BAST final.",
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
      if (!id) throw new Error("Simpan BAST terlebih dahulu.");
      await downloadApiFile(
        `/api/bast/${id}/pdf`,
        `${number.replaceAll("/", "-") || "BAST-PerumNet"}.pdf`,
      );
      notify("BAST PDF bertanda tangan berhasil dibuat.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function deleteBast() {
    if (!bastId || !window.confirm(`Hapus ${bastNumber || "BAST ini"}?`)) return;
    try {
      await api(`/api/bast/${bastId}`, { method: "DELETE" });
      setBastId("");
      setBastNumber("");
      setBastStatus("Draft");
      setClientSignature("");
      setEngineerSignature("");
      notify("BAST berhasil dihapus.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  const signaturesComplete = Boolean(clientSignature && engineerSignature);
  const isFinal = bastStatus === "Final";

  return (
    <div className="page-stack" data-testid="bast-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">SERAH TERIMA DIGITAL</span>
          <h1>BAST Digital</h1>
          <p>
            {project
              ? `${project.code} · ${project.name}`
              : "Memuat konteks proyek..."}
          </p>
        </div>
        <div className="title-actions">
          {canManage && (
            <button className="button secondary" type="button" onClick={saveBast}>
              <Save size={16} /> {isFinal ? "Simpan perubahan" : "Simpan draft"}
            </button>
          )}
          <button className="button primary" type="button" onClick={downloadBast}>
            <Download size={16} /> {canManage ? "Finalkan & unduh" : "Unduh PDF"}
          </button>
          {canManage && bastId && (
            <button className="button danger" type="button" onClick={deleteBast}>
              <Trash2 size={16} /> Hapus
            </button>
          )}
        </div>
      </section>

      <section className="bast-stepper" aria-label="Tahapan BAST">
        <div className="done"><span><Check size={15} /></span><div><strong>Data proyek</strong><small>Sinkron</small></div></div>
        <div className="line done" />
        <div className={installedItems.length ? "done" : "active"}><span><Check size={15} /></span><div><strong>Item terpasang</strong><small>{installedItems.length} item</small></div></div>
        <div className={`line ${signaturesComplete ? "done" : ""}`} />
        <div className={signaturesComplete ? "done" : "active"}><span><PenLine size={15} /></span><div><strong>Tanda tangan</strong><small>{signaturesComplete ? "Lengkap" : "Dalam proses"}</small></div></div>
        <div className={`line ${isFinal ? "done" : ""}`} />
        <div className={isFinal ? "done" : ""}><span><FileCheck2 size={15} /></span><div><strong>Dokumen final</strong><small>{isFinal ? "Siap diunduh" : "Masih Draft"}</small></div></div>
      </section>

      <section className="bast-layout">
        <div className="bast-main">
          <article className="panel bast-document">
            <header className="bast-letterhead">
              <img src={appPath("/perumnet-enterprise-logo.png")} alt="PerumNet Enterprise" width={120} height={126} />
              <div><strong>PERUMNET ENTERPRISE</strong><span>Konsultan IT & Managed Services</span><small>Gianyar, Bali · it@perumnet.id</small></div>
              <span className="status-badge info"><ShieldCheck size={14} /> {bastStatus}</span>
            </header>
            <div className="bast-title">
              <span>BERITA ACARA SERAH TERIMA</span>
              <h2>{project?.name ?? "Proyek"}</h2>
              <small>Nomor: {bastNumber || "Dibuat saat BAST disimpan"}</small>
            </div>
            <div className="bast-intro">
              Para pihak menerangkan bahwa pekerjaan berikut telah diselesaikan
              dan diserahterimakan dalam kondisi baik sesuai lingkup kerja yang
              disepakati.
            </div>
            <section className="bast-data-grid">
              <label className="field"><span>Nama proyek</span><input value={project?.name ?? ""} readOnly /></label>
              <label className="field"><span>Klien</span><input value={project?.client ?? ""} readOnly /></label>
              <label className="field"><span>Tanggal selesai</span><input disabled={!canManage} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="field"><span>Lokasi</span><input value={project?.location ?? ""} readOnly /></label>
            </section>

            <section className="installed-items">
              <div className="subsection-head">
                <div><span className="eyebrow">ITEM TERPASANG</span><h3>Hasil pekerjaan dari BoQ</h3></div>
                {canManage && <button className="button secondary small" type="button" onClick={() => setInstalledItems((current) => [...current, { id: `new-${Date.now()}`, name: "Item baru", quantity: "1 unit", status: "Terpasang" }])}><Plus size={14} /> Tambah item</button>}
              </div>
              <div className="installed-item-list">
                {installedItems.map((item, index) => (
                  <div className="installed-item editable" key={item.id ?? `item-${index}`}>
                    <span className="installed-number">{index + 1}</span>
                    <div>
                      <input disabled={!canManage} value={item.name} onChange={(event) => updateInstalledItem(index, "name", event.target.value)} aria-label={`Nama item ${index + 1}`} />
                      <input disabled={!canManage} value={item.quantity} onChange={(event) => updateInstalledItem(index, "quantity", event.target.value)} aria-label={`Jumlah item ${index + 1}`} />
                    </div>
                    <input disabled={!canManage} value={item.status} onChange={(event) => updateInstalledItem(index, "status", event.target.value)} aria-label={`Status item ${index + 1}`} />
                    {canManage && <button className="icon-button danger" type="button" aria-label={`Hapus item ${index + 1}`} onClick={() => setInstalledItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>}
                  </div>
                ))}
                {!installedItems.length && <div className="empty-state compact"><p>BoQ belum memiliki item. Tambahkan item manual atau isi BoQ terlebih dahulu.</p></div>}
              </div>
            </section>
            <label className="field bast-notes"><span>Catatan serah terima</span><textarea disabled={!canManage} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </article>

          <section className="panel signature-section">
            <div className="panel-head"><div><span className="eyebrow">TANDA TANGAN DIGITAL</span><h2>Persetujuan para pihak</h2></div><span className="secure-label"><LockKeyhole size={14} /> Tersimpan aman</span></div>
            <div className="signature-grid">
              <div>
                <div className="signer-fields">
                  <label className="field"><span>Nama klien</span><input disabled={!canManage} value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
                  <label className="field"><span>Jabatan</span><input disabled={!canManage} value={clientRole} onChange={(event) => setClientRole(event.target.value)} /></label>
                </div>
                <SignaturePad label="Pihak Klien" signer={clientName} value={clientSignature} disabled={!canManage} onChange={setClientSignature} />
              </div>
              <div>
                <div className="signer-fields">
                  <label className="field"><span>Nama engineer / PM</span><input disabled={!canManage} value={engineerName} onChange={(event) => setEngineerName(event.target.value)} /></label>
                  <label className="field">
                    <span>Jabatan di BAST</span>
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
                <SignaturePad label="Pihak PerumNet" signer={engineerName} value={engineerSignature} disabled={!canManage} onChange={setEngineerSignature} />
              </div>
            </div>
            <div className={`signature-completion ${signaturesComplete ? "complete" : ""}`}>
              {signaturesComplete ? <CheckCircle2 size={18} /> : <PenLine size={18} />}
              <div><strong>{signaturesComplete ? "Tanda tangan lengkap" : "Menunggu tanda tangan"}</strong><span>{signaturesComplete ? "Dokumen siap difinalkan dan diunduh." : "Klien dan perwakilan PerumNet perlu menandatangani."}</span></div>
            </div>
          </section>
        </div>

        <aside className="bast-side">
          <section className="panel bast-summary">
            <div className="panel-head"><div><span className="eyebrow">RINGKASAN</span><h2>Status dokumen</h2></div></div>
            <div className="bast-status-list">
              <div><span><Check size={14} /></span><div><strong>Data proyek</strong><small>Terisi otomatis</small></div></div>
              <div className={installedItems.length ? "" : "pending"}><span><Check size={14} /></span><div><strong>{installedItems.length} item pekerjaan</strong><small>Disinkronkan dari BoQ</small></div></div>
              <div className={clientSignature ? "" : "pending"}><span>{clientSignature ? <Check size={14} /> : <PenLine size={14} />}</span><div><strong>Tanda tangan klien</strong><small>{clientSignature ? "Tersimpan" : "Belum ada"}</small></div></div>
              <div className={engineerSignature ? "" : "pending"}><span>{engineerSignature ? <Check size={14} /> : <PenLine size={14} />}</span><div><strong>Tanda tangan PerumNet</strong><small>{engineerSignature ? "Tersimpan" : "Belum ada"}</small></div></div>
            </div>
            {canManage && <button className="button primary full-width" type="button" onClick={saveBast}><Save size={16} /> {isFinal ? "Simpan Perubahan" : "Simpan Draft"}</button>}
            <button className="button secondary full-width" type="button" onClick={downloadBast}><Download size={16} /> {canManage ? "Finalkan & unduh PDF" : "Unduh PDF final"}</button>
          </section>
          <section className="security-note"><ShieldCheck size={20} /><div><strong>Dokumen terlindungi</strong><span>Tanda tangan disimpan sebagai bagian dari BAST proyek.</span></div></section>
        </aside>
      </section>
    </div>
  );
}
