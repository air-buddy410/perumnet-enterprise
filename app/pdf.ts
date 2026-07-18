import { formatCurrency } from "./data";

type DocumentLine = {
  label?: string;
  value: string;
  emphasis?: boolean;
};

export async function downloadDocument(
  title: string,
  number: string,
  lines: DocumentLine[],
  filename: string,
) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();

  pdf.setFillColor(4, 169, 159);
  pdf.rect(0, 0, pageWidth, 18, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("PERUMNET ENTERPRISE", 15, 11.5);

  pdf.setTextColor(49, 80, 94);
  pdf.setFontSize(20);
  pdf.text(title.toUpperCase(), 15, 33);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(105, 121, 124);
  pdf.text(number, 15, 40);
  pdf.setDrawColor(218, 231, 228);
  pdf.line(15, 46, pageWidth - 15, 46);

  let y = 56;
  lines.forEach((line) => {
    if (y > 270) {
      pdf.addPage();
      y = 24;
    }

    if (line.label) {
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(105, 121, 124);
      pdf.setFontSize(9);
      pdf.text(line.label, 15, y);
      pdf.setTextColor(37, 57, 65);
      pdf.setFont("helvetica", line.emphasis ? "bold" : "normal");
      pdf.setFontSize(line.emphasis ? 11 : 10);
      const wrapped = pdf.splitTextToSize(line.value, pageWidth - 78);
      pdf.text(wrapped, 66, y);
      y += Math.max(8, wrapped.length * 5.5);
    } else {
      pdf.setFont("helvetica", line.emphasis ? "bold" : "normal");
      pdf.setTextColor(37, 57, 65);
      pdf.setFontSize(line.emphasis ? 11 : 10);
      const wrapped = pdf.splitTextToSize(line.value, pageWidth - 30);
      pdf.text(wrapped, 15, y);
      y += Math.max(8, wrapped.length * 5.5);
    }
  });

  pdf.setDrawColor(218, 231, 228);
  pdf.line(15, 282, pageWidth - 15, 282);
  pdf.setTextColor(125, 139, 141);
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.text("PerumNet Enterprise · Konsultan IT & Managed Services", 15, 288);
  pdf.text(`Dibuat ${new Date().toLocaleDateString("id-ID")}`, pageWidth - 15, 288, {
    align: "right",
  });
  pdf.save(filename);
}

export function currencyLine(label: string, value: number, emphasis = false): DocumentLine {
  return { label, value: formatCurrency(value), emphasis };
}
