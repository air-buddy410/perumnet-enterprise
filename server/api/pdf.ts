import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { ApiError } from "./errors";
import { getDatabase } from "../db/client";
import { asNumber, formatDate, parseJson } from "../format";
import { documentTaxSummary } from "../tax";
import { refreshQuotationCommercialSnapshot } from "./tax-router";

type PdfKind = "quotation" | "invoice" | "spk" | "bast";
type PdfLanguage = "id" | "en";
type Color = [number, number, number];
type TextAlign = "left" | "center" | "right";

type DocumentMeta = {
  title: string;
  number: string;
  status?: string;
  subject?: string;
};

type PdfContext = {
  doc: jsPDF;
  logo?: string;
  meta: DocumentMeta;
  language: PdfLanguage;
};

type InfoItem = {
  label: string;
  value: string;
};

type TableColumn = {
  title: string;
  width: number;
  align?: TextAlign;
};

export type FinancialReportEntry = {
  date: string;
  dateIso: string;
  type: string;
  project: string;
  description: string;
  amount: number;
  source: string;
  category: string;
  // False for an imported bank line nobody has reconciled yet. The line is
  // still printed, it just does not count towards the reported cash.
  countsAsCash?: boolean;
};

export type FinancialReportBankAccount = {
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  openingBalance: number;
  currentBalance: number;
  balanceUpdatedAt?: string;
  syncMode: string;
};

export type FinancialReportProfitRow = {
  project: string;
  netProfit: number;
  allocatedAmount: number;
  paidAmount: number;
  retainedProfit: number;
  outstandingReimbursement?: number;
};

export type FinancialReportProcurementRow = {
  project: string;
  budgetBoq: number;
  committedVendorCost: number;
  paid: number;
  outstanding: number;
  acceptedAddenda: number;
};

export type FinancialReportTaxRow = {
  project: string;
  rule: string;
  direction: string;
  amount: number;
  settled: number;
  outstanding: number;
  status: string;
};

export type FinancialReportExpenseRow = {
  number: string;
  date: string;
  project: string;
  category: string;
  submitter: string;
  paidBy: string;
  paymentMethod: string;
  merchant: string;
  fundingSource: string;
  workflowStatus: string;
  settlementStatus: string;
  amount: number;
  reimbursementOutstanding: number;
};

const PAGE_WIDTH = 210;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BODY_TOP = 39;
const CONTENT_BOTTOM = 278;

const colors = {
  navy: [37, 75, 91] as Color,
  navyDark: [25, 54, 68] as Color,
  teal: [63, 190, 184] as Color,
  tealDark: [18, 145, 138] as Color,
  tealSoft: [231, 248, 246] as Color,
  ink: [39, 58, 67] as Color,
  muted: [102, 120, 127] as Color,
  line: [218, 229, 228] as Color,
  paper: [247, 250, 249] as Color,
  white: [255, 255, 255] as Color,
  warning: [181, 117, 29] as Color,
  warningSoft: [253, 246, 230] as Color,
  success: [35, 139, 91] as Color,
  danger: [181, 68, 68] as Color,
} satisfies Record<string, Color>;

let logoDataPromise: Promise<string | undefined> | undefined;

function cleanText(value: unknown, fallback = "-") {
  const cleaned = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/×/g, "x")
    .replace(/·/g, "-")
    .trim();
  return cleaned || fallback;
}

function tr(language: PdfLanguage, id: string, en: string) {
  return language === "en" ? en : id;
}

// Several statuses are stored in English. Client-facing Indonesian documents
// must not print "ACCEPTED" or "COMPLETED" in their status pills, so the few
// stored English words that reach a label are translated here as well.
const indonesianValues: Record<string, string> = {
  Accepted: "Diterima",
  Approved: "Disetujui",
  Completed: "Selesai",
  Rejected: "Ditolak",
  Sent: "Terkirim",
  Superseded: "Digantikan",
  Posted: "Tercatat",
  Void: "Dibatalkan",
};

function localizeValue(value: unknown, language: PdfLanguage) {
  const source = cleanText(value);
  if (language === "id") return indonesianValues[source] ?? source;
  const values: Record<string, string> = {
    Aktif: "Active",
    Nonaktif: "Inactive",
    Selesai: "Completed",
    Dikirim: "Sent",
    Dikerjakan: "In Progress",
    Lunas: "Paid",
    "Belum Lunas": "Unpaid",
    "Dibayar Sebagian": "Partially Paid",
    Pemasukan: "Income",
    Pengeluaran: "Expense",
    Perangkat: "Device",
    Material: "Material",
    Jasa: "Service",
    Mobilitas: "Mobility",
    Terpasang: "Installed",
    paket: "package",
    hari: "day",
    Umum: "General",
    Penjualan: "Sales",
    Operasional: "Operations",
    Vendor: "Vendor",
    Pajak: "Tax",
    Gaji: "Payroll",
    Modal: "Capital",
    Lainnya: "Other",
    Draft: "Draft",
    Final: "Final",
    Sent: "Sent",
    Generated: "Generated",
    Completed: "Completed",
    Manual: "Manual",
  };
  return values[source] ?? source;
}

function rupiah(value: unknown, language: PdfLanguage = "id") {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(asNumber(value)));
}

function displayDate(value: unknown, language: PdfLanguage = "id") {
  const raw = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return cleanText(formatDate(value));
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(`${raw}T00:00:00+08:00`));
}

function dateRange(start: unknown, end: unknown, language: PdfLanguage) {
  if (start && end) return `${displayDate(start, language)} ${tr(language, "s.d.", "to")} ${displayDate(end, language)}`;
  if (start) return `${tr(language, "Mulai", "From")} ${displayDate(start, language)}`;
  if (end) return `${tr(language, "Sampai", "Until")} ${displayDate(end, language)}`;
  return tr(language, "Belum ditentukan", "Not specified");
}

function splitText(doc: jsPDF, value: unknown, width: number) {
  return doc.splitTextToSize(cleanText(value), width) as string[];
}

