import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import type { AuthUser } from "../auth";
import { renderAlurPng, type GambarAlur } from "./alur-png";
import { ApiError } from "./errors";
import type { Bilingual, Block, CalcRow, Chapter, MetaRow } from "./sop-pdf-content";
import { guideChapters } from "./sop-pdf-content";

type Language = "id" | "en";

// Bumped whenever the manual's structure or coverage changes, so a printed copy
// can be compared against the edition currently shipping.
const GUIDE_EDITION = "2.1";

// Colours reuse the existing PerumNet document palette so the guide sits next to
// the quotation, invoice, and handover PDFs without looking foreign.
const INK: [number, number, number] = [37, 75, 91];
const ACCENT: [number, number, number] = [63, 190, 184];
const BODY: [number, number, number] = [45, 63, 71];
const MUTED: [number, number, number] = [104, 124, 132];
const RULE: [number, number, number] = [214, 229, 228];
const SOFT_TEAL: [number, number, number] = [231, 248, 246];
const DEEP_TEAL: [number, number, number] = [18, 118, 113];
const SOFT_AMBER: [number, number, number] = [250, 247, 232];
const AMBER_INK: [number, number, number] = [135, 99, 25];
const SOFT_GREY: [number, number, number] = [243, 247, 247];
const WHITE: [number, number, number] = [255, 255, 255];

const MARGIN = 16;
const HEADER_HEIGHT = 31;
const BODY_SIZE = 8.6;
const BODY_LH = 4.15;
const SMALL_SIZE = 7.8;
const SMALL_LH = 3.65;

function pick(language: Language, value: Bilingual) {
  return language === "en" ? value[1] : value[0];
}

function formatAmount(value: number, language: Language) {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, language === "en" ? "," : ".");
  return `${sign}Rp ${digits}`;
}

// Every other PerumNet document dates itself in Asia/Makassar (server/format.ts,
// server/api/pdf.ts). Reading the host clock instead printed yesterday's date
// for the whole 16:00-24:00 UTC window, and production runs on a UTC host.
const makassarParts = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: "Asia/Makassar",
});

