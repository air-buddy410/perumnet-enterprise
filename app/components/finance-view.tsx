"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  ChevronDown,
  CircleDollarSign,
  Download,
  Filter,
  Plus,
  ReceiptText,
  Search,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import {
  formatCompactCurrency,
  formatCurrency,
  Project,
  Transaction,
} from "../data";
import { type AppLanguage, localizedDate, localizedLabel } from "../i18n";

interface FinanceViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projectId?: string;
  projects: Project[];
  canManage: boolean;
}

export function FinanceView({ language, notify, projectId, projects, canManage }: FinanceViewProps) {
  const id = language === "id";
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [period, setPeriod] = useState("6 bulan");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"Semua" | Transaction["type"]>("Semua");
  const [filterOpen, setFilterOpen] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [transactionType, setTransactionType] = useState<Transaction["type"]>("Pemasukan");
  const [transactionProjectId, setTransactionProjectId] = useState(projectId ?? "");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    let active = true;
    api<Transaction[]>(`/api/transactions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`)
      .then((data) => {
        if (active) setTransactions(data);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify, projectId]);

  const totals = useMemo(() => {
    const income = transactions
      .filter((transaction) => transaction.type === "Pemasukan")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const expense = transactions
      .filter((transaction) => transaction.type === "Pengeluaran")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    return { income, expense, profit: income - expense };
  }, [transactions]);

  const chartData = useMemo(() => {
    const months = new Map<string, { income: number; expense: number }>();
    for (const transaction of transactions) {
      const key = transaction.dateIso?.slice(0, 7);
      if (!key) continue;
      const current = months.get(key) ?? { income: 0, expense: 0 };
      if (transaction.type === "Pemasukan") current.income += transaction.amount;
      else current.expense += transaction.amount;
      months.set(key, current);
    }
    return Array.from(months.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-6)
      .map(([month, values]) => ({
        month: new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", {
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${month}-01T00:00:00.000Z`)),
        income: values.income / 1_000_000,
        expense: values.expense / 1_000_000,
      }));
  }, [language, transactions]);

  const projectProfits = useMemo(() => {
    const grouped = new Map<string, { income: number; expense: number }>();
    for (const transaction of transactions) {
      const current = grouped.get(transaction.project) ?? { income: 0, expense: 0 };
      if (transaction.type === "Pemasukan") current.income += transaction.amount;
      else current.expense += transaction.amount;
      grouped.set(transaction.project, current);
    }
    return Array.from(grouped.entries())
      .map(([name, values]) => ({
        name,
        profit: values.income - values.expense,
        margin: values.income
          ? ((values.income - values.expense) / values.income) * 100
          : 0,
      }))
      .sort((left, right) => right.profit - left.profit);
  }, [transactions]);
  const chartMax = Math.max(
    1,
    ...chartData.flatMap((item) => [item.income, item.expense]),
  );

  const visibleTransactions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return transactions.filter(
      (transaction) =>
        (typeFilter === "Semua" || transaction.type === typeFilter) &&
        (!normalized ||
        [transaction.project, transaction.description, transaction.source]
          .join(" ")
          .toLowerCase()
          .includes(normalized)),
    );
  }, [query, transactions, typeFilter]);

  async function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || amount <= 0) return;
    if (!transactionProjectId) {
      notify(id ? "Pilih proyek untuk transaksi ini." : "Select a project for this transaction.");
      return;
    }
    try {
      const transaction = await api<Transaction>("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          projectId: transactionProjectId,
          date: new Date().toISOString().slice(0, 10),
          type: transactionType,
          description: description.trim(),
          amount,
          source: transactionType === "Pemasukan" ? "Manual" : "Operasional",
        }),
      });
      setTransactions((current) => [transaction, ...current]);
      setDescription("");
      setAmount(0);
      setShowTransactionForm(false);
      notify(id ? "Transaksi berhasil dicatat." : "Transaction recorded.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function exportReport() {
    try {
      const query = projectId
        ? `?projectId=${encodeURIComponent(projectId)}`
        : "";
      await downloadApiFile(
        `/api/transactions/report.pdf${query}`,
        id ? "Laporan-Keuangan-PerumNet.pdf" : "PerumNet-Financial-Report.pdf",
      );
      notify(id ? "Laporan keuangan PDF berhasil diekspor." : "Financial report PDF exported.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function exportCsv() {
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      await downloadApiFile(
        `/api/transactions/report.csv${query}`,
        id ? "Laporan-Keuangan-PerumNet.csv" : "PerumNet-Financial-Report.csv",
      );
      notify(id ? "Laporan keuangan CSV berhasil diekspor." : "Financial report CSV exported.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack" data-testid="finance-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">{id ? "KEUANGAN PROYEK" : "PROJECT FINANCE"}</span>
          <h1>{id ? "Pembukuan" : "Finance"}</h1>
          <p>{id ? "Pantau arus kas, laba rugi, dan transaksi setiap proyek." : "Monitor cash flow, profit and loss, and project transactions."}</p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={exportReport}>
            <Download size={16} /> {id ? "Ekspor PDF" : "Export PDF"}
          </button>
          <button className="button secondary" type="button" onClick={exportCsv}>
            <Download size={16} /> {id ? "Ekspor CSV" : "Export CSV"}
          </button>
          {canManage && <button className="button primary" type="button" onClick={() => { setTransactionProjectId(projectId || projects[0]?.id || ""); setShowTransactionForm(true); }}>
            <Plus size={16} /> {id ? "Catat transaksi" : "Record transaction"}
          </button>}
        </div>
      </section>

      <section className="finance-kpi-grid">
        <article className="finance-kpi income">
          <div className="finance-kpi-head"><span>{id ? "Total pemasukan" : "Total income"}</span><span className="metric-icon green"><ArrowDownRight size={19} /></span></div>
          <strong>{formatCurrency(totals.income, language)}</strong>
          <div><span className="metric-change positive"><TrendingUp size={13} /> 12.4%</span><small>{id ? "dari periode lalu" : "from previous period"}</small></div>
        </article>
        <article className="finance-kpi expense">
          <div className="finance-kpi-head"><span>{id ? "Total pengeluaran" : "Total expenses"}</span><span className="metric-icon orange"><ArrowUpRight size={19} /></span></div>
          <strong>{formatCurrency(totals.expense, language)}</strong>
          <div><span className="metric-change warning-text">8.1%</span><small>{id ? "dari periode lalu" : "from previous period"}</small></div>
        </article>
        <article className="finance-kpi profit">
          <div className="finance-kpi-head"><span>{id ? "Laba bersih" : "Net profit"}</span><span className="metric-icon teal"><CircleDollarSign size={19} /></span></div>
          <strong>{formatCurrency(totals.profit, language)}</strong>
          <div><span className={`metric-change ${totals.profit >= 0 ? "positive" : "negative"}`}>{totals.income ? ((totals.profit / totals.income) * 100).toFixed(1) : 0}% margin</span><small>{id ? "periode berjalan" : "current period"}</small></div>
        </article>
        <article className="finance-kpi receivable">
          <div className="finance-kpi-head"><span>{id ? "Transaksi tercatat" : "Recorded transactions"}</span><span className="metric-icon blue"><ReceiptText size={19} /></span></div>
          <strong>{transactions.length}</strong>
          <div><span className="metric-change">{projectId ? (id ? "Proyek aktif" : "Active project") : (id ? "Semua proyek" : "All projects")}</span><small>{id ? "sesuai otoritas akun" : "within account authority"}</small></div>
        </article>
      </section>

      <section className="finance-layout">
        <div className="panel cashflow-panel">
          <div className="panel-head">
            <div><span className="eyebrow">{id ? "ARUS KAS" : "CASH FLOW"}</span><h2>{id ? "Pemasukan vs pengeluaran" : "Income vs expenses"}</h2></div>
            <label className="select-compact">
              <CalendarRange size={15} />
              <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                <option value="3 bulan">{id ? "3 bulan" : "3 months"}</option><option value="6 bulan">{id ? "6 bulan" : "6 months"}</option><option value="12 bulan">{id ? "12 bulan" : "12 months"}</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          <div className="chart-legend">
            <span><i className="legend-dot income" /> {id ? "Pemasukan" : "Income"}</span>
            <span><i className="legend-dot expense" /> {id ? "Pengeluaran" : "Expenses"}</span>
            <small>{id ? "Dalam juta rupiah" : "In millions of rupiah"}</small>
          </div>
          <div className="bar-chart" aria-label={id ? `Grafik arus kas ${period}` : `Cash flow chart ${period.replace("bulan", "months")}`}>
            <div className="chart-y-axis"><span>{Math.ceil(chartMax)}</span><span>{Math.ceil(chartMax * 0.67)}</span><span>{Math.ceil(chartMax * 0.33)}</span><span>0</span></div>
            <div className="chart-plot">
              <div className="chart-grid-lines"><span /><span /><span /><span /></div>
              {chartData.map((item) => (
                <div className="chart-group" key={item.month}>
                  <div className="chart-bars">
                    <span className="chart-bar income" style={{ height: `${(item.income / chartMax) * 100}%` }} title={id ? `Pemasukan ${item.income} juta` : `Income IDR ${item.income} million`} />
                    <span className="chart-bar expense" style={{ height: `${(item.expense / chartMax) * 100}%` }} title={id ? `Pengeluaran ${item.expense} juta` : `Expenses IDR ${item.expense} million`} />
                  </div>
                  <strong>{item.month}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="panel profit-project-panel">
          <div className="panel-head"><div><span className="eyebrow">{id ? "PROFITABILITAS" : "PROFITABILITY"}</span><h2>{id ? "Per proyek" : "By project"}</h2></div><BarChart3 size={19} /></div>
          <div className="project-profit-list">
            {projectProfits.slice(0, 5).map((item, index) => (
              <div key={item.name}>
                <span className="profit-rank">{index + 1}</span>
                <div><strong>{item.name}</strong><span>Margin {item.margin.toFixed(1)}%</span></div>
                <strong>{formatCompactCurrency(item.profit, language)}</strong>
              </div>
            ))}
            {!projectProfits.length && <div className="empty-state compact"><span>{id ? "Belum ada transaksi proyek." : "No project transactions yet."}</span></div>}
          </div>
          <div className="profit-insight">
            <TrendingUp size={18} />
            <div><strong>{id ? "Ringkasan otomatis" : "Automatic summary"}</strong><span>{id ? "Laba dihitung dari transaksi Invoice, SPK, dan transaksi manual." : "Profit is calculated from Invoice, Work Order, and manual transactions."}</span></div>
          </div>
        </aside>
      </section>

      <section className="panel transaction-panel">
        <div className="panel-head transaction-head">
          <div><span className="eyebrow">{id ? "BUKU KAS" : "CASH LEDGER"}</span><h2>{id ? "Riwayat transaksi" : "Transaction history"}</h2></div>
          <div className="project-tools">
            <label className="search-field compact"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari transaksi..." : "Search transactions..."} /></label>
            <button className={`button subtle small ${filterOpen ? "active" : ""}`} type="button" aria-expanded={filterOpen} onClick={() => setFilterOpen((value) => !value)}><Filter size={15} /> {id ? "Filter" : "Filter"}</button>
            {filterOpen && <label className="select-compact"><select aria-label={id ? "Filter jenis transaksi" : "Filter transaction type"} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="Semua">{id ? "Semua" : "All"}</option><option value="Pemasukan">{id ? "Pemasukan" : "Income"}</option><option value="Pengeluaran">{id ? "Pengeluaran" : "Expense"}</option></select><ChevronDown size={14} /></label>}
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table transaction-table">
            <thead><tr><th>{id ? "Tanggal" : "Date"}</th><th>{id ? "Transaksi" : "Transaction"}</th><th>{id ? "Proyek" : "Project"}</th><th>{id ? "Sumber" : "Source"}</th><th>{id ? "Nominal" : "Amount"}</th></tr></thead>
            <tbody>
              {visibleTransactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{localizedDate(language, transaction.dateIso)}</td>
                  <td>
                    <div className="transaction-name">
                      <span className={`transaction-icon ${transaction.type === "Pemasukan" ? "income" : "expense"}`}>
                        {transaction.type === "Pemasukan" ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                      </span>
                      <div><strong>{transaction.description}</strong><small>{localizedLabel(language, transaction.type)}</small></div>
                    </div>
                  </td>
                  <td>{!id && transaction.project === "Umum" ? "General" : transaction.project}</td>
                  <td><span className="source-badge">{transaction.source}</span></td>
                  <td className={transaction.type === "Pemasukan" ? "amount-income" : "amount-expense"}>
                    {transaction.type === "Pemasukan" ? "+" : "−"}{formatCurrency(transaction.amount, language)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showTransactionForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowTransactionForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="transaction-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "TRANSAKSI BARU" : "NEW TRANSACTION"}</span><h2 id="transaction-form-title">{id ? "Catat aliran kas" : "Record cash flow"}</h2></div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setShowTransactionForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={addTransaction}>
              <div className="transaction-type-switch full">
                <button className={transactionType === "Pemasukan" ? "active income" : ""} type="button" onClick={() => setTransactionType("Pemasukan")}><ArrowDownRight size={17} /> {id ? "Pemasukan" : "Income"}</button>
                <button className={transactionType === "Pengeluaran" ? "active expense" : ""} type="button" onClick={() => setTransactionType("Pengeluaran")}><ArrowUpRight size={17} /> {id ? "Pengeluaran" : "Expense"}</button>
              </div>
              <label className="field full"><span>{id ? "Proyek terkait" : "Related project"}</span><select required value={transactionProjectId} onChange={(event) => setTransactionProjectId(event.target.value)}><option value="">{id ? "Pilih proyek" : "Select project"}</option>{projects.map((projectItem) => <option value={projectItem.id} key={projectItem.id}>{projectItem.code} · {projectItem.name}</option>)}</select></label>
              <label className="field full"><span>{id ? "Deskripsi transaksi" : "Transaction description"}</span><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder={id ? "Contoh: Pembayaran invoice DP" : "Example: Down payment invoice"} /></label>
              <label className="field full"><span>{id ? "Nominal" : "Amount"}</span><input type="number" min="1" required value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} placeholder="0" /></label>
              <div className="transaction-preview full"><WalletCards size={18} /><div><span>{localizedLabel(language, transactionType)}</span><strong>{formatCurrency(amount, language)}</strong></div></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowTransactionForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><Plus size={16} /> {id ? "Simpan transaksi" : "Save transaction"}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
