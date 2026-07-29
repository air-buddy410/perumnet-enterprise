"use client";

import {
  CheckCircle2,
  CircleDollarSign,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { formatCurrency, Project } from "../data";
import { type AppLanguage } from "../i18n";

interface ProfitAllocation {
  id: string;
  projectId: string;
  recipientName: string;
  percentage: number;
  amount: number;
  status: "Draft" | "Approved" | "Paid" | "Void";
  notes: string;
  paidDate?: string;
}

interface ProfitSummary {
  project: Pick<Project, "id" | "code" | "name" | "client">;
  income: number;
  expense: number;
  netProfit: number;
  committedVendorCost: number;
  paidVendorCost: number;
  outstandingVendorCommitment: number;
  distributableProfit: number;
  allocatedPercentage: number;
  allocatedAmount: number;
  paidAmount: number;
  retainedProfit: number;
  allocations: ProfitAllocation[];
}

interface ProfitSharingPanelProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projects: Project[];
  initialProjectId?: string;
  canApprove: boolean;
  serverToday: string;
}

function statusLabel(language: AppLanguage, status: ProfitAllocation["status"]) {
  if (language === "en") return status;
  return {
    Draft: "Draft",
    Approved: "Disetujui",
    Paid: "Dibayar",
    Void: "Dibatalkan",
  }[status];
}

