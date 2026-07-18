import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { ApiError } from "./errors";
import { getDatabase } from "../db/client";
import { asNumber, formatDate, parseJson } from "../format";

type PdfKind = "quotation" | "invoice" | "spk" | "bast";
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

function rupiah(value: unknown) {
  return `Rp ${Math.round(asNumber(value)).toLocaleString("id-ID")}`;
}

function displayDate(value: unknown) {
  return cleanText(formatDate(value));
}

function dateRange(start: unknown, end: unknown) {
  if (start && end) return `${displayDate(start)} s.d. ${displayDate(end)}`;
  if (start) return `Mulai ${displayDate(start)}`;
  if (end) return `Sampai ${displayDate(end)}`;
  return "Belum ditentukan";
}

function splitText(doc: jsPDF, value: unknown, width: number) {
  return doc.splitTextToSize(cleanText(value), width) as string[];
}

async function loadLogo() {
  logoDataPromise ??= readFile(
    join(process.cwd(), "public", "perumnet-enterprise-logo.png"),
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
    normalized.includes("lunas") &&
    !normalized.includes("belum")
  ) {
    return { background: colors.tealSoft, foreground: colors.success };
  }
  if (
    normalized.includes("final") ||
    normalized.includes("selesai") ||
    normalized.includes("sent") ||
    normalized.includes("dikirim")
  ) {
    return { background: colors.tealSoft, foreground: colors.tealDark };
  }
  if (normalized.includes("belum") || normalized.includes("draft")) {
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
        "perumnet-enterprise-logo",
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
  doc.text("KONSULTAN IT & MANAGED SERVICES", 31, 15.5);
  doc.setTextColor(...colors.muted);
  doc.setFontSize(6.8);
  doc.text("it@perumnet.id  |  perumnet.id", 31, 20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...colors.navyDark);
  doc.text(
    continuation
      ? `${cleanText(meta.title).toUpperCase()} - LANJUTAN`
      : cleanText(meta.title).toUpperCase(),
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

async function createDocument(meta: DocumentMeta) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `${meta.title} - ${meta.number}`,
    subject: meta.subject ?? meta.title,
    author: "PerumNet Enterprise",
    creator: "PerumNet Enterprise Operations",
  });
  const context: PdfContext = { doc, logo: await loadLogo(), meta };
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
      index === 0 ? "Pihak pertama" : "Pihak kedua",
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
      "PerumNet Enterprise  |  it@perumnet.id  |  perumnet.id",
      MARGIN,
      287.5,
    );
    doc.text(
      `Dokumen operasional - Halaman ${page} dari ${totalPages}`,
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

async function quotationPdf(projectId: string) {
  const { client } = await getDatabase();
  const projectResult = await client.execute({
    sql: "SELECT * FROM projects WHERE id=? LIMIT 1",
    args: [projectId],
  });
  const project = projectResult.rows[0];
  if (!project) {
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
  const itemResult = await client.execute({
    sql: "SELECT i.* FROM boq_items i JOIN boqs b ON b.id=i.boq_id WHERE b.project_id=? ORDER BY i.sort_order",
    args: [projectId],
  });
  if (!itemResult.rows.length) {
    throw new ApiError(409, "EMPTY_BOQ", "BoQ belum memiliki item.");
  }
  const total = itemResult.rows.reduce(
    (sum, item) =>
      sum + asNumber(item.quantity) * asNumber(item.selling_price),
    0,
  );
  const quotationResult = await client.execute({
    sql: "SELECT number,status,issued_at,valid_until,total FROM quotations WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
    args: [projectId],
  });
  const quotation = quotationResult.rows[0];
  const number = quotation
    ? String(quotation.number)
    : `QUO/${String(project.code).replace("PN-", "")}`;
  const context = await createDocument({
    title: "Quotation",
    number,
    status: quotation ? String(quotation.status) : "Draft",
    subject: `Penawaran untuk ${String(project.name)}`,
  });
  let y = BODY_TOP;

  y = drawInfoGrid(context, y, [
    { label: "Ditujukan kepada", value: String(project.client) },
    {
      label: "Proyek",
      value: `${String(project.code)} - ${String(project.name)}`,
    },
    { label: "Lokasi pekerjaan", value: String(project.location) },
    {
      label: "Masa berlaku",
      value: dateRange(
        quotation?.issued_at ?? project.created_at,
        quotation?.valid_until ?? project.target_date,
      ),
    },
  ]);
  y = drawSectionTitle(
    context,
    y,
    "Rincian Penawaran",
    "Nilai berdasarkan Bill of Quantity proyek",
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: "Deskripsi", width: 70 },
      { title: "Qty", width: 24, align: "center" },
      { title: "Harga Satuan", width: 36, align: "right" },
      { title: "Jumlah", width: 40, align: "right" },
    ],
    itemResult.rows.map((item, index) => [
      index + 1,
      `${cleanText(item.description)}\n${cleanText(item.category)}`,
      `${asNumber(item.quantity)} ${cleanText(item.unit)}`,
      rupiah(item.selling_price),
      rupiah(asNumber(item.quantity) * asNumber(item.selling_price)),
    ]),
  );
  y = drawTotals(context, y, [
    { label: "Subtotal", value: rupiah(total) },
    { label: "Total penawaran", value: rupiah(total), highlight: true },
  ]);
  y = drawCallout(
    context,
    y,
    "Ketentuan penawaran",
    "Harga berlaku untuk ruang lingkup yang tercantum. Perubahan spesifikasi, volume, lokasi, atau jadwal pekerjaan akan dikonfirmasi melalui revisi penawaran. Jadwal pelaksanaan disepakati setelah penawaran diterima.",
    "teal",
  );
  y = drawSectionTitle(context, y, "Persetujuan");
  drawSignaturePair(
    context,
    y,
    {
      heading: "Disiapkan oleh",
      name: "PerumNet Enterprise",
      role: "Project / Sales Representative",
    },
    {
      heading: "Disetujui oleh",
      name: String(project.client),
      role: "Nama, jabatan, dan tanda tangan",
    },
  );
  return response(context, `${number.replaceAll("/", "-")}.pdf`);
}

