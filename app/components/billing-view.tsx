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
import { documentEmailKinds, type DocumentEmailKind } from "../../shared/document-email";
import { api, downloadApiFile, messageOf } from "../api-client";
import { BankAccount, BoqItem, CommercialPackage, formatCurrency, Invoice, Project } from "../data";
import { type AppLanguage, localizedDate, localizedLabel } from "../i18n";
import { appPath } from "../paths";
import { DocumentTaxEditor } from "./document-tax-editor";
import { CommercialPackageSwitcher } from "./commercial-package-switcher";
import { DocumentEmailDialog, type DocumentEmailTarget } from "./document-email-dialog";
import { DocumentPreviewModal } from "./document-preview-modal";
import { DocumentTemplateManager } from "./document-template-manager";

interface BillingViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projectId: string;
  canManage: boolean;
  canManagePayments: boolean;
  canManageTaxes: boolean;
  canManageValidity: boolean;
  onOpenProject?: () => void;
}

type BillingTab = "quotation" | "invoice" | "templates";

const billingTemplateKinds = ["quotation", "invoice"] as const satisfies readonly DocumentEmailKind[];

function isDocumentEmailKind(value: unknown): value is DocumentEmailKind {
  return typeof value === "string" && (documentEmailKinds as readonly string[]).includes(value);
}

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

interface QuotationRevision {
  id: string;
  number: string;
  revisionNo: number;
  status: Quotation["status"];
  total: number;
  grandTotal: number;
  issuedAt: string;
  createdAt: string;
  supersedesId: string | null;
}

function discountInputFromQuotation(data: Quotation) {
  const value = data.discountValue ?? 0;
  if (!value) return "";
  if ((data.discountType ?? "Nominal") === "Percent") {
    const percent = value / 100;
    return Number.isInteger(percent) ? String(percent) : String(percent).replace(".", ",");
  }
  return String(value);
}

function parseDiscountInput(type: "Nominal" | "Percent", raw: string) {
  if (!raw.trim()) return 0;
  const numeric = Number(raw.replace(",", "."));
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return type === "Percent" ? Math.min(10_000, Math.round(numeric * 100)) : Math.round(numeric);
}

