"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Archive,
  BarChart3,
  CalendarRange,
  ChevronDown,
  CircleDollarSign,
  Download,
  FileCheck2,
  Filter,
  Landmark,
  Plus,
  Pencil,
  ReceiptText,
  Search,
  TrendingDown,
  TrendingUp,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import {
  formatCompactCurrency,
  formatCurrency,
  Project,
  Transaction,
} from "../data";
import { type AppLanguage, localizedDate, localizedLabel } from "../i18n";
import { BankingPanel } from "./banking-panel";
import { FinanceEvidenceView } from "./finance-evidence-view";
import { ProfitSharingPanel } from "./profit-sharing-panel";
import { TaxPanel } from "./tax-panel";
import type { FinanceEvidenceKind } from "@/shared/finance-evidence";

interface FinanceViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projectId?: string;
  projects: Project[];
  canManage: boolean;
  isAdmin: boolean;
  canUseBanking: boolean;
  canViewMargin: boolean;
  canConfigureBanking: boolean;
  canApproveProfitShares: boolean;
  canConfigureTax: boolean;
  canManageEvidenceKind: (kind: FinanceEvidenceKind) => boolean;
}

interface UnreconciledTotals {
  entries: number;
  income: number;
  expense: number;
}

interface FinanceSummary {
  income: number;
  expense: number;
  netCash: number;
  cashRatio: number;
  unreconciled: UnreconciledTotals;
}

interface CompanyTreasuryEntry {
  id: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  amount: number;
  date: string;
  shareId: string;
  reversed: boolean;
  description: string;
}

interface CompanyTreasury {
  balance: number;
  entries: CompanyTreasuryEntry[];
}

const transactionCategories = [
  "Penjualan",
  "Operasional",
  "Vendor",
  "Pajak",
  "Gaji",
  "Modal",
  "Bonus Pegawai",
  "Fee Pemberi Kerja",
  "Lainnya",
] as const;

const categoryEnglish: Record<string, string> = {
  Penjualan: "Sales",
  Operasional: "Operations",
  Vendor: "Vendor",
  Pajak: "Tax",
  Gaji: "Payroll",
  Modal: "Capital",
  "Bonus Pegawai": "Employee Bonus",
  "Fee Pemberi Kerja": "Referral Fee",
  "Bagi Hasil": "Profit Share",
  Lainnya: "Other",
};

function categoryLabel(language: AppLanguage, category: string) {
  return language === "id" ? category : categoryEnglish[category] ?? category;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return shifted.toISOString().slice(0, 7);
}

