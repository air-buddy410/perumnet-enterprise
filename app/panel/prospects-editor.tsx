"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArchiveX,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  LoaderCircle,
  Mail,
  MailPlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";
import {
  PROSPECT_DEFAULT_SPACING_SECONDS,
  PROSPECT_MAX_RECIPIENTS_PER_BATCH,
  PROSPECT_MAX_SPACING_SECONDS,
  prospectPlaceholderHints,
  prospectPlaceholders,
  prospectSegmentLabels,
  prospectSegments,
  prospectOutreachStatusLabels,
  prospectOutreachStatuses,
  prospectStatusLabels,
  prospectStatuses,
  allowedProspectTransitions,
  type ProspectSegment,
  type ProspectOutreachStatus,
  type ProspectStatus,
} from "../../shared/prospects";
import { api, ApiClientError } from "../api-client";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor";
import styles from "./prospects.module.css";

type WorkspaceTab = "list" | "add" | "import" | "outreach" | "reports" | "templates";

type Staff = { id: string; name: string; role: string };

type Prospect = {
  id: string;
  fullName: string;
  email: string;
  companyName: string;
  jobTitle: string;
  whatsapp: string;
  location: string;
  industry: string;
  segment: ProspectSegment | null;
  serviceInterest: string;
  notes: string;
  source: string;
  status: ProspectStatus;
  assignedTo: string | null;
  assignedName: string | null;
  optOutAt: string | null;
  optOutReason: string;
  lastOutreachAt: string | null;
  createdAt: string;
  updatedAt: string;
  emailable: boolean;
  projectId: string | null;
  projectCode: string | null;
};

type OutreachRecord = {
  id: string;
  templateId: string | null;
  templateName: string;
  recipient: string;
  subject: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  failureReason: string;
  createdAt: string;
  hasBody: boolean;
};

type ProspectDetail = Prospect & { outreach: OutreachRecord[] };

type ProspectTemplate = {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyFormat: "text" | "rich" | "html";
  senderSignoff: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  language: "id" | "en";
  createdAt: string;
  updatedAt: string;
};

type ProspectTemplateDefaults = {
  starter: {
    name: string;
    subject: string;
    bodyHtml: string;
    bodyFormat: "text" | "rich" | "html";
  };
  senderSignoff: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
};

type TemplateForm = {
  name: string;
  subject: string;
  bodyHtml: string;
  bodyFormat: "text" | "rich" | "html";
  senderSignoff: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  language: "id" | "en";
};

type Preview = { subject: string; bodyHtml: string; recipient: string };

type ImportIssue = { sheet: string; row: number; code: string; detail: string };
type ImportResult = {
  dryRun: boolean;
  sheets: string[];
  terbaca: number;
  disimpan: number;
  dilewati: number;
  issues: ImportIssue[];
};

type SkippedRecipient = { prospectId: string; reason: string };
type OutreachResult = {
  queued: number;
  skipped: SkippedRecipient[];
  spacingSeconds: number;
  items: Array<{ prospectId: string; outreachId: string; status: string; scheduledFor: string }>;
};

type OutreachSummary = {
  Queued: number;
  Sent: number;
  Failed: number;
  Skipped: number;
  total: number;
};

type OutreachBatch = {
  batchId: string;
  templateName: string;
  createdAt: string;
  firstScheduledFor: string;
  lastScheduledFor: string;
  lastSentAt: string | null;
  total: number;
  sent: number;
  failed: number;
  queued: number;
  skipped: number;
  selesai: boolean;
};

type OutreachLog = {
  id: string;
  batchId: string | null;
  prospectId: string;
  prospectName: string;
  companyName: string;
  templateId: string | null;
  templateName: string;
  recipient: string;
  subject: string;
  status: ProspectOutreachStatus;
  scheduledFor: string;
  sentAt: string | null;
  failureReason: string;
  createdAt: string;
  attempts: number | null;
  nextAttemptAt: string | null;
  hasBody: boolean;
};

const OUTREACH_REPORT_BATCH_LIMIT = 30;
const OUTREACH_REPORT_PAGE_SIZE = 25;
const OUTREACH_REPORT_POLL_MS = 20_000;
const emptyOutreachSummary: OutreachSummary = {
  Queued: 0,
  Sent: 0,
  Failed: 0,
  Skipped: 0,
  total: 0,
};

type ManualForm = {
  fullName: string;
  email: string;
  companyName: string;
  jobTitle: string;
  whatsapp: string;
  location: string;
  industry: string;
  segment: ProspectSegment | "";
  serviceInterest: string;
  notes: string;
  source: string;
  status: ProspectStatus;
  assignedTo: string;
};

type EditForm = Omit<ManualForm, "assignedTo"> & { assignedTo: string };

type ConversionForm = {
  name: string;
  status: "Draft" | "Aktif";
  managerId: string;
  startDate: string;
  targetDate: string;
  location: string;
};

type ConversionResult = {
  project: { id: string; code: string; name: string };
  prospect: Prospect;
};

const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof Search }> = [
  { id: "list", label: "Daftar prospek", icon: Search },
  { id: "add", label: "Tambah kontak", icon: UserRoundPlus },
  { id: "import", label: "Impor XLSX", icon: FileSpreadsheet },
  { id: "outreach", label: "Komposer email", icon: MailPlus },
  { id: "reports", label: "Laporan kirim", icon: BarChart3 },
  { id: "templates", label: "Template surat", icon: FileText },
];

const initialManualForm: ManualForm = {
  fullName: "",
  email: "",
  companyName: "",
  jobTitle: "",
  whatsapp: "",
  location: "",
  industry: "",
  segment: "",
  serviceInterest: "",
  notes: "",
  source: "",
  status: "New",
  assignedTo: "",
};

const initialTemplateForm: TemplateForm = {
  name: "Template surat baru",
  subject: "Penawaran solusi PerumNet untuk {{perusahaan}}",
  bodyHtml: "Yth. Bapak/Ibu,\n\nTulis isi surat di sini.",
  bodyFormat: "text",
  senderSignoff: "",
  senderName: "",
  senderEmail: "",
  senderPhone: "",
  language: "id" as "id" | "en",
};

function templateFormFromDefaults(defaults: ProspectTemplateDefaults | null): TemplateForm {
  return {
    name: defaults?.starter.name || initialTemplateForm.name,
    subject: defaults?.starter.subject || initialTemplateForm.subject,
    bodyHtml: defaults?.starter.bodyHtml || initialTemplateForm.bodyHtml,
    bodyFormat: defaults?.starter.bodyFormat ?? "text",
    senderSignoff: defaults?.senderSignoff || initialTemplateForm.senderSignoff,
    senderName: defaults?.senderName || initialTemplateForm.senderName,
    senderEmail: defaults?.senderEmail || initialTemplateForm.senderEmail,
    senderPhone: defaults?.senderPhone || initialTemplateForm.senderPhone,
    language: "id",
  };
}

function templateFormFromTemplate(template: ProspectTemplate): TemplateForm {
  return {
    name: template.name,
    subject: template.subject,
    bodyHtml: template.bodyHtml,
    bodyFormat: template.bodyFormat,
    senderSignoff: template.senderSignoff ?? "",
    senderName: template.senderName ?? "",
    senderEmail: template.senderEmail ?? "",
    senderPhone: template.senderPhone ?? "",
    language: template.language,
  };
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    timeZone: "Asia/Makassar",
  }).format(date).replace(":", ".");
}

