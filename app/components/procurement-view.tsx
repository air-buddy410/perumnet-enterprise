"use client";

import {
  Building2,
  ChevronDown,
  Download,
  FilePlus2,
  FileText,
  Filter,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Store,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import {
  formatCurrency,
  initialVendors,
  initialWorkOrders,
  Vendor,
  WorkOrder,
} from "../data";
import { currencyLine, downloadDocument } from "../pdf";

interface ProcurementViewProps {
  notify: (message: string) => void;
}

type ProcurementTab = "vendor" | "spk";

const spkStatuses: WorkOrder["status"][] = ["Draft", "Dikirim", "Dikerjakan", "Selesai"];

function spkStatusClass(status: WorkOrder["status"]) {
  if (status === "Selesai") return "success";
  if (status === "Dikerjakan") return "info";
  if (status === "Dikirim") return "warning";
  return "neutral";
}

export function ProcurementView({ notify }: ProcurementViewProps) {
  const [activeTab, setActiveTab] = useState<ProcurementTab>("vendor");
  const [vendors, setVendors] = useState(initialVendors);
  const [workOrders, setWorkOrders] = useState(initialWorkOrders);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Semua kategori");
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [showSpkForm, setShowSpkForm] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorCategory, setVendorCategory] = useState("Teknisi Jaringan");
  const [vendorContact, setVendorContact] = useState("");
  const [vendorRate, setVendorRate] = useState(0);
  const [spkVendor, setSpkVendor] = useState(initialVendors[0].name);
  const [spkScope, setSpkScope] = useState("");
  const [spkCost, setSpkCost] = useState(0);

  const filteredVendors = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return vendors.filter((vendor) => {
      const matchesQuery =
        !normalized ||
        [vendor.name, vendor.category, vendor.contact].join(" ").toLowerCase().includes(normalized);
      const matchesCategory = category === "Semua kategori" || vendor.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [category, query, vendors]);

  const categories = ["Semua kategori", ...Array.from(new Set(vendors.map((vendor) => vendor.category)))];

  function addVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vendorName.trim() || !vendorContact.trim()) return;
    const vendor: Vendor = {
      id: `vendor-${Date.now()}`,
      name: vendorName.trim(),
      category: vendorCategory,
      contact: vendorContact.trim(),
      rate: vendorRate,
      status: "Aktif",
    };
    setVendors((current) => [vendor, ...current]);
    setSpkVendor(vendor.name);
    setVendorName("");
    setVendorContact("");
    setVendorRate(0);
    setShowVendorForm(false);
    notify("Vendor baru berhasil ditambahkan.");
  }

  function createSpk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!spkScope.trim() || spkCost <= 0) return;
    setWorkOrders((current) => [
      {
        id: `spk-${Date.now()}`,
        number: `SPK/PN/VII/2026/${String(22 + current.length).padStart(3, "0")}`,
        vendor: spkVendor,
        project: "Implementasi WiFi Resort Ubud",
        scope: spkScope.trim(),
        cost: spkCost,
        status: "Draft",
      },
      ...current,
    ]);
    setSpkScope("");
    setSpkCost(0);
    setShowSpkForm(false);
    setActiveTab("spk");
    notify("SPK berhasil dibuat sebagai draft.");
  }

  function updateSpkStatus(id: string, status: WorkOrder["status"]) {
    setWorkOrders((current) =>
      current.map((workOrder) => (workOrder.id === id ? { ...workOrder, status } : workOrder)),
    );
    notify(`Status SPK diperbarui menjadi ${status}.`);
  }

  async function downloadSpk(workOrder: WorkOrder) {
    await downloadDocument(
      "Surat Perintah Kerja",
      workOrder.number,
      [
        { label: "Vendor", value: workOrder.vendor },
        { label: "Proyek", value: workOrder.project },
        { label: "Lingkup kerja", value: workOrder.scope },
        currencyLine("Biaya disepakati", workOrder.cost, true),
        { label: "Status", value: workOrder.status },
        { value: "Pihak pelaksana wajib menyelesaikan pekerjaan sesuai spesifikasi, jadwal, dan standar keselamatan kerja PerumNet Enterprise." },
      ],
      `${workOrder.number.replaceAll("/", "-")}.pdf`,
    );
    notify("SPK PDF berhasil dibuat.");
  }

  return (
    <div className="page-stack" data-testid="procurement-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">MITRA & PENUGASAN</span>
          <h1>Procurement & Vendor</h1>
          <p>Kelola mitra kerja dan Surat Perintah Kerja secara terpusat.</p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={() => { setActiveTab("vendor"); setShowVendorForm(true); }}>
            <Plus size={16} /> Tambah vendor
          </button>
          <button className="button primary" type="button" onClick={() => { setActiveTab("spk"); setShowSpkForm(true); }}>
            <FilePlus2 size={16} /> Buat SPK
          </button>
        </div>
      </section>

      <section className="metric-grid procurement-metrics">
        <article className="metric-card">
          <span className="metric-icon teal"><Store size={20} /></span>
          <div className="metric-main"><span>Vendor aktif</span><strong>{vendors.filter((vendor) => vendor.status === "Aktif").length}</strong></div>
          <span className="metric-change">4 kategori layanan</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue"><FileText size={20} /></span>
          <div className="metric-main"><span>SPK berjalan</span><strong>{workOrders.filter((item) => item.status === "Dikerjakan").length}</strong></div>
          <span className="metric-change">2 proyek</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><UsersRound size={20} /></span>
          <div className="metric-main"><span>Nilai SPK aktif</span><strong>{formatCurrency(workOrders.filter((item) => item.status !== "Selesai").reduce((sum, item) => sum + item.cost, 0))}</strong></div>
          <span className="metric-change warning-text">Perlu rekonsiliasi</span>
        </article>
      </section>

      <div className="module-tabs" role="tablist" aria-label="Procurement">
        <button role="tab" aria-selected={activeTab === "vendor"} className={activeTab === "vendor" ? "active" : ""} type="button" onClick={() => setActiveTab("vendor")}>
          <Store size={17} /> Daftar vendor <span className="tab-count">{vendors.length}</span>
        </button>
        <button role="tab" aria-selected={activeTab === "spk"} className={activeTab === "spk" ? "active" : ""} type="button" onClick={() => setActiveTab("spk")}>
          <FileText size={17} /> Daftar SPK <span className="tab-count">{workOrders.length}</span>
        </button>
      </div>

      {activeTab === "vendor" && (
        <section className="panel">
          <div className="panel-head vendor-list-head">
            <div>
              <span className="eyebrow">DIREKTORI MITRA</span>
              <h2>Vendor & supplier</h2>
            </div>
            <div className="project-tools">
              <label className="search-field compact">
                <Search size={16} />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari vendor..." />
              </label>
              <label className="select-compact">
                <Filter size={15} />
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((item) => <option key={item}>{item}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
          </div>
          <div className="vendor-grid">
            {filteredVendors.map((vendor, index) => (
              <article className={`vendor-card ${vendor.status === "Nonaktif" ? "disabled" : ""}`} key={vendor.id}>
                <div className="vendor-card-head">
                  <span className={`vendor-logo variant-${index % 4}`}><Building2 size={21} /></span>
                  <span className={`status-badge ${vendor.status === "Aktif" ? "success" : "neutral"}`}>{vendor.status}</span>
                  <button className="icon-button" type="button" aria-label={`Menu ${vendor.name}`} onClick={() => notify("Aksi edit vendor tersedia pada versi frontend ini.")}><MoreHorizontal size={17} /></button>
                </div>
                <div className="vendor-card-copy">
                  <strong>{vendor.name}</strong>
                  <span>{vendor.category}</span>
                </div>
                <div className="vendor-contact-list">
                  <span><Phone size={14} /> {vendor.contact}</span>
                  <span><Mail size={14} /> procurement@vendor.id</span>
                  <span><MapPin size={14} /> Bali</span>
                </div>
                <div className="vendor-rate">
                  <span>Tarif standar</span>
                  <strong>{vendor.rate ? `${formatCurrency(vendor.rate)} / hari` : "Sesuai quotation"}</strong>
                </div>
                <button className="button subtle full-width" type="button" onClick={() => { setSpkVendor(vendor.name); setShowSpkForm(true); }}>
                  <FilePlus2 size={15} /> Buat SPK untuk vendor
                </button>
              </article>
            ))}
          </div>
          {!filteredVendors.length && (
            <div className="empty-state"><Search size={28} /><h3>Vendor tidak ditemukan</h3><p>Coba kata kunci atau kategori lain.</p></div>
          )}
        </section>
      )}

      {activeTab === "spk" && (
        <section className="panel">
          <div className="panel-head">
            <div><span className="eyebrow">SURAT PERINTAH KERJA</span><h2>Daftar SPK</h2></div>
            <button className="button primary small" type="button" onClick={() => setShowSpkForm(true)}><Plus size={15} /> SPK baru</button>
          </div>
          <div className="spk-list">
            {workOrders.map((workOrder) => (
              <article className="spk-row" key={workOrder.id}>
                <span className="spk-document-icon"><FileText size={20} /></span>
                <div className="spk-primary">
                  <strong>{workOrder.number}</strong>
                  <span>{workOrder.vendor}</span>
                </div>
                <div className="spk-project">
                  <span>Proyek</span>
                  <strong>{workOrder.project}</strong>
                </div>
                <div className="spk-scope">
                  <span>Lingkup kerja</span>
                  <strong>{workOrder.scope}</strong>
                </div>
                <div className="spk-cost"><span>Nilai</span><strong>{formatCurrency(workOrder.cost)}</strong></div>
                <label className={`status-select ${spkStatusClass(workOrder.status)}`}>
                  <select value={workOrder.status} onChange={(event) => updateSpkStatus(workOrder.id, event.target.value as WorkOrder["status"])}>
                    {spkStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </label>
                <button className="button subtle small" type="button" onClick={() => downloadSpk(workOrder)}><Download size={15} /> PDF</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {showVendorForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowVendorForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="vendor-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">VENDOR BARU</span><h2 id="vendor-form-title">Tambah mitra kerja</h2></div>
              <button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowVendorForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={addVendor}>
              <label className="field full"><span>Nama vendor</span><input required value={vendorName} onChange={(event) => setVendorName(event.target.value)} placeholder="Nama badan usaha / teknisi" /></label>
              <label className="field full"><span>Kategori</span><select value={vendorCategory} onChange={(event) => setVendorCategory(event.target.value)}><option>Teknisi Jaringan</option><option>Splicing Fiber Optic</option><option>Instalasi CCTV</option><option>Supplier Perangkat</option></select></label>
              <label className="field"><span>Kontak</span><input required value={vendorContact} onChange={(event) => setVendorContact(event.target.value)} placeholder="08xx xxxx xxxx" /></label>
              <label className="field"><span>Tarif standar / hari</span><input type="number" min="0" value={vendorRate || ""} onChange={(event) => setVendorRate(Number(event.target.value))} placeholder="0" /></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowVendorForm(false)}>Batal</button><button className="button primary" type="submit"><Plus size={16} /> Simpan vendor</button></div>
            </form>
          </section>
        </div>
      )}

      {showSpkForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowSpkForm(false)}>
          <section className="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="spk-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">SPK BARU</span><h2 id="spk-form-title">Surat Perintah Kerja</h2></div>
              <button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowSpkForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={createSpk}>
              <label className="field full"><span>Vendor / pelaksana</span><select value={spkVendor} onChange={(event) => setSpkVendor(event.target.value)}>{vendors.filter((vendor) => vendor.status === "Aktif").map((vendor) => <option key={vendor.id}>{vendor.name}</option>)}</select></label>
              <label className="field full"><span>Proyek terkait</span><select><option>Implementasi WiFi Resort Ubud</option><option>CCTV & Network Warehouse</option></select></label>
              <label className="field full"><span>Lingkup pekerjaan</span><textarea required value={spkScope} onChange={(event) => setSpkScope(event.target.value)} placeholder="Jelaskan pekerjaan, output, dan batasan tanggung jawab..." rows={4} /></label>
              <label className="field full"><span>Biaya disepakati</span><input type="number" min="1" required value={spkCost || ""} onChange={(event) => setSpkCost(Number(event.target.value))} placeholder="0" /></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowSpkForm(false)}>Batal</button><button className="button primary" type="submit"><FilePlus2 size={16} /> Simpan sebagai draft</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
