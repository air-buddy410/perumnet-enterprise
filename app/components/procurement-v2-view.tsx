"use client";

import {
  BadgeCheck,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Filter,
  LibraryBig,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  Send,
  Settings2,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import {
  BankAccount,
  CatalogItem,
  CommercialScope,
  formatCurrency,
  ProcurementOrder,
  Project,
  Vendor,
  VendorCategory,
} from "../data";
import { type AppLanguage, localizedLabel } from "../i18n";
import { DocumentTaxEditor } from "./document-tax-editor";
import { CatalogPicker } from "./catalog-picker";
import { DocumentPreviewModal } from "./document-preview-modal";

interface ProcurementViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projectId?: string;
  canManage: boolean;
  canManageCommercial: boolean;
  canManageVendors: boolean;
  canManagePayments: boolean;
  userRole: "Admin" | "Project Manager" | "Engineer" | "Finance";
}

type Tab = "orders" | "vendors" | "categories" | "commercial";
type Attachment = { name: string; mimeType: string; contentBase64: string };
type DraftLine = { selected: boolean; quantity: number; agreedUnitCost: number };

async function attachmentFromFile(file: File): Promise<Attachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mimeType: file.type,
    contentBase64: dataUrl.split(",")[1] ?? "",
  };
}

function statusTone(status: string) {
  if (["Approved", "Disetujui", "Diterima", "Selesai", "Lunas", "Accepted"].includes(status)) {
    return "success";
  }
  if (["Pending", "Menunggu Persetujuan", "Dikirim", "Diterima Sebagian", "Sent"].includes(status)) {
    return "warning";
  }
  if (["Void", "Rejected"].includes(status)) return "danger";
  return "neutral";
}