function reportDateBound(value: string, endOfDay = false) {
  if (!value) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "langsung";
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining ? `${minutes} m ${remaining} d` : `${minutes} menit`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function detailsOf(error: unknown) {
  return error instanceof ApiClientError && error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : null;
}

function duplicateProspectId(error: unknown) {
  const details = detailsOf(error);
  return typeof details?.prospectId === "string" ? details.prospectId : null;
}

function skippedRecipients(error: unknown) {
  const details = detailsOf(error);
  return Array.isArray(details?.skipped) ? details.skipped as SkippedRecipient[] : [];
}

function statusClass(status: ProspectStatus) {
  return {
    New: styles.statusNew,
    Contacted: styles.statusContacted,
    Qualified: styles.statusQualified,
    Proposal: styles.statusProposal,
    Won: styles.statusWon,
    Lost: styles.statusLost,
  }[status];
}

function segmentLabel(segment: ProspectSegment | null) {
  return segment ? prospectSegmentLabels[segment]?.id ?? segment : "Belum dipetakan";
}

function reasonLabel(reason: string) {
  return {
    OPTED_OUT: "meminta berhenti dihubungi",
    NO_EMAIL: "tidak memiliki alamat email",
    NOT_FOUND: "prospek tidak ditemukan",
  }[reason] ?? reason;
}

function outreachStatusClass(status: string) {
  return {
    Queued: styles.reportStatusQueued,
    Sent: styles.reportStatusSent,
    Failed: styles.reportStatusFailed,
    Skipped: styles.reportStatusSkipped,
  }[status] ?? styles.reportStatusUnknown;
}

function outreachStatClass(status: ProspectOutreachStatus) {
  return {
    Queued: styles.reportStatQueued,
    Sent: styles.reportStatSent,
    Failed: styles.reportStatFailed,
    Skipped: styles.reportStatSkipped,
  }[status];
}

function editFormFrom(prospect: Prospect): EditForm {
  return {
    fullName: prospect.fullName,
    email: prospect.email,
    companyName: prospect.companyName,
    jobTitle: prospect.jobTitle,
    whatsapp: prospect.whatsapp,
    location: prospect.location,
    industry: prospect.industry,
    segment: prospect.segment ?? "",
    serviceInterest: prospect.serviceInterest,
    notes: prospect.notes,
    source: prospect.source,
    status: prospect.status,
    assignedTo: prospect.assignedTo ?? "",
  };
}

function conversionFormFrom(prospect: Prospect): ConversionForm {
  return {
    name: prospect.companyName || prospect.fullName,
    status: "Draft",
    managerId: "",
    startDate: "",
    targetDate: "",
    location: prospect.location,
  };
}

function formValue(value: string) {
  return value.trim() || undefined;
}

function Field({
  label,
  required = false,
  hint,
  wide = false,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return <label className={`${styles.formField}${wide ? ` ${styles.formFieldWide}` : ""}`}><span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function PreviewFrame({ preview, title }: { preview: Preview; title: string }) {
  return <div className={styles.previewBox}>
    <div className={styles.previewMeta}><div><span>SUBJEK</span><strong>{preview.subject}</strong></div><div><span>KEPADA</span><strong>{preview.recipient || "Tanpa email"}</strong></div></div>
    <iframe className={styles.previewFrame} title={title} srcDoc={preview.bodyHtml} sandbox="" />
    <small className={styles.safeNote}>Pratinjau memakai dokumen surat dari server dalam frame terisolasi.</small>
  </div>;
}

export function ProspectsEditor({
  canManage,
  canManageProjects,
  onProjectOpen,
}: {
  canManage: boolean;
  canManageProjects: boolean;
  onProjectOpen?: (projectId: string) => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("list");
  const [items, setItems] = useState<Prospect[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");
  const [segment, setSegment] = useState("");
  const [emailableOnly, setEmailableOnly] = useState(false);
  const [optOutOnly, setOptOutOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<ProspectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error">("success");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [optOutReason, setOptOutReason] = useState("");
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionError, setConversionError] = useState("");
  const [conversionForm, setConversionForm] = useState<ConversionForm>({
    name: "",
    status: "Draft",
    managerId: "",
    startDate: "",
    targetDate: "",
    location: "",
  });

  const [manualForm, setManualForm] = useState<ManualForm>(initialManualForm);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualDuplicateId, setManualDuplicateId] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSource, setImportSource] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [templates, setTemplates] = useState<ProspectTemplate[]>([]);
  const [templateDefaults, setTemplateDefaults] = useState<ProspectTemplateDefaults | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [templateForm, setTemplateForm] = useState<TemplateForm>(initialTemplateForm);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templatePreviewProspectId, setTemplatePreviewProspectId] = useState("");
  const [templatePreview, setTemplatePreview] = useState<Preview | null>(null);
  const [templatePreviewBusy, setTemplatePreviewBusy] = useState(false);
  const templatesInitializedRef = useRef(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyEditorRef = useRef<RichTextEditorHandle>(null);

  const [spacingSeconds, setSpacingSeconds] = useState(String(PROSPECT_DEFAULT_SPACING_SECONDS));
  const [previewProspectId, setPreviewProspectId] = useState("");
  const [outreachPreview, setOutreachPreview] = useState<Preview | null>(null);
  const [outreachPreviewBusy, setOutreachPreviewBusy] = useState(false);
  const [outreachBusy, setOutreachBusy] = useState(false);
  const [outreachResult, setOutreachResult] = useState<OutreachResult | null>(null);
  const [outreachSkipped, setOutreachSkipped] = useState<SkippedRecipient[]>([]);

  const [reportBatches, setReportBatches] = useState<OutreachBatch[]>([]);
  const [reportBatchesLoading, setReportBatchesLoading] = useState(false);
  const [reportBatchId, setReportBatchId] = useState("");
  const [reportItems, setReportItems] = useState<OutreachLog[]>([]);
  const [reportSummary, setReportSummary] = useState<OutreachSummary>(emptyOutreachSummary);
  const [reportTotal, setReportTotal] = useState(0);
  const [reportPage, setReportPage] = useState(1);
  const [reportQuery, setReportQuery] = useState("");
  const [reportSearchInput, setReportSearchInput] = useState("");
  const [reportStatus, setReportStatus] = useState<ProspectOutreachStatus | "">("");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportDetailsLoading, setReportDetailsLoading] = useState(false);
  const reportDetailRequestRef = useRef(0);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    if (segment) params.set("segment", segment);
    if (emailableOnly) params.set("emailable", "1");
    if (optOutOnly) params.set("optOut", "1");
    return params.toString();
  }, [emailableOnly, optOutOnly, page, query, segment, status]);

  const showNotice = useCallback((message: string, kind: "success" | "error" = "success") => {
    setNotice(message);
    setNoticeKind(kind);
  }, []);

  const loadProspects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Prospect[]; page: number; total: number; staff: Staff[] }>(`/api/cms/prospects?${filterParams}`);
      setItems(data.items);
      setTotal(data.total);
      setStaff(data.staff);
    } catch (error) {
      showNotice(errorMessage(error, "Daftar prospek gagal dimuat."), "error");
    } finally {
      setLoading(false);
    }
  }, [filterParams, showNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProspects(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProspects]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const data = await api<{ items: ProspectTemplate[]; defaults?: ProspectTemplateDefaults }>("/api/cms/prospect-templates");
      setTemplates(data.items);
      setTemplateDefaults(data.defaults ?? null);
      if (!templatesInitializedRef.current) {
        templatesInitializedRef.current = true;
        if (data.items[0]) {
          const first = data.items[0];
          setTemplateId(first.id);
          setTemplateForm(templateFormFromTemplate(first));
          setTemplateDirty(false);
        } else {
          setTemplateForm(templateFormFromDefaults(data.defaults ?? null));
          setTemplateDirty(false);
        }
      }
    } catch (error) {
      showNotice(errorMessage(error, "Template surat gagal dimuat."), "error");
    } finally {
      setTemplatesLoading(false);
    }
  }, [showNotice]);

  useEffect(() => {
    if (tab !== "outreach" && tab !== "templates") return;
    const timer = window.setTimeout(() => void loadTemplates(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTemplates, tab]);

  const loadReportBatches = useCallback(async (silent = false) => {
    if (!silent) setReportBatchesLoading(true);
    try {
      const data = await api<{ items: OutreachBatch[] }>(`/api/cms/prospects/outreach/batches?limit=${OUTREACH_REPORT_BATCH_LIMIT}`);
      setReportBatches(data.items);
    } catch (error) {
      if (!silent) showNotice(errorMessage(error, "Laporan kirim gagal dimuat."), "error");
    } finally {
      if (!silent) setReportBatchesLoading(false);
    }
  }, [showNotice]);

  const loadReportDetails = useCallback(async (batchId: string, silent = false) => {
    const requestId = ++reportDetailRequestRef.current;
    if (!batchId) {
      setReportItems([]);
      setReportSummary({ ...emptyOutreachSummary });
      setReportTotal(0);
      setReportDetailsLoading(false);
      return;
    }
    if (!silent) setReportDetailsLoading(true);
    const params = new URLSearchParams({
      batchId,
      page: String(reportPage),
      pageSize: String(OUTREACH_REPORT_PAGE_SIZE),
    });
    if (reportQuery) params.set("q", reportQuery);
    if (reportStatus) params.set("status", reportStatus);
    const from = reportDateBound(reportFrom);
    const to = reportDateBound(reportTo, true);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const data = await api<{
        items: OutreachLog[];
        page: number;
        pageSize: number;
        total: number;
        summary: OutreachSummary;
      }>(`/api/cms/prospects/outreach?${params.toString()}`);
      if (requestId !== reportDetailRequestRef.current) return;
      setReportItems(data.items);
      setReportPage(data.page);
      setReportTotal(data.total);
      setReportSummary(data.summary);
    } catch (error) {
      if (requestId === reportDetailRequestRef.current && !silent) {
        showNotice(errorMessage(error, "Detail laporan kirim gagal dimuat."), "error");
      }
    } finally {
      if (requestId === reportDetailRequestRef.current && !silent) setReportDetailsLoading(false);
    }
  }, [reportFrom, reportPage, reportQuery, reportStatus, reportTo, showNotice]);

  useEffect(() => {
    if (tab !== "reports") return;
    let active = true;
    const refresh = (initial = false) => {
      if (!active || document.visibilityState !== "visible") return;
      void loadReportBatches(!initial);
      if (reportBatchId) void loadReportDetails(reportBatchId, !initial);
    };
    refresh(true);
    const timer = window.setInterval(() => refresh(), OUTREACH_REPORT_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadReportBatches, loadReportDetails, reportBatchId, tab]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function openProspect(id: string) {
    setDetailLoading(true);
    try {
      const detail = await api<ProspectDetail>(`/api/cms/prospects/${id}`);
      setSelected(detail);
      setEditForm(editFormFrom(detail));
      setOptOutReason("");
    } catch (error) {
      showNotice(errorMessage(error, "Detail prospek gagal dimuat."), "error");
    } finally {
      setDetailLoading(false);
    }
  }

  function openConversion() {
    if (!canManageProjects || !selected || selected.projectId || selected.status === "Lost" || selected.optOutAt) return;
    setConversionError("");
    setConversionForm(conversionFormFrom(selected));
    setConversionOpen(true);
  }

  async function convertProspect(event: FormEvent) {
    event.preventDefault();
    if (!canManageProjects || !selected) return;
    const selectedId = selected.id;
    const location = conversionForm.location.trim();
    if (!selected.location && !location) {
      setConversionError("Isi lokasi proyek terlebih dahulu.");
      return;
    }
    const body: Record<string, unknown> = {
      name: conversionForm.name.trim() || undefined,
      status: conversionForm.status,
      managerId: conversionForm.managerId || undefined,
      startDate: conversionForm.startDate || undefined,
      targetDate: conversionForm.targetDate || undefined,
    };
    if (!selected.location) body.location = location;
    setConversionBusy(true);
    setConversionError("");
    try {
      const result = await api<ConversionResult>(
        "/api/cms/prospects/" + encodeURIComponent(selectedId) + "/convert",
        { method: "POST", body: JSON.stringify(body) },
      );
      setConversionOpen(false);
      await loadProspects();
      await openProspect(selectedId);
      onProjectOpen?.(result.project.id);
      showNotice("Prospek berhasil dijadikan proyek " + result.project.code + ".");
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "PROSPECT_ALREADY_CONVERTED") {
        setConversionOpen(false);
        await loadProspects();
        await openProspect(selectedId);
      }
      const message = errorMessage(error, "Prospek gagal dijadikan proyek.");
      setConversionError(message);
      showNotice(message, "error");
    } finally {
      setConversionBusy(false);
    }
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
    setOutreachPreview(null);
    setOutreachResult(null);
    setOutreachSkipped([]);
  }

  const visibleEligibleIds = items.filter((item) => item.emailable).map((item) => item.id);
  const allVisibleSelected = visibleEligibleIds.length > 0 && visibleEligibleIds.every((id) => selectedIds.includes(id));

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds((current) => {
      if (!checked) return current.filter((id) => !visibleEligibleIds.includes(id));
      return [...new Set([...current, ...visibleEligibleIds])];
    });
    setOutreachPreview(null);
    setOutreachResult(null);
    setOutreachSkipped([]);
  }

  async function saveProspect(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !selected || !editForm) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        fullName: editForm.fullName.trim(),
        email: editForm.email.trim(),
        companyName: formValue(editForm.companyName),
        jobTitle: formValue(editForm.jobTitle),
        whatsapp: formValue(editForm.whatsapp),
        location: formValue(editForm.location),
        industry: formValue(editForm.industry),
        serviceInterest: formValue(editForm.serviceInterest),
        notes: formValue(editForm.notes),
        source: editForm.source.trim(),
        status: editForm.status,
        assignedTo: editForm.assignedTo || null,
      };
      if (editForm.segment) payload.segment = editForm.segment;
      const updated = await api<ProspectDetail>(`/api/cms/prospects/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSelected(updated);
      setEditForm(editFormFrom(updated));
      await loadProspects();
      showNotice("Prospek berhasil diperbarui.");
    } catch (error) {
      showNotice(errorMessage(error, "Perubahan prospek gagal disimpan."), "error");
    } finally {
      setSaving(false);
    }
  }

  async function markOptOut() {
    if (!canManage || !selected || selected.optOutAt) return;
    if (!window.confirm("Tandai prospek ini sebagai tidak boleh dihubungi? Tindakan ini bersifat permanen.")) return;
    setSaving(true);
    try {
      const updated = await api<ProspectDetail>(`/api/cms/prospects/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ optOut: true, optOutReason: optOutReason.trim() || undefined }),
      });
      setSelected(updated);
      setEditForm(editFormFrom(updated));
      setSelectedIds((current) => current.filter((id) => id !== updated.id));
      await loadProspects();
      showNotice("Prospek ditandai tidak boleh dihubungi.");
    } catch (error) {
      showNotice(errorMessage(error, "Status opt-out gagal disimpan."), "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProspect() {
    if (!canManage || !selected || !window.confirm(`Hapus prospek ${selected.fullName}? Data akan diarsipkan dari daftar.`)) return;
    setSaving(true);
    try {
      await api(`/api/cms/prospects/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setEditForm(null);
      setSelectedIds((current) => current.filter((id) => id !== selected.id));
      await loadProspects();
      showNotice("Prospek dihapus dari daftar.");
    } catch (error) {
      showNotice(errorMessage(error, "Prospek gagal dihapus."), "error");
    } finally {
      setSaving(false);
    }
  }

  async function createProspect(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setManualBusy(true);
    setManualDuplicateId(null);
    try {
      const payload: Record<string, unknown> = {
        fullName: manualForm.fullName.trim(),
        email: manualForm.email.trim(),
        companyName: formValue(manualForm.companyName),
        jobTitle: formValue(manualForm.jobTitle),
        whatsapp: formValue(manualForm.whatsapp),
        location: formValue(manualForm.location),
        industry: formValue(manualForm.industry),
        serviceInterest: formValue(manualForm.serviceInterest),
        notes: formValue(manualForm.notes),
        source: manualForm.source.trim(),
        status: manualForm.status,
        assignedTo: manualForm.assignedTo || null,
      };
      if (manualForm.segment) payload.segment = manualForm.segment;
      const created = await api<Prospect>("/api/cms/prospects", { method: "POST", body: JSON.stringify(payload) });
      setManualForm(initialManualForm);
      setTab("list");
      setPage(1);
      setQuery(created.email);
      setSearchInput(created.email);
      await loadProspects();
      await openProspect(created.id);
      showNotice("Prospek baru berhasil ditambahkan.");
    } catch (error) {
      const duplicateId = duplicateProspectId(error);
      setManualDuplicateId(duplicateId);
      showNotice(errorMessage(error, "Prospek baru gagal ditambahkan."), "error");
    } finally {
      setManualBusy(false);
    }
  }

  async function importWorkbook(dryRun: boolean) {
    if (!canManage) return;
    if (!importFile) {
      showNotice("Pilih berkas XLSX terlebih dahulu.", "error");
      return;
    }
    if (!importSource.trim() || importSource.trim().length < 2) {
      showNotice("Isi catatan sumber impor minimal 2 karakter.", "error");
      return;
    }
    if (importFile.size > 5 * 1024 * 1024 || !/\.xlsx$/i.test(importFile.name)) {
      showNotice("Gunakan berkas XLSX maksimal 5 MB.", "error");
      return;
    }
    setImportBusy(true);
    try {
      const form = new FormData();
      form.set("file", importFile);
      form.set("source", importSource.trim());
      if (dryRun) form.set("dryRun", "1");
      const result = await api<ImportResult>("/api/cms/prospects/import", { method: "POST", body: form });
      setImportResult(result);
      await loadProspects();
      showNotice(dryRun ? "Dry-run selesai. Periksa isu sebelum menyimpan." : `${result.disimpan} prospek berhasil diimpor.`);
    } catch (error) {
      const details = detailsOf(error);
      const issues = Array.isArray(details?.issues) ? details.issues as ImportIssue[] : [];
      if (issues.length) setImportResult({ dryRun, sheets: Array.isArray(details?.sheets) ? details.sheets as string[] : [], terbaca: 0, disimpan: 0, dilewati: 0, issues });
      showNotice(errorMessage(error, "Impor workbook gagal."), "error");
    } finally {
      setImportBusy(false);
    }
  }

  async function previewTemplate(template: ProspectTemplate | null, prospectId: string, setPreview: (value: Preview | null) => void, setBusy: (value: boolean) => void) {
    if (!template || !prospectId) {
      showNotice("Pilih template dan satu prospek untuk pratinjau.", "error");
      return;
    }
    setBusy(true);
    try {
      setPreview(await api<Preview>(`/api/cms/prospect-templates/${template.id}/preview`, {
        method: "POST",
        body: JSON.stringify({ prospectId }),
      }));
    } catch (error) {
      showNotice(errorMessage(error, "Pratinjau template gagal dibuat."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function previewOutreach() {
    const template = templates.find((item) => item.id === templateId) ?? null;
    const targetId = previewProspectId && selectedIds.includes(previewProspectId)
      ? previewProspectId
      : items.find((item) => selectedIds.includes(item.id) && item.emailable)?.id ?? "";
    await previewTemplate(template, targetId, setOutreachPreview, setOutreachPreviewBusy);
  }

  async function sendOutreach() {
    if (!canManage) return;
    const spacing = Number(spacingSeconds);
    if (!templateId || !outreachPreview) {
      showNotice("Buat pratinjau template sebelum mengantrekan email.", "error");
      return;
    }
    if (!Number.isInteger(spacing) || spacing < 0 || spacing > PROSPECT_MAX_SPACING_SECONDS) {
      showNotice(`Jeda harus berupa angka 0–${PROSPECT_MAX_SPACING_SECONDS} detik.`, "error");
      return;
    }
    if (selectedIds.length > PROSPECT_MAX_RECIPIENTS_PER_BATCH) {
      showNotice(`Maksimal ${PROSPECT_MAX_RECIPIENTS_PER_BATCH} penerima per batch.`, "error");
      return;
    }
    setOutreachBusy(true);
    setOutreachSkipped([]);
    try {
      const result = await api<OutreachResult>("/api/cms/prospects/outreach", {
        method: "POST",
        body: JSON.stringify({ prospectIds: selectedIds, templateId, spacingSeconds: spacing }),
      });
      setOutreachResult(result);
      setOutreachSkipped(result.skipped);
      setSelectedIds([]);
      setOutreachPreview(null);
      await loadProspects();
      showNotice(`${result.queued} email masuk antrean dengan jeda ${result.spacingSeconds} detik.`);
    } catch (error) {
      const skipped = skippedRecipients(error);
      setOutreachSkipped(skipped);
      showNotice(errorMessage(error, "Email gagal diantrekan."), "error");
    } finally {
      setOutreachBusy(false);
    }
  }

  function selectTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (template) setTemplateForm(templateFormFromTemplate(template));
    else setTemplateForm(templateFormFromDefaults(templateDefaults));
    setTemplateDirty(false);
    setTemplatePreview(null);
  }

  function applyStarterTemplate() {
    setTemplateForm(templateFormFromDefaults(templateDefaults));
    setTemplateDirty(true);
    setTemplatePreview(null);
  }

  function createNewTemplate() {
    setTemplateId("");
    applyStarterTemplate();
  }

  function changeOutreachTemplate(id: string) {
    setTemplateId(id);
    setOutreachPreview(null);
    setOutreachResult(null);
    setOutreachSkipped([]);
  }

  function selectReportBatch(id: string) {
    setReportBatchId(id);
    setReportPage(1);
    setReportQuery("");
    setReportSearchInput("");
    setReportStatus("");
    setReportFrom("");
    setReportTo("");
    setReportItems([]);
    setReportSummary({ ...emptyOutreachSummary });
    setReportTotal(0);
  }

  function refreshReports() {
    void loadReportBatches();
    if (reportBatchId) void loadReportDetails(reportBatchId);
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setTemplateBusy(true);
    try {
      const payload = {
        name: templateForm.name.trim(),
        subject: templateForm.subject.trim(),
        bodyHtml: templateForm.bodyHtml.trim(),
        bodyFormat: templateForm.bodyFormat,
        senderSignoff: templateForm.senderSignoff.trim(),
        senderName: templateForm.senderName.trim(),
        senderEmail: templateForm.senderEmail.trim(),
        senderPhone: templateForm.senderPhone.trim(),
        language: templateForm.language,
      };
      const saved = await api<ProspectTemplate>(`/api/cms/prospect-templates${templateId ? `/${templateId}` : ""}`, {
        method: templateId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setTemplates((current) => templateId ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateId(saved.id);
      setTemplateForm(templateFormFromTemplate(saved));
      setTemplateDirty(false);
      setTemplatePreview(null);
      showNotice(templateId ? "Template berhasil diperbarui." : "Template baru berhasil dibuat.");
    } catch (error) {
      showNotice(errorMessage(error, "Template gagal disimpan."), "error");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function deleteTemplate() {
    if (!canManage || !templateId || !window.confirm("Hapus template ini? Riwayat surat yang sudah ada tetap disimpan.")) return;
    setTemplateBusy(true);
    try {
      await api(`/api/cms/prospect-templates/${templateId}`, { method: "DELETE" });
      const next = templates.filter((item) => item.id !== templateId);
      setTemplates(next);
      if (next[0]) selectTemplate(next[0].id);
      else selectTemplate("");
      showNotice("Template dihapus.");
    } catch (error) {
      showNotice(errorMessage(error, "Template gagal dihapus."), "error");
    } finally {
      setTemplateBusy(false);
    }
  }

  function insertPlaceholder(field: "subject" | "bodyHtml", placeholder: string) {
    const token = `{{${placeholder}}}`;
    if (field === "bodyHtml") {
      bodyEditorRef.current?.insertPlaceholder(token);
      return;
    }
    const input = subjectRef.current;
    const current = templateForm[field];
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    setTemplateForm((value) => ({ ...value, [field]: next }));
    window.setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }

  function updateTemplateForm(value: TemplateForm) {
    setTemplateForm(value);
    setTemplateDirty(true);
    setTemplatePreview(null);
  }

  async function previewSelectedTemplate() {
    if (templateDirty) {
      showNotice("Simpan perubahan template sebelum membuat pratinjau.", "error");
      return;
    }
    await previewTemplate(selectedTemplate, effectiveTemplatePreviewProspectId, setTemplatePreview, setTemplatePreviewBusy);
  }

  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const selectedEligibleItems = selectedItems.filter((item) => item.emailable);
  const pageCount = Math.max(1, Math.ceil(total / 25));
  const selectedTemplate = templates.find((item) => item.id === templateId) ?? null;
  const effectivePreviewProspectId = previewProspectId && selectedIds.includes(previewProspectId)
    ? previewProspectId
    : selectedEligibleItems[0]?.id ?? "";
  const effectiveTemplatePreviewProspectId = templatePreviewProspectId && items.some((item) => item.id === templatePreviewProspectId)
    ? templatePreviewProspectId
    : items.find((item) => item.emailable)?.id ?? "";
  const selectedReportBatch = reportBatches.find((item) => item.batchId === reportBatchId) ?? null;
  const reportPageCount = Math.max(1, Math.ceil(reportTotal / OUTREACH_REPORT_PAGE_SIZE));

  return <div className={styles.root}>
    <div className={styles.sectionTitle}>
      <div><span>CALON KLIEN</span><h2>Bangun relasi sebelum jadi proyek.</h2><p>Catat asal kontak, hormati opt-out, dan antrekan penawaran dengan jeda yang aman untuk mail server.</p></div>
      <button type="button" className={styles.primary} disabled={!canManage} title={!canManage ? "Izin kelola diperlukan untuk menambah prospek." : undefined} onClick={() => setTab("add")}><Plus size={17} /> Tambah prospek</button>
    </div>

    {!canManage ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status"><span><ShieldCheck size={17} /></span><p>Akun ini memiliki izin lihat saja. Daftar, laporan, dan pratinjau tersedia; perubahan data, impor, template, dan pengiriman dinonaktifkan.</p></div> : null}

    <div className={styles.tabs} role="tablist" aria-label="Pengelolaan calon klien">
      {tabs.map(({ id, label, icon: Icon }) => {
        const writeOnlyTab = id === "add" || id === "import";
        return <button key={id} type="button" role="tab" aria-selected={tab === id} aria-disabled={!canManage && writeOnlyTab} disabled={!canManage && writeOnlyTab} className={tab === id ? styles.tabActive : styles.tab} onClick={() => setTab(id)}><Icon size={16} /> {label}</button>;
      })}
    </div>

    {notice ? <div className={`${styles.notice} ${noticeKind === "error" ? styles.noticeError : styles.noticeSuccess}`} role="status"><span>{noticeKind === "error" ? <AlertCircle size={17} /> : <Check size={17} />}</span><p>{notice}</p><button type="button" aria-label="Tutup pemberitahuan" onClick={() => setNotice("")}><X size={15} /></button></div> : null}

    {tab === "list" ? <>
      <section className={styles.filterCard}>
        <form className={styles.filterBar} onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(searchInput.trim()); }}>
          <div className={styles.searchBox}><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Cari nama, email, atau perusahaan..." aria-label="Cari prospek" /><button type="submit">Cari</button></div>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Filter status"><option value="">Semua status</option>{prospectStatuses.map((value) => <option key={value} value={value}>{prospectStatusLabels[value].id}</option>)}</select>
          <label className={styles.filterCheck}><input type="checkbox" checked={emailableOnly} onChange={(event) => { setEmailableOnly(event.target.checked); setPage(1); }} /> Bisa dikirimi</label>
          <label className={styles.filterCheck}><input type="checkbox" checked={optOutOnly} onChange={(event) => { setOptOutOnly(event.target.checked); setPage(1); }} /> Opt-out</label>
          <button type="button" className={styles.refreshButton} onClick={() => void loadProspects()} aria-label="Muat ulang daftar"><RefreshCw size={16} /></button>
        </form>
        <div className={styles.segmentTabs} role="tablist" aria-label="Filter segmen">
          <button type="button" className={!segment ? styles.segmentActive : styles.segmentTab} onClick={() => { setSegment(""); setPage(1); }}>Semua segmen</button>
          {prospectSegments.map((value) => <button type="button" key={value} className={segment === value ? styles.segmentActive : styles.segmentTab} onClick={() => { setSegment(value); setPage(1); }}>{prospectSegmentLabels[value].id}</button>)}
        </div>
      </section>

      {selectedIds.length ? <div className={styles.selectionBar}><span><strong>{selectedIds.length}</strong> prospek dipilih{selectedIds.length > PROSPECT_MAX_RECIPIENTS_PER_BATCH ? ` · batas ${PROSPECT_MAX_RECIPIENTS_PER_BATCH}` : ""}</span><div><button type="button" className={styles.secondary} onClick={() => setSelectedIds([])}>Batal pilih</button><button type="button" className={styles.primary} disabled={selectedIds.length > PROSPECT_MAX_RECIPIENTS_PER_BATCH} onClick={() => setTab("outreach")}><Mail size={15} /> Susun email</button></div></div> : null}

      <section className={styles.listLayout}>
        <div className={styles.tableCard}>
          <div className={styles.cardHeading}><div><span>{total} PROSPEK</span><h3>Kontak yang tersimpan</h3></div><small>Terbaru di atas</small></div>
          {loading ? <div className={styles.empty}><LoaderCircle className={styles.spin} size={23} /><strong>Memuat daftar prospek...</strong></div> : items.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleVisibleSelection(event.target.checked)} disabled={!visibleEligibleIds.length} aria-label="Pilih semua prospek yang bisa dikirimi" /></th><th>Kontak</th><th>Segmen</th><th>Sumber</th><th>Status</th><th>Email</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={selected?.id === item.id ? styles.rowSelected : ""} tabIndex={0} onClick={() => void openProspect(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openProspect(item.id); }}>
            <td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={!item.emailable} onChange={(event) => toggleSelected(item.id, event.target.checked)} aria-label={`Pilih ${item.fullName}`} /></td>
            <td><div className={styles.contactCell}><strong>{item.fullName}</strong><small>{item.companyName || item.email || "Tanpa perusahaan"}</small>{item.jobTitle ? <small>{item.jobTitle}</small> : null}{item.projectId ? <button type="button" className={styles.projectBadge} onClick={(event) => { event.stopPropagation(); onProjectOpen?.(item.projectId as string); }}><FolderKanban size={12} /> Proyek {item.projectCode || "PN-…"}</button> : null}</div></td>
            <td><span className={styles.segmentPill}>{segmentLabel(item.segment)}</span></td>
            <td><span className={styles.sourceCell}>{item.source}</span></td>
            <td><span className={`${styles.status} ${statusClass(item.status)}`}>{prospectStatusLabels[item.status]?.id ?? item.status}</span></td>
            <td><span className={`${styles.delivery} ${item.emailable ? styles.deliveryReady : styles.deliveryBlocked}`}>{item.emailable ? "Bisa dikirimi" : item.optOutAt ? "Opt-out" : "Tanpa email"}</span></td>
          </tr>)}</tbody></table></div> : <div className={styles.empty}><ArchiveX size={29} /><strong>Tidak ada prospek pada filter ini.</strong><span>Ubah filter atau tambahkan kontak baru.</span></div>}
          <div className={styles.pagination}><span>Halaman {page} dari {pageCount}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} /> Sebelumnya</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Berikutnya <ChevronRight size={15} /></button></div></div>
        </div>
        <ProspectDetailPanel canManage={canManage} canManageProjects={canManageProjects} selected={selected} editForm={editForm} setEditForm={setEditForm} staff={staff} loading={detailLoading} saving={saving} optOutReason={optOutReason} setOptOutReason={setOptOutReason} onSave={saveProspect} onOptOut={() => void markOptOut()} onDelete={() => void deleteProspect()} onConvert={openConversion} onProjectOpen={onProjectOpen} onClose={() => { setSelected(null); setEditForm(null); }} />
      </section>
    </> : null}

    {tab === "add" ? <ManualProspectForm canManage={canManage} form={manualForm} setForm={setManualForm} staff={staff} busy={manualBusy} duplicateId={manualDuplicateId} onDuplicate={() => { if (manualDuplicateId) void openProspect(manualDuplicateId); setTab("list"); }} onSubmit={createProspect} onCancel={() => setTab("list")} /> : null}
    {tab === "import" ? <ImportPanel canManage={canManage} file={importFile} source={importSource} setFile={setImportFile} setSource={setImportSource} result={importResult} busy={importBusy} onRun={importWorkbook} /> : null}
    {tab === "outreach" ? <OutreachPanel canManage={canManage} templates={templates} templatesLoading={templatesLoading} selectedIds={selectedIds} selectedItems={selectedItems} selectedEligibleItems={selectedEligibleItems} templateId={templateId} setTemplateId={changeOutreachTemplate} spacingSeconds={spacingSeconds} setSpacingSeconds={setSpacingSeconds} previewProspectId={effectivePreviewProspectId} setPreviewProspectId={setPreviewProspectId} preview={outreachPreview} previewBusy={outreachPreviewBusy} onPreview={() => void previewOutreach()} onSend={() => void sendOutreach()} busy={outreachBusy} result={outreachResult} skipped={outreachSkipped} /> : null}
    {tab === "reports" ? <OutreachReportPanel batches={reportBatches} batchesLoading={reportBatchesLoading} selectedBatch={selectedReportBatch} selectedBatchId={reportBatchId} onSelectBatch={selectReportBatch} onRefresh={refreshReports} items={reportItems} summary={reportSummary} total={reportTotal} page={reportPage} pageCount={reportPageCount} detailsLoading={reportDetailsLoading} searchInput={reportSearchInput} setSearchInput={setReportSearchInput} status={reportStatus} setStatus={(value) => { setReportStatus(value); setReportPage(1); }} from={reportFrom} setFrom={(value) => { setReportFrom(value); setReportPage(1); }} to={reportTo} setTo={(value) => { setReportTo(value); setReportPage(1); }} onSearch={() => { setReportPage(1); setReportQuery(reportSearchInput.trim()); }} onPageChange={setReportPage} /> : null}
    {tab === "templates" ? <TemplateManager canManage={canManage} templates={templates} loading={templatesLoading} selectedId={templateId} form={templateForm} setForm={updateTemplateForm} subjectRef={subjectRef} bodyEditorRef={bodyEditorRef} previewProspectId={effectiveTemplatePreviewProspectId} setPreviewProspectId={setTemplatePreviewProspectId} previewProspects={items} preview={templatePreview} previewBusy={templatePreviewBusy} onSelect={selectTemplate} onNew={createNewTemplate} onUseStarter={applyStarterTemplate} onInsert={insertPlaceholder} onPreview={() => void previewSelectedTemplate()} onSubmit={saveTemplate} onDelete={() => void deleteTemplate()} busy={templateBusy} dirty={templateDirty} /> : null}

    {conversionOpen && selected ? <div className="modal-backdrop" onMouseDown={() => setConversionOpen(false)}><section className="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="prospect-conversion-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">JADIKAN PROYEK</span><h2 id="prospect-conversion-title">{selected.companyName || selected.fullName}</h2></div><button className="icon-button" type="button" onClick={() => setConversionOpen(false)} aria-label="Tutup"><X size={18} /></button></div>
      <form className="form-grid" onSubmit={convertProspect}>
        <Field label="Nama proyek"><input value={conversionForm.name} onChange={(event) => setConversionForm({ ...conversionForm, name: event.target.value })} /></Field>
        <Field label="Status proyek" required><select value={conversionForm.status} onChange={(event) => setConversionForm({ ...conversionForm, status: event.target.value as ConversionForm["status"] })}><option value="Draft">Draft</option><option value="Aktif">Aktif</option></select></Field>
        <Field label="Project Manager"><select value={conversionForm.managerId} onChange={(event) => setConversionForm({ ...conversionForm, managerId: event.target.value })}><option value="">Saya sendiri</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></Field>
        <Field label="Tanggal mulai"><input type="date" value={conversionForm.startDate} onChange={(event) => setConversionForm({ ...conversionForm, startDate: event.target.value })} /></Field>
        <Field label="Tanggal target"><input type="date" value={conversionForm.targetDate} onChange={(event) => setConversionForm({ ...conversionForm, targetDate: event.target.value })} /></Field>
        {selected.location ? <div className={styles.conversionSource}><span>Lokasi dibawa dari prospek</span><strong>{selected.location}</strong></div> : <Field label="Lokasi proyek" required hint="Prospek ini belum memiliki lokasi."><input required minLength={2} value={conversionForm.location} onChange={(event) => setConversionForm({ ...conversionForm, location: event.target.value })} /></Field>}
        {conversionError ? <div className="security-note attention full" role="alert"><span>{conversionError}</span></div> : null}
        <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setConversionOpen(false)}>Batal</button><button className="button primary" type="submit" disabled={conversionBusy}>{conversionBusy ? "Membuat proyek..." : "Jadikan proyek"}</button></div>
      </form>
    </section></div> : null}
  </div>;
}

function ProspectDetailPanel({
  canManage,
  canManageProjects,
  selected,
  editForm,
  setEditForm,
  staff,
  loading,
  saving,
  optOutReason,
  setOptOutReason,
  onSave,
  onOptOut,
  onDelete,
  onConvert,
  onProjectOpen,
  onClose,
}: {
  canManage: boolean;
  canManageProjects: boolean;
  selected: ProspectDetail | null;
  editForm: EditForm | null;
  setEditForm: (value: EditForm) => void;
  staff: Staff[];
  loading: boolean;
  saving: boolean;
  optOutReason: string;
  setOptOutReason: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onOptOut: () => void;
  onDelete: () => void;
  onConvert: () => void;
  onProjectOpen?: (projectId: string) => void;
  onClose: () => void;
}) {
  if (loading) return <aside className={styles.detail}><div className={styles.empty}><LoaderCircle className={styles.spin} size={22} /><span>Memuat detail...</span></div></aside>;
  if (!selected || !editForm) return <aside className={styles.detail}><div className={styles.detailPlaceholder}><UserRoundPlus size={30} /><strong>Pilih satu prospek</strong><span>Detail kontak, status, sumber, dan riwayat outreach akan muncul di sini.</span></div></aside>;
  const update = (key: keyof EditForm, value: string) => setEditForm({ ...editForm, [key]: value });
  const statusOptions = Array.from(new Set([selected.status, ...allowedProspectTransitions(selected.status)]));
  return <aside className={styles.detail}>
    <div className={styles.detailTop}><div><span>DETAIL PROSPEK</span><h3>{selected.fullName}</h3><p>{selected.companyName || "Tanpa perusahaan"}</p></div><button type="button" className={styles.iconButton} onClick={onClose} aria-label="Tutup detail"><X size={17} /></button></div>
    <div className={styles.detailBadges}><span className={`${styles.status} ${statusClass(selected.status)}`}>{prospectStatusLabels[selected.status]?.id ?? selected.status}</span><span className={`${styles.delivery} ${selected.emailable ? styles.deliveryReady : styles.deliveryBlocked}`}>{selected.emailable ? "Bisa dikirimi" : selected.optOutAt ? "Opt-out" : "Tanpa email"}</span></div>
    {selected.projectId ? <div className={styles.detailBadges}><button type="button" className={styles.projectBadge} onClick={() => onProjectOpen?.(selected.projectId as string)}><FolderKanban size={12} /> Buka proyek {selected.projectCode || "PN-…"}</button></div> : null}
    {!selected.projectId && canManageProjects && selected.status !== "Lost" && !selected.optOutAt ? <div className={styles.conversionAction}><button type="button" className={styles.primary} disabled={saving} onClick={onConvert}><FolderKanban size={15} /> Jadikan proyek</button></div> : null}
    <form className={styles.detailForm} onSubmit={onSave}>
      <fieldset disabled={!canManage} className={styles.formFieldset}><div className={styles.formGrid}>
        <Field label="Nama lengkap" required><input value={editForm.fullName} onChange={(event) => update("fullName", event.target.value)} required /></Field>
        <Field label="Email" required><input type="email" value={editForm.email} onChange={(event) => update("email", event.target.value)} required /></Field>
        <Field label="Perusahaan"><input value={editForm.companyName} onChange={(event) => update("companyName", event.target.value)} /></Field>
        <Field label="Jabatan"><input value={editForm.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} /></Field>
        <Field label="No. telepon / WhatsApp"><input value={editForm.whatsapp} onChange={(event) => update("whatsapp", event.target.value)} /></Field>
        <Field label="Kota / lokasi"><input value={editForm.location} onChange={(event) => update("location", event.target.value)} /></Field>
        <Field label="Segmen"><select value={editForm.segment} onChange={(event) => update("segment", event.target.value)}><option value="">Belum dipetakan</option>{prospectSegments.map((value) => <option key={value} value={value}>{prospectSegmentLabels[value].id}</option>)}</select></Field>
        <Field label="Status"><select value={editForm.status} onChange={(event) => update("status", event.target.value)}>{statusOptions.map((value) => <option key={value} value={value}>{prospectStatusLabels[value].id}</option>)}</select></Field>
        <Field label="Penanggung jawab"><select value={editForm.assignedTo} onChange={(event) => update("assignedTo", event.target.value)}><option value="">Belum ditetapkan</option>{staff.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></Field>
        <Field label="Bidang / industri"><input value={editForm.industry} onChange={(event) => update("industry", event.target.value)} /></Field>
        <Field label="Minat layanan"><input value={editForm.serviceInterest} onChange={(event) => update("serviceInterest", event.target.value)} /></Field>
        <Field label="Dari mana kontak ini didapat?" required hint="Sumber wajib untuk pertanggungjawaban kontak."><input value={editForm.source} onChange={(event) => update("source", event.target.value)} required /></Field>
        <Field label="Catatan" hint="Catatan internal, tidak dikirim ke kontak."><textarea rows={3} value={editForm.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
      </div></fieldset>
      <div className={styles.detailActions}><button type="submit" className={styles.primary} disabled={saving || !canManage} title={!canManage ? "Izin kelola diperlukan untuk menyimpan perubahan." : undefined}><Save size={15} /> {saving ? "Menyimpan..." : "Simpan perubahan"}</button></div>
    </form>
    <div className={styles.optOutBox}>{selected.optOutAt ? <><strong>Opt-out aktif</strong><span>{selected.optOutReason || "Kontak meminta berhenti dihubungi."}</span><small>{formatDate(selected.optOutAt, true)}</small></> : <><strong>Jangan hubungi lagi?</strong><span>Server akan menolak outreach setelah status ini dicatat.</span><input value={optOutReason} onChange={(event) => setOptOutReason(event.target.value)} placeholder="Alasan (opsional)" disabled={!canManage} /><button type="button" className={styles.danger} disabled={saving || !canManage} title={!canManage ? "Izin kelola diperlukan untuk mengubah opt-out." : undefined} onClick={onOptOut}><ArchiveX size={15} /> Tandai tidak boleh dihubungi</button></>}</div>
    <div className={styles.history}><div className={styles.historyHeading}><span>RIWAYAT OUTREACH</span><small>{selected.outreach.length} catatan</small></div>{selected.outreach.length ? selected.outreach.map((entry) => <div className={styles.historyItem} key={entry.id}><span className={styles.historyDot} /><div><strong>{entry.templateName}</strong><p>{entry.subject}</p><small>{entry.recipient} · {entry.status} · {formatDate(entry.scheduledFor, true)}</small>{entry.failureReason ? <em>{entry.failureReason}</em> : null}</div></div>) : <p className={styles.muted}>Belum ada surat yang diantrekan.</p>}</div>
    <button type="button" className={styles.deleteLink} onClick={onDelete} disabled={saving || !canManage} title={!canManage ? "Izin kelola diperlukan untuk menghapus prospek." : undefined}><Trash2 size={15} /> Hapus prospek</button>
  </aside>;
}

function ManualProspectForm({
  canManage,
  form,
  setForm,
  staff,
  busy,
  duplicateId,
  onDuplicate,
  onSubmit,
  onCancel,
}: {
  canManage: boolean;
  form: ManualForm;
  setForm: (value: ManualForm) => void;
  staff: Staff[];
  busy: boolean;
  duplicateId: string | null;
  onDuplicate: () => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const update = (key: keyof ManualForm, value: string) => setForm({ ...form, [key]: value });
  return <section className={styles.formPanel}>
    <div className={styles.panelHeader}><div><span>PROSPEK BARU</span><h3>Tambahkan kontak secara manual</h3><p>Email wajib untuk jalur manual. Kontak tanpa email tetap bisa dicatat melalui impor XLSX.</p></div><button type="button" className={styles.secondary} onClick={onCancel}><X size={15} /> Batal</button></div>
    {duplicateId ? <div className={styles.duplicateBox}><AlertCircle size={17} /><div><strong>Email sudah terdaftar.</strong><span>Gunakan prospek yang sudah ada agar riwayat dan opt-out tetap menyatu.</span></div><button type="button" className={styles.secondary} onClick={onDuplicate}>Buka prospek yang sudah ada</button></div> : null}
    <form className={styles.formBody} onSubmit={onSubmit}>
      <fieldset disabled={!canManage} className={styles.formFieldset}><div className={styles.formGrid}>
        <Field label="Nama lengkap" required><input value={form.fullName} onChange={(event) => update("fullName", event.target.value)} required minLength={2} /></Field>
        <Field label="Email" required><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required /></Field>
        <Field label="Perusahaan"><input value={form.companyName} onChange={(event) => update("companyName", event.target.value)} /></Field>
        <Field label="Jabatan"><input value={form.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} /></Field>
        <Field label="No. telepon / WhatsApp"><input value={form.whatsapp} onChange={(event) => update("whatsapp", event.target.value)} /></Field>
        <Field label="Kota / lokasi"><input value={form.location} onChange={(event) => update("location", event.target.value)} /></Field>
        <Field label="Segmen"><select value={form.segment} onChange={(event) => update("segment", event.target.value)}><option value="">Belum dipetakan</option>{prospectSegments.map((value) => <option key={value} value={value}>{prospectSegmentLabels[value].id}</option>)}</select></Field>
        <Field label="Status awal"><select value={form.status} onChange={(event) => update("status", event.target.value)}>{prospectStatuses.map((value) => <option key={value} value={value}>{prospectStatusLabels[value].id}</option>)}</select></Field>
        <Field label="Penanggung jawab"><select value={form.assignedTo} onChange={(event) => update("assignedTo", event.target.value)}><option value="">Belum ditetapkan</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></Field>
        <Field label="Bidang / industri"><input value={form.industry} onChange={(event) => update("industry", event.target.value)} /></Field>
        <Field label="Minat layanan"><input value={form.serviceInterest} onChange={(event) => update("serviceInterest", event.target.value)} /></Field>
        <Field label="Dari mana kontak ini didapat?" required hint="Contoh: kartu nama pameran properti, telepon masuk, rujukan klien."><input value={form.source} onChange={(event) => update("source", event.target.value)} required minLength={2} /></Field>
        <Field label="Catatan internal"><textarea rows={5} value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
      </div></fieldset>
      <div className={styles.formFooter}><span><b>*</b> wajib diisi</span><button type="submit" className={styles.primary} disabled={busy || !canManage} title={!canManage ? "Izin kelola diperlukan untuk menambah prospek." : undefined}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <UserRoundPlus size={16} />} {busy ? "Menyimpan..." : "Simpan prospek"}</button></div>
    </form>
  </section>;
}

function ImportPanel({
  canManage,
  file,
  source,
  setFile,
  setSource,
  result,
  busy,
  onRun,
}: {
  canManage: boolean;
  file: File | null;
  source: string;
  setFile: (value: File | null) => void;
  setSource: (value: string) => void;
  result: ImportResult | null;
  busy: boolean;
  onRun: (dryRun: boolean) => void;
}) {
  return <section className={styles.importLayout}>
    <div className={styles.formPanel}>
      <div className={styles.panelHeader}><div><span>IMPOR KONTAK</span><h3>Uji workbook sebelum menyimpan</h3><p>Kolom dibaca dari judulnya, seluruh lembar diproses, dan isu per baris tetap ditampilkan.</p></div></div>
      <div className={styles.formBody}>
        <div className={styles.formField}><span>Berkas workbook <b aria-hidden="true">*</b></span><small>XLSX maksimal 5 MB. Dry-run adalah langkah pertama.</small><label className={styles.filePicker}><input aria-label="Pilih berkas workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!canManage} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><FileSpreadsheet size={22} /><span><strong>{file?.name ?? "Pilih berkas .xlsx"}</strong><small>{file ? `${Math.ceil(file.size / 1024)} KB` : "Workbook multi-sheet kontak prospek"}</small></span><b>Pilih</b></label></div>
        <Field label="Dari mana kontak ini didapat?" required hint="Catatan ini ditempel ke semua baris hasil impor."><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Contoh: berkas Data Clients Enterprise.xlsx" minLength={2} disabled={!canManage} /></Field>
        <div className={styles.importSteps}><div><span>1</span><div><strong>Dry-run</strong><small>Baca jumlah baris, sheet, dan isu tanpa menyimpan.</small></div></div><div><span>2</span><div><strong>Simpan hasil impor</strong><small>Aktif setelah hasil dry-run sudah diperiksa.</small></div></div></div>
        <div className={styles.formFooter}><span>{file ? "Berkas siap dianalisis." : "Pilih berkas untuk mulai."}</span><button type="button" className={styles.primary} disabled={busy || !canManage || !file} title={!canManage ? "Izin kelola diperlukan untuk mengimpor prospek." : undefined} onClick={() => onRun(true)}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Search size={16} />} Analisis dry-run</button></div>
      </div>
    </div>
    <ImportResultCard canManage={canManage} result={result} busy={busy} onSave={() => onRun(false)} />
  </section>;
}

function ImportResultCard({ canManage, result, busy, onSave }: { canManage: boolean; result: ImportResult | null; busy: boolean; onSave: () => void }) {
  if (!result) return <aside className={styles.resultPlaceholder}><FileSpreadsheet size={30} /><strong>Hasil impor akan muncul di sini</strong><span>Jangan melewati dry-run: periksa sheet dan isu per baris sebelum menyimpan.</span></aside>;
  return <aside className={styles.importResult}><div className={styles.panelHeader}><div><span>{result.dryRun ? "HASIL DRY-RUN" : "IMPOR SELESAI"}</span><h3>{result.dryRun ? "Periksa sebelum menyimpan" : "Ringkasan penyimpanan"}</h3></div>{result.dryRun ? <button type="button" className={styles.primary} disabled={busy || !canManage} title={!canManage ? "Izin kelola diperlukan untuk menyimpan hasil impor." : undefined} onClick={onSave}><Save size={15} /> Simpan hasil impor</button> : <Check className={styles.resultCheck} size={21} />}</div><div className={styles.statGrid}><div><strong>{result.sheets.length}</strong><span>sheet terbaca</span></div><div><strong>{result.terbaca}</strong><span>kontak terbaca</span></div><div><strong>{result.disimpan}</strong><span>{result.dryRun ? "akan disimpan" : "disimpan"}</span></div><div><strong>{result.dilewati}</strong><span>dilewati</span></div></div><div className={styles.sheetList}><span>Sheet</span><div>{result.sheets.length ? result.sheets.map((sheet) => <b key={sheet}>{sheet}</b>) : <small>Tidak ada sheet berisi data.</small>}</div></div><div className={styles.issueSection}><div><span>ISU PER BARIS</span><strong>{result.issues.length ? `${result.issues.length} isu perlu diperiksa` : "Tidak ada isu"}</strong></div>{result.issues.length ? <div className={styles.issueList}>{result.issues.map((issue, index) => <div key={`${issue.sheet}-${issue.row}-${issue.code}-${index}`}><span>{issue.sheet} · baris {issue.row}</span><strong>{issue.code}</strong><p>{issue.detail}</p></div>)}</div> : <p className={styles.muted}>Semua baris yang terbaca siap diproses.</p>}</div></aside>;
}

function OutreachPanel({
  canManage,
  templates,
  templatesLoading,
  selectedIds,
  selectedItems,
  selectedEligibleItems,
  templateId,
  setTemplateId,
  spacingSeconds,
  setSpacingSeconds,
  previewProspectId,
  setPreviewProspectId,
  preview,
  previewBusy,
  onPreview,
  onSend,
  busy,
  result,
  skipped,
}: {
  canManage: boolean;
  templates: ProspectTemplate[];
  templatesLoading: boolean;
  selectedIds: string[];
  selectedItems: Prospect[];
  selectedEligibleItems: Prospect[];
  templateId: string;
  setTemplateId: (value: string) => void;
  spacingSeconds: string;
  setSpacingSeconds: (value: string) => void;
  previewProspectId: string;
  setPreviewProspectId: (value: string) => void;
  preview: Preview | null;
  previewBusy: boolean;
  onPreview: () => void;
  onSend: () => void;
  busy: boolean;
  result: OutreachResult | null;
  skipped: SkippedRecipient[];
}) {
  const estimate = Math.max(0, (selectedIds.length - 1) * Math.max(0, Number(spacingSeconds) || 0));
  return <section className={styles.outreachLayout}>
    <div className={styles.outreachCard}>
      <div className={styles.panelHeader}><div><span>KOMPOSER EMAIL</span><h3>Antrekan penawaran dengan sadar</h3><p>Satu prospek = satu batch. Pratinjau server wajib sebelum tombol kirim aktif.</p></div></div>
      <div className={styles.formBody}>
        <div className={styles.selectedSummary}><div><strong>{selectedIds.length} penerima dipilih</strong><span>{selectedEligibleItems.length} kontak terlihat bisa dikirimi pada halaman ini.</span></div>{selectedIds.length > PROSPECT_MAX_RECIPIENTS_PER_BATCH ? <b className={styles.warning}>Melebihi batas {PROSPECT_MAX_RECIPIENTS_PER_BATCH}</b> : null}</div>
        {selectedItems.length ? <div className={styles.recipientList}>{selectedItems.map((item) => <span key={item.id} className={item.emailable ? styles.recipientReady : styles.recipientBlocked}>{item.fullName}{item.email ? ` · ${item.email}` : " · tanpa email"}</span>)}</div> : <div className={styles.emptySmall}><Mail size={18} /><span>Kembali ke Daftar prospek untuk memilih penerima.</span></div>}
        <Field label="Template surat" required hint="Template dirender dan di-escape oleh server."><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={templatesLoading}><option value="">{templatesLoading ? "Memuat template..." : "Pilih template"}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.language.toUpperCase()}</option>)}</select></Field>
        <Field label="Jeda antar pesan (detik)" required hint={`Bawaan ${PROSPECT_DEFAULT_SPACING_SECONDS} detik · maksimal ${PROSPECT_MAX_SPACING_SECONDS} detik.`}><input type="number" min={0} max={PROSPECT_MAX_SPACING_SECONDS} step={1} value={spacingSeconds} onChange={(event) => setSpacingSeconds(event.target.value)} /></Field>
        <div className={styles.estimate}><span>Perkiraan batch selesai</span><strong>{selectedIds.length ? formatDuration(estimate) : "—"}</strong><small>Dihitung sampai pesan terakhir berdasarkan jumlah penerima yang dipilih.</small></div>
        <div className={styles.formFooter}><span>{preview ? "Pratinjau sudah dibuat." : "Buat pratinjau untuk melanjutkan."}</span><button type="button" className={styles.primary} disabled={previewBusy || !templateId || !previewProspectId || !selectedIds.length} onClick={onPreview}>{previewBusy ? <LoaderCircle className={styles.spin} size={16} /> : <Eye size={16} />} Buat pratinjau</button></div>
        <button type="button" className={styles.sendButton} disabled={busy || !canManage || !preview || !selectedIds.length || selectedIds.length > PROSPECT_MAX_RECIPIENTS_PER_BATCH} title={!canManage ? "Izin kelola diperlukan untuk mengantrekan email." : undefined} onClick={onSend}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Send size={16} />} {busy ? "Mengantrekan..." : `Antrekan ${selectedIds.length || ""} email`}</button>
      </div>
    </div>
    <aside className={styles.previewCard}><div className={styles.panelHeader}><div><span>PRATINJAU WAJIB</span><h3>Contoh penerima</h3></div></div><div className={styles.formBody}><Field label="Tampilkan preview sebagai"><select value={previewProspectId} onChange={(event) => setPreviewProspectId(event.target.value)}><option value="">Pilih penerima</option>{selectedEligibleItems.map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.email}</option>)}</select></Field>{preview ? <PreviewFrame preview={preview} title="Pratinjau email prospek" /> : <div className={styles.previewPlaceholder}><Eye size={28} /><strong>Belum ada pratinjau</strong><span>Pilih penerima lalu klik Buat pratinjau.</span></div>}{result ? <div className={styles.sendResult}><strong>{result.queued} email masuk antrean.</strong><span>Jeda: {result.spacingSeconds} detik.</span></div> : null}{skipped.length ? <div className={styles.skippedBox}><strong>Kontak dilewati</strong>{skipped.map((item, index) => <div key={`${item.prospectId}-${index}`}><span>{selectedItems.find((prospect) => prospect.id === item.prospectId)?.fullName ?? item.prospectId}</span><small>{reasonLabel(item.reason)}</small></div>)}</div> : null}</div></aside>
  </section>;
}

function OutreachReportPanel({
  batches,
  batchesLoading,
  selectedBatch,
  selectedBatchId,
  onSelectBatch,
  onRefresh,
  items,
  summary,
  total,
  page,
  pageCount,
  detailsLoading,
  searchInput,
  setSearchInput,
  status,
  setStatus,
  from,
  setFrom,
  to,
  setTo,
  onSearch,
  onPageChange,
}: {
  batches: OutreachBatch[];
  batchesLoading: boolean;
  selectedBatch: OutreachBatch | null;
  selectedBatchId: string;
  onSelectBatch: (id: string) => void;
  onRefresh: () => void;
  items: OutreachLog[];
  summary: OutreachSummary;
  total: number;
  page: number;
  pageCount: number;
  detailsLoading: boolean;
  searchInput: string;
  setSearchInput: (value: string) => void;
  status: ProspectOutreachStatus | "";
  setStatus: (value: ProspectOutreachStatus | "") => void;
  from: string;
  setFrom: (value: string) => void;
  to: string;
  setTo: (value: string) => void;
  onSearch: () => void;
  onPageChange: (value: number) => void;
}) {
  const summaryCards = prospectOutreachStatuses.map((key) => ({
    key,
    label: prospectOutreachStatusLabels[key].id,
    value: summary[key],
  }));

  return <section className={styles.reportLayout}>
    <aside className={styles.reportBatches}>
      <div className={styles.panelHeader}>
        <div>
          <span>HISTORY OUTREACH</span>
          <h3>Laporan pengiriman</h3>
          <p>Satu baris batch untuk setiap penekanan tombol kirim.</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={onRefresh} aria-label="Muat ulang laporan kirim"><RefreshCw size={16} /></button>
      </div>
      {batchesLoading ? <div className={styles.empty}><LoaderCircle className={styles.spin} size={22} /><span>Memuat batch pengiriman...</span></div> : batches.length ? <div className={styles.reportBatchList}>
        {batches.map((batch) => <button type="button" key={batch.batchId} className={selectedBatchId === batch.batchId ? styles.reportBatchActive : styles.reportBatch} onClick={() => onSelectBatch(batch.batchId)} aria-pressed={selectedBatchId === batch.batchId}>
          <div className={styles.reportBatchTop}><strong>{batch.templateName || "Surat langsung"}</strong><span className={`${styles.reportBatchStatus} ${outreachStatusClass(batch.selesai ? "Sent" : "Queued")}`}>{batch.selesai ? "Selesai" : "Masih diproses"}</span></div>
          <small>Dibuat {formatDate(batch.createdAt, true)} · {batch.total} penerima</small>
          <div className={styles.reportBatchCounts}><span>{batch.sent} terkirim</span><span>{batch.queued} diproses</span><span>{batch.failed} gagal</span><span>{batch.skipped} dilewati</span></div>
          <small>Jadwal terakhir {formatDate(batch.lastScheduledFor, true)}</small>
        </button>)}
      </div> : <div className={styles.empty}><BarChart3 size={28} /><strong>Belum ada laporan kirim.</strong><span>Batch baru akan muncul setelah email diantrekan.</span></div>}
    </aside>

    <section className={styles.reportDetail}>
      {!selectedBatch ? <div className={styles.detailPlaceholder}><BarChart3 size={30} /><strong>Pilih satu batch</strong><span>Ringkasan dan status setiap penerima akan muncul di sini.</span></div> : <>
        <div className={styles.panelHeader}>
          <div>
            <span>BATCH TERPILIH</span>
            <h3>{selectedBatch.templateName || "Surat langsung"}</h3>
            <p>Dibuat {formatDate(selectedBatch.createdAt, true)} · jadwal terakhir {formatDate(selectedBatch.lastScheduledFor, true)}</p>
          </div>
          <span className={`${styles.reportBatchStatus} ${outreachStatusClass(selectedBatch.selesai ? "Sent" : "Queued")}`}>{selectedBatch.selesai ? "Selesai" : "Masih diproses"}</span>
        </div>
        <div className={styles.reportMeta}>
          <div><span>JADWAL PERTAMA</span><strong>{formatDate(selectedBatch.firstScheduledFor, true)}</strong></div>
          <div><span>JADWAL TERAKHIR</span><strong>{formatDate(selectedBatch.lastScheduledFor, true)}</strong></div>
          <div><span>TERAKHIR TERKIRIM</span><strong>{formatDate(selectedBatch.lastSentAt, true)}</strong></div>
          <div><span>TOTAL PENERIMA</span><strong>{selectedBatch.total}</strong></div>
        </div>
        <div className={styles.reportStatGrid}>{summaryCards.map((card) => <div key={card.key} className={`${styles.reportStat} ${outreachStatClass(card.key)}`}><strong>{card.value}</strong><span>{card.label}</span></div>)}</div>
        <form className={styles.reportFilters} onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <div className={styles.reportSearch}><Search size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Cari penerima, nama, perusahaan..." aria-label="Cari laporan kirim" /><button type="submit">Cari</button></div>
          <select value={status} onChange={(event) => setStatus(event.target.value as ProspectOutreachStatus | "")} aria-label="Filter status pengiriman"><option value="">Semua status</option>{prospectOutreachStatuses.map((value) => <option key={value} value={value}>{prospectOutreachStatusLabels[value].id}</option>)}</select>
          <label><span>Dari</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Tanggal mulai laporan" /></label>
          <label><span>Sampai</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Tanggal akhir laporan" /></label>
          <button type="button" className={styles.secondary} onClick={onRefresh}><RefreshCw size={15} /> Segarkan</button>
        </form>
        {detailsLoading ? <div className={styles.empty}><LoaderCircle className={styles.spin} size={22} /><span>Memuat status penerima...</span></div> : items.length ? <>
          <div className={styles.tableScroll}><table className={`${styles.table} ${styles.reportTable}`}><thead><tr><th>Kontak</th><th>Status</th><th>Dijadwalkan</th><th>Terkirim</th><th>Percobaan</th><th>Alasan</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
            <td><div className={styles.contactCell}><strong>{item.prospectName}</strong><small>{item.companyName || "Tanpa perusahaan"}</small><small>{item.recipient || "Tanpa email"}</small><small>{item.subject}</small>{!item.hasBody ? <small className={styles.reportMuted}>Isi surat sudah dipangkas</small> : null}</div></td>
            <td><span className={`${styles.status} ${outreachStatusClass(item.status)}`}>{prospectOutreachStatusLabels[item.status]?.id ?? item.status}</span></td>
            <td><span className={styles.reportDateCell}>{formatDate(item.scheduledFor, true)}</span></td>
            <td><span className={styles.reportDateCell}>{formatDate(item.sentAt, true)}</span></td>
            <td><div className={styles.reportAttempt}><strong>{item.attempts === null ? "—" : item.attempts}</strong><small>{item.nextAttemptAt ? `Berikutnya ${formatDate(item.nextAttemptAt, true)}` : "Jadwal ulang —"}</small></div></td>
            <td>{item.failureReason ? <span className={styles.reportFailure}>{item.failureReason}</span> : <span className={styles.reportMuted}>—</span>}</td>
          </tr>)}</tbody></table></div>
          <div className={styles.pagination}><span>{total} catatan · halaman {page} dari {pageCount}</span><div><button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} /> Sebelumnya</button><button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Berikutnya <ChevronRight size={15} /></button></div></div>
        </> : <div className={styles.empty}><Search size={28} /><strong>Tidak ada penerima pada filter ini.</strong><span>Ubah pencarian, status, atau rentang tanggal.</span></div>}
      </>}
    </section>
  </section>;
}

function TemplateManager({
  canManage,
  templates,
  loading,
  selectedId,
  form,
  setForm,
  subjectRef,
  bodyEditorRef,
  previewProspectId,
  setPreviewProspectId,
  previewProspects,
  preview,
  previewBusy,
  onSelect,
  onNew,
  onUseStarter,
  onInsert,
  onPreview,
  onSubmit,
  onDelete,
  busy,
  dirty,
}: {
  canManage: boolean;
  templates: ProspectTemplate[];
  loading: boolean;
  selectedId: string;
  form: TemplateForm;
  setForm: (value: TemplateForm) => void;
  subjectRef: React.RefObject<HTMLInputElement | null>;
  bodyEditorRef: React.RefObject<RichTextEditorHandle | null>;
  previewProspectId: string;
  setPreviewProspectId: (value: string) => void;
  previewProspects: Prospect[];
  preview: Preview | null;
  previewBusy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onUseStarter: () => void;
  onInsert: (field: "subject" | "bodyHtml", placeholder: string) => void;
  onPreview: () => void;
  onSubmit: (event: FormEvent) => void;
  onDelete: () => void;
  busy: boolean;
  dirty: boolean;
}) {
  return <section className={styles.templateLayout}>
    <div className={styles.templateList}><div className={styles.panelHeader}><div><span>LIBRARY</span><h3>Template surat</h3></div><button type="button" className={styles.secondary} onClick={onNew} disabled={!canManage} title={!canManage ? "Izin kelola diperlukan untuk membuat template." : undefined}><Plus size={15} /> Baru</button></div>{loading ? <div className={styles.empty}><LoaderCircle className={styles.spin} size={20} /></div> : templates.length ? <div className={styles.templateItems}>{templates.map((template) => <button type="button" key={template.id} className={selectedId === template.id ? styles.templateItemActive : styles.templateItem} onClick={() => onSelect(template.id)}><span className={styles.templateIcon}><FileText size={17} /></span><span><strong>{template.name}</strong><small>{template.language.toUpperCase()} · diperbarui {formatDate(template.updatedAt)}</small></span><ChevronRight size={15} /></button>)}</div> : <div className={styles.empty}><FileText size={25} /><strong>Belum ada template.</strong><span>Buat template pertama untuk dipakai di komposer.</span></div>}</div>
    <div className={styles.templateEditor}><div className={styles.panelHeader}><div><span>{selectedId ? "EDIT TEMPLATE" : "TEMPLATE BARU"}</span><h3>{selectedId ? "Tinjau isi surat" : "Buat template outreach"}</h3><p>Gunakan tombol placeholder agar nilai prospek diisi server dengan aman.</p></div><div className={styles.headerActions}>{selectedId ? <button type="button" className={styles.deleteButton} onClick={onDelete} disabled={busy || !canManage} title={!canManage ? "Izin kelola diperlukan untuk menghapus template." : undefined}><Trash2 size={15} /> Hapus</button> : null}<button type="button" className={styles.secondary} onClick={onUseStarter} disabled={busy || !canManage}><FileText size={15} /> Pakai contoh</button><button type="submit" form="template-form" className={styles.primary} disabled={busy || !canManage} title={!canManage ? "Izin kelola diperlukan untuk menyimpan template." : undefined}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Save size={16} />} Simpan</button></div></div><form id="template-form" className={styles.formBody} onSubmit={onSubmit}><fieldset disabled={!canManage} className={styles.formFieldset}><div className={styles.formGrid}><Field label="Nama template" required><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} placeholder="Penawaran konektivitas B2B" /></Field><Field label="Bahasa"><select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value as "id" | "en" })}><option value="id">Indonesia</option><option value="en">English</option></select></Field><Field label="Subjek" required hint="Placeholder bisa disisipkan dari tombol di bawah."><input ref={subjectRef} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required minLength={2} /></Field><Field label="Isi surat" required wide hint="Gunakan editor visual untuk paragraf, heading, ukuran font, alignment, daftar, tautan, dan format lain. Placeholder tetap disisipkan dari tombol di bawah."><RichTextEditor ref={bodyEditorRef} value={form.bodyHtml} format={form.bodyFormat} disabled={!canManage} onChange={(bodyHtml, bodyFormat) => setForm({ ...form, bodyHtml, bodyFormat })} /></Field><div className={styles.formSectionHeading}><strong>Tanda tangan pengirim</strong><span>Isi sesuai orang yang akan menerima balasan. Jika kosong, server memakai kontak perusahaan.</span></div><Field label="Salam penutup"><input value={form.senderSignoff} onChange={(event) => setForm({ ...form, senderSignoff: event.target.value })} placeholder="Best Regards," /></Field><Field label="Nama pengirim"><input value={form.senderName} onChange={(event) => setForm({ ...form, senderName: event.target.value })} placeholder="Nama Anda" /></Field><Field label="Email pengirim"><input type="email" value={form.senderEmail} onChange={(event) => setForm({ ...form, senderEmail: event.target.value })} placeholder="nama@perumnet.id" /></Field><Field label="Telepon pengirim"><input value={form.senderPhone} onChange={(event) => setForm({ ...form, senderPhone: event.target.value })} placeholder="Nomor telepon (opsional)" /></Field></div><PlaceholderButtons onInsert={(placeholder) => onInsert("bodyHtml", placeholder)} /><div className={styles.helperBlock}><strong>Sisipkan ke subjek</strong><div className={styles.placeholderRow}>{prospectPlaceholders.map((placeholder) => <button type="button" key={`subject-${placeholder}`} className={styles.placeholderButton} onClick={() => onInsert("subject", placeholder)}><code>{`{{${placeholder}}}`}</code><span>{prospectPlaceholderHints[placeholder].id}</span></button>)}</div></div></fieldset></form><div className={styles.templatePreviewSection}><div className={styles.previewSectionHeader}><div><span>PREVIEW TEMPLATE</span><strong>Uji ke kontak nyata dari daftar prospek</strong></div><div className={styles.previewControls}><select value={previewProspectId} onChange={(event) => setPreviewProspectId(event.target.value)}><option value="">Pilih prospek</option>{previewProspects.filter((item) => item.emailable || item.id === previewProspectId).map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.email || "tanpa email"}</option>)}</select><button type="button" className={styles.secondary} disabled={previewBusy || dirty || !selectedId || !previewProspectId} onClick={onPreview}>{previewBusy ? <LoaderCircle className={styles.spin} size={15} /> : <Eye size={15} />} Preview</button></div></div>{preview ? <PreviewFrame preview={preview} title="Pratinjau template surat" /> : <small className={styles.muted}>{dirty ? "Simpan perubahan template terlebih dahulu, lalu jalankan preview." : "Pilih prospek lalu jalankan preview."}</small>}</div></div>
  </section>;
}

function PlaceholderButtons({ onInsert }: { onInsert: (placeholder: string) => void }) {
  return <div className={styles.helperBlock}><strong>Sisipkan ke isi surat</strong><div className={styles.placeholderRow}>{prospectPlaceholders.map((placeholder) => <button type="button" key={placeholder} className={styles.placeholderButton} onClick={() => onInsert(placeholder)}><code>{`{{${placeholder}}}`}</code><span>{prospectPlaceholderHints[placeholder].id}</span></button>)}</div></div>;
}