async function invoicePdf(invoiceId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT i.*,p.code AS project_code,p.name AS project_name,p.client,p.location FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.id=? LIMIT 1",
    args: [invoiceId],
  });
  const invoice = result.rows[0];
  if (!invoice) {
    throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
  }
  const context = await createDocument({
    title: "Invoice",
    number: String(invoice.number),
    status: String(invoice.status),
    subject: `Tagihan ${String(invoice.project_name)}`,
  });
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    { label: "Ditagihkan kepada", value: String(invoice.client) },
    {
      label: "Proyek",
      value: `${String(invoice.project_code)} - ${String(invoice.project_name)}`,
    },
    { label: "Alamat / lokasi", value: String(invoice.location) },
    {
      label: "Tanggal invoice",
      value: displayDate(invoice.issue_date),
    },
    { label: "Jatuh tempo", value: displayDate(invoice.due_date) },
    {
      label: "Tanggal pembayaran",
      value: invoice.paid_date
        ? displayDate(invoice.paid_date)
        : "Belum dikonfirmasi",
    },
  ]);
  y = drawSectionTitle(
    context,
    y,
    "Rincian Tagihan",
    "Dokumen penagihan resmi PerumNet Enterprise",
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: "Deskripsi", width: 96 },
      { title: "Qty", width: 22, align: "center" },
      { title: "Jumlah", width: 52, align: "right" },
    ],
    [
      [
        1,
        `${cleanText(invoice.type)}\n${cleanText(invoice.project_name)}`,
        "1 paket",
        rupiah(invoice.amount),
      ],
    ],
  );
  y = drawTotals(context, y, [
    { label: "Subtotal", value: rupiah(invoice.amount) },
    { label: "Total tagihan", value: rupiah(invoice.amount), highlight: true },
  ]);
  y = drawCallout(
    context,
    y,
    "Instruksi pembayaran",
    `Gunakan nomor invoice ${cleanText(invoice.number)} sebagai referensi pembayaran. Bukti pembayaran dan pertanyaan terkait tagihan dapat dikirim ke it@perumnet.id. Pembayaran dinyatakan sah setelah dikonfirmasi oleh bagian Finance PerumNet Enterprise.`,
    invoice.status === "Lunas" ? "teal" : "warning",
  );
  y = drawSectionTitle(context, y, "Otorisasi");
  drawSignaturePair(
    context,
    y,
    {
      heading: "Penerima tagihan",
      name: String(invoice.client),
      role: "Finance / Authorized Representative",
    },
    {
      heading: "Diterbitkan oleh",
      name: "PerumNet Enterprise",
      role: "Finance Department",
    },
  );
  return response(
    context,
    `${String(invoice.number).replaceAll("/", "-")}.pdf`,
  );
}

