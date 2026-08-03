"use client";

import {
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  Download,
  Eye,
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
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import { BankAccount, BoqItem, CommercialPackage, formatCurrency, Invoice, Project } from "../data";
import { type AppLanguage, localizedDate, localizedLabel } from "../i18n";
import { appPath } from "../paths";
import { DocumentTaxEditor } from "./document-tax-editor";
import { CommercialPackageSwitcher } from "./commercial-package-switcher";
import { DocumentPreviewModal } from "./document-preview-modal";

interface BillingViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projectId: string;
  canManage: boolean;
  canManagePayments: boolean;
  canManageTaxes: boolean;
  canManageValidity: boolean;
}

type BillingTab = "quotation" | "invoice";

interface Quotation {
  id: string | null;
  number: string | null;
  status: "Draft" | "Sent" | "Accepted" | "Rejected" | "Void" | "Superseded";
  packageId?: string | null;
  packageTitle?: string | null;
  revisionNo?: number;
  issuedAt: string;
  validUntil: string | null;
  total: number;
  subtotal?: number;
  discountEnabled?: boolean;
  discountType?: "Nominal" | "Percent";
  discountValue?: number;
  discountAmount?: number;
  taxableBase?: number;
  roundingMode?: "None" | "Up" | "Down" | "Custom";
  roundingStep?: number;
  roundingAdjustment?: number;
  roundingReason?: string | null;
  grandTotal?: number;
  taxEnabled?: boolean;
  taxAdditions?: number;
  taxWithholdings?: number;
  grossTotal?: number;
  netCashDue?: number;
  taxes?: Array<{ code: string; name?: string; nameEn?: string; amount: number; effect?: "Add" | "Withhold" }>;
}

async function attachmentFromFile(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mimeType: file.type,
    contentBase64: dataUrl.split(",")[1] ?? "",
  };
}

