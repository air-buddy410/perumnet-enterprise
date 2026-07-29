import "server-only";

import { jsPDF } from "jspdf";

export interface TaxReportRow {
  project: string;
  document: string;
  rule: string;
  direction: string;
  amount: number;
  settled: number;
  outstanding: number;
  status: string;
  dueDate?: string;
}

function money(value: number, language: "id" | "en") {
  return new Intl.NumberFormat(language === "id" ? "id-ID" : "en-US", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function clean(value: unknown) {
  return String(value ?? "-")
    .replace(/[–—−]/g, "-")
    .replace(/[^\x20-\x7EÀ-ÿ]/g, "");
}

export function renderTaxReportPdf(
  rows: TaxReportRow[],
  language: "id" | "en",
) {
  const en = language === "en";
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const payable = rows
    .filter((row) => row.direction === "Payable")
    .reduce((sum, row) => sum + row.outstanding, 0);
  const receivable = rows
    .filter((row) => row.direction === "Receivable")
    .reduce((sum, row) => sum + row.outstanding, 0);
  let page = 1;
  let y = 0;

  function header() {
    doc.setFillColor(31, 70, 84);
    doc.rect(0, 0, 210, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("PERUMNET ENTERPRISE", 14, 13);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(en ? "TAX POSITION REPORT" : "LAPORAN POSISI PAJAK", 14, 21);
    doc.setTextColor(40, 58, 67);
    y = 39;
  }

  function footer() {
    doc.setDrawColor(218, 229, 228);
    doc.line(14, 286, 196, 286);
    doc.setTextColor(105, 121, 128);
    doc.setFontSize(7.5);
    doc.text(
      en
        ? "Operational record - final tax treatment is determined by Admin/Finance."
        : "Catatan operasional - perlakuan pajak akhir ditentukan Admin/Finance.",
      14,
      291,
    );
    doc.text(String(page), 196, 291, { align: "right" });
  }

  function nextPage(required = 14) {
    if (y + required <= 278) return;
    footer();
    doc.addPage();
    page += 1;
    header();
  }

  header();
  doc.setFillColor(233, 248, 246);
  doc.roundedRect(14, y, 87, 25, 3, 3, "F");
  doc.roundedRect(109, y, 87, 25, 3, 3, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(91, 113, 121);
  doc.text(en ? "OUTSTANDING PAYABLE" : "UTANG PAJAK", 19, y + 8);
  doc.text(en ? "RECEIVABLE / CREDIT" : "PIUTANG / KREDIT PAJAK", 114, y + 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(31, 70, 84);
  doc.text(money(payable, language), 19, y + 18);
  doc.text(money(receivable, language), 114, y + 18);
  y += 34;

  const widths = [28, 29, 24, 25, 27, 27, 22];
  const headers = en
    ? ["Project", "Document", "Tax", "Position", "Amount", "Outstanding", "Status"]
    : ["Proyek", "Dokumen", "Pajak", "Posisi", "Nilai", "Outstanding", "Status"];

  function tableHeader() {
    doc.setFillColor(31, 70, 84);
    doc.rect(14, y, 182, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    let x = 15;
    headers.forEach((headerText, index) => {
      doc.text(headerText, x, y + 5.2);
      x += widths[index];
    });
    y += 8;
  }

  tableHeader();
  for (const row of rows) {
    nextPage(13);
    if (y === 39) tableHeader();
    const cells = [
      row.project,
      row.document,
      row.rule,
      row.direction === "Payable"
        ? en
          ? "Payable"
          : "Utang"
        : en
          ? "Receivable"
          : "Piutang",
      money(row.amount, language),
      money(row.outstanding, language),
      row.status,
    ];
    const lines = cells.map((cell, index) =>
      doc.splitTextToSize(clean(cell), widths[index] - 3),
    );
    const height = Math.max(10, ...lines.map((line) => line.length * 3.2 + 3));
    nextPage(height);
    if (y === 39) tableHeader();
    doc.setFillColor(rows.indexOf(row) % 2 ? 248 : 255, 250, 250);
    doc.rect(14, y, 182, height, "F");
    doc.setDrawColor(226, 234, 234);
    doc.line(14, y + height, 196, y + height);
    doc.setTextColor(42, 61, 69);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    let x = 15;
    lines.forEach((line, index) => {
      doc.text(line, x, y + 4.5);
      x += widths[index];
    });
    y += height;
  }
  if (!rows.length) {
    doc.setTextColor(105, 121, 128);
    doc.text(en ? "No tax positions recorded." : "Belum ada posisi pajak.", 14, y + 10);
  }
  footer();
  return new Response(Buffer.from(doc.output("arraybuffer")), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${en ? "PerumNet-Tax-Report" : "Laporan-Pajak-PerumNet"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

