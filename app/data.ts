export type ViewKey =
  | "dashboard"
  | "boq"
  | "billing"
  | "project"
  | "expenses"
  | "procurement"
  | "validation"
  | "bast"
  | "finance"
  | "users"
  | "profile"
  | "settings"
  | "help";

export type ProjectStatus = "Aktif" | "Selesai" | "Draft";
export type PaymentStatus =
  | "Lunas"
  | "Sebagian"
  | "Belum Dibayar"
  | "Belum Ada Tagihan"
  | "Tidak Diizinkan";

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
  startDateIso?: string;
  targetDateIso?: string;
  value: number;
  manager: string;
  managerId?: string;
  team: string[];
  teamNames?: string[];
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
  projectId?: string;
  number: string;
  type: string;
  issueDate: string;
  dueDate: string;
  issueDateIso?: string;
  dueDateIso?: string;
  amount: number;
  status: "Lunas" | "Belum Lunas" | "Dibayar Sebagian";
  paidDate?: string;
  paidDateIso?: string;
  taxAdditions?: number;
  taxWithholdings?: number;
  grossTotal?: number;
  netCashDue?: number;
  paidGross?: number;
  paidCash?: number;
  withheldTax?: number;
  outstanding?: number;
  payments?: Array<{
    id: string;
    grossAmount: number;
    cashAmount: number;
    withholdingAmount: number;
    paidDate: string;
    paymentReference: string;
    paymentMethod: string;
    bankAccountId?: string;
    bankAccount?: string;
    attachmentName?: string;
    status: "Posted" | "Void";
    createdBy?: string;
    voidReason?: string;
  }>;
}

export interface Vendor {
  id: string;
  name: string;
  category: string;
  contact: string;
  email?: string;
  address?: string;
  vendorType?: "Supplier" | "Jasa" | "Hybrid";
  categoryIds?: string[];
  categories?: Array<{ id: string; name: string; nameEn: string }>;
  /** @deprecated Retained only for legacy API compatibility. */
  rate: number;
  status: "Aktif" | "Nonaktif";
}

export interface VendorCategory {
  id: string;
  name: string;
  nameEn: string;
  vendorType: "Supplier" | "Jasa" | "Hybrid";
  status: "Aktif" | "Nonaktif";
  sortOrder: number;
  vendorCount: number;
}

export interface CommercialScope {
  id: string;
  projectId: string;
  kind: "Original" | "Addendum";
  sequence: number;
  title: string;
  status: "Draft" | "Sent" | "Accepted" | "Rejected" | "Void";
  acceptedAt?: string | null;
  quotation: {
    id: string;
    number: string;
    status: "Draft" | "Sent" | "Accepted" | "Rejected" | "Void";
    issuedAt: string;
    validUntil?: string | null;
    total: number;
    taxEnabled?: boolean;
    taxRevision?: number;
    acceptedAt?: string | null;
    attachmentName?: string | null;
  } | null;
  items: BoqItem[];
}

