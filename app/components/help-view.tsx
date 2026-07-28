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
    { title: "BoQ mandiri dan master vendor", icon: FileSpreadsheet, body: "Admin dan Finance dapat membuat BoQ mandiri serta vendor tanpa memilih proyek. BoQ mandiri dapat disalin ke proyek saat pekerjaan disetujui. SPK tetap wajib terkait proyek agar biaya vendor masuk ke arus kas proyek yang benar." },
    { title: "Multi-rekening dan rekonsiliasi", icon: ReceiptText, body: "Tambahkan beberapa rekening perusahaan, lalu impor PDF/CSV bulanan per rekening atau gunakan konektor API read-only. Cocokkan mutasi dengan transaksi yang sudah ada agar kas tidak tercatat ganda. Finance dapat merekonsiliasi; hanya Admin dapat menghapus mutasi." },
    { title: "Koreksi transaksi dan human error", icon: ShieldCheck, body: "Transaksi manual dapat diedit atau dihapus dari Buku Kas dan semua perubahan masuk audit log. Transaksi Invoice, SPK, bank, dan bagi hasil dikunci: koreksi dilakukan dari dokumen atau rekonsiliasi asalnya." },
    { title: "Bonus, fee, dan pembagian laba", icon: ReceiptText, body: "Catat Bonus Pegawai atau Fee Pemberi Kerja sebagai pengeluaran proyek. Keduanya mengurangi laba bersih dasar. Pembagian laba dapat memiliki empat penerima atau lebih dengan total maksimal 100%; Admin menyetujui nominal sebelum Admin/Finance mencatat pembayaran." },
    { title: "Mode demo terisolasi", icon: ShieldCheck, body: "Akun demo berjalan pada APP_MODE=demo dan database khusus demo yang tidak boleh sama dengan database production. Pengiriman email dinonaktifkan pada mode ini sehingga pengujian tidak mengganggu pengguna atau data live." },
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
    { title: "Standalone BoQs and vendor master", icon: FileSpreadsheet, body: "Admin and Finance can create standalone BoQs and vendors without selecting a project. A standalone BoQ can be copied into a project after approval. A Work Order still requires a project so vendor costs enter the correct project cash flow." },
    { title: "Multiple accounts and reconciliation", icon: ReceiptText, body: "Add multiple company accounts, then import monthly PDF/CSV statements for each account or use the read-only API connector. Match entries to existing records to avoid duplicate cash. Finance may reconcile; only Admin may delete an entry." },
    { title: "Transaction corrections and human error", icon: ShieldCheck, body: "Manual transactions can be edited or deleted from the Cash Ledger and every change is audited. Invoice, Work Order, bank, and profit-share transactions are locked and must be corrected from their source document or reconciliation." },
    { title: "Bonuses, fees, and profit sharing", icon: ReceiptText, body: "Record Employee Bonus or Referral Fee as project expenses. Both reduce base net profit. Profit sharing can have four or more recipients with a 100% total cap; an Admin approves the locked amount before Admin/Finance records payment." },
    { title: "Isolated demo mode", icon: ShieldCheck, body: "The demo account runs under APP_MODE=demo with a dedicated demo database that cannot equal production. Outbound email is disabled in this mode so testing cannot affect live users or data." },
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
