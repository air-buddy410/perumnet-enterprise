"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { api, ApiClientError, messageOf } from "../api-client";
import type { AppLanguage } from "../i18n";
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_TOTAL_MAX_BYTES,
  documentEmailKindLabels,
  type DocumentEmailKind,
  formatByteLimit,
  isAllowedAttachmentMimeType,
} from "../../shared/document-email";
import {
  emailDeliveryStatusLabels,
  type EmailDeliveryRecordStatus,
} from "../../shared/email-delivery";
import styles from "./document-email-dialog.module.css";

export type DocumentEmailTarget = {
  kind: DocumentEmailKind;
  id: string;
  number: string;
  projectName: string;
  recipientName: string;
  recipientEmail?: string | null;
};

type DocumentEmailTemplate = {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyFormat: "text" | "rich" | "html";
  documentKind: DocumentEmailKind;
  senderSignoff: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  language: "id" | "en";
  createdAt: string;
  updatedAt: string;
};

type TemplateDefaults = {
  starter?: Pick<DocumentEmailTemplate, "name" | "subject" | "bodyHtml" | "bodyFormat">;
  senderSignoff?: string;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
};

type DocumentEmailPreviewAttachment = {
  filename: string;
  byteSize: number;
};

type DocumentEmailPreview = {
  subject: string;
  bodyHtml: string;
  recipient: string;
  recipientName: string;
  attachments: DocumentEmailPreviewAttachment[];
};

type DocumentDeliveryAttachment = {
  filename: string;
  byteSize: number;
};

type DocumentDelivery = {
  id: string;
  recipient: string;
  recipientName: string;
  subject: string;
  status: EmailDeliveryRecordStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  failureReason: string;
  attachments: DocumentDeliveryAttachment[];
  createdAt: string;
  createdByName: string;
};

type SendResult = {
  deliveryId: string;
  recipient: string;
  status: EmailDeliveryRecordStatus;
  scheduledFor: string;
  attachments: Array<DocumentDeliveryAttachment & { generated?: boolean }>;
};

type DocumentEmailDialogProps = {
  target: DocumentEmailTarget;
  language: AppLanguage;
  canManage: boolean;
  canViewHistory?: boolean;
  onClose: () => void;
  onOpenRecipient?: () => void;
  onOpenTemplateManager?: (kind: DocumentEmailKind) => void;
  onSent: () => Promise<void>;
};

type UiError = {
  message: string;
  code?: string;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string | null, language: AppLanguage) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function deliveryTone(status: EmailDeliveryRecordStatus) {
  if (status === "Sent") return "success";
  if (status === "Failed") return "danger";
  if (status === "Queued") return "warning";
  return "neutral";
}

function detailsOf(error: unknown) {
  if (!(error instanceof ApiClientError) || !error.details || typeof error.details !== "object") {
    return {} as Record<string, unknown>;
  }
  return error.details as Record<string, unknown>;
}

function endpointFor(target: DocumentEmailTarget, action: string) {
  const resource = target.kind === "spk"
    ? "procurement-orders"
    : target.kind === "quotation"
      ? "quotations"
      : target.kind === "invoice"
        ? "invoices"
        : "bast";
  return `/api/${resource}/${encodeURIComponent(target.id)}/${action}`;
}