async function spkPdf(spkId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT s.*,v.name AS vendor_name,v.category AS vendor_category,v.contact,v.email,v.address,p.code AS project_code,p.name AS project_name,p.location FROM spks s JOIN vendors v ON v.id=s.vendor_id JOIN projects p ON p.id=s.project_id WHERE s.id=? LIMIT 1",
    args: [spkId],
  });
  const spk = result.rows[0];
  if (!spk) {
    throw new ApiError(404, "NOT_FOUND", "SPK tidak ditemukan.");
  }
  const context = await createDocument({
    title: "Surat Perintah Kerja",
    number: String(spk.number),
    status: String(spk.status),
    subject: `SPK ${String(spk.project_name)}`,
  });
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    {
      label: "Vendor / pelaksana",
      value: `${String(spk.vendor_name)} - ${String(spk.vendor_category)}`,
    },
    {
      label: "Kontak vendor",
      value: [spk.contact, spk.email].filter(Boolean).join(" | "),
    },
    {
      label: "Proyek",
      value: `${String(spk.project_code)} - ${String(spk.project_name)}`,
    },
    { label: "Lokasi pekerjaan", value: String(spk.location) },
    {
      label: "Periode pekerjaan",
      value: spk.start_date || spk.end_date
        ? dateRange(spk.start_date, spk.end_date)
        : "Dikoordinasikan bersama Project Manager",
    },
    { label: "Nilai pekerjaan", value: rupiah(spk.cost) },
  ]);
  y = drawSectionTitle(context, y, "Lingkup Pekerjaan");
  y = drawCallout(
    context,
    y,
    "Instruksi kerja",
    String(spk.scope),
    "teal",
  );
  y = drawTotals(context, y, [
    {
      label: "Nilai pekerjaan disepakati",
      value: rupiah(spk.cost),
      highlight: true,
    },
  ]);
  y = drawSectionTitle(
    context,
    y,
    "Ketentuan Pelaksanaan",
    "Standar minimum pekerjaan vendor",
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: "Ketentuan", width: 170 },
    ],
    [
      [
        1,
        "Pelaksana wajib mengikuti spesifikasi teknis, jadwal, dan arahan Project Manager PerumNet Enterprise.",
      ],
      [
        2,
        "Perubahan lingkup atau biaya harus memperoleh persetujuan tertulis sebelum dikerjakan.",
      ],
      [
        3,
        "Pelaksana bertanggung jawab atas mutu pekerjaan, keselamatan kerja, kerapian area, dan dokumentasi hasil.",
      ],
      [
        4,
        "Penyelesaian pekerjaan diverifikasi melalui pemeriksaan lapangan dan dokumen serah terima.",
      ],
    ],
  );
  y = drawSectionTitle(context, y, "Persetujuan Para Pihak");
  drawSignaturePair(
    context,
    y,
    {
      heading: "Pemberi kerja",
      name: "PerumNet Enterprise",
      role: "Project Manager / Authorized Representative",
    },
    {
      heading: "Pelaksana",
      name: String(spk.vendor_name),
      role: "Nama, jabatan, dan tanda tangan",
    },
  );
  return response(context, `${String(spk.number).replaceAll("/", "-")}.pdf`);
}

async function bastPdf(bastId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT b.*,p.code AS project_code,p.name AS project_name,p.client,p.location FROM basts b JOIN projects p ON p.id=b.project_id WHERE b.id=? LIMIT 1",
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
    title: "Berita Acara Serah Terima",
    number: String(bast.number),
    status: String(bast.status),
    subject: `Serah terima ${String(bast.project_name)}`,
  });
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    {
      label: "Proyek",
      value: `${String(bast.project_code)} - ${String(bast.project_name)}`,
    },
    { label: "Pihak klien", value: String(bast.client) },
    { label: "Lokasi pekerjaan", value: String(bast.location) },
    { label: "Tanggal serah terima", value: displayDate(bast.completion_date) },
  ]);
  y = drawCallout(
    context,
    y,
    "Pernyataan serah terima",
    "Para pihak menerangkan bahwa pekerjaan berikut telah diselesaikan, diperiksa, dan diserahterimakan dalam kondisi baik sesuai ruang lingkup yang disepakati.",
    "teal",
  );
  y = drawSectionTitle(
    context,
    y,
    "Hasil Pekerjaan",
    "Item terpasang dan telah diverifikasi",
  );
  y = drawTable(
    context,
    y,
    [
      { title: "No.", width: 12, align: "center" },
      { title: "Item / Pekerjaan", width: 83 },
      { title: "Jumlah", width: 32, align: "center" },
      { title: "Status", width: 55 },
    ],
    items.map((item, index) => [
      index + 1,
      item.name,
      item.quantity,
      item.status,
    ]),
  );
  y = drawCallout(
    context,
    y,
    "Catatan serah terima",
    String(bast.notes),
  );
  y = drawSectionTitle(
    context,
    y,
    "Tanda Tangan",
    "Persetujuan tersimpan sebagai bagian dari dokumen BAST",
  );
  drawSignaturePair(
    context,
    y,
    {
      heading: "Pihak klien",
      name: String(bast.client_name),
      role: String(bast.client_role),
      signature: bast.client_signature,
    },
    {
      heading: "Pihak PerumNet",
      name: String(bast.engineer_name),
      role: String(bast.engineer_role ?? "Project Manager"),
      signature: bast.engineer_signature,
    },
  );
  return response(context, `${String(bast.number).replaceAll("/", "-")}.pdf`);
}

