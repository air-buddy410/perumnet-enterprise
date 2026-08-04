"use client";

import {
  AlertTriangle,
  BanknoteArrowDown,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  ImagePlus,
  Landmark,
  LoaderCircle,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  UploadCloud,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiClientError,
  downloadApiFile,
  messageOf,
} from "../api-client";
import {
  BankAccount,
  formatCurrency,
  Project,
  ProjectAdvance,
  ProjectExpense,
  ProjectExpenseCategory,
} from "../data";
import { AppLanguage, localizedDate, localizedTimestamp } from "../i18n";
import { appPath } from "../paths";

interface Props {
  language: AppLanguage;
  notify: (message: string) => void;
  projectId?: string;
  projects: Project[];
  userId: string;
  userRole: string;
  canCreate: boolean;
  canReview: boolean;
}

interface EligibleUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface PayerOption {
  id: string;
  name: string;
  role: string;
}

interface AdvanceContext {
  users: EligibleUser[];
  invoiceCashReceived: number;
  outstandingAdvance: number;
}

const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function workflowLabel(language: AppLanguage, value: ProjectExpense["workflowStatus"]) {
  const labels: Record<ProjectExpense["workflowStatus"], [string, string]> = {
    Draft: ["Draft", "Draft"],
    Submitted: ["Menunggu Verifikasi", "Awaiting Verification"],
    Approved: ["Disetujui", "Approved"],
    Rejected: ["Ditolak", "Rejected"],
    Void: ["Dibatalkan", "Void"],
  };
  return labels[value][language === "id" ? 0 : 1];
}

function settlementLabel(language: AppLanguage, value: ProjectExpense["settlementStatus"]) {
  const labels: Record<ProjectExpense["settlementStatus"], [string, string]> = {
    Unposted: ["Belum diposting", "Not posted"],
    Posted: ["Kas tercatat", "Cash posted"],
    AwaitingReimbursement: ["Menunggu reimbursement", "Awaiting reimbursement"],
    PartiallyReimbursed: ["Dibayar sebagian", "Partially reimbursed"],
    Reimbursed: ["Reimbursement lunas", "Reimbursed"],
    AdvanceSettled: ["Dibebankan ke uang muka", "Allocated to advance"],
    Void: ["Dibatalkan", "Void"],
  };
  return labels[value][language === "id" ? 0 : 1];
}

function fundingLabel(language: AppLanguage, value: ProjectExpense["fundingSource"]) {
  const labels: Record<ProjectExpense["fundingSource"], [string, string]> = {
    CompanyAccount: ["Rekening perusahaan", "Company account"],
    ProjectAdvance: ["Uang muka proyek", "Project advance"],
    EmployeePaid: ["Uang pribadi pegawai", "Employee paid"],
  };
  return labels[value][language === "id" ? 0 : 1];
}

function paymentMethodLabel(language: AppLanguage, value: ProjectExpense["paymentMethod"]) {
  const labels: Record<ProjectExpense["paymentMethod"], [string, string]> = {
    Tunai: ["Tunai", "Cash"],
    QRIS: ["QRIS", "QRIS"],
    "Transfer Bank": ["Transfer bank", "Bank transfer"],
  };
  return labels[value]?.[language === "id" ? 0 : 1] ?? value;
}

const advanceUnavailableNote: [string, string] = [
  "Belum ada uang muka aktif untuk proyek ini. Cairkan uang muka melalui menu Uang Muka terlebih dahulu.",
  "This project has no active advance yet. Disburse an advance from the Advance menu first.",
];

function statusTone(status: ProjectExpense["workflowStatus"]) {
  if (status === "Approved") return "success";
  if (status === "Submitted") return "warning";
  if (status === "Rejected" || status === "Void") return "danger";
  return "neutral";
}

function StatusBadge({ language, status }: { language: AppLanguage; status: ProjectExpense["workflowStatus"] }) {
  return <span className={`status-badge ${statusTone(status)}`}><span className="badge-dot" />{workflowLabel(language, status)}</span>;
}

