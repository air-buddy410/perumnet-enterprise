"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Landmark,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, messageOf } from "../api-client";
import {
  type BankAccount,
  type BankStatementEntry,
  formatCurrency,
} from "../data";
import { type AppLanguage, localizedDate } from "../i18n";

interface BankingPanelProps {
  language: AppLanguage;
  notify: (message: string) => void;
  canManage: boolean;
  canConfigure: boolean;
  canDeleteEntries: boolean;
  serverToday: string;
  onBalanceChange: (balance: number) => void;
  onLedgerChanged: () => void;
}

interface ImportResult {
  importedCount: number;
  duplicateCount: number;
  matchedCount: number;
  createdCount: number;
  errorCount: number;
  currentBalance: number;
}

interface ReconciliationCandidate {
  id: string;
  date: string;
  description: string;
  type: BankStatementEntry["type"];
  amount: number;
  source: string;
  project: string;
  dayDifference: number;
}

function bankCategoryLabel(language: AppLanguage, category: string) {
  if (language === "id") return category;
  const categories: Record<string, string> = {
    Penjualan: "Sales",
    Operasional: "Operations",
    Vendor: "Vendor",
    Pajak: "Tax",
    Gaji: "Payroll",
    Modal: "Capital",
    Lainnya: "Other",
  };
  return categories[category] ?? category;
}

