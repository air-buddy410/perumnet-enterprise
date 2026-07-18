import "server-only";

import { jsPDF } from "jspdf";
import { ApiError } from "./errors";
import { getDatabase } from "../db/client";
import { asNumber, formatDate, parseJson } from "../format";

type PdfKind = "quotation" | "invoice" | "spk" | "bast";
type Line = { label?: string; value: string; emphasis?: boolean };

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function header(doc: jsPDF, title: string, number: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(4, 169, 159);
  doc.rect(0, 0, pageWidth, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("PERUMNET ENTERPRISE", 15, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Konsultan IT & Managed Services", 15, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title.toUpperCase(), pageWidth - 15, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(number, pageWidth - 15, 20, { align: "right" });
  doc.setTextColor(37, 57, 65);
}

function writeLines(doc: jsPDF, lines: Line[], startY = 42) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;
  for (const line of lines) {
    const valueLines = doc.splitTextToSize(line.value, line.label ? 125 : pageWidth - 30);
    if (y + valueLines.length * 6 > 275) {
      doc.addPage();
      y = 20;
    }
    if (line.label) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(105, 121, 124);
      doc.setFontSize(9);
      doc.text(line.label, 15, y);
      doc.setTextColor(37, 57, 65);
      doc.setFont("helvetica", line.emphasis ? "bold" : "normal");
      doc.text(valueLines, 67, y);
    } else {
      doc.setFont("helvetica", line.emphasis ? "bold" : "normal");
      doc.setTextColor(37, 57, 65);
      doc.text(valueLines, 15, y);
    }
    y += Math.max(8, valueLines.length * 5 + 3);
    doc.setDrawColor(224, 233, 231);
    doc.line(15, y - 3, pageWidth - 15, y - 3);
  }
  return y;
}

function response(doc: jsPDF, filename: string) {
  const bytes = new Uint8Array(doc.output("arraybuffer"));
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
  if (!project) throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  const itemResult = await client.execute({
    sql: "SELECT i.* FROM boq_items i JOIN boqs b ON b.id=i.boq_id WHERE b.project_id=? ORDER BY i.sort_order",
    args: [projectId],
  });
  if (!itemResult.rows.length) throw new ApiError(409, "EMPTY_BOQ", "BoQ belum memiliki item.");
  const total = itemResult.rows.reduce(
    (sum, item) => sum + asNumber(item.quantity) * asNumber(item.selling_price),
    0,
  );
  const quotationResult = await client.execute({
    sql: "SELECT number,issued_at,valid_until,total FROM quotations WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
    args: [projectId],
  });
  const quotation = quotationResult.rows[0];
  const number = quotation
    ? String(quotation.number)
    : `QUO/${String(project.code).replace("PN-", "")}`;
  const doc = new jsPDF();
  header(doc, "Quotation", number);
  let y = writeLines(doc, [
    { label: "Proyek", value: String(project.name), emphasis: true },
    { label: "Klien", value: String(project.client) },
    { label: "Lokasi", value: String(project.location) },
    {
      label: "Tanggal terbit",
      value: formatDate(quotation?.issued_at ?? project.created_at),
    },
    {
      label: "Berlaku sampai",
      value: formatDate(quotation?.valid_until ?? project.target_date),
    },
  ]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Rincian Penawaran", 15, y + 5);
  y += 13;
  itemResult.rows.forEach((item, index) => {
    const subtotal = asNumber(item.quantity) * asNumber(item.selling_price);
    doc.setFont("helvetica", "bold");
    doc.text(`${index + 1}. ${String(item.description)}`, 15, y);
    doc.setFont("helvetica", "normal");
    doc.text(
      `${asNumber(item.quantity)} ${String(item.unit)} × ${rupiah.format(asNumber(item.selling_price))}`,
      15,
      y + 5,
    );
    doc.setFont("helvetica", "bold");
    doc.text(rupiah.format(subtotal), 195, y + 5, { align: "right" });
    y += 14;
    if (y > 265) {
      doc.addPage();
      y = 20;
    }
  });
  doc.setFillColor(237, 248, 246);
  doc.roundedRect(110, y, 85, 18, 2, 2, "F");
  doc.setTextColor(4, 125, 119);
  doc.text("TOTAL PENAWARAN", 116, y + 7);
  doc.setFontSize(12);
  doc.text(rupiah.format(total), 189, y + 14, { align: "right" });
  return response(doc, `${number.replaceAll("/", "-")}.pdf`);
}

async function invoicePdf(invoiceId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT i.*,p.name AS project_name,p.client,p.location FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.id=? LIMIT 1",
    args: [invoiceId],
  });
  const invoice = result.rows[0];
  if (!invoice) throw new ApiError(404, "NOT_FOUND", "Invoice tidak ditemukan.");
  const doc = new jsPDF();
  header(doc, "Invoice", String(invoice.number));
  writeLines(doc, [
    { label: "Ditagihkan kepada", value: String(invoice.client), emphasis: true },
    { label: "Proyek", value: String(invoice.project_name) },
    { label: "Lokasi", value: String(invoice.location) },
    { label: "Jenis tagihan", value: String(invoice.type) },
    { label: "Tanggal terbit", value: formatDate(invoice.issue_date) },
    { label: "Jatuh tempo", value: formatDate(invoice.due_date) },
    { label: "Status", value: String(invoice.status) },
    { label: "Jumlah tagihan", value: rupiah.format(asNumber(invoice.amount)), emphasis: true },
    { value: "Pembayaran dianggap sah setelah dana diterima dan dikonfirmasi oleh bagian Finance PerumNet Enterprise." },
  ]);
  return response(doc, `${String(invoice.number).replaceAll("/", "-")}.pdf`);
}

