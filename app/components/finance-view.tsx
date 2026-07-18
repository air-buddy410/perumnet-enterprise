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
  initialTransactions,
  Transaction,
} from "../data";

interface FinanceViewProps {
  notify: (message: string) => void;
  projectId?: string;
}

const chartData = [
  { month: "Feb", income: 82, expense: 51 },
  { month: "Mar", income: 64, expense: 42 },
  { month: "Apr", income: 105, expense: 69 },
  { month: "Mei", income: 91, expense: 57 },
  { month: "Jun", income: 136, expense: 78 },
  { month: "Jul", income: 123, expense: 77 },
];

export function FinanceView({ notify, projectId }: FinanceViewProps) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [period, setPeriod] = useState("6 bulan");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"Semua" | Transaction["type"]>("Semua");
  const [filterOpen, setFilterOpen] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [transactionType, setTransactionType] = useState<Transaction["type"]>("Pemasukan");
  const [project, setProject] = useState("Implementasi WiFi Resort Ubud");
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
    const projectIds: Record<string, string> = {
      "Implementasi WiFi Resort Ubud": "project-1",
      "CCTV & Network Warehouse": "project-2",
      "Managed Service Kantor Cabang": "project-3",
    };
    try {
      const transaction = await api<Transaction>("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          projectId: projectIds[project],
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
          <button className="button primary" type="button" onClick={() => setShowTransactionForm(true)}>
            <Plus size={16} /> Catat transaksi
          </button>
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
          <div className="finance-kpi-head"><span>Piutang berjalan</span><span className="metric-icon blue"><ReceiptText size={19} /></span></div>
          <strong>{formatCurrency(93_725_000)}</strong>
          <div><span className="metric-change warning-text">2 invoice</span><small>menunggu pembayaran</small></div>
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
            <div className="chart-y-axis"><span>150</span><span>100</span><span>50</span><span>0</span></div>
            <div className="chart-plot">
              <div className="chart-grid-lines"><span /><span /><span /><span /></div>
              {chartData.map((item) => (
                <div className="chart-group" key={item.month}>
                  <div className="chart-bars">
                    <span className="chart-bar income" style={{ height: `${(item.income / 150) * 100}%` }} title={`Pemasukan ${item.income} juta`} />
                    <span className="chart-bar expense" style={{ height: `${(item.expense / 150) * 100}%` }} title={`Pengeluaran ${item.expense} juta`} />
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
            <div>
              <span className="profit-rank">1</span>
              <div><strong>WiFi Resort Ubud</strong><span>Margin 31,7%</span></div>
              <strong>{formatCompactCurrency(59_400_000)}</strong>
            </div>
            <div>
              <span className="profit-rank">2</span>
              <div><strong>Fiber Villa Complex</strong><span>Margin 28,4%</span></div>
              <strong>{formatCompactCurrency(40_600_000)}</strong>
            </div>
            <div>
              <span className="profit-rank">3</span>
              <div><strong>CCTV Warehouse</strong><span>Margin 20,1%</span></div>
              <strong>{formatCompactCurrency(19_500_000)}</strong>
            </div>
          </div>
          <div className="profit-insight">
            <TrendingUp size={18} />
            <div><strong>Margin sehat</strong><span>Rata-rata margin proyek 26,7% pada periode ini.</span></div>
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
              <label className="field full"><span>Proyek terkait</span><select value={project} onChange={(event) => setProject(event.target.value)}><option>Implementasi WiFi Resort Ubud</option><option>CCTV & Network Warehouse</option><option>Managed Service Kantor Cabang</option></select></label>
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
