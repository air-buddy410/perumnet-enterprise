"use client";

import {
  BookOpenCheck,
  ChevronDown,
  CircleHelp,
  Download,
  FileSpreadsheet,
  FolderKanban,
  KeyRound,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { downloadApiFile } from "../api-client";
import type { AppLanguage } from "../i18n";

interface HelpViewProps {
  language: AppLanguage;
}

const guides = {
  id: [
    { title: "Mulai menggunakan aplikasi", icon: BookOpenCheck, body: "Pilih workspace proyek dari sidebar, lalu gunakan Dashboard untuk melihat status pekerjaan, nilai proyek, progres, dan pembayaran. Workspace “Semua proyek” menampilkan ringkasan global; memilih satu proyek membuat modul operasional mengikuti proyek tersebut." },
    { title: "Proyek, tugas, dan dokumentasi", icon: FolderKanban, body: "Buka Manajemen Proyek untuk membuat tugas, menentukan penanggung jawab, memperbarui status, dan mengunggah foto atau dokumen lapangan. Progres proyek dihitung dari jumlah tugas yang selesai." },
    { title: "BoQ dan harga jual", icon: FileSpreadsheet, body: "Di BoQ Generator, masukkan kategori, deskripsi, jumlah, satuan, harga pokok, dan harga jual. Sistem menghitung biaya, nilai penawaran, margin, serta persentase margin. Template menyimpan susunan item untuk dipakai kembali." },
    { title: "Quotation, invoice, dan pembayaran", icon: ReceiptText, body: "Quotation mengambil nilai dari BoQ proyek aktif. Buat invoice berdasarkan termin, tentukan tanggal jatuh tempo, unduh PDF, lalu konfirmasi pembayaran ketika dana diterima. Konfirmasi otomatis membuat transaksi pemasukan." },
    { title: "Pengguna dan hak akses", icon: ShieldCheck, body: "Admin membuat akun dengan email dan kata sandi awal, lalu memilih tingkat akses per modul: Tidak ada, Lihat, atau Kelola. “Lihat” hanya mengizinkan membaca data; “Kelola” mengizinkan pembuatan dan perubahan data. Hak akses juga diperiksa oleh server." },
    { title: "Profil pribadi", icon: UserRound, body: "Buka Profil Saya dari menu akun. Anda dapat mengganti foto, nama, email, telepon, jabatan, tanggal lahir, alamat, dan bio. Foto harus JPG, PNG, atau WebP dengan ukuran maksimal 3 MB." },
    { title: "Bahasa, notifikasi, dan kata sandi", icon: Settings, body: "Buka Pengaturan untuk memilih Bahasa Indonesia atau English, menyimpan preferensi notifikasi email, dan mengganti kata sandi. Status pada halaman akan menunjukkan apakah provider pengiriman email sudah aktif. Pilihan bahasa tersimpan pada akun sehingga digunakan kembali saat login berikutnya." },
    { title: "Masalah login dan keamanan", icon: KeyRound, body: "Pastikan email dan kata sandi benar serta akun berstatus Aktif. Gunakan Lupa kata sandi jika email layanan sudah dikonfigurasi. Jika akses suatu menu ditolak, hubungi Admin untuk memeriksa matriks hak akses akun Anda." },
    { title: "Sesi 8 jam dan Ingat Saya", icon: KeyRound, body: "Tanpa Ingat Saya, sesi berakhir setelah 8 jam. Aktifkan Ingat Saya hanya pada perangkat pribadi untuk mempertahankan login hingga 30 hari. Keluar dari aplikasi tetap mencabut sesi perangkat tersebut." },
    { title: "Akses proyek PM & Engineer", icon: ShieldCheck, body: "Project Manager dan Engineer hanya melihat proyek yang dipilih secara eksplisit pada bagian Akses Proyek. Admin dapat mencabut akses pembuat atau manager proyek; setelah disimpan, proyek hilang dari dashboard akun tersebut. Admin dan Finance tetap memiliki cakupan global." },
    { title: "BoQ Original dan pekerjaan tambah", icon: FileSpreadsheet, body: "BoQ Original menjadi dasar Quotation awal. Pekerjaan tambah tidak mengubah dokumen yang sudah diterima: buat Addendum baru, isi item tambah, kirim Quotation Addendum, lalu simpan tanggal dan bukti persetujuan klien. Item Accepted otomatis dikunci." },
    { title: "Kategori dan tipe vendor", icon: Settings, body: "Admin/Finance mengelola kategori vendor Supplier, Jasa, atau Hybrid. Supplier digunakan untuk PO Perangkat/Material; Jasa untuk SPK Jasa/Mobilitas; Hybrid dapat memakai keduanya. Kategori yang sudah digunakan dinonaktifkan agar histori tidak hilang." },
    { title: "SPK/PO dan batas alokasi BoQ", icon: FileSpreadsheet, body: "Buat SPK/PO hanya dari Quotation Accepted. Pilih item BoQ, kuantitas, dan harga negosiasi vendor. Harga pokok tetap menjadi budget; harga vendor menjadi committed cost. Total alokasi aktif tidak boleh melebihi kuantitas BoQ." },
    { title: "Approval dan pemisahan tugas", icon: ShieldCheck, body: "PM/Engineer berizin procurement membuat dan mengajukan draft. Admin/Finance menyetujui nilai komitmen. Finance tidak dapat menyetujui draft yang diajukannya sendiri; Admin dapat override dengan alasan yang masuk audit log. Dokumen Approved dikunci." },
    { title: "Termin, penerimaan, dan pembayaran vendor", icon: ReceiptText, body: "DP boleh dibayar setelah dokumen disetujui. Termin jasa berikutnya memerlukan verifikasi progres PM/Engineer; PO memerlukan penerimaan barang per item. Pembayaran menyimpan tagihan vendor, referensi, rekening perusahaan, bukti, dan hanya membuat kas keluar sebesar nominal aktual." },
    { title: "Multi-rekening dan rekonsiliasi", icon: ReceiptText, body: "Tambahkan beberapa rekening perusahaan, lalu impor PDF/CSV bulanan per rekening atau gunakan konektor API read-only. Cocokkan mutasi dengan transaksi yang sudah ada agar kas tidak tercatat ganda. Finance dapat merekonsiliasi; hanya Admin dapat menghapus mutasi." },
    { title: "Koreksi transaksi dan human error", icon: ShieldCheck, body: "Transaksi manual dapat diedit atau dihapus dari Buku Kas. Pembayaran vendor tidak diedit langsung: Admin melakukan Void yang membuat reversal. Pembayaran yang sudah direkonsiliasi harus dilepas dari mutasi bank terlebih dahulu. Semua tindakan masuk audit log." },
    { title: "Bonus, fee, dan pembagian laba", icon: ReceiptText, body: "Catat Bonus Pegawai atau Fee Pemberi Kerja sebagai pengeluaran proyek. Laba aman dibagikan adalah laba kas setelah dikurangi seluruh komitmen vendor aktif yang belum dibayar. Total pembagian maksimal 100%; Admin mengunci nominal sebelum pembayaran." },
    { title: "Pajak opsional dan snapshot", icon: ReceiptText, body: "Admin mengaktifkan modul pajak dan menentukan kode, cakupan, efek tambah/potong, tarif, serta perlakuan akuntansi. Admin/Finance memilih pajak per Quotation, Invoice, SPK, atau PO. Snapshot terkunci saat dokumen diterima, disetujui, atau dibayar; tarif master sesudahnya tidak mengubah histori." },
    { title: "Pembayaran parsial & settlement pajak", icon: ReceiptText, body: "Pembayaran Invoice dan vendor memisahkan bruto, pajak potong, serta kas aktual. Buku Kas hanya mencatat kas nyata. Finance → Pajak menampilkan utang/piutang, settlement, rekening, dan bukti. Settlement atau pembayaran yang sudah direkonsiliasi harus dilepas sebelum Admin melakukan void." },
    { title: "Outbox email Mailcow", icon: Settings, body: "Notifikasi masuk transactional outbox agar gangguan SMTP tidak membatalkan transaksi bisnis. Produksi mengirim melalui Mailcow privat dan relay Brevo; worker mencoba ulang pada menit 1, 5, 15, dan 60 hingga maksimal lima percobaan. Admin dapat retry dari riwayat." },
    { title: "Mode demo terisolasi", icon: ShieldCheck, body: "Akun demo berjalan pada APP_MODE=demo dan database khusus demo yang tidak boleh sama dengan database production. Email disimpan dalam mode capture tanpa dikirim ke penerima sehingga pengujian tidak mengganggu pengguna atau data live." },
  ],
  en: [
    { title: "Getting started", icon: BookOpenCheck, body: "Choose a project workspace from the sidebar, then use the Dashboard to review work status, project value, progress, and payments. “All projects” shows a global summary; choosing one project applies that context to operational modules." },
    { title: "Projects, tasks, and documents", icon: FolderKanban, body: "Open Project Management to create tasks, assign owners, update status, and upload field photos or documents. Project progress is calculated from completed tasks." },
    { title: "BoQ and selling prices", icon: FileSpreadsheet, body: "In BoQ Generator, enter the category, description, quantity, unit, cost, and selling price. The system calculates cost, quotation value, margin, and margin percentage. Templates let you reuse an item structure." },
    { title: "Quotations, invoices, and payments", icon: ReceiptText, body: "A quotation uses the active project’s BoQ. Create milestone invoices, set due dates, download PDFs, and confirm a payment when funds arrive. A confirmed payment automatically creates an income transaction." },
    { title: "Users and permissions", icon: ShieldCheck, body: "Admins create accounts with an email and initial password, then set each module to No access, View, or Manage. View is read-only; Manage allows users to create and update data. Permissions are enforced by the server as well as the interface." },
    { title: "Personal profile", icon: UserRound, body: "Open My Profile from the account menu. You can update your photo, name, email, phone, job title, birth date, address, and bio. Photos must be JPG, PNG, or WebP and no larger than 3 MB." },
    { title: "Language, notifications, and password", icon: Settings, body: "Open Settings to choose Indonesian or English, save your email notification preference, and change your password. The page shows whether an email delivery provider is active. Your language choice is restored at your next sign-in." },
    { title: "Login and security issues", icon: KeyRound, body: "Confirm your email and password and make sure the account is Active. Use Forgot password when email delivery is configured. If a module is denied, ask an Admin to review your account permission matrix." },
    { title: "Eight-hour session and Remember Me", icon: KeyRound, body: "Without Remember Me, a session expires after 8 hours. Enable Remember Me only on a private device to stay signed in for up to 30 days. Signing out still revokes that device session." },
    { title: "PM & Engineer project access", icon: ShieldCheck, body: "Project Managers and Engineers only see projects explicitly selected in Project Access. An Admin may revoke creator or manager access; after saving, the project disappears from that account's dashboard. Admin and Finance retain global scope." },
    { title: "Original BoQ and additional work", icon: FileSpreadsheet, body: "The Original BoQ drives the first Quotation. Never edit accepted scope for additional work: create a new Addendum, enter the extra items, send its Quotation, then save the client acceptance date and proof. Accepted items are automatically locked." },
    { title: "Vendor categories and types", icon: Settings, body: "Admin/Finance manages Supplier, Service, and Hybrid categories. Suppliers use Purchase Orders for Devices/Materials; Services use Work Orders for Services/Mobility; Hybrid vendors can use both. Disable in-use categories to preserve history." },
    { title: "Work Orders/POs and BoQ allocation limits", icon: FileSpreadsheet, body: "Create a Work Order or PO only from an Accepted Quotation. Select BoQ items, quantities, and negotiated vendor prices. BoQ cost remains the budget while vendor price becomes committed cost. Active allocations cannot exceed accepted BoQ quantities." },
    { title: "Approval and segregation of duties", icon: ShieldCheck, body: "Authorized PMs/Engineers create and submit drafts. Admin/Finance approves the commitment. Finance cannot approve its own submission; an Admin override requires an audited reason. Approved documents are locked." },
    { title: "Terms, receipts, and vendor payments", icon: ReceiptText, body: "A down payment is payable after approval. Later service terms require PM/Engineer progress verification; POs require item-level goods receipts. Payments store the vendor invoice, reference, company bank account, and proof, posting only the actual amount as cash outflow." },
    { title: "Multiple accounts and reconciliation", icon: ReceiptText, body: "Add multiple company accounts, then import monthly PDF/CSV statements for each account or use the read-only API connector. Match entries to existing records to avoid duplicate cash. Finance may reconcile; only Admin may delete an entry." },
    { title: "Transaction corrections and human error", icon: ShieldCheck, body: "Manual transactions can be edited or deleted from the Cash Ledger. Vendor payments are corrected by an Admin Void that posts a reversal. A reconciled payment must first be detached from its bank entry. Every action is audited." },
    { title: "Bonuses, fees, and profit sharing", icon: ReceiptText, body: "Record Employee Bonus or Referral Fee as project expenses. Safe distributable profit is cash profit after all unpaid active vendor commitments are reserved. Profit sharing is capped at 100%; an Admin locks the amount before payment." },
    { title: "Optional tax and snapshots", icon: ReceiptText, body: "An Admin enables the tax module and defines the code, scope, add/withhold effect, rate, and accounting treatment. Admin/Finance selects taxes per Quotation, Invoice, Work Order, or PO. A snapshot locks when the document is accepted, approved, or paid, so later master-rate changes never rewrite history." },
    { title: "Partial payments & tax settlements", icon: ReceiptText, body: "Invoice and vendor payments separate gross value, withholding, and actual cash. The Cash Ledger records only real cash. Finance → Tax shows payables/receivables, settlements, accounts, and evidence. A reconciled settlement or payment must be detached before an Admin void." },
    { title: "Mailcow email outbox", icon: Settings, body: "Notifications enter a transactional outbox so SMTP outages cannot roll back business transactions. Production sends through private Mailcow and the Brevo relay; the worker retries after 1, 5, 15, and 60 minutes, up to five attempts. Admin may retry from history." },
    { title: "Isolated demo mode", icon: ShieldCheck, body: "The demo account runs under APP_MODE=demo with a dedicated demo database that cannot equal production. Email is captured without being delivered, so testing cannot affect live users or data." },
  ],
};

export function HelpView({ language }: HelpViewProps) {
  const [query, setQuery] = useState("");
  const id = language === "id";
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return guides[language].filter((guide) => !needle || `${guide.title} ${guide.body}`.toLowerCase().includes(needle));
  }, [language, query]);

  async function downloadSop() {
    await downloadApiFile(
      `/api/help/sop.pdf?language=${language}`,
      id
        ? "SOP-Lengkap-PerumNet-Enterprise.pdf"
        : "PerumNet-Enterprise-Complete-SOP.pdf",
    );
  }

  return (
    <div className="page-stack help-page" data-testid="help-view">
      <section className="help-hero">
        <span className="metric-icon teal"><CircleHelp size={24} /></span>
        <span className="eyebrow">{id ? "PUSAT BANTUAN" : "HELP CENTER"}</span>
        <h1>{id ? "Apa yang ingin Anda pelajari?" : "What would you like to learn?"}</h1>
        <p>{id ? "Panduan praktis untuk menyelesaikan pekerjaan di PerumNet Enterprise dari awal hingga akhir." : "Practical guidance for completing work in PerumNet Enterprise from start to finish."}</p>
        <label className="help-search"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari panduan, fitur, atau masalah..." : "Search guides, features, or issues..."} /></label>
      </section>
      <section className="help-guide-grid">
        {visible.map((guide, index) => {
          const Icon = guide.icon;
          return (
            <details className="panel help-guide" key={guide.title} open={index === 0 && !query}>
              <summary><span className="metric-icon blue"><Icon size={19} /></span><strong>{guide.title}</strong><ChevronDown size={17} /></summary>
              <p>{guide.body}</p>
            </details>
          );
        })}
      </section>
      {!visible.length && <section className="panel empty-state"><Search size={28} /><h3>{id ? "Panduan tidak ditemukan" : "No guide found"}</h3><p>{id ? "Coba gunakan kata kunci yang lebih singkat." : "Try a shorter search term."}</p></section>}
      <section className="help-support panel">
        <div><span className="metric-icon green"><ShieldCheck size={20} /></span><span><strong>{id ? "Panduan operasional lengkap" : "Complete operations guide"}</strong><small>{id ? "Unduh SOP proyek, dokumen, finance, rekonsiliasi, pembagian laba, dan kontrol akses." : "Download the SOP for projects, documents, finance, reconciliation, profit sharing, and access control."}</small></span></div>
        <div className="title-actions">
          <button className="button primary" type="button" onClick={downloadSop}><Download size={16} /> {id ? "Unduh SOP PDF" : "Download SOP PDF"}</button>
          <a className="button secondary" href="mailto:it@perumnet.id">{id ? "Email dukungan" : "Email support"}</a>
        </div>
      </section>
    </div>
  );
}
