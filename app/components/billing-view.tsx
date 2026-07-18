"use client";

import {
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Mail,
  Pencil,
  Plus,
  ReceiptText,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import { BoqItem, formatCurrency, Invoice, Project } from "../data";
import { appPath } from "../paths";

interface BillingViewProps {
  notify: (message: string) => void;
  projectId: string;
  canManage: boolean;
}

type BillingTab = "quotation" | "invoice";

interface Quotation {
  id: string | null;
  number: string | null;
  status: "Draft" | "Sent";
  issuedAt: string;
  validUntil: string | null;
  total: number;
}

function displayDate(value?: string | null) {
  if (!value) return "Belum ditentukan";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function BillingView({
  notify,
  projectId,
  canManage,
}: BillingViewProps) {
  const [activeTab, setActiveTab] = useState<BillingTab>("quotation");
  const [project, setProject] = useState<Project | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotationItems, setQuotationItems] = useState<BoqItem[]>([]);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState("");
  const [invoiceType, setInvoiceType] = useState("DP 50%");
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [showQuotationForm, setShowQuotationForm] = useState(false);
  const [quotationIssuedAt, setQuotationIssuedAt] = useState("");
  const [quotationValidUntil, setQuotationValidUntil] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      api<Invoice[]>(`/api/invoices?projectId=${encodeURIComponent(projectId)}`),
      api<{ items: BoqItem[] }>(`/api/boq?projectId=${encodeURIComponent(projectId)}`),
      api<Quotation>(`/api/quotations?projectId=${encodeURIComponent(projectId)}`),
      api<Project>(`/api/projects/${encodeURIComponent(projectId)}`),
    ])
      .then(([invoiceData, boq, quotationData, projectData]) => {
        if (!active) return;
        setInvoices(invoiceData);
        setQuotationItems(boq.items);
        setQuotation(quotationData);
        setProject(projectData);
        setQuotationIssuedAt(quotationData.issuedAt);
        setQuotationValidUntil(quotationData.validUntil ?? "");
      })
      .catch((error) => notify(messageOf(error)));
    return () => {
      active = false;
    };
  }, [notify, projectId]);

  const boqTotal = useMemo(
    () =>
      quotationItems.reduce(
        (sum, item) => sum + item.quantity * item.sellingPrice,
        0,
      ),
    [quotationItems],
  );
  const quotationTotal = quotation?.total ?? boqTotal;
  const paidTotal = invoices
    .filter((invoice) => invoice.status === "Lunas")
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const outstanding = invoices
    .filter((invoice) => invoice.status === "Belum Lunas")
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const invoicedTotal = paidTotal + outstanding;

  async function updateQuotation(
    input: Partial<Pick<Quotation, "status" | "issuedAt" | "validUntil">>,
  ) {
    const updated = await api<Quotation>(
      `/api/quotations?projectId=${encodeURIComponent(projectId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    setQuotation(updated);
    setQuotationIssuedAt(updated.issuedAt);
    setQuotationValidUntil(updated.validUntil ?? "");
    return updated;
  }

  async function downloadQuotation() {
    try {
      if (!quotation?.id && canManage) {
        await updateQuotation({ status: "Draft" });
      }
      await downloadApiFile(
        `/api/projects/${projectId}/quotation.pdf`,
        `${quotation?.number?.replaceAll("/", "-") ?? "Quotation-PerumNet"}.pdf`,
      );
      notify("Quotation PDF berhasil dibuat dari BoQ proyek aktif.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function saveQuotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await updateQuotation({
        status: quotation?.status ?? "Draft",
        issuedAt: quotationIssuedAt,
        validUntil: quotationValidUntil,
      });
      setShowQuotationForm(false);
      notify("Quotation berhasil diperbarui.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function markQuotationSent() {
    try {
      await updateQuotation({ status: "Sent" });
      notify("Quotation ditandai sebagai terkirim.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function downloadInvoice(invoice: Invoice) {
    try {
      await downloadApiFile(
        `/api/invoices/${invoice.id}/pdf`,
        `${invoice.number.replaceAll("/", "-")}.pdf`,
      );
      notify("Invoice PDF berhasil dibuat.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function confirmPayment(id: string) {
    try {
      const updated = await api<Invoice>(`/api/invoices/${id}/payment`, {
        method: "POST",
        body: JSON.stringify({ paidDate: new Date().toISOString().slice(0, 10) }),
      });
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === id ? updated : invoice)),
      );
      notify("Pembayaran dan transaksi pembukuan telah disinkronkan.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  function openNewInvoice() {
    const today = new Date().toISOString().slice(0, 10);
    const remaining = Math.max(0, quotationTotal - invoicedTotal);
    setEditingInvoiceId("");
    setInvoiceType(invoices.length ? "Pelunasan" : "DP 50%");
    setInvoiceAmount(invoices.length ? remaining : Math.round(remaining / 2));
    setIssueDate(today);
    setDueDate(
      new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    );
    setShowInvoiceForm(true);
  }

  function openEditInvoice(invoice: Invoice) {
    setEditingInvoiceId(invoice.id);
    setInvoiceType(invoice.type);
    setInvoiceAmount(invoice.amount);
    setIssueDate(invoice.issueDateIso ?? new Date().toISOString().slice(0, 10));
    setDueDate(invoice.dueDateIso ?? "");
    setShowInvoiceForm(true);
  }

  async function persistInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invoiceAmount <= 0) return;
    try {
      const invoice = await api<Invoice>(
        editingInvoiceId ? `/api/invoices/${editingInvoiceId}` : "/api/invoices",
        {
          method: editingInvoiceId ? "PATCH" : "POST",
          body: JSON.stringify({
            ...(editingInvoiceId ? {} : { projectId }),
            type: invoiceType,
            issueDate,
            dueDate,
            amount: invoiceAmount,
          }),
        },
      );
      setInvoices((current) =>
        editingInvoiceId
          ? current.map((item) => (item.id === invoice.id ? invoice : item))
          : [invoice, ...current],
      );
      setShowInvoiceForm(false);
      notify(
        editingInvoiceId
          ? "Invoice dan transaksi terkait berhasil diperbarui."
          : "Invoice baru berhasil diterbitkan.",
      );
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function deleteInvoice(invoice: Invoice) {
    if (!window.confirm(`Hapus ${invoice.number}?`)) return;
    try {
      await api(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      setInvoices((current) => current.filter((item) => item.id !== invoice.id));
      notify("Invoice dan transaksi otomatis terkait berhasil dihapus.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function shareDocument() {
    const url = `${window.location.origin}${appPath("/")}?module=billing&project=${encodeURIComponent(projectId)}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "PerumNet Enterprise — Quotation",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
      notify("Tautan workspace dokumen berhasil dibagikan.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(messageOf(error));
    }
  }

  return (
    <div className="page-stack" data-testid="billing-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">DOKUMEN KOMERSIAL</span>
          <h1>Quotation & Invoice</h1>
          <p>
            {project
              ? `${project.code} · ${project.name}`
              : "Memuat konteks proyek..."}
          </p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={shareDocument}>
            <Send size={16} /> Bagikan
          </button>
          {canManage && (
            <button className="button primary" type="button" onClick={openNewInvoice}>
              <Plus size={16} /> Buat invoice
            </button>
          )}
        </div>
      </section>

      <div className="module-tabs" role="tablist" aria-label="Dokumen penagihan">
        <button role="tab" aria-selected={activeTab === "quotation"} className={activeTab === "quotation" ? "active" : ""} type="button" onClick={() => setActiveTab("quotation")}>
          <FileText size={17} /> Quotation
        </button>
        <button role="tab" aria-selected={activeTab === "invoice"} className={activeTab === "invoice" ? "active" : ""} type="button" onClick={() => setActiveTab("invoice")}>
          <ReceiptText size={17} /> Invoice <span className="tab-count">{invoices.length}</span>
        </button>
      </div>

      {activeTab === "quotation" && (
        <section className="billing-layout">
          <div className="document-canvas">
            <div className="document-toolbar">
              <div>
                <span className={`status-badge ${quotation?.status === "Sent" ? "success" : "info"}`}>
                  {quotation?.status === "Sent" ? <CircleCheck size={14} /> : <Clock3 size={14} />}
                  {quotation?.status === "Sent" ? "Sudah dikirim" : "Draft"}
                </span>
                <span>{quotation?.number ?? "Nomor dibuat saat Quotation disimpan"}</span>
              </div>
              <div className="title-actions">
                {canManage && (
                  <button className="button secondary small" type="button" onClick={() => setShowQuotationForm(true)}>
                    <Pencil size={15} /> Edit
                  </button>
                )}
                <button className="button primary small" type="button" disabled={!quotationItems.length} onClick={downloadQuotation}>
                  <Download size={15} /> Unduh PDF
                </button>
              </div>
            </div>
            <article className="document-preview">
              <header className="document-letterhead">
                <img src={appPath("/perumnet-enterprise-logo.png")} alt="PerumNet Enterprise" width={126} height={132} />
                <div>
                  <strong>PERUMNET ENTERPRISE</strong>
                  <span>Konsultan IT & Managed Services</span>
                  <small>Gianyar, Bali · it@perumnet.id · perumnet.id</small>
                </div>
              </header>
              <div className="document-title">
                <div><span>QUOTATION</span><h2>{project?.name ?? "Proyek"}</h2></div>
                <div>
                  <small>Nomor</small><strong>{quotation?.number ?? "DRAFT"}</strong>
                  <small>Tanggal</small><strong>{displayDate(quotation?.issuedAt)}</strong>
                </div>
              </div>
              <div className="document-recipient">
                <span>Ditujukan kepada</span>
                <strong>{project?.client ?? "Klien"}</strong>
                <small>{project?.location ?? "Lokasi belum ditentukan"}</small>
              </div>
              <table className="document-table">
                <thead><tr><th>No</th><th>Deskripsi</th><th>Qty</th><th>Harga satuan</th><th>Total</th></tr></thead>
                <tbody>
                  {quotationItems.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td><strong>{item.description}</strong><small>{item.category}</small></td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>{formatCurrency(item.sellingPrice)}</td>
                      <td>{formatCurrency(item.quantity * item.sellingPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!quotationItems.length && (
                <div className="empty-state compact">
                  <FileText size={24} />
                  <p>BoQ proyek ini masih kosong. Tambahkan item sebelum membuat Quotation.</p>
                </div>
              )}
              <div className="document-total"><span>Total penawaran</span><strong>{formatCurrency(quotationTotal)}</strong></div>
              <div className="document-notes">
                <strong>Ketentuan penawaran</strong>
                <p>Berlaku sampai {displayDate(quotation?.validUntil)}. Nilai akan kembali menjadi Draft bila BoQ diubah.</p>
              </div>
            </article>
          </div>

          <aside className="billing-side">
            <section className="panel">
              <div className="panel-head"><div><span className="eyebrow">RINGKASAN</span><h2>Status quotation</h2></div></div>
              <div className="document-status-list">
                <div className={quotationItems.length ? "done" : "active"}><span><Check size={14} /></span><div><strong>BoQ</strong><small>{quotationItems.length} item · {formatCurrency(boqTotal)}</small></div></div>
                <div className={quotation?.id ? "done" : "active"}><span><FileCheck2 size={14} /></span><div><strong>Quotation</strong><small>{quotation?.number ?? "Belum disimpan"}</small></div></div>
                <div className={quotation?.status === "Sent" ? "done" : "active"}><span><Mail size={14} /></span><div><strong>{quotation?.status === "Sent" ? "Sudah dikirim" : "Menunggu dikirim"}</strong><small>{quotation?.status === "Sent" ? "Nilai terkunci sampai BoQ berubah" : "Periksa tanggal dan isi dokumen"}</small></div></div>
              </div>
              {canManage && (
                <button className="button primary full-width" type="button" disabled={!quotationItems.length || quotation?.status === "Sent"} onClick={markQuotationSent}>
                  <Send size={16} /> {quotation?.status === "Sent" ? "Sudah dikirim" : "Tandai sudah dikirim"}
                </button>
              )}
            </section>
          </aside>
        </section>
      )}

      {activeTab === "invoice" && (
        <div className="page-stack">
          <section className="metric-grid invoice-metrics">
            <article className="metric-card"><span className="metric-icon green"><CircleCheck size={20} /></span><div className="metric-main"><span>Sudah diterima</span><strong>{formatCurrency(paidTotal)}</strong></div><span className="metric-change positive">{quotationTotal ? Math.round((paidTotal / quotationTotal) * 100) : 0}% proyek</span></article>
            <article className="metric-card"><span className="metric-icon orange"><Clock3 size={20} /></span><div className="metric-main"><span>Belum dibayar</span><strong>{formatCurrency(outstanding)}</strong></div><span className="metric-change warning-text">{invoices.filter((invoice) => invoice.status === "Belum Lunas").length} invoice aktif</span></article>
            <article className="metric-card"><span className="metric-icon blue"><FileCheck2 size={20} /></span><div className="metric-main"><span>Sisa dapat ditagihkan</span><strong>{formatCurrency(Math.max(0, quotationTotal - invoicedTotal))}</strong></div><span className="metric-change">Dari {formatCurrency(quotationTotal)}</span></article>
          </section>
          <section className="panel">
            <div className="panel-head">
              <div><span className="eyebrow">TAGIHAN PROYEK</span><h2>Daftar invoice</h2></div>
              {canManage && <button className="button primary small" type="button" disabled={!quotationTotal || invoicedTotal >= quotationTotal} onClick={openNewInvoice}><Plus size={15} /> Invoice baru</button>}
            </div>
            <div className="invoice-list">
              {invoices.map((invoice) => (
                <article className="invoice-row" key={invoice.id}>
                  <span className={`invoice-status-icon ${invoice.status === "Lunas" ? "paid" : "unpaid"}`}>{invoice.status === "Lunas" ? <Check size={18} /> : <Clock3 size={18} />}</span>
                  <div className="invoice-primary"><strong>{invoice.number}</strong><span>{invoice.type} · Terbit {invoice.issueDate}</span></div>
                  <div className="invoice-amount"><span>Nilai tagihan</span><strong>{formatCurrency(invoice.amount)}</strong></div>
                  <div className="invoice-due"><span>{invoice.status === "Lunas" ? "Dibayar" : "Jatuh tempo"}</span><strong>{invoice.status === "Lunas" ? invoice.paidDate : invoice.dueDate}</strong></div>
                  <span className={`status-badge ${invoice.status === "Lunas" ? "success" : "warning"}`}>{invoice.status}</span>
                  <div className="invoice-actions">
                    <button className="button subtle small" type="button" onClick={() => downloadInvoice(invoice)}><Download size={15} /> PDF</button>
                    {canManage && <button className="icon-button" type="button" aria-label={`Edit ${invoice.number}`} onClick={() => openEditInvoice(invoice)}><Pencil size={15} /></button>}
                    {canManage && invoice.status === "Belum Lunas" && <button className="button primary small" type="button" onClick={() => confirmPayment(invoice.id)}><Check size={15} /> Konfirmasi</button>}
                    {canManage && <button className="icon-button danger" type="button" aria-label={`Hapus ${invoice.number}`} onClick={() => deleteInvoice(invoice)}><Trash2 size={15} /></button>}
                  </div>
                </article>
              ))}
              {!invoices.length && <div className="empty-state"><ReceiptText size={28} /><h3>Belum ada invoice</h3><p>Buat Invoice dari nilai Quotation proyek ini.</p></div>}
            </div>
          </section>
        </div>
      )}

      {showInvoiceForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowInvoiceForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="invoice-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">{editingInvoiceId ? "EDIT INVOICE" : "INVOICE BARU"}</span><h2 id="invoice-form-title">{editingInvoiceId ? "Perbarui tagihan proyek" : "Terbitkan tagihan proyek"}</h2></div><button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowInvoiceForm(false)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={persistInvoice}>
              <label className="field full select-field"><span>Jenis tagihan</span><select value={invoiceType} onChange={(event) => setInvoiceType(event.target.value)}><option>DP 30%</option><option>DP 50%</option><option>Termin 2</option><option>Pelunasan</option></select><ChevronDown size={15} /></label>
              <label className="field"><span>Tanggal terbit</span><input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
              <label className="field"><span>Jatuh tempo</span><input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
              <label className="field full"><span>Nominal tagihan</span><input type="number" min="1" required value={invoiceAmount || ""} onChange={(event) => setInvoiceAmount(Number(event.target.value))} /></label>
              <div className="invoice-form-summary full"><span>Nilai Invoice</span><strong>{formatCurrency(invoiceAmount)}</strong><small>Sisa setelah disimpan: {formatCurrency(Math.max(0, quotationTotal - (invoicedTotal - (invoices.find((item) => item.id === editingInvoiceId)?.amount ?? 0)) - invoiceAmount))}</small></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowInvoiceForm(false)}>Batal</button><button className="button primary" type="submit"><FileCheck2 size={16} /> {editingInvoiceId ? "Simpan perubahan" : "Terbitkan invoice"}</button></div>
            </form>
          </section>
        </div>
      )}

      {showQuotationForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowQuotationForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="quotation-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">EDIT QUOTATION</span><h2 id="quotation-form-title">Tanggal dan masa berlaku</h2></div><button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowQuotationForm(false)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={saveQuotation}>
              <label className="field full"><span>Tanggal terbit</span><input required type="date" value={quotationIssuedAt} onChange={(event) => setQuotationIssuedAt(event.target.value)} /></label>
              <label className="field full"><span>Berlaku sampai</span><input required type="date" value={quotationValidUntil} onChange={(event) => setQuotationValidUntil(event.target.value)} /></label>
              <div className="invoice-form-summary full"><span>Nilai otomatis dari BoQ</span><strong>{formatCurrency(boqTotal)}</strong></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowQuotationForm(false)}>Batal</button><button className="button primary" type="submit"><Pencil size={16} /> Simpan Quotation</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