export function ProjectExpenseView({
  language,
  notify,
  projectId,
  projects,
  userId,
  userRole,
  canCreate,
  canReview,
}: Props) {
  const id = language === "id";
  const [expenses, setExpenses] = useState<ProjectExpense[]>([]);
  const [categories, setCategories] = useState<ProjectExpenseCategory[]>([]);
  const [advances, setAdvances] = useState<ProjectAdvance[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selected, setSelected] = useState<ProjectExpense | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [formOpen, setFormOpen] = useState(!canReview);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectExpense | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [expenseProjectId, setExpenseProjectId] = useState(projectId ?? projects[0]?.id ?? "");
  const [purchaseDate, setPurchaseDate] = useState(localDate());
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [fundingSource, setFundingSource] = useState<ProjectExpense["fundingSource"]>("CompanyAccount");
  const [paymentMethod, setPaymentMethod] = useState<ProjectExpense["paymentMethod"]>("Tunai");
  const [expenseBankId, setExpenseBankId] = useState("");
  const [paidByUserId, setPaidByUserId] = useState(userId);
  const [payerOptions, setPayerOptions] = useState<PayerOption[]>([]);
  const [notes, setNotes] = useState("");
  const [settlementDate, setSettlementDate] = useState(localDate());
  const [reviewBankId, setReviewBankId] = useState("");
  const [reviewAdvanceId, setReviewAdvanceId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [selfApprovalReason, setSelfApprovalReason] = useState("");
  const [reimburseAmount, setReimburseAmount] = useState(0);
  const [categoryName, setCategoryName] = useState("");
  const [categoryNameEn, setCategoryNameEn] = useState("");
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [advanceInvoiceCash, setAdvanceInvoiceCash] = useState(0);
  const [advanceProjectId, setAdvanceProjectId] = useState(projectId ?? projects[0]?.id ?? "");
  const [advanceRecipientId, setAdvanceRecipientId] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [advanceReference, setAdvanceReference] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const [expenseData, categoryData, advanceData] = await Promise.all([
        api<ProjectExpense[]>(`/api/project-expenses${suffix}`),
        api<ProjectExpenseCategory[]>("/api/project-expense-categories"),
        api<ProjectAdvance[]>(`/api/project-advances${suffix}`),
      ]);
      setExpenses(expenseData);
      setCategories(categoryData);
      setAdvances(advanceData);
      setCategoryId((current) => current || categoryData.find((item) => item.status === "Aktif")?.id || "");
      // Only Admin and Finance may list company accounts, so anyone else keeps
      // an empty list and the bank-transfer option explains itself inline.
      const accounts = canReview || canCreate
        ? await api<BankAccount[]>("/api/bank-accounts").catch(() => [] as BankAccount[])
        : [];
      const activeAccounts = accounts.filter((item) => item.status === "Aktif");
      setBankAccounts(activeAccounts);
      setReviewBankId((current) => current || activeAccounts[0]?.id || "");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setLoading(false);
    }
  }, [canCreate, canReview, language, notify, projectId]);

  useEffect(() => {
    // Data loading is intentionally tied to the active project and permission scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    if (projectId) {
      // Keep both forms synchronized when the workspace changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpenseProjectId(projectId);
      setAdvanceProjectId(projectId);
    }
  }, [projectId]);

  const filtered = useMemo(() => expenses.filter((expense) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || [expense.number, expense.merchant, expense.projectName, expense.creatorName]
      .some((value) => value.toLowerCase().includes(needle));
    return matchesQuery && (statusFilter === "All" || expense.workflowStatus === statusFilter);
  }), [expenses, query, statusFilter]);

  const outstandingAdvanceFor = useCallback(
    (targetProjectId: string) => advances
      .filter((advance) => advance.projectId === targetProjectId && advance.status === "Open")
      .reduce((sum, advance) => sum + advance.outstanding, 0),
    [advances],
  );
  const advanceAvailable = outstandingAdvanceFor(expenseProjectId) > 0;

  const stats = useMemo(() => ({
    submitted: expenses.filter((item) => item.workflowStatus === "Submitted").length,
    approved: expenses.filter((item) => item.workflowStatus === "Approved").reduce((sum, item) => sum + item.totalAmount, 0),
    reimbursement: expenses.reduce((sum, item) => sum + item.reimbursementOutstanding, 0),
    advances: advances.filter((item) => item.status === "Open").reduce((sum, item) => sum + item.outstanding, 0),
  }), [advances, expenses]);

  function resetForm() {
    setEditing(null);
    setPurchaseDate(localDate());
    setMerchant("");
    setTotalAmount(0);
    setFundingSource("CompanyAccount");
    setPaymentMethod("Tunai");
    setExpenseBankId("");
    setPaidByUserId(userId);
    setNotes("");
    setFiles([]);
  }

  function openCaptureForm() {
    resetForm();
    setFormOpen(true);
    window.setTimeout(() => {
      document.querySelector(".expense-capture-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 40);
  }

  function editExpense(expense: ProjectExpense) {
    setEditing(expense);
    setExpenseProjectId(expense.projectId);
    setPurchaseDate(expense.purchaseDate);
    setMerchant(expense.merchant);
    setCategoryId(expense.categoryId);
    setTotalAmount(expense.totalAmount);
    setFundingSource(expense.fundingSource);
    setPaymentMethod(expense.paymentMethod);
    setExpenseBankId(expense.bankAccountId ?? "");
    setPaidByUserId(expense.paidByUserId || expense.createdBy);
    setNotes(expense.notes);
    setFiles([]);
    setFormOpen(true);
  }

  async function submitExpense(event: FormEvent) {
    event.preventDefault();
    if (!editing && files.length === 0) {
      notify(id ? "Unggah minimal satu nota atau invoice." : "Upload at least one receipt or invoice.");
      return;
    }
    if (files.length > 5 || files.some((file) => file.size > 10 * 1024 * 1024)) {
      notify(id ? "Maksimal lima file dan 10 MB per file." : "Maximum five files and 10 MB per file.");
      return;
    }
    if (fundingSource === "CompanyAccount" && paymentMethod === "Transfer Bank" && !expenseBankId) {
      notify(id
        ? "Pilih rekening perusahaan untuk belanja yang dibayar lewat transfer bank."
        : "Select an active company account for a purchase paid by bank transfer.");
      return;
    }
    if (fundingSource === "ProjectAdvance" && !advanceAvailable) {
      notify(advanceUnavailableNote[id ? 0 : 1]);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        projectId: expenseProjectId,
        purchaseDate,
        merchant,
        categoryId,
        totalAmount: Math.round(totalAmount),
        fundingSource,
        paymentMethod,
        bankAccountId:
          fundingSource === "CompanyAccount" && expenseBankId ? expenseBankId : undefined,
        paidByUserId:
          fundingSource === "EmployeePaid" ? paidByUserId || userId : undefined,
        notes,
        itemDetails: [],
      };
      const draft = editing
        ? await api<ProjectExpense>(`/api/project-expenses/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<ProjectExpense>("/api/project-expenses", { method: "POST", body: JSON.stringify(payload) });
      for (const file of files) {
        const body = new FormData();
        body.set("file", file);
        body.set("kind", file.type === "application/pdf" ? "Invoice" : "Receipt");
        await api(`/api/project-expenses/${draft.id}/attachments`, { method: "POST", body });
      }
      try {
        await api(`/api/project-expenses/${draft.id}/submit`, {
          method: "POST",
          body: JSON.stringify({ duplicateAcknowledged: false }),
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "POSSIBLE_DUPLICATE") {
          const confirmed = window.confirm(id
            ? "Ada pengajuan atau pembayaran dengan tanggal dan nominal serupa. Tetap kirim setelah Anda memastikan nota ini berbeda?"
            : "A submission or payment has a similar date and amount. Submit after confirming this is a different receipt?");
          if (!confirmed) throw error;
          await api(`/api/project-expenses/${draft.id}/submit`, {
            method: "POST",
            body: JSON.stringify({ duplicateAcknowledged: true }),
          });
        } else throw error;
      }
      notify(id ? "Belanja dikirim ke Finance untuk diverifikasi." : "Expense sent to Finance for verification.");
      resetForm();
      setFormOpen(!canReview);
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(expense: ProjectExpense) {
    try {
      const detail = await api<ProjectExpense>(`/api/project-expenses/${expense.id}`);
      setSelected(detail);
      setReviewOpen(true);
      setReviewAdvanceId(detail.advanceId ?? advances.find((advance) => advance.projectId === detail.projectId && advance.status === "Open")?.id ?? "");
      setReimburseAmount(detail.reimbursementOutstanding);
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteDraft(expense: ProjectExpense) {
    if (!window.confirm(id ? `Hapus ${expense.number}?` : `Delete ${expense.number}?`)) return;
    setBusy(true);
    try {
      await api(`/api/project-expenses/${expense.id}`, { method: "DELETE" });
      notify(id ? "Draft dihapus." : "Draft deleted.");
      await load();
    } catch (error) { notify(messageOf(error, language)); }
    finally { setBusy(false); }
  }

  async function review(action: "approve" | "reject" | "void") {
    if (!selected) return;
    setBusy(true);
    try {
      if (action === "approve") {
        await api(`/api/project-expenses/${selected.id}/approve`, {
          method: "POST",
          body: JSON.stringify({
            settlementDate,
            bankAccountId: selected.fundingSource === "CompanyAccount" ? reviewBankId : undefined,
            advanceId: selected.fundingSource === "ProjectAdvance" ? reviewAdvanceId : undefined,
            paymentReference,
            duplicateAcknowledged: true,
            selfApprovalReason,
          }),
        });
      } else {
        await api(`/api/project-expenses/${selected.id}/${action}`, {
          method: "POST",
          body: JSON.stringify({ reason: reviewReason }),
        });
      }
      notify(action === "approve"
        ? (id ? "Belanja disetujui dan posisi keuangan diperbarui." : "Expense approved and financial position updated.")
        : (id ? "Status pengajuan diperbarui." : "Submission status updated."));
      setReviewOpen(false);
      setSelected(null);
      setReviewReason("");
      setPaymentReference("");
      setSelfApprovalReason("");
      await load();
    } catch (error) { notify(messageOf(error, language)); }
    finally { setBusy(false); }
  }

  async function reimburse() {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/project-expenses/${selected.id}/reimburse`, {
        method: "POST",
        body: JSON.stringify({ amount: Math.round(reimburseAmount), settlementDate, bankAccountId: reviewBankId, paymentReference }),
      });
      notify(id ? "Pembayaran reimbursement dicatat." : "Reimbursement payment recorded.");
      const detail = await api<ProjectExpense>(`/api/project-expenses/${selected.id}`);
      setSelected(detail);
      setReimburseAmount(detail.reimbursementOutstanding);
      await load();
    } catch (error) { notify(messageOf(error, language)); }
    finally { setBusy(false); }
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/project-expense-categories", { method: "POST", body: JSON.stringify({ name: categoryName, nameEn: categoryNameEn, status: "Aktif", sortOrder: categories.length + 1 }) });
      setCategoryName(""); setCategoryNameEn("");
      await load();
      notify(id ? "Kategori biaya ditambahkan." : "Expense category added.");
    } catch (error) { notify(messageOf(error, language)); }
    finally { setBusy(false); }
  }

  async function toggleCategory(category: ProjectExpenseCategory) {
    setBusy(true);
    try {
      await api(`/api/project-expense-categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ status: category.status === "Aktif" ? "Nonaktif" : "Aktif" }) });
      await load();
    } catch (error) { notify(messageOf(error, language)); }
    finally { setBusy(false); }
  }

  const loadEligible = useCallback(async (targetProjectId: string) => {
    if (!targetProjectId) return;
    try {
      const context = await api<AdvanceContext>(`/api/project-advances/eligible-users?projectId=${encodeURIComponent(targetProjectId)}`);
      setEligibleUsers(context.users);
      setAdvanceInvoiceCash(context.invoiceCashReceived);
      setAdvanceRecipientId((current) => context.users.some((person) => person.id === current) ? current : context.users[0]?.id ?? "");
    } catch (error) { notify(messageOf(error, language)); }
  }, [language, notify]);

  useEffect(() => {
    if (advanceOpen) {
      // Member choices depend on the project selected in the modal.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadEligible(advanceProjectId);
    }
  }, [advanceOpen, advanceProjectId, loadEligible]);

  const loadPayers = useCallback(async (targetProjectId: string) => {
    if (!targetProjectId) return;
    try {
      const people = await api<PayerOption[]>(`/api/project-expenses/payers?projectId=${encodeURIComponent(targetProjectId)}`);
      setPayerOptions(people);
      setPaidByUserId((current) => people.some((person) => person.id === current)
        ? current
        : people.some((person) => person.id === userId) ? userId : people[0]?.id ?? "");
    } catch {
      // Without the member list the submitter stays the personal-funds owner.
      setPayerOptions([]);
    }
  }, [userId]);

  useEffect(() => {
    if (formOpen && canCreate) {
      // Personal-funds owners depend on the project chosen in the capture form.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadPayers(expenseProjectId);
    }
  }, [canCreate, expenseProjectId, formOpen, loadPayers]);

  async function createAdvance(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/project-advances", { method: "POST", body: JSON.stringify({
        projectId: advanceProjectId,
        recipientUserId: advanceRecipientId,
        amount: Math.round(advanceAmount),
        disbursedDate: settlementDate,
        bankAccountId: reviewBankId,
        paymentReference: advanceReference,
        notes: "",
      }) });
      setAdvanceOpen(false); setAdvanceAmount(0); setAdvanceReference("");
      await load();
      notify(id ? "Uang muka dicairkan dan kas keluar dicatat." : "Advance disbursed and cash outflow recorded.");
    } catch (error) { notify(messageOf(error, language)); }
    finally { setBusy(false); }
  }

  return (
    <div className="expense-page">
      <section className="expense-hero panel">
        <div>
          <span className="eyebrow"><ReceiptText size={15} />{id ? "BELANJA LAPANGAN" : "FIELD EXPENSES"}</span>
          <h1>{id ? "Nota rapi, arus kas tetap terkendali." : "Clear receipts, controlled cash flow."}</h1>
          <p>{id ? "Simpan bukti belanja per proyek. Finance memverifikasi sumber dana sebelum transaksi masuk pembukuan." : "Keep project purchase evidence. Finance verifies the funding source before anything enters the ledger."}</p>
        </div>
        <div className="expense-hero-actions">
          {canReview && <button className="button secondary" type="button" onClick={() => setCategoryOpen(true)}><Settings2 size={16} />{id ? "Kategori" : "Categories"}</button>}
          {canReview && <button className="button secondary" type="button" onClick={() => setAdvanceOpen(true)}><WalletCards size={16} />{id ? "Uang muka" : "Advance"}</button>}
          {canCreate && <button className="button primary" type="button" onClick={openCaptureForm}><Plus size={17} />{id ? "Catat belanja" : "Record expense"}</button>}
        </div>
      </section>

      {canReview && <section className="expense-kpis">
        <article><span><AlertTriangle size={18} /></span><div><strong>{stats.submitted}</strong><small>{id ? "Menunggu verifikasi" : "Awaiting verification"}</small></div></article>
        <article><span><CheckCircle2 size={18} /></span><div><strong>{formatCurrency(stats.approved, language)}</strong><small>{id ? "Belanja disetujui" : "Approved expenses"}</small></div></article>
        <article><span><BanknoteArrowDown size={18} /></span><div><strong>{formatCurrency(stats.reimbursement, language)}</strong><small>{id ? "Utang reimbursement" : "Reimbursement payable"}</small></div></article>
        <article><span><WalletCards size={18} /></span><div><strong>{formatCurrency(stats.advances, language)}</strong><small>{id ? "Uang muka terbuka" : "Open advances"}</small></div></article>
      </section>}

      {formOpen && canCreate && <section className="panel expense-capture-panel">
        <div className="expense-capture-copy">
          <span className="eyebrow"><ImagePlus size={15} />{editing ? (id ? "PERBAIKI PENGAJUAN" : "EDIT SUBMISSION") : (id ? "BUKTI BELANJA BARU" : "NEW PURCHASE EVIDENCE")}</span>
          <h2>{id ? "Unggah nota, isi data pentingnya." : "Upload the receipt and enter its essentials."}</h2>
          <p>{id ? "Foto dari kamera, galeri, atau PDF invoice. Maksimal lima file, masing-masing 10 MB." : "Use camera photos, gallery images, or PDF invoices. Up to five files, 10 MB each."}</p>
          <label className="expense-upload-zone">
            <UploadCloud size={28} />
            <strong>{id ? "Pilih nota atau invoice" : "Choose receipt or invoice"}</strong>
            <small>JPG, PNG, WebP, PDF · 10 MB</small>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 5))} />
          </label>
          {files.length > 0 && <div className="expense-file-list">{files.map((file) => <span key={`${file.name}-${file.size}`}><FileText size={14} />{file.name}<small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span>)}</div>}
        </div>
        <form className="expense-quick-form" onSubmit={submitExpense}>
          <div className="form-grid">
            <label className="field full"><span>{id ? "Proyek" : "Project"}</span><select required value={expenseProjectId} onChange={(event) => { const next = event.target.value; setExpenseProjectId(next); if (fundingSource === "ProjectAdvance" && outstandingAdvanceFor(next) <= 0) setFundingSource("CompanyAccount"); }} disabled={Boolean(projectId)}><option value="">{id ? "Pilih proyek" : "Select project"}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label>
            <label className="field"><span>{id ? "Tanggal belanja" : "Purchase date"}</span><input required type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></label>
            <label className="field"><span>{id ? "Nama toko / vendor" : "Merchant / vendor"}</span><input required value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder={id ? "Contoh: Toko Sinar Abadi" : "Example: Sinar Abadi Store"} /></label>
            <label className="field"><span>{id ? "Kategori biaya" : "Expense category"}</span><select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.filter((item) => item.status === "Aktif").map((category) => <option key={category.id} value={category.id}>{id ? category.name : category.nameEn}</option>)}</select></label>
            <label className="field"><span>{id ? "Total (IDR)" : "Total (IDR)"}</span><input required min={1} type="number" value={totalAmount || ""} onChange={(event) => setTotalAmount(Number(event.target.value))} placeholder="0" /></label>
            <label className="field"><span>{id ? "Sumber dana" : "Funding source"}</span><select value={fundingSource} onChange={(event) => setFundingSource(event.target.value as ProjectExpense["fundingSource"])}><option value="CompanyAccount">{fundingLabel(language, "CompanyAccount")}</option><option value="ProjectAdvance" disabled={!advanceAvailable}>{fundingLabel(language, "ProjectAdvance")}</option><option value="EmployeePaid">{fundingLabel(language, "EmployeePaid")}</option></select></label>
            <label className="field"><span>{id ? "Metode pembayaran" : "Payment method"}</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as ProjectExpense["paymentMethod"])}><option value="Tunai">{paymentMethodLabel(language, "Tunai")}</option><option value="QRIS">{paymentMethodLabel(language, "QRIS")}</option><option value="Transfer Bank">{paymentMethodLabel(language, "Transfer Bank")}</option></select></label>
            {!advanceAvailable && <p className="form-hint full">{advanceUnavailableNote[id ? 0 : 1]}</p>}
            {fundingSource === "CompanyAccount" && paymentMethod === "Transfer Bank" && <label className="field full"><span>{id ? "Rekening perusahaan" : "Company account"}</span><select required value={expenseBankId} onChange={(event) => setExpenseBankId(event.target.value)} disabled={bankAccounts.length === 0}><option value="">{id ? "Pilih rekening" : "Select account"}</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} {account.accountNumberMasked}</option>)}</select></label>}
            {fundingSource === "CompanyAccount" && paymentMethod === "Transfer Bank" && bankAccounts.length === 0 && <p className="form-hint full">{id ? "Daftar rekening perusahaan hanya dapat dibuka Admin atau Finance. Pilih Tunai atau QRIS, atau minta Finance yang mencatat belanja ini." : "Only Admin or Finance can list company accounts. Choose Cash or QRIS, or ask Finance to record this purchase."}</p>}
            {fundingSource === "EmployeePaid" && <label className="field full"><span>{id ? "Dana pribadi milik" : "Personal funds owner"}</span><select value={paidByUserId} onChange={(event) => setPaidByUserId(event.target.value)}>{payerOptions.length === 0 && <option value={userId}>{id ? "Saya sendiri" : "Myself"}</option>}{payerOptions.map((person) => <option key={person.id} value={person.id}>{person.name}{person.id === userId ? id ? " · saya" : " · me" : ` · ${person.role}`}</option>)}</select></label>}
            {fundingSource === "EmployeePaid" && <p className="form-hint full">{id ? "Utang reimbursement dicatat atas nama orang ini, bukan otomatis atas nama pengaju." : "The reimbursement payable is recorded for this person, not automatically for the submitter."}</p>}
            <label className="field full"><span>{id ? "Catatan (opsional)" : "Notes (optional)"}</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={id ? "Keperluan pembelian atau detail tambahan" : "Purchase purpose or additional details"} /></label>
          </div>
          <div className="expense-form-actions"><button className="button secondary" type="button" onClick={() => { resetForm(); setFormOpen(false); }}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />}{id ? "Kirim ke Finance" : "Send to Finance"}</button></div>
        </form>
      </section>}

      <section className="panel expense-list-panel">
        <header className="panel-head">
          <div><span className="eyebrow">{canReview ? (id ? "ANTREAN VERIFIKASI" : "VERIFICATION QUEUE") : (id ? "RIWAYAT SAYA" : "MY HISTORY")}</span><h2>{id ? "Belanja proyek" : "Project expenses"}</h2></div>
          <div className="expense-list-actions"><div className="search-field compact"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari nota, toko, proyek..." : "Search receipt, merchant, project..."} /></div><select className="expense-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="All">{id ? "Semua status" : "All statuses"}</option>{["Submitted", "Draft", "Approved", "Rejected", "Void"].map((status) => <option key={status} value={status}>{workflowLabel(language, status as ProjectExpense["workflowStatus"])}</option>)}</select><button className="icon-button" title="CSV" type="button" onClick={() => void downloadApiFile(`/api/project-expenses/report.csv${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, "Belanja-Proyek.csv")}><Download size={16} /></button><button className="icon-button" title="PDF" type="button" onClick={() => void downloadApiFile(`/api/project-expenses/report.pdf${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, "Belanja-Proyek.pdf")}><FileText size={16} /></button></div>
        </header>
        {loading ? <div className="expense-loading"><LoaderCircle className="spin" size={23} />{id ? "Memuat belanja..." : "Loading expenses..."}</div> : filtered.length === 0 ? <div className="empty-state compact"><ReceiptText size={28} /><strong>{id ? "Belum ada catatan belanja" : "No expense records yet"}</strong><small>{id ? "Pengajuan yang dibuat akan tampil di sini." : "Submitted expenses will appear here."}</small></div> : <div className="expense-table-wrap"><div className="expense-table expense-table-head"><span>{id ? "Nota & proyek" : "Receipt & project"}</span><span>{id ? "Tanggal / toko" : "Date / merchant"}</span><span>{id ? "Pengaju" : "Submitter"}</span><span>{id ? "Sumber dana" : "Funding"}</span><span>{id ? "Nominal" : "Amount"}</span><span>{id ? "Status" : "Status"}</span><span /></div>{filtered.map((expense) => <article className="expense-table expense-table-row" key={expense.id}><div data-label={id ? "Nota & proyek" : "Receipt & project"}><strong>{expense.number}</strong><small>{expense.projectCode} · {expense.projectName}</small></div><div data-label={id ? "Tanggal / toko" : "Date / merchant"}><strong>{localizedDate(language, expense.purchaseDate)}</strong><small>{expense.merchant} · {id ? expense.category : expense.categoryEn}</small></div><div data-label={id ? "Pengaju" : "Submitter"}><strong>{expense.creatorName}</strong><small>{settlementLabel(language, expense.settlementStatus)}</small></div><div data-label={id ? "Sumber dana" : "Funding"}><strong>{fundingLabel(language, expense.fundingSource)}</strong><small>{paymentMethodLabel(language, expense.paymentMethod)}{expense.fundingSource === "EmployeePaid" ? ` · ${expense.paidByName}` : expense.bankAccount ? ` · ${expense.bankAccount}` : ""}</small></div><div className="expense-amount" data-label={id ? "Nominal" : "Amount"}><strong>{formatCurrency(expense.totalAmount, language)}</strong>{expense.reimbursementOutstanding > 0 && <small>{id ? "Sisa utang " : "Payable "}{formatCurrency(expense.reimbursementOutstanding, language)}</small>}</div><div data-label="Status"><StatusBadge language={language} status={expense.workflowStatus} /></div><div className="expense-row-actions">{["Draft", "Rejected"].includes(expense.workflowStatus) && (expense.createdBy === userId || userRole === "Admin") && <><button className="icon-button inline" type="button" aria-label={id ? "Edit" : "Edit"} onClick={() => editExpense(expense)}><Settings2 size={15} /></button><button className="icon-button inline danger" type="button" aria-label={id ? "Hapus" : "Delete"} onClick={() => void deleteDraft(expense)}><Trash2 size={15} /></button></>}<button className="icon-button inline" type="button" aria-label={id ? "Buka detail" : "Open detail"} onClick={() => void openDetail(expense)}><ChevronRight size={17} /></button></div></article>)}</div>}
      </section>

      {reviewOpen && selected && <div className="expense-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOpen(false); }}><aside className="expense-detail-panel" role="dialog" aria-modal="true" aria-label={id ? "Detail belanja" : "Expense detail"}><header><div><span className="eyebrow">{selected.number}</span><h2>{selected.merchant}</h2><small>{selected.projectCode} · {selected.projectName}</small></div><button className="icon-button" type="button" onClick={() => setReviewOpen(false)}><X size={18} /></button></header><div className="expense-detail-summary"><div><span>{id ? "Nominal" : "Amount"}</span><strong>{formatCurrency(selected.totalAmount, language)}</strong></div><div><span>{id ? "Tanggal" : "Date"}</span><strong>{localizedDate(language, selected.purchaseDate)}</strong></div><div><span>{id ? "Sumber dana" : "Funding"}</span><strong>{fundingLabel(language, selected.fundingSource)}</strong></div><div><span>{id ? "Metode pembayaran" : "Payment method"}</span><strong>{paymentMethodLabel(language, selected.paymentMethod)}</strong></div>{selected.bankAccount && <div><span>{id ? "Rekening perusahaan" : "Company account"}</span><strong>{selected.bankAccount}</strong></div>}{selected.fundingSource === "EmployeePaid" && <div><span>{id ? "Dana pribadi milik" : "Personal funds owner"}</span><strong>{selected.paidByName}</strong></div>}<div><span>Status</span><StatusBadge language={language} status={selected.workflowStatus} /></div></div>{selected.reviewReason && <div className="expense-warning"><XCircle size={17} /><div><strong>{id ? "Alasan penolakan" : "Rejection reason"}</strong><p>{selected.reviewReason}</p></div></div>}<section className="expense-detail-section"><h3>{id ? "Bukti belanja" : "Purchase evidence"}</h3><div className="expense-attachment-grid">{selected.attachments?.map((attachment) => <a key={attachment.id} href={appPath(attachment.url)} target="_blank" rel="noreferrer"><span>{attachment.mimeType.startsWith("image/") ? <ImagePlus size={19} /> : <FileText size={19} />}</span><div><strong>{attachment.name}</strong><small>{(attachment.size / 1024 / 1024).toFixed(1)} MB</small></div><ChevronRight size={16} /></a>)}</div></section>{selected.notes && <section className="expense-detail-section"><h3>{id ? "Catatan" : "Notes"}</h3><p>{selected.notes}</p></section>}{canReview && selected.workflowStatus === "Submitted" && <section className="expense-review-form"><h3>{id ? "Keputusan Finance" : "Finance decision"}</h3><label className="field"><span>{id ? "Tanggal penyelesaian" : "Settlement date"}</span><input type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></label>{selected.fundingSource === "CompanyAccount" && <label className="field"><span>{id ? "Rekening perusahaan" : "Company account"}</span><select value={reviewBankId} onChange={(event) => setReviewBankId(event.target.value)}><option value="">{id ? "Pilih rekening" : "Select account"}</option>{bankAccounts.map((account) => <option value={account.id} key={account.id}>{account.bankName} · {account.accountName} {account.accountNumberMasked}</option>)}</select></label>}{selected.fundingSource === "ProjectAdvance" && <label className="field"><span>{id ? "Uang muka proyek" : "Project advance"}</span><select value={reviewAdvanceId} onChange={(event) => setReviewAdvanceId(event.target.value)}><option value="">{id ? "Pilih uang muka" : "Select advance"}</option>{advances.filter((advance) => advance.projectId === selected.projectId && advance.status === "Open").map((advance) => <option value={advance.id} key={advance.id}>{advance.number} · {advance.recipient} · {formatCurrency(advance.outstanding, language)}</option>)}</select></label>}<label className="field"><span>{id ? "Referensi pembayaran / catatan" : "Payment reference / note"}</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder={selected.fundingSource === "EmployeePaid" ? (id ? "Belum dibayar, menjadi utang" : "Unpaid, recorded as payable") : "TRX-..."} /></label>{selected.createdBy === userId && userRole === "Finance" && <label className="field"><span>{id ? "Alasan self-approval (wajib)" : "Self-approval reason (required)"}</span><textarea rows={2} value={selfApprovalReason} onChange={(event) => setSelfApprovalReason(event.target.value)} /></label>}<label className="field"><span>{id ? "Alasan bila ditolak / dibatalkan" : "Reason when rejecting / voiding"}</span><textarea rows={2} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label><div className="expense-decision-actions"><button className="button secondary danger-text" disabled={busy || reviewReason.trim().length < 5} type="button" onClick={() => void review("reject")}><XCircle size={16} />{id ? "Tolak" : "Reject"}</button><button className="button primary" disabled={busy} type="button" onClick={() => void review("approve")}><CheckCircle2 size={16} />{id ? "Setujui" : "Approve"}</button></div></section>}{canReview && selected.workflowStatus === "Approved" && selected.reimbursementOutstanding > 0 && <section className="expense-review-form"><h3>{id ? "Bayar reimbursement" : "Pay reimbursement"} · {selected.paidByName}</h3><label className="field"><span>{id ? "Nominal pembayaran" : "Payment amount"}</span><input type="number" min={1} max={selected.reimbursementOutstanding} value={reimburseAmount || ""} onChange={(event) => setReimburseAmount(Number(event.target.value))} /></label><label className="field"><span>{id ? "Rekening perusahaan" : "Company account"}</span><select value={reviewBankId} onChange={(event) => setReviewBankId(event.target.value)}>{bankAccounts.map((account) => <option value={account.id} key={account.id}>{account.bankName} · {account.accountName}</option>)}</select></label><label className="field"><span>{id ? "Referensi pembayaran" : "Payment reference"}</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label><button className="button primary full-width" type="button" disabled={busy} onClick={() => void reimburse()}><Landmark size={16} />{id ? "Catat pembayaran" : "Record payment"}</button></section>}{selected.settlements && selected.settlements.length > 0 && <section className="expense-detail-section"><h3>{id ? "Riwayat keuangan" : "Financial history"}</h3><div className="expense-timeline">{selected.settlements.map((settlement) => <div key={settlement.id}><span className={settlement.status === "Posted" ? "success" : "danger"} /><div><strong>{settlement.type} · {formatCurrency(settlement.amount, language)}</strong><small>{localizedDate(language, settlement.settlementDate)} · {settlement.paymentReference}</small></div></div>)}</div></section>}{selected.events && selected.events.length > 0 && <section className="expense-detail-section"><h3>Audit trail</h3><div className="expense-timeline">{selected.events.map((event) => <div key={event.id}><span /><div><strong>{event.type} · {event.actor}</strong><small>{localizedTimestamp(language, event.createdAt)}{event.note ? ` · ${event.note}` : ""}</small></div></div>)}</div></section>}{canReview && userRole === "Admin" && selected.workflowStatus === "Approved" && <button className="button secondary danger-text full-width" disabled={busy || reviewReason.trim().length < 5} type="button" onClick={() => void review("void")}><RotateCcw size={16} />{id ? "Void dengan reversal" : "Void with reversal"}</button>}</aside></div>}

      {categoryOpen && <div className="modal-backdrop" onMouseDown={() => setCategoryOpen(false)}><section className="modal-card wide" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header className="modal-head"><div><span className="eyebrow">MASTER DATA</span><h2>{id ? "Kategori biaya" : "Expense categories"}</h2></div><button className="icon-button" type="button" onClick={() => setCategoryOpen(false)}><X size={18} /></button></header><form className="expense-category-form" onSubmit={addCategory}><label className="field"><span>Nama Indonesia</span><input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></label><label className="field"><span>English name</span><input required value={categoryNameEn} onChange={(event) => setCategoryNameEn(event.target.value)} /></label><button className="button primary" type="submit" disabled={busy}><Plus size={16} />{id ? "Tambah" : "Add"}</button></form><div className="expense-category-list">{categories.map((category) => <div key={category.id}><div><strong>{category.name}</strong><small>{category.nameEn} · {category.usageCount} {id ? "pemakaian" : "uses"}</small></div><button className={`status-badge ${category.status === "Aktif" ? "success" : "neutral"}`} type="button" onClick={() => void toggleCategory(category)}>{category.status === "Aktif" ? (id ? "Aktif" : "Active") : (id ? "Nonaktif" : "Inactive")}</button></div>)}</div></section></div>}

      {advanceOpen && <div className="modal-backdrop" onMouseDown={() => setAdvanceOpen(false)}><section className="modal-card wide" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header className="modal-head"><div><span className="eyebrow">{id ? "UANG MUKA PROYEK" : "PROJECT ADVANCE"}</span><h2>{id ? "Catat pencairan baru" : "Record a disbursement"}</h2></div><button className="icon-button" type="button" onClick={() => setAdvanceOpen(false)}><X size={18} /></button></header><form className="form-grid" onSubmit={createAdvance}><label className="field full"><span>{id ? "Proyek" : "Project"}</span><select required value={advanceProjectId} onChange={(event) => setAdvanceProjectId(event.target.value)}>{projects.map((project) => <option value={project.id} key={project.id}>{project.code} · {project.name}</option>)}</select></label><p className="form-hint full">{id ? `Kas masuk dari invoice proyek ini: ${formatCurrency(advanceInvoiceCash, language)}` : `Invoice cash received for this project: ${formatCurrency(advanceInvoiceCash, language)}`}</p><label className="field full"><span>{id ? "Penerima" : "Recipient"}</span><select required value={advanceRecipientId} onChange={(event) => setAdvanceRecipientId(event.target.value)}>{eligibleUsers.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></label><label className="field"><span>{id ? "Nominal" : "Amount"}</span><input required type="number" min={1} value={advanceAmount || ""} onChange={(event) => setAdvanceAmount(Number(event.target.value))} /></label><label className="field"><span>{id ? "Tanggal cair" : "Disbursement date"}</span><input type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></label><label className="field"><span>{id ? "Rekening perusahaan" : "Company account"}</span><select required value={reviewBankId} onChange={(event) => setReviewBankId(event.target.value)}>{bankAccounts.map((account) => <option value={account.id} key={account.id}>{account.bankName} · {account.accountName}</option>)}</select></label><label className="field"><span>{id ? "Referensi transfer" : "Transfer reference"}</span><input required value={advanceReference} onChange={(event) => setAdvanceReference(event.target.value)} /></label><div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setAdvanceOpen(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit" disabled={busy}><CheckCircle2 size={16} />{id ? "Cairkan uang muka" : "Disburse advance"}</button></div></form>{advances.length > 0 && <div className="expense-advance-list">{advances.slice(0, 5).map((advance) => <div key={advance.id}><span><strong>{advance.number} · {advance.recipient}</strong><small>{advance.project}</small></span><span><strong>{formatCurrency(advance.outstanding, language)}</strong><small>{id ? "saldo" : "outstanding"}</small></span></div>)}</div>}</section></div>}
    </div>
  );
}
