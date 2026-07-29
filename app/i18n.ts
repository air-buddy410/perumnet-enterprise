export type AppLanguage = "id" | "en";

const dictionary = {
  id: {
    main: "UTAMA",
    operations: "OPERASIONAL",
    administration: "ADMINISTRASI",
    dashboard: "Dashboard",
    projects: "Manajemen Proyek",
    boq: "BoQ Generator",
    billing: "Quotation & Invoice",
    procurement: "Procurement & Vendor",
    bast: "BAST Digital",
    validation: "Validasi Perangkat",
    finance: "Pembukuan",
    users: "Pengguna & Akses",
    settings: "Pengaturan",
    profile: "Profil saya",
    help: "Pusat Bantuan",
    helpQuestion: "Butuh bantuan?",
    helpCaption: "Pusat panduan PerumNet",
    workspace: "Workspace",
    allProjects: "Semua proyek",
    search: "Cari proyek, invoice, atau vendor...",
    notifications: "Notifikasi",
    searchResults: "Hasil pencarian",
    markRead: "Tandai dibaca",
    accountSettings: "Pengaturan akun",
    logout: "Keluar",
    home: "Beranda",
    project: "Proyek",
    money: "Keuangan",
    vendor: "Vendor",
    more: "Lainnya",
    loading: "Memuat ruang kerja...",
  },
  en: {
    main: "MAIN",
    operations: "OPERATIONS",
    administration: "ADMINISTRATION",
    dashboard: "Dashboard",
    projects: "Project Management",
    boq: "BoQ Generator",
    billing: "Quotations & Invoices",
    procurement: "Procurement & Vendors",
    bast: "Digital Handover",
    validation: "Device Validation",
    finance: "Finance",
    users: "Users & Access",
    settings: "Settings",
    profile: "My Profile",
    help: "Help Center",
    helpQuestion: "Need help?",
    helpCaption: "PerumNet user guide",
    workspace: "Workspace",
    allProjects: "All projects",
    search: "Search projects, invoices, or vendors...",
    notifications: "Notifications",
    searchResults: "Search results",
    markRead: "Mark as read",
    accountSettings: "Account settings",
    logout: "Sign out",
    home: "Home",
    project: "Projects",
    money: "Finance",
    vendor: "Vendors",
    more: "More",
    loading: "Loading workspace...",
  },
} as const;

export type TranslationKey = keyof (typeof dictionary)["id"];

export function translate(language: AppLanguage, key: TranslationKey) {
  return dictionary[language][key];
}

export function localizedLabel(language: AppLanguage, value: string) {
  if (language === "id") return value;
  const labels: Record<string, string> = {
    Semua: "All",
    Aktif: "Active",
    Nonaktif: "Inactive",
    Selesai: "Completed",
    "Belum Mulai": "Not Started",
    Berjalan: "In Progress",
    Dikirim: "Sent",
    Dikerjakan: "In Progress",
    Lunas: "Paid",
    Sebagian: "Partially Paid",
    "Belum Dibayar": "Unpaid",
    "Belum Lunas": "Unpaid",
    "Dibayar Sebagian": "Partially Paid",
    "Belum Ada Tagihan": "Not Invoiced",
    "Tidak Diizinkan": "Restricted",
    Pemasukan: "Income",
    Pengeluaran: "Expense",
    Perangkat: "Device",
    Material: "Material",
    Jasa: "Service",
    Mobilitas: "Mobility",
    Terpasang: "Installed",
    paket: "package",
    hari: "day",
    Draft: "Draft",
    Final: "Final",
    Sent: "Sent",
    Completed: "Completed",
  };
  return labels[value] ?? value;
}

export function localizedDate(language: AppLanguage, value?: string | null) {
  if (!value) return language === "id" ? "Belum ditentukan" : "Not specified";
  const source = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return value;
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(`${source}T00:00:00+08:00`));
}

export function localizedTimestamp(language: AppLanguage, value?: string | null) {
  if (!value) return language === "id" ? "Belum ditentukan" : "Not specified";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Makassar",
  }).format(date);
  return `${formatted.replace(":", ".")} WITA`;
}
