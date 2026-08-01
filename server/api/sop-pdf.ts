import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import type { AuthUser } from "../auth";
import { ApiError } from "./errors";

type Language = "id" | "en";
type SopSection = {
  title: [string, string];
  intro: [string, string];
  steps: Array<[string, string]>;
  control?: [string, string];
};

const sopSections: SopSection[] = [
  {
    title: ["1. Login, sesi, dan keamanan", "1. Sign-in, sessions, and security"],
    intro: [
      "Sesi standar aktif selama 8 jam. Ingat Saya memperpanjang sesi perangkat tepercaya sampai 30 hari.",
      "The default session lasts 8 hours. Remember Me extends a trusted device session for up to 30 days.",
    ],
    steps: [
      ["Gunakan akun pribadi dan jangan berbagi kata sandi.", "Use your personal account and never share passwords."],
      ["Gunakan Ingat Saya hanya pada perangkat pribadi.", "Use Remember Me only on a private device."],
      ["Admin menetapkan akses Lihat atau Kelola per modul.", "Admins assign View or Manage access per module."],
    ],
    control: [
      "Mode demo wajib memakai APP_MODE=demo dan database demo yang berbeda dari production.",
      "Demo mode must use APP_MODE=demo and a demo database different from production.",
    ],
  },
  {
    title: ["2. Proyek dan otorisasi tim", "2. Projects and team authorization"],
    intro: [
      "Admin dan Finance memiliki cakupan global. PM dan Engineer hanya melihat proyek yang dipilih di Akses Proyek.",
      "Admin and Finance have global scope. PMs and Engineers only see projects selected in Project Access.",
    ],
    steps: [
      ["Buat proyek dan lengkapi klien, lokasi, tanggal, serta manager.", "Create a project and complete the client, location, dates, and manager."],
      ["Admin memilih PM/Engineer yang berwenang pada Akses Proyek.", "An Admin selects authorized PMs/Engineers in Project Access."],
      ["Jika akses dicabut, proyek hilang dari dashboard pengguna tersebut.", "When access is revoked, the project disappears from that user's dashboard."],
    ],
  },
  {
    title: ["3. BoQ proyek dan BoQ mandiri", "3. Project and standalone BoQs"],
    intro: [
      "BoQ proyek menjadi sumber Quotation dan nilai proyek. Admin/Finance dapat membuat BoQ sebelum proyek tersedia.",
      "A project BoQ drives the Quotation and project value. Admin/Finance may create a BoQ before a project exists.",
    ],
    steps: [
      ["Isi kategori, deskripsi, qty, satuan, harga pokok, dan harga jual.", "Enter category, description, quantity, unit, cost, and selling price."],
      ["Periksa margin sebelum menyimpan atau memfinalkan BoQ.", "Review margin before saving or finalizing the BoQ."],
      ["Salin BoQ mandiri ke proyek; gunakan Ganti hanya bila BoQ lama boleh ditimpa.", "Copy the standalone BoQ to a project; use Replace only when the old BoQ may be overwritten."],
    ],
    control: [
      "Perubahan BoQ proyek mereset Quotation menjadi Draft dan validasi perangkat perlu diperbarui.",
      "A project BoQ change resets the Quotation to Draft and device validation must be updated.",
    ],
  },
  {
    title: ["4. Vendor, SPK/PO, dan pembayaran", "4. Vendors, Work Orders/POs, and payments"],
    intro: [
      "Procurement mengikuti Quotation Accepted. Harga pokok BoQ tetap menjadi budget; harga negosiasi vendor menjadi komitmen.",
      "Procurement follows an Accepted Quotation. BoQ cost remains the budget; negotiated vendor prices become commitments.",
    ],
    steps: [
      ["Admin/Finance membuat kategori dan vendor bertipe Supplier, Jasa, atau Hybrid.", "Admin/Finance creates categories and Supplier, Service, or Hybrid vendors."],
      ["Gunakan SPK untuk Jasa/Mobilitas dan PO untuk Perangkat/Material.", "Use Work Orders for Services/Mobility and POs for Devices/Materials."],
      ["Pilih item dari Quotation Accepted; alokasi aktif tidak boleh melebihi qty BoQ.", "Select items from an Accepted Quotation; active allocations cannot exceed BoQ quantities."],
      ["PM/Engineer mengajukan draft; Admin/Finance menyetujui. Finance dilarang self-approve.", "PM/Engineer submits a draft; Admin/Finance approves it. Finance self-approval is forbidden."],
      ["Bayar DP setelah approval. Termin jasa perlu verifikasi progres; PO perlu penerimaan barang.", "Pay a down payment after approval. Service terms need progress verification; POs need goods receipts."],
      ["Catat nominal aktual, tagihan vendor, referensi, rekening, dan bukti pembayaran.", "Record the actual amount, vendor invoice, reference, bank account, and payment proof."],
    ],
    control: [
      "Pembayaran yang sudah direkonsiliasi harus dilepas sebelum Admin membuat Void/reversal.",
      "A reconciled payment must be detached before an Admin posts a Void/reversal.",
    ],
  },
  {
    title: ["5. Quotation, Invoice, validasi, dan BAST", "5. Quotation, Invoice, validation, and handover"],
    intro: [
      "Dokumen komersial mengikuti proyek dan BoQ aktif agar angka tetap sinkron.",
      "Commercial documents follow the active project and BoQ to keep amounts synchronized.",
    ],
    steps: [
      ["Kirim Quotation lalu simpan tanggal dan bukti persetujuan klien untuk status Accepted.", "Send the Quotation, then save the client acceptance date and proof for Accepted status."],
      ["Pekerjaan tambah wajib memakai BoQ dan Quotation Addendum baru.", "Additional work requires a new BoQ and Quotation Addendum."],
      ["Catat pembayaran Invoice parsial dengan bruto, pajak potong, kas aktual, rekening, referensi, dan bukti.", "Record partial Invoice payments with gross value, withholding, actual cash, account, reference, and proof."],
      ["Selesaikan checklist perangkat sebelum BAST Final.", "Complete the device checklist before final handover."],
    ],
  },
  {
    title: ["6. Multi-rekening dan mutasi bank", "6. Multiple accounts and bank statements"],
    intro: [
      "Setiap rekening menyimpan saldo dan rekonsiliasi sendiri. Finance menjumlahkan seluruh rekening aktif.",
      "Each account keeps its own balance and reconciliation state. Finance totals all active accounts.",
    ],
    steps: [
      ["Admin menambahkan rekening dan saldo awal.", "An Admin adds the account and opening balance."],
      ["Finance mengimpor PDF/CSV bulanan atau menjalankan API read-only.", "Finance imports monthly PDF/CSV files or runs the read-only API."],
      ["Cocokkan mutasi dengan Invoice, SPK, atau transaksi manual tanpa menduplikasi kas.", "Match entries to Invoice, Work Order, or manual records without duplicating cash."],
      ["Hanya Admin dapat menghapus mutasi; tindakan tercatat di audit log.", "Only Admin may delete a statement entry; the action is audited."],
    ],
    control: [
      "Jangan membuat transaksi manual untuk kas yang sudah berasal dari mutasi, Invoice, atau SPK.",
      "Do not create a manual record for cash already generated by a statement, Invoice, or Work Order.",
    ],
  },
  {
    title: ["7. Koreksi dan human error", "7. Corrections and human error"],
    intro: [
      "Transaksi manual dapat diedit/dihapus. Transaksi sistem dikoreksi dari sumbernya.",
      "Manual transactions can be edited/deleted. System transactions are corrected from their source.",
    ],
    steps: [
      ["Invoice: ubah atau batalkan konfirmasi pembayaran.", "Invoice: update or cancel its payment confirmation."],
      ["SPK: koreksi status pembayaran dari halaman SPK.", "Work Order: correct payment status from the Work Order page."],
      ["Bank: ubah rekonsiliasi, kecualikan, atau minta Admin menghapus mutasi.", "Bank: change reconciliation, exclude, or ask an Admin to delete the entry."],
      ["Manual: gunakan Edit/Hapus pada Buku Kas.", "Manual: use Edit/Delete in the Cash Ledger."],
    ],
  },
  {
    title: ["8. Bonus, fee, dan pembagian keuntungan", "8. Bonuses, fees, and profit sharing"],
    intro: [
      "Laba aman dibagikan mengurangi komitmen vendor aktif yang belum dibayar.",
      "Safe distributable profit deducts unpaid active vendor commitments.",
    ],
    steps: [
      ["Catat bonus/fee sebagai Pengeluaran pada proyek dan kategori yang tepat.", "Record bonuses/fees as project Expenses in the correct category."],
      ["Tambahkan penerima; total maksimal 100% dan jumlah orang tidak dibatasi empat.", "Add recipients; total allocation is capped at 100% with no four-person limit."],
      ["Admin menyetujui nominal, lalu Admin/Finance mencatat pembayaran.", "An Admin approves the amount, then Admin/Finance records payment."],
      ["Lepaskan rekonsiliasi sebelum membatalkan pembayaran yang sudah cocok dengan bank.", "Unreconcile before voiding a payment already matched to the bank."],
    ],
  },
  {
    title: ["9. Belanja proyek, uang muka, dan reimbursement", "9. Project expenses, advances, and reimbursements"],
    intro: [
      "Setiap nota melewati verifikasi Finance tanpa mencatat pergerakan kas dua kali.",
      "Every receipt passes Finance verification without posting the same cash movement twice.",
    ],
    steps: [
      ["PM/Engineer memilih proyek, tanggal, toko, kategori, nominal, sumber dana, lalu mengunggah bukti.", "A PM/Engineer selects the project, date, merchant, category, amount, funding source, and uploads evidence."],
      ["Finance memeriksa hash file, kemiripan nota, serta pembayaran vendor sebelum menyetujui.", "Finance checks file hashes, similar receipts, and vendor payments before approval."],
      ["Rekening perusahaan membuat kas keluar; uang muka hanya mengurangi saldo; uang pribadi membuat utang reimbursement.", "Company funds post cash out; an advance only reduces its balance; employee funds create a reimbursement payable."],
      ["Bayar reimbursement secara parsial bila perlu dan catat pengembalian sisa uang muka sebagai kas masuk.", "Pay reimbursements partially when needed and record unused advance returns as cash inflow."],
      ["Admin melakukan Void melalui reversal setelah rekonsiliasi dilepas.", "An Admin voids through reversal after detaching any reconciliation."],
    ],
    control: [
      "Nota Approved dikunci; bukti transaksi tidak pernah dihapus secara fisik.",
      "Approved receipts are locked; posted evidence is never physically deleted.",
    ],
  },
  {
    title: ["10. Pajak opsional dan email", "10. Optional tax and email"],
    intro: [
      "Pajak nonaktif secara default; email bisnis diproses melalui transactional outbox.",
      "Tax is disabled by default; business email is processed through a transactional outbox.",
    ],
    steps: [
      ["Admin mengaktifkan pajak dan mengisi tarif aturan tanpa nilai legal hardcoded.", "An Admin enables tax and enters rule rates without hardcoded legal values."],
      ["Admin/Finance menyalakan Gunakan Pajak pada Quotation Draft dan memilih aturan; snapshot terkunci saat Accepted lalu diwariskan ke Invoice.", "Admin/Finance enables Use Tax on a Draft Quotation and selects rules; the snapshot locks at Accepted and passes to the Invoice."],
      ["Finance menyelesaikan utang/piutang pajak dengan referensi, rekening, dan bukti.", "Finance settles tax payables/receivables with a reference, account, and evidence."],
      ["Produksi mengirim melalui Mailcow-Brevo; demo hanya menyimpan capture.", "Production sends through Mailcow-Brevo; demo stores captures only."],
      ["Admin meninjau Pending/Failed dan menjalankan retry bila diperlukan.", "An Admin reviews Pending/Failed messages and retries when needed."],
    ],
    control: [
      "Fitur ini adalah pencatatan operasional; keputusan jenis, tarif, dan perlakuan pajak akhir tetap ditentukan Admin/Finance bersama penasihat pajak.",
      "This is an operational record; final tax type, rate, and treatment remain an Admin/Finance decision made with a tax adviser.",
    ],
  },
  {
    title: ["11. Laporan keuangan", "11. Financial reports"],
    intro: [
      "PDF dan CSV mengikuti periode, proyek, bahasa, kategori, posisi rekening, dan otoritas akun.",
      "PDF and CSV follow the period, project, language, category, bank position, and account authority.",
    ],
    steps: [
      ["Pilih proyek atau Semua Proyek.", "Select a project or All Projects."],
      ["Periksa saldo, transaksi belum direkonsiliasi, belanja proyek, uang muka, reimbursement, dan pembagian laba.", "Review balances, unreconciled entries, project expenses, advances, reimbursements, and profit sharing."],
      ["Arsipkan PDF sebagai laporan baca dan CSV untuk pemeriksaan data.", "Archive the PDF as the reader report and CSV for data inspection."],
    ],
  },
  {
    title: ["12. Penutupan proyek", "12. Project closeout"],
    intro: [
      "Tutup proyek hanya setelah dokumen, pekerjaan lapangan, dan arus kas konsisten.",
      "Close a project only after documents, field work, and cash flow are consistent.",
    ],
    steps: [
      ["Pastikan BoQ, Quotation, Invoice, SPK, validasi, dan BAST selesai.", "Complete the BoQ, Quotation, Invoice, Work Order, validation, and handover."],
      ["Rekonsiliasi mutasi serta catat bonus, fee, dan bagi hasil.", "Reconcile statements and record bonuses, fees, and profit sharing."],
      ["Ekspor laporan keuangan dan simpan dokumentasi proyek.", "Export the financial report and retain project documentation."],
    ],
  },
];