function errorFor(error: unknown, language: AppLanguage, target: DocumentEmailTarget): UiError {
  const code = error instanceof ApiClientError ? error.code : undefined;
  const details = detailsOf(error);
  const isVendor = target.kind === "spk";
  const recipient = typeof details.vendorName === "string"
    ? details.vendorName
    : typeof details.projectName === "string"
      ? details.projectName
      : target.recipientName || (isVendor ? "vendor" : "klien");
  const filename = typeof details.filename === "string" ? details.filename : "berkas";
  const permissionModule = isVendor
    ? "Procurement"
    : target.kind === "bast"
      ? "BAST Digital"
      : "Billing";

  if (code === "BAST_NOT_FINAL") {
    return {
      code,
      message: language === "id"
        ? "BAST belum final dan belum dapat dikirim. Finalkan dokumen terlebih dahulu."
        : "The handover is not final and cannot be sent yet. Finalize it first.",
    };
  }
  if (code === "BAST_REVOKED") {
    return {
      code,
      message: language === "id"
        ? "BAST ini sudah dicabut sehingga tidak dapat dikirim."
        : "This handover has been revoked and cannot be sent.",
    };
  }
  if (code === "BAST_ARCHIVE_MISMATCH") {
    return {
      code,
      message: language === "id"
        ? "Arsip final BAST tidak cocok dengan sidik dokumen. Hubungi Admin untuk pemeriksaan."
        : "The final handover archive does not match its recorded fingerprint. Ask an Admin to investigate.",
    };
  }
  if (code === "TEMPLATE_KIND_MISMATCH") {
    return {
      code,
      message: language === "id"
        ? "Template yang dipilih bukan template BAST. Pilih template surat BAST."
        : "The selected template is not a handover template. Choose a BAST letter template.",
    };
  }

  if (code === "VENDOR_EMAIL_MISSING" || code === "CLIENT_EMAIL_MISSING") {
    return {
      code,
      message: language === "id"
        ? isVendor
          ? `Alamat email ${recipient} belum diisi. Lengkapi alamat vendor di Procurement & Vendor; perubahan ini hanya dapat dilakukan Admin atau Finance.`
          : `Email klien untuk proyek ${recipient} belum diisi. Lengkapi di Manajemen Proyek sebelum mengirim quotation atau invoice.`
        : isVendor
          ? `${recipient} has no vendor email address. Complete it in Procurement & Vendor; only Admin or Finance can change it.`
          : `The client email for ${recipient} is missing. Complete it in Project Management before sending the quotation or invoice.`,
    };
  }
  if (code === "CLIENT_EMAIL_INVALID") {
    return {
      code,
      message: language === "id"
        ? "Alamat email klien tidak valid. Periksa kembali data kontak di Manajemen Proyek."
        : "The client email address is invalid. Check the contact data in Project Management.",
    };
  }
  if (code === "ORDER_NOT_SENDABLE" || code === "QUOTATION_NOT_SENDABLE") {
    return {
      code,
      message: language === "id"
        ? target.kind === "spk"
          ? "SPK/PO belum berada pada status Disetujui. Selesaikan persetujuan terlebih dahulu."
          : "Quotation belum dapat dikirim pada status saat ini. Periksa status dokumen terlebih dahulu."
        : target.kind === "spk"
          ? "The work order is not approved yet. Complete its approval first."
          : "The quotation cannot be sent in its current status. Check the document status first.",
    };
  }
  if (code === "ATTACHMENT_TOO_LARGE") {
    return {
      code,
      message: language === "id"
        ? `${filename} melebihi batas ${formatByteLimit(ATTACHMENT_MAX_BYTES)} per berkas.`
        : `${filename} exceeds the ${formatByteLimit(ATTACHMENT_MAX_BYTES)} per-file limit.`,
    };
  }
  if (code === "ATTACHMENT_TOTAL_TOO_LARGE") {
    return {
      code,
      message: language === "id"
        ? `Total dokumen resmi dan lampiran melebihi ${formatByteLimit(ATTACHMENT_TOTAL_MAX_BYTES)}.`
        : `The official document and attachments exceed the total ${formatByteLimit(ATTACHMENT_TOTAL_MAX_BYTES)} limit.`,
    };
  }
  if (code === "ATTACHMENT_TOO_MANY") {
    return {
      code,
      message: language === "id"
        ? `Maksimal ${ATTACHMENT_MAX_COUNT} lampiran tambahan.`
        : `You can add at most ${ATTACHMENT_MAX_COUNT} additional attachments.`,
    };
  }
  if (code === "INVALID_FILE_CONTENT") {
    return {
      code,
      message: language === "id"
        ? "Isi salah satu lampiran tidak cocok dengan jenis berkasnya. Pilih berkas PDF atau gambar yang valid."
        : "An attachment's contents do not match its declared type. Choose a valid PDF or image.",
    };
  }
  if (code === "FORBIDDEN") {
    return {
      code,
      message: language === "id"
        ? isVendor
          ? "Izin Kelola pada Procurement diperlukan untuk mengirim dokumen ke vendor."
          : `Izin Kelola pada ${permissionModule} diperlukan untuk mengirim dokumen ke klien.`
        : isVendor
          ? "Procurement Manage permission is required to email the vendor."
          : `${permissionModule} Manage permission is required to email the client.`,
    };
  }
  return { code, message: messageOf(error, language) };
}

