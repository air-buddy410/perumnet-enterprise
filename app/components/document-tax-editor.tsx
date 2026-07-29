"use client";

import { Calculator, Save, X } from "lucide-react";
import { useState } from "react";
import { api, messageOf } from "../api-client";
import { formatCurrency } from "../data";
import { type AppLanguage } from "../i18n";

type DocumentType = "Quotation" | "Invoice" | "SPK" | "PO";

interface TaxRule {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  scope: string;
  effect: "Add" | "Withhold";
  ratePercent: number;
  accountingTreatment: string;
  status: string;
}

interface TaxSummary {
  enabled: boolean;
  baseAmount: number;
  locked: boolean;
  taxAdditions: number;
  taxWithholdings: number;
  grossTotal: number;
  netCashDue: number;
  taxes: Array<{ ruleId?: string; code: string; amount: number }>;
}

interface DocumentTaxEditorProps {
  language: AppLanguage;
  notify: (message: string) => void;
  documentType: DocumentType;
  documentId: string;
  canManage: boolean;
  compact?: boolean;
  onSaved?: () => void | Promise<void>;
}

export function DocumentTaxEditor({
  language,
  notify,
  documentType,
  documentId,
  canManage,
  compact = true,
  onSaved,
}: DocumentTaxEditorProps) {
  const id = language === "id";
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [rules, setRules] = useState<TaxRule[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function openEditor() {
    try {
      const [nextSummary, nextRules] = await Promise.all([
        api<TaxSummary>(
          `/api/tax/documents/${documentType}/${encodeURIComponent(documentId)}`,
        ),
        api<TaxRule[]>("/api/tax/rules"),
      ]);
      setSummary(nextSummary);
      setRules(
        nextRules.filter(
          (rule) =>
            rule.status === "Active" &&
            (rule.scope ===
              (documentType === "Quotation" || documentType === "Invoice"
                ? "Client"
                : "Vendor") ||
              rule.scope === "Both"),
        ),
      );
      setSelected(
        nextSummary.taxes
          .map((tax) => tax.ruleId)
          .filter((value): value is string => Boolean(value)),
      );
      setOpen(true);
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function save() {
    if (!summary) return;
    setSaving(true);
    try {
      const updated = await api<TaxSummary>(
        `/api/tax/documents/${documentType}/${encodeURIComponent(documentId)}`,
        {
          method: "PUT",
          body: JSON.stringify({ ruleIds: selected }),
        },
      );
      setSummary(updated);
      await onSaved?.();
      notify(id ? "Snapshot pajak dokumen disimpan." : "Document tax snapshot saved.");
      setOpen(false);
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return null;

  return (
    <>
      <button
        className={`button secondary ${compact ? "small" : ""}`}
        type="button"
        onClick={() => void openEditor()}
      >
        <Calculator size={14} /> {id ? "Pajak" : "Tax"}
      </button>
      {open && summary ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "PAJAK DOKUMEN" : "DOCUMENT TAX"}</span><h2>{documentType}</h2></div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            {!summary.enabled ? (
              <div className="statement-guidance">
                <Calculator size={18} />
                <span><strong>{id ? "Modul pajak global nonaktif" : "Global tax module is disabled"}</strong><small>{id ? "Admin dapat mengaktifkannya melalui Finance → Pajak." : "An Admin can enable it under Finance → Tax."}</small></span>
              </div>
            ) : null}
            <div className="document-tax-summary">
              <span><small>{id ? "Dasar pengenaan" : "Taxable base"}</small><strong>{formatCurrency(summary.baseAmount, language)}</strong></span>
              <span><small>{id ? "Pajak tambah" : "Tax additions"}</small><strong>{formatCurrency(summary.taxAdditions, language)}</strong></span>
              <span><small>{id ? "Pajak potong" : "Withholdings"}</small><strong>{formatCurrency(summary.taxWithholdings, language)}</strong></span>
              <span><small>{id ? "Kas bersih" : "Net cash due"}</small><strong>{formatCurrency(summary.netCashDue, language)}</strong></span>
            </div>
            <fieldset className="field category-picker">
              <legend>{id ? "Pilih aturan aktif" : "Select active rules"}</legend>
              {rules.map((rule) => (
                <label key={rule.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(rule.id)}
                    disabled={summary.locked || !summary.enabled}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(rule.id)
                          ? current.filter((ruleId) => ruleId !== rule.id)
                          : [...current, rule.id],
                      )
                    }
                  />
                  <span>
                    <strong>{rule.code} · {rule.ratePercent}%</strong>
                    <small>{id ? rule.name : rule.nameEn} · {rule.effect === "Add" ? (id ? "Tambah" : "Add") : (id ? "Potong" : "Withhold")}</small>
                  </span>
                </label>
              ))}
              {!rules.length ? <p>{id ? "Belum ada aturan aktif untuk cakupan dokumen ini." : "No active rules exist for this document scope."}</p> : null}
            </fieldset>
            {summary.locked ? <div className="statement-guidance"><Calculator size={18} /><span><strong>{id ? "Snapshot terkunci" : "Snapshot locked"}</strong><small>{id ? "Dokumen lama tetap dapat dibaca, tetapi tidak dapat dihitung ulang." : "The historical document remains readable but cannot be recalculated."}</small></span></div> : null}
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setOpen(false)}>{id ? "Tutup" : "Close"}</button>
              {!summary.locked ? <button className="button primary" type="button" disabled={!summary.enabled || saving} onClick={() => void save()}><Save size={15} /> {saving ? (id ? "Menyimpan..." : "Saving...") : (id ? "Simpan pajak" : "Save tax")}</button> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