function parseRoundingAdjustment(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function roundingInputFromQuotation(data: Quotation) {
  return data.roundingMode === "Custom" && (data.roundingAdjustment ?? 0) !== 0
    ? String(data.roundingAdjustment)
    : "";
}

const quotationStatusBadge: Record<string, string> = {
  Accepted: "success",
  Sent: "info",
  Rejected: "danger",
  Void: "danger",
  Superseded: "neutral",
  Draft: "warning",
};

function quotationStatusLabel(id: boolean, status: string) {
  if (!id) return status;
  const labels: Record<string, string> = {
    Draft: "Draft",
    Sent: "Terkirim",
    Accepted: "Diterima",
    Rejected: "Ditolak",
    Void: "Batal",
    Superseded: "Digantikan",
  };
  return labels[status] ?? status;
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
  onOpenProject,
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
  const [showAcceptForm, setShowAcceptForm] = useState(false);
  const [acceptDate, setAcceptDate] = useState("");
  const [acceptFile, setAcceptFile] = useState<File | null>(null);
  const [acceptSaving, setAcceptSaving] = useState(false);
  const [quotationIssuedAt, setQuotationIssuedAt] = useState("");
  const [quotationValidUntil, setQuotationValidUntil] = useState("");
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<"Nominal" | "Percent">("Nominal");
  const [discountValueInput, setDiscountValueInput] = useState("");
  const [roundingMode, setRoundingMode] = useState<"None" | "Up" | "Down" | "Custom">("None");
  const [roundingStep, setRoundingStep] = useState(0);
  const [roundingAdjustmentInput, setRoundingAdjustmentInput] = useState("");
  const [roundingReason, setRoundingReason] = useState("");
  const [quotationHistory, setQuotationHistory] = useState<QuotationRevision[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
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
  const [emailTarget, setEmailTarget] = useState<DocumentEmailTarget | null>(null);
  const [templateViewableKinds, setTemplateViewableKinds] = useState<DocumentEmailKind[]>([]);
  const [templateAvailabilityReady, setTemplateAvailabilityReady] = useState(false);
  const [templateManagerKind, setTemplateManagerKind] = useState<DocumentEmailKind>("quotation");

  const selectPackage = useCallback((nextPackageId: string, nextPackages: CommercialPackage[]) => {
    void nextPackages;
    setPackageId(nextPackageId);
  }, []);

  useEffect(() => {
    let active = true;
    api<{ viewableKinds?: unknown }>("/api/document-email-templates")
      .then((data) => {
        if (!active) return;
        const nextKinds = Array.isArray(data.viewableKinds)
          ? data.viewableKinds.filter(isDocumentEmailKind)
          : [];
        setTemplateViewableKinds(nextKinds);
      })
      .catch(() => {
        if (!active) return;
        setTemplateViewableKinds([]);
      })
      .finally(() => {
        if (active) setTemplateAvailabilityReady(true);
      });
    return () => {
      active = false;
    };
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
      api<QuotationRevision[]>(`/api/quotations/history?projectId=${encodeURIComponent(projectId)}${packageQuery}`),
    ])
      .then(([invoiceData, boq, quotationData, projectData, historyData]) => {
        if (!active) return;
        setInvoices(invoiceData);
        setQuotationItems(boq.items);
        setQuotation(quotationData);
        setProject(projectData);
        setQuotationHistory(historyData);
        setQuotationIssuedAt(quotationData.issuedAt);
        setQuotationValidUntil(quotationData.validUntil ?? "");
        setDiscountEnabled(Boolean(quotationData.discountEnabled));
        setDiscountType(quotationData.discountType ?? "Nominal");
        setDiscountValueInput(discountInputFromQuotation(quotationData));
        setRoundingMode(quotationData.roundingMode ?? "None");
        setRoundingStep(quotationData.roundingStep ?? 0);
        setRoundingAdjustmentInput(roundingInputFromQuotation(quotationData));
        setRoundingReason(quotationData.roundingReason ?? "");
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify, packageId, projectId, reloadKey]);

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
  // Everything the rounding field is measured against: subtotal − discount +
  // add-effect tax, exactly as the server computes `beforeRounding`.
  const previewBeforeRounding = useMemo(() => {
    const previewDiscount = discountEnabled
      ? discountType === "Percent"
        ? Math.round((boqTotal * Math.min(10_000, parseDiscountInput("Percent", discountValueInput))) / 10_000)
        : Math.min(boqTotal, parseDiscountInput("Nominal", discountValueInput))
      : 0;
    return Math.max(0, boqTotal - previewDiscount) + (quotation?.taxAdditions ?? 0);
  }, [boqTotal, discountEnabled, discountType, discountValueInput, quotation?.taxAdditions]);
  // A custom adjustment is capped at the larger of Rp 100.000 — the coarsest
  // step the automatic modes can produce — and 1% of the pre-rounding total.
  // The server refuses anything beyond with ROUNDING_ADJUSTMENT_TOO_LARGE, so
  // the same arithmetic runs here and the boundary is stated on the field
  // rather than arriving as a rejection after Save. It is shown, never typed
  // over: clamping mid-keystroke would fight the keyboard.
  const customRoundingLimit = Math.max(100_000, Math.ceil(previewBeforeRounding / 100));
  const customRoundingOverLimit =
    roundingMode === "Custom" &&
    Math.abs(parseRoundingAdjustment(roundingAdjustmentInput)) > customRoundingLimit;
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
  // Everything past Draft has already left the office, so the delivery step is
  // complete and "Tandai sudah dikirim" is no longer an available transition —
  // on an Accepted quotation it could only return ACCEPTED_QUOTATION_LOCKED.
  const quotationSettled = ["Accepted", "Rejected", "Void", "Superseded"].includes(quotation?.status ?? "");
  const quotationDispatched = quotation?.status === "Sent" || quotationSettled;
  const quotationDeliveryTitle = quotation?.status === "Accepted"
    ? (id ? "Diterima klien" : "Accepted by the client")
    : quotation?.status === "Rejected"
      ? (id ? "Ditolak klien" : "Rejected by the client")
      : quotation?.status === "Void"
        ? (id ? "Dibatalkan" : "Voided")
        : quotation?.status === "Superseded"
          ? (id ? "Digantikan revisi baru" : "Superseded by a newer revision")
          : quotation?.status === "Sent"
            ? (id ? "Sudah dikirim" : "Sent")
            : (id ? "Menunggu dikirim" : "Awaiting delivery");
  const quotationDeliveryDetail = quotation?.status === "Accepted"
    ? (id ? "Nilai, pajak, dan pembulatan terkunci permanen" : "Value, tax, and rounding are permanently locked")
    : quotationSettled
      ? (id ? "Dokumen tidak dapat diubah lagi" : "This document can no longer be changed")
      : quotation?.status === "Sent"
        ? (id ? "Nilai terkunci sampai BoQ berubah" : "Value is locked until the BoQ changes")
        : (id ? "Periksa tanggal dan isi dokumen" : "Review dates and document content");
  const canViewClientTemplates = templateAvailabilityReady && billingTemplateKinds.some((kind) => templateViewableKinds.includes(kind));

  function setValidityDays(days: number) {
    if (!quotationIssuedAt) return;
    const base = new Date(`${quotationIssuedAt}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + days);
    setQuotationValidUntil(base.toISOString().slice(0, 10));
  }

  async function refreshQuotationHistory() {
    const history = await api<QuotationRevision[]>(
      `/api/quotations/history?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`,
    );
    setQuotationHistory(history);
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
    setDiscountValueInput(discountInputFromQuotation(updated));
    setRoundingMode(updated.roundingMode ?? "None");
    setRoundingStep(updated.roundingStep ?? 0);
    setRoundingAdjustmentInput(roundingInputFromQuotation(updated));
    setRoundingReason(updated.roundingReason ?? "");
    await refreshQuotationHistory();
    return updated;
  }

  async function refreshQuotation() {
    const updated = await api<Quotation>(`/api/quotations?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`);
    setQuotation(updated);
    await refreshQuotationHistory();
  }

  async function acceptQuotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quotation?.id || !acceptFile) return;
    setAcceptSaving(true);
    try {
      const attachment = await attachmentFromFile(acceptFile);
      await api(`/api/quotations/${encodeURIComponent(quotation.id)}/accept`, {
        method: "POST",
        body: JSON.stringify({ acceptedAt: acceptDate, attachment }),
      });
      setShowAcceptForm(false);
      setAcceptFile(null);
      setReloadKey((key) => key + 1);
      notify(id
        ? "Quotation diterima klien dan dikunci. Invoice termin siap dibuat."
        : "Quotation accepted and locked. Installment invoices can now be issued.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setAcceptSaving(false);
    }
  }

  async function deleteQuotation() {
    if (!quotation?.id) return;
    const label = quotation.number ?? "quotation";
    if (!window.confirm(`${id ? "Hapus quotation" : "Delete quotation"} ${label}?`)) return;
    try {
      await api(
        `/api/quotations?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`,
        { method: "DELETE" },
      );
      setReloadKey((key) => key + 1);
      notify(id ? "Quotation berhasil dihapus." : "Quotation deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
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
        discountValue: parseDiscountInput(discountType, discountValueInput),
        roundingMode,
        roundingStep,
        roundingAdjustment: roundingMode === "Custom" ? parseRoundingAdjustment(roundingAdjustmentInput) : 0,
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

  function openClientEmail(kind: "quotation" | "invoice", documentId: string, documentNumber: string) {
    if (!project) {
      notify(id ? "Konteks proyek belum selesai dimuat." : "The project context has not finished loading.");
      return;
    }
    setEmailTarget({
      kind,
      id: documentId,
      number: documentNumber,
      projectName: project.name,
      recipientName: project.clientContactName?.trim() || project.client,
      recipientEmail: project.clientEmail,
    });
  }

  function openTemplateManager(kind: DocumentEmailKind) {
    if (!billingTemplateKinds.some((candidate) => candidate === kind)) return;
    setEmailTarget(null);
    setTemplateManagerKind(kind);
    setActiveTab("templates");
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
        {canViewClientTemplates && (
          <button data-testid="billing-template-tab" role="tab" aria-selected={activeTab === "templates"} className={activeTab === "templates" ? "active" : ""} type="button" onClick={() => setActiveTab("templates")}>
            <Mail size={17} /> {id ? "Template surat" : "Letter templates"}
          </button>
        )}
      </div>

      {activeTab === "templates" && canViewClientTemplates && (
        <DocumentTemplateManager
          language={language}
          canManage={canManage}
          notify={notify}
          kinds={billingTemplateKinds}
          initialKind={templateManagerKind}
        />
      )}

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
                {canManage && quotation?.id && quotation.status === "Sent" && (
                  <button className="button primary small" type="button" onClick={() => { setAcceptDate(serverToday || new Date().toISOString().slice(0, 10)); setAcceptFile(null); setShowAcceptForm(true); }}>
                    <CircleCheck size={15} /> {id ? "Terima klien" : "Client accept"}
                  </button>
                )}
                {canManage && quotation?.id && ["Draft", "Sent", "Rejected"].includes(quotation.status) && (
                  <button className="button danger small" type="button" onClick={deleteQuotation}>
                    <Trash2 size={15} /> {id ? "Hapus" : "Delete"}
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
                {(quotation?.taxes ?? []).filter((tax) => tax.effect === "Withhold").map((tax) => <div key={`${tax.code}-${tax.amount}`}><span>{tax.code} · {id ? (tax.name ?? "Pajak potong") : (tax.nameEn ?? "Withholding tax")} <small>{id ? "(dipotong klien — tidak menambah tagihan)" : "(withheld by client — does not increase the bill)"}</small></span><strong>−{formatCurrency(tax.amount, language)}</strong></div>)}
                {(quotation?.roundingAdjustment ?? 0) !== 0 && <div><span>{id ? "Pembulatan" : "Rounding"}</span><strong>{(quotation?.roundingAdjustment ?? 0) > 0 ? "+" : ""}{formatCurrency(quotation?.roundingAdjustment ?? 0, language)}</strong></div>}
                <div className="grand"><span>{id ? "Total tagihan klien" : "Total billed to client"}</span><strong>{formatCurrency(quotationGrossTotal, language)}</strong></div>
                {(quotation?.taxWithholdings ?? 0) > 0 && <div className="net-cash"><span>{id ? "Kas bersih diterima" : "Net cash received"}</span><strong>{formatCurrency(quotation?.netCashDue ?? Math.max(0, quotationGrossTotal - (quotation?.taxWithholdings ?? 0)), language)}</strong></div>}
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
                <div className={quotationDispatched ? "done" : "active"}><span><Mail size={14} /></span><div><strong>{quotationDeliveryTitle}</strong><small>{quotationDeliveryDetail}</small></div></div>
              </div>
              {canManage && !quotationSettled && (
                <button className="button primary full-width" type="button" disabled={!quotationItems.length || quotationDispatched || quotationExpired} onClick={markQuotationSent}>
                  <Send size={16} /> {quotationDispatched ? (id ? "Sudah dikirim" : "Sent") : (id ? "Tandai sudah dikirim" : "Mark as sent")}
                </button>
              )}
              {quotation?.id && !quotationSettled && (
                <button className="button secondary full-width" type="button" disabled={quotationExpired} onClick={() => openClientEmail("quotation", quotation.id ?? "", quotation.number ?? "Quotation")}>
                  <Mail size={16} /> {quotation.status === "Sent" ? (id ? "Kirim ulang email" : "Resend email") : (id ? "Kirim email ke klien" : "Email quotation to client")}
                </button>
              )}
              {quotation?.id && (
                <button className="button subtle full-width" type="button" onClick={() => openClientEmail("quotation", quotation.id ?? "", quotation.number ?? "Quotation")}>
                  <Mail size={15} /> {id ? "Riwayat email" : "Email history"}
                </button>
              )}
            </section>
            <section className="panel">
              <details className="quotation-history">
                <summary>
                  <FileText size={15} /> {id ? "Riwayat revisi" : "Revision history"}
                  <span className="tab-count">{quotationHistory.length}</span>
                </summary>
                <div className="quotation-history-list">
                  {quotationHistory.map((revision) => (
                    <div className="quotation-history-row" key={revision.id}>
                      <span className="revision-badge">R{revision.revisionNo}</span>
                      <div>
                        <strong>{revision.number}</strong>
                        <small>{localizedDate(language, revision.issuedAt)}</small>
                      </div>
                      <span className={`status-badge ${quotationStatusBadge[revision.status] ?? "neutral"}`}>
                        {quotationStatusLabel(id, revision.status)}
                      </span>
                      <strong>{formatCurrency(revision.grandTotal, language)}</strong>
                    </div>
                  ))}
                  {!quotationHistory.length && (
                    <p className="quotation-history-empty">{id ? "Belum ada revisi tersimpan untuk paket ini." : "No saved revisions exist for this package yet."}</p>
                  )}
                </div>
              </details>
            </section>
          </aside>
        </section>
      )}

      {activeTab === "invoice" && (
        <div className="page-stack">
          <section className="metric-grid invoice-metrics">
            <article className="metric-card"><span className="metric-icon green"><CircleCheck size={20} /></span><div className="metric-main"><span>{id ? "Sudah diterima" : "Received"}</span><strong>{formatCurrency(paidTotal, language)}</strong></div><span className="metric-change positive">{quotationGrossTotal ? Math.round((paidTotal / quotationGrossTotal) * 100) : 0}% {id ? "dari tagihan bruto" : "of gross billing"}</span></article>
            <article className="metric-card"><span className="metric-icon orange"><Clock3 size={20} /></span><div className="metric-main"><span>{id ? "Belum dibayar" : "Outstanding"}</span><strong>{formatCurrency(outstanding, language)}</strong></div><span className="metric-change warning-text">{invoices.filter((invoice) => invoice.status !== "Lunas").length} {id ? "invoice aktif" : "active invoices"}</span></article>
            <article className="metric-card"><span className="metric-icon blue"><FileCheck2 size={20} /></span><div className="metric-main"><span>{id ? "Sisa dapat ditagihkan" : "Remaining billable"}</span><strong>{formatCurrency(Math.max(0, quotationGrossTotal - invoicedTotal), language)}</strong></div><span className="metric-change">{id ? "Dari" : "Of"} {formatCurrency(quotationGrossTotal, language)}</span></article>
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
                    <button className="button subtle small" type="button" onClick={() => openClientEmail("invoice", invoice.id, invoice.number)}><Mail size={15} /> {id ? "Email" : "Email"}</button>
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

      {showAcceptForm && quotation?.id && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAcceptForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">CLIENT ACCEPTANCE</span><h2>{quotation.number}</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowAcceptForm(false)} aria-label={id ? "Tutup" : "Close"}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={acceptQuotation}>
              <label className="field full"><span>{id ? "Tanggal persetujuan" : "Acceptance date"}</span><input required type="date" max={serverToday || undefined} value={acceptDate} onChange={(event) => setAcceptDate(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Bukti persetujuan (PDF/gambar)" : "Acceptance proof (PDF/image)"}</span><input required type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setAcceptFile(event.target.files?.[0] ?? null)} /></label>
              <p className="form-hint full">{id ? "Setelah diterima, diskon, pajak, dan pembulatan dikunci permanen. Perubahan berikutnya melalui Addendum." : "Once accepted, discount, tax, and rounding are locked. Later changes go through an Addendum."}</p>
              <div className="modal-actions full">
                <button className="button secondary" type="button" onClick={() => setShowAcceptForm(false)}>{id ? "Batal" : "Cancel"}</button>
                <button className="button primary" type="submit" disabled={acceptSaving || !acceptFile}><CircleCheck size={16} /> {id ? "Terima & kunci" : "Accept & lock"}</button>
              </div>
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

      {emailTarget && <DocumentEmailDialog
        target={emailTarget}
        language={language}
        canManage={canManage}
        canViewHistory
        onClose={() => setEmailTarget(null)}
        onOpenRecipient={onOpenProject ? () => { setEmailTarget(null); onOpenProject(); } : undefined}
        onOpenTemplateManager={openTemplateManager}
        onSent={async () => { setReloadKey((key) => key + 1); }}
      />}

      {showQuotationForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowQuotationForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="quotation-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">EDIT QUOTATION</span><h2 id="quotation-form-title">{id ? "Tanggal dan masa berlaku" : "Dates and validity"}</h2></div><button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowQuotationForm(false)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={saveQuotation}>
              <label className="field full"><span>{id ? "Tanggal terbit" : "Issue date"}</span><input required type="date" value={quotationIssuedAt} onChange={(event) => setQuotationIssuedAt(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Berlaku sampai" : "Valid until"}</span><input required type="date" value={quotationValidUntil} onChange={(event) => setQuotationValidUntil(event.target.value)} /></label>
              <div className="field full"><span>{id ? "Pilihan cepat masa berlaku" : "Quick validity"}</span><div className="title-actions">{[7, 14, 30, 60].map((days) => <button className="button subtle small" type="button" key={days} onClick={() => setValidityDays(days)}>{days} {id ? "hari" : "days"}</button>)}</div></div>
              <label className="field full check-field"><input type="checkbox" checked={discountEnabled} onChange={(event) => setDiscountEnabled(event.target.checked)} /><span>{id ? "Gunakan diskon" : "Apply discount"}</span></label>
              {discountEnabled && <><label className="field select-field"><span>{id ? "Jenis diskon" : "Discount type"}</span><select value={discountType} onChange={(event) => { setDiscountType(event.target.value as "Nominal" | "Percent"); setDiscountValueInput(""); }}><option value="Nominal">Nominal</option><option value="Percent">%</option></select><ChevronDown size={15} /></label><label className="field"><span>{discountType === "Percent" ? (id ? "Persen diskon (mis. 10 atau 12,5)" : "Discount percent (e.g. 10 or 12.5)") : (id ? "Nilai diskon" : "Discount amount")}</span><input type="text" inputMode="decimal" placeholder={discountType === "Percent" ? "10" : "1000000"} value={discountValueInput} onChange={(event) => { const raw = event.target.value; if (discountType === "Percent" ? /^\d{0,3}([.,]\d{0,2})?$/.test(raw) : /^\d*$/.test(raw)) setDiscountValueInput(raw); }} /></label></>}
              <label className="field select-field"><span>{id ? "Pembulatan" : "Rounding"}</span><select value={roundingMode} onChange={(event) => { const nextMode = event.target.value as typeof roundingMode; setRoundingMode(nextMode); setRoundingAdjustmentInput(""); }}><option value="None">{id ? "Tanpa pembulatan" : "No rounding"}</option><option value="Up">{id ? "Ke atas" : "Round up"}</option><option value="Down">{id ? "Ke bawah" : "Round down"}</option><option value="Custom">Custom</option></select><ChevronDown size={15} /></label>
              {roundingMode !== "None" && roundingMode !== "Custom" && <label className="field select-field"><span>{id ? "Kelipatan" : "Increment"}</span><select value={roundingStep} onChange={(event) => setRoundingStep(Number(event.target.value))}><option value={1000}>Rp1.000</option><option value={10000}>Rp10.000</option><option value={100000}>Rp100.000</option></select><ChevronDown size={15} /></label>}
              {roundingMode === "Custom" && <><label className="field"><span>{id ? "Penyesuaian (+/-)" : "Adjustment (+/-)"}</span><input type="text" inputMode="numeric" autoComplete="off" placeholder="0" pattern="-?[0-9]*" aria-describedby="quotation-rounding-limit" value={roundingAdjustmentInput} onChange={(event) => { const raw = event.target.value; if (/^-?\d*$/.test(raw)) setRoundingAdjustmentInput(raw); }} /></label><p className={`form-hint full${customRoundingOverLimit ? " attention" : ""}`} id="quotation-rounding-limit">{customRoundingOverLimit
                ? (id
                  ? `Melebihi batas. Pembulatan khusus maksimal ±${formatCurrency(customRoundingLimit, language)} untuk nilai ini; simpan akan ditolak. Perubahan harga yang lebih besar adalah diskon atau pajak.`
                  : `Over the limit. A custom rounding may move this value by at most ±${formatCurrency(customRoundingLimit, language)}; saving will be refused. A larger change to the price is a discount or a tax.`)
                : (id
                  ? `Pembulatan khusus maksimal ±${formatCurrency(customRoundingLimit, language)} untuk nilai ini — mana yang lebih besar antara Rp 100.000 dan 1% dari nilai sebelum pembulatan. Gunakan kolom diskon atau pajak untuk perubahan harga yang lebih besar.`
                  : `A custom rounding may move this value by at most ±${formatCurrency(customRoundingLimit, language)} — the larger of Rp 100,000 and 1% of the value before rounding. Use the discount or tax fields for a larger change to the price.`)}</p><label className="field full"><span>{id ? "Alasan wajib" : "Required reason"}</span><textarea required minLength={5} value={roundingReason} onChange={(event) => setRoundingReason(event.target.value)} /></label></>}
              <div className="invoice-form-summary full"><span>{id ? "Subtotal BoQ" : "BoQ subtotal"}</span><strong>{formatCurrency(boqTotal, language)}</strong><small>{id ? "Urutan: subtotal − diskon + pajak ± pembulatan." : "Order: subtotal − discount + tax ± rounding."}</small></div>
              <div className="invoice-form-summary full"><span>{id ? "Perkiraan total tagihan klien" : "Estimated total billed to client"}</span><strong>{formatCurrency((() => {
                const beforeRounding = previewBeforeRounding;
                const step = [1_000, 10_000, 100_000].includes(roundingStep) ? roundingStep : 0;
                // Mirrors the server clamp so the preview shows what would
                // actually be stored, not what was typed past the cap.
                const adjustment = roundingMode === "Custom"
                  ? Math.max(-customRoundingLimit, Math.min(customRoundingLimit, parseRoundingAdjustment(roundingAdjustmentInput)))
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