export function DocumentEmailDialog({
  target,
  language,
  canManage,
  canViewHistory = canManage,
  onClose,
  onOpenRecipient,
  onOpenTemplateManager,
  onSent,
}: DocumentEmailDialogProps) {
  const id = language === "id";
  const isVendor = target.kind === "spk";
  const documentLabel = documentEmailKindLabels[target.kind][id ? "id" : "en"];
  const recipientEmail = target.recipientEmail?.trim() ?? "";
  const recipientType = isVendor ? (id ? "vendor" : "vendor") : (id ? "klien" : "client");
  const recipientSource = isVendor
    ? (id ? "Penerima dari data vendor" : "Recipient from vendor master")
    : (id ? "Penerima dari data proyek" : "Recipient from project data");
  const openRecipientLabel = isVendor
    ? (id ? "Buka data vendor" : "Open vendor")
    : (id ? "Buka Manajemen Proyek" : "Open Project Management");
  const missingEmailTitle = isVendor
    ? (id ? "Email vendor belum tersedia" : "Vendor email is missing")
    : (id ? "Email klien belum tersedia" : "Client email is missing");
  const [templates, setTemplates] = useState<DocumentEmailTemplate[]>([]);
  const [defaults, setDefaults] = useState<TemplateDefaults | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [history, setHistory] = useState<DocumentDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [templateError, setTemplateError] = useState<UiError | null>(null);
  const [historyError, setHistoryError] = useState<UiError | null>(null);
  const [preview, setPreview] = useState<DocumentEmailPreview | null>(null);
  const [previewTemplateId, setPreviewTemplateId] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<UiError | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const loadHistory = useCallback(async () => {
    if (!canViewHistory) {
      setHistory([]);
      setHistoryError({ message: id ? "Anda hanya dapat melihat riwayat email sesuai izin modul." : "Your module permission does not include email history." });
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    try {
      const data = await api<{ items: DocumentDelivery[] }>(endpointFor(target, "deliveries"));
      setHistory(data.items);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(errorFor(error, language, target));
    } finally {
      setHistoryLoading(false);
    }
  }, [canViewHistory, id, language, target]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setLoading(true);
      setHistoryLoading(true);
      setTemplateError(null);
      setHistoryError(null);
      setSendError(null);
      setSendResult(null);
      setTemplates([]);
      setDefaults(null);
      setHistory([]);
      setSelectedTemplateId("");
      setPreview(null);
      setPreviewTemplateId("");
      setFiles([]);
      setFileError("");

      const historyRequest = canViewHistory
        ? api<{ items: DocumentDelivery[] }>(endpointFor(target, "deliveries"))
        : Promise.resolve({ items: [] as DocumentDelivery[] });
      void Promise.allSettled([
        api<{ items: DocumentEmailTemplate[]; defaults?: TemplateDefaults }>(`/api/document-email-templates?documentType=${encodeURIComponent(target.kind)}`),
        historyRequest,
      ]).then(([templateResult, historyResult]) => {
        if (!active) return;
        if (templateResult.status === "fulfilled") {
          setTemplates(templateResult.value.items);
          setDefaults(templateResult.value.defaults ?? null);
          setSelectedTemplateId((current) => templateResult.value.items.some((item) => item.id === current)
            ? current
            : templateResult.value.items[0]?.id ?? "");
          setTemplateError(null);
        } else {
          setTemplateError(errorFor(templateResult.reason, language, target));
        }
        setLoading(false);

        if (!canViewHistory) {
          setHistory([]);
          setHistoryError({ message: id ? "Anda hanya dapat melihat riwayat email sesuai izin modul." : "Your module permission does not include email history." });
        } else if (historyResult.status === "fulfilled") {
          setHistory(historyResult.value.items);
          setHistoryError(null);
        } else {
          setHistoryError(errorFor(historyResult.reason, language, target));
        }
        setHistoryLoading(false);
      });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canViewHistory, id, language, refreshKey, target]);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const generatedBytes = useMemo(
    () => preview?.attachments.reduce((total, attachment) => total + attachment.byteSize, 0) ?? 0,
    [preview],
  );
  const additionalBytes = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  );
  const totalBytes = generatedBytes + additionalBytes;
  const totalAttachmentError = preview && totalBytes > ATTACHMENT_TOTAL_MAX_BYTES
    ? (id
      ? `Total perkiraan ${formatFileSize(totalBytes)} melebihi batas ${formatByteLimit(ATTACHMENT_TOTAL_MAX_BYTES)}.`
      : `The estimated total of ${formatFileSize(totalBytes)} exceeds ${formatByteLimit(ATTACHMENT_TOTAL_MAX_BYTES)}.`)
    : "";
  const previewReady = Boolean(preview && previewTemplateId === selectedTemplateId);
  const canPreview = Boolean(canManage && recipientEmail && selectedTemplateId && !previewBusy && !loading);
  const canSend = Boolean(canManage && previewReady && !totalAttachmentError && !fileError && !sendBusy && !previewBusy);

  function selectTemplate(nextId: string) {
    setSelectedTemplateId(nextId);
    setPreview(null);
    setPreviewTemplateId("");
    setSendError(null);
    setSendResult(null);
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (!incoming.length) return;
    if (files.length + incoming.length > ATTACHMENT_MAX_COUNT) {
      setFileError(id
        ? `Maksimal ${ATTACHMENT_MAX_COUNT} lampiran tambahan.`
        : `You can add at most ${ATTACHMENT_MAX_COUNT} additional attachments.`);
      return;
    }
    const invalidType = incoming.find((file) => !isAllowedAttachmentMimeType(file.type));
    if (invalidType) {
      setFileError(id
        ? `${invalidType.name} bukan PDF atau gambar yang didukung.`
        : `${invalidType.name} is not a supported PDF or image.`);
      return;
    }
    const oversized = incoming.find((file) => file.size > ATTACHMENT_MAX_BYTES);
    if (oversized) {
      setFileError(id
        ? `${oversized.name} melebihi batas ${formatByteLimit(ATTACHMENT_MAX_BYTES)}.`
        : `${oversized.name} exceeds the ${formatByteLimit(ATTACHMENT_MAX_BYTES)} per-file limit.`);
      return;
    }
    setFiles((current) => [...current, ...incoming]);
    setFileError("");
    setSendError(null);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setFileError("");
  }

  async function createPreview() {
    if (!selectedTemplateId || !recipientEmail) return;
    setPreviewBusy(true);
    setSendError(null);
    setSendResult(null);
    try {
      const result = await api<DocumentEmailPreview>(endpointFor(target, "send-email-preview"), {
        method: "POST",
        body: JSON.stringify({ templateId: selectedTemplateId }),
      });
      setPreview(result);
      setPreviewTemplateId(selectedTemplateId);
    } catch (error) {
      setPreview(null);
      setPreviewTemplateId("");
      setSendError(errorFor(error, language, target));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function sendEmail() {
    if (!previewReady || !canManage) return;
    if (totalAttachmentError || fileError) {
      setSendError({ message: totalAttachmentError || fileError });
      return;
    }
    setSendBusy(true);
    setSendError(null);
    try {
      const form = new FormData();
      form.set("templateId", selectedTemplateId);
      files.forEach((file) => form.append("files", file));
      const result = await api<SendResult>(endpointFor(target, "send-email"), {
        method: "POST",
        body: form,
      });
      setSendResult(result);
      await onSent();
      await loadHistory();
    } catch (error) {
      setSendError(errorFor(error, language, target));
    } finally {
      setSendBusy(false);
    }
  }

  const starter = defaults?.starter;
  const heading = id
    ? `Kirim ${target.number} ke ${recipientType}`
    : `Email ${target.number} to ${recipientType}`;
  const historyLabel = isVendor
    ? (id ? "Riwayat kirim vendor" : "Vendor delivery history")
    : (id ? "Riwayat kirim klien" : "Client delivery history");
  const sendLabel = isVendor
    ? (id ? "Kirim ke vendor" : "Send to vendor")
    : (id ? "Kirim ke klien" : "Send to client");

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`modal-card ${styles.dialogCard}`} role="dialog" aria-modal="true" aria-labelledby="document-email-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <span className="eyebrow">{id ? `KIRIM DOKUMEN ${isVendor ? "VENDOR" : "KLIEN"}` : `${isVendor ? "VENDOR" : "CLIENT"} DOCUMENT EMAIL`}</span>
            <h2 id="document-email-title">{heading}</h2>
            <p className={styles.dialogSubhead}>{documentLabel} · {target.projectName}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={id ? "Tutup" : "Close"}><X size={18} /></button>
        </header>

        <div className={styles.dialogBody}>
          <div className={styles.recipientCard}>
            <div className={styles.recipientIcon}><Mail size={18} /></div>
            <div>
              <span>{recipientSource}</span>
              <strong>{target.recipientName || recipientType}</strong>
              <small>{recipientEmail || (id ? "Alamat email belum diisi" : "Recipient email is missing")}</small>
            </div>
            {!recipientEmail && onOpenRecipient && <button type="button" className="button subtle small" onClick={onOpenRecipient}>{openRecipientLabel}</button>}
          </div>

          {!canManage && <div className={styles.infoNotice}><AlertTriangle size={17} /><span>{id ? `Mode lihat saja. Izin Kelola ${isVendor ? "Procurement" : "Billing"} diperlukan untuk mengirim.` : `Read-only mode. ${isVendor ? "Procurement" : "Billing"} Manage permission is required to send.`}</span></div>}
          {!recipientEmail && <div className={`${styles.errorNotice} ${styles.noticeWithAction}`}><AlertTriangle size={17} /><div><strong>{missingEmailTitle}</strong><span>{id ? `Lengkapi alamat email ${isVendor ? "vendor di Procurement & Vendor" : "klien di Manajemen Proyek"} sebelum membuat preview atau mengirim.` : `Complete the ${isVendor ? "vendor email in Procurement & Vendor" : "client email in Project Management"} before previewing or sending.`}</span></div>{onOpenRecipient && <button type="button" className="button subtle small" onClick={onOpenRecipient}>{openRecipientLabel}</button>}</div>}

          <div className={styles.dialogGrid}>
            <section className={styles.templatePane} aria-label={id ? "Pilih template" : "Choose template"}>
              <div className={styles.sectionHeading}><div><span className="eyebrow">01 · TEMPLATE</span><h3>{id ? "Pilih template surat" : "Choose letter template"}</h3></div><button type="button" className="icon-button" onClick={() => setRefreshKey((value) => value + 1)} aria-label={id ? "Muat ulang template" : "Reload templates"}><RefreshCw size={15} /></button></div>
              {loading ? <div className={styles.loadingState}><Loader2 className="spin" size={20} /> {id ? "Memuat template…" : "Loading templates…"}</div> : templateError ? <div className={styles.errorNotice}><AlertTriangle size={17} /><span>{templateError.message}</span></div> : templates.length ? <label className={styles.templateSelect}><span>{id ? "Template pengantar" : "Letter template"}</span><select value={selectedTemplateId} onChange={(event) => selectTemplate(event.target.value)} disabled={!canManage}><option value="">{id ? "Pilih template" : "Choose a template"}</option>{templates.map((template) => <option value={template.id} key={template.id}>{template.name} · {template.language.toUpperCase()}</option>)}</select></label> : <div className={styles.emptyState}><FileText size={22} /><strong>{id ? `Belum ada template ${isVendor ? "vendor" : "klien"}` : `No ${isVendor ? "vendor" : "client"} email template`}</strong><span>{starter ? `${starter.name} tersedia sebagai contoh, tetapi template tersimpan diperlukan untuk mengirim.` : (id ? "Buat template dokumen terlebih dahulu." : "Create a document template first.")}</span>{onOpenTemplateManager && <button className="button subtle small" type="button" data-testid="open-document-template-manager" onClick={() => onOpenTemplateManager(target.kind)}>{id ? "Buat template" : "Create template"}</button>}</div>}
              {selectedTemplate && <div className={styles.templateSummary}><strong>{selectedTemplate.name}</strong><span>{selectedTemplate.subject}</span><small>{id ? "Isi surat berasal dari template server; dokumen resmi dibuat server saat dikirim." : "The server template supplies the letter; the official document is generated when sent."}</small></div>}
              {selectedTemplateId && <div className={styles.templateGuard}>{id ? "Preview wajib sebelum tombol Kirim aktif." : "Preview is required before Send becomes active."}</div>}
            </section>

            <section className={styles.composePane} aria-label={id ? "Lampiran dan preview" : "Attachments and preview"}>
              <div className={styles.sectionHeading}><div><span className="eyebrow">02 · {id ? "LAMPIRAN & PREVIEW" : "ATTACHMENTS & PREVIEW"}</span><h3>{id ? "Tinjau sebelum kirim" : "Review before sending"}</h3></div></div>
              <label className={styles.filePicker}>
                <Paperclip size={18} />
                <span><strong>{id ? "Tambah lampiran" : "Add attachments"}</strong><small>PDF, PNG, JPG, WebP · {id ? `maks. ${ATTACHMENT_MAX_COUNT} file, ${formatByteLimit(ATTACHMENT_MAX_BYTES)} per file` : `up to ${ATTACHMENT_MAX_COUNT} files, ${formatByteLimit(ATTACHMENT_MAX_BYTES)} each`}</small></span>
                <input type="file" multiple accept={ATTACHMENT_ALLOWED_MIME_TYPES.join(",")} onChange={addFiles} disabled={!canManage || files.length >= ATTACHMENT_MAX_COUNT} />
              </label>
              {files.length > 0 && <div className={styles.fileList}>{files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`}><span><FileText size={15} /><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button type="button" className="icon-button danger" onClick={() => removeFile(index)} aria-label={`${id ? "Hapus" : "Remove"} ${file.name}`}><Trash2 size={14} /></button></div>)}</div>}
              {fileError && <p className={styles.fieldError}>{fileError}</p>}
              {preview && <div className={styles.attachmentEstimate}><span>{id ? "Perkiraan total lampiran" : "Estimated total attachments"}</span><strong>{formatFileSize(totalBytes)} / {formatByteLimit(ATTACHMENT_TOTAL_MAX_BYTES)}</strong></div>}
              {totalAttachmentError && <p className={styles.fieldError}>{totalAttachmentError}</p>}

              <div className={styles.previewToolbar}><span>{previewReady ? (id ? "Preview terbaru" : "Latest preview") : (id ? "Preview belum dibuat" : "Preview not created")}</span><button type="button" className="button secondary small" onClick={() => void createPreview()} disabled={!canPreview}>{previewBusy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}{id ? "Buat preview" : "Create preview"}</button></div>
              {preview ? <div className={styles.previewBox}><div className={styles.previewMeta}><div><span>{id ? "Subjek" : "Subject"}</span><strong>{preview.subject}</strong></div><div><span>{id ? "Penerima" : "Recipient"}</span><strong>{preview.recipientName || preview.recipient}</strong><small>{preview.recipient}</small></div></div><iframe className={styles.previewFrame} srcDoc={preview.bodyHtml} sandbox="" title={id ? `Preview ${target.number}` : `Preview ${target.number}`} />{preview.attachments.length > 0 && <div className={styles.generatedAttachments}><strong>{id ? "Lampiran otomatis" : "Automatic attachment"}</strong>{preview.attachments.map((attachment) => <span key={attachment.filename}><FileText size={14} />{attachment.filename}<small>{formatFileSize(attachment.byteSize)}</small></span>)}</div>}</div> : <div className={styles.previewEmpty}><Mail size={21} /><span>{id ? "Pilih template lalu buat preview surat lengkap dengan kop, tanda tangan, dan dokumen resmi." : "Choose a template to preview the complete letter with its header, signature, and official document."}</span></div>}
            </section>
          </div>

          {sendError && <div className={`${styles.errorNotice} ${styles.noticeWithAction}`}><AlertTriangle size={17} /><div><strong>{sendError.code === "VENDOR_EMAIL_MISSING" || sendError.code === "CLIENT_EMAIL_MISSING" || sendError.code === "CLIENT_EMAIL_INVALID" ? (id ? "Email penerima perlu diperbaiki" : "Recipient email needs attention") : (id ? "Pengiriman belum berhasil" : "Sending was not completed")}</strong><span>{sendError.message}</span></div>{(sendError.code === "VENDOR_EMAIL_MISSING" || sendError.code === "CLIENT_EMAIL_MISSING" || sendError.code === "CLIENT_EMAIL_INVALID") && onOpenRecipient && <button type="button" className="button subtle small" onClick={onOpenRecipient}>{openRecipientLabel}</button>}</div>}
          {sendResult && <div className={styles.successNotice}><CheckCircle2 size={18} /><div><strong>{id ? "Dokumen masuk antrean pengiriman" : "Document queued for delivery"}</strong><span>{id ? `Status: ${emailDeliveryStatusLabels[sendResult.status].id}. Data dokumen sudah dimuat ulang.` : `Status: ${emailDeliveryStatusLabels[sendResult.status].en}. The document data has been refreshed.`}</span></div></div>}

          <section className={styles.historySection} aria-label={historyLabel}>
            <div className={styles.sectionHeading}><div><span className="eyebrow">03 · {id ? "RIWAYAT" : "HISTORY"}</span><h3>{id ? "Riwayat kirim dokumen" : "Document delivery history"}</h3></div><button type="button" className="button subtle small" onClick={() => void loadHistory()} disabled={historyLoading || !canViewHistory}>{historyLoading ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}{id ? "Muat ulang" : "Refresh"}</button></div>
            {historyLoading ? <div className={styles.loadingState}><Loader2 className="spin" size={18} /> {id ? "Memuat riwayat…" : "Loading history…"}</div> : historyError ? <div className={styles.errorNotice}><AlertTriangle size={17} /><span>{historyError.message}</span></div> : history.length ? <div className={styles.historyList}>{history.map((delivery) => <article key={delivery.id}><div className={styles.historyIcon}><Mail size={15} /></div><div className={styles.historyMain}><strong>{delivery.subject}</strong><span>{delivery.recipientName || delivery.recipient} · {delivery.recipient}</span><small>{formatDateTime(delivery.createdAt, language)}{delivery.sentAt ? ` · ${id ? "terkirim" : "sent"} ${formatDateTime(delivery.sentAt, language)}` : ""}{delivery.createdByName ? ` · ${delivery.createdByName}` : ""}</small>{delivery.failureReason && <p>{delivery.failureReason}</p>}{delivery.attachments.length > 0 && <div className={styles.historyAttachments}>{delivery.attachments.map((attachment) => <span key={attachment.filename}><FileText size={13} />{attachment.filename} · {formatFileSize(attachment.byteSize)}</span>)}</div>}</div><span className={`status-badge ${deliveryTone(delivery.status)}`}>{emailDeliveryStatusLabels[delivery.status][id ? "id" : "en"]}</span></article>)}</div> : <div className={styles.emptyHistory}><Mail size={19} /><span>{id ? `Belum ada ${documentLabel.toLowerCase()} yang dikirim dari dokumen ini.` : `No ${documentLabel.toLowerCase()} has been sent from this document yet.`}</span></div>}
          </section>
        </div>

        <footer className={styles.dialogFooter}>
          <span>{id ? "Pratinjau server wajib. Dokumen resmi tidak diunggah ulang." : "A server preview is required. The official document is never re-uploaded."}</span>
          <div><button className="button secondary" type="button" onClick={onClose}>{id ? "Tutup" : "Close"}</button><button className="button primary" type="button" disabled={!canSend} onClick={() => void sendEmail()}>{sendBusy ? <Loader2 className="spin" size={16} /> : <Mail size={16} />}{sendLabel}</button></div>
        </footer>
      </section>
    </div>
  );
}
