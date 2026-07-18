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
import { api, messageOf } from "../api-client";
import {
  formatCompactCurrency,
  formatCurrency,
  Project,
  Transaction,
} from "../data";

interface FinanceViewProps {
  notify: (message: string) => void;
  projectId?: string;
  projects: Project[];
  canManage: boolean;
}

export function FinanceView({ notify, projectId, projects, canManage }: FinanceViewProps) {
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
      .catch((error) => notify(messageOf(error)));
    return () => {
      active = false;
    };
  }, [notify, projectId]);

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
        month: new Intl.DateTimeFormat("id-ID", {
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${month}-01T00:00:00.000Z`)),
        income: values.income / 1_000_000,
        expense: values.expense / 1_000_000,
      }));
  }, [transactions]);

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
      notify("Pilih proyek untuk transaksi ini.");
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
      notify("Transaksi berhasil dicatat.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  function exportReport() {
    const rows = [
      "Tanggal,Jenis,Proyek,Deskripsi,Nominal",
      ...transactions.map((transaction) =>
        [transaction.date, transaction.type, transaction.project, transaction.description, transaction.amount]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Laporan-Keuangan-PerumNet.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Laporan transaksi berhasil diekspor.");
  }

  return (
    <div className="page-stack" data-testid="finance-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">KEUANGAN PROYEK</span>
          <h1>Pembukuan</h1>
          <p>Pantau arus kas, laba rugi, dan transaksi setiap proyek.</p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={exportReport}>
            <Download size={16} /> Ekspor laporan
          </button>
          {canManage && <button className="button primary" type="button" onClick={() => { setTransactionProjectId(projectId || projects[0]?.id || ""); setShowTransactionForm(true); }}>
            <Plus size={16} /> Catat transaksi
          </button>}
        </div>
      </section>

      <section className="finance-kpi-grid">
        <article className="finance-kpi income">
          <div className="finance-kpi-head"><span>Total pemasukan</span><span className="metric-icon green"><ArrowDownRight size={19} /></span></div>
          <strong>{formatCurrency(totals.income)}</strong>
          <div><span className="metric-change positive"><TrendingUp size={13} /> 12,4%</span><small>dari periode lalu</small></div>
        </article>
        <article className="finance-kpi expense">
          <div className="finance-kpi-head"><span>Total pengeluaran</span><span className="metric-icon orange"><ArrowUpRight size={19} /></span></div>
          <strong>{formatCurrency(totals.expense)}</strong>
          <div><span className="metric-change warning-text">8,1%</span><small>dari periode lalu</small></div>
        </article>
        <article className="finance-kpi profit">
          <div className="finance-kpi-head"><span>Laba bersih</span><span className="metric-icon teal"><CircleDollarSign size={19} /></span></div>
          <strong>{formatCurrency(totals.profit)}</strong>
          <div><span className={`metric-change ${totals.profit >= 0 ? "positive" : "negative"}`}>{totals.income ? ((totals.profit / totals.income) * 100).toFixed(1) : 0}% margin</span><small>periode berjalan</small></div>
        </article>
        <article className="finance-kpi receivable">
          <div className="finance-kpi-head"><span>Transaksi tercatat</span><span className="metric-icon blue"><ReceiptText size={19} /></span></div>
          <strong>{transactions.length}</strong>
          <div><span className="metric-change">{projectId ? "Proyek aktif" : "Semua proyek"}</span><small>sesuai otoritas akun</small></div>
        </article>
      </section>

      <section className="finance-layout">
        <div className="panel cashflow-panel">
          <div className="panel-head">
            <div><span className="eyebrow">ARUS KAS</span><h2>Pemasukan vs pengeluaran</h2></div>
            <label className="select-compact">
              <CalendarRange size={15} />
              <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                <option>3 bulan</option><option>6 bulan</option><option>12 bulan</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          <div className="chart-legend">
            <span><i className="legend-dot income" /> Pemasukan</span>
            <span><i className="legend-dot expense" /> Pengeluaran</span>
            <small>Dalam juta rupiah</small>
          </div>
          <div className="bar-chart" aria-label={`Grafik arus kas ${period}`}>
            <div className="chart-y-axis"><span>{Math.ceil(chartMax)}</span><span>{Math.ceil(chartMax * 0.67)}</span><span>{Math.ceil(chartMax * 0.33)}</span><span>0</span></div>
            <div className="chart-plot">
              <div className="chart-grid-lines"><span /><span /><span /><span /></div>
              {chartData.map((item) => (
                <div className="chart-group" key={item.month}>
                  <div className="chart-bars">
                    <span className="chart-bar income" style={{ height: `${(item.income / chartMax) * 100}%` }} title={`Pemasukan ${item.income} juta`} />
                    <span className="chart-bar expense" style={{ height: `${(item.expense / chartMax) * 100}%` }} title={`Pengeluaran ${item.expense} juta`} />
                  </div>
                  <strong>{item.month}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="panel profit-project-panel">
          <div className="panel-head"><div><span className="eyebrow">PROFITABILITAS</span><h2>Per proyek</h2></div><BarChart3 size={19} /></div>
          <div className="project-profit-list">
            {projectProfits.slice(0, 5).map((item, index) => (
              <div key={item.name}>
                <span className="profit-rank">{index + 1}</span>
                <div><strong>{item.name}</strong><span>Margin {item.margin.toFixed(1)}%</span></div>
                <strong>{formatCompactCurrency(item.profit)}</strong>
              </div>
            ))}
            {!projectProfits.length && <div className="empty-state compact"><span>Belum ada transaksi proyek.</span></div>}
          </div>
          <div className="profit-insight">
            <TrendingUp size={18} />
            <div><strong>Ringkasan otomatis</strong><span>Laba dihitung dari transaksi Invoice, SPK, dan transaksi manual.</span></div>
          </div>
        </aside>
      </section>

      <section className="panel transaction-panel">
        <div className="panel-head transaction-head">
          <div><span className="eyebrow">BUKU KAS</span><h2>Riwayat transaksi</h2></div>
          <div className="project-tools">
            <label className="search-field compact"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari transaksi..." /></label>
            <button className={`button subtle small ${filterOpen ? "active" : ""}`} type="button" aria-expanded={filterOpen} onClick={() => setFilterOpen((value) => !value)}><Filter size={15} /> Filter</button>
            {filterOpen && <label className="select-compact"><select aria-label="Filter jenis transaksi" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option>Semua</option><option>Pemasukan</option><option>Pengeluaran</option></select><ChevronDown size={14} /></label>}
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table transaction-table">
            <thead><tr><th>Tanggal</th><th>Transaksi</th><th>Proyek</th><th>Sumber</th><th>Nominal</th></tr></thead>
            <tbody>
              {visibleTransactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.date}</td>
                  <td>
                    <div className="transaction-name">
                      <span className={`transaction-icon ${transaction.type === "Pemasukan" ? "income" : "expense"}`}>
                        {transaction.type === "Pemasukan" ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                      </span>
                      <div><strong>{transaction.description}</strong><small>{transaction.type}</small></div>
                    </div>
                  </td>
                  <td>{transaction.project}</td>
                  <td><span className="source-badge">{transaction.source}</span></td>
                  <td className={transaction.type === "Pemasukan" ? "amount-income" : "amount-expense"}>
                    {transaction.type === "Pemasukan" ? "+" : "−"}{formatCurrency(transaction.amount)}
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
              <div><span className="eyebrow">TRANSAKSI BARU</span><h2 id="transaction-form-title">Catat aliran kas</h2></div>
              <button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowTransactionForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={addTransaction}>
              <div className="transaction-type-switch full">
                <button className={transactionType === "Pemasukan" ? "active income" : ""} type="button" onClick={() => setTransactionType("Pemasukan")}><ArrowDownRight size={17} /> Pemasukan</button>
                <button className={transactionType === "Pengeluaran" ? "active expense" : ""} type="button" onClick={() => setTransactionType("Pengeluaran")}><ArrowUpRight size={17} /> Pengeluaran</button>
              </div>
              <label className="field full"><span>Proyek terkait</span><select required value={transactionProjectId} onChange={(event) => setTransactionProjectId(event.target.value)}><option value="">Pilih proyek</option>{projects.map((projectItem) => <option value={projectItem.id} key={projectItem.id}>{projectItem.code} · {projectItem.name}</option>)}</select></label>
              <label className="field full"><span>Deskripsi transaksi</span><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Contoh: Pembayaran invoice DP" /></label>
              <label className="field full"><span>Nominal</span><input type="number" min="1" required value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} placeholder="0" /></label>
              <div className="transaction-preview full"><WalletCards size={18} /><div><span>{transactionType}</span><strong>{formatCurrency(amount)}</strong></div></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowTransactionForm(false)}>Batal</button><button className="button primary" type="submit"><Plus size={16} /> Simpan transaksi</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