function shiftDay(date: string, offset: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function makassarDate(value: string) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Makassar",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

// An imported bank line that nobody has matched yet almost always duplicates a
// source document that already booked the same money, so the server leaves it
// out of every aggregate and flags it per row. Every total on this screen has
// to agree with that, otherwise the fix never reaches the person reading it.
function countsAsCash(transaction: Transaction) {
  return transaction.countsAsCash !== false;
}

function summarize(transactions: Transaction[]) {
  const booked = transactions.filter(countsAsCash);
  const income = booked
    .filter((transaction) => transaction.type === "Pemasukan")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expense = booked
    .filter((transaction) => transaction.type === "Pengeluaran")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return { income, expense, netCash: income - expense };
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : undefined;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function TrendValue({
  current,
  previous,
  language,
}: {
  current: number;
  previous: number;
  language: AppLanguage;
}) {
  const change = percentageChange(current, previous);
  const positive = (change ?? 0) >= 0;
  return (
    <>
      <span
        className={`metric-change ${change === undefined ? "" : positive ? "positive" : "negative"}`}
      >
        {change === undefined ? (
          language === "id" ? "Baru" : "New"
        ) : (
          <>
            {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {Math.abs(change).toFixed(1)}%
          </>
        )}
      </span>
      <small>{language === "id" ? "dari periode lalu" : "from previous period"}</small>
    </>
  );
}

export function FinanceView({
  language,
  notify,
  projectId,
  projects,
  canManage,
  isAdmin,
  canUseBanking,
  canViewMargin,
  canConfigureBanking,
  canApproveProfitShares,
  canConfigureTax,
  canManageEvidenceKind,
}: FinanceViewProps) {
  const id = language === "id";
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [unreconciled, setUnreconciled] = useState<UnreconciledTotals>({
    entries: 0,
    income: 0,
    expense: 0,
  });
  const [serverToday, setServerToday] = useState("");
  const [periodMonths, setPeriodMonths] = useState<3 | 6 | 12>(6);
  const [bankBalance, setBankBalance] = useState(0);
  const [companyTreasury, setCompanyTreasury] = useState<CompanyTreasury>({ balance: 0, entries: [] });
  const [companyTreasuryLoading, setCompanyTreasuryLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"Semua" | Transaction["type"]>("Semua");
  const [filterOpen, setFilterOpen] = useState(false);
  const [financeSection, setFinanceSection] = useState<"overview" | "evidence">("overview");
  const [evidenceInitialQuery, setEvidenceInitialQuery] = useState("");
  const [evidenceInitialKind, setEvidenceInitialKind] = useState<FinanceEvidenceKind | undefined>(undefined);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [transactionType, setTransactionType] = useState<Transaction["type"]>("Pemasukan");
  const [transactionProjectId, setTransactionProjectId] = useState(projectId ?? "");
  const [transactionDate, setTransactionDate] = useState("");
  const [transactionCategory, setTransactionCategory] = useState("Penjualan");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [editingTransactionId, setEditingTransactionId] = useState("");

  const loadTransactions = useCallback(async () => {
    try {
      const data = await api<Transaction[]>(
        `/api/transactions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      );
      setTransactions(data);
    } catch (error) {
      notify(messageOf(error, language));
    }
  }, [language, notify, projectId]);

  useEffect(() => {
    let active = true;
    api<Transaction[]>(
      `/api/transactions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
    )
      .then((data) => {
        if (active) setTransactions(data);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify, projectId]);

  useEffect(() => {
    let active = true;
    api<{ now: string; today: string; timeZone: string }>("/api/system/time")
      .then((data) => {
        if (!active) return;
        const today = data.today || makassarDate(data.now);
        setServerToday(today);
        setTransactionDate(today);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify]);

  const periodWindow = useMemo(() => {
    if (!serverToday) return undefined;
    const currentStart = `${shiftMonth(serverToday.slice(0, 7), 1 - periodMonths)}-01`;
    const previousEnd = shiftDay(currentStart, -1);
    const previousStart = `${shiftMonth(currentStart.slice(0, 7), -periodMonths)}-01`;
    return {
      currentStart,
      currentEnd: serverToday,
      previousStart,
      previousEnd,
    };
  }, [periodMonths, serverToday]);

  const financeQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (periodWindow) {
      params.set("from", periodWindow.currentStart);
      params.set("to", periodWindow.currentEnd);
    }
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [periodWindow, projectId]);

  // The pending figure is reported rather than hidden, so the money left out of
  // the cards above is still visible and still chaseable.
  const loadSummary = useCallback(async () => {
    if (!periodWindow) return;
    try {
      const summary = await api<FinanceSummary>(`/api/finance/summary${financeQuery}`);
      setUnreconciled(
        summary.unreconciled ?? { entries: 0, income: 0, expense: 0 },
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }, [financeQuery, language, notify, periodWindow]);

  const loadCompanyTreasury = useCallback(async () => {
    if (!canViewMargin) {
      setCompanyTreasury({ balance: 0, entries: [] });
      return;
    }
    setCompanyTreasuryLoading(true);
    try {
      const data = await api<CompanyTreasury>("/api/finance/company-treasury");
      setCompanyTreasury({ balance: data.balance ?? 0, entries: data.entries ?? [] });
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setCompanyTreasuryLoading(false);
    }
  }, [canViewMargin, language, notify]);

  useEffect(() => {
    void Promise.resolve().then(loadSummary);
  }, [loadSummary]);

  useEffect(() => {
    void Promise.resolve().then(loadCompanyTreasury);
  }, [loadCompanyTreasury]);

  const periodTransactions = useMemo(
    () =>
      periodWindow
        ? transactions.filter(
            (transaction) =>
              Boolean(transaction.dateIso) &&
              transaction.dateIso! >= periodWindow.currentStart &&
              transaction.dateIso! <= periodWindow.currentEnd,
          )
        : transactions,
    [periodWindow, transactions],
  );

  const previousTransactions = useMemo(
    () =>
      periodWindow
        ? transactions.filter(
            (transaction) =>
              Boolean(transaction.dateIso) &&
              transaction.dateIso! >= periodWindow.previousStart &&
              transaction.dateIso! <= periodWindow.previousEnd,
          )
        : [],
    [periodWindow, transactions],
  );

  const totals = useMemo(() => summarize(periodTransactions), [periodTransactions]);
  const previousTotals = useMemo(
    () => summarize(previousTransactions),
    [previousTransactions],
  );

  const chartData = useMemo(() => {
    if (!serverToday) return [];
    const months = new Map<string, { income: number; expense: number }>();
    for (let index = periodMonths - 1; index >= 0; index -= 1) {
      months.set(shiftMonth(serverToday.slice(0, 7), -index), {
        income: 0,
        expense: 0,
      });
    }
    for (const transaction of periodTransactions) {
      if (!countsAsCash(transaction)) continue;
      const key = transaction.dateIso?.slice(0, 7);
      if (!key || !months.has(key)) continue;
      const current = months.get(key)!;
      if (transaction.type === "Pemasukan") current.income += transaction.amount;
      else current.expense += transaction.amount;
    }
    return Array.from(months.entries()).map(([month, values]) => ({
      key: month,
      month: new Intl.DateTimeFormat(id ? "id-ID" : "en-US", {
        month: periodMonths === 12 ? "narrow" : "short",
        timeZone: "UTC",
      }).format(new Date(`${month}-01T00:00:00.000Z`)),
      income: values.income / 1_000_000,
      expense: values.expense / 1_000_000,
    }));
  }, [id, periodMonths, periodTransactions, serverToday]);

  const projectCashFlow = useMemo(() => {
    const grouped = new Map<string, { income: number; expense: number }>();
    for (const transaction of periodTransactions) {
      if (!countsAsCash(transaction)) continue;
      const current = grouped.get(transaction.project) ?? {
        income: 0,
        expense: 0,
      };
      if (transaction.type === "Pemasukan") current.income += transaction.amount;
      else current.expense += transaction.amount;
      grouped.set(transaction.project, current);
    }
    return Array.from(grouped.entries())
      .map(([name, values]) => ({
        name,
        netCash: values.income - values.expense,
        ratio: values.income
          ? ((values.income - values.expense) / values.income) * 100
          : 0,
      }))
      .sort((left, right) => right.netCash - left.netCash);
  }, [periodTransactions]);

  const chartMax = Math.max(
    1,
    ...chartData.flatMap((item) => [item.income, item.expense]),
  );

  const visibleTransactions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return periodTransactions.filter(
      (transaction) =>
        (typeFilter === "Semua" || transaction.type === typeFilter) &&
        (!normalized ||
          [
            transaction.project,
            transaction.description,
            transaction.source,
            transaction.category,
            transaction.categoryKey,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalized)),
    );
  }, [periodTransactions, query, typeFilter]);

  function openTransactionForm() {
    setEditingTransactionId("");
    setTransactionProjectId(projectId || projects[0]?.id || "");
    setTransactionDate(serverToday);
    setTransactionType("Pemasukan");
    setTransactionCategory("Penjualan");
    setDescription("");
    setAmount(0);
    setShowTransactionForm(true);
  }

  function editTransaction(transaction: Transaction) {
    if (!transaction.editable) return;
    setEditingTransactionId(transaction.id);
    setTransactionProjectId(transaction.projectId ?? "");
    setTransactionDate(transaction.dateIso ?? serverToday);
    setTransactionType(transaction.type);
    setTransactionCategory(
      transactionCategories.includes(
        (transaction.categoryKey ??
          transaction.category) as (typeof transactionCategories)[number],
      )
        ? transaction.categoryKey ?? transaction.category
        : "Lainnya",
    );
    setDescription(transaction.description);
    setAmount(transaction.amount);
    setShowTransactionForm(true);
  }

  function chooseTransactionType(type: Transaction["type"]) {
    setTransactionType(type);
    setTransactionCategory(type === "Pemasukan" ? "Penjualan" : "Operasional");
  }

  function openEvidenceForTransaction(transaction: Transaction) {
    if (!transaction.evidence) return;
    setEvidenceInitialQuery(transaction.description || transaction.evidence.evidenceId);
    setEvidenceInitialKind(transaction.evidence.kind as FinanceEvidenceKind);
    setFinanceSection("evidence");
  }

  async function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || amount <= 0 || !transactionDate) return;
    if (!transactionProjectId) {
      notify(id ? "Pilih proyek untuk transaksi ini." : "Select a project for this transaction.");
      return;
    }
    try {
      await api<Transaction>(
        editingTransactionId
          ? `/api/transactions/${editingTransactionId}`
          : "/api/transactions",
        {
        method: editingTransactionId ? "PATCH" : "POST",
        body: JSON.stringify({
          projectId: transactionProjectId,
          date: transactionDate,
          type: transactionType,
          description: description.trim(),
          amount,
          source: "Manual",
          category: transactionCategory,
        }),
      });
      await loadTransactions();
      await loadSummary();
      setDescription("");
      setAmount(0);
      setShowTransactionForm(false);
      setEditingTransactionId("");
      notify(
        editingTransactionId
          ? id
            ? "Koreksi transaksi berhasil disimpan dan dicatat di audit log."
            : "The transaction correction was saved and recorded in the audit log."
          : id
            ? "Transaksi berhasil dicatat."
            : "Transaction recorded.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteTransaction(transaction: Transaction) {
    if (!transaction.editable) return;
    if (
      !window.confirm(
        id
          ? `Hapus transaksi manual "${transaction.description}"? Tindakan ini dicatat pada audit log.`
          : `Delete manual transaction "${transaction.description}"? This action is recorded in the audit log.`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/transactions/${transaction.id}`, { method: "DELETE" });
      await loadTransactions();
      await loadSummary();
      notify(id ? "Transaksi manual dihapus." : "Manual transaction deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function exportReport() {
    try {
      await downloadApiFile(
        `/api/transactions/report.pdf${financeQuery}`,
        id ? "Laporan-Arus-Kas-PerumNet.pdf" : "PerumNet-Cash-Flow-Report.pdf",
      );
      notify(id ? "Laporan arus kas PDF berhasil diekspor." : "Cash flow PDF exported.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function exportCsv() {
    try {
      await downloadApiFile(
        `/api/transactions/report.csv${financeQuery}`,
        id ? "Laporan-Arus-Kas-PerumNet.csv" : "PerumNet-Cash-Flow-Report.csv",
      );
      notify(id ? "Laporan arus kas CSV berhasil diekspor." : "Cash flow CSV exported.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack" data-testid="finance-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">{id ? "KEUANGAN PROYEK" : "PROJECT FINANCE"}</span>
          <h1>{id ? "Pembukuan & arus kas" : "Bookkeeping & cash flow"}</h1>
          <p>
            {id
              ? "Pantau kas masuk, kas keluar, rekening, dan rekonsiliasi transaksi."
              : "Monitor cash inflows, outflows, bank accounts, and reconciliation."}
          </p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={exportReport}>
            <Download size={16} /> {id ? "Ekspor PDF" : "Export PDF"}
          </button>
          <button className="button secondary" type="button" onClick={exportCsv}>
            <Download size={16} /> {id ? "Ekspor CSV" : "Export CSV"}
          </button>
          {canManage ? (
            <button className="button primary" type="button" onClick={openTransactionForm}>
              <Plus size={16} /> {id ? "Catat transaksi" : "Record transaction"}
            </button>
          ) : null}
        </div>
      </section>

      <div className="finance-section-tabs" role="tablist" aria-label={id ? "Bagian pembukuan" : "Finance sections"}>
        <button className={financeSection === "overview" ? "active" : ""} type="button" role="tab" aria-selected={financeSection === "overview"} onClick={() => setFinanceSection("overview")}><WalletCards size={15} /> {id ? "Ringkasan & transaksi" : "Overview & transactions"}</button>
        <button className={financeSection === "evidence" ? "active" : ""} type="button" role="tab" aria-selected={financeSection === "evidence"} onClick={() => setFinanceSection("evidence")}><Archive size={15} /> {id ? "Arsip Bukti" : "Evidence archive"}</button>
      </div>

      {financeSection === "evidence" ? <FinanceEvidenceView key={`${evidenceInitialKind ?? "all"}-${evidenceInitialQuery}`} language={language} notify={notify} projects={projects} initialProjectId={projectId} initialQuery={evidenceInitialQuery} initialKind={evidenceInitialKind} canManageEvidenceKind={canManageEvidenceKind} /> : <>

      <section className="finance-kpi-grid">
        <article className="finance-kpi income">
          <div className="finance-kpi-head">
            <span>{id ? "Kas masuk" : "Cash inflow"}</span>
            <span className="metric-icon green"><ArrowDownRight size={19} /></span>
          </div>
          <strong>{formatCurrency(totals.income, language)}</strong>
          <div>
            <TrendValue
              current={totals.income}
              previous={previousTotals.income}
              language={language}
            />
          </div>
        </article>
        <article className="finance-kpi expense">
          <div className="finance-kpi-head">
            <span>{id ? "Kas keluar" : "Cash outflow"}</span>
            <span className="metric-icon orange"><ArrowUpRight size={19} /></span>
          </div>
          <strong>{formatCurrency(totals.expense, language)}</strong>
          <div>
            <TrendValue
              current={totals.expense}
              previous={previousTotals.expense}
              language={language}
            />
          </div>
        </article>
        <article className="finance-kpi profit">
          <div className="finance-kpi-head">
            <span>{id ? "Arus kas bersih" : "Net cash flow"}</span>
            <span className="metric-icon teal"><CircleDollarSign size={19} /></span>
          </div>
          <strong>{formatCurrency(totals.netCash, language)}</strong>
          <div>
            <span className={`metric-change ${totals.netCash >= 0 ? "positive" : "negative"}`}>
              {totals.income
                ? `${((totals.netCash / totals.income) * 100).toFixed(1)}%`
                : "0%"}
            </span>
            <small>{id ? "rasio terhadap kas masuk" : "ratio to cash inflow"}</small>
          </div>
        </article>
        <article className="finance-kpi receivable">
          <div className="finance-kpi-head">
            <span>
              {canUseBanking
                ? id ? "Saldo rekening" : "Bank balance"
                : id ? "Transaksi tercatat" : "Recorded transactions"}
            </span>
            <span className="metric-icon blue">
              {canUseBanking ? <Landmark size={19} /> : <ReceiptText size={19} />}
            </span>
          </div>
          <strong>
            {canUseBanking
              ? formatCurrency(bankBalance, language)
              : periodTransactions.length}
          </strong>
          <div>
            <span className="metric-change">
              {projectId
                ? id ? "Proyek aktif" : "Active project"
                : id ? "Semua proyek" : "All projects"}
            </span>
            <small>{id ? "sesuai otoritas akun" : "within account authority"}</small>
          </div>
        </article>
      </section>

      {unreconciled.entries > 0 ? (
        <section className="security-note attention" data-testid="unreconciled-note">
          <Landmark size={19} />
          <div>
            <strong>
              {id
                ? "Mutasi bank belum direkonsiliasi"
                : "Unreconciled bank entries"}
            </strong>
            <span>
              {id
                ? `${unreconciled.entries} mutasi impor belum dicocokkan: ${formatCurrency(unreconciled.income, language)} masuk dan ${formatCurrency(unreconciled.expense, language)} keluar. Angka itu belum dihitung sebagai kas pada kartu di atas karena hampir selalu menduplikasi invoice, pembayaran vendor, atau setoran pajak yang sudah tercatat. Cocokkan mutasinya di bagian Rekening perusahaan agar ikut terhitung lewat catatan sumbernya.`
                : `${unreconciled.entries} imported entries are still unmatched: ${formatCurrency(unreconciled.income, language)} in and ${formatCurrency(unreconciled.expense, language)} out. They are not counted as cash in the cards above because such a line nearly always duplicates an invoice, a vendor payment, or a tax settlement that was already recorded. Match them in the Company banking section so they count through their source record.`}
            </span>
          </div>
        </section>
      ) : null}

      {canUseBanking ? (
        <BankingPanel
          language={language}
          notify={notify}
          canManage={canManage}
          canConfigure={canConfigureBanking}
          canDeleteEntries={canConfigureBanking}
          serverToday={serverToday}
          onBalanceChange={setBankBalance}
          onLedgerChanged={() => {
            void loadTransactions();
            void loadSummary();
          }}
        />
      ) : null}

      {canUseBanking ? (
        <TaxPanel
          language={language}
          notify={notify}
          canManage={canManage}
          canConfigure={canConfigureTax}
          isAdmin={isAdmin}
          serverToday={serverToday}
        />
      ) : null}

      {canManage && projects.length ? (
        <ProfitSharingPanel
          key={projectId ?? "all-projects"}
          language={language}
          notify={notify}
          projects={projects}
          initialProjectId={projectId}
          canApprove={canApproveProfitShares}
          serverToday={serverToday}
        />
      ) : null}

      {canViewMargin ? (
        <section className="panel company-treasury-panel" data-testid="company-treasury-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">{id ? "KAS PERUSAHAAN" : "COMPANY TREASURY"}</span>
              <h2>{id ? "Saldo laba perusahaan" : "Company profit balance"}</h2>
              <p>{id ? "Alokasi laba yang sudah dipindahkan dari proyek. Angka ini terpisah dari kas masuk dan arus kas bersih." : "Profit allocations transferred from projects. This balance stays separate from cash inflow and net cash flow."}</p>
            </div>
            <div className="company-treasury-balance">
              <span>{id ? "Saldo saat ini" : "Current balance"}</span>
              <strong>{companyTreasuryLoading ? "…" : formatCurrency(companyTreasury.balance, language)}</strong>
            </div>
          </div>
          <div className="company-treasury-list">
            {companyTreasury.entries.slice(0, 6).map((entry) => (
              <article className={`company-treasury-entry ${entry.reversed ? "reversed" : ""}`} key={entry.id || `${entry.shareId}-${entry.date}`}>
                <span className={`metric-icon ${entry.reversed ? "orange" : "teal"}`}><Landmark size={17} /></span>
                <div>
                  <strong>{entry.projectName || entry.projectCode || (id ? "Alokasi perusahaan" : "Company allocation")}</strong>
                  <small>{entry.projectCode ? `${entry.projectCode} · ` : ""}{localizedDate(language, entry.date)}{entry.description ? ` · ${entry.description}` : ""}</small>
                </div>
                <strong className={entry.reversed ? "amount-expense" : "amount-income"}>{entry.reversed ? "−" : "+"}{formatCurrency(entry.amount, language)}</strong>
                <span className={`status-badge ${entry.reversed ? "neutral" : "success"}`}>{entry.reversed ? (id ? "Dibalik" : "Reversed") : (id ? "Masuk" : "Received")}</span>
              </article>
            ))}
            {!companyTreasuryLoading && !companyTreasury.entries.length ? (
              <div className="empty-state compact"><Landmark size={22} /><span>{id ? "Belum ada alokasi ke Kas Perusahaan." : "No company treasury allocations yet."}</span></div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="finance-layout">
        <div className="panel cashflow-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">{id ? "ARUS KAS" : "CASH FLOW"}</span>
              <h2>{id ? "Kas masuk vs kas keluar" : "Cash inflow vs outflow"}</h2>
            </div>
            <label className="select-compact">
              <CalendarRange size={15} />
              <select
                aria-label={id ? "Periode grafik arus kas" : "Cash flow chart period"}
                value={periodMonths}
                onChange={(event) =>
                  setPeriodMonths(Number(event.target.value) as 3 | 6 | 12)
                }
              >
                <option value={3}>{id ? "3 bulan" : "3 months"}</option>
                <option value={6}>{id ? "6 bulan" : "6 months"}</option>
                <option value={12}>{id ? "12 bulan" : "12 months"}</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          <div className="chart-legend">
            <span><i className="legend-dot income" /> {id ? "Kas masuk" : "Cash inflow"}</span>
            <span><i className="legend-dot expense" /> {id ? "Kas keluar" : "Cash outflow"}</span>
            <small>{id ? "Dalam juta rupiah" : "In millions of rupiah"}</small>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={
              id
                ? `Grafik arus kas ${periodMonths} bulan`
                : `${periodMonths}-month cash flow chart`
            }
          >
            <div className="chart-y-axis">
              <span>{Math.ceil(chartMax)}</span>
              <span>{Math.ceil(chartMax * 0.67)}</span>
              <span>{Math.ceil(chartMax * 0.33)}</span>
              <span>0</span>
            </div>
            <div
              className="chart-plot"
              style={{
                gridTemplateColumns: `repeat(${Math.max(chartData.length, 1)}, minmax(12px, 1fr))`,
              }}
            >
              <div className="chart-grid-lines"><span /><span /><span /><span /></div>
              {chartData.map((item) => (
                <div className="chart-group" key={item.key}>
                  <div className="chart-bars">
                    <span
                      className="chart-bar income"
                      style={{ height: `${(item.income / chartMax) * 100}%` }}
                      title={
                        id
                          ? `Kas masuk ${item.income} juta`
                          : `Cash inflow IDR ${item.income} million`
                      }
                    />
                    <span
                      className="chart-bar expense"
                      style={{ height: `${(item.expense / chartMax) * 100}%` }}
                      title={
                        id
                          ? `Kas keluar ${item.expense} juta`
                          : `Cash outflow IDR ${item.expense} million`
                      }
                    />
                  </div>
                  <strong>{item.month}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="panel profit-project-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">{id ? "KONTRIBUSI KAS" : "CASH CONTRIBUTION"}</span>
              <h2>{id ? "Per proyek" : "By project"}</h2>
            </div>
            <BarChart3 size={19} />
          </div>
          <div className="project-profit-list">
            {projectCashFlow.slice(0, 5).map((item, index) => (
              <div key={item.name}>
                <span className="profit-rank">{index + 1}</span>
                <div>
                  <strong>{item.name}</strong>
                  <span>{id ? "Rasio kas" : "Cash ratio"} {item.ratio.toFixed(1)}%</span>
                </div>
                <strong>{formatCompactCurrency(item.netCash, language)}</strong>
              </div>
            ))}
            {!projectCashFlow.length ? (
              <div className="empty-state compact">
                <span>{id ? "Belum ada transaksi proyek." : "No project transactions yet."}</span>
              </div>
            ) : null}
          </div>
          <div className="profit-insight">
            <TrendingUp size={18} />
            <div>
              <strong>{id ? "Ringkasan arus kas" : "Cash flow summary"}</strong>
              <span>
                {id
                  ? "Nilai ini berasal dari transaksi Invoice, SPK, mutasi bank, dan pencatatan manual; bukan laporan laba rugi akuntansi."
                  : "These values come from Invoice, Work Order, bank, and manual transactions; they are not an accounting profit-and-loss statement."}
              </span>
            </div>
          </div>
        </aside>
      </section>

      <section className="panel transaction-panel">
        <div className="panel-head transaction-head">
          <div>
            <span className="eyebrow">{id ? "BUKU KAS" : "CASH LEDGER"}</span>
            <h2>{id ? "Riwayat transaksi" : "Transaction history"}</h2>
          </div>
          <div className="project-tools">
            <label className="search-field compact">
              <Search size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={id ? "Cari transaksi..." : "Search transactions..."}
              />
            </label>
            <button
              className={`button subtle small ${filterOpen ? "active" : ""}`}
              type="button"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((value) => !value)}
            >
              <Filter size={15} /> Filter
            </button>
            {filterOpen ? (
              <label className="select-compact">
                <select
                  aria-label={id ? "Filter jenis transaksi" : "Filter transaction type"}
                  value={typeFilter}
                  onChange={(event) =>
                    setTypeFilter(event.target.value as typeof typeFilter)
                  }
                >
                  <option value="Semua">{id ? "Semua" : "All"}</option>
                  <option value="Pemasukan">{id ? "Pemasukan" : "Income"}</option>
                  <option value="Pengeluaran">{id ? "Pengeluaran" : "Expense"}</option>
                </select>
                <ChevronDown size={14} />
              </label>
            ) : null}
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table transaction-table">
            <thead>
              <tr>
                <th>{id ? "Tanggal" : "Date"}</th>
                <th>{id ? "Transaksi" : "Transaction"}</th>
                <th>{id ? "Proyek" : "Project"}</th>
                <th>{id ? "Kategori" : "Category"}</th>
                <th>{id ? "Sumber" : "Source"}</th>
                <th>{id ? "Nominal" : "Amount"}</th>
                {canManage ? (
                  <th>
                    <span className="sr-only">{id ? "Aksi" : "Actions"}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visibleTransactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{localizedDate(language, transaction.dateIso)}</td>
                  <td>
                    <div className="transaction-name">
                      <span
                        className={`transaction-icon ${transaction.type === "Pemasukan" ? "income" : "expense"}`}
                      >
                        {transaction.type === "Pemasukan"
                          ? <ArrowDownRight size={16} />
                          : <ArrowUpRight size={16} />}
                      </span>
                      <div>
                        <strong>{transaction.description}</strong>
                        <small>{localizedLabel(language, transaction.type)}</small>
                        {countsAsCash(transaction) ? null : (
                          <span className="status-badge warning">
                            {id
                              ? "Belum direkonsiliasi — belum dihitung sebagai kas"
                              : "Unreconciled — not counted as cash"}
                          </span>
                        )}
                        {transaction.evidence ? <button className="transaction-evidence-link" type="button" onClick={() => openEvidenceForTransaction(transaction)}><FileCheck2 size={12} /> {id ? "Lihat bukti" : "View evidence"}</button> : null}
                      </div>
                    </div>
                  </td>
                  <td>{!id && transaction.project === "Umum" ? "General" : transaction.project}</td>
                  <td>{categoryLabel(language, transaction.categoryKey ?? transaction.category)}</td>
                  <td><span className="source-badge">{transaction.source}</span></td>
                  <td className={transaction.type === "Pemasukan" ? "amount-income" : "amount-expense"}>
                    {transaction.type === "Pemasukan" ? "+" : "−"}
                    {formatCurrency(transaction.amount, language)}
                  </td>
                  {canManage ? (
                    <td>
                      {transaction.editable ? (
                        <div className="table-row-actions">
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={id ? "Edit transaksi" : "Edit transaction"}
                            onClick={() => editTransaction(transaction)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button danger"
                            type="button"
                            aria-label={id ? "Hapus transaksi" : "Delete transaction"}
                            onClick={() => deleteTransaction(transaction)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ) : (
                        <span
                          className="status-badge neutral"
                          title={
                            id
                              ? "Transaksi sistem dikoreksi dari dokumen atau rekonsiliasi asal."
                              : "System transactions are corrected from their source document or reconciliation."
                          }
                        >
                          {id ? "Sistem" : "System"}
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleTransactions.length ? (
            <div className="empty-state">
              <ReceiptText size={24} />
              <strong>{id ? "Tidak ada transaksi pada periode ini" : "No transactions in this period"}</strong>
              <span>{id ? "Ubah periode atau filter untuk melihat data lain." : "Change the period or filters to see other data."}</span>
            </div>
          ) : null}
        </div>
      </section>

      {showTransactionForm ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowTransactionForm(false)}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-form-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{editingTransactionId ? (id ? "KOREKSI TRANSAKSI" : "TRANSACTION CORRECTION") : (id ? "TRANSAKSI BARU" : "NEW TRANSACTION")}</span>
                <h2 id="transaction-form-title">{editingTransactionId ? (id ? "Perbaiki pencatatan manual" : "Correct a manual entry") : (id ? "Catat aliran kas" : "Record cash flow")}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={id ? "Tutup" : "Close"}
                onClick={() => setShowTransactionForm(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form className="form-grid" onSubmit={addTransaction}>
              <div className="transaction-type-switch full">
                <button
                  className={transactionType === "Pemasukan" ? "active income" : ""}
                  type="button"
                  onClick={() => chooseTransactionType("Pemasukan")}
                >
                  <ArrowDownRight size={17} /> {id ? "Pemasukan" : "Income"}
                </button>
                <button
                  className={transactionType === "Pengeluaran" ? "active expense" : ""}
                  type="button"
                  onClick={() => chooseTransactionType("Pengeluaran")}
                >
                  <ArrowUpRight size={17} /> {id ? "Pengeluaran" : "Expense"}
                </button>
              </div>
              <label className="field">
                <span>{id ? "Tanggal transaksi" : "Transaction date"}</span>
                <input
                  type="date"
                  required
                  max={serverToday || undefined}
                  value={transactionDate}
                  onChange={(event) => setTransactionDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>{id ? "Kategori" : "Category"}</span>
                <select
                  required
                  value={transactionCategory}
                  onChange={(event) => setTransactionCategory(event.target.value)}
                >
                  {transactionCategories.map((category) => (
                    <option value={category} key={category}>
                      {categoryLabel(language, category)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field full">
                <span>{id ? "Proyek terkait" : "Related project"}</span>
                <select
                  required
                  value={transactionProjectId}
                  onChange={(event) => setTransactionProjectId(event.target.value)}
                >
                  <option value="">{id ? "Pilih proyek" : "Select project"}</option>
                  {projects.map((projectItem) => (
                    <option value={projectItem.id} key={projectItem.id}>
                      {projectItem.code} · {projectItem.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field full">
                <span>{id ? "Deskripsi transaksi" : "Transaction description"}</span>
                <input
                  required
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={
                    id
                      ? "Contoh: Pembayaran invoice DP"
                      : "Example: Invoice down payment"
                  }
                />
              </label>
              <label className="field full">
                <span>{id ? "Nominal" : "Amount"}</span>
                <input
                  type="number"
                  min="1"
                  required
                  value={amount || ""}
                  onChange={(event) => setAmount(Number(event.target.value))}
                  placeholder="0"
                />
              </label>
              <div className="transaction-preview full">
                <WalletCards size={18} />
                <div>
                  <span>
                    {localizedLabel(language, transactionType)} ·{" "}
                    {categoryLabel(language, transactionCategory)}
                  </span>
                  <strong>{formatCurrency(amount, language)}</strong>
                </div>
              </div>
              <div className="modal-actions full">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setShowTransactionForm(false)}
                >
                  {id ? "Batal" : "Cancel"}
                </button>
                <button className="button primary" type="submit">
                  {editingTransactionId ? <Pencil size={16} /> : <Plus size={16} />} {editingTransactionId ? (id ? "Simpan koreksi" : "Save correction") : (id ? "Simpan transaksi" : "Save transaction")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      </>}
    </div>
  );
}
