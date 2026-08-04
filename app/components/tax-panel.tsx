"use client";

import {
  Calculator,
  Download,
  Eye,
  FileCheck2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import { type BankAccount, formatCurrency } from "../data";
import { type AppLanguage, localizedDate } from "../i18n";
import { DocumentPreviewModal } from "./document-preview-modal";

interface TaxRule {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  scope: "Client" | "Vendor" | "Both";
  effect: "Add" | "Withhold";
  rateBps: number;
  ratePercent: number;
  accountingTreatment: "Payable" | "Receivable" | "Recoverable" | "Expense";
  status: "Active" | "Inactive";
  sortOrder: number;
}

interface TaxObligation {
  id: string;
  projectCode?: string;
  projectName?: string;
  documentType: string;
  documentId: string;
  ruleCode: string;
  ruleName: string;
  ruleNameEn: string;
  direction: "Payable" | "Receivable";
  amount: number;
  settledAmount: number;
  outstandingAmount: number;
  status: string;
  reportingStatus: "Candidate" | "Ready" | "Reported" | "Settled" | "Void";
  taxPeriod?: string;
  taxInvoiceNumber?: string;
  taxInvoiceDate?: string;
  returnReference?: string;
  reportingNotes?: string;
  dueDate?: string;
}

interface TaxPanelProps {
  language: AppLanguage;
  notify: (message: string) => void;
  canManage: boolean;
  canConfigure: boolean;
  isAdmin: boolean;
  serverToday: string;
}

// Mirrors the server's transition guard. Reporting only moves forward, because
// walking it back re-opens an invoice whose VAT was already filed; voiding is
// free only while nothing has been filed yet. A backward move needs an Admin
// and a written reason, so the dialog has to know which moves count as one.
const REPORTING_ORDER = ["Candidate", "Ready", "Reported", "Settled"] as const;

function isReportingDowngrade(
  currentStatus: TaxObligation["reportingStatus"],
  nextStatus: TaxObligation["reportingStatus"],
) {
  if (currentStatus === nextStatus) return false;
  const currentIndex = REPORTING_ORDER.indexOf(
    currentStatus as (typeof REPORTING_ORDER)[number],
  );
  const nextIndex = REPORTING_ORDER.indexOf(
    nextStatus as (typeof REPORTING_ORDER)[number],
  );
  const forward = currentIndex >= 0 && nextIndex >= 0 && nextIndex > currentIndex;
  const voidBeforeFiling =
    nextStatus === "Void" && currentIndex >= 0 && currentIndex <= 1;
  return !forward && !voidBeforeFiling;
}

function fileToAttachment(file: File) {
  return new Promise<{ name: string; mimeType: string; contentBase64: string }>(
    (resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const data = String(reader.result ?? "");
        resolve({
          name: file.name,
          mimeType: file.type,
          contentBase64: data.split(",")[1] ?? "",
        });
      };
      reader.readAsDataURL(file);
    },
  );
}

