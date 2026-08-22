"use client";

import {
  AlertTriangle,
  ChevronRight,
  FileText,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  documentEmailAudience,
  documentEmailAudienceLabels,
  documentEmailKindLabels,
  documentEmailKinds,
  documentEmailPlaceholderHints,
  type DocumentEmailKind,
} from "../../shared/document-email";
import type { LetterBodyFormat } from "../../shared/email-delivery";
import { api, messageOf } from "../api-client";
import type { AppLanguage } from "../i18n";
import { RichTextEditor, type RichTextEditorHandle } from "../panel/rich-text-editor";
import styles from "./document-template-manager.module.css";

type DocumentEmailTemplate = {
  id: string;
  documentKind: DocumentEmailKind;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyFormat: LetterBodyFormat;
  senderSignoff: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  language: "id" | "en";
  createdAt: string;
  updatedAt: string;
};

type TemplateDefaults = {
  senderSignoff: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
};

type TemplateResponse = {
  items: DocumentEmailTemplate[];
  defaults?: TemplateDefaults;
  placeholders?: Partial<Record<DocumentEmailKind, string[]>>;
  viewableKinds?: unknown;
  manageableKinds?: unknown;
};

type TemplateForm = Omit<DocumentEmailTemplate, "id" | "createdAt" | "updatedAt">;

type DocumentTemplateManagerProps = {
  language: AppLanguage;
  canManage: boolean;
  notify: (message: string) => void;
  kinds?: readonly DocumentEmailKind[];
  initialKind?: DocumentEmailKind;
};

const emptyPlaceholders: Record<DocumentEmailKind, string[]> = {
  quotation: [],
  invoice: [],
  spk: [],
};

function emptyForm(
  documentKind: DocumentEmailKind,
  defaults: TemplateDefaults | null,
): TemplateForm {
  return {
    documentKind,
    name: "",
    subject: "",
    bodyHtml: "",
    bodyFormat: "text",
    senderSignoff: defaults?.senderSignoff ?? "Hormat kami,",
    senderName: defaults?.senderName ?? "",
    senderEmail: defaults?.senderEmail ?? "",
    senderPhone: defaults?.senderPhone ?? "",
    language: "id",
  };
}

function formFromTemplate(template: DocumentEmailTemplate): TemplateForm {
  return {
    documentKind: template.documentKind,
    name: template.name,
    subject: template.subject,
    bodyHtml: template.bodyHtml,
    bodyFormat: template.bodyFormat,
    senderSignoff: template.senderSignoff,
    senderName: template.senderName,
    senderEmail: template.senderEmail,
    senderPhone: template.senderPhone,
    language: template.language,
  };
}

function formatDate(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
    timeZone: "Asia/Makassar",
  }).format(date);
}

function normalizePlaceholders(
  value: Partial<Record<DocumentEmailKind, string[]>> | undefined,
) {
  return documentEmailKinds.reduce<Record<DocumentEmailKind, string[]>>((result, kind) => {
    result[kind] = value?.[kind] ?? [];
    return result;
  }, { ...emptyPlaceholders });
}

function isDocumentEmailKind(value: string): value is DocumentEmailKind {
  return (documentEmailKinds as readonly string[]).includes(value);
}

function normalizeKinds(
  value: unknown,
  fallback: readonly DocumentEmailKind[] = [],
) {
  const values = Array.isArray(value)
    ? value.filter((item): item is DocumentEmailKind => typeof item === "string" && isDocumentEmailKind(item))
    : fallback;
  return documentEmailKinds.filter((kind) => values.includes(kind));
}

function isLetterBodyFormat(value: string): value is LetterBodyFormat {
  return value === "text" || value === "rich" || value === "html";
}

function normalizeTemplate(template: DocumentEmailTemplate): DocumentEmailTemplate {
  return {
    ...template,
    documentKind: isDocumentEmailKind(String(template.documentKind))
      ? template.documentKind
      : "spk",
    bodyFormat: isLetterBodyFormat(String(template.bodyFormat))
      ? template.bodyFormat
      : "text",
    language: template.language === "en" ? "en" : "id",
  };
}

