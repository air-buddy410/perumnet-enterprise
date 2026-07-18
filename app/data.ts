export type ViewKey =
  | "dashboard"
  | "boq"
  | "billing"
  | "project"
  | "procurement"
  | "bast"
  | "finance"
  | "users"
  | "profile"
  | "settings"
  | "help";

export type ProjectStatus = "Aktif" | "Selesai" | "Draft";
export type PaymentStatus = "Lunas" | "Sebagian" | "Belum Dibayar" | "Belum Ada Tagihan";

export interface Project {
  id: string;
  code: string;
  name: string;
  client: string;
  location: string;
  status: ProjectStatus;
  progress: number;
  payment: PaymentStatus;
  paidRatio: number;
  startDate: string;
  targetDate: string;
  value: number;
  manager: string;
  team: string[];
}

export interface BoqItem {
  id: string;
  category: "Perangkat" | "Material" | "Jasa" | "Mobilitas";
  description: string;
  quantity: number;
  unit: string;
  costPrice: number;
  sellingPrice: number;
}

export interface Invoice {
  id: string;
  number: string;
  type: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  status: "Lunas" | "Belum Lunas";
  paidDate?: string;
}

export interface Vendor {
  id: string;
  name: string;
  category: string;
  contact: string;
  rate: number;
  status: "Aktif" | "Nonaktif";
}

export interface WorkOrder {
  id: string;
  number: string;
  vendorId?: string;
  projectId?: string;
  vendor: string;
  project: string;
  scope: string;
  cost: number;
  status: "Draft" | "Dikirim" | "Dikerjakan" | "Selesai";
}

export interface Transaction {
  id: string;
  date: string;
  type: "Pemasukan" | "Pengeluaran";
  project: string;
  description: string;
  amount: number;
  source: string;
}

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Project Manager" | "Engineer" | "Finance";
  status: "Aktif" | "Nonaktif";
  lastActive: string;
  permissions?: import("../shared/access").AccessPermissions;
}

export const projects: Project[] = [
  {
    id: "project-1",
    code: "PN-2607-014",
    name: "Implementasi WiFi Resort Ubud",
    client: "Bali Serenity Resort",
    location: "Ubud, Gianyar",
    status: "Aktif",
    progress: 72,
    payment: "Sebagian",
    paidRatio: 50,
    startDate: "08 Jul 2026",
    targetDate: "02 Agu 2026",
    value: 187_450_000,
    manager: "Dewa Mahardika",
    team: ["DM", "AS", "KP"],
  },
  {
    id: "project-2",
    code: "PN-2607-012",
    name: "CCTV & Network Warehouse",
    client: "PT Karya Logistik Bali",
    location: "Ketewel, Gianyar",
    status: "Aktif",
    progress: 46,
    payment: "Sebagian",
    paidRatio: 30,
    startDate: "03 Jul 2026",
    targetDate: "28 Jul 2026",
    value: 96_800_000,
    manager: "Ayu Pramesti",
    team: ["AP", "GA"],
  },
  {
    id: "project-3",
    code: "PN-2606-009",
    name: "Managed Service Kantor Cabang",
    client: "Koperasi Dharma Bali",
    location: "Denpasar",
    status: "Aktif",
    progress: 18,
    payment: "Belum Dibayar",
    paidRatio: 0,
    startDate: "25 Jun 2026",
    targetDate: "18 Agu 2026",
    value: 62_500_000,
    manager: "Dewa Mahardika",
    team: ["DM", "KD"],
  },
  {
    id: "project-4",
    code: "PN-2605-006",
    name: "Fiber Optic Villa Complex",
    client: "Taman Surya Hospitality",
    location: "Canggu, Badung",
    status: "Selesai",
    progress: 100,
    payment: "Lunas",
    paidRatio: 100,
    startDate: "11 Mei 2026",
    targetDate: "06 Jun 2026",
    value: 143_200_000,
    manager: "Ayu Pramesti",
    team: ["AP", "AS", "GA"],
  },
  {
    id: "project-5",
    code: "PN-2607-015",
    name: "Audit Infrastruktur Sekolah",
    client: "Yayasan Pelita Bangsa",
    location: "Klungkung",
    status: "Draft",
    progress: 0,
    payment: "Belum Ada Tagihan",
    paidRatio: 0,
    startDate: "22 Jul 2026",
    targetDate: "30 Jul 2026",
    value: 28_750_000,
    manager: "Dewa Mahardika",
    team: ["DM"],
  },
];

export const initialBoqItems: BoqItem[] = [
  {
    id: "boq-1",
    category: "Perangkat",
    description: "Access Point WiFi 6 Indoor",
    quantity: 12,
    unit: "unit",
    costPrice: 2_450_000,
    sellingPrice: 3_150_000,
  },
  {
    id: "boq-2",
    category: "Perangkat",
    description: "Managed PoE Switch 24 Port",
    quantity: 2,
    unit: "unit",
    costPrice: 7_250_000,
    sellingPrice: 9_250_000,
  },
  {
    id: "boq-3",
    category: "Material",
    description: "Kabel UTP Cat6 Outdoor",
    quantity: 8,
    unit: "box",
    costPrice: 1_650_000,
    sellingPrice: 2_100_000,
  },
  {
    id: "boq-4",
    category: "Jasa",
    description: "Instalasi, konfigurasi & testing",
    quantity: 1,
    unit: "paket",
    costPrice: 9_500_000,
    sellingPrice: 15_000_000,
  },
  {
    id: "boq-5",
    category: "Mobilitas",
    description: "Transportasi & akomodasi tim",
    quantity: 1,
    unit: "paket",
    costPrice: 3_750_000,
    sellingPrice: 5_000_000,
  },
];