export function ProfitSharingPanel({
  language,
  notify,
  projects,
  initialProjectId,
  canApprove,
  serverToday,
}: ProfitSharingPanelProps) {
  const id = language === "id";
  const [projectId, setProjectId] = useState(
    initialProjectId || projects[0]?.id || "",
  );
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [percentage, setPercentage] = useState(0);
  const [notes, setNotes] = useState("");
  const [paying, setPaying] = useState<ProfitAllocation | null>(null);
  const [paidDate, setPaidDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setSummary(null);
      return;
    }
    setSummary(
      await api<ProfitSummary>(
        `/api/profit-shares?projectId=${encodeURIComponent(projectId)}`,
      ),
    );
  }, [projectId]);

  useEffect(() => {
    const update = window.setTimeout(() => {
      void load().catch((error) => notify(messageOf(error, language)));
    }, 0);
    return () => window.clearTimeout(update);
  }, [language, load, notify]);

  const remainingPercentage = useMemo(
    () => Math.max(0, 100 - (summary?.allocatedPercentage ?? 0)),
    [summary?.allocatedPercentage],
  );

  async function createAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setBusy(true);
    try {
      await api("/api/profit-shares", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          recipientName: recipientName.trim(),
          percentage,
          notes: notes.trim(),
        }),
      });
      await load();
      setRecipientName("");
      setPercentage(0);
      setNotes("");
      setShowForm(false);
      notify(
        id
          ? "Draft pembagian keuntungan ditambahkan. Admin harus menyetujuinya sebelum pembayaran."
          : "Profit-share draft added. An Admin must approve it before payment.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy(false);
    }
  }

  async function action(
    allocation: ProfitAllocation,
    nextAction: "approve" | "void",
  ) {
    if (
      nextAction === "void" &&
      !window.confirm(
        id
          ? `Batalkan pembagian untuk ${allocation.recipientName}?`
          : `Void the allocation for ${allocation.recipientName}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/profit-shares/${allocation.id}/${nextAction}`, {
        method: "POST",
      });
      await load();
      notify(
        nextAction === "approve"
          ? id
            ? "Pembagian keuntungan disetujui dan nominalnya dikunci."
            : "The profit share was approved and its amount locked."
          : id
            ? "Pembagian keuntungan dibatalkan dan arus kas terkait dikoreksi."
            : "The profit share was voided and related cash flow corrected.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft(allocation: ProfitAllocation) {
    if (
      !window.confirm(
        id
          ? `Hapus draft pembagian untuk ${allocation.recipientName}?`
          : `Delete the draft allocation for ${allocation.recipientName}?`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/profit-shares/${allocation.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paying || !paidDate) return;
    setBusy(true);
    try {
      await api(`/api/profit-shares/${paying.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ paidDate }),
      });
      await load();
      setPaying(null);
      setPaidDate("");
      notify(
        id
          ? "Pembayaran bagi hasil dicatat sebagai kas keluar proyek."
          : "The profit-share payment was recorded as a project cash outflow.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel profit-sharing-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">
              {id ? "DISTRIBUSI LABA PROYEK" : "PROJECT PROFIT DISTRIBUTION"}
            </span>
            <h2>{id ? "Pembagian keuntungan" : "Profit sharing"}</h2>
            <p>
              {id
                ? "Laba yang boleh dibagikan dikurangi komitmen vendor aktif yang belum dibayar. Dengan begitu kas untuk kewajiban SPK/PO tetap terlindungi."
                : "Distributable profit deducts unpaid active vendor commitments, protecting the cash reserved for Work Orders and Purchase Orders."}
            </p>
          </div>
          <div className="title-actions">
            <label className="select-compact">
              <select
                aria-label={id ? "Pilih proyek pembagian laba" : "Choose profit-sharing project"}
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.code} · {project.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button primary small"
              type="button"
              disabled={!projectId || remainingPercentage <= 0}
              onClick={() => setShowForm(true)}
            >
              <Plus size={15} /> {id ? "Tambah penerima" : "Add recipient"}
            </button>
          </div>
        </div>

        {summary ? (
          <>
            <div className="profit-summary-grid">
              <div>
                <span>{id ? "Kas masuk proyek" : "Project inflow"}</span>
                <strong>{formatCurrency(summary.income, language)}</strong>
              </div>
              <div>
                <span>{id ? "Biaya dasar" : "Base expenses"}</span>
                <strong>{formatCurrency(summary.expense, language)}</strong>
              </div>
              <div className={summary.netProfit >= 0 ? "positive" : "negative"}>
                <span>{id ? "Laba bersih dasar" : "Base net profit"}</span>
                <strong>{formatCurrency(summary.netProfit, language)}</strong>
              </div>
              <div>
                <span>
                  {id ? "Komitmen vendor belum dibayar" : "Unpaid vendor commitments"}
                </span>
                <strong>
                  {formatCurrency(summary.outstandingVendorCommitment, language)}
                </strong>
              </div>
              <div
                className={
                  summary.distributableProfit >= 0 ? "positive" : "negative"
                }
              >
                <span>{id ? "Laba aman dibagikan" : "Safe distributable profit"}</span>
                <strong>
                  {formatCurrency(summary.distributableProfit, language)}
                </strong>
              </div>
              <div>
                <span>{id ? "Laba ditahan" : "Retained profit"}</span>
                <strong>{formatCurrency(summary.retainedProfit, language)}</strong>
              </div>
            </div>

            <div className="profit-allocation-head">
              <span>
                {summary.allocatedPercentage.toFixed(2)}%{" "}
                {id ? "dialokasikan" : "allocated"}
              </span>
              <strong>
                {formatCurrency(summary.allocatedAmount, language)}
              </strong>
            </div>
            <div className="profit-allocation-meter">
              <span
                style={{
                  width: `${Math.min(100, summary.allocatedPercentage)}%`,
                }}
              />
            </div>

            <div className="profit-share-list">
              {summary.allocations.map((allocation) => (
                <article
                  className={`profit-share-row ${allocation.status.toLowerCase()}`}
                  key={allocation.id}
                >
                  <span className="metric-icon teal">
                    <UsersRound size={17} />
                  </span>
                  <div>
                    <strong>{allocation.recipientName}</strong>
                    <small>
                      {allocation.percentage.toFixed(2)}% ·{" "}
                      {allocation.notes ||
                        (id ? "Tanpa catatan" : "No notes")}
                    </small>
                  </div>
                  <strong>{formatCurrency(allocation.amount, language)}</strong>
                  <span className={`status-badge ${allocation.status === "Paid" ? "success" : allocation.status === "Approved" ? "info" : allocation.status === "Void" ? "neutral" : "warning"}`}>
                    {statusLabel(language, allocation.status)}
                  </span>
                  <div className="table-row-actions">
                    {allocation.status === "Draft" && canApprove ? (
                      <button
                        className="button subtle small"
                        type="button"
                        disabled={busy}
                        onClick={() => action(allocation, "approve")}
                      >
                        <ShieldCheck size={14} /> {id ? "Setujui" : "Approve"}
                      </button>
                    ) : null}
                    {allocation.status === "Approved" ? (
                      <button
                        className="button secondary small"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setPaying(allocation);
                          setPaidDate(serverToday);
                        }}
                      >
                        <CircleDollarSign size={14} /> {id ? "Bayar" : "Pay"}
                      </button>
                    ) : null}
                    {allocation.status === "Draft" ? (
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => deleteDraft(allocation)}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                    {canApprove &&
                    ["Approved", "Paid"].includes(allocation.status) ? (
                      <button
                        className="button subtle small"
                        type="button"
                        disabled={busy}
                        onClick={() => action(allocation, "void")}
                      >
                        <X size={14} /> {id ? "Batalkan" : "Void"}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {!summary.allocations.length ? (
                <div className="empty-state compact">
                  <UsersRound size={24} />
                  <p>
                    {id
                      ? "Belum ada pembagian keuntungan untuk proyek ini."
                      : "No profit allocations for this project yet."}
                  </p>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-state compact">
            <UsersRound size={24} />
            <p>{id ? "Pilih proyek terlebih dahulu." : "Select a project first."}</p>
          </div>
        )}
      </section>

      {showForm ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "PENERIMA BAGI HASIL" : "PROFIT-SHARE RECIPIENT"}</span><h2>{summary?.project.name}</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={createAllocation}>
              <label className="field full"><span>{id ? "Nama penerima" : "Recipient name"}</span><input required minLength={2} value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></label>
              <label className="field"><span>{id ? "Persentase" : "Percentage"}</span><input type="number" min="0.01" max={remainingPercentage} step="0.01" required value={percentage || ""} onChange={(event) => setPercentage(Number(event.target.value))} /></label>
              <label className="field"><span>{id ? "Sisa alokasi" : "Remaining allocation"}</span><input value={`${remainingPercentage.toFixed(2)}%`} readOnly /></label>
              <label className="field full"><span>{id ? "Catatan" : "Notes"}</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={id ? "Contoh: bagian partner instalasi" : "Example: installation partner share"} /></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowForm(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit" disabled={busy}><Plus size={15} /> {id ? "Simpan draft" : "Save draft"}</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {paying ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPaying(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "PEMBAYARAN BAGI HASIL" : "PROFIT-SHARE PAYMENT"}</span><h2>{paying.recipientName}</h2></div>
              <button className="icon-button" type="button" onClick={() => setPaying(null)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={pay}>
              <div className="statement-guidance full"><CheckCircle2 size={18} /><span><strong>{formatCurrency(paying.amount, language)}</strong><small>{id ? "Pembayaran akan masuk sebagai kas keluar proyek dan menunggu rekonsiliasi mutasi bank." : "The payment becomes a project cash outflow and waits for bank reconciliation."}</small></span></div>
              <label className="field full"><span>{id ? "Tanggal pembayaran" : "Payment date"}</span><input type="date" required value={paidDate} onChange={(event) => setPaidDate(event.target.value)} /></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setPaying(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit" disabled={busy}><CircleDollarSign size={15} /> {id ? "Catat pembayaran" : "Record payment"}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