function formatToday(language: Language) {
  const parts = Object.fromEntries(
    makassarParts.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const months =
    language === "en"
      ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
      : ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${Number(parts.day)} ${months[Number(parts.month) - 1]} ${parts.year}`;
}

async function logoData() {
  try {
    const logo = await readFile(join(process.cwd(), "public", "perumnet-mark.png"));
    return `data:image/png;base64,${logo.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * Lays the whole guide out in a single pass.
 *
 * The table of contents is printed before any chapter exists, so its page
 * numbers cannot be known while its rows are laid out. Each row therefore
 * reserves the space its number will occupy — a fixed width measured from
 * "000", which does not depend on the digits — and remembers where that space
 * is; the real number is painted into it once every chapter has landed. The
 * footers are written the same way, which is what makes "Page X of Y" possible:
 * Y is only known at the end. The guide used to be built twice, the first copy
 * discarded purely to learn the chapter pages, on an endpoint with no cache and
 * no rate limit.
 */
function buildGuide(
  language: Language,
  logo: string | undefined,
  images: { alur?: GambarAlur } = {},
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const content = width - MARGIN * 2;
  const bottom = height - 18;
  const starts = new Map<string, number>();
  // Where each contents row left room for its page number, filled in below.
  const tocSlots = new Map<string, { page: number; x: number; y: number }>();
  const en = language === "en";
  let page = 1;
  let y = 0;

  function fill(colour: [number, number, number]) {
    doc.setFillColor(colour[0], colour[1], colour[2]);
  }
  function stroke(colour: [number, number, number]) {
    doc.setDrawColor(colour[0], colour[1], colour[2]);
  }
  function ink(colour: [number, number, number]) {
    doc.setTextColor(colour[0], colour[1], colour[2]);
  }
  function font(style: "normal" | "bold" | "italic", size: number) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
  }
  // jsPDF measures against whatever font is currently selected, so every caller
  // must set the font before wrapping. Taking the style and size here makes that
  // impossible to forget: text wrapped for 7pt but drawn at 9pt runs off the page.
  function wrap(
    text: string,
    available: number,
    style: "normal" | "bold" | "italic",
    size: number,
  ) {
    font(style, size);
    // jsPDF's own metrics run marginally narrower than the rendered glyphs, so a
    // line wrapped to exactly the column width can end up a hair past it. Hold
    // back 1.5mm; it is invisible on the page and keeps every line inside the
    // margin on a real printer.
    return doc.splitTextToSize(text, Math.max(6, available - 1.5)) as string[];
  }

  function header() {
    fill(INK);
    doc.rect(0, 0, width, HEADER_HEIGHT, "F");
    fill(ACCENT);
    doc.rect(0, HEADER_HEIGHT, width, 2.2, "F");
    if (logo) doc.addImage(logo, "PNG", MARGIN, 7, 17, 17);
    ink(WHITE);
    font("bold", 12);
    doc.text("PERUMNET ENTERPRISE", MARGIN + 23, 14);
    font("normal", 8.2);
    doc.text(
      en ? "OPERATIONS MANUAL" : "PANDUAN OPERASIONAL",
      MARGIN + 23,
      19.8,
    );
    font("normal", 7.4);
    doc.text(
      `${en ? "Edition" : "Edisi"} ${GUIDE_EDITION}`,
      width - MARGIN,
      19.8,
      { align: "right" },
    );
    y = 42;
  }

  /**
   * Written after the whole guide is laid out, because the total is only known
   * then. A reader holding a printed copy has to be able to tell that pages are
   * missing, and this document is explicitly aimed at auditors. The cover
   * (page 1) carries no footer.
   */
  function applyFooters(totalPages: number) {
    for (let current = 2; current <= totalPages; current += 1) {
      doc.setPage(current);
      stroke(RULE);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, height - 12, width - MARGIN, height - 12);
      font("normal", 7.2);
      ink(MUTED);
      // Internal support, not the client-facing company address: this manual is
      // read by staff, and a staff member who is stuck should reach IT.
      doc.text("it@perumnet.id", MARGIN, height - 7.6);
      doc.text(
        en
          ? `Page ${current} of ${totalPages}`
          : `Halaman ${current} dari ${totalPages}`,
        width - MARGIN,
        height - 7.6,
        { align: "right" },
      );
    }
  }

  function newPage() {
    doc.addPage("a4", "portrait");
    page += 1;
    header();
  }

  function ensure(space: number) {
    if (y + space > bottom) newPage();
  }

  function paragraph(
    text: string,
    options: {
      size?: number;
      lh?: number;
      style?: "normal" | "bold" | "italic";
      colour?: [number, number, number];
      indent?: number;
      gap?: number;
    } = {},
  ) {
    const size = options.size ?? BODY_SIZE;
    const lh = options.lh ?? BODY_LH;
    const indent = options.indent ?? 0;
    const style = options.style ?? "normal";
    const lines = wrap(text, content - indent, style, size);
    for (const line of lines) {
      ensure(lh);
      // A page break in the middle of a paragraph redraws the page header,
      // which leaves its own font selected, so restate ours on every line.
      font(style, size);
      ink(options.colour ?? BODY);
      doc.text(line, MARGIN + indent, y);
      y += lh;
    }
    y += options.gap ?? 2;
  }

  // ---------------------------------------------------------------- cover ---

  function cover() {
    fill(INK);
    doc.rect(0, 0, width, 118, "F");
    fill(ACCENT);
    doc.rect(0, 118, width, 3, "F");
    if (logo) doc.addImage(logo, "PNG", MARGIN, 22, 24, 24);
    ink(WHITE);
    font("bold", 13);
    doc.text("PERUMNET ENTERPRISE", MARGIN + 31, 33);
    font("normal", 8.6);
    ink([176, 216, 214]);
    doc.text(
      en ? "Business operations platform" : "Platform operasional bisnis",
      MARGIN + 31,
      39.5,
    );

    ink(WHITE);
    font("bold", 25);
    const title = wrap(
      en ? "Operations Manual" : "Panduan Operasional",
      content,
      "bold",
      25,
    );
    let titleY = 68;
    for (const line of title) {
      doc.text(line, MARGIN, titleY);
      titleY += 11;
    }
    font("normal", 12);
    ink([176, 216, 214]);
    doc.text(
      en
        ? "Projects, quotations, invoices, procurement, handover, and finance"
        : "Proyek, penawaran, invoice, procurement, serah terima, dan keuangan",
      MARGIN,
      titleY + 2.5,
    );

    y = 134;
    font("bold", 8);
    ink(DEEP_TEAL);
    doc.text(en ? "ABOUT THIS DOCUMENT" : "TENTANG DOKUMEN INI", MARGIN, y);
    y += 6.5;
    paragraph(
      en
        ? "This manual is the full operational reference for PerumNet Enterprise. It explains, step by step, how a job travels from a project record through its bill of quantity, quotation, client acceptance, installment invoices, vendor commitments, site validation, and handover certificate, and how every one of those steps lands in the company's books. Each chapter names the exact buttons and menus as they appear on screen, states who is allowed to perform the work, what becomes locked afterwards, and which mistakes are most commonly made."
        : "Panduan ini adalah rujukan operasional lengkap untuk PerumNet Enterprise. Isinya menjelaskan langkah demi langkah bagaimana satu pekerjaan berjalan dari catatan proyek, melewati BoQ, penawaran, persetujuan klien, invoice termin, komitmen vendor, validasi lapangan, sampai berita acara serah terima, dan bagaimana setiap langkah itu tercatat dalam pembukuan perusahaan. Setiap bab menyebut nama tombol dan menu persis seperti yang tampil di layar, menjelaskan siapa yang boleh mengerjakannya, apa yang terkunci sesudahnya, dan kesalahan apa yang paling sering terjadi.",
      { gap: 3.5 },
    );
    paragraph(
      en
        ? "It is deliberately more detailed than the in-app Help Center, which is built for quick reference during the working day. Print this manual for onboarding, for a desk copy, or for an auditor who needs to understand how the controls work."
        : "Panduan ini sengaja dibuat lebih rinci daripada Pusat Bantuan di dalam aplikasi, yang memang dirancang sebagai rujukan cepat saat bekerja. Cetak panduan ini untuk pelatihan staf baru, untuk pegangan di meja kerja, atau untuk auditor yang perlu memahami cara kerja pengamannya.",
      { gap: 8 },
    );

    fill(SOFT_TEAL);
    doc.roundedRect(MARGIN, y, content, 26, 3, 3, "F");
    font("bold", 7.6);
    ink(DEEP_TEAL);
    doc.text(en ? "CORE PRINCIPLE" : "PRINSIP UTAMA", MARGIN + 6, y + 7.5);
    font("normal", 8.6);
    ink(BODY);
    const principle = wrap(
      en
        ? "One cash event is recorded only once. A document the client has accepted is never edited, only superseded or extended by an addendum. Every correction leaves a reversing entry rather than erasing history."
        : "Satu kejadian kas hanya dicatat sekali. Dokumen yang sudah diterima klien tidak pernah diedit, hanya digantikan revisi atau ditambah lewat addendum. Setiap koreksi meninggalkan catatan pembalik, bukan menghapus riwayat.",
      content - 12,
      "normal",
      8.6,
    );
    let py = y + 13.5;
    for (const line of principle) {
      doc.text(line, MARGIN + 6, py);
      py += 4.1;
    }
    y += 34;

    stroke(RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, width - MARGIN, y);
    y += 7;
    font("normal", 8);
    ink(MUTED);
    doc.text(
      en
        ? `Edition ${GUIDE_EDITION}  |  Generated on ${formatToday(language)}  |  English edition`
        : `Edisi ${GUIDE_EDITION}  |  Dibuat pada ${formatToday(language)}  |  Edisi Bahasa Indonesia`,
      MARGIN,
      y,
    );
    y += 5;
    doc.text(
      en
        ? "Generated directly by the application, so it always describes the version currently running."
        : "Dihasilkan langsung oleh aplikasi, sehingga selalu menggambarkan versi yang sedang berjalan.",
      MARGIN,
      y,
    );
  }

  // -------------------------------------------------------------- contents ---

  function tableOfContents() {
    newPage();
    font("bold", 16);
    ink(INK);
    doc.text(en ? "Contents" : "Daftar isi", MARGIN, y);
    y += 8;
    paragraph(
      en
        ? "Chapters 1 and 2 explain who may do what and how the whole chain fits together — chapter 2 opens with the flow chart. Chapters 3 to 16 are the day-to-day workflows, in the order the work actually happens. Chapters 17 to 21 are reference material."
        : "Bab 1 dan 2 menjelaskan siapa boleh mengerjakan apa dan bagaimana seluruh rantai kerja tersusun — bab 2 dibuka dengan bagan alurnya. Bab 3 sampai 16 adalah alur kerja sehari-hari, disusun mengikuti urutan pekerjaan sesungguhnya. Bab 17 sampai 21 adalah bahan rujukan.",
      { size: SMALL_SIZE, lh: SMALL_LH, colour: MUTED, gap: 5 },
    );

    guideChapters.forEach((chapter, index) => {
      const number = `${index + 1}.`;
      font("normal", 9);
      const numberWidth = 8;
      const pageWidth = doc.getTextWidth("000") + 2;
      const titleWidth = content - numberWidth - pageWidth - 4;
      const lines = wrap(pick(language, chapter.title), titleWidth, "normal", 9);
      ensure(lines.length * 4.6 + 2.4);
      const rowTop = y;
      ink(ACCENT);
      font("bold", 9);
      doc.text(number, MARGIN, rowTop);
      ink(INK);
      font("normal", 9);
      lines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + numberWidth, rowTop + lineIndex * 4.6);
      });
      const lastLine = rowTop + (lines.length - 1) * 4.6;
      const titleEnd =
        MARGIN + numberWidth + doc.getTextWidth(lines[lines.length - 1]) + 2;
      const dotsEnd = width - MARGIN - pageWidth;
      if (dotsEnd > titleEnd) {
        stroke(RULE);
        doc.setLineWidth(0.25);
        doc.setLineDashPattern([0.5, 1.1], 0);
        doc.line(titleEnd, lastLine - 1.1, dotsEnd, lastLine - 1.1);
        doc.setLineDashPattern([], 0);
      }
      // The digits themselves land in `fillContents`, once the chapters have
      // been laid out and their real page numbers are known.
      tocSlots.set(chapter.id, { page, x: width - MARGIN, y: lastLine });
      y = lastLine + 4.6 + 2.4;
    });
  }

  function fillContents() {
    for (const [chapterId, slot] of tocSlots) {
      const target = starts.get(chapterId);
      doc.setPage(slot.page);
      font("bold", 9);
      ink(INK);
      doc.text(target ? String(target) : "--", slot.x, slot.y, {
        align: "right",
      });
    }
  }

  // ---------------------------------------------------------------- blocks ---

  function chapterHeading(index: number, chapter: Chapter) {
    // Every chapter opens a page so the printed manual can be split and shared
    // chapter by chapter, and so the contents page numbers stay meaningful.
    newPage();
    starts.set(chapter.id, page);
    fill(SOFT_TEAL);
    doc.circle(MARGIN + 5.4, y - 1.4, 5.4, "F");
    font("bold", 11);
    ink(DEEP_TEAL);
    doc.text(String(index + 1), MARGIN + 5.4, y + 0.6, { align: "center" });
    font("bold", 15.5);
    ink(INK);
    const lines = wrap(pick(language, chapter.title), content - 15, "bold", 15.5);
    lines.forEach((line, lineIndex) => {
      doc.text(line, MARGIN + 14, y + lineIndex * 7);
    });
    y += (lines.length - 1) * 7 + 7;
    fill(ACCENT);
    doc.rect(MARGIN, y - 1.5, 26, 1.2, "F");
    y += 6;
  }

  function metaBlock(rows: MetaRow[], labelWidth: number, banded: boolean) {
    for (const row of rows) {
      const valueWidth = content - labelWidth - 6;
      const valueLines = wrap(
        pick(language, row.value),
        valueWidth,
        "normal",
        BODY_SIZE,
      );
      const labelLines = wrap(
        pick(language, row.label),
        labelWidth - 4,
        "bold",
        BODY_SIZE,
      );
      const rowHeight =
        Math.max(valueLines.length, labelLines.length) * BODY_LH + 3.4;
      ensure(rowHeight);
      if (banded) {
        fill(SOFT_GREY);
        doc.rect(MARGIN, y - 3.4, content, rowHeight, "F");
      }
      font("bold", BODY_SIZE);
      ink(INK);
      labelLines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + (banded ? 3 : 0), y + lineIndex * BODY_LH);
      });
      font("normal", BODY_SIZE);
      ink(BODY);
      valueLines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + labelWidth + 3, y + lineIndex * BODY_LH);
      });
      y += rowHeight;
      if (!banded) {
        stroke(RULE);
        doc.setLineWidth(0.15);
        doc.line(MARGIN, y - 2.6, width - MARGIN, y - 2.6);
      } else {
        y += 1.2;
      }
    }
    y += 3;
  }

  function stepsBlock(items: Bilingual[]) {
    items.forEach((item, index) => {
      const lines = wrap(pick(language, item), content - 11, "normal", BODY_SIZE);
      ensure(lines.length * BODY_LH + 3);
      fill(ACCENT);
      doc.circle(MARGIN + 2.6, y - 1.1, 2.6, "F");
      ink(WHITE);
      font("bold", 6.8);
      doc.text(String(index + 1), MARGIN + 2.6, y + 0.2, { align: "center" });
      ink(BODY);
      font("normal", BODY_SIZE);
      lines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + 9, y + lineIndex * BODY_LH);
      });
      y += lines.length * BODY_LH + 2.4;
    });
    y += 2;
  }

  function bulletsBlock(items: Bilingual[], colour: [number, number, number]) {
    for (const item of items) {
      const lines = wrap(pick(language, item), content - 7, "normal", BODY_SIZE);
      ensure(lines.length * BODY_LH + 2.4);
      fill(colour);
      doc.circle(MARGIN + 1.6, y - 1.2, 0.9, "F");
      ink(BODY);
      font("normal", BODY_SIZE);
      lines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + 6, y + lineIndex * BODY_LH);
      });
      y += lines.length * BODY_LH + 1.8;
    }
    y += 2;
  }

  function calloutBlock(
    label: string,
    text: string,
    background: [number, number, number],
    labelColour: [number, number, number],
  ) {
    const lines = wrap(text, content - 12, "normal", BODY_SIZE);
    const boxHeight = lines.length * BODY_LH + 12;
    ensure(boxHeight + 3);
    fill(background);
    doc.roundedRect(MARGIN, y - 3.2, content, boxHeight, 2.2, 2.2, "F");
    fill(labelColour);
    doc.rect(MARGIN, y - 3.2, 1.4, boxHeight, "F");
    font("bold", 7.2);
    ink(labelColour);
    doc.text(label, MARGIN + 6, y + 1.6);
    font("normal", BODY_SIZE);
    ink(BODY);
    lines.forEach((line, lineIndex) => {
      doc.text(line, MARGIN + 6, y + 7.4 + lineIndex * BODY_LH);
    });
    y += boxHeight + 3;
  }

  function tableBlock(
    widths: number[],
    head: Bilingual[],
    rows: Bilingual[][],
  ) {
    const scale = content / widths.reduce((sum, value) => sum + value, 0);
    const columns = widths.map((value) => value * scale);

    function drawHead() {
      const cells = head.map((cell, index) =>
        wrap(pick(language, cell), columns[index] - 4, "bold", SMALL_SIZE),
      );
      const rowHeight =
        Math.max(...cells.map((cell) => cell.length)) * SMALL_LH + 3.6;
      ensure(rowHeight + SMALL_LH * 2);
      fill(INK);
      doc.rect(MARGIN, y - 3.6, content, rowHeight, "F");
      font("bold", SMALL_SIZE);
      ink(WHITE);
      let x = MARGIN;
      cells.forEach((cell, index) => {
        cell.forEach((line, lineIndex) => {
          doc.text(line, x + 2, y + lineIndex * SMALL_LH);
        });
        x += columns[index];
      });
      y += rowHeight;
    }

    drawHead();
    rows.forEach((row, rowIndex) => {
      const cells = row.map((cell, index) =>
        wrap(
          pick(language, cell),
          columns[index] - 4,
          index === 0 ? "bold" : "normal",
          SMALL_SIZE,
        ),
      );
      const rowHeight =
        Math.max(...cells.map((cell) => cell.length)) * SMALL_LH + 3.2;
      if (y + rowHeight > bottom) {
        newPage();
        drawHead();
      }
      if (rowIndex % 2 === 1) {
        fill(SOFT_GREY);
        doc.rect(MARGIN, y - 3.2, content, rowHeight, "F");
      }
      let x = MARGIN;
      cells.forEach((cell, index) => {
        font(index === 0 ? "bold" : "normal", SMALL_SIZE);
        ink(index === 0 ? INK : BODY);
        cell.forEach((line, lineIndex) => {
          doc.text(line, x + 2, y + lineIndex * SMALL_LH);
        });
        x += columns[index];
      });
      y += rowHeight;
    });
    stroke(RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y - 3, width - MARGIN, y - 3);
    y += 4;
  }

  function flowBlock(steps: Bilingual[]) {
    const boxHeight = 9;
    const gap = 5.5;
    const rowGap = 4;
    font("bold", 7);
    // Lay the chain out greedily across as many rows as it needs, so the same
    // code works for either language regardless of how long the labels are.
    const measured = steps.map((step) => {
      const label = pick(language, step);
      return { label, width: Math.max(20, doc.getTextWidth(label) + 7) };
    });
    const rows: Array<Array<{ label: string; width: number }>> = [];
    let current: Array<{ label: string; width: number }> = [];
    let used = 0;
    for (const item of measured) {
      const needed = item.width + (current.length ? gap : 0);
      if (used + needed > content && current.length) {
        rows.push(current);
        current = [];
        used = 0;
      }
      current.push(item);
      used += item.width + (current.length > 1 ? gap : 0);
    }
    if (current.length) rows.push(current);

    ensure(rows.length * (boxHeight + rowGap) + 4);
    for (const row of rows) {
      let x = MARGIN;
      row.forEach((item, index) => {
        if (index > 0) {
          stroke(ACCENT);
          doc.setLineWidth(0.5);
          doc.line(x - gap + 0.8, y + boxHeight / 2, x - 1.9, y + boxHeight / 2);
          fill(ACCENT);
          doc.triangle(
            x - 2.4,
            y + boxHeight / 2 - 1.4,
            x - 2.4,
            y + boxHeight / 2 + 1.4,
            x - 0.4,
            y + boxHeight / 2,
            "F",
          );
        }
        fill(SOFT_TEAL);
        doc.roundedRect(x, y, item.width, boxHeight, 1.8, 1.8, "F");
        font("bold", 7);
        ink(DEEP_TEAL);
        doc.text(item.label, x + item.width / 2, y + boxHeight / 2 + 1.1, {
          align: "center",
        });
        x += item.width + gap;
      });
      y += boxHeight + rowGap;
    }
    y += 2;
  }

  function calcBlock(title: Bilingual, rows: CalcRow[]) {
    ensure(12);
    font("bold", 8.4);
    ink(INK);
    doc.text(pick(language, title), MARGIN, y);
    y += 5.6;
    for (const row of rows) {
      const isTotal = row.tone === "total";
      const isSub = row.tone === "sub";
      const isMuted = row.tone === "muted";
      const rowHeight = isTotal ? 7.4 : 5.6;
      ensure(rowHeight + 1);
      if (isTotal) {
        fill(SOFT_TEAL);
        doc.rect(MARGIN, y - 3.9, content, rowHeight, "F");
      } else if (isSub) {
        fill(SOFT_GREY);
        doc.rect(MARGIN, y - 3.6, content, rowHeight, "F");
      }
      font(isTotal || isSub ? "bold" : "normal", isMuted ? SMALL_SIZE : BODY_SIZE);
      ink(isTotal ? DEEP_TEAL : isMuted ? MUTED : isSub ? INK : BODY);
      const label = pick(language, row.label);
      doc.text(label, MARGIN + (isTotal || isSub ? 3 : 1), y);
      const value =
        row.amount !== undefined
          ? formatAmount(row.amount, language)
          : row.text
            ? pick(language, row.text)
            : "";
      doc.setFont("courier", isTotal || isSub ? "bold" : "normal");
      doc.setFontSize(isMuted ? SMALL_SIZE : BODY_SIZE);
      doc.text(value, width - MARGIN - (isTotal || isSub ? 3 : 1), y, {
        align: "right",
      });
      if (!isTotal && !isSub) {
        stroke(RULE);
        doc.setLineWidth(0.15);
        doc.line(MARGIN, y + 1.5, width - MARGIN, y + 1.5);
      }
      y += rowHeight;
    }
    y += 4;
  }

  function messagesBlock(
    rows: Array<{ message: Bilingual; meaning: Bilingual; action: Bilingual }>,
  ) {
    const inner = content - 10;
    for (const row of rows) {
      const messageLines = wrap(
        `"${pick(language, row.message)}"`,
        inner,
        "bold",
        8.4,
      );
      const meaningLines = wrap(
        `${en ? "What it means: " : "Artinya: "}${pick(language, row.meaning)}`,
        inner,
        "normal",
        SMALL_SIZE,
      );
      const actionLines = wrap(
        `${en ? "What to do: " : "Yang perlu dilakukan: "}${pick(language, row.action)}`,
        inner,
        "normal",
        SMALL_SIZE,
      );
      const boxHeight =
        messageLines.length * 4.3 +
        (meaningLines.length + actionLines.length) * SMALL_LH +
        6.6;
      ensure(boxHeight + 3);
      fill(SOFT_GREY);
      doc.roundedRect(MARGIN, y - 3.6, content, boxHeight, 2, 2, "F");
      fill(AMBER_INK);
      doc.rect(MARGIN, y - 3.6, 1.4, boxHeight, "F");
      let inside = y;
      font("bold", 8.4);
      ink(INK);
      messageLines.forEach((line) => {
        doc.text(line, MARGIN + 5, inside);
        inside += 4.3;
      });
      inside += 1.6;
      font("normal", SMALL_SIZE);
      ink(BODY);
      meaningLines.forEach((line) => {
        doc.text(line, MARGIN + 5, inside);
        inside += SMALL_LH;
      });
      inside += 1.4;
      ink(DEEP_TEAL);
      actionLines.forEach((line) => {
        doc.text(line, MARGIN + 5, inside);
        inside += SMALL_LH;
      });
      y += boxHeight + 3;
    }
  }

  function renderBlock(block: Block) {
    switch (block.kind) {
      case "lead":
        paragraph(pick(language, block.text), {
          size: 9.6,
          lh: 4.6,
          colour: INK,
          gap: 4,
        });
        break;
      case "para":
        paragraph(pick(language, block.text), { gap: 3 });
        break;
      case "heading":
        ensure(11);
        y += 2;
        font("bold", 10.2);
        ink(INK);
        for (const line of wrap(pick(language, block.text), content, "bold", 10.2)) {
          ensure(5.4);
          font("bold", 10.2);
          ink(INK);
          doc.text(line, MARGIN, y);
          y += 5.4;
        }
        y += 2.4;
        break;
      case "meta":
        metaBlock(block.rows, 34, true);
        break;
      case "terms":
        metaBlock(block.rows, 46, false);
        break;
      case "steps":
        stepsBlock(block.items);
        break;
      case "bullets":
        bulletsBlock(block.items, ACCENT);
        break;
      case "pitfalls":
        ensure(9);
        font("bold", 8.4);
        ink(AMBER_INK);
        doc.text(
          en ? "Common mistakes and how to avoid them" : "Kesalahan umum dan cara menghindarinya",
          MARGIN,
          y,
        );
        y += 5.4;
        bulletsBlock(block.items, AMBER_INK);
        break;
      case "locked":
        calloutBlock(
          en ? "WHAT LOCKS AFTERWARDS" : "YANG TERKUNCI SESUDAHNYA",
          pick(language, block.text),
          SOFT_TEAL,
          DEEP_TEAL,
        );
        break;
      case "note":
        calloutBlock(
          pick(language, block.title).toUpperCase(),
          pick(language, block.text),
          SOFT_AMBER,
          AMBER_INK,
        );
        break;
      case "table":
        tableBlock(block.widths, block.head, block.rows);
        break;
      case "flow":
        flowBlock(block.steps);
        break;
      case "image": {
        // Gambar disiapkan sebelum tata letak (renderSopPdf). Kalau rasterisasi
        // gagal, bab tetap tercetak tanpa gambar — rantai teks di bawahnya
        // sudah menceritakan alur yang sama.
        const gambar = images[block.source];
        if (!gambar || !gambar.width || !gambar.height) break;
        const maksTinggi = bottom - MARGIN - 36;
        let lebar = content;
        let tinggi = (gambar.height / gambar.width) * lebar;
        if (tinggi > maksTinggi) {
          tinggi = maksTinggi;
          lebar = (gambar.width / gambar.height) * tinggi;
        }
        ensure(tinggi + 12);
        doc.addImage(
          new Uint8Array(gambar.png),
          "PNG",
          MARGIN + (content - lebar) / 2,
          y,
          lebar,
          tinggi,
        );
        y += tinggi + 3;
        paragraph(pick(language, block.caption), { size: 7.6, lh: 3.6, gap: 5 });
        break;
      }
      case "calc":
        calcBlock(block.title, block.rows);
        break;
      case "messages":
        messagesBlock(block.rows);
        break;
    }
  }

  cover();
  tableOfContents();
  guideChapters.forEach((chapter, index) => {
    chapterHeading(index, chapter);
    for (const block of chapter.blocks) renderBlock(block);
  });
  fillContents();
  applyFooters(doc.getNumberOfPages());

  return doc;
}

export async function renderSopPdf(request: Request, user: AuthUser) {
  if (request.method !== "GET") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  const requested = new URL(request.url).searchParams.get("language");
  const language: Language =
    requested === "id" || requested === "en" ? requested : user.preferredLanguage;
  const logo = await logoData();
  // Bagan alur yang sama dengan /api/help/alur.png. Kegagalan rasterisasi
  // tidak boleh menggagalkan seluruh panduan.
  const alur = await renderAlurPng(language).catch(() => undefined);

  const doc = buildGuide(language, logo, { alur });

  const filename =
    language === "en"
      ? "PerumNet-Enterprise-Operations-Manual.pdf"
      : "Panduan-Operasional-PerumNet-Enterprise.pdf";
  return new Response(Buffer.from(doc.output("arraybuffer")), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