async function loadLogo() {
  logoDataPromise ??= readFile(
    join(process.cwd(), "public", "perumnet-enterprise-brand.png"),
  )
    .then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`)
    .catch(() => undefined);
  return logoDataPromise;
}

function drawFallbackMark(doc: jsPDF) {
  doc.setFillColor(...colors.teal);
  doc.roundedRect(MARGIN, 8, 12, 12, 2, 2, "F");
  doc.setTextColor(...colors.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("PN", MARGIN + 6, 15.5, { align: "center" });
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (
    (normalized.includes("lunas") && !normalized.includes("belum")) ||
    (normalized.includes("paid") && !normalized.includes("unpaid"))
  ) {
    return { background: colors.tealSoft, foreground: colors.success };
  }
  if (
    normalized.includes("final") ||
    normalized.includes("selesai") ||
    normalized.includes("completed") ||
    normalized.includes("sent") ||
    normalized.includes("dikirim")
  ) {
    return { background: colors.tealSoft, foreground: colors.tealDark };
  }
  if (normalized.includes("belum") || normalized.includes("unpaid") || normalized.includes("draft")) {
    return { background: colors.warningSoft, foreground: colors.warning };
  }
  return { background: colors.paper, foreground: colors.navy };
}

function drawStatusPill(
  doc: jsPDF,
  status: string,
  xRight: number,
  y: number,
) {
  const label = cleanText(status).toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  const width = Math.min(45, Math.max(20, doc.getTextWidth(label) + 8));
  const tone = statusTone(status);
  doc.setFillColor(...tone.background);
  doc.roundedRect(xRight - width, y, width, 6.5, 3.2, 3.2, "F");
  doc.setTextColor(...tone.foreground);
  doc.text(label, xRight - width / 2, y + 4.3, { align: "center" });
}

function drawHeader(context: PdfContext, continuation = false) {
  const { doc, logo, meta } = context;
  doc.setFillColor(...colors.navyDark);
  doc.rect(0, 0, PAGE_WIDTH, 4, "F");

  if (logo) {
    try {
      doc.addImage(
        logo,
        "PNG",
        MARGIN,
        6.5,
        13,
        14,
        "perumnet-enterprise-brand",
        "FAST",
      );
    } catch {
      drawFallbackMark(doc);
    }
  } else {
    drawFallbackMark(doc);
  }

  doc.setTextColor(...colors.navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text("PERUMNET ENTERPRISE", 31, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(...colors.tealDark);
  doc.text(
    tr(context.language, "KONSULTAN IT & MANAGED SERVICES", "IT CONSULTING & MANAGED SERVICES"),
    31,
    15.5,
  );
  doc.setTextColor(...colors.muted);
  doc.setFontSize(6.8);
  doc.text("enterprise@perumnet.id  |  enterprise.perumnet.id", 31, 20);

  doc.setFont("helvetica", "bold");
  const documentTitle = continuation
    ? `${cleanText(meta.title).toUpperCase()} - ${tr(context.language, "LANJUTAN", "CONTINUED")}`
    : cleanText(meta.title).toUpperCase();
  let titleFontSize = 13;
  doc.setFontSize(titleFontSize);
  while (doc.getTextWidth(documentTitle) > 86 && titleFontSize > 7.5) {
    titleFontSize -= 0.5;
    doc.setFontSize(titleFontSize);
  }
  doc.setTextColor(...colors.navyDark);
  doc.text(
    documentTitle,
    PAGE_WIDTH - MARGIN,
    11.5,
    { align: "right" },
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...colors.muted);
  doc.text(cleanText(meta.number), PAGE_WIDTH - MARGIN, 17, {
    align: "right",
  });
  if (meta.status) {
    drawStatusPill(doc, meta.status, PAGE_WIDTH - MARGIN, 20.5);
  }

  doc.setDrawColor(...colors.teal);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, 31, PAGE_WIDTH - MARGIN, 31);
  doc.setLineWidth(0.2);
  doc.setTextColor(...colors.ink);
}

async function createDocument(meta: DocumentMeta, language: PdfLanguage) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `${meta.title} - ${meta.number}`,
    subject: meta.subject ?? meta.title,
    author: "PerumNet Enterprise",
    creator: "PerumNet Enterprise Operations",
  });
  const context: PdfContext = { doc, logo: await loadLogo(), meta, language };
  drawHeader(context);
  return context;
}

function addPage(context: PdfContext) {
  context.doc.addPage();
  drawHeader(context, true);
  return BODY_TOP;
}

function ensureSpace(context: PdfContext, y: number, requiredHeight: number) {
  return y + requiredHeight > CONTENT_BOTTOM ? addPage(context) : y;
}

function drawSectionTitle(
  context: PdfContext,
  y: number,
  title: string,
  caption?: string,
) {
  const { doc } = context;
  y = ensureSpace(context, y, caption ? 14 : 10);
  doc.setFillColor(...colors.teal);
  doc.roundedRect(MARGIN, y, 3, caption ? 11 : 8, 1.5, 1.5, "F");
  doc.setTextColor(...colors.navyDark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(cleanText(title), MARGIN + 7, y + 4.5);
  if (caption) {
    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(cleanText(caption), MARGIN + 7, y + 9);
  }
  return y + (caption ? 15 : 12);
}

function drawInfoGrid(context: PdfContext, y: number, items: InfoItem[]) {
  const { doc } = context;
  const gap = 6;
  const width = (CONTENT_WIDTH - gap) / 2;

  for (let index = 0; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2);
    // Text wrapping must be measured with the same type settings used for the
    // value itself. The header leaves a smaller font active, which otherwise
    // makes long project names overflow into the adjacent information card.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const values = pair.map((item) => splitText(doc, item.value, width - 8));
    const height = Math.max(
      17,
      ...values.map((lines) => 10.5 + lines.length * 4),
    );
    y = ensureSpace(context, y, height + 4);

    pair.forEach((item, pairIndex) => {
      const x = MARGIN + pairIndex * (width + gap);
      doc.setFillColor(...colors.paper);
      doc.setDrawColor(...colors.line);
      doc.roundedRect(x, y, width, height, 2, 2, "FD");
      doc.setTextColor(...colors.muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.text(cleanText(item.label).toUpperCase(), x + 4, y + 5);
      doc.setTextColor(...colors.ink);
      doc.setFontSize(9);
      doc.text(values[pairIndex], x + 4, y + 10.5);
    });
    y += height + 4;
  }
  return y;
}

function drawTableHeader(
  doc: jsPDF,
  y: number,
  columns: TableColumn[],
) {
  doc.setFillColor(...colors.navy);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 9, 1.4, 1.4, "F");
  let x = MARGIN;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...colors.white);
  for (const column of columns) {
    const align = column.align ?? "left";
    const textX =
      align === "right"
        ? x + column.width - 3
        : align === "center"
          ? x + column.width / 2
          : x + 3;
    doc.text(cleanText(column.title).toUpperCase(), textX, y + 5.8, {
      align,
    });
    x += column.width;
  }
  return y + 9;
}

function drawTable(
  context: PdfContext,
  y: number,
  columns: TableColumn[],
  rows: Array<Array<string | number>>,
) {
  const { doc } = context;
  y = ensureSpace(context, y, 18);
  y = drawTableHeader(doc, y, columns);

  rows.forEach((row, rowIndex) => {
    const wrapped = row.map((cell, cellIndex) =>
      splitText(doc, cell, columns[cellIndex].width - 6),
    );
    const rowHeight = Math.max(
      9,
      4.5 + Math.max(...wrapped.map((lines) => lines.length)) * 3.8,
    );
    if (y + rowHeight > CONTENT_BOTTOM) {
      y = addPage(context);
      y = drawTableHeader(doc, y, columns);
    }

    doc.setFillColor(
      ...(rowIndex % 2 === 0 ? colors.white : colors.paper),
    );
    doc.setDrawColor(...colors.line);
    doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight, "FD");

    let x = MARGIN;
    wrapped.forEach((cellLines, cellIndex) => {
      const column = columns[cellIndex];
      const align = column.align ?? "left";
      const textX =
        align === "right"
          ? x + column.width - 3
          : align === "center"
            ? x + column.width / 2
            : x + 3;
      doc.setTextColor(...colors.ink);
      doc.setFont("helvetica", cellIndex === 0 ? "bold" : "normal");
      doc.setFontSize(7.6);
      doc.text(cellLines, textX, y + 5.2, {
        align,
        lineHeightFactor: 1.25,
      });
      if (cellIndex < columns.length - 1) {
        doc.setDrawColor(...colors.line);
        doc.line(x + column.width, y, x + column.width, y + rowHeight);
      }
      x += column.width;
    });
    y += rowHeight;
  });

  return y + 4;
}

function drawCallout(
  context: PdfContext,
  y: number,
  title: string,
  body: string,
  tone: "teal" | "neutral" | "warning" = "neutral",
) {
  const { doc } = context;
  const bodyLines = splitText(doc, body, CONTENT_WIDTH - 12);
  const height = 12 + bodyLines.length * 4;
  y = ensureSpace(context, y, height + 3);
  const background =
    tone === "teal"
      ? colors.tealSoft
      : tone === "warning"
        ? colors.warningSoft
        : colors.paper;
  const foreground =
    tone === "warning" ? colors.warning : colors.tealDark;
  doc.setFillColor(...background);
  doc.setDrawColor(...colors.line);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, height, 2, 2, "FD");
  doc.setFillColor(...foreground);
  doc.roundedRect(MARGIN, y, 3, height, 1.5, 1.5, "F");
  doc.setTextColor(...foreground);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(cleanText(title).toUpperCase(), MARGIN + 7, y + 6);
  doc.setTextColor(...colors.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(bodyLines, MARGIN + 7, y + 11, { lineHeightFactor: 1.25 });
  return y + height + 4;
}

type DocumentTaxLine = {
  name: string;
  nameEn: string;
  effect: string;
  amount: number;
};

// Client-facing documents must never suggest that a withheld tax lowers the
// invoice. Add-effect lines are printed above the total; Withhold-effect lines
// are printed below it, immediately before the amount actually transferred.
function addedTaxRows(taxes: DocumentTaxLine[], language: PdfLanguage) {
  return taxes
    .filter((tax) => tax.effect !== "Withhold")
    .map((tax) => ({
      label: `${language === "en" ? tax.nameEn : tax.name} (${tr(language, "ditambahkan ke tagihan", "added to the bill")})`,
      value: `+${rupiah(tax.amount, language)}`,
    }));
}

function withheldTaxRows(
  taxes: DocumentTaxLine[],
  language: PdfLanguage,
  withheldBy = "",
) {
  const by = withheldBy || tr(language, "dipotong klien", "withheld by client");
  return taxes
    .filter((tax) => tax.effect === "Withhold")
    .map((tax) => ({
      label: `${language === "en" ? tax.nameEn : tax.name} (${by})`,
      value: `-${rupiah(tax.amount, language)}`,
    }));
}

function drawTotals(
  context: PdfContext,
  y: number,
  rows: Array<{ label: string; value: string; highlight?: boolean }>,
) {
  const { doc } = context;
  const width = 86;
  const height = rows.length * 9 + 5;
  y = ensureSpace(context, y, height + 4);
  const x = PAGE_WIDTH - MARGIN - width;
  doc.setFillColor(...colors.paper);
  doc.setDrawColor(...colors.line);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  rows.forEach((row, index) => {
    const rowY = y + 7 + index * 9;
    if (row.highlight) {
      doc.setFillColor(...colors.tealSoft);
      doc.roundedRect(x + 2, rowY - 5.5, width - 4, 8, 1, 1, "F");
    }
    doc.setTextColor(...(row.highlight ? colors.tealDark : colors.muted));
    doc.setFont("helvetica", row.highlight ? "bold" : "normal");
    doc.setFontSize(row.highlight ? 8 : 7.5);
    doc.text(cleanText(row.label), x + 6, rowY);
    doc.setTextColor(...(row.highlight ? colors.tealDark : colors.ink));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(row.highlight ? 10.5 : 8.5);
    doc.text(cleanText(row.value), x + width - 6, rowY, {
      align: "right",
    });
  });
  return y + height + 5;
}

function drawSignaturePair(
  context: PdfContext,
  y: number,
  left: { heading: string; name: string; role: string; signature?: unknown },
  right: { heading: string; name: string; role: string; signature?: unknown },
) {
  const { doc } = context;
  if (y + 39 > 280) {
    y = addPage(context);
  }
  const width = 80;
  const leftX = MARGIN + 4;
  const rightX = PAGE_WIDTH - MARGIN - width - 4;

  [left, right].forEach((party, index) => {
    const x = index === 0 ? leftX : rightX;
    doc.setTextColor(...colors.navyDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(cleanText(party.heading).toUpperCase(), x, y + 4);
    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(
      index === 0
        ? tr(context.language, "Pihak pertama", "First party")
        : tr(context.language, "Pihak kedua", "Second party"),
      x,
      y + 8,
    );
    if (party.signature) {
      try {
        doc.addImage(
          String(party.signature),
          "PNG",
          x,
          y + 9,
          55,
          14,
          undefined,
          "FAST",
        );
      } catch {
        // Signature text remains available when an uploaded image is invalid.
      }
    }
    doc.setDrawColor(...colors.navy);
    doc.line(x, y + 27, x + width, y + 27);
    doc.setTextColor(...colors.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(cleanText(party.name), x, y + 32);
    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(cleanText(party.role), x, y + 37);
  });

  return y + 41;
}

function drawMetricCards(
  context: PdfContext,
  y: number,
  metrics: Array<{
    label: string;
    value: string;
    tone: "income" | "expense" | "profit";
  }>,
) {
  const { doc } = context;
  y = ensureSpace(context, y, 27);
  const gap = 5;
  const width = (CONTENT_WIDTH - gap * 2) / 3;
  const toneColor = {
    income: colors.success,
    expense: colors.danger,
    profit: colors.tealDark,
  };
  metrics.forEach((metric, index) => {
    const x = MARGIN + index * (width + gap);
    doc.setFillColor(...colors.paper);
    doc.setDrawColor(...colors.line);
    doc.roundedRect(x, y, width, 23, 2, 2, "FD");
    doc.setFillColor(...toneColor[metric.tone]);
    doc.roundedRect(x, y, 3, 23, 1.5, 1.5, "F");
    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.text(cleanText(metric.label).toUpperCase(), x + 7, y + 7);
    doc.setTextColor(...toneColor[metric.tone]);
    doc.setFontSize(10);
    doc.text(cleanText(metric.value), x + 7, y + 16);
  });
  return y + 28;
}

function applyFooters(context: PdfContext) {
  const { doc } = context;
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...colors.line);
    doc.line(MARGIN, 282, PAGE_WIDTH - MARGIN, 282);
    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.text(
      "PerumNet Enterprise  |  enterprise@perumnet.id  |  enterprise.perumnet.id",
      MARGIN,
      287.5,
    );
    doc.text(
      tr(
        context.language,
        `Dokumen operasional - Halaman ${page} dari ${totalPages}`,
        `Operational document - Page ${page} of ${totalPages}`,
      ),
      PAGE_WIDTH - MARGIN,
      287.5,
      { align: "right" },
    );
  }
}

function response(context: PdfContext, filename: string) {
  applyFooters(context);
  const bytes = new Uint8Array(context.doc.output("arraybuffer"));
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replaceAll('"', "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function quotationPdf(projectOrQuotationId: string, language: PdfLanguage) {
  const { client } = await getDatabase();
  const directQuotation = await client.execute({
    sql: `SELECT q.*,s.kind AS scope_kind,s.title AS scope_title,s.sequence,
      cp.title AS package_title
      FROM quotations q
      LEFT JOIN boq_scopes s ON s.id=q.scope_id
      LEFT JOIN project_commercial_packages cp ON cp.id=q.package_id
      WHERE q.id=? LIMIT 1`,
    args: [projectOrQuotationId],
  });
  const projectId = directQuotation.rows[0]
    ? String(directQuotation.rows[0].project_id)
    : projectOrQuotationId;
  const projectResult = await client.execute({
    sql: "SELECT * FROM projects WHERE id=? LIMIT 1",
    args: [projectId],
  });
  const project = projectResult.rows[0];
  if (!project) {
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
  const quotationResult = directQuotation.rows[0]
    ? directQuotation
    : await client.execute({
        sql: `SELECT q.*,s.kind AS scope_kind,s.title AS scope_title,s.sequence,
          cp.title AS package_title
          FROM quotations q
          LEFT JOIN boq_scopes s ON s.id=q.scope_id
          LEFT JOIN project_commercial_packages cp ON cp.id=q.package_id
          WHERE q.project_id=? AND (s.sequence=0 OR q.scope_id IS NULL)
          ORDER BY q.created_at DESC LIMIT 1`,
        args: [projectId],
      });
  let quotation = quotationResult.rows[0];
  if (quotation?.id && String(quotation.status) === "Draft") {
    await refreshQuotationCommercialSnapshot(client, String(quotation.id));
    const refreshed = await client.execute({
      sql: `SELECT q.*,s.kind AS scope_kind,s.title AS scope_title,s.sequence,
        cp.title AS package_title
        FROM quotations q
        LEFT JOIN boq_scopes s ON s.id=q.scope_id
        LEFT JOIN project_commercial_packages cp ON cp.id=q.package_id
        WHERE q.id=? LIMIT 1`,
      args: [quotation.id],
    });
    quotation = refreshed.rows[0] ?? quotation;
  }
  const snapshotItems = quotation?.id
    ? await client.execute({
        sql: "SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY sort_order,created_at",
        args: [quotation.id],
      })
    : { rows: [] as Array<Record<string, unknown>> };
  const itemResult = snapshotItems.rows.length
    ? snapshotItems
    : await client.execute({
        sql: quotation?.scope_id
          ? "SELECT i.* FROM boq_items i WHERE i.scope_id=? ORDER BY i.sort_order"
          : `SELECT i.* FROM boq_items i
              JOIN boqs b ON b.id=i.boq_id
              LEFT JOIN boq_scopes s ON s.id=i.scope_id
              WHERE b.project_id=? AND (s.sequence=0 OR i.scope_id IS NULL)
              ORDER BY i.sort_order`,
        args: [quotation?.scope_id ?? projectId],
      });
  if (!itemResult.rows.length) {
    throw new ApiError(409, "EMPTY_BOQ", "BoQ belum memiliki item.");
  }
  const total = itemResult.rows.reduce(
    (sum, item) =>
      sum + asNumber(item.quantity) * asNumber(item.selling_price),
    0,
  );
  const quotationTax = quotation?.id
    ? await documentTaxSummary(
        client,
        "Quotation",
        String(quotation.id),
        asNumber(quotation.taxable_base) || total,
      )
    : {
        taxes: [],
        taxAdditions: 0,
        taxWithholdings: 0,
        grossTotal: total,
        netCashDue: total,
      };
  const number = quotation
    ? String(quotation.number)
    : `QUO/${String(project.code).replace("PN-", "")}`;
  const context = await createDocument({
    title: "Quotation",
    number,
    status: localizeValue(quotation ? quotation.status : "Draft", language),
    subject: tr(language, `Penawaran untuk ${String(project.name)}`, `Quotation for ${String(project.name)}`),
  }, language);
  let y = BODY_TOP;

  y = drawInfoGrid(context, y, [
    { label: tr(language, "Ditujukan kepada", "Prepared for"), value: String(project.client) },
    {
      label: tr(language, "Proyek", "Project"),
      value: `${String(project.code)} - ${String(project.name)}`,
    },
    { label: tr(language, "Lokasi pekerjaan", "Work location"), value: String(project.location) },
    {
      label: tr(language, "Masa berlaku", "Validity period"),
      value: dateRange(
        quotation?.issued_at ?? project.created_at,
        quotation?.valid_until ?? project.target_date,
        language,
      ),
    },
    {
      label: tr(language, "Jenis ruang lingkup", "Scope type"),
      value: quotation?.scope_kind
        ? `${localizeValue(quotation.scope_kind, language)} · ${String(quotation.scope_title ?? "")}`
        : tr(language, "BoQ Original", "Original BoQ"),
    },
    {
      label: tr(language, "Paket komersial", "Commercial package"),
      value: String(quotation?.package_title ?? "Lingkup Utama"),
    },
    {
      label: tr(language, "Persetujuan klien", "Client acceptance"),
      value: quotation?.accepted_at
        ? `${displayDate(quotation.accepted_at, language)} · ${String(quotation.acceptance_attachment_name ?? "-")}`
        : tr(language, "Belum diterima", "Not accepted"),
    },
  ]);
  y = drawSectionTitle(
    context,
    y,
    tr(language, "Rincian Penawaran", "Quotation Details"),
    tr(language, "Rincian pekerjaan, harga satuan, dan jumlah untuk ruang lingkup di atas", "Work items, unit prices, and amounts for the scope stated above"),
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: tr(language, "Deskripsi", "Description"), width: 70 },
      { title: "Qty", width: 24, align: "center" },
      { title: tr(language, "Harga Satuan", "Unit Price"), width: 36, align: "right" },
      { title: tr(language, "Jumlah", "Amount"), width: 40, align: "right" },
    ],
    itemResult.rows.map((item, index) => [
      index + 1,
      `${cleanText(item.description)}\n${localizeValue(item.category, language)}`,
      `${asNumber(item.quantity)} ${localizeValue(item.unit, language)}`,
      rupiah(item.selling_price, language),
      rupiah(asNumber(item.quantity) * asNumber(item.selling_price), language),
    ]),
  );
  y = drawTotals(context, y, [
    { label: tr(language, "Subtotal pekerjaan", "Work subtotal"), value: rupiah(total, language) },
    ...(asNumber(quotation?.discount_amount) > 0
      ? [
          {
            label: tr(language, "Dikurangi diskon", "Less discount"),
            value: `-${rupiah(quotation?.discount_amount, language)}`,
          },
          {
            label: tr(language, "Dasar pengenaan pajak", "Taxable subtotal"),
            value: rupiah(quotation?.taxable_base, language),
          },
        ]
      : []),
    // Add-effect tax raises the bill, so it belongs above the total. Withheld
    // tax never reduces the bill: it is deducted by the client when they pay,
    // so its line must sit BELOW the total, next to the amount transferred.
    ...addedTaxRows(quotationTax.taxes, language),
    ...(asNumber(quotation?.rounding_adjustment) !== 0
      ? [{
          label: tr(language, "Pembulatan", "Rounding"),
          value: `${asNumber(quotation?.rounding_adjustment) > 0 ? "+" : ""}${rupiah(quotation?.rounding_adjustment, language)}`,
        }]
      : []),
    {
      label: tr(language, "Total tagihan klien", "Total billed to the client"),
      value: rupiah(
        asNumber(quotation?.grand_total) || quotationTax.grossTotal,
        language,
      ),
    },
    ...withheldTaxRows(quotationTax.taxes, language),
    {
      label: tr(language, "Dibayarkan ke PerumNet", "Payable to PerumNet"),
      value: rupiah(
        Math.max(
          0,
          (asNumber(quotation?.grand_total) || quotationTax.grossTotal) -
            quotationTax.taxWithholdings,
        ),
        language,
      ),
      highlight: true,
    },
  ]);
  y = drawCallout(
    context,
    y,
    tr(language, "Ketentuan penawaran dan pajak", "Quotation and tax terms"),
    tr(language, "Harga di atas berlaku untuk ruang lingkup pekerjaan yang tercantum pada dokumen ini. Pajak yang ditambahkan, misalnya PPN, menambah nilai tagihan. Pajak yang dipotong, misalnya PPh, tidak mengurangi nilai tagihan: klien memotong dan menyetorkannya sendiri, sehingga jumlah yang ditransfer ke PerumNet menjadi lebih kecil dari total tagihan. Perubahan spesifikasi, volume, lokasi, atau jadwal pekerjaan dituangkan dalam penawaran revisi sebelum pekerjaan dimulai.", "The prices above apply to the scope of work stated in this document. Added tax such as VAT increases the amount billed. Withheld tax such as income tax does not reduce the amount billed: the client deducts and remits it directly, so the amount transferred to PerumNet is lower than the total billed. Changes to specifications, quantities, location, or schedule are confirmed in a revised quotation before work begins."),
    "teal",
  );
  y = drawSectionTitle(context, y, tr(language, "Persetujuan", "Approval"));
  drawSignaturePair(
    context,
    y,
    {
      heading: tr(language, "Disiapkan oleh", "Prepared by"),
      name: "PerumNet Enterprise",
      role: tr(language, "Perwakilan proyek / penjualan", "Project / sales representative"),
    },
    {
      heading: tr(language, "Disetujui oleh", "Approved by"),
      name: String(project.client),
      role: tr(language, "Nama, jabatan, dan tanda tangan", "Name, title, and signature"),
    },
  );
  return response(context, `${number.replaceAll("/", "-")}.pdf`);
}

async function invoicePdf(invoiceId: string, language: PdfLanguage) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT i.*,p.code AS project_code,p.name AS project_name,p.client,p.location,
      cp.title AS package_title,q.number AS quotation_number
      FROM invoices i JOIN projects p ON p.id=i.project_id
      LEFT JOIN project_commercial_packages cp ON cp.id=i.package_id
      LEFT JOIN quotations q ON q.id=i.quotation_id
      WHERE i.id=? LIMIT 1`,
    args: [invoiceId],
  });
  const invoice = result.rows[0];
  if (!invoice) {
    throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
  }
  const allocated = String(invoice.calculation_mode) === "Percent" &&
    asNumber(invoice.contract_grand_total) > 0;
  const taxableBase = allocated
    ? asNumber(invoice.taxable_base_snapshot)
    : asNumber(invoice.amount);
  const invoiceTax = await documentTaxSummary(
    client,
    "Invoice",
    invoiceId,
    taxableBase,
  );
  const invoicePayments = await client.execute({
    sql: `SELECT COALESCE(SUM(gross_amount),0) AS gross,
      COALESCE(SUM(cash_amount),0) AS cash,
      COALESCE(SUM(withholding_amount),0) AS withholding
      FROM invoice_payments WHERE invoice_id=? AND status='Posted'`,
    args: [invoiceId],
  });
  const paidGross = asNumber(invoicePayments.rows[0]?.gross);
  const invoiceGross = allocated ? asNumber(invoice.amount) : invoiceTax.grossTotal;
  const packageSummary = await client.execute({
    sql: `SELECT
      COALESCE(SUM(CASE WHEN calculation_mode='Percent' THEN amount ELSE amount+
        COALESCE((SELECT SUM(dt.amount) FROM document_taxes dt
          WHERE dt.document_type='Invoice' AND dt.document_id=invoices.id
            AND dt.effect='Add'),0) END),0) AS invoiced,
      COALESCE(SUM((SELECT COALESCE(SUM(ip.gross_amount),0)
        FROM invoice_payments ip WHERE ip.invoice_id=invoices.id AND ip.status='Posted')),0) AS paid
      FROM invoices WHERE package_id=?`,
    args: [invoice.package_id],
  });
  const packageInvoiced = asNumber(packageSummary.rows[0]?.invoiced);
  const packagePaid = asNumber(packageSummary.rows[0]?.paid);
  const contractGrandTotal = asNumber(invoice.contract_grand_total) || invoiceGross;
  const displayStatus =
    paidGross <= 0
      ? "Belum Lunas"
      : paidGross >= invoiceGross
        ? "Lunas"
        : "Dibayar Sebagian";
  const context = await createDocument({
    title: "Invoice",
    number: String(invoice.number),
    status: localizeValue(displayStatus, language),
    subject: tr(language, `Tagihan ${String(invoice.project_name)}`, `Invoice for ${String(invoice.project_name)}`),
  }, language);
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    { label: tr(language, "Ditagihkan kepada", "Bill to"), value: String(invoice.client) },
    {
      label: tr(language, "Proyek", "Project"),
      value: `${String(invoice.project_code)} - ${String(invoice.project_name)}`,
    },
    { label: tr(language, "Alamat / lokasi", "Address / location"), value: String(invoice.location) },
    {
      label: tr(language, "Tanggal invoice", "Invoice date"),
      value: displayDate(invoice.issue_date, language),
    },
    { label: tr(language, "Jatuh tempo", "Due date"), value: displayDate(invoice.due_date, language) },
    {
      label: tr(language, "Tanggal pembayaran", "Payment date"),
      value: invoice.paid_date
        ? displayDate(invoice.paid_date, language)
        : tr(language, "Belum dikonfirmasi", "Not confirmed"),
    },
    {
      label: tr(language, "Paket / quotation", "Package / quotation"),
      value: `${String(invoice.package_title ?? "Lingkup Utama")} · ${String(invoice.quotation_number ?? "-")}`,
    },
    {
      label: tr(language, "Persentase termin", "Installment percentage"),
      value: invoice.installment_bps
        ? `${(asNumber(invoice.installment_bps) / 100).toLocaleString(language === "en" ? "en-US" : "id-ID")}%`
        : tr(language, "Nominal", "Nominal"),
    },
  ]);
  y = drawSectionTitle(
    context,
    y,
    tr(language, "Rincian Tagihan", "Invoice Details"),
    tr(language, "Dokumen penagihan resmi PerumNet Enterprise", "Official billing document from PerumNet Enterprise"),
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: tr(language, "Deskripsi", "Description"), width: 96 },
      { title: "Qty", width: 22, align: "center" },
      { title: tr(language, "Jumlah", "Amount"), width: 52, align: "right" },
    ],
    [
      [
        1,
        `${cleanText(invoice.type)}\n${cleanText(invoice.project_name)}`,
        tr(language, "1 paket", "1 package"),
        rupiah(allocated ? invoice.subtotal_snapshot : invoice.amount, language),
      ],
    ],
  );
  y = drawTotals(context, y, [
    {
      label: tr(language, "Nilai kontrak / paket", "Contract / package value"),
      value: rupiah(contractGrandTotal, language),
    },
    { label: tr(language, "Subtotal pekerjaan", "Work subtotal"), value: rupiah(allocated ? invoice.subtotal_snapshot : invoice.amount, language) },
    ...(allocated && asNumber(invoice.discount_snapshot) > 0
      ? [{ label: tr(language, "Dikurangi diskon", "Less discount"), value: `-${rupiah(invoice.discount_snapshot, language)}` }]
      : []),
    ...(allocated
      ? [{ label: tr(language, "Dasar pengenaan pajak", "Taxable subtotal"), value: rupiah(invoice.taxable_base_snapshot, language) }]
      : []),
    ...addedTaxRows(invoiceTax.taxes, language),
    ...(allocated && asNumber(invoice.rounding_snapshot) !== 0
      ? [{ label: tr(language, "Pembulatan", "Rounding"), value: `${asNumber(invoice.rounding_snapshot) > 0 ? "+" : ""}${rupiah(invoice.rounding_snapshot, language)}` }]
      : []),
    {
      label: tr(language, "Total tagihan invoice ini", "Total for this invoice"),
      value: rupiah(invoiceGross, language),
    },
    ...withheldTaxRows(invoiceTax.taxes, language),
    {
      label: tr(language, "Dibayarkan ke PerumNet", "Payable to PerumNet"),
      value: rupiah(Math.max(0, invoiceGross - invoiceTax.taxWithholdings), language),
    },
    {
      label: tr(language, "Sudah dibayar", "Already paid"),
      value: rupiah(paidGross, language),
    },
    {
      label: tr(language, "Sisa tagihan invoice ini", "Balance due on this invoice"),
      value: rupiah(Math.max(0, invoiceGross - paidGross), language),
      highlight: true,
    },
    {
      label: tr(language, "Nilai kontrak belum ditagihkan", "Contract value not yet invoiced"),
      value: rupiah(Math.max(0, contractGrandTotal - packageInvoiced), language),
    },
    {
      label: tr(language, "Sisa tagihan seluruh paket", "Outstanding across the package"),
      value: rupiah(Math.max(0, packageInvoiced - packagePaid), language),
    },
  ]);
  y = drawCallout(
    context,
    y,
    tr(language, "Cara pembayaran", "How to pay"),
    tr(language, `Mohon lakukan pembayaran paling lambat pada tanggal jatuh tempo dan cantumkan nomor invoice ${cleanText(invoice.number)} pada berita transfer. Bila klien memotong pajak, yang ditransfer adalah nilai "Dibayarkan ke PerumNet" dan bukti potong mohon dilampirkan. Kirim bukti transfer serta pertanyaan tentang tagihan ini ke enterprise@perumnet.id. Invoice dinyatakan lunas setelah pembayaran diverifikasi oleh bagian Keuangan PerumNet Enterprise.`, `Please pay on or before the due date and quote invoice number ${cleanText(invoice.number)} in the transfer description. If tax is withheld, transfer the "Payable to PerumNet" amount and attach the withholding slip. Send the transfer receipt and any billing questions to enterprise@perumnet.id. The invoice is marked paid once PerumNet Enterprise Finance has verified the payment.`),
    invoice.status === "Lunas" ? "teal" : "warning",
  );
  y = drawSectionTitle(context, y, tr(language, "Otorisasi", "Authorization"));
  drawSignaturePair(
    context,
    y,
    {
      heading: tr(language, "Penerima tagihan", "Bill recipient"),
      name: String(invoice.client),
      role: tr(language, "Bagian keuangan / perwakilan berwenang", "Finance / authorized representative"),
    },
    {
      heading: tr(language, "Diterbitkan oleh", "Issued by"),
      name: "PerumNet Enterprise",
      role: tr(language, "Bagian Keuangan", "Finance Department"),
    },
  );
  return response(
    context,
    `${String(invoice.number).replaceAll("/", "-")}.pdf`,
  );
}