export function BillingView({
  language,
  notify,
  projectId,
  canManage,
  canManagePayments,
  canManageTaxes,
  canManageValidity,
}: BillingViewProps) {
  const id = language === "id";
  const [activeTab, setActiveTab] = useState<BillingTab>("quotation");
  const [project, setProject] = useState<Project | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotationItems, setQuotationItems] = useState<BoqItem[]>([]);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [packageId, setPackageId] = useState("");
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState("");
  const [invoiceType, setInvoiceType] = useState("DP 50%");
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [installmentPercent, setInstallmentPercent] = useState(50);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [showQuotationForm, setShowQuotationForm] = useState(false);
  const [quotationIssuedAt, setQuotationIssuedAt] = useState("");
  const [quotationValidUntil, setQuotationValidUntil] = useState("");
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<"Nominal" | "Percent">("Nominal");
  const [discountValue, setDiscountValue] = useState(0);
  const [roundingMode, setRoundingMode] = useState<"None" | "Up" | "Down" | "Custom">("None");
  const [roundingStep, setRoundingStep] = useState(0);
  const [roundingAdjustment, setRoundingAdjustment] = useState(0);
  const [roundingReason, setRoundingReason] = useState("");
  const [serverToday, setServerToday] = useState("");
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentGross, setPaymentGross] = useState(0);
  const [paymentCash, setPaymentCash] = useState(0);
  const [paymentWithholding, setPaymentWithholding] = useState(0);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Transfer Bank");
  const [paymentBankId, setPaymentBankId] = useState("");
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [preview, setPreview] = useState<{ url: string; title: string; filename: string } | null>(null);

  const selectPackage = useCallback((nextPackageId: string, nextPackages: CommercialPackage[]) => {
    void nextPackages;
    setPackageId(nextPackageId);
  }, []);

  useEffect(() => {
    if (!packageId) return;
    let active = true;
    const packageQuery = `&packageId=${encodeURIComponent(packageId)}`;
    Promise.all([
      api<Invoice[]>(`/api/invoices?projectId=${encodeURIComponent(projectId)}${packageQuery}`),
      api<{ items: BoqItem[] }>(`/api/boq?projectId=${encodeURIComponent(projectId)}${packageQuery}`),
      api<Quotation>(`/api/quotations?projectId=${encodeURIComponent(projectId)}${packageQuery}`),
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
        setDiscountEnabled(Boolean(quotationData.discountEnabled));
        setDiscountType(quotationData.discountType ?? "Nominal");
        setDiscountValue(quotationData.discountValue ?? 0);
        setRoundingMode(quotationData.roundingMode ?? "None");
        setRoundingStep(quotationData.roundingStep ?? 0);
        setRoundingAdjustment(quotationData.roundingAdjustment ?? 0);
        setRoundingReason(quotationData.roundingReason ?? "");
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify, packageId, projectId]);

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

  useEffect(() => {
    if (!canManagePayments) return;
    let active = true;
    api<BankAccount[]>("/api/bank-accounts")
      .then((accounts) => {
        if (!active) return;
        const available = accounts.filter((account) => account.status === "Aktif");
        setBankAccounts(available);
        setPaymentBankId((current) => current || available[0]?.id || "");
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [canManagePayments, language, notify]);

  const boqTotal = useMemo(
    () =>
      quotationItems.reduce(
        (sum, item) => sum + item.quantity * item.sellingPrice,
        0,
      ),
    [quotationItems],
  );
  const quotationTotal = quotation?.total ?? boqTotal;
  const quotationGrossTotal = quotation?.grandTotal ?? quotation?.grossTotal ?? quotationTotal;
  const paidTotal = invoices.reduce(
    (sum, invoice) => sum + (invoice.paidGross ?? (invoice.status === "Lunas" ? invoice.amount : 0)),
    0,
  );
  const outstanding = invoices.reduce(
    (sum, invoice) => sum + (invoice.outstanding ?? (invoice.status === "Lunas" ? 0 : invoice.amount)),
    0,
  );
  const invoicedTotal = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const quotationExpired = Boolean(
    quotation?.validUntil &&
    serverToday &&
    quotation.validUntil < serverToday &&
    quotation.status !== "Accepted",
  );

  function setValidityDays(days: number) {
    if (!quotationIssuedAt) return;
    const base = new Date(`${quotationIssuedAt}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + days);
    setQuotationValidUntil(base.toISOString().slice(0, 10));
  }

  async function updateQuotation(
    input: Partial<Pick<Quotation, "status" | "issuedAt" | "validUntil" | "discountEnabled" | "discountType" | "discountValue" | "roundingMode" | "roundingStep" | "roundingAdjustment" | "roundingReason">>,
  ) {
    const updated = await api<Quotation>(
      `/api/quotations?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    setQuotation(updated);
    setQuotationIssuedAt(updated.issuedAt);
    setQuotationValidUntil(updated.validUntil ?? "");
    setDiscountEnabled(Boolean(updated.discountEnabled));
    setDiscountType(updated.discountType ?? "Nominal");
    setDiscountValue(updated.discountValue ?? 0);
    setRoundingMode(updated.roundingMode ?? "None");
    setRoundingStep(updated.roundingStep ?? 0);
    setRoundingAdjustment(updated.roundingAdjustment ?? 0);
    setRoundingReason(updated.roundingReason ?? "");
    return updated;
  }

  async function refreshQuotation() {
    const updated = await api<Quotation>(`/api/quotations?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`);
    setQuotation(updated);
  }

  async function downloadQuotation() {
    try {
      if (!quotation?.id && canManage) {
        await updateQuotation({ status: "Draft" });
      }
      await downloadApiFile(
        quotation?.id
          ? `/api/quotations/${quotation.id}/pdf`
          : `/api/projects/${projectId}/quotation.pdf?packageId=${encodeURIComponent(packageId)}`,
        `${quotation?.number?.replaceAll("/", "-") ?? "Quotation-PerumNet"}.pdf`,
      );
      notify(id ? "Quotation PDF berhasil dibuat dari BoQ proyek aktif." : "The Quotation PDF was created from the active project BoQ.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function saveQuotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await updateQuotation({
        status: quotation?.status ?? "Draft",
        issuedAt: quotationIssuedAt,
        validUntil: quotationValidUntil,
        discountEnabled,
        discountType,
        discountValue,
        roundingMode,
        roundingStep,
        roundingAdjustment,
        roundingReason: roundingReason || null,
      });
      setShowQuotationForm(false);
      notify(id ? "Quotation berhasil diperbarui." : "Quotation updated.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function markQuotationSent() {
    try {
      await updateQuotation({ status: "Sent" });
      notify(id ? "Quotation ditandai sebagai terkirim." : "Quotation marked as sent.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function downloadInvoice(invoice: Invoice) {
    try {
      await downloadApiFile(
        `/api/invoices/${invoice.id}/pdf`,
        `${invoice.number.replaceAll("/", "-")}.pdf`,
      );
      notify(id ? "Invoice PDF berhasil dibuat." : "Invoice PDF created.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  function openPayment(invoice: Invoice) {
    const gross = invoice.outstanding ?? invoice.grossTotal ?? invoice.amount;
    const withholding = Math.min(
      gross,
      Math.max(0, (invoice.taxWithholdings ?? 0) - (invoice.withheldTax ?? 0)),
    );
    setPaymentInvoice(invoice);
    setPaymentDate(
      invoice.paidDateIso ??
        (invoice.status !== "Lunas" ? serverToday : ""),
    );
    setPaymentGross(gross);
    setPaymentWithholding(withholding);
    setPaymentCash(Math.max(0, gross - withholding));
    setPaymentReference("");
    setPaymentMethod("Transfer Bank");
    setPaymentBankId(bankAccounts[0]?.id ?? "");
    setPaymentFile(null);
  }

  async function persistPayment(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (
      !paymentInvoice ||
      !paymentDate ||
      !paymentFile ||
      paymentGross <= 0 ||
      paymentGross !== paymentCash + paymentWithholding
    ) return;
    setPaymentSaving(true);
    try {
      const updated = await api<Invoice>(
        `/api/invoices/${paymentInvoice.id}/payments`,
        {
          method: "POST",
          body: JSON.stringify({
            grossAmount: paymentGross,
            cashAmount: paymentCash,
            withholdingAmount: paymentWithholding,
            paidDate: paymentDate,
            paymentReference,
            paymentMethod,
            bankAccountId:
              paymentMethod === "Transfer Bank" ? paymentBankId : undefined,
            attachment: await attachmentFromFile(paymentFile),
          }),
        },
      );
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === paymentInvoice.id ? updated : invoice,
        ),
      );
      setPaymentInvoice(null);
      notify(id ? "Pembayaran parsial, kas aktual, dan pajak telah disinkronkan." : "Partial payment, actual cash, and tax were synchronized.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setPaymentSaving(false);
    }
  }

  async function cancelPayment() {
    if (!paymentInvoice) return;
    const posted = [...(paymentInvoice.payments ?? [])]
      .reverse()
      .find((payment) => payment.status === "Posted");
    if (!posted) return;
    const reason = window.prompt(
      id ? "Alasan pembatalan pembayaran:" : "Payment void reason:",
    );
    if (!reason) return;
    setPaymentSaving(true);
    try {
      const updated = await api<Invoice>(
        `/api/invoices/${paymentInvoice.id}/payments/${posted.id}/void`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        },
      );
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === paymentInvoice.id ? updated : invoice,
        ),
      );
      setPaymentInvoice(null);
      notify(
        id
          ? "Konfirmasi pembayaran dibatalkan dan pembukuan dikoreksi."
          : "Payment confirmation cancelled and the ledger corrected.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setPaymentSaving(false);
    }
  }

  function openNewInvoice() {
    const today = new Date().toISOString().slice(0, 10);
    const committedPercent = invoices.reduce((sum, invoice) => sum + (invoice.installmentPercent ?? 0), 0);
    const remainingPercent = Math.max(0, 100 - committedPercent);
    const nextPercent = invoices.length ? remainingPercent : Math.min(50, remainingPercent);
    setEditingInvoiceId("");
    setInvoiceType(invoices.length ? "Pelunasan" : "DP 50%");
    setInstallmentPercent(nextPercent);
    setInvoiceAmount(Math.round((quotationGrossTotal * nextPercent) / 100));
    setIssueDate(today);
    setDueDate(
      new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    );
    setShowInvoiceForm(true);
  }

  function openEditInvoice(invoice: Invoice) {
    setEditingInvoiceId(invoice.id);
    setInvoiceType(invoice.type);
    const percent = invoice.installmentPercent ??
      (quotationGrossTotal > 0 ? Math.round((invoice.amount / quotationGrossTotal) * 10_000) / 100 : 0);
    setInstallmentPercent(percent);
    setInvoiceAmount(invoice.amount);
    setIssueDate(invoice.issueDateIso ?? new Date().toISOString().slice(0, 10));
    setDueDate(invoice.dueDateIso ?? "");
    setShowInvoiceForm(true);
  }

  async function persistInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (installmentPercent <= 0 || installmentPercent > 100) return;
    try {
      const invoice = await api<Invoice>(
        editingInvoiceId ? `/api/invoices/${editingInvoiceId}` : "/api/invoices",
        {
          method: editingInvoiceId ? "PATCH" : "POST",
          body: JSON.stringify({
            ...(editingInvoiceId ? {} : { projectId, packageId, quotationId: quotation?.id }),
            type: invoiceType,
            issueDate,
            dueDate,
            calculationMode: "Percent",
            installmentPercent,
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
          ? id ? "Invoice dan transaksi terkait berhasil diperbarui." : "Invoice and related transaction updated."
          : id ? "Invoice baru berhasil diterbitkan." : "A new invoice was issued.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteInvoice(invoice: Invoice) {
    if (!window.confirm(`${id ? "Hapus" : "Delete"} ${invoice.number}?`)) return;
    try {
      await api(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      setInvoices((current) => current.filter((item) => item.id !== invoice.id));
      notify(id ? "Invoice dan transaksi otomatis terkait berhasil dihapus." : "Invoice and related automatic transaction deleted.");
    } catch (error) {
      notify(messageOf(error, language));
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
      notify(id ? "Tautan workspace dokumen berhasil dibagikan." : "Document workspace link shared.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack" data-testid="billing-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">{id ? "DOKUMEN KOMERSIAL" : "COMMERCIAL DOCUMENTS"}</span>
          <h1>Quotation & Invoice</h1>
          <p>
            {project
              ? `${project.code} · ${project.name}`
              : id ? "Memuat konteks proyek..." : "Loading project context..."}
          </p>
        </div>
        <div className="title-actions">
          <CommercialPackageSwitcher
            projectId={projectId}
            language={language}
            canManage={canManage}
            value={packageId}
            onChange={selectPackage}
            notify={notify}
          />
          <button className="button secondary" type="button" onClick={shareDocument}>
            <Send size={16} /> {id ? "Bagikan" : "Share"}
          </button>
          {canManage && (
            <button className="button primary" type="button" onClick={openNewInvoice}>
              <Plus size={16} /> {id ? "Buat invoice" : "Create invoice"}
            </button>
          )}
        </div>
      </section>

      <div className="module-tabs" role="tablist" aria-label={id ? "Dokumen penagihan" : "Billing documents"}>
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
                <span className={`status-badge ${quotationExpired ? "danger" : quotation?.status === "Sent" ? "success" : "info"}`}>
                  {quotation?.status === "Sent" ? <CircleCheck size={14} /> : <Clock3 size={14} />}
                  {quotationExpired ? (id ? "Kedaluwarsa" : "Expired") : quotation?.status === "Sent" ? (id ? "Sudah dikirim" : "Sent") : quotation?.status ?? "Draft"}
                </span>
                <span>{quotation?.number ?? (id ? "Nomor dibuat saat Quotation disimpan" : "Number created when the Quotation is saved")}</span>
              </div>
              <div className="title-actions">
                {quotation?.id ? (
                  <DocumentTaxEditor
                    language={language}
                    notify={notify}
                    documentType="Quotation"
                    documentId={quotation.id}
                    canManage={canManageTaxes && quotation.status === "Draft"}
                    onSaved={refreshQuotation}
                  />
                ) : null}
                {canManageValidity && quotation?.status !== "Accepted" && (
                  <button className="button secondary small" type="button" onClick={() => setShowQuotationForm(true)}>
                    <Pencil size={15} /> {id ? "Edit" : "Edit"}
                  </button>
                )}
                <button className="button primary small" type="button" disabled={!quotationItems.length} onClick={downloadQuotation}>
                  <Download size={15} /> {id ? "Unduh PDF" : "Download PDF"}
                </button>
                {quotation?.id && (
                  <button className="icon-button" type="button" aria-label={id ? "Pratinjau quotation" : "Preview quotation"} onClick={() => setPreview({ url: `/api/quotations/${quotation.id}/pdf`, title: quotation.number ?? "Quotation", filename: `${quotation.number?.replaceAll("/", "-") ?? "Quotation"}.pdf` })}>
                    <Eye size={17} />
                  </button>
                )}
              </div>
            </div>
            <article className="document-preview">
              <header className="document-letterhead">
                <img src={appPath("/perumnet-enterprise-brand.png")} alt="PerumNet Enterprise" width={126} height={132} />
                <div>
                  <strong>PERUMNET ENTERPRISE</strong>
                  <span>{id ? "Konsultan IT & Managed Services" : "IT Consulting & Managed Services"}</span>
                  <small>Gianyar, Bali · enterprise@perumnet.id · enterprise.perumnet.id</small>
                </div>
              </header>
              <div className="document-title">
                <div><span>QUOTATION</span><h2>{project?.name ?? (id ? "Proyek" : "Project")}</h2></div>
                <div>
                  <small>{id ? "Nomor" : "Number"}</small><strong>{quotation?.number ?? "DRAFT"}</strong>
                  <small>{id ? "Tanggal" : "Date"}</small><strong>{localizedDate(language, quotation?.issuedAt)}</strong>
                </div>
              </div>
              <div className="document-recipient">
                <span>{id ? "Ditujukan kepada" : "Prepared for"}</span>
                <strong>{project?.client ?? (id ? "Klien" : "Client")}</strong>
                <small>{project?.location ?? (id ? "Lokasi belum ditentukan" : "Location not specified")}</small>
              </div>
              <table className="document-table">
                <thead><tr><th>No</th><th>{id ? "Deskripsi" : "Description"}</th><th>Qty</th><th>{id ? "Harga satuan" : "Unit price"}</th><th>Total</th></tr></thead>
                <tbody>
                  {quotationItems.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td><strong>{item.description}</strong><small>{localizedLabel(language, item.category)}</small></td>
                      <td>{item.quantity} {localizedLabel(language, item.unit)}</td>
                      <td>{formatCurrency(item.sellingPrice, language)}</td>
                      <td>{formatCurrency(item.quantity * item.sellingPrice, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!quotationItems.length && (
                <div className="empty-state compact">
                  <FileText size={24} />
                  <p>{id ? "BoQ proyek ini masih kosong. Tambahkan item sebelum membuat Quotation." : "This project BoQ is empty. Add items before creating a Quotation."}</p>
                </div>
              )}
              <div className="document-commercial-totals">
                <div><span>{id ? "Subtotal pekerjaan" : "Work subtotal"}</span><strong>{formatCurrency(quotationTotal, language)}</strong></div>
                {(quotation?.discountAmount ?? 0) > 0 && <div><span>{id ? "Diskon" : "Discount"}</span><strong>−{formatCurrency(quotation?.discountAmount ?? 0, language)}</strong></div>}
                {(quotation?.discountAmount ?? 0) > 0 && <div><span>{id ? "Dasar pengenaan pajak" : "Taxable subtotal"}</span><strong>{formatCurrency(quotation?.taxableBase ?? 0, language)}</strong></div>}
                {(quotation?.taxes ?? []).filter((tax) => tax.effect !== "Withhold").map((tax) => <div key={`${tax.code}-${tax.amount}`}><span>{tax.code} · {id ? (tax.name ?? "Pajak klien") : (tax.nameEn ?? "Client tax")} <small>{id ? "dibebankan ke klien" : "charged to client"}</small></span><strong>+{formatCurrency(tax.amount, language)}</strong></div>)}
                {(quotation?.taxes ?? []).filter((tax) => tax.effect === "Withhold").map((tax) => <div key={`${tax.code}-${tax.amount}`}><span>{tax.code} · {id ? (tax.name ?? "Pajak potong") : (tax.nameEn ?? "Withholding tax")}</span><strong>−{formatCurrency(tax.amount, language)}</strong></div>)}
                {(quotation?.roundingAdjustment ?? 0) !== 0 && <div><span>{id ? "Pembulatan" : "Rounding"}</span><strong>{(quotation?.roundingAdjustment ?? 0) > 0 ? "+" : ""}{formatCurrency(quotation?.roundingAdjustment ?? 0, language)}</strong></div>}
                <div className="grand"><span>{id ? "Total tagihan klien" : "Total billed to client"}</span><strong>{formatCurrency(quotationGrossTotal, language)}</strong></div>
              </div>
              {(quotation?.taxAdditions ?? 0) > 0 && <div className="client-tax-note"><ReceiptText size={16} /><span><strong>{id ? "Pajak ditagihkan kepada klien" : "Tax is charged to the client"}</strong><small>{id ? "Pajak tambah bukan biaya proyek PerumNet dan dicatat sebagai utang pajak." : "Added tax is not a PerumNet project cost and is recorded as a tax payable."}</small></span></div>}
              <div className="document-notes">
                <strong>{id ? "Ketentuan penawaran" : "Quotation terms"}</strong>
                <p>{id ? "Berlaku sampai" : "Valid until"} {localizedDate(language, quotation?.validUntil)}. {id ? "Nilai akan kembali menjadi Draft bila BoQ diubah." : "The value returns to Draft when the BoQ changes."}</p>
              </div>
            </article>
          </div>

          <aside className="billing-side">
            <section className="panel">
              <div className="panel-head"><div><span className="eyebrow">{id ? "RINGKASAN" : "SUMMARY"}</span><h2>{id ? "Status quotation" : "Quotation status"}</h2></div></div>
              <div className="document-status-list">
                <div className={quotationItems.length ? "done" : "active"}><span><Check size={14} /></span><div><strong>BoQ</strong><small>{quotationItems.length} item · {formatCurrency(boqTotal, language)}</small></div></div>
                <div className={quotation?.id ? "done" : "active"}><span><FileCheck2 size={14} /></span><div><strong>Quotation</strong><small>{quotation?.number ?? (id ? "Belum disimpan" : "Not saved")}</small></div></div>
                <div className={quotation?.status === "Sent" ? "done" : "active"}><span><Mail size={14} /></span><div><strong>{quotation?.status === "Sent" ? (id ? "Sudah dikirim" : "Sent") : (id ? "Menunggu dikirim" : "Awaiting delivery")}</strong><small>{quotation?.status === "Sent" ? (id ? "Nilai terkunci sampai BoQ berubah" : "Value is locked until the BoQ changes") : (id ? "Periksa tanggal dan isi dokumen" : "Review dates and document content")}</small></div></div>
              </div>
              {canManage && (
                <button className="button primary full-width" type="button" disabled={!quotationItems.length || quotation?.status === "Sent" || quotationExpired} onClick={markQuotationSent}>
                  <Send size={16} /> {quotation?.status === "Sent" ? (id ? "Sudah dikirim" : "Sent") : (id ? "Tandai sudah dikirim" : "Mark as sent")}
                </button>
              )}
            </section>
          </aside>
        </section>
      )}

      {activeTab === "invoice" && (
        <div className="page-stack">
          <section className="metric-grid invoice-metrics">
            <article className="metric-card"><span className="metric-icon green"><CircleCheck size={20} /></span><div className="metric-main"><span>{id ? "Sudah diterima" : "Received"}</span><strong>{formatCurrency(paidTotal, language)}</strong></div><span className="metric-change positive">{quotationGrossTotal ? Math.round((paidTotal / quotationGrossTotal) * 100) : 0}% {id ? "dari tagihan bruto" : "of gross billing"}</span></article>
            <article className="metric-card"><span className="metric-icon orange"><Clock3 size={20} /></span><div className="metric-main"><span>{id ? "Belum dibayar" : "Outstanding"}</span><strong>{formatCurrency(outstanding, language)}</strong></div><span className="metric-change warning-text">{invoices.filter((invoice) => invoice.status !== "Lunas").length} {id ? "invoice aktif" : "active invoices"}</span></article>
            <article className="metric-card"><span className="metric-icon blue"><FileCheck2 size={20} /></span><div className="metric-main"><span>{id ? "Sisa dapat ditagihkan" : "Remaining billable"}</span><strong>{formatCurrency(Math.max(0, quotationTotal - invoicedTotal), language)}</strong></div><span className="metric-change">{id ? "Dari" : "Of"} {formatCurrency(quotationTotal, language)}</span></article>
          </section>
          <section className="panel">
            <div className="panel-head">
              <div><span className="eyebrow">{id ? "TAGIHAN PROYEK" : "PROJECT BILLING"}</span><h2>{id ? "Daftar invoice" : "Invoices"}</h2></div>
              {canManage && <button className="button primary small" type="button" disabled={!quotationTotal || quotation?.status !== "Accepted" || invoices.reduce((sum, invoice) => sum + (invoice.installmentBps ?? 0), 0) >= 10_000} onClick={openNewInvoice}><Plus size={15} /> {id ? "Invoice baru" : "New invoice"}</button>}
            </div>
            <div className="invoice-list">
              {invoices.map((invoice) => (
                <article className="invoice-row" key={invoice.id}>
                  <span className={`invoice-status-icon ${invoice.status === "Lunas" ? "paid" : "unpaid"}`}>{invoice.status === "Lunas" ? <Check size={18} /> : <Clock3 size={18} />}</span>
                  <div className="invoice-primary"><strong>{invoice.number}</strong><span>{invoice.type} · {id ? "Terbit" : "Issued"} {localizedDate(language, invoice.issueDateIso)}</span></div>
                  <div className="invoice-amount"><span>{id ? "Dasar / bruto" : "Base / gross"}</span><strong>{formatCurrency(invoice.amount, language)} / {formatCurrency(invoice.grossTotal ?? invoice.amount, language)}</strong></div>
                  <div className="invoice-due"><span>{invoice.status === "Lunas" ? (id ? "Dibayar" : "Paid") : (id ? "Jatuh tempo" : "Due date")}</span><strong>{invoice.status === "Lunas" ? localizedDate(language, invoice.paidDateIso ?? invoice.paidDate) : localizedDate(language, invoice.dueDateIso)}</strong></div>
                  <span className={`status-badge ${invoice.status === "Lunas" ? "success" : "warning"}`}>{localizedLabel(language, invoice.status)}</span>
                  <div className="invoice-actions">
                    <button className="icon-button" type="button" aria-label={`${id ? "Pratinjau" : "Preview"} ${invoice.number}`} onClick={() => setPreview({ url: `/api/invoices/${invoice.id}/pdf`, title: invoice.number, filename: `${invoice.number.replaceAll("/", "-")}.pdf` })}><Eye size={15} /></button>
                    <button className="button subtle small" type="button" onClick={() => downloadInvoice(invoice)}><Download size={15} /> PDF</button>
                    {!(invoice.payments?.length) && <DocumentTaxEditor language={language} notify={notify} documentType="Invoice" documentId={invoice.id} canManage={canManageTaxes} onSaved={async () => {
                      const updated = await api<Invoice>(`/api/invoices/${invoice.id}`);
                      setInvoices((current) => current.map((item) => item.id === updated.id ? updated : item));
                    }} />}
                    {canManage && (invoice.status !== "Lunas" || canManagePayments) && <button className="icon-button" type="button" aria-label={`Edit ${invoice.number}`} onClick={() => openEditInvoice(invoice)}><Pencil size={15} /></button>}
                    {canManagePayments && <button className={`button small ${invoice.status === "Lunas" ? "subtle" : "primary"}`} type="button" onClick={() => openPayment(invoice)}><Check size={15} /> {invoice.status === "Lunas" ? (id ? "Koreksi bayar" : "Correct payment") : (id ? "Konfirmasi" : "Confirm")}</button>}
                    {canManage && (invoice.status !== "Lunas" || canManagePayments) && <button className="icon-button danger" type="button" aria-label={`Hapus ${invoice.number}`} onClick={() => deleteInvoice(invoice)}><Trash2 size={15} /></button>}
                  </div>
                </article>
              ))}
              {!invoices.length && <div className="empty-state"><ReceiptText size={28} /><h3>{id ? "Belum ada invoice" : "No invoices yet"}</h3><p>{id ? "Buat Invoice dari nilai Quotation proyek ini." : "Create an Invoice from this project's Quotation value."}</p></div>}
            </div>
          </section>
        </div>
      )}

      {paymentInvoice ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPaymentInvoice(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="invoice-payment-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "PEMBAYARAN INVOICE" : "INVOICE PAYMENT"}</span><h2 id="invoice-payment-title">{paymentInvoice.number}</h2></div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setPaymentInvoice(null)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={persistPayment}>
              <label className="field"><span>{id ? "Nilai bruto diselesaikan" : "Gross amount settled"}</span><input type="number" required min="1" max={paymentInvoice.outstanding ?? paymentInvoice.grossTotal ?? paymentInvoice.amount} value={paymentGross || ""} onChange={(event) => { const gross = Number(event.target.value); setPaymentGross(gross); setPaymentCash(Math.max(0, gross - paymentWithholding)); }} /></label>
              <label className="field"><span>{id ? "Pajak dipotong klien" : "Tax withheld by client"}</span><input type="number" required min="0" max={paymentInvoice.taxWithholdings ?? 0} value={paymentWithholding} onChange={(event) => { const withholding = Number(event.target.value); setPaymentWithholding(withholding); setPaymentCash(Math.max(0, paymentGross - withholding)); }} /></label>
              <label className="field"><span>{id ? "Kas aktual diterima" : "Actual cash received"}</span><input type="number" required min="0" value={paymentCash} onChange={(event) => setPaymentCash(Number(event.target.value))} /></label>
              <label className="field full"><span>{id ? "Tanggal dana diterima" : "Payment received date"}</span><input type="date" required min={paymentInvoice.issueDateIso} max={serverToday || undefined} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Referensi pembayaran" : "Payment reference"}</span><input required value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
              <label className="field"><span>{id ? "Metode" : "Method"}</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="Transfer Bank">{id ? "Transfer Bank" : "Bank Transfer"}</option><option value="Tunai">{id ? "Tunai" : "Cash"}</option><option value="Kartu">{id ? "Kartu" : "Card"}</option><option value="Lainnya">{id ? "Lainnya" : "Other"}</option></select></label>
              {paymentMethod === "Transfer Bank" ? <label className="field"><span>{id ? "Rekening perusahaan" : "Company bank account"}</span><select required value={paymentBankId} onChange={(event) => setPaymentBankId(event.target.value)}><option value="">{id ? "Pilih rekening" : "Select account"}</option>{bankAccounts.map((account) => <option value={account.id} key={account.id}>{account.bankName} · {account.accountNumberMasked}</option>)}</select></label> : null}
              <label className="field full"><span>{id ? "Bukti pembayaran (PDF/gambar)" : "Payment proof (PDF/image)"}</span><input type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setPaymentFile(event.target.files?.[0] ?? null)} /></label>
              <div className="statement-guidance full"><Clock3 size={18} /><span><strong>{id ? "Gunakan tanggal mutasi rekening" : "Use the bank statement date"}</strong><small>{id ? "Tanggal ini menentukan periode arus kas dan kandidat rekonsiliasi bank." : "This date determines the cash-flow period and bank reconciliation candidates."}</small></span></div>
              <div className="modal-actions full">
                {paymentInvoice.payments?.some((payment) => payment.status === "Posted") ? <button className="button danger" type="button" disabled={paymentSaving} onClick={cancelPayment}>{id ? "Void pembayaran terakhir" : "Void latest payment"}</button> : null}
                <button className="button secondary" type="button" onClick={() => setPaymentInvoice(null)}>{id ? "Tutup" : "Close"}</button>
                <button className="button primary" type="submit" disabled={paymentSaving || !paymentDate || !paymentFile || paymentGross !== paymentCash + paymentWithholding}><Check size={15} /> {paymentSaving ? (id ? "Menyimpan..." : "Saving...") : (id ? "Posting pembayaran" : "Post payment")}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showInvoiceForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowInvoiceForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="invoice-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">{editingInvoiceId ? "EDIT INVOICE" : (id ? "INVOICE BARU" : "NEW INVOICE")}</span><h2 id="invoice-form-title">{editingInvoiceId ? (id ? "Perbarui tagihan proyek" : "Update project invoice") : (id ? "Terbitkan tagihan proyek" : "Issue project invoice")}</h2></div><button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowInvoiceForm(false)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={persistInvoice}>
              <label className="field full select-field"><span>{id ? "Jenis tagihan" : "Invoice type"}</span><select value={invoiceType} onChange={(event) => setInvoiceType(event.target.value)}><option value="DP 30%">DP 30%</option><option value="DP 50%">DP 50%</option><option value="Termin 2">{id ? "Termin 2" : "Milestone 2"}</option><option value="Pelunasan">{id ? "Pelunasan" : "Final Payment"}</option></select><ChevronDown size={15} /></label>
              <label className="field"><span>{id ? "Tanggal terbit" : "Issue date"}</span><input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
              <label className="field"><span>{id ? "Jatuh tempo" : "Due date"}</span><input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Persentase termin" : "Installment percentage"}</span><div className="percentage-input"><input type="number" min="0.01" max="100" step="0.01" required value={installmentPercent || ""} onChange={(event) => { const value = Number(event.target.value); setInstallmentPercent(value); setInvoiceAmount(Math.round((quotationGrossTotal * value) / 100)); }} /><span>%</span></div></label>
              <div className="invoice-form-summary full"><span>{id ? "Nilai termin dari Grand Total" : "Installment from Grand Total"}</span><strong>{formatCurrency(invoiceAmount, language)}</strong><small>{installmentPercent.toLocaleString(language === "id" ? "id-ID" : "en-US")}% × {formatCurrency(quotationGrossTotal, language)}. {id ? "Invoice terakhir otomatis menyerap selisih pembulatan." : "The final invoice automatically absorbs rounding residuals."}</small></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowInvoiceForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><FileCheck2 size={16} /> {editingInvoiceId ? (id ? "Simpan perubahan" : "Save changes") : (id ? "Terbitkan invoice" : "Issue invoice")}</button></div>
            </form>
          </section>
        </div>
      )}

      <DocumentPreviewModal
        open={Boolean(preview)}
        url={preview?.url ?? ""}
        title={preview?.title ?? ""}
        filename={preview?.filename ?? "document.pdf"}
        onClose={() => setPreview(null)}
      />

      {showQuotationForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowQuotationForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="quotation-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">EDIT QUOTATION</span><h2 id="quotation-form-title">{id ? "Tanggal dan masa berlaku" : "Dates and validity"}</h2></div><button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowQuotationForm(false)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={saveQuotation}>
              <label className="field full"><span>{id ? "Tanggal terbit" : "Issue date"}</span><input required type="date" value={quotationIssuedAt} onChange={(event) => setQuotationIssuedAt(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Berlaku sampai" : "Valid until"}</span><input required type="date" value={quotationValidUntil} onChange={(event) => setQuotationValidUntil(event.target.value)} /></label>
              <div className="field full"><span>{id ? "Pilihan cepat masa berlaku" : "Quick validity"}</span><div className="title-actions">{[7, 14, 30, 60].map((days) => <button className="button subtle small" type="button" key={days} onClick={() => setValidityDays(days)}>{days} {id ? "hari" : "days"}</button>)}</div></div>
              <label className="field full check-field"><input type="checkbox" checked={discountEnabled} onChange={(event) => setDiscountEnabled(event.target.checked)} /><span>{id ? "Gunakan diskon" : "Apply discount"}</span></label>
              {discountEnabled && <><label className="field select-field"><span>{id ? "Jenis diskon" : "Discount type"}</span><select value={discountType} onChange={(event) => setDiscountType(event.target.value as "Nominal" | "Percent")}><option value="Nominal">Nominal</option><option value="Percent">%</option></select><ChevronDown size={15} /></label><label className="field"><span>{discountType === "Percent" ? (id ? "Persen diskon" : "Discount percent") : (id ? "Nilai diskon" : "Discount amount")}</span><input type="number" min="0" max={discountType === "Percent" ? 100 : undefined} step={discountType === "Percent" ? .01 : 1} value={discountType === "Percent" ? discountValue / 100 : discountValue} onChange={(event) => setDiscountValue(discountType === "Percent" ? Math.round(Number(event.target.value) * 100) : Number(event.target.value))} /></label></>}
              <label className="field select-field"><span>{id ? "Pembulatan" : "Rounding"}</span><select value={roundingMode} onChange={(event) => setRoundingMode(event.target.value as typeof roundingMode)}><option value="None">{id ? "Tanpa pembulatan" : "No rounding"}</option><option value="Up">{id ? "Ke atas" : "Round up"}</option><option value="Down">{id ? "Ke bawah" : "Round down"}</option><option value="Custom">Custom</option></select><ChevronDown size={15} /></label>
              {roundingMode !== "None" && roundingMode !== "Custom" && <label className="field select-field"><span>{id ? "Kelipatan" : "Increment"}</span><select value={roundingStep} onChange={(event) => setRoundingStep(Number(event.target.value))}><option value={1000}>Rp1.000</option><option value={10000}>Rp10.000</option><option value={100000}>Rp100.000</option></select><ChevronDown size={15} /></label>}
              {roundingMode === "Custom" && <><label className="field"><span>{id ? "Penyesuaian (+/-)" : "Adjustment (+/-)"}</span><input type="number" value={roundingAdjustment} onChange={(event) => setRoundingAdjustment(Number(event.target.value))} /></label><label className="field full"><span>{id ? "Alasan wajib" : "Required reason"}</span><textarea required minLength={5} value={roundingReason} onChange={(event) => setRoundingReason(event.target.value)} /></label></>}
              <div className="invoice-form-summary full"><span>{id ? "Subtotal BoQ" : "BoQ subtotal"}</span><strong>{formatCurrency(boqTotal, language)}</strong><small>{id ? "Urutan: subtotal − diskon + pajak ± pembulatan." : "Order: subtotal − discount + tax ± rounding."}</small></div>
              <div className="invoice-form-summary full"><span>{id ? "Perkiraan total tagihan klien" : "Estimated total billed to client"}</span><strong>{formatCurrency((() => {
                const previewDiscount = discountEnabled
                  ? discountType === "Percent"
                    ? Math.round((boqTotal * Math.min(10_000, discountValue)) / 10_000)
                    : Math.min(boqTotal, discountValue)
                  : 0;
                const previewBase = Math.max(0, boqTotal - previewDiscount);
                const beforeRounding = previewBase + (quotation?.taxAdditions ?? 0);
                const step = [1_000, 10_000, 100_000].includes(roundingStep) ? roundingStep : 0;
                const adjustment = roundingMode === "Custom"
                  ? roundingAdjustment
                  : roundingMode === "Up" && step > 0
                    ? Math.ceil(beforeRounding / step) * step - beforeRounding
                    : roundingMode === "Down" && step > 0
                      ? Math.floor(beforeRounding / step) * step - beforeRounding
                      : 0;
                return Math.max(0, beforeRounding + adjustment);
              })(), language)}</strong><small>{id ? "Termasuk pajak tersimpan; nilai final mengikuti aturan pajak yang dipilih." : "Includes stored tax; final value follows the selected tax rules."}</small></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowQuotationForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><Pencil size={16} /> {id ? "Simpan Quotation" : "Save Quotation"}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