export function TaxPanel({
  language,
  notify,
  canManage,
  canConfigure,
  isAdmin,
  serverToday,
}: TaxPanelProps) {
  const id = language === "id";
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<TaxRule[]>([]);
  const [obligations, setObligations] = useState<TaxObligation[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [editingRule, setEditingRule] = useState<TaxRule | null>(null);
  const [settling, setSettling] = useState<TaxObligation | null>(null);
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [settlementDate, setSettlementDate] = useState(serverToday);
  const [settlementReference, setSettlementReference] = useState("");
  const [settlementMethod, setSettlementMethod] = useState("Transfer Bank");
  const [settlementAccount, setSettlementAccount] = useState("");
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [reporting, setReporting] = useState<TaxObligation | null>(null);
  const [reportingStatus, setReportingStatus] = useState<TaxObligation["reportingStatus"]>("Candidate");
  const [taxPeriod, setTaxPeriod] = useState("");
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState("");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState("");
  const [returnReference, setReturnReference] = useState("");
  const [reportingNotes, setReportingNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settings, nextRules, nextObligations, nextAccounts] =
        await Promise.all([
          api<{ enabled: boolean }>("/api/tax/settings"),
          api<TaxRule[]>("/api/tax/rules"),
          api<TaxObligation[]>("/api/tax/obligations"),
          api<BankAccount[]>("/api/bank-accounts"),
        ]);
      setEnabled(settings.enabled);
      setRules(nextRules);
      setObligations(nextObligations);
      setAccounts(nextAccounts.filter((account) => account.status === "Aktif"));
    } catch (error) {
      notify(messageOf(error, language));
    }
  }, [language, notify]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const totals = useMemo(
    () =>
      obligations.reduce(
        (sum, obligation) => {
          if (obligation.status === "Void") return sum;
          if (obligation.direction === "Payable") {
            sum.payable += obligation.outstandingAmount;
          } else {
            sum.receivable += obligation.outstandingAmount;
          }
          return sum;
        },
        { payable: 0, receivable: 0 },
      ),
    [obligations],
  );

  const downgradesReporting = Boolean(
    reporting &&
      isReportingDowngrade(
        reporting.reportingStatus ?? "Candidate",
        reportingStatus,
      ),
  );
  const overrideReasonMissing =
    downgradesReporting && isAdmin && overrideReason.trim().length < 10;

  async function toggleTax() {
    if (!canConfigure) return;
    try {
      const result = await api<{ enabled: boolean }>("/api/tax/settings", {
        method: "PATCH",
        body: JSON.stringify({ enabled: !enabled }),
      });
      setEnabled(result.enabled);
      notify(
        result.enabled
          ? id
            ? "Modul pajak aktif. Dokumen tetap harus dipilih pajaknya satu per satu."
            : "Tax module enabled. Taxes must still be selected per document."
          : id
            ? "Modul pajak dinonaktifkan untuk dokumen baru. Snapshot lama tetap tersimpan."
            : "Tax module disabled for new documents. Existing snapshots remain available.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  function newRule() {
    setEditingRule({
      id: "",
      code: "",
      name: "",
      nameEn: "",
      scope: "Vendor",
      effect: "Withhold",
      rateBps: 0,
      ratePercent: 0,
      accountingTreatment: "Payable",
      status: "Inactive",
      sortOrder: rules.length * 10 + 10,
    });
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRule) return;
    setSaving(true);
    try {
      const saved = await api<TaxRule>(
        editingRule.id
          ? `/api/tax/rules/${editingRule.id}`
          : "/api/tax/rules",
        {
          method: editingRule.id ? "PATCH" : "POST",
          body: JSON.stringify({
            code: editingRule.code,
            name: editingRule.name,
            nameEn: editingRule.nameEn,
            scope: editingRule.scope,
            effect: editingRule.effect,
            rateBps: Math.round(editingRule.ratePercent * 100),
            accountingTreatment: editingRule.accountingTreatment,
            status: editingRule.status,
            sortOrder: editingRule.sortOrder,
          }),
        },
      );
      setRules((current) =>
        editingRule.id
          ? current.map((rule) => (rule.id === saved.id ? saved : rule))
          : [...current, saved],
      );
      setEditingRule(null);
      notify(id ? "Aturan pajak disimpan." : "Tax rule saved.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSaving(false);
    }
  }

  function openSettlement(obligation: TaxObligation) {
    setSettling(obligation);
    setSettlementAmount(obligation.outstandingAmount);
    setSettlementDate(serverToday);
    setSettlementReference("");
    setSettlementMethod("Transfer Bank");
    setSettlementAccount(accounts[0]?.id ?? "");
    setSettlementFile(null);
  }

  async function saveSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settling || !settlementFile) return;
    setSaving(true);
    try {
      await api("/api/tax/settlements", {
        method: "POST",
        body: JSON.stringify({
          obligationId: settling.id,
          amount: settlementAmount,
          settlementDate,
          paymentReference: settlementReference,
          paymentMethod: settlementMethod,
          bankAccountId:
            settlementMethod === "Transfer Bank"
              ? settlementAccount
              : undefined,
          attachment: await fileToAttachment(settlementFile),
        }),
      });
      setSettling(null);
      await load();
      notify(id ? "Settlement pajak diposting ke Buku Kas." : "Tax settlement posted to the cash ledger.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSaving(false);
    }
  }

  async function exportTax(format: "pdf" | "csv") {
    try {
      await downloadApiFile(
        `/api/tax/report.${format}`,
        id
          ? `Laporan-Pajak-PerumNet.${format}`
          : `PerumNet-Tax-Report.${format}`,
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  function openReporting(obligation: TaxObligation) {
    setReporting(obligation);
    setReportingStatus(obligation.reportingStatus ?? "Candidate");
    setTaxPeriod(obligation.taxPeriod ?? serverToday.slice(0, 7));
    setTaxInvoiceNumber(obligation.taxInvoiceNumber ?? "");
    setTaxInvoiceDate(obligation.taxInvoiceDate ?? "");
    setReturnReference(obligation.returnReference ?? "");
    setReportingNotes(obligation.reportingNotes ?? "");
    setOverrideReason("");
  }

  async function saveReporting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reporting) return;
    setSaving(true);
    try {
      await api(`/api/tax/obligations/${reporting.id}/reporting`, {
        method: "PATCH",
        body: JSON.stringify({
          reportingStatus,
          taxPeriod: taxPeriod || null,
          taxInvoiceNumber: taxInvoiceNumber || null,
          taxInvoiceDate: taxInvoiceDate || null,
          returnReference: returnReference || null,
          notes: reportingNotes || null,
          ...(downgradesReporting && overrideReason.trim()
            ? { overrideReason: overrideReason.trim() }
            : {}),
        }),
      });
      setReporting(null);
      await load();
      notify(id ? "Status pelaporan pajak diperbarui." : "Tax reporting status updated.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel tax-panel">
      <div className="panel-head tax-panel-head">
        <div>
          <span className="eyebrow">{id ? "PAJAK OPSIONAL" : "OPTIONAL TAX"}</span>
          <h2>{id ? "Posisi & settlement pajak" : "Tax position & settlement"}</h2>
          <p>
            {id
              ? "Tarif tidak di-hardcode. Admin menentukan aturan, lalu Admin/Finance menerapkannya per dokumen."
              : "Rates are not hardcoded. Admin defines rules, then Admin/Finance applies them per document."}
          </p>
        </div>
        <div className="title-actions">
          <button className="button subtle small" type="button" onClick={() => void load()}>
            <RefreshCw size={15} /> {id ? "Segarkan" : "Refresh"}
          </button>
          <button className="button subtle small" type="button" onClick={() => void exportTax("csv")}>
            <Download size={15} /> CSV
          </button>
          <button className="button subtle small" type="button" onClick={() => void exportTax("pdf")}>
            <Download size={15} /> PDF
          </button>
          <button className="icon-button" type="button" onClick={() => setPreviewOpen(true)} aria-label={id ? "Pratinjau laporan pajak" : "Preview tax report"}><Eye size={16} /></button>
          {canConfigure ? (
            <button className={`button small ${enabled ? "danger" : "primary"}`} type="button" onClick={() => void toggleTax()}>
              {enabled ? (id ? "Nonaktifkan" : "Disable") : (id ? "Aktifkan" : "Enable")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="tax-summary-grid">
        <article><span>{id ? "Status modul" : "Module status"}</span><strong>{enabled ? (id ? "Aktif" : "Enabled") : (id ? "Nonaktif" : "Disabled")}</strong></article>
        <article><span>{id ? "Utang pajak" : "Tax payable"}</span><strong>{formatCurrency(totals.payable, language)}</strong></article>
        <article><span>{id ? "Piutang/kredit pajak" : "Tax receivable/credit"}</span><strong>{formatCurrency(totals.receivable, language)}</strong></article>
        <article><span>{id ? "Aturan aktif" : "Active rules"}</span><strong>{rules.filter((rule) => rule.status === "Active").length}</strong></article>
      </div>

      {canConfigure ? (
        <div className="tax-rules-block">
          <div className="subsection-head">
            <div><strong>{id ? "Master aturan pajak" : "Tax rule master"}</strong><small>{id ? "Basis-point: 100 bps = 1%." : "Basis points: 100 bps = 1%."}</small></div>
            <button className="button secondary small" type="button" onClick={newRule}><Plus size={15} /> {id ? "Aturan" : "Rule"}</button>
          </div>
          <div className="tax-rule-list">
            {rules.map((rule) => (
              <button type="button" key={rule.id} onClick={() => setEditingRule(rule)}>
                <span><strong>{rule.code}</strong><small>{id ? rule.name : rule.nameEn}</small></span>
                <span>{rule.ratePercent.toLocaleString(id ? "id-ID" : "en-US")}%</span>
                <span className={`status-badge ${rule.status === "Active" ? "success" : ""}`}>{rule.status}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="tax-obligation-block">
        <div className="subsection-head">
          <div><strong>{id ? "Outstanding & settlement" : "Outstanding & settlements"}</strong><small>{id ? "Settlement yang sudah direkonsiliasi terkunci." : "Reconciled settlements are locked."}</small></div>
        </div>
        <div
          className="responsive-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={id ? "Tabel posisi pajak" : "Tax position table"}
        >
          <table className="data-table tax-table">
            <thead><tr><th>{id ? "Dokumen" : "Document"}</th><th>{id ? "Aturan" : "Rule"}</th><th>{id ? "Pelaporan" : "Reporting"}</th><th>{id ? "Posisi" : "Position"}</th><th>{id ? "Outstanding" : "Outstanding"}</th><th>{id ? "Jatuh tempo" : "Due"}</th><th><span className="sr-only">{id ? "Aksi" : "Actions"}</span></th></tr></thead>
            <tbody>
              {obligations.map((obligation) => (
                <tr key={obligation.id}>
                  <td><strong>{obligation.documentType}</strong><small>{obligation.projectCode ?? obligation.projectName ?? "—"}</small></td>
                  <td>{obligation.ruleCode}</td>
                  <td><span className="status-badge info">{obligation.reportingStatus}</span><small>{obligation.taxPeriod ?? "—"}</small></td>
                  <td>{obligation.direction === "Payable" ? (id ? "Utang" : "Payable") : (id ? "Piutang" : "Receivable")}</td>
                  <td>{formatCurrency(obligation.outstandingAmount, language)}</td>
                  <td>{obligation.dueDate ? localizedDate(language, obligation.dueDate) : "—"}</td>
                  <td><div className="table-row-actions">{canManage ? <button className="button secondary small" type="button" onClick={() => openReporting(obligation)}>{id ? "Lapor" : "Report"}</button> : null}{canManage && obligation.outstandingAmount > 0 ? <button className="button primary small" type="button" onClick={() => openSettlement(obligation)}>{id ? "Settlement" : "Settle"}</button> : null}</div></td>
                </tr>
              ))}
              {!obligations.length ? <tr><td colSpan={7}><div className="empty-state compact"><Calculator size={22} /><p>{id ? "Belum ada posisi pajak terkunci." : "No locked tax positions yet."}</p></div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {editingRule ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingRule(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">{id ? "MASTER PAJAK" : "TAX MASTER"}</span><h2>{editingRule.id ? (id ? "Edit aturan" : "Edit rule") : (id ? "Aturan baru" : "New rule")}</h2></div><button className="icon-button" type="button" onClick={() => setEditingRule(null)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={saveRule}>
              <label className="field"><span>{id ? "Kode" : "Code"}</span><input required value={editingRule.code} onChange={(event) => setEditingRule({ ...editingRule, code: event.target.value.toUpperCase() })} /></label>
              <label className="field"><span>{id ? "Tarif (%)" : "Rate (%)"}</span><input required type="number" min="0" max="100" step="0.01" value={editingRule.ratePercent} onChange={(event) => setEditingRule({ ...editingRule, ratePercent: Number(event.target.value) })} /></label>
              <label className="field"><span>Nama Indonesia</span><input required value={editingRule.name} onChange={(event) => setEditingRule({ ...editingRule, name: event.target.value })} /></label>
              <label className="field"><span>English name</span><input required value={editingRule.nameEn} onChange={(event) => setEditingRule({ ...editingRule, nameEn: event.target.value })} /></label>
              <label className="field"><span>{id ? "Cakupan" : "Scope"}</span><select value={editingRule.scope} onChange={(event) => setEditingRule({ ...editingRule, scope: event.target.value as TaxRule["scope"] })}><option value="Client">Client</option><option value="Vendor">Vendor</option><option value="Both">{id ? "Keduanya" : "Both"}</option></select></label>
              <label className="field"><span>{id ? "Efek" : "Effect"}</span><select value={editingRule.effect} onChange={(event) => setEditingRule({ ...editingRule, effect: event.target.value as TaxRule["effect"] })}><option value="Add">{id ? "Tambah" : "Add"}</option><option value="Withhold">{id ? "Potong" : "Withhold"}</option></select></label>
              <label className="field"><span>{id ? "Akuntansi" : "Accounting"}</span><select value={editingRule.accountingTreatment} onChange={(event) => setEditingRule({ ...editingRule, accountingTreatment: event.target.value as TaxRule["accountingTreatment"] })}><option value="Payable">{id ? "Utang pajak" : "Tax payable"}</option><option value="Receivable">{id ? "Piutang pajak" : "Tax receivable"}</option><option value="Recoverable">{id ? "Dapat dikreditkan" : "Recoverable"}</option><option value="Expense">{id ? "Biaya" : "Expense"}</option></select></label>
              <label className="field"><span>Status</span><select value={editingRule.status} onChange={(event) => setEditingRule({ ...editingRule, status: event.target.value as TaxRule["status"] })}><option value="Inactive">Inactive</option><option value="Active">Active</option></select></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setEditingRule(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit" disabled={saving}><Save size={15} /> {id ? "Simpan" : "Save"}</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {settling ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettling(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">{id ? "SETTLEMENT PAJAK" : "TAX SETTLEMENT"}</span><h2>{settling.ruleCode}</h2></div><button className="icon-button" type="button" onClick={() => setSettling(null)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={saveSettlement}>
              <label className="field"><span>{id ? "Nominal" : "Amount"}</span><input required type="number" min="1" max={settling.outstandingAmount} value={settlementAmount || ""} onChange={(event) => setSettlementAmount(Number(event.target.value))} /></label>
              <label className="field"><span>{id ? "Tanggal" : "Date"}</span><input required type="date" max={serverToday || undefined} value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Referensi pembayaran" : "Payment reference"}</span><input required value={settlementReference} onChange={(event) => setSettlementReference(event.target.value)} /></label>
              <label className="field"><span>{id ? "Metode" : "Method"}</span><select value={settlementMethod} onChange={(event) => setSettlementMethod(event.target.value)}><option value="Transfer Bank">{id ? "Transfer Bank" : "Bank Transfer"}</option><option value="Tunai">{id ? "Tunai" : "Cash"}</option><option value="Kartu">{id ? "Kartu" : "Card"}</option><option value="Lainnya">{id ? "Lainnya" : "Other"}</option></select></label>
              {settlementMethod === "Transfer Bank" ? <label className="field"><span>{id ? "Rekening" : "Bank account"}</span><select required value={settlementAccount} onChange={(event) => setSettlementAccount(event.target.value)}><option value="">{id ? "Pilih rekening" : "Select account"}</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.bankName} · {account.accountNumberMasked}</option>)}</select></label> : null}
              <label className="field full"><span>{id ? "Bukti pembayaran (PDF/gambar)" : "Payment proof (PDF/image)"}</span><input required type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setSettlementFile(event.target.files?.[0] ?? null)} /></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setSettling(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit" disabled={saving || !settlementFile}><FileCheck2 size={15} /> {saving ? (id ? "Menyimpan..." : "Saving...") : (id ? "Posting settlement" : "Post settlement")}</button></div>
            </form>
          </section>
        </div>
      ) : null}
      {reporting ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setReporting(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">{id ? "PELAPORAN PAJAK" : "TAX REPORTING"}</span><h2>{reporting.ruleCode} · {reporting.documentType}</h2></div><button className="icon-button" type="button" onClick={() => setReporting(null)}><X size={18} /></button></div>
            <form className="form-grid" onSubmit={saveReporting}>
              <label className="field"><span>Status</span><select value={reportingStatus} onChange={(event) => setReportingStatus(event.target.value as TaxObligation["reportingStatus"])}><option value="Candidate">Candidate</option><option value="Ready">Ready</option><option value="Reported">Reported</option><option value="Settled">Settled</option><option value="Void">Void</option></select></label>
              <label className="field"><span>{id ? "Masa pajak" : "Tax period"}</span><input type="month" value={taxPeriod} onChange={(event) => setTaxPeriod(event.target.value)} /></label>
              <label className="field"><span>{id ? "Nomor faktur pajak" : "Tax invoice number"}</span><input value={taxInvoiceNumber} onChange={(event) => setTaxInvoiceNumber(event.target.value)} /></label>
              <label className="field"><span>{id ? "Tanggal faktur" : "Tax invoice date"}</span><input type="date" value={taxInvoiceDate} onChange={(event) => setTaxInvoiceDate(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Referensi pelaporan" : "Return reference"}</span><input required={reportingStatus === "Reported" || reportingStatus === "Settled"} value={returnReference} onChange={(event) => setReturnReference(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Catatan" : "Notes"}</span><textarea value={reportingNotes} onChange={(event) => setReportingNotes(event.target.value)} /></label>
              {downgradesReporting && isAdmin ? (
                <label className="field full">
                  <span>{id ? "Alasan penurunan status (wajib, minimal 10 karakter)" : "Reason for lowering the status (required, at least 10 characters)"}</span>
                  <textarea
                    rows={2}
                    required
                    minLength={10}
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder={id ? "Contoh: SPT masa yang sama dikoreksi." : "Example: the return for the same period is being corrected."}
                  />
                  <small>{id ? "Status pelaporan hanya bergerak maju. Alasan ini tercatat di jejak audit, dan tanggal serta identitas pelapor tidak pernah dihapus." : "Reporting only moves forward. This reason lands in the audit trail, and the filing date and filer are never erased."}</small>
                </label>
              ) : null}
              {downgradesReporting && !isAdmin ? (
                <div className="security-note attention full">
                  <ShieldAlert size={19} />
                  <div>
                    <strong>{id ? "Hanya Admin yang dapat menurunkan status" : "Only an Admin can lower this status"}</strong>
                    <span>{id ? "Status pelaporan pajak hanya bergerak maju: Candidate, Ready, Reported, lalu Settled. Minta Admin menurunkannya sambil menuliskan alasannya." : "Tax reporting only moves forward: Candidate, Ready, Reported, then Settled. Ask an Admin to lower it while stating a reason."}</span>
                  </div>
                </div>
              ) : null}
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setReporting(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit" disabled={saving || overrideReasonMissing || (downgradesReporting && !isAdmin)}><Save size={15} /> {id ? "Simpan pelaporan" : "Save reporting"}</button></div>
            </form>
          </section>
        </div>
      ) : null}
      <DocumentPreviewModal open={previewOpen} url="/api/tax/report.pdf" title={id ? "Laporan Pajak" : "Tax Report"} filename={id ? "Laporan-Pajak-PerumNet.pdf" : "PerumNet-Tax-Report.pdf"} onClose={() => setPreviewOpen(false)} />
    </section>
  );
}