export function BankingPanel({
  language,
  notify,
  canManage,
  canConfigure,
  canDeleteEntries,
  serverToday,
  onBalanceChange,
  onLedgerChanged,
}: BankingPanelProps) {
  const id = language === "id";
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [entries, setEntries] = useState<BankStatementEntry[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [showImportForm, setShowImportForm] = useState(false);
  const [bankName, setBankName] = useState("BCA");
  const [accountName, setAccountName] = useState("PerumNet Enterprise");
  const [accountNumber, setAccountNumber] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [currency, setCurrency] = useState("IDR");
  const [accountStatus, setAccountStatus] = useState<BankAccount["status"]>("Aktif");
  const [syncMode, setSyncMode] = useState<BankAccount["syncMode"]>("Manual");
  const [externalAccountId, setExternalAccountId] = useState("");
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [statementMonth, setStatementMonth] = useState(
    serverToday.slice(0, 7),
  );
  const [reconcilingEntry, setReconcilingEntry] =
    useState<BankStatementEntry | null>(null);
  const [reconciliationCandidates, setReconciliationCandidates] = useState<
    ReconciliationCandidate[]
  >([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId),
    [accounts, selectedAccountId],
  );

  const loadAccounts = useCallback(async () => {
    const next = await api<BankAccount[]>("/api/bank-accounts");
    setAccounts(next);
    if (!next.length) setEntries([]);
    setSelectedAccountId((current) =>
      next.some((account) => account.id === current)
        ? current
        : next.find((account) => account.status === "Aktif")?.id ??
          next[0]?.id ??
          "",
    );
    onBalanceChange(
      next
        .filter((account) => account.status === "Aktif")
        .reduce((total, account) => total + account.currentBalance, 0),
    );
  }, [onBalanceChange]);

  const loadEntries = useCallback(async (accountId: string) => {
    if (!accountId) {
      setEntries([]);
      return;
    }
    const next = await api<BankStatementEntry[]>(
      `/api/bank-accounts/${accountId}/entries?limit=12`,
    );
    setEntries(next);
  }, []);

  useEffect(() => {
    let active = true;
    api<BankAccount[]>("/api/bank-accounts")
      .then((next) => {
        if (!active) return;
        setAccounts(next);
        if (!next.length) setEntries([]);
        setSelectedAccountId((current) =>
          next.some((account) => account.id === current)
            ? current
            : next.find((account) => account.status === "Aktif")?.id ??
              next[0]?.id ??
              "",
        );
        onBalanceChange(
          next
            .filter((account) => account.status === "Aktif")
            .reduce((total, account) => total + account.currentBalance, 0),
        );
      })
      .catch((error) => {
        if (active) notify(messageOf(error, language));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [language, notify, onBalanceChange]);

  useEffect(() => {
    let active = true;
    if (!selectedAccountId) return;
    api<BankStatementEntry[]>(
      `/api/bank-accounts/${selectedAccountId}/entries?limit=12`,
    )
      .then((next) => {
        if (active) setEntries(next);
      })
      .catch((error) => {
        if (active) notify(messageOf(error, language));
      });
    return () => {
      active = false;
    };
  }, [language, notify, selectedAccountId]);

  function openAccountForm(account?: BankAccount) {
    setEditingAccount(account ?? null);
    setBankName(account?.bankName ?? "BCA");
    setAccountName(account?.accountName ?? "PerumNet Enterprise");
    setAccountNumber("");
    setOpeningBalance(account?.openingBalance ?? 0);
    setCurrency(account?.currency ?? "IDR");
    setAccountStatus(account?.status ?? "Aktif");
    setSyncMode(account?.syncMode ?? "Manual");
    setExternalAccountId("");
    setShowAccountForm(true);
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const account = await api<BankAccount>(
        editingAccount ? `/api/bank-accounts/${editingAccount.id}` : "/api/bank-accounts",
        {
        method: editingAccount ? "PATCH" : "POST",
        body: JSON.stringify({
          bankName,
          accountName,
          ...(!editingAccount || accountNumber ? { accountNumber } : {}),
          openingBalance,
          currency,
          status: accountStatus,
          syncMode,
          ...(syncMode === "API" && (externalAccountId || !editingAccount?.hasExternalAccountId)
            ? { externalAccountId }
            : {}),
        }),
      });
      await loadAccounts();
      setSelectedAccountId(account.id);
      setAccountNumber("");
      setOpeningBalance(0);
      setExternalAccountId("");
      setShowAccountForm(false);
      notify(
        id
          ? editingAccount
            ? "Konfigurasi rekening berhasil diperbarui."
            : "Rekening perusahaan berhasil ditambahkan."
          : editingAccount
            ? "Bank account configuration updated."
            : "Company bank account added.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteAccount() {
    if (!selectedAccount) return;
    const confirmed = window.confirm(
      id
        ? `Hapus rekening ${selectedAccount.bankName} ${selectedAccount.accountNumberMasked}? Rekening yang pernah digunakan akan ditolak dan harus dinonaktifkan.`
        : `Delete ${selectedAccount.bankName} ${selectedAccount.accountNumberMasked}? Used accounts will be blocked and must be disabled instead.`,
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await api(`/api/bank-accounts/${selectedAccount.id}`, { method: "DELETE" });
      await loadAccounts();
      notify(id ? "Rekening kosong berhasil dihapus." : "Unused bank account deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSubmitting(false);
    }
  }

  function selectStatement(event: ChangeEvent<HTMLInputElement>) {
    setStatementFile(event.target.files?.[0] ?? null);
  }

  async function importStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount || !statementFile) return;
    setSubmitting(true);
    const form = new FormData();
    form.set("file", statementFile);
    form.set("statementMonth", statementMonth);
    try {
      const result = await api<ImportResult>(
        `/api/bank-accounts/${selectedAccount.id}/import`,
        { method: "POST", body: form },
      );
      await Promise.all([
        loadAccounts(),
        loadEntries(selectedAccount.id),
      ]);
      onLedgerChanged();
      setStatementFile(null);
      setShowImportForm(false);
      notify(
        id
          ? `${result.importedCount} mutasi diimpor, ${result.duplicateCount} duplikat dilewati, ${result.matchedCount} transaksi direkonsiliasi.`
          : `${result.importedCount} entries imported, ${result.duplicateCount} duplicates skipped, ${result.matchedCount} transactions reconciled.`,
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSubmitting(false);
    }
  }

  async function syncAccount() {
    if (!selectedAccount) return;
    setSyncing(true);
    try {
      await api(`/api/bank-accounts/${selectedAccount.id}/sync`, {
        method: "POST",
      });
      await Promise.all([
        loadAccounts(),
        loadEntries(selectedAccount.id),
      ]);
      onLedgerChanged();
      notify(
        id
          ? "Saldo dan mutasi terbaru berhasil disinkronkan."
          : "Latest balance and transactions synchronized.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSyncing(false);
    }
  }

  async function openReconciliation(entry: BankStatementEntry) {
    if (!selectedAccount) return;
    setReconcilingEntry(entry);
    setReconciliationCandidates([]);
    setLoadingCandidates(true);
    try {
      setReconciliationCandidates(
        await api<ReconciliationCandidate[]>(
          `/api/bank-accounts/${selectedAccount.id}/entries/${entry.id}/candidates`,
        ),
      );
    } catch (error) {
      notify(messageOf(error, language));
      setReconcilingEntry(null);
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function reconcileEntry(
    action: "match" | "exclude" | "restore",
    transactionId?: string,
  ) {
    if (!selectedAccount || !reconcilingEntry) return;
    setSubmitting(true);
    try {
      await api(
        `/api/bank-accounts/${selectedAccount.id}/entries/${reconcilingEntry.id}/reconcile`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action,
            ...(transactionId ? { transactionId } : {}),
          }),
        },
      );
      await Promise.all([
        loadAccounts(),
        loadEntries(selectedAccount.id),
      ]);
      onLedgerChanged();
      setReconcilingEntry(null);
      notify(
        action === "match"
          ? id
            ? "Mutasi berhasil dicocokkan tanpa menggandakan arus kas."
            : "The statement entry was matched without duplicating cash flow."
          : action === "exclude"
            ? id
              ? "Mutasi dikecualikan dari pembukuan."
              : "The statement entry was excluded from the ledger."
            : id
              ? "Mutasi dikembalikan sebagai transaksi bank mandiri."
              : "The statement entry was restored as a standalone bank transaction.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteEntry(entry: BankStatementEntry) {
    if (!selectedAccount) return;
    const confirmed = window.confirm(
      id
        ? `Hapus mutasi "${entry.description}" senilai ${formatCurrency(entry.amount, language)}? Tindakan Admin ini dicatat pada audit log.`
        : `Delete "${entry.description}" for ${formatCurrency(entry.amount, language)}? This Admin action is recorded in the audit log.`,
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await api(
        `/api/bank-accounts/${selectedAccount.id}/entries/${entry.id}`,
        { method: "DELETE" },
      );
      await Promise.all([
        loadAccounts(),
        loadEntries(selectedAccount.id),
      ]);
      onLedgerChanged();
      notify(
        id
          ? "Mutasi rekening dan transaksi bank otomatis terkait berhasil dihapus."
          : "The bank entry and its generated bank transaction were deleted.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="panel banking-panel">
        <div className="panel-head banking-head">
          <div>
            <span className="eyebrow">
              {id ? "REKENING PERUSAHAAN" : "COMPANY BANKING"}
            </span>
            <h2>{id ? "Saldo & mutasi bank" : "Bank balances & statements"}</h2>
            <p>
              {id
                ? "Saldo aktual berasal dari mutasi terakhir atau konektor API read-only."
                : "Actual balance comes from the latest statement or a read-only API connector."}
            </p>
          </div>
          <div className="title-actions">
            {canManage && selectedAccount ? (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  if (serverToday) setStatementMonth(serverToday.slice(0, 7));
                  setShowImportForm(true);
                }}
              >
                <UploadCloud size={16} />{" "}
                {id ? "Impor mutasi" : "Import statement"}
              </button>
            ) : null}
            {canConfigure ? (
              <button
                className="button primary"
                type="button"
                onClick={() => openAccountForm()}
              >
                <Plus size={16} /> {id ? "Tambah rekening" : "Add account"}
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="bank-empty">
            <RefreshCw className="spin" size={22} />
            <span>{id ? "Memuat rekening..." : "Loading accounts..."}</span>
          </div>
        ) : accounts.length ? (
          <>
            <div className="bank-account-grid">
              {accounts.map((account) => (
                <button
                  type="button"
                  className={`bank-account-card ${selectedAccountId === account.id ? "active" : ""}`}
                  key={account.id}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <span className="bank-account-icon">
                    <Landmark size={21} />
                  </span>
                  <span className="bank-account-main">
                    <span>
                      <strong>{account.bankName}</strong>
                      <small>{account.accountNumberMasked}</small>
                    </span>
                    <b>{formatCurrency(account.currentBalance, language)}</b>
                    <small>
                      {account.balanceUpdatedAt
                        ? `${account.syncMode === "Manual"
                            ? id
                              ? "Saldo per"
                              : "Balance as of"
                            : id
                              ? "Diperbarui"
                              : "Updated"} ${new Intl.DateTimeFormat(
                            id ? "id-ID" : "en-US",
                            account.syncMode === "Manual"
                              ? {
                                  dateStyle: "long",
                                  timeZone: "Asia/Makassar",
                                }
                              : {
                                  dateStyle: "long",
                                  timeStyle: "short",
                                  timeZone: "Asia/Makassar",
                                },
                          ).format(new Date(account.balanceUpdatedAt))}`
                        : id
                          ? "Belum diperbarui"
                          : "Not updated yet"}
                    </small>
                  </span>
                  <span className={`bank-sync-badge ${account.syncMode.toLowerCase()}`}>
                    {account.syncMode === "API" ? <Link2 size={12} /> : <FileSpreadsheet size={12} />}
                    {account.syncMode}
                  </span>
                </button>
              ))}
            </div>

            {selectedAccount ? (
              <div className="bank-detail">
                <div className="bank-detail-head">
                  <div>
                    <strong>{selectedAccount.accountName}</strong>
                    <span>
                      {selectedAccount.entryCount}{" "}
                      {id ? "mutasi tersimpan" : "stored entries"} ·{" "}
                      {selectedAccount.unmatchedCount}{" "}
                      {id ? "impor baru" : "new imports"}
                    </span>
                  </div>
                  <div className="title-actions">
                  {canConfigure ? (
                    <>
                      <button className="button subtle small" type="button" onClick={() => openAccountForm(selectedAccount)}>
                        <Pencil size={15} /> {id ? "Edit rekening" : "Edit account"}
                      </button>
                      <button className="button danger small" type="button" disabled={submitting} onClick={deleteAccount}>
                        <Trash2 size={15} /> {id ? "Hapus" : "Delete"}
                      </button>
                    </>
                  ) : null}
                  {canManage && selectedAccount.syncMode === "API" ? (
                    <button
                      className="button subtle small"
                      type="button"
                      disabled={syncing || !selectedAccount.apiConfigured}
                      onClick={syncAccount}
                      title={
                        selectedAccount.apiConfigured
                          ? undefined
                          : id
                            ? "Kredensial API belum dikonfigurasi di server."
                            : "API credentials are not configured on the server."
                      }
                    >
                      <RefreshCw className={syncing ? "spin" : ""} size={15} />
                      {syncing
                        ? id
                          ? "Sinkronisasi..."
                          : "Syncing..."
                        : id
                          ? "Sinkronkan API"
                          : "Sync API"}
                    </button>
                  ) : null}
                  </div>
                </div>
                <div className="table-scroll bank-entry-scroll">
                  <table className="data-table bank-entry-table">
                    <thead>
                      <tr>
                        <th>{id ? "Tanggal" : "Date"}</th>
                        <th>{id ? "Keterangan" : "Description"}</th>
                        <th>{id ? "Status" : "Status"}</th>
                        <th>{id ? "Nominal" : "Amount"}</th>
                        <th>{id ? "Saldo" : "Balance"}</th>
                        {canDeleteEntries ? (
                          <th>
                            <span className="sr-only">
                              {id ? "Aksi Admin" : "Admin actions"}
                            </span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{localizedDate(language, entry.date)}</td>
                          <td>
                            <div className="bank-entry-description">
                              <strong>{entry.description}</strong>
                              <small>
                                {bankCategoryLabel(language, entry.category)} ·{" "}
                                {language === "en" && entry.source === "Manual Upload"
                                  ? "Manual Upload"
                                  : entry.source}
                                {entry.reference ? ` · ${entry.reference}` : ""}
                              </small>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`reconciliation-badge ${entry.reconciliationStatus.toLowerCase()}`}
                            >
                              {entry.reconciliationStatus === "Matched" ? (
                                <CheckCircle2 size={13} />
                              ) : entry.reconciliationStatus === "Imported" ? (
                                <Clock3 size={13} />
                              ) : (
                                <AlertTriangle size={13} />
                              )}
                              {entry.reconciliationStatus === "Matched"
                                ? id
                                  ? "Cocok"
                                  : "Matched"
                                : entry.reconciliationStatus === "Imported"
                                  ? id
                                    ? "Tercatat"
                                    : "Recorded"
                                  : id
                                    ? "Dikecualikan"
                                    : "Excluded"}
                            </span>
                            {canManage ? (
                              <button
                                className="text-button reconciliation-action"
                                type="button"
                                onClick={() => openReconciliation(entry)}
                              >
                                {entry.reconciliationStatus === "Matched"
                                  ? id
                                    ? "Ubah kecocokan"
                                    : "Change match"
                                  : id
                                    ? "Tinjau"
                                    : "Review"}
                              </button>
                            ) : null}
                          </td>
                          <td
                            className={
                              entry.type === "Pemasukan"
                                ? "amount-income"
                                : "amount-expense"
                            }
                          >
                            {entry.type === "Pemasukan" ? "+" : "−"}
                            {formatCurrency(entry.amount, language)}
                          </td>
                          <td>
                            {entry.runningBalance === undefined
                              ? "—"
                              : formatCurrency(entry.runningBalance, language)}
                          </td>
                          {canDeleteEntries ? (
                            <td>
                              <button
                                className="icon-button danger"
                                type="button"
                                disabled={submitting}
                                aria-label={
                                  id
                                    ? `Hapus mutasi ${entry.description}`
                                    : `Delete statement entry ${entry.description}`
                                }
                                onClick={() => deleteEntry(entry)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!entries.length ? (
                    <div className="bank-empty compact">
                      <FileSpreadsheet size={22} />
                      <span>
                        {id
                          ? "Belum ada mutasi. Impor PDF atau CSV bulanan untuk memperbarui saldo."
                          : "No statements yet. Import a monthly PDF or CSV to update the balance."}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="bank-empty">
            <Landmark size={28} />
            <div>
              <strong>
                {id
                  ? "Belum ada rekening perusahaan"
                  : "No company bank account yet"}
              </strong>
              <span>
                {id
                  ? "Admin dapat menambahkan BCA atau bank lain, lalu Finance mengimpor mutasi bulanan."
                  : "An Admin can add BCA or another bank, then Finance can import monthly statements."}
              </span>
            </div>
          </div>
        )}

        <div className="bank-security-note">
          <ShieldCheck size={17} />
          <span>
            {id
              ? "Konektor hanya melakukan inquiry saldo dan mutasi. Secret API disimpan sebagai environment server, bukan di database atau browser."
              : "The connector only reads balances and statements. API secrets stay in server environment variables, never in the database or browser."}
          </span>
        </div>
      </section>

      {showAccountForm ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowAccountForm(false)}
        >
          <section
            className="modal-card bank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bank-account-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">
                  {editingAccount ? (id ? "EDIT REKENING" : "EDIT ACCOUNT") : (id ? "REKENING BARU" : "NEW ACCOUNT")}
                </span>
                <h2 id="bank-account-title">
                  {editingAccount
                    ? id ? "Perbarui rekening perusahaan" : "Update company account"
                    : id ? "Tambahkan rekening perusahaan" : "Add a company account"}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={id ? "Tutup" : "Close"}
                onClick={() => setShowAccountForm(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form className="form-grid" onSubmit={saveAccount}>
              <label className="field">
                <span>{id ? "Nama bank" : "Bank name"}</span>
                <input
                  required={!editingAccount}
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                  placeholder="BCA"
                />
              </label>
              <label className="field">
                <span>{id ? "Nama rekening" : "Account name"}</span>
                <input
                  required
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>{id ? "Nomor rekening" : "Account number"}</span>
                <input
                  required
                  inputMode="numeric"
                  minLength={4}
                  value={accountNumber}
                  onChange={(event) => setAccountNumber(event.target.value)}
                  autoComplete="off"
                />
                <small>
                  {editingAccount
                    ? id ? `Kosongkan untuk mempertahankan ${editingAccount.accountNumberMasked}.` : `Leave blank to keep ${editingAccount.accountNumberMasked}.`
                    : id ? "Hanya empat digit terakhir yang ditampilkan kembali." : "Only the last four digits are shown again."}
                </small>
              </label>
              <label className="field">
                <span>{id ? "Mata uang" : "Currency"}</span>
                <input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
              </label>
              <label className="field">
                <span>Status</span>
                <select value={accountStatus} onChange={(event) => setAccountStatus(event.target.value as BankAccount["status"])}>
                  <option value="Aktif">{id ? "Aktif" : "Active"}</option>
                  <option value="Nonaktif">{id ? "Nonaktif" : "Inactive"}</option>
                </select>
              </label>
              <label className="field">
                <span>{id ? "Saldo awal" : "Opening balance"}</span>
                <input
                  type="number"
                  min="0"
                  required
                  value={openingBalance}
                  onChange={(event) =>
                    setOpeningBalance(Number(event.target.value))
                  }
                />
              </label>
              <label className="field full">
                <span>{id ? "Metode pembaruan" : "Update method"}</span>
                <select
                  value={syncMode}
                  onChange={(event) =>
                    setSyncMode(event.target.value as BankAccount["syncMode"])
                  }
                >
                  <option value="Manual">
                    {id ? "Upload PDF/CSV manual" : "Manual PDF/CSV upload"}
                  </option>
                  <option value="API">
                    {id ? "Konektor API read-only" : "Read-only API connector"}
                  </option>
                </select>
              </label>
              {syncMode === "API" ? (
                <label className="field full">
                  <span>Provider Account ID</span>
                  <input
                    required={!editingAccount?.hasExternalAccountId}
                    value={externalAccountId}
                    onChange={(event) => setExternalAccountId(event.target.value)}
                    autoComplete="off"
                  />
                  <small>
                    {id
                      ? "ID ini diberikan saat onboarding API bank/provider."
                      : "This ID is supplied during bank/provider API onboarding."}
                  </small>
                </label>
              ) : null}
              <div className="modal-actions full">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setShowAccountForm(false)}
                >
                  {id ? "Batal" : "Cancel"}
                </button>
                <button className="button primary" type="submit" disabled={submitting}>
                  {editingAccount ? <Pencil size={16} /> : <Plus size={16} />}{" "}
                  {submitting
                    ? id
                      ? "Menyimpan..."
                      : "Saving..."
                    : id
                      ? editingAccount ? "Simpan perubahan" : "Simpan rekening"
                      : editingAccount ? "Save changes" : "Save account"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showImportForm && selectedAccount ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowImportForm(false)}
        >
          <section
            className="modal-card bank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bank-import-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">
                  {id ? "IMPOR MUTASI" : "IMPORT STATEMENT"}
                </span>
                <h2 id="bank-import-title">
                  {selectedAccount.bankName} ·{" "}
                  {selectedAccount.accountNumberMasked}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={id ? "Tutup" : "Close"}
                onClick={() => setShowImportForm(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form className="form-grid" onSubmit={importStatement}>
              <label className="field">
                <span>{id ? "Periode mutasi" : "Statement period"}</span>
                <input
                  type="month"
                  required
                  value={statementMonth}
                  onChange={(event) => setStatementMonth(event.target.value)}
                />
              </label>
              <label className="field">
                <span>{id ? "File PDF atau CSV" : "PDF or CSV file"}</span>
                <input
                  type="file"
                  required
                  accept=".pdf,.csv,application/pdf,text/csv,text/plain"
                  onChange={selectStatement}
                />
              </label>
              <div className="statement-guidance full">
                <FileSpreadsheet size={19} />
                <span>
                  <strong>
                    {id
                      ? "PDF e-statement BCA dan CSV bank umum didukung"
                      : "BCA e-statement PDFs and generic bank CSVs are supported"}
                  </strong>
                  <small>
                    {id
                      ? "PDF harus berupa e-statement asli dengan teks yang dapat dipilih, bukan scan/foto. CSV memerlukan kolom Tanggal, Keterangan, serta Mutasi atau Debit/Kredit. Duplikat otomatis dilewati."
                      : "PDFs must be original searchable e-statements, not scans or photos. CSVs require Date, Description, and Amount or Debit/Credit columns. Duplicates are skipped automatically."}
                  </small>
                </span>
              </div>
              <div className="modal-actions full">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setShowImportForm(false)}
                >
                  {id ? "Batal" : "Cancel"}
                </button>
                <button
                  className="button primary"
                  type="submit"
                  disabled={submitting || !statementFile}
                >
                  <UploadCloud size={16} />{" "}
                  {submitting
                    ? id
                      ? "Mengimpor..."
                      : "Importing..."
                    : id
                      ? "Impor mutasi"
                      : "Import statement"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {reconcilingEntry && selectedAccount ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setReconcilingEntry(null)}
        >
          <section
            className="modal-card bank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bank-reconciliation-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">
                  {id ? "REKONSILIASI BANK" : "BANK RECONCILIATION"}
                </span>
                <h2 id="bank-reconciliation-title">
                  {reconcilingEntry.description}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={id ? "Tutup" : "Close"}
                onClick={() => setReconcilingEntry(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="reconciliation-summary">
              <span>{localizedDate(language, reconcilingEntry.date)}</span>
              <strong>{formatCurrency(reconcilingEntry.amount, language)}</strong>
              <span>
                {reconcilingEntry.type === "Pemasukan"
                  ? id
                    ? "Kas masuk"
                    : "Cash inflow"
                  : id
                    ? "Kas keluar"
                    : "Cash outflow"}
              </span>
            </div>
            <div className="reconciliation-copy">
              <strong>
                {id
                  ? "Cocokkan dengan transaksi yang sudah ada"
                  : "Match with an existing transaction"}
              </strong>
              <p>
                {id
                  ? "Kandidat memakai nominal dan arah yang sama dalam rentang 14 hari. Pencocokan menghapus transaksi bank duplikat, bukan transaksi Invoice atau SPK."
                  : "Candidates use the same amount and direction within 14 days. Matching removes the duplicate bank entry, not the Invoice or Work Order transaction."}
              </p>
            </div>
            <div className="reconciliation-candidate-list">
              {loadingCandidates ? (
                <div className="bank-empty compact">
                  <RefreshCw className="spin" size={18} />
                  <span>{id ? "Mencari kandidat..." : "Finding candidates..."}</span>
                </div>
              ) : reconciliationCandidates.length ? (
                reconciliationCandidates.map((candidate) => (
                  <article key={candidate.id}>
                    <div>
                      <strong>{candidate.description}</strong>
                      <small>
                        {localizedDate(language, candidate.date)} ·{" "}
                        {candidate.source} · {candidate.project}
                      </small>
                    </div>
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={
                        submitting ||
                        reconcilingEntry.transactionId === candidate.id
                      }
                      onClick={() => reconcileEntry("match", candidate.id)}
                    >
                      <Link2 size={14} />
                      {reconcilingEntry.transactionId === candidate.id
                        ? id
                          ? "Kecocokan aktif"
                          : "Current match"
                        : id
                          ? "Cocokkan"
                          : "Match"}
                    </button>
                  </article>
                ))
              ) : (
                <div className="bank-empty compact">
                  <AlertTriangle size={19} />
                  <span>
                    {id
                      ? "Tidak ada kandidat dengan nominal yang sama dalam rentang 14 hari."
                      : "No same-amount candidate was found within 14 days."}
                  </span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setReconcilingEntry(null)}
              >
                {id ? "Tutup" : "Close"}
              </button>
              {reconcilingEntry.reconciliationStatus === "Excluded" ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={submitting}
                  onClick={() => reconcileEntry("restore")}
                >
                  {id ? "Catat sebagai mutasi baru" : "Record as new bank entry"}
                </button>
              ) : (
                <button
                  className="button danger"
                  type="button"
                  disabled={submitting}
                  onClick={() => reconcileEntry("exclude")}
                >
                  {id ? "Kecualikan dari pembukuan" : "Exclude from ledger"}
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
