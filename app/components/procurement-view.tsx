"use client";

import {
  Building2,
  CircleDollarSign,
  ChevronDown,
  Download,
  FilePlus2,
  FileText,
  Filter,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Store,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import {
  formatCurrency,
  Project,
  Vendor,
  WorkOrder,
} from "../data";
import { type AppLanguage, localizedLabel } from "../i18n";

interface ProcurementViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projectId?: string;
  canManage: boolean;
  canManageVendors: boolean;
  canManagePayments: boolean;
}

type ProcurementTab = "vendor" | "spk";

const spkStatuses: WorkOrder["status"][] = ["Draft", "Dikirim", "Dikerjakan", "Selesai"];

function spkStatusClass(status: WorkOrder["status"]) {
  if (status === "Selesai") return "success";
  if (status === "Dikerjakan") return "info";
  if (status === "Dikirim") return "warning";
  return "neutral";
}

export function ProcurementView({ language, notify, projectId, canManage, canManageVendors, canManagePayments }: ProcurementViewProps) {
  const id = language === "id";
  const [activeTab, setActiveTab] = useState<ProcurementTab>("vendor");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Semua kategori");
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState("");
  const [showSpkForm, setShowSpkForm] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorCategory, setVendorCategory] = useState("Teknisi Jaringan");
  const [vendorContact, setVendorContact] = useState("");
  const [vendorRate, setVendorRate] = useState(0);
  const [spkVendor, setSpkVendor] = useState("");
  const [spkScope, setSpkScope] = useState("");
  const [spkCost, setSpkCost] = useState(0);
  const [editingSpkId, setEditingSpkId] = useState("");
  const [spkStatus, setSpkStatus] = useState<WorkOrder["status"]>("Draft");
  const [spkStartDate, setSpkStartDate] = useState("");
  const [spkEndDate, setSpkEndDate] = useState("");
  const [payingSpkId, setPayingSpkId] = useState("");
  const [serverToday, setServerToday] = useState("");
  const [paymentWorkOrder, setPaymentWorkOrder] =
    useState<WorkOrder | null>(null);
  const [paymentDate, setPaymentDate] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      api<Vendor[]>("/api/vendors"),
      projectId
        ? api<WorkOrder[]>(`/api/spks?projectId=${encodeURIComponent(projectId)}`)
        : Promise.resolve([]),
      projectId
        ? api<Project>(`/api/projects/${encodeURIComponent(projectId)}`)
        : Promise.resolve(null),
    ])
      .then(([vendorData, spkData, projectData]) => {
        if (!active) return;
        setVendors(vendorData);
        setWorkOrders(spkData);
        setProject(projectData);
        if (vendorData[0]) setSpkVendor(vendorData[0].name);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify, projectId]);

  useEffect(() => {
    let active = true;
    api<{ today: string }>("/api/system/time")
      .then((result) => {
        if (active) setServerToday(result.today);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify]);

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
  const scopedWorkOrders = workOrders;

  function openNewVendor() {
    setEditingVendorId("");
    setVendorName("");
    setVendorCategory("Teknisi Jaringan");
    setVendorContact("");
    setVendorRate(0);
    setShowVendorForm(true);
  }

  function openEditVendor(vendor: Vendor) {
    setEditingVendorId(vendor.id);
    setVendorName(vendor.name);
    setVendorCategory(vendor.category);
    setVendorContact(vendor.contact);
    setVendorRate(vendor.rate);
    setShowVendorForm(true);
  }

  function openNewSpk(vendor?: Vendor) {
    if (!projectId) {
      notify(
        id
          ? "Pilih proyek sebelum membuat SPK."
          : "Select a project before creating a Work Order.",
      );
      return;
    }
    setEditingSpkId("");
    setSpkVendor(vendor?.name ?? vendors.find((item) => item.status === "Aktif")?.name ?? "");
    setSpkScope("");
    setSpkCost(vendor?.rate ?? 0);
    setSpkStatus("Draft");
    setSpkStartDate("");
    setSpkEndDate("");
    setShowSpkForm(true);
  }

  function openEditSpk(workOrder: WorkOrder) {
    setEditingSpkId(workOrder.id);
    setSpkVendor(workOrder.vendor);
    setSpkScope(workOrder.scope);
    setSpkCost(workOrder.cost);
    setSpkStatus(workOrder.status);
    setSpkStartDate(workOrder.startDate ?? "");
    setSpkEndDate(workOrder.endDate ?? "");
    setShowSpkForm(true);
  }

  async function addVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vendorName.trim() || !vendorContact.trim()) return;
    const isEditing = Boolean(editingVendorId);
    try {
      const vendor = await api<Vendor>(isEditing ? `/api/vendors/${editingVendorId}` : "/api/vendors", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify({
          name: vendorName.trim(),
          category: vendorCategory,
          contact: vendorContact.trim(),
          rate: vendorRate,
          status: "Aktif",
        }),
      });
      setVendors((current) => isEditing ? current.map((item) => item.id === vendor.id ? vendor : item) : [vendor, ...current]);
      setSpkVendor(vendor.name);
      setVendorName("");
      setVendorContact("");
      setVendorRate(0);
      setShowVendorForm(false);
      setEditingVendorId("");
      notify(isEditing ? (id ? "Data vendor berhasil diperbarui." : "Vendor updated.") : (id ? "Vendor baru berhasil ditambahkan." : "A new vendor was added."));
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function persistSpk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) {
      notify(id ? "Pilih proyek terlebih dahulu." : "Select a project first.");
      return;
    }
    if (!spkScope.trim() || spkCost <= 0) return;
    const vendor = vendors.find((item) => item.name === spkVendor);
    if (!vendor) return;
    try {
      const workOrder = await api<WorkOrder>(
        editingSpkId ? `/api/spks/${editingSpkId}` : "/api/spks",
        {
        method: editingSpkId ? "PATCH" : "POST",
        body: JSON.stringify({
          vendorId: vendor.id,
          projectId,
          scope: spkScope.trim(),
          cost: spkCost,
          status: spkStatus,
          startDate: spkStartDate || undefined,
          endDate: spkEndDate || undefined,
        }),
      });
      setWorkOrders((current) => editingSpkId
        ? current.map((item) => item.id === workOrder.id ? workOrder : item)
        : [workOrder, ...current]);
      setSpkScope("");
      setSpkCost(0);
      setShowSpkForm(false);
      setEditingSpkId("");
      setActiveTab("spk");
      notify(editingSpkId ? (id ? "SPK dan pembukuan terkait berhasil diperbarui." : "Work Order and related finance records updated.") : (id ? "SPK berhasil dibuat sebagai draft." : "Work Order created as a draft."));
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteSpk(workOrder: WorkOrder) {
    if (!window.confirm(`${id ? "Hapus" : "Delete"} ${workOrder.number}?`)) return;
    try {
      await api(`/api/spks/${workOrder.id}`, { method: "DELETE" });
      setWorkOrders((current) => current.filter((item) => item.id !== workOrder.id));
      notify(id ? "SPK dan transaksi otomatis terkait berhasil dihapus." : "Work Order and related automatic transaction deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function updateSpkStatus(workOrderId: string, status: WorkOrder["status"]) {
    try {
      const updated = await api<WorkOrder>(`/api/spks/${workOrderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setWorkOrders((current) => current.map((workOrder) => (workOrder.id === workOrderId ? updated : workOrder)));
      notify(id ? `Status SPK diperbarui menjadi ${status}.` : `Work Order status updated to ${localizedLabel(language, status)}.`);
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  function openSpkPayment(workOrder: WorkOrder) {
    setPaymentWorkOrder(workOrder);
    setPaymentDate(
      workOrder.paidDate ??
        (workOrder.paymentStatus === "Belum Dibayar" ? serverToday : ""),
    );
  }

  async function persistSpkPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentWorkOrder || !paymentDate) return;
    setPayingSpkId(paymentWorkOrder.id);
    try {
      const updated = await api<WorkOrder>(
        `/api/spks/${paymentWorkOrder.id}/payment`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "Dibayar",
            paidDate: paymentDate,
          }),
        },
      );
      setWorkOrders((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setPaymentWorkOrder(null);
      notify(
        id
          ? "Pembayaran vendor dikonfirmasi dan arus kas diperbarui."
          : "Vendor payment confirmed and cash flow updated.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setPayingSpkId("");
    }
  }

  async function cancelSpkPayment() {
    if (!paymentWorkOrder) return;
    if (
      !window.confirm(
        id
          ? `Batalkan konfirmasi pembayaran ${paymentWorkOrder.number}? Mutasi bank yang sudah dicocokkan tetap dipertahankan untuk ditinjau.`
          : `Cancel payment confirmation for ${paymentWorkOrder.number}? Any matched bank statement remains available for review.`,
      )
    ) {
      return;
    }
    setPayingSpkId(paymentWorkOrder.id);
    try {
      const updated = await api<WorkOrder>(
        `/api/spks/${paymentWorkOrder.id}/payment`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "Belum Dibayar" }),
        },
      );
      setWorkOrders((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setPaymentWorkOrder(null);
      notify(
        id
          ? "Konfirmasi pembayaran dibatalkan dan arus kas dikoreksi."
          : "Payment confirmation cancelled and cash flow corrected.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setPayingSpkId("");
    }
  }

  async function downloadSpk(workOrder: WorkOrder) {
    try {
      await downloadApiFile(`/api/spks/${workOrder.id}/pdf`, `${workOrder.number.replaceAll("/", "-")}.pdf`);
      notify(id ? "SPK PDF berhasil dibuat." : "Work Order PDF created.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack" data-testid="procurement-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">{id ? "MITRA & PENUGASAN" : "PARTNERS & ASSIGNMENTS"}</span>
          <h1>{id ? "Procurement & Vendor" : "Procurement & Vendors"}</h1>
          <p>{id ? "Kelola mitra kerja dan Surat Perintah Kerja secara terpusat." : "Manage partners and Work Orders in one place."}</p>
        </div>
        <div className="title-actions">
          {(canManageVendors || (canManage && projectId)) && (
            <>
              {canManageVendors ? <button className="button secondary" type="button" onClick={() => { setActiveTab("vendor"); openNewVendor(); }}>
                <Plus size={16} /> {id ? "Tambah vendor" : "Add vendor"}
              </button> : null}
              {canManage && projectId ? <button className="button primary" type="button" onClick={() => { setActiveTab("spk"); openNewSpk(); }}>
                <FilePlus2 size={16} /> {id ? "Buat SPK" : "Create Work Order"}
              </button> : null}
            </>
          )}
        </div>
      </section>

      <section className="metric-grid procurement-metrics">
        <article className="metric-card">
          <span className="metric-icon teal"><Store size={20} /></span>
          <div className="metric-main"><span>{id ? "Vendor aktif" : "Active vendors"}</span><strong>{vendors.filter((vendor) => vendor.status === "Aktif").length}</strong></div>
          <span className="metric-change">{new Set(vendors.map((vendor) => vendor.category)).size} {id ? "kategori layanan" : "service categories"}</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue"><FileText size={20} /></span>
          <div className="metric-main"><span>{id ? "SPK berjalan" : "Active Work Orders"}</span><strong>{scopedWorkOrders.filter((item) => item.status === "Dikerjakan").length}</strong></div>
          <span className="metric-change">{new Set(scopedWorkOrders.map((item) => item.projectId)).size} {id ? "proyek terkait" : "related projects"}</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><UsersRound size={20} /></span>
          <div className="metric-main"><span>{id ? "SPK belum dibayar" : "Unpaid Work Orders"}</span><strong>{formatCurrency(scopedWorkOrders.filter((item) => item.paymentStatus !== "Dibayar").reduce((sum, item) => sum + item.cost, 0), language)}</strong></div>
          <span className="metric-change warning-text">{scopedWorkOrders.filter((item) => item.paymentStatus !== "Dibayar").length} {id ? "pembayaran tertunda" : "pending payments"}</span>
        </article>
      </section>

      <div className="module-tabs" role="tablist" aria-label="Procurement">
        <button role="tab" aria-selected={activeTab === "vendor"} className={activeTab === "vendor" ? "active" : ""} type="button" onClick={() => setActiveTab("vendor")}>
          <Store size={17} /> {id ? "Daftar vendor" : "Vendors"} <span className="tab-count">{vendors.length}</span>
        </button>
        {projectId ? <button role="tab" aria-selected={activeTab === "spk"} className={activeTab === "spk" ? "active" : ""} type="button" onClick={() => setActiveTab("spk")}>
          <FileText size={17} /> {id ? "Daftar SPK" : "Work Orders"} <span className="tab-count">{scopedWorkOrders.length}</span>
        </button> : null}
      </div>

      {activeTab === "vendor" && (
        <section className="panel">
          <div className="panel-head vendor-list-head">
            <div>
              <span className="eyebrow">{id ? "DIREKTORI MITRA" : "PARTNER DIRECTORY"}</span>
              <h2>{id ? "Vendor & supplier" : "Vendors & suppliers"}</h2>
            </div>
            <div className="project-tools">
              <label className="search-field compact">
                <Search size={16} />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari vendor..." : "Search vendors..."} />
              </label>
              <label className="select-compact">
                <Filter size={15} />
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((item) => <option key={item} value={item}>{item === "Semua kategori" && !id ? "All categories" : item}</option>)}
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
                  <span className={`status-badge ${vendor.status === "Aktif" ? "success" : "neutral"}`}>{localizedLabel(language, vendor.status)}</span>
                  {canManageVendors && <button className="icon-button" type="button" aria-label={`Edit ${vendor.name}`} onClick={() => openEditVendor(vendor)}><MoreHorizontal size={17} /></button>}
                </div>
                <div className="vendor-card-copy">
                  <strong>{vendor.name}</strong>
                  <span>{vendor.category}</span>
                </div>
                <div className="vendor-contact-list">
                  <span><Phone size={14} /> {vendor.contact}</span>
                  <span><Mail size={14} /> {vendor.email || (id ? "Email belum diisi" : "Email not provided")}</span>
                  <span><MapPin size={14} /> {vendor.address || (id ? "Alamat belum diisi" : "Address not provided")}</span>
                </div>
                <div className="vendor-rate">
                  <span>{id ? "Tarif standar" : "Standard rate"}</span>
                  <strong>{vendor.rate ? `${formatCurrency(vendor.rate, language)} / ${id ? "hari" : "day"}` : (id ? "Sesuai quotation" : "As quoted")}</strong>
                </div>
                {canManage && projectId && <button className="button subtle full-width" type="button" onClick={() => openNewSpk(vendor)}>
                  <FilePlus2 size={15} /> {id ? "Buat SPK untuk vendor" : "Create Work Order for vendor"}
                </button>}
              </article>
            ))}
          </div>
          {!filteredVendors.length && (
            <div className="empty-state"><Search size={28} /><h3>{id ? "Vendor tidak ditemukan" : "No vendors found"}</h3><p>{id ? "Coba kata kunci atau kategori lain." : "Try another keyword or category."}</p></div>
          )}
        </section>
      )}

      {activeTab === "spk" && (
        <section className="panel">
          <div className="panel-head">
            <div><span className="eyebrow">{id ? "SURAT PERINTAH KERJA" : "WORK ORDERS"}</span><h2>{id ? "Daftar SPK" : "Work Orders"}</h2></div>
            {canManage && <button className="button primary small" type="button" onClick={() => openNewSpk()}><Plus size={15} /> {id ? "SPK baru" : "New Work Order"}</button>}
          </div>
          <div className="spk-list">
            {scopedWorkOrders.map((workOrder) => (
              <article className="spk-row" key={workOrder.id}>
                <span className="spk-document-icon"><FileText size={20} /></span>
                <div className="spk-primary">
                  <strong>{workOrder.number}</strong>
                  <span>{workOrder.vendor}</span>
                </div>
                <div className="spk-project">
                  <span>{id ? "Proyek" : "Project"}</span>
                  <strong>{workOrder.project}</strong>
                </div>
                <div className="spk-scope">
                  <span>{id ? "Lingkup kerja" : "Scope of work"}</span>
                  <strong>{workOrder.scope}</strong>
                </div>
                <div className="spk-cost">
                  <span>{id ? "Nilai" : "Value"}</span>
                  <strong>{formatCurrency(workOrder.cost, language)}</strong>
                  <small className={`spk-payment-status ${workOrder.paymentStatus === "Dibayar" ? "paid" : "unpaid"}`}>
                    {workOrder.paymentStatus === "Dibayar"
                      ? id ? "Sudah dibayar" : "Paid"
                      : id ? "Belum dibayar" : "Unpaid"}
                  </small>
                </div>
                <label className={`status-select ${spkStatusClass(workOrder.status)}`}>
                  <select disabled={!canManage} value={workOrder.status} onChange={(event) => updateSpkStatus(workOrder.id, event.target.value as WorkOrder["status"])}>
                    {spkStatuses.map((status) => <option key={status} value={status}>{localizedLabel(language, status)}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </label>
                {canManagePayments && (
                  <button
                    className={`button small ${workOrder.paymentStatus === "Dibayar" ? "subtle" : "secondary"}`}
                    type="button"
                    disabled={payingSpkId === workOrder.id}
                    onClick={() => openSpkPayment(workOrder)}
                  >
                    <CircleDollarSign size={15} />
                    {payingSpkId === workOrder.id
                      ? id ? "Memproses..." : "Processing..."
                      : workOrder.paymentStatus === "Dibayar"
                        ? id ? "Koreksi bayar" : "Correct payment"
                        : id ? "Konfirmasi bayar" : "Confirm payment"}
                  </button>
                )}
                <button className="button subtle small" type="button" onClick={() => downloadSpk(workOrder)}><Download size={15} /> PDF</button>
                {canManage && (workOrder.paymentStatus !== "Dibayar" || canManagePayments) && <button className="icon-button" type="button" aria-label={`Edit ${workOrder.number}`} onClick={() => openEditSpk(workOrder)}><Pencil size={15} /></button>}
                {canManage && (workOrder.paymentStatus !== "Dibayar" || canManagePayments) && <button className="icon-button danger" type="button" aria-label={`Hapus ${workOrder.number}`} onClick={() => deleteSpk(workOrder)}><Trash2 size={15} /></button>}
              </article>
            ))}
          </div>
        </section>
      )}

      {paymentWorkOrder ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPaymentWorkOrder(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="spk-payment-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "PEMBAYARAN VENDOR" : "VENDOR PAYMENT"}</span><h2 id="spk-payment-title">{paymentWorkOrder.number}</h2></div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setPaymentWorkOrder(null)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={persistSpkPayment}>
              <label className="field full"><span>{id ? "Tanggal dana keluar" : "Payment date"}</span><input type="date" required max={serverToday || undefined} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
              <div className="statement-guidance full"><CircleDollarSign size={18} /><span><strong>{id ? "Gunakan tanggal mutasi rekening" : "Use the bank statement date"}</strong><small>{id ? "Tanggal ini menentukan periode arus kas dan kandidat rekonsiliasi bank." : "This date determines the cash-flow period and bank reconciliation candidates."}</small></span></div>
              <div className="modal-actions full">
                {paymentWorkOrder.paymentStatus === "Dibayar" ? <button className="button danger" type="button" disabled={Boolean(payingSpkId)} onClick={cancelSpkPayment}>{id ? "Batalkan pembayaran" : "Cancel payment"}</button> : null}
                <button className="button secondary" type="button" onClick={() => setPaymentWorkOrder(null)}>{id ? "Tutup" : "Close"}</button>
                <button className="button primary" type="submit" disabled={Boolean(payingSpkId) || !paymentDate}><CircleDollarSign size={15} /> {payingSpkId ? (id ? "Menyimpan..." : "Saving...") : paymentWorkOrder.paymentStatus === "Dibayar" ? (id ? "Simpan koreksi" : "Save correction") : (id ? "Konfirmasi pembayaran" : "Confirm payment")}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showVendorForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowVendorForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="vendor-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{editingVendorId ? "EDIT VENDOR" : (id ? "VENDOR BARU" : "NEW VENDOR")}</span><h2 id="vendor-form-title">{editingVendorId ? (id ? "Perbarui mitra kerja" : "Update partner") : (id ? "Tambah mitra kerja" : "Add partner")}</h2></div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowVendorForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={addVendor}>
              <label className="field full"><span>{id ? "Nama vendor" : "Vendor name"}</span><input required value={vendorName} onChange={(event) => setVendorName(event.target.value)} placeholder={id ? "Nama badan usaha / teknisi" : "Business / technician name"} /></label>
              <label className="field full"><span>{id ? "Kategori" : "Category"}</span><select value={vendorCategory} onChange={(event) => setVendorCategory(event.target.value)}><option value="Teknisi Jaringan">{id ? "Teknisi Jaringan" : "Network Technician"}</option><option>Splicing Fiber Optic</option><option value="Instalasi CCTV">{id ? "Instalasi CCTV" : "CCTV Installation"}</option><option value="Supplier Perangkat">{id ? "Supplier Perangkat" : "Device Supplier"}</option></select></label>
              <label className="field"><span>{id ? "Kontak" : "Contact"}</span><input required value={vendorContact} onChange={(event) => setVendorContact(event.target.value)} placeholder="08xx xxxx xxxx" /></label>
              <label className="field"><span>{id ? "Tarif standar / hari" : "Standard rate / day"}</span><input type="number" min="0" value={vendorRate || ""} onChange={(event) => setVendorRate(Number(event.target.value))} placeholder="0" /></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowVendorForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><Plus size={16} /> {editingVendorId ? (id ? "Simpan perubahan" : "Save changes") : (id ? "Simpan vendor" : "Save vendor")}</button></div>
            </form>
          </section>
        </div>
      )}

      {showSpkForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowSpkForm(false)}>
          <section className="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="spk-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{editingSpkId ? "EDIT SPK" : (id ? "SPK BARU" : "NEW WORK ORDER")}</span><h2 id="spk-form-title">{id ? "Surat Perintah Kerja" : "Work Order"}</h2></div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowSpkForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={persistSpk}>
              <label className="field full"><span>{id ? "Vendor / pelaksana" : "Vendor / contractor"}</span><select value={spkVendor} onChange={(event) => setSpkVendor(event.target.value)}>{vendors.filter((vendor) => vendor.status === "Aktif").map((vendor) => <option key={vendor.id}>{vendor.name}</option>)}</select></label>
              <label className="field full"><span>{id ? "Proyek terkait" : "Related project"}</span><input value={project ? `${project.code} · ${project.name}` : projectId} readOnly /></label>
              <label className="field full"><span>{id ? "Lingkup pekerjaan" : "Scope of work"}</span><textarea required value={spkScope} onChange={(event) => setSpkScope(event.target.value)} placeholder={id ? "Jelaskan pekerjaan, output, dan batasan tanggung jawab..." : "Describe the work, deliverables, and responsibility limits..."} rows={4} /></label>
              <label className="field full"><span>{id ? "Biaya disepakati" : "Agreed cost"}</span><input type="number" min="1" required value={spkCost || ""} onChange={(event) => setSpkCost(Number(event.target.value))} placeholder="0" /></label>
              <label className="field"><span>{id ? "Tanggal mulai" : "Start date"}</span><input type="date" value={spkStartDate} onChange={(event) => setSpkStartDate(event.target.value)} /></label>
              <label className="field"><span>{id ? "Tanggal selesai" : "End date"}</span><input type="date" value={spkEndDate} onChange={(event) => setSpkEndDate(event.target.value)} /></label>
              <label className="field full"><span>Status</span><select value={spkStatus} onChange={(event) => setSpkStatus(event.target.value as WorkOrder["status"])}>{spkStatuses.map((status) => <option key={status} value={status}>{localizedLabel(language, status)}</option>)}</select></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowSpkForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><FilePlus2 size={16} /> {editingSpkId ? (id ? "Simpan perubahan" : "Save changes") : (id ? "Simpan SPK" : "Save Work Order")}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