export interface ProcurementOrder {
  id: string;
  number: string;
  documentType: "SPK" | "PO";
  vendorId: string;
  vendor: string;
  vendorType: "Supplier" | "Jasa" | "Hybrid";
  projectId: string;
  project: string;
  projectCode: string;
  quotationId?: string | null;
  quotationNumber?: string | null;
  scopeKind?: "Original" | "Addendum" | null;
  scopeTitle?: string | null;
  scope: string;
  cost: number;
  budgetCost: number;
  workflowStatus: string;
  approvalStatus: "Draft" | "Pending" | "Approved" | "Rejected" | "Void";
  startDate?: string | null;
  endDate?: string | null;
  legacy: boolean;
  createdBy?: string | null;
  submittedBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  overrideReason?: string | null;
  paid: number;
  paidGross?: number;
  paidCash?: number;
  withheldTax?: number;
  taxAdditions?: number;
  taxWithholdings?: number;
  grossTotal?: number;
  netCashDue?: number;
  verifiedPayable: number;
  outstanding: number;
  availableToPay: number;
  paymentStatus: "Belum Dibayar" | "Dibayar Sebagian" | "Lunas";
  items: Array<{
    id: string;
    boqItemId?: string | null;
    quotationId?: string | null;
    description: string;
    category: string;
    quantity: number;
    unit: string;
    budgetUnitCost: number;
    agreedUnitCost: number;
    total: number;
    legacy: boolean;
  }>;
  terms: Array<{
    id: string;
    label: string;
    type: "DP" | "Progress" | "Final" | "Custom";
    percentage?: number | null;
    plannedAmount: number;
    requiresVerification: boolean;
    status: string;
  }>;
  verifications: Array<{
    id: string;
    termId?: string | null;
    verifiedAmount: number;
    progressPercentage?: number | null;
    notes: string;
    verifiedBy?: string | null;
    verifiedAt: string;
  }>;
  receipts: Array<{
    id: string;
    receiptNumber?: string | null;
    receivedAt: string;
    notes: string;
    receivedBy?: string | null;
    items: Array<{ spkItemId: string; quantity: number }>;
  }>;
  payments: Array<{
    id: string;
    termId?: string | null;
    amount: number;
    cashAmount?: number;
    grossAmount?: number;
    withholdingAmount?: number;
    paidDate: string;
    vendorInvoiceNumber: string;
    paymentReference: string;
    paymentMethod: string;
    bankAccountId?: string | null;
    bankAccount?: string | null;
    attachmentName: string;
    status: "Posted" | "Void";
    createdBy?: string | null;
    voidReason?: string | null;
  }>;
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
  paymentStatus: "Belum Dibayar" | "Dibayar";
  paidDate?: string;
  startDate?: string;
  endDate?: string;
}

export interface Transaction {
  id: string;
  date: string;
  dateIso?: string;
  type: "Pemasukan" | "Pengeluaran";
  projectId?: string;
  project: string;
  description: string;
  amount: number;
  source: string;
  category: string;
  categoryKey?: string;
  editable?: boolean;
}

export interface ProjectExpenseAttachment {
  id: string;
  kind: "Receipt" | "Invoice" | "PaymentProof" | "Other";
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  url: string;
}

export interface ProjectExpenseSettlement {
  id: string;
  type: "CompanyPayment" | "AdvanceAllocation" | "Reimbursement" | "AdvanceReturn" | "Reversal";
  amount: number;
  settlementDate: string;
  paymentReference: string;
  status: "Posted" | "Void";
  bankAccountId?: string;
  bankAccount?: string;
  transactionId?: string;
}

export interface ProjectExpense {
  id: string;
  number: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  purchaseDate: string;
  merchant: string;
  categoryId: string;
  category: string;
  categoryEn: string;
  totalAmount: number;
  currency: "IDR";
  fundingSource: "CompanyAccount" | "ProjectAdvance" | "EmployeePaid";
  bankAccountId?: string;
  bankAccount?: string;
  advanceId?: string;
  advanceNumber?: string;
  notes: string;
  itemDetails: Array<{ description: string; quantity: number; unit: string; unitPrice: number }>;
  workflowStatus: "Draft" | "Submitted" | "Approved" | "Rejected" | "Void";
  settlementStatus: "Unposted" | "Posted" | "AwaitingReimbursement" | "PartiallyReimbursed" | "Reimbursed" | "AdvanceSettled" | "Void";
  duplicateAcknowledged: boolean;
  reviewReason: string;
  selfApprovalReason: string;
  createdBy: string;
  creatorName: string;
  approvedBy?: string;
  approverName?: string;
  reimbursedAmount: number;
  advanceAllocatedAmount: number;
  reimbursementOutstanding: number;
  createdAt: string;
  updatedAt: string;
  attachments?: ProjectExpenseAttachment[];
  settlements?: ProjectExpenseSettlement[];
  events?: Array<{ id: string; type: string; note: string; actor: string; createdAt: string }>;
}

