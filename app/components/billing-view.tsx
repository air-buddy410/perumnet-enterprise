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
  Plus,
  ReceiptText,
  Send,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import { formatCurrency, initialBoqItems, initialInvoices, Invoice } from "../data";

interface BillingViewProps {
  notify: (message: string) => void;
}

type BillingTab = "quotation" | "invoice";

export function BillingView({ notify }: BillingViewProps) {
  const [activeTab, setActiveTab] = useState<BillingTab>("quotation");
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [quotationItems, setQuotationItems] = useState(initialBoqItems);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceType, setInvoiceType] = useState("Termin 2");
  const [invoiceAmount, setInvoiceAmount] = useState(46_862_500);
  const [dueDate, setDueDate] = useState("2026-08-02");

  useEffect(() => {
    let active = true;
    Promise.all([
      api<Invoice[]>("/api/invoices?projectId=project-1"),
      api<{ items: typeof initialBoqItems }>("/api/boq?projectId=project-1"),
    ])
      .then(([invoiceData, boq]) => {
        if (active) {
          setInvoices(invoiceData);
          setQuotationItems(boq.items);
        }
      })
      .catch((error) => notify(messageOf(error)));
    return () => {
      active = false;
    };
  }, [notify]);

  const quotationTotal = useMemo(
    () =>
      quotationItems.reduce(
        (sum, item) => sum + item.quantity * item.sellingPrice,
        0,
      ),
    [quotationItems],
  );
  const paidTotal = invoices
    .filter((invoice) => invoice.status === "Lunas")
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const outstanding = invoices
    .filter((invoice) => invoice.status === "Belum Lunas")
    .reduce((sum, invoice) => sum + invoice.amount, 0);

  async function downloadQuotation() {
    try {
      await downloadApiFile("/api/projects/project-1/quotation.pdf", "Quotation-PerumNet.pdf");
      notify("Quotation PDF berhasil dibuat.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function downloadInvoice(invoice: Invoice) {
    try {
      await downloadApiFile(`/api/invoices/${invoice.id}/pdf`, `${invoice.number.replaceAll("/", "-")}.pdf`);
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
      setInvoices((current) => current.map((invoice) => (invoice.id === id ? updated : invoice)));
      notify("Pembayaran dikonfirmasi dan ringkasan proyek diperbarui.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invoiceAmount <= 0) return;
    try {
      const invoice = await api<Invoice>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          type: invoiceType,
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate,
          amount: invoiceAmount,
        }),
      });
      setInvoices((current) => [invoice, ...current]);
      setShowInvoiceForm(false);
      notify("Invoice baru berhasil diterbitkan.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  return (
    <div className="page-stack" data-testid="billing-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">DOKUMEN KOMERSIAL</span>
          <h1>Quotation & Invoice</h1>
          <p>Buat penawaran resmi dan pantau pembayaran proyek dalam satu alur.</p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={() => notify("Tautan dokumen disalin untuk dikirim ke klien.")}>
            <Send size={16} /> Bagikan
          </button>
          <button className="button primary" type="button" onClick={() => { setActiveTab("invoice"); setShowInvoiceForm(true); }}>
            <Plus size={16} /> Buat invoice
          </button>
        </div>
      </section>

      <div className="module-tabs" role="tablist" aria-label="Dokumen penagihan">
        <button
          role="tab"
          aria-selected={activeTab === "quotation"}
          className={activeTab === "quotation" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("quotation")}
        >
          <FileText size={17} /> Quotation
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "invoice"}
          className={activeTab === "invoice" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("invoice")}
        >
          <ReceiptText size={17} /> Invoice
          <span className="tab-count">{invoices.length}</span>
        </button>
      </div>

      {activeTab === "quotation" && (
        <section className="billing-layout">
          <div className="document-canvas">
            <div className="document-toolbar">
              <div>
                <span className="status-badge success"><CircleCheck size={14} /> Siap dikirim</span>
                <span>Terakhir diperbarui 18 Jul 2026, 16:10</span>
              </div>
              <button className="button primary small" type="button" onClick={downloadQuotation}>
                <Download size={15} /> Unduh PDF
              </button>
            </div>
            <article className="document-preview">
              <header className="document-letterhead">
                <img
                  src="/perumnet-enterprise-logo.png"
                  alt="PerumNet Enterprise"
                  width={126}
                  height={132}
                />
                <div>
                  <strong>PERUMNET ENTERPRISE</strong>
                  <span>Konsultan IT & Managed Services</span>
                  <small>Gianyar, Bali · hello@perumnet.id · perumnet.id</small>
                </div>
              </header>
              <div className="document-title">
                <div>
                  <span>QUOTATION</span>
                  <h2>Penawaran Solusi WiFi Resort</h2>
                </div>
                <div>
                  <small>Nomor</small>
                  <strong>QUO/PN/VII/2026/027</strong>
                  <small>Tanggal</small>
                  <strong>18 Juli 2026</strong>
                </div>
              </div>
              <div className="document-recipient">
                <span>Ditujukan kepada</span>
                <strong>Bali Serenity Resort</strong>
                <small>Jl. Raya Sanggingan, Ubud, Gianyar</small>
              </div>
              <table className="document-table">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Deskripsi</th>
                    <th>Qty</th>
                    <th>Harga satuan</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotationItems.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td>
                        <strong>{item.description}</strong>
                        <small>{item.category}</small>
                      </td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>{formatCurrency(item.sellingPrice)}</td>
                      <td>{formatCurrency(item.quantity * item.sellingPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="document-total">
                <span>Total penawaran</span>
                <strong>{formatCurrency(quotationTotal)}</strong>
              </div>
              <div className="document-notes">
                <strong>Ketentuan penawaran</strong>
                <p>Harga termasuk instalasi, konfigurasi, testing, dan dokumentasi. Masa berlaku penawaran 14 hari sejak tanggal diterbitkan.</p>
              </div>
              <footer className="document-signature">
                <div>
                  <span>Hormat kami,</span>
                  <strong>Dewa Mahardika</strong>
                  <small>Managing Director</small>
                </div>
                <div className="document-stamp">PN</div>
              </footer>
            </article>
          </div>

          <aside className="billing-side">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">RINGKASAN</span>
                  <h2>Status quotation</h2>
                </div>
              </div>
              <div className="document-status-list">
                <div className="done">
                  <span><Check size={14} /></span>
                  <div><strong>BoQ selesai</strong><small>18 item terverifikasi</small></div>
                </div>
                <div className="done">
                  <span><Check size={14} /></span>
                  <div><strong>Quotation dibuat</strong><small>QUO/PN/VII/2026/027</small></div>
                </div>
                <div className="active">
                  <span><Mail size={14} /></span>
                  <div><strong>Menunggu persetujuan</strong><small>Belum dikirim ke klien</small></div>
                </div>
              </div>
              <button className="button primary full-width" type="button" onClick={() => notify("Quotation ditandai sebagai terkirim ke klien.")}>
                <Send size={16} /> Tandai sudah dikirim
              </button>
            </section>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">VERSI</span>
                  <h2>Riwayat dokumen</h2>
                </div>
              </div>
              <div className="history-item">
                <span className="history-dot active" />
                <div><strong>Versi 3 · saat ini</strong><small>18 Jul 2026 · 16:10</small></div>
              </div>
              <div className="history-item">
                <span className="history-dot" />
                <div><strong>Versi 2</strong><small>18 Jul 2026 · 11:42</small></div>
              </div>
              <div className="history-item">
                <span className="history-dot" />
                <div><strong>Versi 1</strong><small>17 Jul 2026 · 14:05</small></div>
              </div>
            </section>
          </aside>
        </section>
      )}

      {activeTab === "invoice" && (
        <div className="page-stack">
          <section className="metric-grid invoice-metrics">
            <article className="metric-card">
              <span className="metric-icon green"><CircleCheck size={20} /></span>
              <div className="metric-main">
                <span>Sudah diterima</span>
                <strong>{formatCurrency(paidTotal)}</strong>
              </div>
              <span className="metric-change positive">{quotationTotal ? Math.round((paidTotal / quotationTotal) * 100) : 0}% proyek</span>
            </article>
            <article className="metric-card">
              <span className="metric-icon orange"><Clock3 size={20} /></span>
              <div className="metric-main">
                <span>Belum dibayar</span>
                <strong>{formatCurrency(outstanding)}</strong>
              </div>
              <span className="metric-change warning-text">{invoices.filter((invoice) => invoice.status === "Belum Lunas").length} invoice aktif</span>
            </article>
            <article className="metric-card">
              <span className="metric-icon blue"><FileCheck2 size={20} /></span>
              <div className="metric-main">
                <span>Total tagihan</span>
                <strong>{formatCurrency(paidTotal + outstanding)}</strong>
              </div>
              <span className="metric-change">{invoices.length} dokumen</span>
            </article>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">TAGIHAN PROYEK</span>
                <h2>Daftar invoice</h2>
              </div>
              <button className="button primary small" type="button" onClick={() => setShowInvoiceForm(true)}>
                <Plus size={15} /> Invoice baru
              </button>
            </div>
            <div className="invoice-list">
              {invoices.map((invoice) => (
                <article className="invoice-row" key={invoice.id}>
                  <span className={`invoice-status-icon ${invoice.status === "Lunas" ? "paid" : "unpaid"}`}>
                    {invoice.status === "Lunas" ? <Check size={18} /> : <Clock3 size={18} />}
                  </span>
                  <div className="invoice-primary">
                    <strong>{invoice.number}</strong>
                    <span>{invoice.type} · Terbit {invoice.issueDate}</span>
                  </div>
                  <div className="invoice-amount">
                    <span>Nilai tagihan</span>
                    <strong>{formatCurrency(invoice.amount)}</strong>
                  </div>
                  <div className="invoice-due">
                    <span>{invoice.status === "Lunas" ? "Dibayar" : "Jatuh tempo"}</span>
                    <strong>{invoice.status === "Lunas" ? invoice.paidDate : invoice.dueDate}</strong>
                  </div>
                  <span className={`status-badge ${invoice.status === "Lunas" ? "success" : "warning"}`}>
                    {invoice.status}
                  </span>
                  <div className="invoice-actions">
                    <button className="button subtle small" type="button" onClick={() => downloadInvoice(invoice)}>
                      <Download size={15} /> PDF
                    </button>
                    {invoice.status === "Belum Lunas" && (
                      <button className="button primary small" type="button" onClick={() => confirmPayment(invoice.id)}>
                        <Check size={15} /> Konfirmasi
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {showInvoiceForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowInvoiceForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="invoice-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">INVOICE BARU</span>
                <h2 id="invoice-form-title">Terbitkan tagihan proyek</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowInvoiceForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={createInvoice}>
              <label className="field full select-field">
                <span>Jenis tagihan</span>
                <select value={invoiceType} onChange={(event) => setInvoiceType(event.target.value)}>
                  <option>DP 30%</option>
                  <option>DP 50%</option>
                  <option>Termin 2</option>
                  <option>Pelunasan</option>
                </select>
                <ChevronDown size={15} />
              </label>
              <label className="field full">
                <span>Nominal tagihan</span>
                <input type="number" min="1" value={invoiceAmount} onChange={(event) => setInvoiceAmount(Number(event.target.value))} />
              </label>
              <label className="field full">
                <span>Jatuh tempo</span>
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </label>
              <div className="invoice-form-summary full">
                <span>Nilai invoice yang akan diterbitkan</span>
                <strong>{formatCurrency(invoiceAmount)}</strong>
              </div>
              <div className="modal-actions full">
                <button className="button secondary" type="button" onClick={() => setShowInvoiceForm(false)}>Batal</button>
                <button className="button primary" type="submit"><FileCheck2 size={16} /> Terbitkan invoice</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
