"use client";

import {
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileCheck2,
  LockKeyhole,
  PenLine,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { SignaturePad } from "./signature-pad";

interface BastViewProps {
  notify: (message: string) => void;
}

const installedItems = [
  { name: "Access Point WiFi 6 Indoor", quantity: "12 unit", status: "Terpasang & diuji" },
  { name: "Managed PoE Switch 24 Port", quantity: "2 unit", status: "Terpasang & diuji" },
  { name: "Kabel UTP Cat6 Outdoor", quantity: "8 box", status: "Terpasang" },
  { name: "Controller & konfigurasi SSID", quantity: "1 paket", status: "Aktif" },
];

export function BastView({ notify }: BastViewProps) {
  const [clientName, setClientName] = useState("I Made Surya Wijaya");
  const [clientRole, setClientRole] = useState("General Manager");
  const [engineerName, setEngineerName] = useState("Dewa Mahardika");
  const [date, setDate] = useState("2026-08-02");
  const [notes, setNotes] = useState("Seluruh perangkat telah diuji dan berfungsi sesuai lingkup pekerjaan serta dokumen penawaran yang disepakati.");
  const [clientSignature, setClientSignature] = useState("");
  const [engineerSignature, setEngineerSignature] = useState("");
  const [saved, setSaved] = useState(false);

  function saveBast() {
    setSaved(true);
    notify("BAST dan tanda tangan berhasil disimpan.");
  }

  async function downloadBast() {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(4, 169, 159);
    pdf.rect(0, 0, pageWidth, 18, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(255, 255, 255);
    pdf.text("PERUMNET ENTERPRISE", 15, 11.5);
    pdf.setTextColor(49, 80, 94);
    pdf.setFontSize(18);
    pdf.text("BERITA ACARA SERAH TERIMA", pageWidth / 2, 33, { align: "center" });
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(105, 121, 124);
    pdf.text("BAST/PN/VIII/2026/014", pageWidth / 2, 40, { align: "center" });
    pdf.setDrawColor(218, 231, 228);
    pdf.line(15, 47, pageWidth - 15, 47);
    pdf.setTextColor(37, 57, 65);
    pdf.setFontSize(10);
    const intro = `Pada tanggal ${new Date(date).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}, telah dilakukan serah terima pekerjaan proyek Implementasi WiFi Resort Ubud kepada Bali Serenity Resort.`;
    pdf.text(pdf.splitTextToSize(intro, pageWidth - 30), 15, 57);
    let y = 73;
    installedItems.forEach((item, index) => {
      pdf.setFont("helvetica", "bold");
      pdf.text(`${index + 1}. ${item.name}`, 15, y);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${item.quantity} · ${item.status}`, 115, y);
      y += 8;
    });
    pdf.setDrawColor(218, 231, 228);
    pdf.line(15, y + 2, pageWidth - 15, y + 2);
    y += 12;
    pdf.setFont("helvetica", "bold");
    pdf.text("Catatan serah terima", 15, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(pdf.splitTextToSize(notes, pageWidth - 30), 15, y + 7);
    y += 34;
    pdf.setFont("helvetica", "bold");
    pdf.text("Pihak Klien", 15, y);
    pdf.text("Pihak PerumNet", 112, y);
    if (clientSignature) pdf.addImage(clientSignature, "PNG", 15, y + 5, 65, 25);
    if (engineerSignature) pdf.addImage(engineerSignature, "PNG", 112, y + 5, 65, 25);
    pdf.setDrawColor(150, 163, 164);
    pdf.line(15, y + 34, 80, y + 34);
    pdf.line(112, y + 34, 177, y + 34);
    pdf.setFont("helvetica", "bold");
    pdf.text(clientName, 15, y + 41);
    pdf.text(engineerName, 112, y + 41);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(105, 121, 124);
    pdf.text(clientRole, 15, y + 47);
    pdf.text("Project Manager", 112, y + 47);
    pdf.save("BAST-PerumNet-014.pdf");
    notify("BAST PDF bertanda tangan berhasil dibuat.");
  }

  const signaturesComplete = Boolean(clientSignature && engineerSignature);

  return (
    <div className="page-stack" data-testid="bast-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">SERAH TERIMA DIGITAL</span>
          <h1>BAST Digital</h1>
          <p>Tinjau pekerjaan, bubuhkan tanda tangan, dan hasilkan dokumen final.</p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={saveBast}>
            <Save size={16} /> Simpan draft
          </button>
          <button className="button primary" type="button" onClick={downloadBast}>
            <Download size={16} /> Unduh PDF
          </button>
        </div>
      </section>

      <section className="bast-stepper" aria-label="Tahapan BAST">
        <div className="done"><span><Check size={15} /></span><div><strong>Data proyek</strong><small>Lengkap</small></div></div>
        <div className="line done" />
        <div className="done"><span><Check size={15} /></span><div><strong>Item terpasang</strong><small>Terverifikasi</small></div></div>
        <div className={`line ${signaturesComplete ? "done" : ""}`} />
        <div className={signaturesComplete ? "done" : "active"}><span><PenLine size={15} /></span><div><strong>Tanda tangan</strong><small>{signaturesComplete ? "Lengkap" : "Dalam proses"}</small></div></div>
        <div className={`line ${saved ? "done" : ""}`} />
        <div className={saved ? "done" : ""}><span><FileCheck2 size={15} /></span><div><strong>Dokumen final</strong><small>{saved ? "Siap diunduh" : "Belum final"}</small></div></div>
      </section>

      <section className="bast-layout">
        <div className="bast-main">
          <article className="panel bast-document">
            <header className="bast-letterhead">
              <img src="/perumnet-enterprise-logo.png" alt="PerumNet Enterprise" width={120} height={126} />
              <div>
                <strong>PERUMNET ENTERPRISE</strong>
                <span>Konsultan IT & Managed Services</span>
                <small>Gianyar, Bali · hello@perumnet.id</small>
              </div>
              <span className="status-badge info"><ShieldCheck size={14} /> Dokumen digital</span>
            </header>
            <div className="bast-title">
              <span>BERITA ACARA SERAH TERIMA</span>
              <h2>Implementasi WiFi Resort Ubud</h2>
              <small>Nomor: BAST/PN/VIII/2026/014</small>
            </div>
            <div className="bast-intro">
              Pada hari ini, para pihak menerangkan bahwa pekerjaan berikut telah diselesaikan dan
              diserahterimakan dalam kondisi baik sesuai lingkup kerja yang disepakati.
            </div>
            <section className="bast-data-grid">
              <label className="field">
                <span>Nama proyek</span>
                <input value="Implementasi WiFi Resort Ubud" readOnly />
              </label>
              <label className="field">
                <span>Klien</span>
                <input value="Bali Serenity Resort" readOnly />
              </label>
              <label className="field">
                <span>Tanggal selesai</span>
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label className="field">
                <span>Lokasi</span>
                <input value="Ubud, Gianyar, Bali" readOnly />
              </label>
            </section>
            <section className="installed-items">
              <div className="subsection-head">
                <div><span className="eyebrow">ITEM TERPASANG</span><h3>Hasil pekerjaan</h3></div>
                <span className="status-badge success"><CheckCircle2 size={14} /> {installedItems.length} terverifikasi</span>
              </div>
              <div className="installed-item-list">
                {installedItems.map((item, index) => (
                  <div className="installed-item" key={item.name}>
                    <span className="installed-number">{index + 1}</span>
                    <div><strong>{item.name}</strong><span>{item.quantity}</span></div>
                    <span className="status-badge success"><Check size={13} /> {item.status}</span>
                  </div>
                ))}
              </div>
            </section>
            <label className="field bast-notes">
              <span>Catatan serah terima</span>
              <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </article>

          <section className="panel signature-section">
            <div className="panel-head">
              <div><span className="eyebrow">TANDA TANGAN DIGITAL</span><h2>Persetujuan para pihak</h2></div>
              <span className="secure-label"><LockKeyhole size={14} /> Tersimpan aman</span>
            </div>
            <div className="signature-grid">
              <div>
                <div className="signer-fields">
                  <label className="field"><span>Nama klien</span><input value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
                  <label className="field"><span>Jabatan</span><input value={clientRole} onChange={(event) => setClientRole(event.target.value)} /></label>
                </div>
                <SignaturePad label="Pihak Klien" signer={clientName} onChange={setClientSignature} />
              </div>
              <div>
                <div className="signer-fields">
                  <label className="field"><span>Nama engineer / PM</span><input value={engineerName} onChange={(event) => setEngineerName(event.target.value)} /></label>
                  <label className="field select-field"><span>Jabatan</span><select defaultValue="Project Manager"><option>Project Manager</option><option>Engineer</option><option>Direktur</option></select><ChevronDown size={15} /></label>
                </div>
                <SignaturePad label="Pihak PerumNet" signer={engineerName} onChange={setEngineerSignature} />
              </div>
            </div>
            <div className={`signature-completion ${signaturesComplete ? "complete" : ""}`}>
              {signaturesComplete ? <CheckCircle2 size={18} /> : <PenLine size={18} />}
              <div>
                <strong>{signaturesComplete ? "Tanda tangan lengkap" : "Menunggu tanda tangan"}</strong>
                <span>{signaturesComplete ? "Dokumen siap disimpan dan diunduh." : "Klien dan perwakilan PerumNet perlu menandatangani."}</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="bast-side">
          <section className="panel bast-summary">
            <div className="panel-head"><div><span className="eyebrow">RINGKASAN</span><h2>Status dokumen</h2></div></div>
            <div className="bast-status-list">
              <div><span><Check size={14} /></span><div><strong>Data proyek</strong><small>Terisi otomatis</small></div></div>
              <div><span><Check size={14} /></span><div><strong>4 item pekerjaan</strong><small>Sudah diverifikasi</small></div></div>
              <div className={clientSignature ? "" : "pending"}><span>{clientSignature ? <Check size={14} /> : <PenLine size={14} />}</span><div><strong>Tanda tangan klien</strong><small>{clientSignature ? "Tersimpan" : "Belum ada"}</small></div></div>
              <div className={engineerSignature ? "" : "pending"}><span>{engineerSignature ? <Check size={14} /> : <PenLine size={14} />}</span><div><strong>Tanda tangan PerumNet</strong><small>{engineerSignature ? "Tersimpan" : "Belum ada"}</small></div></div>
            </div>
            <button className="button primary full-width" type="button" onClick={saveBast}><Save size={16} /> Simpan BAST</button>
            <button className="button secondary full-width" type="button" onClick={downloadBast}><Download size={16} /> Unduh PDF final</button>
          </section>
          <section className="security-note">
            <ShieldCheck size={20} />
            <div><strong>Dokumen terlindungi</strong><span>Tanda tangan disimpan sebagai bagian dari dokumen dan siap dicetak.</span></div>
          </section>
        </aside>
      </section>
    </div>
  );
}
