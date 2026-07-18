"use client";

import {
  BookOpenCheck,
  ChevronDown,
  CircleHelp,
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
    { title: "Bahasa, notifikasi, dan kata sandi", icon: Settings, body: "Buka Pengaturan untuk memilih Bahasa Indonesia atau English, mengaktifkan notifikasi email, dan mengganti kata sandi. Pilihan bahasa tersimpan pada akun sehingga digunakan kembali saat login berikutnya." },
    { title: "Masalah login dan keamanan", icon: KeyRound, body: "Pastikan email dan kata sandi benar serta akun berstatus Aktif. Gunakan Lupa kata sandi jika email layanan sudah dikonfigurasi. Jika akses suatu menu ditolak, hubungi Admin untuk memeriksa matriks hak akses akun Anda." },
  ],
  en: [
    { title: "Getting started", icon: BookOpenCheck, body: "Choose a project workspace from the sidebar, then use the Dashboard to review work status, project value, progress, and payments. “All projects” shows a global summary; choosing one project applies that context to operational modules." },
    { title: "Projects, tasks, and documents", icon: FolderKanban, body: "Open Project Management to create tasks, assign owners, update status, and upload field photos or documents. Project progress is calculated from completed tasks." },
    { title: "BoQ and selling prices", icon: FileSpreadsheet, body: "In BoQ Generator, enter the category, description, quantity, unit, cost, and selling price. The system calculates cost, quotation value, margin, and margin percentage. Templates let you reuse an item structure." },
    { title: "Quotations, invoices, and payments", icon: ReceiptText, body: "A quotation uses the active project’s BoQ. Create milestone invoices, set due dates, download PDFs, and confirm a payment when funds arrive. A confirmed payment automatically creates an income transaction." },
    { title: "Users and permissions", icon: ShieldCheck, body: "Admins create accounts with an email and initial password, then set each module to No access, View, or Manage. View is read-only; Manage allows users to create and update data. Permissions are enforced by the server as well as the interface." },
    { title: "Personal profile", icon: UserRound, body: "Open My Profile from the account menu. You can update your photo, name, email, phone, job title, birth date, address, and bio. Photos must be JPG, PNG, or WebP and no larger than 3 MB." },
    { title: "Language, notifications, and password", icon: Settings, body: "Open Settings to choose Indonesian or English, enable email notifications, and change your password. The language choice is saved to your account and restored at your next sign-in." },
    { title: "Login and security issues", icon: KeyRound, body: "Confirm your email and password and make sure the account is Active. Use Forgot password when email delivery is configured. If a module is denied, ask an Admin to review your account permission matrix." },
  ],
};

export function HelpView({ language }: HelpViewProps) {
  const [query, setQuery] = useState("");
  const id = language === "id";
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return guides[language].filter((guide) => !needle || `${guide.title} ${guide.body}`.toLowerCase().includes(needle));
  }, [language, query]);

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
        <div><span className="metric-icon green"><ShieldCheck size={20} /></span><span><strong>{id ? "Masih membutuhkan bantuan?" : "Still need help?"}</strong><small>{id ? "Hubungi Admin workspace dengan menyertakan nama menu dan pesan error yang tampil." : "Contact your workspace Admin and include the menu name and the error message shown."}</small></span></div>
        <a className="button secondary" href="mailto:support@perumnet.id">{id ? "Email dukungan" : "Email support"}</a>
      </section>
    </div>
  );
}