function pick(language: Language, value: [string, string]) {
  return language === "en" ? value[1] : value[0];
}

async function logoData() {
  try {
    const logo = await readFile(join(process.cwd(), "public", "perumnet-mark.png"));
    return `data:image/png;base64,${logo.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function renderSopPdf(request: Request, user: AuthUser) {
  if (request.method !== "GET") {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }
  const requested = new URL(request.url).searchParams.get("language");
  const language: Language =
    requested === "id" || requested === "en"
      ? requested
      : user.preferredLanguage;
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const logo = await logoData();
  // The guide has three fixed, deliberately balanced pages. Pre-creating them
  // keeps jsPDF's drawing context consistent across every page.
  doc.addPage("a4", "portrait");
  doc.addPage("a4", "portrait");
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 16;
  const bottom = height - 17;
  let page = 1;
  let y = 0;

  function header() {
    doc.setFillColor(37, 75, 91);
    doc.rect(0, 0, width, 31, "F");
    doc.setFillColor(63, 190, 184);
    doc.rect(0, 31, width, 2.2, "F");
    if (logo) doc.addImage(logo, "PNG", margin, 7, 17, 17);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("PERUMNET ENTERPRISE", margin + 23, 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("STANDARD OPERATING PROCEDURE", margin + 23, 20);
    y = 42;
  }

  function footer() {
    doc.setDrawColor(218, 229, 228);
    doc.line(margin, height - 12, width - margin, height - 12);
    doc.setFontSize(7.5);
    doc.setTextColor(102, 120, 127);
    doc.text("it@perumnet.id", margin, height - 7);
    doc.text(
      `${language === "en" ? "Page" : "Halaman"} ${page}`,
      width - margin,
      height - 7,
      { align: "right" },
    );
  }

  function newPage() {
    footer();
    page += 1;
    doc.setPage(page);
    header();
  }

  function ensure(space: number) {
    if (y + space > bottom) newPage();
  }

  doc.setPage(1);
  header();
  doc.setTextColor(37, 75, 91);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text(
    language === "en"
      ? "Complete Operations Guide"
      : "Panduan Lengkap Operasional",
    margin,
    y,
  );
  y += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(76, 97, 106);
  const subtitle =
    language === "en"
      ? "Projects, documents, finance, reconciliation, authorization, and closeout."
      : "Proyek, dokumen, finance, rekonsiliasi, otorisasi, dan penutupan.";
  doc.text(doc.splitTextToSize(subtitle, width - margin * 2), margin, y);
  y += 12;
  doc.setFillColor(231, 248, 246);
  doc.roundedRect(margin, y, width - margin * 2, 23, 3, 3, "F");
  doc.setTextColor(18, 118, 113);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(language === "en" ? "CORE PRINCIPLE" : "PRINSIP UTAMA", margin + 5, y + 7);
  doc.setTextColor(39, 58, 67);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const principle =
    language === "en"
      ? "Record a cash event only once. Sensitive changes must follow their source and leave an audit trail."
      : "Satu kejadian kas hanya dicatat sekali. Perubahan sensitif harus mengikuti sumbernya dan meninggalkan audit trail.";
  doc.text(doc.splitTextToSize(principle, width - margin * 2 - 10), margin + 5, y + 13);
  y += 31;

  for (const [sectionIndex, section] of sopSections.entries()) {
    if (sectionIndex === 4) newPage();
    if (sectionIndex === 8) newPage();
    ensure(28);
    doc.setTextColor(37, 75, 91);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(pick(language, section.title), margin, y);
    y += 6;
    const intro = doc.splitTextToSize(
      pick(language, section.intro),
      width - margin * 2,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(76, 97, 106);
    doc.text(intro, margin, y);
    y += intro.length * 4.1 + 3;
    section.steps.forEach((step, index) => {
      const lines = doc.splitTextToSize(
        pick(language, step),
        width - margin * 2 - 10,
      );
      ensure(lines.length * 4.1 + 4);
      doc.setFillColor(63, 190, 184);
      doc.circle(margin + 2.2, y - 1, 2.2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(String(index + 1), margin + 2.2, y - 0.2, { align: "center" });
      doc.setTextColor(39, 58, 67);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(lines, margin + 8, y);
      y += lines.length * 4.1 + 2.2;
    });
    if (section.control) {
      const lines = doc.splitTextToSize(
        pick(language, section.control),
        width - margin * 2 - 26,
      );
      ensure(lines.length * 4 + 9);
      doc.setFillColor(250, 247, 232);
      doc.roundedRect(
        margin,
        y,
        width - margin * 2,
        lines.length * 4 + 7,
        2,
        2,
        "F",
      );
      doc.setTextColor(135, 99, 25);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.text(language === "en" ? "CONTROL" : "KONTROL", margin + 4, y + 4.5);
      doc.setTextColor(76, 75, 63);
      doc.setFont("helvetica", "normal");
      doc.text(lines, margin + 20, y + 4.5);
      y += lines.length * 4 + 10;
    }
    y += 5;
  }
  footer();
  const filename =
    language === "en"
      ? "PerumNet-Enterprise-Complete-SOP.pdf"
      : "SOP-Lengkap-PerumNet-Enterprise.pdf";
  return new Response(Buffer.from(doc.output("arraybuffer")), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