export function DocumentTemplateManager({
  language,
  canManage,
  notify,
  kinds,
  initialKind,
}: DocumentTemplateManagerProps) {
  const id = language === "id";
  const requestedKindKey = kinds?.length ? kinds.join(",") : documentEmailKinds.join(",");
  const requestedKinds = useMemo(
    () => normalizeKinds(requestedKindKey.split(","), documentEmailKinds),
    [requestedKindKey],
  );
  const initialSelectedKind = initialKind && requestedKinds.includes(initialKind)
    ? initialKind
    : requestedKinds[0] ?? "spk";
  const [templates, setTemplates] = useState<DocumentEmailTemplate[]>([]);
  const [defaults, setDefaults] = useState<TemplateDefaults | null>(null);
  const [placeholders, setPlaceholders] = useState(emptyPlaceholders);
  const [viewableKinds, setViewableKinds] = useState<DocumentEmailKind[]>([]);
  const [manageableKinds, setManageableKinds] = useState<DocumentEmailKind[]>([]);
  const [selectedKind, setSelectedKind] = useState<DocumentEmailKind>(initialSelectedKind);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<TemplateForm>(() => emptyForm("spk", null));
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | "" | "refresh">("");
  const initializedRef = useRef(false);
  const selectedIdRef = useRef("");
  const selectedKindRef = useRef<DocumentEmailKind>("spk");
  const dirtyRef = useRef(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyEditorRef = useRef<RichTextEditorHandle>(null);

  const setDirtyState = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const applySelection = useCallback((template: DocumentEmailTemplate | null, kind: DocumentEmailKind, nextDefaults: TemplateDefaults | null) => {
    selectedKindRef.current = kind;
    selectedIdRef.current = template?.id ?? "";
    setSelectedKind(kind);
    setSelectedId(template?.id ?? "");
    setForm(template ? formFromTemplate(template) : emptyForm(kind, nextDefaults));
    setDirtyState(false);
  }, [setDirtyState]);

  const loadTemplates = useCallback(async () => {
    setBusy((current) => current === "save" || current === "delete" ? current : "refresh");
    setLoading(true);
    setLoadError("");
    try {
      const data = await api<TemplateResponse>("/api/document-email-templates");
      const nextTemplates = (data.items ?? []).map(normalizeTemplate);
      const nextDefaults = data.defaults ?? null;
      const nextViewableKinds = normalizeKinds(
        data.viewableKinds,
        nextTemplates.map((template) => template.documentKind),
      );
      const nextManageableKinds = normalizeKinds(
        data.manageableKinds,
        canManage ? nextViewableKinds : [],
      );
      setTemplates(nextTemplates);
      setDefaults(nextDefaults);
      setPlaceholders(normalizePlaceholders(data.placeholders));
      setViewableKinds(nextViewableKinds);
      setManageableKinds(nextManageableKinds);

      if (!initializedRef.current) {
        const preferredKind = initialKind && requestedKinds.includes(initialKind) && nextViewableKinds.includes(initialKind)
          ? initialKind
          : requestedKinds.find((kind) => nextViewableKinds.includes(kind)) ?? nextViewableKinds[0] ?? "spk";
        const first = nextTemplates.find((template) => template.documentKind === preferredKind) ?? null;
        applySelection(first, preferredKind, nextDefaults);
        initializedRef.current = true;
      } else if (
        selectedIdRef.current &&
        !nextTemplates.some((template) => template.id === selectedIdRef.current)
      ) {
        const fallback = nextTemplates.find((template) => template.documentKind === selectedKindRef.current) ?? null;
        applySelection(fallback, selectedKindRef.current, nextDefaults);
      }
    } catch (error) {
      const message = messageOf(error, language);
      setLoadError(message);
      notify(message);
    } finally {
      setLoading(false);
      setBusy((current) => current === "refresh" ? "" : current);
    }
  }, [applySelection, canManage, initialKind, language, notify, requestedKinds]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTemplates(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTemplates]);

  const visibleTemplates = useMemo(
    () => templates.filter((template) => template.documentKind === selectedKind),
    [selectedKind, templates],
  );
  const visibleKinds = useMemo(
    () => requestedKinds.filter((kind) => viewableKinds.includes(kind)),
    [requestedKinds, viewableKinds],
  );
  const manageableVisibleKinds = useMemo(
    () => visibleKinds.filter((kind) => manageableKinds.includes(kind)),
    [manageableKinds, visibleKinds],
  );
  const currentPlaceholders = placeholders[form.documentKind] ?? [];
  const canManageKind = canManage && manageableKinds.includes(form.documentKind);
  const canCreate = canManage && manageableVisibleKinds.length > 0;
  const audience = documentEmailAudience[selectedKind];
  const audienceLabel = documentEmailAudienceLabels[audience][id ? "id" : "en"];
  const permissionLabel = audience === "vendor" ? "Procurement & Vendor" : "Quotation & Invoice";

  function confirmDiscard() {
    if (!dirtyRef.current) return true;
    return window.confirm(
      id
        ? "Ada perubahan yang belum disimpan. Tinggalkan tanpa menyimpan?"
        : "You have unsaved changes. Leave without saving?",
    );
  }

  function selectKind(kind: DocumentEmailKind) {
    if (!visibleKinds.includes(kind) || kind === selectedKind || !confirmDiscard()) return;
    const first = templates.find((template) => template.documentKind === kind) ?? null;
    applySelection(first, kind, defaults);
  }

  function selectTemplate(template: DocumentEmailTemplate) {
    if (template.id === selectedId || !confirmDiscard()) return;
    applySelection(template, template.documentKind, defaults);
  }

  function createNewTemplate() {
    if (!confirmDiscard()) return;
    const kind = manageableVisibleKinds.includes(selectedKind)
      ? selectedKind
      : manageableVisibleKinds[0] ?? selectedKind;
    applySelection(null, kind, defaults);
  }

  function updateForm<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirtyState(true);
  }

  function insertPlaceholder(field: "subject" | "bodyHtml", placeholder: string) {
    const token = `{{${placeholder}}}`;
    if (field === "bodyHtml") {
      bodyEditorRef.current?.insertPlaceholder(token);
      return;
    }
    const input = subjectRef.current;
    const current = form.subject;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    updateForm("subject", `${current.slice(0, start)}${token}${current.slice(end)}`);
    window.setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageKind || busy) return;

    const payload = {
      documentKind: form.documentKind,
      name: form.name.trim(),
      subject: form.subject.trim(),
      bodyHtml: form.bodyHtml.trim(),
      bodyFormat: form.bodyFormat,
      senderSignoff: form.senderSignoff.trim(),
      senderName: form.senderName.trim(),
      senderEmail: form.senderEmail.trim(),
      senderPhone: form.senderPhone.trim(),
      language: form.language,
    };
    if (payload.bodyHtml.length < 10) {
      notify(id ? "Isi surat minimal 10 karakter." : "The letter body must be at least 10 characters.");
      return;
    }

    setBusy("save");
    try {
      const saved = normalizeTemplate(await api<DocumentEmailTemplate>(
        `/api/document-email-templates${selectedId ? `/${selectedId}` : ""}`,
        {
          method: selectedId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      ));
      setTemplates((current) => {
        const next = selectedId
          ? current.map((template) => template.id === saved.id ? saved : template)
          : [...current, saved];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      applySelection(saved, saved.documentKind, defaults);
      notify(selectedId ? (id ? "Template berhasil diperbarui." : "Template updated.") : (id ? "Template baru berhasil dibuat." : "New template created."));
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function deleteTemplate() {
    if (!canManageKind || !selectedId || busy) return;
    const confirmed = window.confirm(
      id
        ? "Hapus template ini? Riwayat surat yang sudah ada tetap disimpan."
        : "Delete this template? Existing delivery history will be kept.",
    );
    if (!confirmed) return;

    setBusy("delete");
    try {
      await api(`/api/document-email-templates/${selectedId}`, { method: "DELETE" });
      const nextTemplates = templates.filter((template) => template.id !== selectedId);
      setTemplates(nextTemplates);
      const fallback = nextTemplates.find((template) => template.documentKind === selectedKind) ?? null;
      applySelection(fallback, selectedKind, defaults);
      notify(id ? "Template dihapus." : "Template deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  const selectedTemplate = templates.find((template) => template.id === selectedId) ?? null;
  const formKindLabel = documentEmailKindLabels[form.documentKind][id ? "id" : "en"];
  const formKindOptions = visibleKinds.filter((kind) => manageableKinds.includes(kind) || kind === form.documentKind);

  return (
    <section className={`panel ${styles.manager}`} data-testid="document-template-manager">
      <header className={`panel-head ${styles.managerHead}`}>
        <div>
          <span className="eyebrow">{id ? "TEMPLATE SURAT DOKUMEN" : "DOCUMENT LETTER TEMPLATES"}</span>
          <h2>{id ? "Pengelola template surat" : "Document letter templates"}</h2>
          <p>{id ? `Atur ${audienceLabel.toLowerCase()} yang dipakai saat mengirim dokumen.` : `Manage ${audienceLabel.toLowerCase()} used when sending documents.`}</p>
        </div>
        <div className={styles.headActions}>
          <button className="button secondary small" type="button" onClick={() => void loadTemplates()} disabled={Boolean(busy)}>
            {busy === "refresh" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
            {id ? "Muat ulang" : "Refresh"}
          </button>
          <button className="button primary small" type="button" onClick={createNewTemplate} disabled={!canCreate || Boolean(busy)} title={!canCreate ? (id ? `Izin Kelola ${permissionLabel} diperlukan.` : `${permissionLabel} Manage permission is required.`) : undefined}>
            <Plus size={15} /> {id ? "Template baru" : "New template"}
          </button>
        </div>
      </header>

      {!loading && visibleKinds.length > 0 && !canManageKind && (
        <div className={styles.infoNotice} role="status">
          <AlertTriangle size={17} />
          <span>{id ? `Mode lihat saja. Izin Kelola ${permissionLabel} diperlukan untuk membuat, mengubah, atau menghapus template.` : `Read-only mode. ${permissionLabel} Manage permission is required to create, edit, or delete templates.`}</span>
        </div>
      )}
      {loadError && (
        <div className={styles.errorNotice} role="alert">
          <AlertTriangle size={17} />
          <span>{loadError}</span>
          <button className="button subtle small" type="button" onClick={() => void loadTemplates()} disabled={Boolean(busy)}>{id ? "Coba lagi" : "Retry"}</button>
        </div>
      )}

      <div className={styles.workspace}>
        <aside className={styles.library} aria-label={id ? "Daftar template" : "Template library"}>
          <div className={styles.kindSwitcher} role="tablist" aria-label={id ? "Jenis dokumen" : "Document type"}>
            {visibleKinds.map((kind) => {
              const label = documentEmailKindLabels[kind][id ? "id" : "en"];
              const count = templates.filter((template) => template.documentKind === kind).length;
              return (
                <button
                  className={selectedKind === kind ? styles.kindActive : styles.kindButton}
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={selectedKind === kind}
                  onClick={() => selectKind(kind)}
                >
                  <span>{label}</span><small>{count}</small>
                </button>
              );
            })}
          </div>

          <div className={styles.libraryHeading}>
            <div><span>LIBRARY</span><strong>{audienceLabel}</strong></div>
            <small>{visibleTemplates.length} {id ? "template" : "templates"}</small>
          </div>
          <div className={styles.templateList}>
            {loading ? (
              <div className={styles.emptyState}><LoaderCircle className="spin" size={21} /><span>{id ? "Memuat template…" : "Loading templates…"}</span></div>
            ) : visibleTemplates.length ? (
              visibleTemplates.map((template) => (
                <button
                  className={selectedId === template.id ? styles.templateItemActive : styles.templateItem}
                  key={template.id}
                  type="button"
                  onClick={() => selectTemplate(template)}
                >
                  <span className={styles.templateIcon}><FileText size={17} /></span>
                  <span className={styles.templateItemCopy}><strong>{template.name}</strong><small>{template.language.toUpperCase()} · {id ? "diperbarui" : "updated"} {formatDate(template.updatedAt, language)}</small></span>
                  <ChevronRight size={15} />
                </button>
              ))
            ) : (
              <div className={styles.emptyState}>
                <FileText size={25} />
                <strong>{id ? "Belum ada template." : "No templates yet."}</strong>
                <span>{canCreate ? (id ? "Buat template pertama untuk mengaktifkan pengiriman dokumen." : "Create the first template to enable document delivery.") : (id ? "Belum ada template yang bisa ditampilkan." : "There are no templates to display.")}</span>
              </div>
            )}
          </div>
        </aside>

        <div className={styles.editor}>
          <div className={styles.editorHead}>
            <div>
              <span className="eyebrow">{selectedTemplate ? (id ? "EDIT TEMPLATE" : "EDIT TEMPLATE") : (id ? "TEMPLATE BARU" : "NEW TEMPLATE")}</span>
              <h3>{selectedTemplate ? selectedTemplate.name : (id ? `Template ${formKindLabel} baru` : `New ${formKindLabel} template`)}</h3>
              <p>{id ? "Gunakan placeholder dari server agar nilai dokumen diisi aman saat surat dirender." : "Use server-provided placeholders so document values are rendered safely."}</p>
            </div>
            <div className={styles.editorActions}>
              {selectedId && <button className="button danger small" type="button" onClick={() => void deleteTemplate()} disabled={!canManageKind || Boolean(busy)}><Trash2 size={14} /> {id ? "Hapus" : "Delete"}</button>}
              <button className="button primary small" type="submit" form="document-template-form" disabled={!canManageKind || Boolean(busy)} title={!canManageKind ? (id ? `Izin Kelola ${permissionLabel} diperlukan untuk menyimpan.` : `${permissionLabel} Manage permission is required to save.`) : undefined}>
                {busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                {id ? "Simpan" : "Save"}
              </button>
            </div>
          </div>

          <form id="document-template-form" className={styles.form} onSubmit={saveTemplate}>
            <fieldset disabled={!canManageKind || Boolean(busy)}>
              <div className={styles.formGrid}>
                <label className="field">
                  <span>{id ? "Nama template" : "Template name"} <b>*</b></span>
                  <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required minLength={2} maxLength={180} placeholder={id ? "Pengantar SPK vendor" : "Vendor work order cover letter"} />
                </label>
                <label className="field">
                  <span>{id ? "Jenis dokumen" : "Document type"} <b>*</b></span>
                  <select value={form.documentKind} onChange={(event) => updateForm("documentKind", event.target.value as DocumentEmailKind)} required>
                    {formKindOptions.map((kind) => <option value={kind} key={kind}>{documentEmailKindLabels[kind][id ? "id" : "en"]}</option>)}
                  </select>
                </label>
                <label className={`field ${styles.full}`}>
                  <span>{id ? "Subjek email" : "Email subject"} <b>*</b></span>
                  <input ref={subjectRef} value={form.subject} onChange={(event) => updateForm("subject", event.target.value)} required minLength={2} maxLength={300} placeholder={id ? "SPK {{nomor}} — {{proyek}}" : "Work order {{nomor}} — {{proyek}}"} />
                </label>
                <label className="field">
                  <span>{id ? "Format isi" : "Body format"}</span>
                  <select value={form.bodyFormat} onChange={(event) => updateForm("bodyFormat", event.target.value as LetterBodyFormat)} disabled={form.bodyFormat === "html"}>
                    <option value="text">{id ? "Teks biasa" : "Plain text"}</option>
                    <option value="rich">Rich-text</option>
                    {form.bodyFormat === "html" && <option value="html">{id ? "Editor visual (HTML)" : "Visual editor (HTML)"}</option>}
                  </select>
                </label>
                <div className={`field ${styles.full}`}>
                  <span>{id ? "Isi surat" : "Letter body"} <b>*</b></span>
                  <RichTextEditor
                    ref={bodyEditorRef}
                    value={form.bodyHtml}
                    format={form.bodyFormat}
                    disabled={!canManageKind || Boolean(busy)}
                    language={language}
                    onChange={(bodyHtml, bodyFormat) => {
                      setForm((current) => ({ ...current, bodyHtml, bodyFormat }));
                      setDirtyState(true);
                    }}
                  />
                </div>

                <div className={`${styles.sectionHeading} ${styles.full}`}>
                  <strong>{id ? "Tanda tangan pengirim" : "Sender signature"}</strong>
                  <span>{id ? "Kosongkan nama, email, atau telepon bila server harus memakai kontak perusahaan." : "Leave sender details empty when the server should use the company contact."}</span>
                </div>
                <label className="field">
                  <span>{id ? "Salam penutup" : "Sign-off"}</span>
                  <input value={form.senderSignoff} onChange={(event) => updateForm("senderSignoff", event.target.value)} maxLength={80} placeholder="Hormat kami," />
                </label>
                <label className="field">
                  <span>{id ? "Nama pengirim" : "Sender name"}</span>
                  <input value={form.senderName} onChange={(event) => updateForm("senderName", event.target.value)} maxLength={120} placeholder={id ? "Nama Anda" : "Your name"} />
                </label>
                <label className="field">
                  <span>{id ? "Email pengirim" : "Sender email"}</span>
                  <input type="email" value={form.senderEmail} onChange={(event) => updateForm("senderEmail", event.target.value)} maxLength={254} placeholder="nama@perumnet.id" />
                </label>
                <label className="field">
                  <span>{id ? "Telepon pengirim" : "Sender phone"}</span>
                  <input value={form.senderPhone} onChange={(event) => updateForm("senderPhone", event.target.value)} maxLength={40} placeholder={id ? "Nomor telepon (opsional)" : "Phone (optional)"} />
                </label>
                <label className="field">
                  <span>{id ? "Bahasa surat" : "Letter language"}</span>
                  <select value={form.language} onChange={(event) => updateForm("language", event.target.value as "id" | "en")}>
                    <option value="id">Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>

              <div className={styles.placeholderSection}>
                <div className={styles.placeholderHeading}>
                  <div><strong>{id ? "Placeholder dokumen" : "Document placeholders"}</strong><span>{id ? `Field untuk ${formKindLabel} berasal dari jawaban server.` : `Fields for ${formKindLabel} come from the server response.`}</span></div>
                  <span className={styles.placeholderKind}>{form.documentKind}</span>
                </div>
                {currentPlaceholders.length ? (
                  <>
                    <div className={styles.placeholderGroup}>
                      <span>{id ? "Sisipkan ke isi surat" : "Insert into letter body"}</span>
                      <div className={styles.placeholderRow}>
                        {currentPlaceholders.map((placeholder) => {
                          const hint = documentEmailPlaceholderHints[placeholder];
                          return <button type="button" className={styles.placeholderButton} key={`body-${placeholder}`} onClick={() => insertPlaceholder("bodyHtml", placeholder)} disabled={!canManageKind || Boolean(busy)}><code>{`{{${placeholder}}}`}</code><small>{hint?.[id ? "id" : "en"] ?? placeholder}</small></button>;
                        })}
                      </div>
                    </div>
                    <div className={styles.placeholderGroup}>
                      <span>{id ? "Sisipkan ke subjek" : "Insert into subject"}</span>
                      <div className={styles.placeholderRow}>
                        {currentPlaceholders.map((placeholder) => {
                          const hint = documentEmailPlaceholderHints[placeholder];
                          return <button type="button" className={styles.placeholderButton} key={`subject-${placeholder}`} onClick={() => insertPlaceholder("subject", placeholder)} disabled={!canManageKind || Boolean(busy)}><code>{`{{${placeholder}}}`}</code><small>{hint?.[id ? "id" : "en"] ?? placeholder}</small></button>;
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className={styles.muted}>{id ? "Placeholder belum tersedia dari server untuk jenis dokumen ini." : "No placeholders were returned for this document type."}</p>
                )}
              </div>

              <div className={styles.formFooter}>
                <span>{dirty ? (id ? "Perubahan belum disimpan." : "You have unsaved changes.") : (id ? "Template tersimpan akan muncul di dialog Kirim dokumen." : "Saved templates appear in the document delivery dialog.")}</span>
                <button className="button primary" type="submit" disabled={!canManageKind || Boolean(busy)}>
                  {busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                  {id ? "Simpan template" : "Save template"}
                </button>
              </div>
            </fieldset>
          </form>

          <div className={styles.previewNote}>
            <Mail size={18} />
            <div><strong>{id ? "Preview surat dibuat oleh server" : "Server-generated letter preview"}</strong><span>{id ? "Setelah template disimpan, dialog Kirim akan membuat preview surat lengkap dengan kop, tanda tangan, dan dokumen resmi." : "After saving, the Send dialog creates the complete server-rendered letter preview with its header, signature, and official document."}</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