export const initialInvoices: Invoice[] = [
  {
    id: "inv-1",
    number: "INV/PN/VII/2026/031",
    type: "DP 50%",
    issueDate: "08 Jul 2026",
    dueDate: "12 Jul 2026",
    amount: 93_725_000,
    status: "Lunas",
    paidDate: "10 Jul 2026",
  },
  {
    id: "inv-2",
    number: "INV/PN/VII/2026/044",
    type: "Pelunasan 50%",
    issueDate: "18 Jul 2026",
    dueDate: "02 Agu 2026",
    amount: 93_725_000,
    status: "Belum Lunas",
  },
];

export const initialVendors: Vendor[] = [
  {
    id: "vendor-1",
    name: "CV Bali Network Solution",
    category: "Teknisi Jaringan",
    contact: "0812 3800 2241",
    rate: 850_000,
    status: "Aktif",
  },
  {
    id: "vendor-2",
    name: "Surya Fiber Team",
    category: "Splicing Fiber Optic",
    contact: "0878 6112 9390",
    rate: 1_250_000,
    status: "Aktif",
  },
  {
    id: "vendor-3",
    name: "Ganesha CCTV Service",
    category: "Instalasi CCTV",
    contact: "0852 3798 2044",
    rate: 950_000,
    status: "Aktif",
  },
  {
    id: "vendor-4",
    name: "UD Sinar Data",
    category: "Supplier Perangkat",
    contact: "0361 902 881",
    rate: 0,
    status: "Nonaktif",
  },
];

export const initialWorkOrders: WorkOrder[] = [
  {
    id: "spk-1",
    number: "SPK/PN/VII/2026/018",
    vendor: "CV Bali Network Solution",
    project: "Implementasi WiFi Resort Ubud",
    scope: "Penarikan dan terminasi kabel UTP lantai 1–3",
    cost: 12_500_000,
    status: "Dikerjakan",
  },
  {
    id: "spk-2",
    number: "SPK/PN/VII/2026/021",
    vendor: "Surya Fiber Team",
    project: "CCTV & Network Warehouse",
    scope: "Splicing backbone fiber dan OTDR test",
    cost: 7_800_000,
    status: "Dikirim",
  },
  {
    id: "spk-3",
    number: "SPK/PN/VI/2026/014",
    vendor: "Ganesha CCTV Service",
    project: "Fiber Optic Villa Complex",
    scope: "Instalasi CCTV area entrance dan parkir",
    cost: 9_250_000,
    status: "Selesai",
  },
];

export const initialTransactions: Transaction[] = [
  {
    id: "trx-1",
    date: "18 Jul 2026",
    type: "Pengeluaran",
    project: "Implementasi WiFi Resort Ubud",
    description: "Pembelian access point tahap 2",
    amount: 29_400_000,
    source: "Material",
  },
  {
    id: "trx-2",
    date: "15 Jul 2026",
    type: "Pemasukan",
    project: "CCTV & Network Warehouse",
    description: "Pembayaran invoice DP 30%",
    amount: 29_040_000,
    source: "Invoice",
  },
  {
    id: "trx-3",
    date: "10 Jul 2026",
    type: "Pemasukan",
    project: "Implementasi WiFi Resort Ubud",
    description: "Pembayaran invoice DP 50%",
    amount: 93_725_000,
    source: "Invoice",
  },
  {
    id: "trx-4",
    date: "09 Jul 2026",
    type: "Pengeluaran",
    project: "Implementasi WiFi Resort Ubud",
    description: "Termin awal teknisi jaringan",
    amount: 6_250_000,
    source: "SPK",
  },
  {
    id: "trx-5",
    date: "04 Jul 2026",
    type: "Pengeluaran",
    project: "CCTV & Network Warehouse",
    description: "Pembelian kamera dan NVR",
    amount: 41_750_000,
    source: "Material",
  },
];

export const initialUsers: TeamUser[] = [
  {
    id: "user-1",
    name: "Dewa Mahardika",
    email: "dewa@perumnet.id",
    role: "Admin",
    status: "Aktif",
    lastActive: "Baru saja",
  },
  {
    id: "user-2",
    name: "Ayu Pramesti",
    email: "ayu@perumnet.id",
    role: "Project Manager",
    status: "Aktif",
    lastActive: "12 menit lalu",
  },
  {
    id: "user-3",
    name: "Agus Suardana",
    email: "agus@perumnet.id",
    role: "Engineer",
    status: "Aktif",
    lastActive: "1 jam lalu",
  },
  {
    id: "user-4",
    name: "Kadek Putra",
    email: "kadek@perumnet.id",
    role: "Engineer",
    status: "Aktif",
    lastActive: "Kemarin",
  },
  {
    id: "user-5",
    name: "Luh Sri Wahyuni",
    email: "sri@perumnet.id",
    role: "Finance",
    status: "Aktif",
    lastActive: "34 menit lalu",
  },
  {
    id: "user-6",
    name: "Gede Arimbawa",
    email: "gede@perumnet.id",
    role: "Engineer",
    status: "Nonaktif",
    lastActive: "28 Jun 2026",
  },
];

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

export const formatCompactCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    notation: "compact",
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 1,
  }).format(value);