export function ProcurementViewV2({
  language,
  notify,
  projectId,
  canManage,
  canManageCommercial,
  canManageVendors,
  canManagePayments,
  userRole,
}: ProcurementViewProps) {
  const id = language === "id";
  const [tab, setTab] = useState<Tab>(projectId ? "orders" : "vendors");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [orders, setOrders] = useState<ProcurementOrder[]>([]);
  const [scopes, setScopes] = useState<CommercialScope[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState("Semua");
  const [serverToday, setServerToday] = useState("");

  const [showVendor, setShowVendor] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [vendorType, setVendorType] = useState<"Supplier" | "Jasa" | "Hybrid">("Jasa");
  const [vendorCategories, setVendorCategories] = useState<string[]>([]);
  const [vendorContact, setVendorContact] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorAddress, setVendorAddress] = useState("");
  const [vendorStatus, setVendorStatus] = useState<"Aktif" | "Nonaktif">("Aktif");

  const [showCategory, setShowCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<VendorCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryNameEn, setCategoryNameEn] = useState("");
  const [categoryType, setCategoryType] = useState<"Supplier" | "Jasa" | "Hybrid">("Jasa");
  const [categoryOrder, setCategoryOrder] = useState(0);

  const [showOrder, setShowOrder] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ProcurementOrder | null>(null);
  const [documentType, setDocumentType] = useState<"SPK" | "PO">("SPK");
  const [orderVendorId, setOrderVendorId] = useState("");
  const [quotationId, setQuotationId] = useState("");
  const [draftLines, setDraftLines] = useState<Record<string, DraftLine>>({});
  const [dpPercentage, setDpPercentage] = useState(0);
  const [orderStart, setOrderStart] = useState("");
  const [orderEnd, setOrderEnd] = useState("");

  const [acceptingScope, setAcceptingScope] = useState<CommercialScope | null>(null);
  const [acceptanceDate, setAcceptanceDate] = useState("");
  const [acceptanceFile, setAcceptanceFile] = useState<File | null>(null);
  const [showAddendum, setShowAddendum] = useState(false);
  const [editingScopeValidity, setEditingScopeValidity] = useState<CommercialScope | null>(null);
  const [scopeIssuedAt, setScopeIssuedAt] = useState("");
  const [scopeValidUntil, setScopeValidUntil] = useState("");
  const [addendumTitle, setAddendumTitle] = useState("");
  const [addendumCategory, setAddendumCategory] = useState<"Perangkat" | "Material" | "Jasa" | "Mobilitas">("Jasa");
  const [addendumDescription, setAddendumDescription] = useState("");
  const [addendumQuantity, setAddendumQuantity] = useState(1);
  const [addendumUnit, setAddendumUnit] = useState("paket");
  const [addendumCost, setAddendumCost] = useState(0);
  const [addendumSelling, setAddendumSelling] = useState(0);
  const [addendumCatalogOpen, setAddendumCatalogOpen] = useState(false);
  const [addendumCatalogItemId, setAddendumCatalogItemId] = useState<string | null>(null);
  const [addendumCatalogPriceTier, setAddendumCatalogPriceTier] = useState<1 | 2 | null>(null);

  const [paymentOrder, setPaymentOrder] = useState<ProcurementOrder | null>(null);
  const [paymentTermId, setPaymentTermId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentCashAmount, setPaymentCashAmount] = useState(0);
  const [paymentWithholdingAmount, setPaymentWithholdingAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState("");
  const [vendorInvoice, setVendorInvoice] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"Transfer Bank" | "Tunai" | "Kartu" | "Lainnya">("Transfer Bank");
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentFile, setPaymentFile] = useState<File | null>(null);

  const [verificationOrder, setVerificationOrder] = useState<ProcurementOrder | null>(null);
  const [verificationTermId, setVerificationTermId] = useState("");
  const [verificationAmount, setVerificationAmount] = useState(0);
  const [verificationProgress, setVerificationProgress] = useState(0);
  const [verificationNotes, setVerificationNotes] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<{ url: string; title: string; filename: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [vendorData, categoryData, orderData, scopeData, bankData, projectData, time] =
        await Promise.all([
          api<Vendor[]>("/api/vendors"),
          api<VendorCategory[]>("/api/vendor-categories"),
          projectId
            ? api<ProcurementOrder[]>(
                `/api/procurement-orders?projectId=${encodeURIComponent(projectId)}`,
              )
            : api<ProcurementOrder[]>("/api/procurement-orders"),
          projectId
            ? api<CommercialScope[]>(
                `/api/boq/scopes?projectId=${encodeURIComponent(projectId)}`,
              ).catch(() => [])
            : Promise.resolve([]),
          canManagePayments
            ? api<BankAccount[]>("/api/bank-accounts").catch(() => [])
            : Promise.resolve([]),
          projectId
            ? api<Project>(`/api/projects/${encodeURIComponent(projectId)}`)
            : Promise.resolve(null),
          api<{ today: string }>("/api/system/time"),
        ]);
      setVendors(vendorData);
      setCategories(categoryData);
      setOrders(orderData);
      setScopes(scopeData);
      setBanks(bankData);
      setProject(projectData);
      setServerToday(time.today);
      setOrderVendorId(
        (current) =>
          current ||
          vendorData.find((vendor) => vendor.status === "Aktif")?.id ||
          "",
      );
      setBankAccountId(
        (current) =>
          current ||
          bankData.find((bank) => bank.status === "Aktif")?.id ||
          "",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }, [canManagePayments, language, notify, projectId]);

  useEffect(() => {
    const update = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(update);
  }, [load]);

  const filteredVendors = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return vendors.filter((vendor) => {
      const type = vendor.vendorType ?? "Jasa";
      return (
        (filterType === "Semua" || type === filterType) &&
        (!normalized ||
          [vendor.name, vendor.category, vendor.contact, type]
            .join(" ")
            .toLowerCase()
            .includes(normalized))
      );
    });
  }, [filterType, query, vendors]);

  const acceptedScopes = scopes.filter(
    (scope) => scope.quotation?.status === "Accepted",
  );
  const canManageValidity = ["Admin", "Finance"].includes(userRole);
  const selectedScope = acceptedScopes.find(
    (scope) => scope.quotation?.id === quotationId,
  );
  const compatibleItems = (selectedScope?.items ?? []).filter((item) =>
    documentType === "SPK"
      ? ["Jasa", "Mobilitas"].includes(item.category)
      : ["Perangkat", "Material"].includes(item.category),
  );
  const orderCost = compatibleItems.reduce((sum, item) => {
    const line = draftLines[item.id];
    return line?.selected
      ? sum + line.quantity * line.agreedUnitCost
      : sum;
  }, 0);

  function openVendorForm(vendor?: Vendor) {
    setEditingVendor(vendor ?? null);
    setVendorName(vendor?.name ?? "");
    setVendorType(vendor?.vendorType ?? "Jasa");
    setVendorCategories(vendor?.categoryIds ?? []);
    setVendorContact(vendor?.contact ?? "");
    setVendorEmail(vendor?.email ?? "");
    setVendorAddress(vendor?.address ?? "");
    setVendorStatus(vendor?.status ?? "Aktif");
    setShowVendor(true);
  }

  async function saveVendor(event: FormEvent) {
    event.preventDefault();
    if (!vendorCategories.length) {
      notify(id ? "Pilih minimal satu kategori vendor." : "Select at least one vendor category.");
      return;
    }
    setBusy("vendor");
    try {
      await api(editingVendor ? `/api/vendors/${editingVendor.id}` : "/api/vendors", {
        method: editingVendor ? "PATCH" : "POST",
        body: JSON.stringify({
          name: vendorName,
          vendorType,
          categoryIds: vendorCategories,
          contact: vendorContact,
          email: vendorEmail,
          address: vendorAddress,
          status: vendorStatus,
        }),
      });
      setShowVendor(false);
      notify(id ? "Master vendor tersimpan." : "Vendor master saved.");
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function deleteVendor() {
    if (!editingVendor) return;
    const confirmed = window.confirm(
      id
        ? `Hapus vendor ${editingVendor.name}? Vendor dengan histori atau kontrak aktif akan ditolak dan harus dinonaktifkan.`
        : `Delete ${editingVendor.name}? Vendors with active contracts or history will be blocked and must be disabled.`,
    );
    if (!confirmed) return;
    setBusy("vendor-delete");
    try {
      await api(`/api/vendors/${editingVendor.id}`, { method: "DELETE" });
      setShowVendor(false);
      notify(id ? "Vendor tanpa histori berhasil dihapus." : "Unused vendor deleted.");
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  function openCategoryForm(category?: VendorCategory) {
    setEditingCategory(category ?? null);
    setCategoryName(category?.name ?? "");
    setCategoryNameEn(category?.nameEn ?? "");
    setCategoryType(category?.vendorType ?? "Jasa");
    setCategoryOrder(category?.sortOrder ?? categories.length);
    setShowCategory(true);
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    setBusy("category");
    try {
      await api(
        editingCategory
          ? `/api/vendor-categories/${editingCategory.id}`
          : "/api/vendor-categories",
        {
          method: editingCategory ? "PATCH" : "POST",
          body: JSON.stringify({
            name: categoryName,
            nameEn: categoryNameEn,
            vendorType: categoryType,
            sortOrder: categoryOrder,
            status: editingCategory?.status ?? "Aktif",
          }),
        },
      );
      setShowCategory(false);
      notify(id ? "Kategori vendor tersimpan." : "Vendor category saved.");
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function toggleCategory(category: VendorCategory) {
    try {
      await api(`/api/vendor-categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: category.status === "Aktif" ? "Nonaktif" : "Aktif",
        }),
      });
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteCategory(category: VendorCategory) {
    if (!window.confirm(id ? `Hapus kategori "${category.name}"?` : `Delete category "${category.name}"?`)) {
      return;
    }
    try {
      await api(`/api/vendor-categories/${category.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  function openOrderForm(type: "SPK" | "PO" = "SPK") {
    setEditingOrder(null);
    setDocumentType(type);
    const matchingVendor = vendors.find(
      (vendor) =>
        vendor.status === "Aktif" &&
        (vendor.vendorType === "Hybrid" ||
          (type === "SPK"
            ? vendor.vendorType !== "Supplier"
            : vendor.vendorType !== "Jasa")),
    );
    setOrderVendorId(matchingVendor?.id ?? "");
    const scope = acceptedScopes.find((candidate) =>
      candidate.items.some((item) =>
        type === "SPK"
          ? ["Jasa", "Mobilitas"].includes(item.category)
          : ["Perangkat", "Material"].includes(item.category),
      ),
    );
    setQuotationId(scope?.quotation?.id ?? "");
    setDraftLines({});
    setDpPercentage(0);
    setOrderStart("");
    setOrderEnd("");
    setShowOrder(true);
  }

  function openOrderEdit(order: ProcurementOrder) {
    if (!order.quotationId) return;
    setEditingOrder(order);
    setDocumentType(order.documentType);
    setOrderVendorId(order.vendorId);
    setQuotationId(order.quotationId);
    setDraftLines(
      Object.fromEntries(
        order.items
          .filter((item) => item.boqItemId)
          .map((item) => [
            String(item.boqItemId),
            {
              selected: true,
              quantity: item.quantity,
              agreedUnitCost: item.agreedUnitCost,
            },
          ]),
      ),
    );
    setDpPercentage(order.terms.find((term) => term.type === "DP")?.percentage ?? 0);
    setOrderStart(order.startDate ?? "");
    setOrderEnd(order.endDate ?? "");
    setShowOrder(true);
  }

  async function saveOrder(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !quotationId || !orderVendorId) return;
    const items = compatibleItems
      .filter((item) => draftLines[item.id]?.selected)
      .map((item) => ({
        boqItemId: item.id,
        quantity: draftLines[item.id].quantity,
        agreedUnitCost: draftLines[item.id].agreedUnitCost,
      }));
    if (!items.length || orderCost <= 0) {
      notify(id ? "Pilih item dan isi harga vendor." : "Select items and enter vendor prices.");
      return;
    }
    const terms =
      dpPercentage > 0 && dpPercentage < 100
        ? [
            { label: `DP ${dpPercentage}%`, type: "DP", percentage: dpPercentage },
            {
              label: id ? "Pelunasan" : "Final payment",
              type: "Final",
              percentage: 100 - dpPercentage,
            },
          ]
        : [{ label: id ? "Pelunasan" : "Full payment", type: "Final", percentage: 100 }];
    setBusy("order");
    try {
      await api(editingOrder ? `/api/procurement-orders/${editingOrder.id}` : "/api/procurement-orders", {
        method: editingOrder ? "PATCH" : "POST",
        body: JSON.stringify({
          documentType,
          vendorId: orderVendorId,
          projectId,
          quotationId,
          items,
          terms,
          startDate: orderStart || undefined,
          endDate: orderEnd || undefined,
        }),
      });
      setShowOrder(false);
      setEditingOrder(null);
      notify(
        editingOrder
          ? id
            ? `${documentType} draft berhasil diperbarui.`
            : `${documentType} draft updated.`
          : id
            ? `${documentType} draft berhasil dibuat.`
            : `${documentType} draft created.`,
      );
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function orderAction(
    order: ProcurementOrder,
    action: "submit" | "approve" | "reject" | "send" | "complete" | "void",
  ) {
    setBusy(`${order.id}:${action}`);
    try {
      let body: string | undefined;
      if (action === "approve" && order.submittedBy) {
        body = JSON.stringify({
          overrideReason:
            userRole === "Admin"
              ? id
                ? "Persetujuan Admin melalui panel procurement."
                : "Administrator approval through the procurement panel."
              : undefined,
        });
      }
      if (action === "reject" || action === "void") {
        const reason = window.prompt(
          action === "reject"
            ? id
              ? "Alasan penolakan:"
              : "Rejection reason:"
            : id
              ? "Alasan void dokumen:"
              : "Document void reason:",
        );
        if (!reason) return;
        body = JSON.stringify({ reason });
      }
      await api(`/api/procurement-orders/${order.id}/${action}`, {
        method: "POST",
        body,
      });
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function saveAcceptance(event: FormEvent) {
    event.preventDefault();
    if (!acceptingScope?.quotation || !acceptanceFile) return;
    setBusy("acceptance");
    try {
      await api(`/api/quotations/${acceptingScope.quotation.id}/accept`, {
        method: "POST",
        body: JSON.stringify({
          acceptedAt: acceptanceDate,
          attachment: await attachmentFromFile(acceptanceFile),
        }),
      });
      setAcceptingScope(null);
      notify(id ? "Persetujuan klien tersimpan dan scope dikunci." : "Client acceptance saved and scope locked.");
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function scopeAction(scope: CommercialScope, action: "send" | "reject" | "void") {
    if (!scope.quotation) return;
    try {
      await api(`/api/quotations/${scope.quotation.id}/${action}`, {
        method: "POST",
      });
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function saveAddendum(event: FormEvent) {
    event.preventDefault();
    if (!projectId) return;
    setBusy("addendum");
    try {
      await api(`/api/boq/scopes?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        body: JSON.stringify({
          title: addendumTitle,
          ...(canManageValidity ? { issuedAt: serverToday } : {}),
          items: [
            {
              category: addendumCategory,
              description: addendumDescription,
              quantity: addendumQuantity,
              unit: addendumUnit,
              costPrice: addendumCost,
              sellingPrice: addendumSelling,
              catalogItemId: addendumCatalogItemId,
              catalogPriceTier: addendumCatalogPriceTier,
            },
          ],
        }),
      });
      setShowAddendum(false);
      setAddendumCatalogItemId(null);
      setAddendumCatalogPriceTier(null);
      notify(id ? "Addendum draft dan Quotation baru dibuat." : "Addendum draft and new Quotation created.");
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  function useCatalogForAddendum(item: CatalogItem, tier: 1 | 2) {
    setAddendumCatalogItemId(item.id);
    setAddendumCatalogPriceTier(tier);
    setAddendumCategory(item.boqRole);
    setAddendumDescription([item.name, item.model].filter(Boolean).join(" — "));
    setAddendumUnit(item.unit);
    setAddendumCost(item.costPrice);
    setAddendumSelling(tier === 2 ? item.price2 : item.price1);
    setAddendumCatalogOpen(false);
  }

  function openScopeValidity(scope: CommercialScope) {
    if (!scope.quotation) return;
    setEditingScopeValidity(scope);
    setScopeIssuedAt(scope.quotation.issuedAt);
    setScopeValidUntil(scope.quotation.validUntil ?? "");
  }

  function setScopeValidityDays(days: number) {
    if (!scopeIssuedAt) return;
    const date = new Date(`${scopeIssuedAt}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    setScopeValidUntil(date.toISOString().slice(0, 10));
  }

  async function saveScopeValidity(event: FormEvent) {
    event.preventDefault();
    if (!editingScopeValidity || !projectId) return;
    setBusy("scope-validity");
    try {
      await api(`/api/boq/scopes/${editingScopeValidity.id}?projectId=${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify({ issuedAt: scopeIssuedAt, validUntil: scopeValidUntil }),
      });
      setEditingScopeValidity(null);
      notify(id ? "Masa berlaku Quotation diperbarui." : "Quotation validity updated.");
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  function openPayment(order: ProcurementOrder) {
    const term =
      order.terms.find((candidate) => candidate.type === "DP" && order.paid === 0) ??
      order.terms.find((candidate) => candidate.type !== "DP");
    setPaymentOrder(order);
    setPaymentTermId(term?.id ?? "");
    const gross = Math.min(
      term?.plannedAmount ?? order.availableToPay,
      order.availableToPay,
    );
    const withholding = Math.min(
      gross,
      Math.max(
        0,
        (order.taxWithholdings ?? 0) - (order.withheldTax ?? 0),
      ),
    );
    setPaymentAmount(gross);
    setPaymentWithholdingAmount(withholding);
    setPaymentCashAmount(Math.max(0, gross - withholding));
    setPaymentDate(serverToday);
    setVendorInvoice("");
    setPaymentReference("");
    setPaymentMethod("Transfer Bank");
    setBankAccountId(
      banks.find((bank) => bank.status === "Aktif")?.id ?? "",
    );
    setPaymentFile(null);
  }

  async function savePayment(event: FormEvent) {
    event.preventDefault();
    if (
      !paymentOrder ||
      !paymentFile ||
      paymentAmount !== paymentCashAmount + paymentWithholdingAmount
    ) return;
    setBusy("payment");
    try {
      await api(`/api/procurement-orders/${paymentOrder.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          termId: paymentTermId || undefined,
          grossAmount: paymentAmount,
          cashAmount: paymentCashAmount,
          withholdingAmount: paymentWithholdingAmount,
          paidDate: paymentDate,
          vendorInvoiceNumber: vendorInvoice,
          paymentReference,
          paymentMethod,
          bankAccountId:
            paymentMethod === "Transfer Bank" ? bankAccountId : undefined,
          attachment: await attachmentFromFile(paymentFile),
        }),
      });
      setPaymentOrder(null);
      notify(id ? "Pembayaran aktual masuk ke Buku Kas." : "Actual payment posted to the Cash Ledger.");
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function saveVerification(event: FormEvent) {
    event.preventDefault();
    if (!verificationOrder) return;
    setBusy("verification");
    try {
      if (verificationOrder.documentType === "PO") {
        const receiptItems = verificationOrder.items
          .map((item) => {
            const received = verificationOrder.receipts
              .flatMap((receipt) => receipt.items)
              .filter((candidate) => candidate.spkItemId === item.id)
              .reduce((sum, candidate) => sum + candidate.quantity, 0);
            return { spkItemId: item.id, quantity: item.quantity - received };
          })
          .filter((item) => item.quantity > 0);
        await api(`/api/procurement-orders/${verificationOrder.id}/receipts`, {
          method: "POST",
          body: JSON.stringify({
            receiptNumber,
            receivedAt: serverToday,
            items: receiptItems,
          }),
        });
      } else {
        await api(`/api/procurement-orders/${verificationOrder.id}/verifications`, {
          method: "POST",
          body: JSON.stringify({
            termId: verificationTermId,
            verifiedAmount: verificationAmount,
            progressPercentage: verificationProgress,
            notes: verificationNotes,
          }),
        });
      }
      setVerificationOrder(null);
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setBusy("");
    }
  }

  async function voidPayment(order: ProcurementOrder, paymentId: string) {
    const reason = window.prompt(
      id ? "Alasan pembatalan pembayaran:" : "Payment void reason:",
    );
    if (!reason) return;
    try {
      await api(`/api/procurement-orders/${order.id}/payments/${paymentId}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteOrder(order: ProcurementOrder) {
    if (!window.confirm(`${id ? "Hapus draft" : "Delete draft"} ${order.number}?`)) return;
    try {
      await api(`/api/procurement-orders/${order.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack procurement-v2" data-testid="procurement-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">{id ? "PROCUREMENT BERBASIS BOQ" : "BOQ-BASED PROCUREMENT"}</span>
          <h1>{id ? "Vendor, SPK & Purchase Order" : "Vendors, Work Orders & Purchase Orders"}</h1>
          <p>
            {id
              ? "Komitmen vendor mengikuti Quotation yang diterima, diverifikasi per termin, lalu dibayar sesuai nominal aktual."
              : "Vendor commitments follow accepted Quotations, are verified by terms, and paid at actual amounts."}
          </p>
        </div>
        <div className="title-actions">
          {canManageVendors && (
            <button className="button secondary" type="button" onClick={() => openVendorForm()}>
              <Plus size={16} /> {id ? "Vendor" : "Vendor"}
            </button>
          )}
          {canManage && projectId && (
            <>
              <button className="button secondary" type="button" onClick={() => openOrderForm("PO")}>
                <Boxes size={16} /> PO
              </button>
              <button className="button primary" type="button" onClick={() => openOrderForm("SPK")}>
                <FilePlus2 size={16} /> SPK
              </button>
            </>
          )}
        </div>
      </section>

      <section className="metric-grid procurement-metrics">
        <article className="metric-card">
          <span className="metric-icon teal"><Store size={20} /></span>
          <div className="metric-main"><span>{id ? "Vendor aktif" : "Active vendors"}</span><strong>{vendors.filter((vendor) => vendor.status === "Aktif").length}</strong></div>
          <span className="metric-change">{categories.filter((item) => item.status === "Aktif").length} {id ? "kategori" : "categories"}</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue"><FileText size={20} /></span>
          <div className="metric-main"><span>{id ? "Komitmen aktif" : "Active commitments"}</span><strong>{formatCurrency(orders.filter((order) => order.approvalStatus === "Approved" && order.workflowStatus !== "Void").reduce((sum, order) => sum + (order.grossTotal ?? order.cost), 0), language)}</strong></div>
          <span className="metric-change">{orders.filter((order) => order.approvalStatus === "Approved" && order.workflowStatus !== "Void").length} SPK/PO</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><CircleDollarSign size={20} /></span>
          <div className="metric-main"><span>{id ? "Outstanding vendor" : "Vendor outstanding"}</span><strong>{formatCurrency(orders.filter((order) => order.approvalStatus === "Approved" && order.workflowStatus !== "Void").reduce((sum, order) => sum + order.outstanding, 0), language)}</strong></div>
          <span className="metric-change warning-text">{formatCurrency(orders.filter((order) => order.approvalStatus === "Approved" && order.workflowStatus !== "Void").reduce((sum, order) => sum + (order.paidCash ?? order.paid), 0), language)} {id ? "kas dibayar" : "cash paid"}</span>
        </article>
      </section>

      <div className="module-tabs" role="tablist" aria-label="Procurement">
        {projectId && (
          <button role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "active" : ""} type="button" onClick={() => setTab("orders")}>
            <FileText size={17} /> SPK & PO <span className="tab-count">{orders.length}</span>
          </button>
        )}
        <button role="tab" aria-selected={tab === "vendors"} className={tab === "vendors" ? "active" : ""} type="button" onClick={() => setTab("vendors")}>
          <Store size={17} /> {id ? "Vendor" : "Vendors"} <span className="tab-count">{vendors.length}</span>
        </button>
        {canManageVendors && (
          <button role="tab" aria-selected={tab === "categories"} className={tab === "categories" ? "active" : ""} type="button" onClick={() => setTab("categories")}>
            <Settings2 size={17} /> {id ? "Kategori" : "Categories"}
          </button>
        )}
        {projectId && (
          <button role="tab" aria-selected={tab === "commercial"} className={tab === "commercial" ? "active" : ""} type="button" onClick={() => setTab("commercial")}>
            <BadgeCheck size={17} /> Quotation & Addendum <span className="tab-count">{scopes.length}</span>
          </button>
        )}
      </div>

      {tab === "vendors" && (
        <section className="panel">
          <div className="panel-head vendor-list-head">
            <div><span className="eyebrow">{id ? "MASTER VENDOR" : "VENDOR MASTER"}</span><h2>{id ? "Supplier, jasa, dan hybrid" : "Suppliers, services, and hybrid vendors"}</h2></div>
            <div className="project-tools">
              <label className="search-field compact"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari vendor..." : "Search vendors..."} /></label>
              <label className="select-compact"><Filter size={15} /><select value={filterType} onChange={(event) => setFilterType(event.target.value)}><option>Semua</option><option>Supplier</option><option>Jasa</option><option>Hybrid</option></select><ChevronDown size={14} /></label>
            </div>
          </div>
          <div className="vendor-grid">
            {filteredVendors.map((vendor, index) => (
              <article className={`vendor-card ${vendor.status === "Nonaktif" ? "disabled" : ""}`} key={vendor.id}>
                <div className="vendor-card-head">
                  <span className={`vendor-logo variant-${index % 4}`}><Building2 size={21} /></span>
                  <span className={`status-badge ${vendor.status === "Aktif" ? "success" : "neutral"}`}>{localizedLabel(language, vendor.status)}</span>
                  {canManageVendors && <button className="icon-button" type="button" onClick={() => openVendorForm(vendor)} aria-label={`Edit ${vendor.name}`}><Pencil size={15} /></button>}
                </div>
                <div className="vendor-card-copy"><strong>{vendor.name}</strong><span>{vendor.vendorType ?? "Jasa"}</span></div>
                <div className="vendor-category-chips">
                  {(vendor.categories?.length ? vendor.categories : [{ id: vendor.category, name: vendor.category, nameEn: vendor.category }]).map((item) => <span key={item.id}>{language === "en" && item.nameEn ? item.nameEn : item.name}</span>)}
                </div>
                <div className="vendor-contact-list"><span>{vendor.contact}</span><span>{vendor.email || "—"}</span><span>{vendor.address || "—"}</span></div>
                <div className="vendor-contract-note"><ClipboardCheck size={15} /><span>{id ? "Harga disepakati per SPK/PO, bukan tarif harian." : "Pricing is agreed per Work Order/PO, not by daily rate."}</span></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "categories" && (
        <section className="panel">
          <div className="panel-head"><div><span className="eyebrow">{id ? "KLASIFIKASI VENDOR" : "VENDOR CLASSIFICATION"}</span><h2>{id ? "Kategori & lingkup kerja" : "Categories & work scopes"}</h2></div><button className="button primary small" type="button" onClick={() => openCategoryForm()}><Plus size={15} /> {id ? "Kategori baru" : "New category"}</button></div>
          <div className="category-master-grid">
            {categories.map((item) => (
              <article className="category-master-card" key={item.id}>
                <div><strong>{language === "en" && item.nameEn ? item.nameEn : item.name}</strong><span>{item.vendorType} · {item.vendorCount} vendor</span></div>
                <span className={`status-badge ${item.status === "Aktif" ? "success" : "neutral"}`}>{localizedLabel(language, item.status)}</span>
                <button className="icon-button" type="button" onClick={() => openCategoryForm(item)} aria-label={`Edit ${item.name}`}><Pencil size={15} /></button>
                <button className="button subtle small" type="button" onClick={() => toggleCategory(item)}>{item.status === "Aktif" ? (id ? "Nonaktifkan" : "Disable") : (id ? "Aktifkan" : "Enable")}</button>
                {item.vendorCount === 0 && <button className="icon-button danger" type="button" onClick={() => deleteCategory(item)} aria-label={`${id ? "Hapus" : "Delete"} ${item.name}`}><Trash2 size={15} /></button>}
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "commercial" && (
        <section className="panel">
          <div className="panel-head"><div><span className="eyebrow">{id ? "RUANG LINGKUP KOMERSIAL" : "COMMERCIAL SCOPES"}</span><h2>{id ? "Quotation Original & Addendum" : "Original Quotation & Addenda"}</h2><p>{id ? "Accepted wajib memiliki tanggal dan bukti persetujuan; setelah itu item dikunci." : "Accepted status requires a date and proof; items are locked afterward."}</p></div>{canManageCommercial && <button className="button primary small" type="button" onClick={() => setShowAddendum(true)}><Plus size={15} /> Addendum</button>}</div>
          <div className="commercial-scope-list">
            {scopes.map((scope) => (
              <article className="commercial-scope-card" key={scope.id}>
                <div className="commercial-scope-main"><span className="eyebrow">{scope.kind} {scope.kind === "Addendum" ? `#${scope.sequence}` : ""}</span><strong>{scope.title}</strong><small>{scope.quotation?.number ?? (id ? "Quotation belum dibuat" : "Quotation not created")} · {scope.items.length} item</small></div>
                <div className="commercial-scope-value"><span>{id ? "Nilai komersial" : "Commercial value"}</span><strong>{formatCurrency(scope.quotation?.grandTotal ?? scope.quotation?.total ?? 0, language)}</strong></div>
                <span className={`status-badge ${scope.quotation?.validUntil && scope.quotation.validUntil < serverToday && scope.quotation.status !== "Accepted" ? "danger" : statusTone(scope.quotation?.status ?? scope.status)}`}>{scope.quotation?.validUntil && scope.quotation.validUntil < serverToday && scope.quotation.status !== "Accepted" ? (id ? "Kedaluwarsa" : "Expired") : scope.quotation?.status ?? scope.status}</span>
                <div className="table-row-actions">
                  {scope.quotation && <button className="icon-button" type="button" aria-label={id ? "Pratinjau quotation" : "Preview quotation"} onClick={() => setPreview({ url: `/api/quotations/${scope.quotation?.id}/pdf`, title: scope.quotation?.number ?? "Quotation", filename: `${(scope.quotation?.number ?? "Quotation").replaceAll("/", "-")}.pdf` })}><Eye size={15} /></button>}
                  {scope.quotation && <button className="button subtle small" type="button" onClick={() => downloadApiFile(`/api/quotations/${scope.quotation?.id}/pdf`, `${scope.quotation?.number.replaceAll("/", "-")}.pdf`)}><Download size={14} /> PDF</button>}
                  {canManageValidity && scope.quotation && scope.quotation.status !== "Accepted" && <button className="button subtle small" type="button" onClick={() => openScopeValidity(scope)}><Pencil size={14} /> {id ? "Masa berlaku" : "Validity"}</button>}
                  {scope.quotation && <DocumentTaxEditor language={language} notify={notify} documentType="Quotation" documentId={scope.quotation.id} canManage={["Admin", "Finance"].includes(userRole) && scope.quotation.status === "Draft"} onSaved={load} />}
                  {canManageCommercial && scope.quotation?.status === "Draft" && <button className="button secondary small" type="button" onClick={() => scopeAction(scope, "send")}><Send size={14} /> {id ? "Kirim" : "Send"}</button>}
                  {canManageCommercial && scope.quotation?.status === "Sent" && <button className="button primary small" type="button" disabled={Boolean(scope.quotation.validUntil && scope.quotation.validUntil < serverToday)} onClick={() => { setAcceptingScope(scope); setAcceptanceDate(serverToday); setAcceptanceFile(null); }}><BadgeCheck size={14} /> Accept</button>}
                  {canManageCommercial && scope.quotation?.status === "Sent" && <button className="button danger small" type="button" onClick={() => scopeAction(scope, "reject")}><X size={14} /> {id ? "Tolak" : "Reject"}</button>}
                  {canManageCommercial && scope.quotation?.status !== "Void" && <button className="button subtle small" type="button" onClick={() => scopeAction(scope, "void")}>Void</button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "orders" && projectId && (
        <section className="panel">
          <div className="panel-head"><div><span className="eyebrow">{id ? "KOMITMEN VENDOR" : "VENDOR COMMITMENTS"}</span><h2>{project ? `${project.code} · ${project.name}` : "SPK & PO"}</h2></div></div>
          <div className="procurement-order-list">
            {orders.map((order) => (
              <article className="procurement-order-card" key={order.id}>
                <div className="order-document-mark">{order.documentType === "PO" ? <Boxes size={20} /> : <FileText size={20} />}<strong>{order.documentType}</strong></div>
                <div className="order-main"><strong>{order.number}</strong><span>{order.vendor} · {order.quotationNumber ?? (id ? "Legacy" : "Legacy")}</span><small>{order.scopeTitle ?? order.scope}</small></div>
                <div className="order-values"><span>{id ? "Budget / bruto" : "Budget / gross"}</span><strong>{formatCurrency(order.budgetCost, language)} / {formatCurrency(order.grossTotal ?? order.cost, language)}</strong><small>{id ? "Bruto dibayar" : "Gross paid"} {formatCurrency(order.paidGross ?? order.paid, language)} · {id ? "Kas" : "Cash"} {formatCurrency(order.paidCash ?? order.paid, language)} · {id ? "Sisa" : "Outstanding"} {formatCurrency(order.outstanding, language)}</small></div>
                <div className="order-statuses"><span className={`status-badge ${statusTone(order.workflowStatus)}`}>{order.workflowStatus}</span><span className={`status-badge ${statusTone(order.paymentStatus)}`}>{order.paymentStatus}</span></div>
                <div className="order-actions">
                  {["Admin", "Finance"].includes(userRole) && ["Draft", "Pending"].includes(order.approvalStatus) && <DocumentTaxEditor language={language} notify={notify} documentType={order.documentType} documentId={order.id} canManage onSaved={load} />}
                  {canManage && !order.legacy && order.workflowStatus === "Draft" && <button className="button secondary small" type="button" onClick={() => orderAction(order, "submit")}><Send size={14} /> {id ? "Ajukan" : "Submit"}</button>}
                  {canManage && order.workflowStatus === "Draft" && !order.legacy && <button className="button subtle small" type="button" onClick={() => openOrderEdit(order)}><Pencil size={14} /> {id ? "Edit" : "Edit"}</button>}
                  {["Admin", "Finance"].includes(userRole) && !order.legacy && order.approvalStatus === "Pending" && <button className="button primary small" type="button" onClick={() => orderAction(order, "approve")}><CheckCircle2 size={14} /> {id ? "Setujui" : "Approve"}</button>}
                  {["Admin", "Finance"].includes(userRole) && !order.legacy && order.approvalStatus === "Pending" && <button className="button danger small" type="button" onClick={() => orderAction(order, "reject")}><X size={14} /> {id ? "Tolak" : "Reject"}</button>}
                  {canManage && !order.legacy && order.approvalStatus === "Approved" && order.workflowStatus === "Disetujui" && <button className="button secondary small" type="button" onClick={() => orderAction(order, "send")}><Send size={14} /> {id ? "Kirim" : "Send"}</button>}
                  {["Project Manager", "Engineer"].includes(userRole) && !order.legacy && order.approvalStatus === "Approved" && ["Dikirim", "Dikerjakan", "Diterima Sebagian"].includes(order.workflowStatus) && <button className="button secondary small" type="button" onClick={() => { setVerificationOrder(order); if (order.documentType === "SPK") { const term = order.terms.find((item) => item.type !== "DP"); setVerificationTermId(term?.id ?? ""); setVerificationAmount(term?.plannedAmount ?? 0); setVerificationProgress(100); } }}><PackageCheck size={14} /> {order.documentType === "PO" ? (id ? "Terima barang" : "Receive") : (id ? "Verifikasi" : "Verify")}</button>}
                  {canManagePayments && !order.legacy && order.approvalStatus === "Approved" && order.availableToPay > 0 && <button className="button secondary small" type="button" onClick={() => openPayment(order)}><CircleDollarSign size={14} /> {id ? "Bayar" : "Pay"}</button>}
                  {canManage && !order.legacy && order.approvalStatus === "Approved" && !["Disetujui", "Selesai", "Void"].includes(order.workflowStatus) && <button className="button subtle small" type="button" onClick={() => orderAction(order, "complete")}><BadgeCheck size={14} /> {id ? "Selesaikan" : "Complete"}</button>}
                  {["Admin", "Finance"].includes(userRole) && !order.legacy && order.workflowStatus !== "Void" && <button className="button danger small" type="button" onClick={() => orderAction(order, "void")}><X size={14} /> Void</button>}
                  <button className="icon-button" type="button" aria-label={`${id ? "Pratinjau" : "Preview"} ${order.number}`} onClick={() => setPreview({ url: `/api/procurement-orders/${order.id}/pdf`, title: order.number, filename: `${order.number.replaceAll("/", "-")}.pdf` })}><Eye size={15} /></button>
                  <button className="button subtle small" type="button" onClick={() => downloadApiFile(`/api/procurement-orders/${order.id}/pdf`, `${order.number.replaceAll("/", "-")}.pdf`)}><Download size={14} /> PDF</button>
                  {canManage && !order.legacy && order.workflowStatus === "Draft" && <button className="icon-button danger" type="button" onClick={() => deleteOrder(order)} aria-label={id ? "Hapus draft" : "Delete draft"}><Trash2 size={14} /></button>}
                </div>
                {order.payments.length > 0 && (
                  <details className="order-history"><summary>{id ? "Termin & histori pembayaran" : "Terms & payment history"}</summary><div className="order-payment-list">{order.payments.map((payment) => <div key={payment.id}><span>{payment.paidDate} · {payment.vendorInvoiceNumber}<small>{payment.paymentReference} · {payment.status} · {id ? "kas" : "cash"} {formatCurrency(payment.cashAmount ?? payment.amount, language)}</small></span><strong>{formatCurrency(payment.grossAmount ?? payment.amount, language)}</strong>{userRole === "Admin" && payment.status === "Posted" && <button className="button danger small" type="button" onClick={() => voidPayment(order, payment.id)}>Void</button>}</div>)}</div></details>
                )}
              </article>
            ))}
            {!orders.length && <div className="empty-state"><FilePlus2 size={28} /><h3>{id ? "Belum ada SPK/PO" : "No Work Orders or POs yet"}</h3><p>{id ? "Terima Quotation klien, lalu buat komitmen dari item BoQ." : "Accept the client Quotation, then create a commitment from BoQ items."}</p></div>}
          </div>
        </section>
      )}

      {showVendor && <div className="modal-backdrop" onMouseDown={() => setShowVendor(false)}><section className="modal-card wide" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{id ? "MASTER VENDOR" : "VENDOR MASTER"}</span><h2>{editingVendor ? (id ? "Edit vendor" : "Edit vendor") : (id ? "Vendor baru" : "New vendor")}</h2></div><button className="icon-button" type="button" onClick={() => setShowVendor(false)}><X size={18} /></button></div><form className="form-grid" onSubmit={saveVendor}>
        <label className="field full"><span>{id ? "Nama vendor" : "Vendor name"}</span><input required value={vendorName} onChange={(event) => setVendorName(event.target.value)} /></label>
        <label className="field"><span>{id ? "Tipe vendor" : "Vendor type"}</span><select value={vendorType} onChange={(event) => { const value = event.target.value as typeof vendorType; setVendorType(value); setVendorCategories([]); }}><option>Supplier</option><option>Jasa</option><option>Hybrid</option></select></label>
        <label className="field"><span>{id ? "Kontak" : "Contact"}</span><input required value={vendorContact} onChange={(event) => setVendorContact(event.target.value)} /></label>
        <fieldset className="field full category-picker"><legend>{id ? "Subkategori" : "Subcategories"}</legend>{categories.filter((item) => item.status === "Aktif" && (vendorType === "Hybrid" || item.vendorType === vendorType || item.vendorType === "Hybrid")).map((item) => <label key={item.id}><input type="checkbox" checked={vendorCategories.includes(item.id)} onChange={() => setVendorCategories((current) => current.includes(item.id) ? current.filter((categoryId) => categoryId !== item.id) : [...current, item.id])} /><span>{language === "en" && item.nameEn ? item.nameEn : item.name}</span></label>)}</fieldset>
        <label className="field"><span>Email</span><input type="email" value={vendorEmail} onChange={(event) => setVendorEmail(event.target.value)} /></label>
        <label className="field"><span>{id ? "Alamat" : "Address"}</span><input value={vendorAddress} onChange={(event) => setVendorAddress(event.target.value)} /></label>
        <label className="field full"><span>Status</span><select value={vendorStatus} onChange={(event) => setVendorStatus(event.target.value as typeof vendorStatus)}><option value="Aktif">{id ? "Aktif — dapat dipilih untuk procurement" : "Active — available for procurement"}</option><option value="Nonaktif">{id ? "Nonaktif — hanya tampil di histori" : "Inactive — history only"}</option></select></label>
        <div className="modal-actions full">{editingVendor && <button className="button danger" type="button" disabled={busy === "vendor-delete"} onClick={deleteVendor}><Trash2 size={15} /> {id ? "Hapus vendor" : "Delete vendor"}</button>}<button className="button secondary" type="button" onClick={() => setShowVendor(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy === "vendor"}>{id ? "Simpan vendor" : "Save vendor"}</button></div>
      </form></section></div>}

      {showCategory && <div className="modal-backdrop" onMouseDown={() => setShowCategory(false)}><section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{id ? "KATEGORI VENDOR" : "VENDOR CATEGORY"}</span><h2>{editingCategory ? (id ? "Edit kategori" : "Edit category") : (id ? "Kategori baru" : "New category")}</h2></div><button className="icon-button" type="button" onClick={() => setShowCategory(false)}><X size={18} /></button></div><form className="form-grid" onSubmit={saveCategory}>
        <label className="field full"><span>{id ? "Nama Indonesia" : "Indonesian name"}</span><input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></label>
        <label className="field full"><span>{id ? "Nama Inggris" : "English name"}</span><input value={categoryNameEn} onChange={(event) => setCategoryNameEn(event.target.value)} /></label>
        <label className="field"><span>{id ? "Tipe" : "Type"}</span><select value={categoryType} onChange={(event) => setCategoryType(event.target.value as typeof categoryType)}><option>Supplier</option><option>Jasa</option><option>Hybrid</option></select></label>
        <label className="field"><span>{id ? "Urutan" : "Order"}</span><input type="number" min="0" value={categoryOrder} onChange={(event) => setCategoryOrder(Number(event.target.value))} /></label>
        <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowCategory(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy === "category"}>{id ? "Simpan" : "Save"}</button></div>
      </form></section></div>}

      {showOrder && <div className="modal-backdrop" onMouseDown={() => setShowOrder(false)}><section className="modal-card extra-wide" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{editingOrder ? (id ? "EDIT DRAFT KOMITMEN" : "EDIT COMMITMENT DRAFT") : (id ? "KOMITMEN VENDOR BARU" : "NEW VENDOR COMMITMENT")}</span><h2>{documentType === "PO" ? "Purchase Order" : id ? "Surat Perintah Kerja" : "Work Order"}</h2></div><button className="icon-button" type="button" onClick={() => setShowOrder(false)}><X size={18} /></button></div><form className="form-grid" onSubmit={saveOrder}>
        <label className="field"><span>{id ? "Jenis dokumen" : "Document type"}</span><select value={documentType} disabled={Boolean(editingOrder)} onChange={(event) => { setDocumentType(event.target.value as typeof documentType); setDraftLines({}); }}><option>SPK</option><option>PO</option></select></label>
        <label className="field"><span>Vendor</span><select required value={orderVendorId} onChange={(event) => setOrderVendorId(event.target.value)}><option value="">{id ? "Pilih vendor" : "Choose vendor"}</option>{vendors.filter((vendor) => vendor.status === "Aktif" && (vendor.vendorType === "Hybrid" || (documentType === "SPK" ? vendor.vendorType !== "Supplier" : vendor.vendorType !== "Jasa"))).map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}</option>)}</select></label>
        <label className="field full"><span>{id ? "Quotation diterima" : "Accepted Quotation"}</span><select required value={quotationId} onChange={(event) => { setQuotationId(event.target.value); setDraftLines({}); }}><option value="">{id ? "Pilih Quotation" : "Choose Quotation"}</option>{acceptedScopes.map((scope) => <option value={scope.quotation?.id} key={scope.id}>{scope.quotation?.number} · {scope.kind} · {scope.title}</option>)}</select></label>
        <div className="field full procurement-line-picker"><span>{id ? "Item BoQ yang dialokasikan" : "Allocated BoQ items"}</span>{compatibleItems.map((item) => { const line = draftLines[item.id] ?? { selected: false, quantity: item.quantity, agreedUnitCost: item.costPrice }; return <div className="procurement-line" key={item.id}><label><input type="checkbox" checked={line.selected} onChange={() => setDraftLines((current) => ({ ...current, [item.id]: { ...line, selected: !line.selected } }))} /><span><strong>{item.description}</strong><small>{item.category} · tersedia {item.quantity} {item.unit}</small></span></label><input aria-label={`${item.description} quantity`} type="number" min="1" max={item.quantity} value={line.quantity} disabled={!line.selected} onChange={(event) => setDraftLines((current) => ({ ...current, [item.id]: { ...line, quantity: Number(event.target.value) } }))} /><input aria-label={`${item.description} vendor price`} type="number" min="0" value={line.agreedUnitCost} disabled={!line.selected} onChange={(event) => setDraftLines((current) => ({ ...current, [item.id]: { ...line, agreedUnitCost: Number(event.target.value) } }))} /></div>; })}{quotationId && !compatibleItems.length && <small>{id ? "Tidak ada item yang sesuai dengan jenis dokumen ini." : "No items match this document type."}</small>}</div>
        <label className="field"><span>{id ? "DP (%)" : "Down payment (%)"}</span><input type="number" min="0" max="99" value={dpPercentage} onChange={(event) => setDpPercentage(Number(event.target.value))} /></label>
        <div className="field order-total-preview"><span>{id ? "Nilai komitmen" : "Committed value"}</span><strong>{formatCurrency(orderCost, language)}</strong></div>
        <label className="field"><span>{id ? "Mulai" : "Start"}</span><input type="date" value={orderStart} onChange={(event) => setOrderStart(event.target.value)} /></label>
        <label className="field"><span>{id ? "Selesai" : "End"}</span><input type="date" value={orderEnd} onChange={(event) => setOrderEnd(event.target.value)} /></label>
        <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowOrder(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy === "order" || orderCost <= 0}>{id ? "Simpan draft" : "Save draft"}</button></div>
      </form></section></div>}

      {acceptingScope && <div className="modal-backdrop" onMouseDown={() => setAcceptingScope(null)}><section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">CLIENT ACCEPTANCE</span><h2>{acceptingScope.quotation?.number}</h2></div><button className="icon-button" type="button" onClick={() => setAcceptingScope(null)}><X size={18} /></button></div><form className="form-grid" onSubmit={saveAcceptance}><label className="field full"><span>{id ? "Tanggal persetujuan" : "Acceptance date"}</span><input required type="date" max={serverToday} value={acceptanceDate} onChange={(event) => setAcceptanceDate(event.target.value)} /></label><label className="field full"><span>{id ? "Bukti persetujuan (PDF/gambar)" : "Acceptance proof (PDF/image)"}</span><input required type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setAcceptanceFile(event.target.files?.[0] ?? null)} /></label><div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setAcceptingScope(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy === "acceptance"}>{id ? "Terima & kunci" : "Accept & lock"}</button></div></form></section></div>}

      {showAddendum && (
        <div className="modal-backdrop" onMouseDown={() => setShowAddendum(false)}>
          <section
            className="modal-card wide"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">BOQ ADDENDUM</span>
                <h2>{id ? "Pekerjaan tambah" : "Additional work"}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowAddendum(false)}>
                <X size={18} />
              </button>
            </div>
            <form className="form-grid" onSubmit={saveAddendum}>
              <label className="field full">
                <span>{id ? "Judul addendum" : "Addendum title"}</span>
                <input required value={addendumTitle} onChange={(event) => setAddendumTitle(event.target.value)} />
              </label>
              <div className="boq-catalog-callout full">
                <span className="metric-icon teal"><LibraryBig size={18} /></span>
                <span>
                  <strong>{id ? "Ambil item dari Database Item" : "Select from Item Database"}</strong>
                  <small>
                    {addendumCatalogItemId
                      ? `${addendumDescription} · H${addendumCatalogPriceTier}`
                      : id
                        ? "Kategori, merek, model, dan harga akan terisi otomatis."
                        : "Category, brand, model, and price are filled automatically."}
                  </small>
                </span>
                <button className="button secondary small" type="button" onClick={() => setAddendumCatalogOpen(true)}>
                  <LibraryBig size={15} /> {id ? "Buka katalog" : "Open catalog"}
                </button>
              </div>
              <label className="field">
                <span>{id ? "Kategori item" : "Item category"}</span>
                <select disabled={Boolean(addendumCatalogItemId)} value={addendumCategory} onChange={(event) => setAddendumCategory(event.target.value as typeof addendumCategory)}>
                  <option>Perangkat</option><option>Material</option><option>Jasa</option><option>Mobilitas</option>
                </select>
              </label>
              <label className="field">
                <span>{id ? "Satuan" : "Unit"}</span>
                <input required readOnly={Boolean(addendumCatalogItemId)} value={addendumUnit} onChange={(event) => setAddendumUnit(event.target.value)} />
              </label>
              <label className="field full">
                <span>{id ? "Deskripsi pekerjaan tambah" : "Additional work description"}</span>
                <input required readOnly={Boolean(addendumCatalogItemId)} value={addendumDescription} onChange={(event) => setAddendumDescription(event.target.value)} />
              </label>
              <label className="field"><span>Qty</span><input required type="number" min="1" value={addendumQuantity} onChange={(event) => setAddendumQuantity(Number(event.target.value))} /></label>
              <label className="field"><span>{id ? "Harga pokok" : "Cost price"}</span><input required readOnly={Boolean(addendumCatalogItemId)} type="number" min="0" value={addendumCost || ""} onChange={(event) => setAddendumCost(Number(event.target.value))} /></label>
              <label className="field full"><span>{id ? "Harga jual" : "Selling price"}</span><input required readOnly={Boolean(addendumCatalogItemId)} type="number" min="0" value={addendumSelling || ""} onChange={(event) => setAddendumSelling(Number(event.target.value))} /></label>
              <div className="modal-actions full">
                {addendumCatalogItemId && <button className="button ghost" type="button" onClick={() => { setAddendumCatalogItemId(null); setAddendumCatalogPriceTier(null); }}>{id ? "Gunakan item manual" : "Use manual item"}</button>}
                <button className="button secondary" type="button" onClick={() => setShowAddendum(false)}>{id ? "Batal" : "Cancel"}</button>
                <button className="button primary" disabled={busy === "addendum"}>{id ? "Buat Addendum" : "Create Addendum"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {addendumCatalogOpen ? (
        <CatalogPicker
          language={language}
          notify={notify}
          onClose={() => setAddendumCatalogOpen(false)}
          onSelect={useCatalogForAddendum}
        />
      ) : null}

      {editingScopeValidity && <div className="modal-backdrop" onMouseDown={() => setEditingScopeValidity(null)}><section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">QUOTATION VALIDITY</span><h2>{editingScopeValidity.quotation?.number}</h2></div><button className="icon-button" type="button" onClick={() => setEditingScopeValidity(null)}><X size={18} /></button></div><form className="form-grid" onSubmit={saveScopeValidity}><label className="field full"><span>{id ? "Tanggal terbit" : "Issue date"}</span><input required type="date" value={scopeIssuedAt} onChange={(event) => setScopeIssuedAt(event.target.value)} /></label><label className="field full"><span>{id ? "Berlaku sampai" : "Valid until"}</span><input required type="date" min={scopeIssuedAt} value={scopeValidUntil} onChange={(event) => setScopeValidUntil(event.target.value)} /></label><div className="field full"><span>{id ? "Pilihan cepat" : "Quick validity"}</span><div className="title-actions">{[7, 14, 30, 60].map((days) => <button className="button subtle small" type="button" key={days} onClick={() => setScopeValidityDays(days)}>{days} {id ? "hari" : "days"}</button>)}</div></div><div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setEditingScopeValidity(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy === "scope-validity"}>{id ? "Simpan masa berlaku" : "Save validity"}</button></div></form></section></div>}

      {paymentOrder && <div className="modal-backdrop" onMouseDown={() => setPaymentOrder(null)}><section className="modal-card wide" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{id ? "PEMBAYARAN AKTUAL" : "ACTUAL PAYMENT"}</span><h2>{paymentOrder.number}</h2></div><button className="icon-button" type="button" onClick={() => setPaymentOrder(null)}><X size={18} /></button></div><form className="form-grid" onSubmit={savePayment}><label className="field"><span>{id ? "Termin" : "Term"}</span><select value={paymentTermId} onChange={(event) => setPaymentTermId(event.target.value)}>{paymentOrder.terms.map((term) => <option value={term.id} key={term.id}>{term.label} · {formatCurrency(term.plannedAmount, language)}</option>)}</select></label><label className="field"><span>{id ? "Bruto diselesaikan" : "Gross settled"}</span><input required type="number" min="1" max={paymentOrder.availableToPay} value={paymentAmount || ""} onChange={(event) => { const gross = Number(event.target.value); setPaymentAmount(gross); setPaymentCashAmount(Math.max(0, gross - paymentWithholdingAmount)); }} /></label><label className="field"><span>{id ? "Pajak dipotong" : "Tax withheld"}</span><input required type="number" min="0" max={paymentOrder.taxWithholdings ?? 0} value={paymentWithholdingAmount} onChange={(event) => { const withholding = Number(event.target.value); setPaymentWithholdingAmount(withholding); setPaymentCashAmount(Math.max(0, paymentAmount - withholding)); }} /></label><label className="field"><span>{id ? "Kas aktual dibayar" : "Actual cash paid"}</span><input required type="number" min="0" value={paymentCashAmount} onChange={(event) => setPaymentCashAmount(Number(event.target.value))} /></label><label className="field"><span>{id ? "Tanggal bayar" : "Payment date"}</span><input required type="date" max={serverToday} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label><label className="field"><span>{id ? "Nomor tagihan vendor" : "Vendor invoice number"}</span><input required value={vendorInvoice} onChange={(event) => setVendorInvoice(event.target.value)} /></label><label className="field"><span>{id ? "Referensi pembayaran" : "Payment reference"}</span><input required value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label><label className="field"><span>{id ? "Metode" : "Method"}</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option>Transfer Bank</option><option>Tunai</option><option>Kartu</option><option>Lainnya</option></select></label>{paymentMethod === "Transfer Bank" && <label className="field full"><span>{id ? "Rekening perusahaan" : "Company bank account"}</span><select required value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>{banks.filter((bank) => bank.status === "Aktif").map((bank) => <option value={bank.id} key={bank.id}>{bank.bankName} · {bank.accountNumberMasked}</option>)}</select></label>}<label className="field full"><span>{id ? "Bukti pembayaran" : "Payment proof"}</span><input required type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setPaymentFile(event.target.files?.[0] ?? null)} /></label><div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setPaymentOrder(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy === "payment" || paymentAmount <= 0 || paymentAmount !== paymentCashAmount + paymentWithholdingAmount}>{id ? "Catat pembayaran" : "Post payment"}</button></div></form></section></div>}

      <DocumentPreviewModal
        open={Boolean(preview)}
        url={preview?.url ?? ""}
        title={preview?.title ?? ""}
        filename={preview?.filename ?? "dokumen.pdf"}
        onClose={() => setPreview(null)}
      />

      {verificationOrder && <div className="modal-backdrop" onMouseDown={() => setVerificationOrder(null)}><section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{verificationOrder.documentType === "PO" ? "GOODS RECEIPT" : "PROGRESS VERIFICATION"}</span><h2>{verificationOrder.number}</h2></div><button className="icon-button" type="button" onClick={() => setVerificationOrder(null)}><X size={18} /></button></div><form className="form-grid" onSubmit={saveVerification}>{verificationOrder.documentType === "PO" ? <><label className="field full"><span>{id ? "Nomor surat jalan" : "Delivery note number"}</span><input required value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} /></label><div className="statement-guidance full"><PackageCheck size={18} /><span><strong>{id ? "Terima seluruh sisa item" : "Receive all remaining items"}</strong><small>{id ? "Kuantitas yang sudah diterima tidak akan dihitung ulang." : "Previously received quantities will not be counted twice."}</small></span></div></> : <><label className="field full"><span>{id ? "Termin" : "Term"}</span><select value={verificationTermId} onChange={(event) => setVerificationTermId(event.target.value)}>{verificationOrder.terms.filter((term) => term.type !== "DP").map((term) => <option value={term.id} key={term.id}>{term.label}</option>)}</select></label><label className="field"><span>{id ? "Nilai terverifikasi" : "Verified amount"}</span><input required type="number" min="1" value={verificationAmount || ""} onChange={(event) => setVerificationAmount(Number(event.target.value))} /></label><label className="field"><span>{id ? "Progres (%)" : "Progress (%)"}</span><input required type="number" min="0" max="100" value={verificationProgress} onChange={(event) => setVerificationProgress(Number(event.target.value))} /></label><label className="field full"><span>{id ? "Catatan" : "Notes"}</span><textarea value={verificationNotes} onChange={(event) => setVerificationNotes(event.target.value)} /></label></>}<div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setVerificationOrder(null)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" disabled={busy === "verification"}>{verificationOrder.documentType === "PO" ? (id ? "Catat penerimaan" : "Record receipt") : (id ? "Simpan verifikasi" : "Save verification")}</button></div></form></section></div>}
    </div>
  );
}