export interface ProjectExpenseCategory {
  id: string;
  name: string;
  nameEn: string;
  status: "Aktif" | "Nonaktif";
  sortOrder: number;
  usageCount: number;
}

export interface ProjectAdvance {
  id: string;
  number: string;
  projectId: string;
  project: string;
  recipientUserId: string;
  recipient: string;
  amount: number;
  allocated: number;
  returned: number;
  outstanding: number;
  disbursedDate: string;
  bankAccountId?: string;
  paymentReference: string;
  notes: string;
  status: "Open" | "Settled" | "Void";
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  syncMode: "Manual" | "API";
  status: "Aktif" | "Nonaktif";
  lastSyncedAt?: string;
  balanceUpdatedAt?: string;
  entryCount: number;
  unmatchedCount: number;
  latestEntryDate?: string;
  hasExternalAccountId: boolean;
  apiConfigured: boolean;
}

export interface BankStatementEntry {
  id: string;
  bankAccountId: string;
  date: string;
  description: string;
  type: Transaction["type"];
  amount: number;
  runningBalance?: number;
  reference?: string;
  reconciliationStatus: "Matched" | "Imported" | "Excluded";
  source: "Manual Upload" | "API";
  transactionId?: string;
  projectId?: string;
  project: string;
  category: string;
  createdAt: string;
}

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Project Manager" | "Engineer" | "Finance";
  status: "Aktif" | "Nonaktif";
  lastActive: string;
  avatarUrl?: string;
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
    paymentStatus: "Belum Dibayar",
  },
  {
    id: "spk-2",
    number: "SPK/PN/VII/2026/021",
    vendor: "Surya Fiber Team",
    project: "CCTV & Network Warehouse",
    scope: "Splicing backbone fiber dan OTDR test",
    cost: 7_800_000,
    status: "Dikirim",
    paymentStatus: "Belum Dibayar",
  },
  {
    id: "spk-3",
    number: "SPK/PN/VI/2026/014",
    vendor: "Ganesha CCTV Service",
    project: "Fiber Optic Villa Complex",
    scope: "Instalasi CCTV area entrance dan parkir",
    cost: 9_250_000,
    status: "Selesai",
    paymentStatus: "Belum Dibayar",
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
    category: "Vendor",
  },
  {
    id: "trx-2",
    date: "15 Jul 2026",
    type: "Pemasukan",
    project: "CCTV & Network Warehouse",
    description: "Pembayaran invoice DP 30%",
    amount: 29_040_000,
    source: "Invoice",
    category: "Penjualan",
  },
  {
    id: "trx-3",
    date: "10 Jul 2026",
    type: "Pemasukan",
    project: "Implementasi WiFi Resort Ubud",
    description: "Pembayaran invoice DP 50%",
    amount: 93_725_000,
    source: "Invoice",
    category: "Penjualan",
  },
  {
    id: "trx-4",
    date: "09 Jul 2026",
    type: "Pengeluaran",
    project: "Implementasi WiFi Resort Ubud",
    description: "Termin awal teknisi jaringan",
    amount: 6_250_000,
    source: "SPK",
    category: "Vendor",
  },
  {
    id: "trx-5",
    date: "04 Jul 2026",
    type: "Pengeluaran",
    project: "CCTV & Network Warehouse",
    description: "Pembelian kamera dan NVR",
    amount: 41_750_000,
    source: "Material",
    category: "Vendor",
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

export const formatCurrency = (value: number, language: "id" | "en" = "id") =>
  new Intl.NumberFormat(language === "en" ? "en-US" : "id-ID", {
    style: "currency",
    currency: "IDR",
    currencyDisplay: language === "en" ? "code" : "symbol",
    maximumFractionDigits: 0,
  }).format(value);

export const formatCompactCurrency = (value: number, language: "id" | "en" = "id") =>
  new Intl.NumberFormat(language === "en" ? "en-US" : "id-ID", {
    notation: "compact",
    style: "currency",
    currency: "IDR",
    currencyDisplay: language === "en" ? "code" : "symbol",
    maximumFractionDigits: 1,
  }).format(value);