function generatedDate() {
  return new Intl.DateTimeFormat("id-ID", {
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
) {
  const sortedDates = entries
    .map((entry) => entry.dateIso)
    .filter(Boolean)
    .sort();
  const period =
    sortedDates.length > 0
      ? `${displayDate(sortedDates[0])} s.d. ${displayDate(sortedDates.at(-1))}`
      : "Belum ada transaksi";
  const reportDate = localIsoDate();
  const income = entries
    .filter((entry) => entry.type === "Pemasukan")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const expense = entries
    .filter((entry) => entry.type === "Pengeluaran")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const profit = income - expense;
  const context = await createDocument({
    title: "Laporan Keuangan",
    number: `FIN/${reportDate.replaceAll("-", "")}`,
    status: "Generated",
    subject: `Laporan keuangan ${scopeLabel}`,
  });
  let y = BODY_TOP;
  y = drawInfoGrid(context, y, [
    { label: "Ruang lingkup", value: scopeLabel },
    { label: "Periode transaksi", value: period },
    { label: "Jumlah transaksi", value: `${entries.length} transaksi` },
    { label: "Tanggal laporan", value: generatedDate() },
  ]);
  y = drawMetricCards(context, y, [
    { label: "Total pemasukan", value: rupiah(income), tone: "income" },
    { label: "Total pengeluaran", value: rupiah(expense), tone: "expense" },
    { label: "Laba bersih", value: rupiah(profit), tone: "profit" },
  ]);

  if (!entries.length) {
    drawCallout(
      context,
      y,
      "Belum ada data",
      "Tidak ada transaksi yang dapat ditampilkan untuk ruang lingkup laporan ini.",
      "warning",
    );
    return response(
      context,
      `Laporan-Keuangan-PerumNet-${reportDate}.pdf`,
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
    "Arus Kas Bulanan",
    "Perbandingan pemasukan dan pengeluaran",
  );
  y = drawTable(
    context,
    y,
    [
      { title: "Periode", width: 50 },
      { title: "Pemasukan", width: 44, align: "right" },
      { title: "Pengeluaran", width: 44, align: "right" },
      { title: "Arus Bersih", width: 44, align: "right" },
    ],
    Array.from(monthly.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, value]) => [
        new Intl.DateTimeFormat("id-ID", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${month}-01T00:00:00.000Z`)),
        rupiah(value.income),
        rupiah(value.expense),
        rupiah(value.income - value.expense),
      ]),
  );

  y = drawSectionTitle(
    context,
    y,
    "Profitabilitas Proyek",
    "Ringkasan berdasarkan transaksi yang tercatat",
  );
  y = drawTable(
    context,
    y,
    [
      { title: "Proyek", width: 74 },
      { title: "Pemasukan", width: 36, align: "right" },
      { title: "Pengeluaran", width: 36, align: "right" },
      { title: "Laba / Rugi", width: 36, align: "right" },
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
        rupiah(value.income),
        rupiah(value.expense),
        rupiah(value.income - value.expense),
      ]),
  );

  y = drawSectionTitle(
    context,
    y,
    "Buku Kas",
    "Rincian seluruh transaksi dalam laporan",
  );
  drawTable(
    context,
    y,
    [
      { title: "Tanggal", width: 25 },
      { title: "Jenis", width: 25 },
      { title: "Proyek", width: 43 },
      { title: "Deskripsi / Sumber", width: 53 },
      { title: "Nominal", width: 36, align: "right" },
    ],
    entries.map((entry) => [
      entry.date,
      entry.type,
      entry.project,
      `${entry.description}\n${entry.source}`,
      rupiah(entry.amount),
    ]),
  );

  return response(
    context,
    `Laporan-Keuangan-PerumNet-${reportDate}.pdf`,
  );
}

export async function renderBusinessPdf(kind: PdfKind, id: string) {
  if (kind === "quotation") return quotationPdf(id);
  if (kind === "invoice") return invoicePdf(id);
  if (kind === "spk") return spkPdf(id);
  return bastPdf(id);
}