async function spkPdf(spkId: string, language: PdfLanguage) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT s.*,v.name AS vendor_name,v.category AS vendor_category,
      v.vendor_type,v.contact,v.email,v.address,p.code AS project_code,
      p.name AS project_name,p.location,q.number AS quotation_number,
      bs.kind AS scope_kind,bs.title AS scope_title
      FROM spks s
      JOIN vendors v ON v.id=s.vendor_id
      JOIN projects p ON p.id=s.project_id
      LEFT JOIN quotations q ON q.id=s.quotation_id
      LEFT JOIN boq_scopes bs ON bs.id=q.scope_id
      WHERE s.id=? LIMIT 1`,
    args: [spkId],
  });
  const spk = result.rows[0];
  if (!spk) {
    throw new ApiError(404, "NOT_FOUND", "SPK tidak ditemukan.");
  }
  const documentType = String(spk.document_type ?? "SPK");
  const spkTax = await documentTaxSummary(
    client,
    documentType === "PO" ? "PO" : "SPK",
    spkId,
    asNumber(spk.cost),
  );
  const [itemsResult, termsResult, verificationResult, receiptResult, paymentResult] =
    await Promise.all([
      client.execute({
        sql: "SELECT * FROM spk_items WHERE spk_id=? ORDER BY sort_order,created_at",
        args: [spkId],
      }),
      client.execute({
        sql: "SELECT * FROM spk_payment_terms WHERE spk_id=? ORDER BY sort_order,created_at",
        args: [spkId],
      }),
      client.execute({
        sql: `SELECT v.*,t.label AS term_label,u.name AS verifier_name
          FROM spk_verifications v
          LEFT JOIN spk_payment_terms t ON t.id=v.term_id
          LEFT JOIN users u ON u.id=v.verified_by
          WHERE v.spk_id=? ORDER BY v.verified_at`,
        args: [spkId],
      }),
      client.execute({
        sql: `SELECT r.received_at,r.receipt_number,u.name AS receiver_name,
          COALESCE(SUM(ri.quantity),0) AS received_quantity
          FROM po_receipts r
          LEFT JOIN po_receipt_items ri ON ri.receipt_id=r.id
          LEFT JOIN users u ON u.id=r.received_by
          WHERE r.spk_id=?
          GROUP BY r.id,u.name ORDER BY r.received_at`,
        args: [spkId],
      }),
      client.execute({
        sql: `SELECT pay.*,t.label AS term_label,a.bank_name,a.account_number_masked
          FROM spk_payments pay
          LEFT JOIN spk_payment_terms t ON t.id=pay.term_id
          LEFT JOIN bank_accounts a ON a.id=pay.bank_account_id
          WHERE pay.spk_id=? ORDER BY pay.paid_date,pay.created_at`,
        args: [spkId],
      }),
    ]);
  const context = await createDocument({
    title:
      documentType === "PO"
        ? tr(language, "Purchase Order", "Purchase Order")
        : tr(language, "Surat Perintah Kerja", "Work Order"),
    number: String(spk.number),
    status: localizeValue(spk.workflow_status ?? spk.status, language),
    subject:
      documentType === "PO"
        ? tr(language, `PO ${String(spk.project_name)}`, `Purchase Order ${String(spk.project_name)}`)
        : tr(language, `SPK ${String(spk.project_name)}`, `Work Order ${String(spk.project_name)}`),
  }, language);
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    {
      label: tr(language, "Vendor / pelaksana", "Vendor / contractor"),
      value: `${String(spk.vendor_name)} - ${String(spk.vendor_type ?? spk.vendor_category)}`,
    },
    {
      label: tr(language, "Kontak vendor", "Vendor contact"),
      value: [spk.contact, spk.email].filter(Boolean).join(" | "),
    },
    {
      label: tr(language, "Proyek", "Project"),
      value: `${String(spk.project_code)} - ${String(spk.project_name)}`,
    },
    { label: tr(language, "Lokasi pekerjaan", "Work location"), value: String(spk.location) },
    {
      label: tr(language, "Periode pekerjaan", "Work period"),
      value: spk.start_date || spk.end_date
        ? dateRange(spk.start_date, spk.end_date, language)
        : tr(language, "Dikoordinasikan bersama Project Manager", "To be coordinated with the Project Manager"),
    },
    { label: tr(language, "Nilai pekerjaan", "Work value"), value: rupiah(spk.cost, language) },
    {
      label: tr(language, "Dasar penerbitan", "Issued against"),
      value: spk.quotation_number
        ? `${String(spk.quotation_number)} · ${String(spk.scope_kind ?? "")} · ${String(spk.scope_title ?? "")}`
        : tr(language, "Dokumen lama tanpa keterkaitan BoQ", "Older document with no linked BoQ"),
    },
    {
      label: tr(language, "Status persetujuan", "Approval status"),
      value: localizeValue(spk.approval_status ?? "Draft", language),
    },
  ]);
  if (itemsResult.rows.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Rincian Pekerjaan yang Dikomitmenkan", "Committed Work Details"),
      tr(
        language,
        "Anggaran internal dan harga yang disepakati bersama vendor dicatat terpisah",
        "The internal budget and the price agreed with the vendor are recorded separately",
      ),
    );
    y = drawTable(
      context,
      y,
      [
        { title: "No.", width: 10, align: "center" },
        { title: tr(language, "Item", "Item"), width: 62 },
        { title: "Qty", width: 18, align: "center" },
        { title: tr(language, "Budget", "Budget"), width: 34, align: "right" },
        { title: tr(language, "Harga Vendor", "Vendor Price"), width: 34, align: "right" },
        { title: tr(language, "Jumlah", "Total"), width: 24, align: "right" },
      ],
      itemsResult.rows.map((item, index) => [
        index + 1,
        `${String(item.description_snapshot)}\n${localizeValue(item.category_snapshot, language)}`,
        `${asNumber(item.quantity)} ${String(item.unit)}`,
        rupiah(item.budget_unit_cost, language),
        rupiah(item.agreed_unit_cost, language),
        rupiah(item.line_total, language),
      ]),
    );
  }
  y = drawSectionTitle(context, y, tr(language, "Lingkup Pekerjaan", "Scope of Work"));
  y = drawCallout(
    context,
    y,
    tr(language, "Instruksi kerja", "Work instructions"),
    String(spk.scope),
    "teal",
  );
  y = drawTotals(context, y, [
    {
      label: tr(language, "Nilai pekerjaan disepakati", "Agreed work value"),
      value: rupiah(spk.cost, language),
    },
    ...addedTaxRows(spkTax.taxes, language),
    {
      label: tr(language, "Total tagihan vendor", "Total vendor billing"),
      value: rupiah(spkTax.grossTotal, language),
    },
    ...withheldTaxRows(
      spkTax.taxes,
      language,
      tr(language, "dipotong PerumNet", "withheld by PerumNet"),
    ),
    {
      label: tr(language, "Dibayarkan ke vendor", "Payable to the vendor"),
      value: rupiah(spkTax.netCashDue, language),
      highlight: true,
    },
  ]);
  if (termsResult.rows.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Jadwal Pembayaran", "Payment Schedule"),
      tr(
        language,
        "Termin yang bertanda wajib verifikasi baru dapat dibayar setelah progres atau barang diperiksa",
        "Terms marked as requiring verification are payable only after progress or goods have been checked",
      ),
    );
    y = drawTable(
      context,
      y,
      [
        { title: "No.", width: 12, align: "center" },
        { title: tr(language, "Termin", "Term"), width: 72 },
        { title: tr(language, "Jenis", "Type"), width: 34 },
        { title: tr(language, "Nilai", "Amount"), width: 40, align: "right" },
        { title: tr(language, "Verifikasi", "Verification"), width: 24 },
      ],
      termsResult.rows.map((term, index) => [
        index + 1,
        String(term.label),
        localizeValue(term.term_type, language),
        `${rupiah(term.planned_amount, language)}${
          term.percentage_bps
            ? `\n${(asNumber(term.percentage_bps) / 100).toFixed(2)}%`
            : ""
        }`,
        asNumber(term.requires_verification)
          ? tr(language, "Wajib", "Required")
          : tr(language, "Tidak wajib", "Not required"),
      ]),
    );
  }
  if (verificationResult.rows.length || receiptResult.rows.length) {
    y = drawSectionTitle(
      context,
      y,
      documentType === "PO"
        ? tr(language, "Penerimaan Barang", "Goods Receipts")
        : tr(language, "Verifikasi Progres", "Progress Verification"),
    );
    y = drawTable(
      context,
      y,
      [
        { title: tr(language, "Tanggal", "Date"), width: 30 },
        { title: tr(language, "Referensi", "Reference"), width: 56 },
        { title: tr(language, "Diperiksa oleh", "Checked by"), width: 46 },
        { title: tr(language, "Nilai / Jumlah", "Amount / Quantity"), width: 50, align: "right" },
      ],
      documentType === "PO"
        ? receiptResult.rows.map((receipt) => [
            displayDate(receipt.received_at, language),
            receipt.receipt_number
              ? String(receipt.receipt_number)
              : tr(language, "Tanpa nomor surat jalan", "No delivery note number"),
            String(receipt.receiver_name ?? "-"),
            `${asNumber(receipt.received_quantity)} ${tr(language, "unit diterima", "units received")}`,
          ])
        : verificationResult.rows.map((verification) => [
            displayDate(verification.verified_at, language),
            String(verification.term_label ?? tr(language, "Progres", "Progress")),
            String(verification.verifier_name ?? "-"),
            rupiah(verification.verified_amount, language),
          ]),
    );
  }
  if (paymentResult.rows.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Histori Pembayaran", "Payment History"),
    );
    y = drawTable(
      context,
      y,
      [
        { title: tr(language, "Tanggal", "Date"), width: 26 },
        { title: tr(language, "Termin / Tagihan", "Term / Invoice"), width: 52 },
        { title: tr(language, "Referensi", "Reference"), width: 48 },
        { title: tr(language, "Status", "Status"), width: 24 },
        { title: tr(language, "Nominal", "Amount"), width: 32, align: "right" },
      ],
      paymentResult.rows.map((payment) => [
        displayDate(payment.paid_date, language),
        `${String(payment.term_label ?? "-")}\n${String(payment.vendor_invoice_number)}`,
        `${String(payment.payment_reference)}${
          payment.bank_name
            ? `\n${String(payment.bank_name)} ${String(payment.account_number_masked ?? "")}`
            : ""
        }`,
        localizeValue(payment.status, language),
        `${rupiah(payment.gross_amount || payment.amount, language)}\n${tr(language, "Kas", "Cash")}: ${rupiah(payment.amount, language)}`,
      ]),
    );
    const posted = paymentResult.rows
      .filter((payment) => String(payment.status) === "Posted")
      .reduce(
        (sum, payment) =>
          sum + asNumber(payment.gross_amount || payment.amount),
        0,
      );
    y = drawTotals(context, y, [
      {
        label: tr(language, "Total dibayar", "Total paid"),
        value: rupiah(posted, language),
      },
      {
        label: tr(language, "Sisa komitmen", "Outstanding commitment"),
        value: rupiah(Math.max(0, spkTax.grossTotal - posted), language),
        highlight: true,
      },
    ]);
  }
  y = drawSectionTitle(
    context,
    y,
    tr(language, "Ketentuan Pelaksanaan", "Execution Terms"),
    tr(language, "Standar minimum yang disepakati kedua pihak", "The minimum standards agreed by both parties"),
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: tr(language, "Ketentuan", "Terms"), width: 170 },
    ],
    [
      [
        1,
        tr(language, "Pelaksana mengerjakan pekerjaan sesuai spesifikasi teknis, jadwal, dan arahan Project Manager PerumNet Enterprise.", "The contractor carries out the work according to the technical specifications, schedule, and directions of the PerumNet Enterprise Project Manager."),
      ],
      [
        2,
        tr(language, "Perubahan lingkup, volume, atau biaya harus disetujui tertulis oleh PerumNet Enterprise sebelum dikerjakan.", "Any change to the scope, quantities, or cost must be approved in writing by PerumNet Enterprise before it is carried out."),
      ],
      [
        3,
        tr(language, "Pelaksana bertanggung jawab atas mutu pekerjaan, keselamatan kerja, kerapian lokasi, serta dokumentasi hasil pekerjaan.", "The contractor is responsible for the quality of the work, occupational safety, site tidiness, and documentation of the results."),
      ],
      [
        4,
        tr(language, "Termin yang menuntut verifikasi dibayar setelah progres pekerjaan atau penerimaan barang diperiksa dan dicatat oleh PerumNet Enterprise.", "Terms that require verification are paid after PerumNet Enterprise has inspected and recorded the work progress or the goods received."),
      ],
      [
        5,
        tr(language, "Pekerjaan dinyatakan selesai setelah pemeriksaan di lokasi dan penandatanganan dokumen serah terima.", "The work is considered complete after the on-site inspection and the signing of the handover document."),
      ],
    ],
  );
  y = drawSectionTitle(context, y, tr(language, "Persetujuan Para Pihak", "Parties' Approval"));
  drawSignaturePair(
    context,
    y,
    {
      heading: tr(language, "Pemberi kerja", "Employer"),
      name: "PerumNet Enterprise",
      role: tr(language, "Project Manager / perwakilan berwenang", "Project Manager / authorized representative"),
    },
    {
      heading: tr(language, "Pelaksana", "Contractor"),
      name: String(spk.vendor_name),
      role: tr(language, "Nama, jabatan, dan tanda tangan", "Name, title, and signature"),
    },
  );
  return response(context, `${String(spk.number).replaceAll("/", "-")}.pdf`);
}

async function bastPdf(bastId: string, language: PdfLanguage) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT b.*,p.code AS project_code,p.name AS project_name,p.client,p.location,
      cp.title AS package_title,bs.enabled AS seal_enabled,
      bs.seal_mime_type,bs.seal_content_base64
      FROM basts b JOIN projects p ON p.id=b.project_id
      LEFT JOIN project_commercial_packages cp ON cp.id=b.package_id
      LEFT JOIN bast_seal_settings bs ON bs.id='global'
      WHERE b.id=? LIMIT 1`,
    args: [bastId],
  });
  const bast = result.rows[0];
  if (!bast) {
    throw new ApiError(404, "NOT_FOUND", "BAST tidak ditemukan.");
  }
  const items = parseJson<
    Array<{ name: string; quantity: string; status: string }>
  >(bast.installed_items_json, []);
  const context = await createDocument({
    title: tr(language, "Berita Acara Serah Terima", "Handover Certificate"),
    number: String(bast.number),
    status: localizeValue(bast.status, language),
    subject: tr(language, `Serah terima ${String(bast.project_name)}`, `Handover of ${String(bast.project_name)}`),
  }, language);
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    {
      label: tr(language, "Proyek", "Project"),
      value: `${String(bast.project_code)} - ${String(bast.project_name)}`,
    },
    { label: tr(language, "Pihak klien", "Client"), value: String(bast.client) },
    { label: tr(language, "Lokasi pekerjaan", "Work location"), value: String(bast.location) },
    {
      label: tr(language, "Paket / serah terima ke-", "Package / handover no."),
      value: `${String(bast.package_title ?? "Lingkup Utama")} / ${String(bast.delivery_cycle ?? 1)}`,
    },
    { label: tr(language, "Tanggal serah terima", "Handover date"), value: displayDate(bast.completion_date, language) },
  ]);
  y = drawCallout(
    context,
    y,
    tr(language, "Pernyataan serah terima", "Handover statement"),
    tr(language, "Para pihak menerangkan bahwa pekerjaan berikut telah diselesaikan, diperiksa, dan diserahterimakan dalam kondisi baik sesuai ruang lingkup yang disepakati.", "The parties confirm that the following work has been completed, inspected, and handed over in good condition according to the agreed scope."),
    "teal",
  );
  y = drawSectionTitle(
    context,
    y,
    tr(language, "Hasil Pekerjaan", "Work Results"),
    tr(language, "Item yang terpasang dan sudah diperiksa bersama di lokasi", "Items installed and jointly inspected on site"),
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: tr(language, "Item / Pekerjaan", "Item / Work"), width: 83 },
      { title: tr(language, "Jumlah", "Quantity"), width: 32, align: "center" },
      { title: "Status", width: 55 },
    ],
    items.map((item, index) => [
      index + 1,
      item.name,
      item.quantity,
      localizeValue(item.status, language),
    ]),
  );
  y = drawCallout(
    context,
    y,
    tr(language, "Catatan serah terima", "Handover notes"),
    String(bast.notes),
  );
  y = drawSectionTitle(
    context,
    y,
    tr(language, "Tanda Tangan", "Signatures"),
    tr(language, "Persetujuan tersimpan sebagai bagian dari dokumen BAST", "Approvals are stored as part of this handover document"),
  );
  y = drawSignaturePair(
    context,
    y,
    {
      heading: tr(language, "Pihak klien", "Client"),
      name: String(bast.client_name),
      role: String(bast.client_role),
      signature: bast.client_signature,
    },
    {
      heading: tr(language, "Pihak PerumNet", "PerumNet"),
      name: String(bast.engineer_name),
      role: String(bast.engineer_role ?? "Project Manager"),
      signature: bast.engineer_signature,
    },
  );
  if (bast.seal_enabled && bast.seal_content_base64) {
    try {
      const sealData = `data:${String(bast.seal_mime_type ?? "image/png")};base64,${String(bast.seal_content_base64)}`;
      const sealFormat = String(bast.seal_mime_type) === "image/jpeg"
        ? "JPEG"
        : String(bast.seal_mime_type) === "image/webp"
          ? "WEBP"
          : "PNG";
      context.doc.addImage(sealData, sealFormat, PAGE_WIDTH - MARGIN - 43, y - 35, 24, 24, undefined, "FAST");
    } catch {
      // The snapshot text below still identifies the internal seal when an old image is invalid.
    }
  }
  if (bast.verification_token) {
    y = ensureSpace(context, y, 31);
    const baseUrl = (process.env.APP_URL ?? "https://enterprise.perumnet.id").replace(/\/+$/, "");
    const verificationUrl = `${baseUrl}/verify/bast/${String(bast.verification_token)}`;
    const qr = await QRCode.toDataURL(verificationUrl, { margin: 1, width: 240 });
    context.doc.setFillColor(...colors.tealSoft);
    context.doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 27, 2, 2, "F");
    context.doc.addImage(qr, "PNG", MARGIN + 4, y + 3, 21, 21, undefined, "FAST");
    context.doc.setTextColor(...colors.navyDark);
    context.doc.setFont("helvetica", "bold");
    context.doc.setFontSize(8.5);
    context.doc.text(
      tr(language, "CAP INTERNAL PERUMNET DAN TAUTAN PEMERIKSAAN KEASLIAN", "PERUMNET INTERNAL SEAL AND AUTHENTICITY CHECK LINK"),
      MARGIN + 30,
      y + 8,
    );
    context.doc.setTextColor(...colors.muted);
    context.doc.setFont("helvetica", "normal");
    context.doc.setFontSize(7);
    // The seal must never be presented as a certified electronic signature.
    // It is PerumNet's own tamper-evident mark plus a link the client can open.
    context.doc.text(
      tr(
        language,
        `Cap ini adalah cap internal PerumNet Enterprise yang menandai dokumen asli dan belum diubah, bukan tanda tangan elektronik tersertifikasi. Pindai QR atau buka tautan di bawah untuk memastikan keaslian BAST ini. Cap atas nama ${String(bast.seal_name_snapshot ?? "PerumNet Enterprise")} - ${String(bast.seal_role_snapshot ?? "Authorized Representative")}.`,
        `This is PerumNet Enterprise's own internal seal marking the document as genuine and unaltered; it is not a certified electronic signature. Scan the QR code or open the link below to confirm that this handover certificate is authentic. Seal issued for ${String(bast.seal_name_snapshot ?? "PerumNet Enterprise")} - ${String(bast.seal_role_snapshot ?? "Authorized Representative")}.`,
      ),
      MARGIN + 30,
      y + 14,
      { maxWidth: CONTENT_WIDTH - 35 },
    );
    context.doc.setFont("courier", "normal");
    context.doc.setFontSize(6.5);
    context.doc.text(verificationUrl, MARGIN + 30, y + 23, { maxWidth: CONTENT_WIDTH - 35 });
  }
  return response(context, `${String(bast.number).replaceAll("/", "-")}.pdf`);
}