async function spkPdf(spkId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT s.*,v.name AS vendor_name,v.contact,p.name AS project_name,p.location FROM spks s JOIN vendors v ON v.id=s.vendor_id JOIN projects p ON p.id=s.project_id WHERE s.id=? LIMIT 1",
    args: [spkId],
  });
  const spk = result.rows[0];
  if (!spk) throw new ApiError(404, "NOT_FOUND", "SPK tidak ditemukan.");
  const doc = new jsPDF();
  header(doc, "Surat Perintah Kerja", String(spk.number));
  writeLines(doc, [
    { label: "Vendor / pelaksana", value: String(spk.vendor_name), emphasis: true },
    { label: "Kontak", value: String(spk.contact) },
    { label: "Proyek", value: String(spk.project_name) },
    { label: "Lokasi", value: String(spk.location) },
    { label: "Lingkup kerja", value: String(spk.scope) },
    { label: "Biaya disepakati", value: rupiah.format(asNumber(spk.cost)), emphasis: true },
    { label: "Status", value: String(spk.status) },
    { value: "Pihak pelaksana wajib menyelesaikan pekerjaan sesuai spesifikasi, jadwal, standar mutu, dan keselamatan kerja PerumNet Enterprise." },
  ]);
  return response(doc, `${String(spk.number).replaceAll("/", "-")}.pdf`);
}

async function bastPdf(bastId: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT b.*,p.name AS project_name,p.client,p.location FROM basts b JOIN projects p ON p.id=b.project_id WHERE b.id=? LIMIT 1",
    args: [bastId],
  });
  const bast = result.rows[0];
  if (!bast) throw new ApiError(404, "NOT_FOUND", "BAST tidak ditemukan.");
  const items = parseJson<Array<{ name: string; quantity: string; status: string }>>(
    bast.installed_items_json,
    [],
  );
  const doc = new jsPDF();
  header(doc, "Berita Acara Serah Terima", String(bast.number));
  let y = writeLines(doc, [
    { label: "Proyek", value: String(bast.project_name), emphasis: true },
    { label: "Klien", value: String(bast.client) },
    { label: "Lokasi", value: String(bast.location) },
    { label: "Tanggal selesai", value: formatDate(bast.completion_date) },
    { label: "Catatan", value: String(bast.notes) },
  ]);
  doc.setFont("helvetica", "bold");
  doc.text("Item terpasang dan terverifikasi", 15, y + 5);
  y += 12;
  for (const [index, item] of items.entries()) {
    doc.setFont("helvetica", "normal");
    doc.text(`${index + 1}. ${item.name}`, 15, y);
    doc.text(`${item.quantity} · ${item.status}`, 195, y, { align: "right" });
    y += 7;
  }
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.text("Pihak Klien", 15, y);
  doc.text("Pihak PerumNet", 112, y);
  try {
    if (bast.client_signature) doc.addImage(String(bast.client_signature), "PNG", 15, y + 4, 65, 24);
    if (bast.engineer_signature) doc.addImage(String(bast.engineer_signature), "PNG", 112, y + 4, 65, 24);
  } catch {
    // An invalid or unsupported signature never prevents the BAST text from being exported.
  }
  doc.setDrawColor(150, 163, 164);
  doc.line(15, y + 31, 80, y + 31);
  doc.line(112, y + 31, 177, y + 31);
  doc.text(String(bast.client_name), 15, y + 38);
  doc.text(String(bast.engineer_name), 112, y + 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(String(bast.client_role), 15, y + 44);
  doc.text(String(bast.engineer_role ?? "Project Manager"), 112, y + 44);
  return response(doc, `${String(bast.number).replaceAll("/", "-")}.pdf`);
}

export async function renderBusinessPdf(kind: PdfKind, id: string) {
  if (kind === "quotation") return quotationPdf(id);
  if (kind === "invoice") return invoicePdf(id);
  if (kind === "spk") return spkPdf(id);
  return bastPdf(id);
}