export async function renderValidationPdf(
  validationId: string,
  language: PdfLanguage = "id",
) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT v.*,p.code AS project_code,p.name AS project_name,p.client,p.location,
        u.name AS validator_name
      FROM project_validations v
      JOIN projects p ON p.id=v.project_id
      LEFT JOIN users u ON u.id=v.validated_by
      WHERE v.id=? LIMIT 1
    `,
    args: [validationId],
  });
  const validation = result.rows[0];
  if (!validation) {
    throw new ApiError(404, "NOT_FOUND", "Form validasi tidak ditemukan.");
  }
  const items = await client.execute({
    sql: "SELECT * FROM project_validation_items WHERE validation_id=? ORDER BY sort_order,created_at",
    args: [validationId],
  });
  const completed = String(validation.status) === "Completed";
  const context = await createDocument({
    title: tr(language, "Form Validasi Perangkat", "Device Validation Form"),
    number: String(validation.number),
    status: localizeValue(validation.status, language),
    subject: tr(language, `Validasi ${String(validation.project_name)}`, `Validation for ${String(validation.project_name)}`),
  }, language);
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    {
      label: tr(language, "Proyek", "Project"),
      value: `${String(validation.project_code)} - ${String(validation.project_name)}`,
    },
    { label: tr(language, "Klien", "Client"), value: String(validation.client) },
    { label: tr(language, "Lokasi pengujian", "Test location"), value: String(validation.location) },
    {
      label: tr(language, "Tanggal selesai", "Completion date"),
      value: validation.completed_at
        ? displayDate(validation.completed_at, language)
        : tr(language, "Belum selesai", "Not completed"),
    },
  ]);
  y = drawCallout(
    context,
    y,
    tr(language, "Cara pengisian", "How to complete this form"),
    tr(
      language,
      "Centang setiap Perangkat dan Material setelah jumlah, pemasangan, fungsi, dan kondisi fisiknya diperiksa langsung di lokasi. Seluruh item harus tercentang sebelum Berita Acara Serah Terima dapat diterbitkan.",
      "Tick each Device and Material once its quantity, installation, function, and physical condition have been inspected on site. Every item must be ticked before the handover certificate can be issued.",
    ),
    completed ? "teal" : "warning",
  );
  y = drawSectionTitle(
    context,
    y,
    tr(language, "Daftar Pemeriksaan", "Inspection Checklist"),
    tr(language, "Daftar ini disusun otomatis dari item Perangkat dan Material pada BoQ", "This list is built automatically from the Device and Material items in the BoQ"),
  );
  y = drawTable(
    context,
    y,
    [
      { title: tr(language, "Cek", "Check"), width: 18, align: "center" },
      { title: tr(language, "Kategori", "Category"), width: 30 },
      { title: tr(language, "Perangkat / Material", "Device / Material"), width: 72 },
      { title: tr(language, "Jumlah", "Quantity"), width: 24, align: "center" },
      { title: tr(language, "Catatan", "Notes"), width: 38 },
    ],
    items.rows.map((item) => [
      asNumber(item.checked) ? "[X]" : "[ ]",
      localizeValue(item.category, language),
      cleanText(item.description),
      `${asNumber(item.quantity)} ${localizeValue(item.unit, language)}`,
      cleanText(item.notes, "-"),
    ]),
  );
  const checkedCount = items.rows.filter((item) => Boolean(asNumber(item.checked))).length;
  y = drawTotals(context, y, [
    {
      label: tr(language, "Item sudah diperiksa", "Items checked"),
      value: `${checkedCount} / ${items.rows.length}`,
      highlight: completed,
    },
  ]);
  if (validation.notes) {
    y = drawCallout(
      context,
      y,
      tr(language, "Catatan umum", "General notes"),
      String(validation.notes),
    );
  }
  y = drawSectionTitle(context, y, tr(language, "Pengesahan Pemeriksaan", "Inspection Sign-off"));
  drawSignaturePair(
    context,
    y,
    {
      heading: tr(language, "Divalidasi oleh", "Validated by"),
      name: validation.validator_name ? String(validation.validator_name) : "-",
      role: tr(language, "Project Manager / Engineer", "Project Manager / Engineer"),
    },
    {
      heading: tr(language, "Diketahui oleh", "Acknowledged by"),
      name: String(validation.client),
      role: tr(language, "Perwakilan klien", "Client representative"),
    },
  );
  return response(context, `${String(validation.number).replaceAll("/", "-")}.pdf`);
}

function generatedDate(language: PdfLanguage) {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date());
}

function localIsoDate() {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export async function renderFinancialReportPdf(
  entries: FinancialReportEntry[],
  scopeLabel: string,
  language: PdfLanguage = "id",
  bankAccounts: FinancialReportBankAccount[] = [],
  profitRows: FinancialReportProfitRow[] = [],
  procurementRows: FinancialReportProcurementRow[] = [],
  taxRows: FinancialReportTaxRow[] = [],
  projectExpenseRows: FinancialReportExpenseRow[] = [],
) {
  const sortedDates = entries
    .map((entry) => entry.dateIso)
    .filter(Boolean)
    .sort();
  const period =
    sortedDates.length > 0
      ? `${displayDate(sortedDates[0], language)} ${tr(language, "s.d.", "to")} ${displayDate(sortedDates.at(-1), language)}`
      : tr(language, "Belum ada transaksi", "No transactions yet");
  const reportDate = localIsoDate();
  const booked = entries.filter((entry) => entry.countsAsCash !== false);
  const income = booked
    .filter((entry) => entry.type === "Pemasukan")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const expense = booked
    .filter((entry) => entry.type === "Pengeluaran")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const netCash = income - expense;
  const context = await createDocument({
    title: tr(language, "Laporan Arus Kas", "Cash Flow Report"),
    number: `FIN/${reportDate.replaceAll("-", "")}`,
    status: "Generated",
    subject: tr(language, `Laporan arus kas ${scopeLabel}`, `Cash flow report ${scopeLabel}`),
  }, language);
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    { label: tr(language, "Ruang lingkup", "Scope"), value: scopeLabel },
    { label: tr(language, "Periode transaksi", "Transaction period"), value: period },
    { label: tr(language, "Jumlah transaksi", "Transaction count"), value: `${entries.length} ${tr(language, "transaksi", "transactions")}` },
    { label: tr(language, "Tanggal laporan", "Report date"), value: generatedDate(language) },
  ]);
  y = drawMetricCards(context, y, [
    { label: tr(language, "Kas masuk", "Cash inflow"), value: rupiah(income, language), tone: "income" },
    { label: tr(language, "Kas keluar", "Cash outflow"), value: rupiah(expense, language), tone: "expense" },
    { label: tr(language, "Arus kas bersih", "Net cash flow"), value: rupiah(netCash, language), tone: "profit" },
  ]);

  if (bankAccounts.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Posisi Rekening Perusahaan", "Company Bank Position"),
      tr(
        language,
        "Saldo terakhir sesuai mutasi atau konektor bank",
        "Latest balance from bank statements or the bank connector",
      ),
    );
    y = drawTable(
      context,
      y,
      [
        { title: tr(language, "Rekening", "Account"), width: 58 },
        { title: tr(language, "Metode", "Method"), width: 30 },
        { title: tr(language, "Saldo Awal", "Opening Balance"), width: 47, align: "right" },
        { title: tr(language, "Saldo Terkini", "Current Balance"), width: 47, align: "right" },
      ],
      bankAccounts.map((account) => [
        `${account.bankName} · ${account.accountNumberMasked}\n${account.accountName}`,
        localizeValue(account.syncMode, language),
        rupiah(account.openingBalance, language),
        `${rupiah(account.currentBalance, language)}${
          account.balanceUpdatedAt
            ? `\n${displayDate(account.balanceUpdatedAt, language)}`
            : ""
        }`,
      ]),
    );
  }

  if (profitRows.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Distribusi Laba Proyek", "Project Profit Distribution"),
      tr(
        language,
        "Nilai sepanjang umur proyek; laba dasar tidak termasuk pembayaran bagi hasil",
        "Lifetime project values; base profit excludes profit-share payments",
      ),
    );
    y = drawTable(
      context,
      y,
      [
        { title: tr(language, "Proyek", "Project"), width: 58 },
        { title: tr(language, "Laba Dasar", "Base Profit"), width: 34, align: "right" },
        { title: tr(language, "Reimbursement", "Reimbursement"), width: 34, align: "right" },
        { title: tr(language, "Dialokasikan", "Allocated"), width: 28, align: "right" },
        { title: tr(language, "Dibayar", "Paid"), width: 28, align: "right" },
      ],
      profitRows.map((row) => [
        row.project,
        rupiah(row.netProfit, language),
        rupiah(row.outstandingReimbursement ?? 0, language),
        `${rupiah(row.allocatedAmount, language)}\n${tr(language, "Sisa", "Retained")}: ${rupiah(row.retainedProfit, language)}`,
        rupiah(row.paidAmount, language),
      ]),
    );
  }

  if (procurementRows.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Komitmen Vendor", "Vendor Commitments"),
      tr(
        language,
        "Komitmen belum dibayar adalah kewajiban, bukan kas keluar",
        "Unpaid commitments are liabilities, not cash outflows",
      ),
    );
    y = drawTable(
      context,
      y,
      [
        { title: tr(language, "Proyek", "Project"), width: 54 },
        { title: tr(language, "Budget BoQ", "BoQ Budget"), width: 32, align: "right" },
        { title: tr(language, "Komitmen", "Committed"), width: 32, align: "right" },
        { title: tr(language, "Dibayar", "Paid"), width: 32, align: "right" },
        { title: tr(language, "Belum Dibayar", "Outstanding"), width: 32, align: "right" },
      ],
      procurementRows.map((row) => [
        `${row.project}\n${tr(language, "Addendum diterima", "Accepted addenda")}: ${row.acceptedAddenda}`,
        rupiah(row.budgetBoq, language),
        rupiah(row.committedVendorCost, language),
        rupiah(row.paid, language),
        rupiah(row.outstanding, language),
      ]),
    );
  }

  if (taxRows.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Posisi Pajak", "Tax Position"),
      tr(
        language,
        "Pajak yang ditambahkan, dipotong, sudah disetor, dan yang masih tersisa, mengikuti nilai pajak yang terkunci pada tiap dokumen",
        "Tax added, withheld, already settled, and still outstanding, based on the tax values locked on each document",
      ),
    );
    y = drawTable(
      context,
      y,
      [
        { title: tr(language, "Proyek", "Project"), width: 47 },
        { title: tr(language, "Pajak", "Tax"), width: 31 },
        { title: tr(language, "Posisi", "Position"), width: 27 },
        { title: tr(language, "Nilai", "Amount"), width: 28, align: "right" },
        { title: tr(language, "Settlement", "Settled"), width: 24, align: "right" },
        { title: "Outstanding", width: 25, align: "right" },
      ],
      taxRows.map((row) => [
        row.project,
        `${row.rule}\n${localizeValue(row.status, language)}`,
        row.direction === "Payable"
          ? tr(language, "Utang", "Payable")
          : tr(language, "Piutang", "Receivable"),
        rupiah(row.amount, language),
        rupiah(row.settled, language),
        rupiah(row.outstanding, language),
      ]),
    );
  }

  if (projectExpenseRows.length) {
    y = drawSectionTitle(
      context,
      y,
      tr(language, "Belanja Proyek", "Project Expenses"),
      tr(
        language,
        "Nota lapangan, sumber dana, status verifikasi, dan kewajiban reimbursement",
        "Field receipts, funding sources, verification status, and reimbursement liabilities",
      ),
    );
    y = drawTable(
      context,
      y,
      [
        { title: tr(language, "Nota / Tanggal", "Receipt / Date"), width: 34 },
        { title: tr(language, "Proyek / Toko", "Project / Merchant"), width: 48 },
        { title: tr(language, "Kategori / Pengaju", "Category / Submitter"), width: 38 },
        { title: tr(language, "Sumber / Status", "Funding / Status"), width: 36 },
        { title: tr(language, "Nominal", "Amount"), width: 26, align: "right" },
      ],
      projectExpenseRows.map((row) => [
        `${row.number}\n${displayDate(row.date, language)}`,
        `${row.project}\n${row.merchant}`,
        `${row.category}\n${row.submitter}`,
        `${localizeValue(row.fundingSource, language)} · ${row.paymentMethod}\n${localizeValue(row.workflowStatus, language)} / ${localizeValue(row.settlementStatus, language)}`,
        `${rupiah(row.amount, language)}${row.reimbursementOutstanding > 0 ? `\n${tr(language, "Utang", "Payable")} ${row.paidBy}: ${rupiah(row.reimbursementOutstanding, language)}` : ""}`,
      ]),
    );
  }

  if (!entries.length) {
    drawCallout(
      context,
      y,
      tr(language, "Belum ada data", "No data"),
      tr(language, "Tidak ada transaksi yang dapat ditampilkan untuk ruang lingkup laporan ini.", "There are no transactions to display for this report scope."),
      "warning",
    );
    return response(
      context,
      `${tr(language, "Laporan-Arus-Kas", "Cash-Flow-Report")}-PerumNet-${reportDate}.pdf`,
    );
  }

  const monthly = new Map<
    string,
    { income: number; expense: number }
  >();
  const projects = new Map<
    string,
    { income: number; expense: number }
  >();
  for (const entry of entries) {
    const month = entry.dateIso.slice(0, 7);
    const monthValue = monthly.get(month) ?? { income: 0, expense: 0 };
    const projectValue = projects.get(entry.project) ?? {
      income: 0,
      expense: 0,
    };
    if (entry.type === "Pemasukan") {
      monthValue.income += entry.amount;
      projectValue.income += entry.amount;
    } else {
      monthValue.expense += entry.amount;
      projectValue.expense += entry.amount;
    }
    monthly.set(month, monthValue);
    projects.set(entry.project, projectValue);
  }

  y = drawSectionTitle(
    context,
    y,
    tr(language, "Arus Kas Bulanan", "Monthly Cash Flow"),
    tr(language, "Perbandingan kas masuk dan kas keluar", "Cash inflow and outflow comparison"),
  );
  y = drawTable(
    context,
    y,
    [
      { title: tr(language, "Periode", "Period"), width: 50 },
      { title: tr(language, "Kas Masuk", "Cash Inflow"), width: 44, align: "right" },
      { title: tr(language, "Kas Keluar", "Cash Outflow"), width: 44, align: "right" },
      { title: tr(language, "Arus Bersih", "Net Cash"), width: 44, align: "right" },
    ],
    Array.from(monthly.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, value]) => [
        new Intl.DateTimeFormat(language === "en" ? "en-US" : "id-ID", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${month}-01T00:00:00.000Z`)),
        rupiah(value.income, language),
        rupiah(value.expense, language),
        rupiah(value.income - value.expense, language),
      ]),
  );

  y = drawSectionTitle(
    context,
    y,
    tr(language, "Kontribusi Kas Proyek", "Project Cash Contribution"),
    tr(language, "Ringkasan arus kas berdasarkan transaksi tercatat", "Cash flow summary based on recorded transactions"),
  );
  y = drawTable(
    context,
    y,
    [
      { title: tr(language, "Proyek", "Project"), width: 74 },
      { title: tr(language, "Kas Masuk", "Cash Inflow"), width: 36, align: "right" },
      { title: tr(language, "Kas Keluar", "Cash Outflow"), width: 36, align: "right" },
      { title: tr(language, "Arus Bersih", "Net Cash"), width: 36, align: "right" },
    ],
    Array.from(projects.entries())
      .sort(
        ([, left], [, right]) =>
          right.income -
          right.expense -
          (left.income - left.expense),
      )
      .map(([project, value]) => [
        project,
        rupiah(value.income, language),
        rupiah(value.expense, language),
        rupiah(value.income - value.expense, language),
      ]),
  );

  y = drawSectionTitle(
    context,
    y,
    tr(language, "Buku Kas", "Cash Ledger"),
    tr(language, "Rincian seluruh transaksi dalam laporan", "All transactions included in this report"),
  );
  drawTable(
    context,
    y,
    [
      { title: tr(language, "Tanggal", "Date"), width: 22 },
      { title: tr(language, "Jenis", "Type"), width: 21 },
      { title: tr(language, "Proyek", "Project"), width: 34 },
      { title: tr(language, "Kategori", "Category"), width: 28 },
      { title: tr(language, "Deskripsi / Sumber", "Description / Source"), width: 46 },
      { title: tr(language, "Nominal", "Amount"), width: 31, align: "right" },
    ],
    entries.map((entry) => [
      entry.date,
      localizeValue(entry.type, language),
      localizeValue(entry.project, language),
      localizeValue(entry.category, language),
      `${entry.description}\n${entry.source}`,
      rupiah(entry.amount, language),
    ]),
  );

  return response(
    context,
    `${tr(language, "Laporan-Arus-Kas", "Cash-Flow-Report")}-PerumNet-${reportDate}.pdf`,
  );
}

export async function renderBusinessPdf(
  kind: PdfKind,
  id: string,
  language: PdfLanguage = "id",
) {
  if (kind === "quotation") return quotationPdf(id, language);
  if (kind === "invoice") return invoicePdf(id, language);
  if (kind === "spk") return spkPdf(id, language);
  return bastPdf(id, language);
}
