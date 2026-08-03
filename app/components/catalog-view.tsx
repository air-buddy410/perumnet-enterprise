"use client";

import {
  AlertTriangle,
  Boxes,
  Check,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Layers3,
  Link,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError, downloadApiFile, messageOf } from "../api-client";
import type { CatalogBrand, CatalogCategory, CatalogItem, CatalogPayload } from "../data";
import { formatCurrency } from "../data";
import type { AppLanguage } from "../i18n";

type EditorMode = "item" | "category" | "brand" | null;
type ItemFormState = {
  categoryId: string; brandId: string; sku: string; name: string; nameEn: string;
  model: string; specifications: string; unit: string; costPrice: number;
  margin1Percent: number; margin2Percent: number; status: "Aktif" | "Nonaktif";
};

type CatalogAiRecommendation = {
  brand: string;
  productCategory: string;
  boqRole: "Perangkat" | "Material" | "Jasa" | "Mobilitas";
  nameId: string;
  nameEn: string;
  model: string;
  sku: string;
  unit: string;
  specifications: string[];
  marketPrice: { min: number; max: number; currency: "IDR" };
  recommendedCostPrice: number;
  margin1Percent: number;
  margin2Percent: number;
  price1: number;
  price2: number;
  confidence: number;
  assumptions: string[];
  warnings: string[];
};

type CatalogAiRun = {
  id: string;
  status: "Running" | "Draft" | "Approved" | "Rejected" | "Failed";
  query: string;
  sourceUrl?: string | null;
  model: string;
  confidence: number;
  expiresAt?: string | null;
  errorMessage?: string | null;
  recommendation?: CatalogAiRecommendation | null;
  sources: Array<{ title: string; url: string; accessedAt: string }>;
  catalogItemId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type AiPhase = "loading" | "idle" | "analyzing" | "draft-review" | "failed" | "approved" | "rejected";

type AiReviewForm = {
  sku: string; name: string; nameEn: string; model: string; unit: string;
  specifications: string; costPrice: number; margin1Percent: number; margin2Percent: number;
};

const emptyAiForm: AiReviewForm = {
  sku: "", name: "", nameEn: "", model: "", unit: "unit",
  specifications: "", costPrice: 0, margin1Percent: 20, margin2Percent: 30,
};

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const roles = ["Perangkat", "Material", "Jasa", "Mobilitas"] as const;
const emptyItem: ItemFormState = {
  categoryId: "", brandId: "", sku: "", name: "", nameEn: "", model: "",
  specifications: "", unit: "unit", costPrice: 0, margin1Percent: 20,
  margin2Percent: 30, status: "Aktif" as const,
};

export function CatalogView({ language, notify }: { language: AppLanguage; notify: (message: string) => void }) {
  const id = language === "id";
  const [data, setData] = useState<CatalogPayload>({ categories: [], brands: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [editor, setEditor] = useState<EditorMode>(null);
  const [editingId, setEditingId] = useState("");
  const [itemForm, setItemForm] = useState<ItemFormState>(emptyItem);
  const [categoryForm, setCategoryForm] = useState({ boqRole: "Perangkat", name: "", nameEn: "", defaultMargin1Percent: 20, defaultMargin2Percent: 30, status: "Aktif", sortOrder: 0 });
  const [brandForm, setBrandForm] = useState({ categoryId: "", name: "", status: "Aktif", sortOrder: 0 });
  const importRef = useRef<HTMLInputElement>(null);
  const aiFileRef = useRef<HTMLInputElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPhase, setAiPhase] = useState<AiPhase>("loading");
  const [aiQuery, setAiQuery] = useState("");
  const [aiSourceUrl, setAiSourceUrl] = useState("");
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRun, setAiRun] = useState<CatalogAiRun | null>(null);
  const [aiCategoryId, setAiCategoryId] = useState("");
  const [aiBrandId, setAiBrandId] = useState("");
  const [aiForm, setAiForm] = useState<AiReviewForm>(emptyAiForm);
  const [aiOverrideReason, setAiOverrideReason] = useState("");
  const [aiShowOverride, setAiShowOverride] = useState(false);
  const [aiActionError, setAiActionError] = useState("");
  const [aiElapsed, setAiElapsed] = useState(0);
  const [aiPollTimedOut, setAiPollTimedOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<CatalogPayload>("/api/catalog?includeInactive=true"));
    } catch (error) {
      notify(messageOf(error, language));
    } finally {
      setLoading(false);
    }
  }, [language, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const categories = useMemo(() => data.categories.filter((entry) => !role || entry.boqRole === role), [data.categories, role]);
  const brands = useMemo(() => data.brands.filter((entry) => !categoryId || entry.categoryId === categoryId), [data.brands, categoryId]);
  const items = useMemo(() => data.items.filter((entry) => {
    const needle = query.trim().toLowerCase();
    return (!role || entry.boqRole === role) && (!categoryId || entry.categoryId === categoryId) &&
      (!brandId || entry.brandId === brandId) && (!needle || [entry.name, entry.sku, entry.model, entry.brand ?? ""].some((value) => value.toLowerCase().includes(needle)));
  }), [brandId, categoryId, data.items, query, role]);

  function openItem(item?: CatalogItem) {
    setEditor("item"); setEditingId(item?.id ?? "");
    setItemForm(item ? {
      categoryId: item.categoryId, brandId: item.brandId ?? "", sku: item.sku, name: item.name,
      nameEn: item.nameEn, model: item.model, specifications: item.specifications, unit: item.unit,
      costPrice: item.costPrice, margin1Percent: item.margin1Percent, margin2Percent: item.margin2Percent,
      status: item.status,
    } : { ...emptyItem, categoryId: data.categories.find((entry) => entry.status === "Aktif")?.id ?? "" });
  }

  function openCategory(category?: CatalogCategory) {
    setEditor("category"); setEditingId(category?.id ?? "");
    setCategoryForm(category ? { boqRole: category.boqRole, name: category.name, nameEn: category.nameEn,
      defaultMargin1Percent: category.defaultMargin1Percent, defaultMargin2Percent: category.defaultMargin2Percent,
      status: category.status, sortOrder: category.sortOrder } :
      { boqRole: "Perangkat", name: "", nameEn: "", defaultMargin1Percent: 20, defaultMargin2Percent: 30, status: "Aktif", sortOrder: data.categories.length * 10 });
  }

  function openBrand(brand?: CatalogBrand) {
    setEditor("brand"); setEditingId(brand?.id ?? "");
    setBrandForm(brand ? { categoryId: brand.categoryId, name: brand.name, status: brand.status, sortOrder: brand.sortOrder } :
      { categoryId: categoryId || data.categories.find((entry) => entry.boqRole === "Perangkat")?.id || "", name: "", status: "Aktif", sortOrder: data.brands.length * 10 });
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    try {
      const body = editor === "item"
        ? { ...itemForm, brandId: itemForm.brandId || null }
        : editor === "category" ? categoryForm : brandForm;
      const resource = editor === "item" ? "items" : editor === "category" ? "categories" : "brands";
      await api(`/api/catalog/${resource}${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      notify(id ? "Database item berhasil diperbarui." : "Item database updated.");
      setEditor(null); setEditingId(""); await load();
    } catch (error) { notify(messageOf(error, language)); }
  }

  async function remove(resource: "items" | "categories" | "brands", entityId: string, label: string) {
    if (!window.confirm(id ? `Hapus ${label}? Data yang sudah dipakai tidak dapat dihapus.` : `Delete ${label}? Used data cannot be deleted.`)) return;
    try {
      await api(`/api/catalog/${resource}/${entityId}`, { method: "DELETE" });
      notify(id ? `${label} berhasil dihapus.` : `${label} deleted.`); await load();
    } catch (error) { notify(messageOf(error, language)); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    const form = new FormData(); form.append("file", file);
    try {
      const result = await api<{ imported: number; synchronized: number }>("/api/catalog/import", { method: "POST", body: form });
      notify(id ? `${result.imported} item diimpor; ${result.synchronized} baris BoQ disinkronkan.` : `${result.imported} items imported; ${result.synchronized} BoQ rows synchronized.`);
      await load();
    } catch (error) { notify(messageOf(error, language)); }
    finally { if (importRef.current) importRef.current.value = ""; }
  }

  async function fileToBase64(file: File) {
    if (file.size > 10 * 1024 * 1024) throw new Error(id ? "Berkas maksimal 10 MB." : "The file must not exceed 10 MB.");
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(id ? "Berkas tidak dapat dibaca." : "The file could not be read."));
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.readAsDataURL(file);
    });
  }

  const selectSuggestedClassification = useCallback((run: CatalogAiRun) => {
    const recommendation = run.recommendation;
    if (!recommendation) return;
    const normalizedCategory = recommendation.productCategory.trim().toLowerCase();
    const suggestedCategory = data.categories.find((entry) =>
      entry.status === "Aktif" && entry.boqRole === recommendation.boqRole &&
      [entry.name, entry.nameEn].some((value) => value.trim().toLowerCase() === normalizedCategory),
    ) ?? data.categories.find((entry) => entry.status === "Aktif" && entry.boqRole === recommendation.boqRole);
    setAiCategoryId(suggestedCategory?.id ?? "");
    const suggestedBrand = data.brands.find((entry) => entry.status === "Aktif" &&
      entry.categoryId === suggestedCategory?.id && entry.name.trim().toLowerCase() === recommendation.brand.trim().toLowerCase());
    setAiBrandId(suggestedBrand?.id ?? "");
  }, [data.brands, data.categories]);

  const enterDraftReview = useCallback((run: CatalogAiRun) => {
    const recommendation = run.recommendation;
    setAiRun(run);
    if (recommendation) {
      setAiForm({
        sku: recommendation.sku,
        name: recommendation.nameId,
        nameEn: recommendation.nameEn,
        model: recommendation.model,
        unit: recommendation.unit,
        specifications: recommendation.specifications.join("\n"),
        costPrice: recommendation.recommendedCostPrice,
        margin1Percent: recommendation.margin1Percent,
        margin2Percent: recommendation.margin2Percent,
      });
    }
    selectSuggestedClassification(run);
    setAiOverrideReason("");
    setAiShowOverride(Boolean(run.expiresAt && run.expiresAt < new Date().toISOString()));
    setAiActionError("");
    setAiPhase("draft-review");
  }, [selectSuggestedClassification]);

  useEffect(() => {
    if (!aiOpen) return;
    let active = true;
    api<CatalogAiRun[]>("/api/catalog/ai?mine=1")
      .then((runs) => {
        if (!active) return;
        const running = runs.find((entry) => entry.status === "Running");
        const draft = runs.find((entry) => entry.status === "Draft");
        if (running) {
          setAiRun(running);
          setAiQuery(running.query);
          setAiSourceUrl(running.sourceUrl ?? "");
          setAiElapsed(Math.max(0, Math.floor((Date.now() - new Date(running.createdAt).getTime()) / 1_000)));
          setAiPollTimedOut(false);
          setAiPhase("analyzing");
        } else if (draft?.recommendation) {
          setAiQuery(draft.query);
          setAiSourceUrl(draft.sourceUrl ?? "");
          enterDraftReview(draft);
        } else {
          setAiPhase("idle");
        }
      })
      .catch(() => { if (active) setAiPhase("idle"); });
    return () => { active = false; };
  }, [aiOpen, enterDraftReview]);

  useEffect(() => {
    if (!aiOpen || aiPhase !== "analyzing" || !aiRun) return;
    const runId = aiRun.id;
    const startedAt = new Date(aiRun.createdAt).getTime();
    const ticker = window.setInterval(() => {
      setAiElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    }, 1_000);
    const poller = window.setInterval(() => {
      if (Date.now() - startedAt > 600_000) {
        setAiPollTimedOut(true);
        window.clearInterval(poller);
        return;
      }
      api<CatalogAiRun>(`/api/catalog/ai/runs/${runId}`)
        .then((run) => {
          if (run.status === "Draft") {
            enterDraftReview(run);
          } else if (run.status === "Failed") {
            setAiRun(run);
            setAiPhase("failed");
          } else if (run.status === "Approved") {
            setAiRun(run);
            setAiPhase("approved");
          } else if (run.status === "Rejected") {
            setAiRun(run);
            setAiPhase("rejected");
          }
        })
        .catch(() => undefined);
    }, 3_000);
    return () => {
      window.clearInterval(ticker);
      window.clearInterval(poller);
    };
  }, [aiOpen, aiPhase, aiRun, enterDraftReview]);

  function resetAiToIdle() {
    setAiRun(null);
    setAiCategoryId("");
    setAiBrandId("");
    setAiForm(emptyAiForm);
    setAiOverrideReason("");
    setAiShowOverride(false);
    setAiActionError("");
    setAiPollTimedOut(false);
    setAiPhase("idle");
  }

  async function analyzeWithAi(event: FormEvent) {
    event.preventDefault();
    setAiLoading(true);
    setAiActionError("");
    try {
      const file = aiFile ? {
        name: aiFile.name,
        mimeType: aiFile.type,
        contentBase64: await fileToBase64(aiFile),
      } : undefined;
      const run = await api<CatalogAiRun>("/api/catalog/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ query: aiQuery, sourceUrl: aiSourceUrl || undefined, file }),
      });
      setAiRun(run);
      setAiElapsed(0);
      setAiPollTimedOut(false);
      setAiPhase("analyzing");
    } catch (error) {
      setAiActionError(messageOf(error, language));
    } finally {
      setAiLoading(false);
    }
  }

  async function approveAiRun(event: FormEvent) {
    event.preventDefault();
    if (!aiRun?.recommendation || !aiCategoryId || aiPhase !== "draft-review") return;
    setAiLoading(true);
    setAiActionError("");
    try {
      await api(`/api/catalog/ai/runs/${aiRun.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          categoryId: aiCategoryId,
          brandId: aiBrandId || null,
          sku: aiForm.sku.trim(),
          name: aiForm.name.trim(),
          nameEn: aiForm.nameEn.trim(),
          model: aiForm.model.trim(),
          specifications: aiForm.specifications,
          unit: aiForm.unit.trim(),
          costPrice: Math.round(aiForm.costPrice),
          margin1Percent: aiForm.margin1Percent,
          margin2Percent: aiForm.margin2Percent,
          ...(aiShowOverride ? { overrideReason: aiOverrideReason.trim() } : {}),
        }),
      });
      setAiPhase("approved");
      notify(id ? "Rekomendasi disetujui dan ditambahkan ke katalog." : "Recommendation approved and added to the catalog.");
      setAiOpen(false); setAiRun(null); setAiQuery(""); setAiSourceUrl(""); setAiFile(null);
      setAiCategoryId(""); setAiBrandId(""); setAiForm(emptyAiForm);
      setAiOverrideReason(""); setAiShowOverride(false);
      await load();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "AI_RECOMMENDATION_EXPIRED") {
        setAiShowOverride(true);
      }
      setAiActionError(messageOf(error, language));
    } finally {
      setAiLoading(false);
    }
  }

  async function rejectAiRun() {
    if (!aiRun) return;
    const reason = window.prompt(id ? "Alasan penolakan (minimal 5 karakter):" : "Reason for rejection (at least 5 characters):");
    if (!reason) return;
    setAiLoading(true);
    setAiActionError("");
    try {
      await api(`/api/catalog/ai/runs/${aiRun.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      notify(id ? "Rekomendasi AI ditolak." : "AI recommendation rejected.");
      setAiRun((current) => current ? { ...current, status: "Rejected" } : current);
      setAiPhase("rejected");
    } catch (error) {
      setAiActionError(messageOf(error, language));
    } finally {
      setAiLoading(false);
    }
  }

  const selectedCategory = data.categories.find((entry) => entry.id === itemForm.categoryId);
  const itemBrands = data.brands.filter((entry) => entry.categoryId === itemForm.categoryId && entry.status === "Aktif");
  const projectProducts = ["Networking", "CCTV", "IP PABX", "Smart Home Device"]
    .map((name) => data.categories.find((entry) => entry.boqRole === "Perangkat" && entry.name === name))
    .filter((entry): entry is CatalogCategory => Boolean(entry));
  const price1 = Math.round(itemForm.costPrice * (1 + itemForm.margin1Percent / 100));
  const price2 = Math.round(itemForm.costPrice * (1 + itemForm.margin2Percent / 100));
  const aiReviewPrice1 = Math.round(aiForm.costPrice * (1 + aiForm.margin1Percent / 100));
  const aiReviewPrice2 = Math.round(aiForm.costPrice * (1 + aiForm.margin2Percent / 100));
  const aiRequiresBrand = ["Perangkat", "Material"].includes(data.categories.find((entry) => entry.id === aiCategoryId)?.boqRole ?? "");
  const aiReviewValid = Boolean(aiCategoryId) && (!aiRequiresBrand || Boolean(aiBrandId)) &&
    aiForm.sku.trim().length >= 2 && aiForm.name.trim().length >= 2 && aiForm.unit.trim().length >= 1 &&
    Number.isFinite(aiForm.costPrice) && aiForm.costPrice >= 0 &&
    aiForm.margin1Percent >= 0 && aiForm.margin1Percent <= 1000 &&
    aiForm.margin2Percent >= 0 && aiForm.margin2Percent <= 1000 &&
    (!aiShowOverride || aiOverrideReason.trim().length >= 5);

  return <div className="page-stack catalog-page" data-testid="catalog-view">
    <section className="page-title-row">
      <div><span className="eyebrow">{id ? "MASTER DATA BOQ" : "BOQ MASTER DATA"}</span><h1>{id ? "Database item & harga" : "Item & pricing database"}</h1>
        <p>{id ? "Kelompokkan perangkat dan material berdasarkan kategori produk, merek, lalu model." : "Organize equipment and materials by product category, brand, then model."}</p></div>
      <div className="title-actions">
        <input ref={importRef} hidden type="file" accept=".xlsx" onChange={(event) => void importFile(event.target.files?.[0])} />
        <button className="button secondary" type="button" onClick={() => importRef.current?.click()}><FileUp size={16} /> Import Excel</button>
        <button className="button secondary" type="button" onClick={() => void downloadApiFile("/api/catalog/export.xlsx", "katalog-item.xlsx")}><Download size={16} /> Export</button>
        <button className="button ai-catalog-button" type="button" onClick={() => { setAiPhase("loading"); setAiActionError(""); setAiOpen(true); }}><Sparkles size={16} /> AI Assistant</button>
        <button className="button primary" type="button" onClick={() => openItem()}><Plus size={16} /> {id ? "Item baru" : "New item"}</button>
      </div>
    </section>

    <section className="catalog-summary-grid">
      {roles.map((entry) => <button type="button" key={entry} className={role === entry ? "active" : ""} onClick={() => { setRole(role === entry ? "" : entry); setCategoryId(""); setBrandId(""); }}>
        <span>{entry === "Perangkat" ? <Boxes size={19} /> : <Layers3 size={19} />}</span><strong>{entry}</strong><small>{data.items.filter((item) => item.boqRole === entry).length} item</small>
      </button>)}
    </section>

    <section className="catalog-product-strip" aria-label={id ? "Produk proyek" : "Project products"}>
      <div>
        <span className="eyebrow">{id ? "PRODUK PROYEK" : "PROJECT PRODUCTS"}</span>
        <strong>{id ? "Kategori perangkat utama" : "Primary device categories"}</strong>
      </div>
      {projectProducts.map((entry) => (
        <button
          type="button"
          key={entry.id}
          className={categoryId === entry.id ? "active" : ""}
          onClick={() => {
            setRole("Perangkat");
            setCategoryId(categoryId === entry.id ? "" : entry.id);
            setBrandId("");
          }}
        >
          <Boxes size={16} />
          <span><strong>{entry.name}</strong><small>{entry.itemCount} item</small></span>
        </button>
      ))}
    </section>

    <section className="panel catalog-panel">
      <div className="catalog-toolbar">
        <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari nama, SKU, model, atau merek..." : "Search name, SKU, model, or brand..."} /></label>
        <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setBrandId(""); }}><option value="">{id ? "Semua kategori" : "All categories"}</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
        <select value={brandId} onChange={(event) => setBrandId(event.target.value)}><option value="">{id ? "Semua merek" : "All brands"}</option>{brands.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
        <button className="button secondary small" type="button" onClick={() => openCategory()}><Tags size={15} /> {id ? "Kategori" : "Category"}</button>
        <button className="button secondary small" type="button" onClick={() => openBrand()}><Plus size={15} /> {id ? "Merek" : "Brand"}</button>
      </div>
      <div className="table-scroll"><table className="data-table catalog-table"><thead><tr><th>Item / Model</th><th>{id ? "Kategori" : "Category"}</th><th>{id ? "Merek" : "Brand"}</th><th>{id ? "Harga pokok" : "Cost"}</th><th>{id ? "Harga 1" : "Price 1"}</th><th>{id ? "Harga 2" : "Price 2"}</th><th>Status</th><th><span className="sr-only">Aksi</span></th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id} className={item.status === "Nonaktif" ? "catalog-inactive" : ""}><td><div className="catalog-item-name"><strong>{item.name}</strong><span>{item.model || item.sku}</span><small>{item.sku}</small></div></td>
          <td><strong>{item.category}</strong><small className="table-subline">{item.boqRole}</small></td><td>{item.brand ?? "—"}</td><td>{formatCurrency(item.costPrice, language)}</td>
          <td><strong>{formatCurrency(item.price1, language)}</strong><small className="table-subline">+{item.margin1Percent}%</small></td><td><strong>{formatCurrency(item.price2, language)}</strong><small className="table-subline">+{item.margin2Percent}%</small></td>
          <td><span className={`status-badge ${item.status === "Aktif" ? "success" : "muted"}`}>{item.status}</span></td><td><div className="table-row-actions"><button className="icon-button" type="button" onClick={() => openItem(item)} aria-label={`Edit ${item.name}`}><Pencil size={15} /></button><button className="icon-button danger" type="button" onClick={() => void remove("items", item.id, item.name)} aria-label={`Hapus ${item.name}`}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>
      {loading ? <div className="catalog-empty">{id ? "Memuat katalog..." : "Loading catalog..."}</div> : !items.length ? <div className="catalog-empty">{id ? "Belum ada item pada filter ini." : "No items match these filters."}</div> : null}
    </section>

    {editor && <div className="modal-backdrop catalog-modal-backdrop" role="presentation"><form className="catalog-editor" onSubmit={saveEditor}>
      <div className="panel-head"><div><span className="eyebrow">{editor === "item" ? (id ? "ITEM KATALOG" : "CATALOG ITEM") : editor === "category" ? (id ? "KATEGORI" : "CATEGORY") : (id ? "MEREK" : "BRAND")}</span><h2>{editingId ? (id ? "Edit data" : "Edit data") : (id ? "Tambah data" : "Add data")}</h2></div><button className="icon-button" type="button" onClick={() => setEditor(null)}><X size={18} /></button></div>
      <div className="catalog-editor-body">
        {editor === "item" && <>
          <div className="form-grid two-columns"><label className="field select-field"><span>{id ? "Kategori" : "Category"}</span><select required value={itemForm.categoryId} onChange={(event) => { const next = data.categories.find((entry) => entry.id === event.target.value); setItemForm((current) => ({ ...current, categoryId: event.target.value, brandId: "", margin1Percent: next?.defaultMargin1Percent ?? current.margin1Percent, margin2Percent: next?.defaultMargin2Percent ?? current.margin2Percent })); }}>{data.categories.filter((entry) => entry.status === "Aktif" || entry.id === itemForm.categoryId).map((entry) => <option key={entry.id} value={entry.id}>{entry.boqRole} · {entry.name}</option>)}</select></label>
            <label className="field select-field"><span>{id ? "Merek" : "Brand"}{["Perangkat", "Material"].includes(selectedCategory?.boqRole ?? "") ? " *" : ""}</span><select required={["Perangkat", "Material"].includes(selectedCategory?.boqRole ?? "")} value={itemForm.brandId} onChange={(event) => setItemForm((current) => ({ ...current, brandId: event.target.value }))}><option value="">{id ? "Tanpa merek" : "No brand"}</option>{itemBrands.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></div>
          <div className="form-grid two-columns"><label className="field"><span>SKU</span><input required value={itemForm.sku} onChange={(event) => setItemForm((current) => ({ ...current, sku: event.target.value }))} /></label><label className="field"><span>{id ? "Model" : "Model"}</span><input value={itemForm.model} onChange={(event) => setItemForm((current) => ({ ...current, model: event.target.value }))} /></label></div>
          <label className="field"><span>{id ? "Nama item" : "Item name"}</span><input required value={itemForm.name} onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field"><span>{id ? "Nama Inggris" : "English name"}</span><input value={itemForm.nameEn} onChange={(event) => setItemForm((current) => ({ ...current, nameEn: event.target.value }))} /></label>
          <label className="field"><span>{id ? "Spesifikasi" : "Specifications"}</span><textarea value={itemForm.specifications} onChange={(event) => setItemForm((current) => ({ ...current, specifications: event.target.value }))} /></label>
          <div className="form-grid two-columns"><label className="field"><span>{id ? "Satuan" : "Unit"}</span><input required value={itemForm.unit} onChange={(event) => setItemForm((current) => ({ ...current, unit: event.target.value }))} /></label><label className="field"><span>{id ? "Harga pokok" : "Cost price"}</span><input type="number" min="0" required value={itemForm.costPrice || ""} onChange={(event) => setItemForm((current) => ({ ...current, costPrice: Number(event.target.value) }))} /></label></div>
          <div className="catalog-price-grid"><label className="field"><span>Margin 1 (%)</span><input type="number" min="0" step="0.01" value={itemForm.margin1Percent} onChange={(event) => setItemForm((current) => ({ ...current, margin1Percent: Number(event.target.value) }))} /><strong>{formatCurrency(price1, language)}</strong></label><label className="field"><span>Margin 2 (%)</span><input type="number" min="0" step="0.01" value={itemForm.margin2Percent} onChange={(event) => setItemForm((current) => ({ ...current, margin2Percent: Number(event.target.value) }))} /><strong>{formatCurrency(price2, language)}</strong></label></div>
          <label className="field select-field"><span>Status</span><select value={itemForm.status} onChange={(event) => setItemForm((current) => ({ ...current, status: event.target.value as "Aktif" | "Nonaktif" }))}><option>Aktif</option><option>Nonaktif</option></select></label>
        </>}
        {editor === "category" && <><label className="field select-field"><span>{id ? "Peran di BoQ" : "BoQ role"}</span><select value={categoryForm.boqRole} onChange={(event) => setCategoryForm((current) => ({ ...current, boqRole: event.target.value }))}>{roles.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label className="field"><span>{id ? "Nama kategori" : "Category name"}</span><input required value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="field"><span>{id ? "Nama Inggris" : "English name"}</span><input value={categoryForm.nameEn} onChange={(event) => setCategoryForm((current) => ({ ...current, nameEn: event.target.value }))} /></label><div className="form-grid two-columns"><label className="field"><span>Default Margin 1 (%)</span><input type="number" min="0" value={categoryForm.defaultMargin1Percent} onChange={(event) => setCategoryForm((current) => ({ ...current, defaultMargin1Percent: Number(event.target.value) }))} /></label><label className="field"><span>Default Margin 2 (%)</span><input type="number" min="0" value={categoryForm.defaultMargin2Percent} onChange={(event) => setCategoryForm((current) => ({ ...current, defaultMargin2Percent: Number(event.target.value) }))} /></label></div><div className="catalog-related-list"><strong>{id ? "Kategori tersedia" : "Available categories"}</strong>{data.categories.map((entry) => <button type="button" key={entry.id} onClick={() => openCategory(entry)}><span>{entry.boqRole} · {entry.name}</span><Pencil size={14} /></button>)}</div></>}
        {editor === "brand" && <><label className="field select-field"><span>{id ? "Kategori" : "Category"}</span><select required value={brandForm.categoryId} onChange={(event) => setBrandForm((current) => ({ ...current, categoryId: event.target.value }))}>{data.categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.boqRole} · {entry.name}</option>)}</select></label><label className="field"><span>{id ? "Nama merek" : "Brand name"}</span><input required value={brandForm.name} onChange={(event) => setBrandForm((current) => ({ ...current, name: event.target.value }))} /></label><div className="catalog-related-list"><strong>{id ? "Merek tersedia" : "Available brands"}</strong>{data.brands.filter((entry) => entry.categoryId === brandForm.categoryId).map((entry) => <button type="button" key={entry.id} onClick={() => openBrand(entry)}><span>{entry.name}</span><Pencil size={14} /></button>)}</div></>}
      </div><div className="catalog-editor-actions">{editingId && <button className="button danger" type="button" onClick={() => void remove(editor === "item" ? "items" : editor === "category" ? "categories" : "brands", editingId, editor)}><Trash2 size={15} /> {id ? "Hapus" : "Delete"}</button>}<button className="button primary" type="submit"><Save size={16} /> {id ? "Simpan" : "Save"}</button></div>
    </form></div>}

    {aiOpen && <div className="modal-backdrop catalog-modal-backdrop" role="presentation">
      <aside className="catalog-ai-drawer" role="dialog" aria-modal="true" aria-labelledby="catalog-ai-title">
        <header className="catalog-ai-head">
          <div><span className="eyebrow"><Sparkles size={13} /> AI CATALOG ASSISTANT</span><h2 id="catalog-ai-title">{id ? "Riset perangkat lebih cepat" : "Research products faster"}</h2><p>{id ? "AI merangkum data publik. Harga akhir tetap dihitung aplikasi dan wajib ditinjau manusia." : "AI summarizes public data. Final prices remain deterministic and require human review."}</p></div>
          <button className="icon-button" type="button" onClick={() => setAiOpen(false)} aria-label={id ? "Tutup" : "Close"}><X size={18} /></button>
        </header>

        {aiPhase === "loading" && <div className="catalog-ai-result">
          <section className="catalog-ai-progress">
            <LoaderCircle className="spin" size={20} />
            <div><strong>{id ? "Memuat status analisis..." : "Loading analysis status..."}</strong></div>
          </section>
        </div>}

        {aiPhase === "idle" && <form className="catalog-ai-input" onSubmit={analyzeWithAi}>
          <label className="field"><span>{id ? "Model, SKU, atau kebutuhan perangkat" : "Model, SKU, or product requirement"}</span><textarea required minLength={2} maxLength={500} value={aiQuery} onChange={(event) => setAiQuery(event.target.value)} placeholder="Contoh: Ruijie Reyee RG-RAP2260(E), access point WiFi 6 indoor" /></label>
          <label className="field"><span><Link size={14} /> {id ? "URL produk (disarankan — halaman akan dibaca otomatis)" : "Product URL (recommended — the page is read automatically)"}</span><input type="url" value={aiSourceUrl} onChange={(event) => setAiSourceUrl(event.target.value)} placeholder="https://..." /></label>
          <input ref={aiFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => setAiFile(event.target.files?.[0] ?? null)} />
          <button className="catalog-ai-file" type="button" onClick={() => aiFileRef.current?.click()}><FileText size={20} /><span><strong>{aiFile?.name ?? (id ? "Tambahkan foto atau datasheet" : "Add a photo or datasheet")}</strong><small>PNG, JPG, WebP, PDF · maks. 10 MB</small></span></button>
          <div className="catalog-ai-safety"><Check size={15} /><p>{id ? "Data klien, proyek, dan vendor tidak dikirim. Halaman produk yang dibaca diperlakukan sebagai data yang tidak tepercaya." : "Client, project, and vendor data is never sent. Fetched page content is treated as untrusted data."}</p></div>
          {aiActionError && <section className="catalog-ai-error" role="alert"><strong><AlertTriangle size={14} /> {id ? "Analisis tidak dapat dimulai" : "The analysis could not start"}</strong><p>{aiActionError}</p></section>}
          <button className="button primary catalog-ai-submit" type="submit" disabled={aiLoading || aiQuery.trim().length < 2}>{aiLoading ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} {aiLoading ? (id ? "Mengirim..." : "Submitting...") : (id ? "Mulai analisis" : "Start analysis")}</button>
        </form>}

        {aiPhase === "analyzing" && aiRun && <div className="catalog-ai-result">
          <section className="catalog-ai-progress">
            <LoaderCircle className="spin" size={22} />
            <div>
              <strong>{id ? "AI sedang menganalisis produk..." : "AI analysis in progress..."}</strong>
              <p>{aiRun.query}</p>
              <small>{id ? "Berjalan" : "Elapsed"} {formatElapsed(aiElapsed)}</small>
            </div>
          </section>
          <div className="catalog-ai-safety"><Check size={15} /><p>{id ? "Anda dapat menutup panel ini — analisis berlanjut di server." : "You can close this panel — the analysis continues on the server."}</p></div>
          {aiPollTimedOut && <section className="catalog-ai-section warning"><strong><AlertTriangle size={14} /> {id ? "Pemantauan dijeda" : "Monitoring paused"}</strong><ul><li>{id ? "Analisis berjalan lebih dari 10 menit. Tutup lalu buka kembali panel ini untuk menyegarkan status." : "The analysis has been running for over 10 minutes. Close and reopen this panel to refresh the status."}</li></ul></section>}
        </div>}

        {aiPhase === "failed" && aiRun && <div className="catalog-ai-result">
          <section className="catalog-ai-error" role="alert">
            <strong><AlertTriangle size={14} /> {id ? "Analisis gagal" : "Analysis failed"}</strong>
            <p>{aiRun.errorMessage || (id ? "Analisis gagal tanpa pesan galat." : "The analysis failed without an error message.")}</p>
          </section>
          <button className="button primary" type="button" onClick={resetAiToIdle}>{id ? "Coba lagi" : "Try again"}</button>
        </div>}

        {aiPhase === "approved" && <div className="catalog-ai-result">
          <section className="catalog-ai-section"><strong><Check size={14} /> {id ? "Rekomendasi telah disetujui dan masuk ke katalog." : "The recommendation has been approved and added to the catalog."}</strong></section>
          <button className="button secondary" type="button" onClick={resetAiToIdle}>{id ? "Analisis baru" : "New analysis"}</button>
        </div>}

        {(aiPhase === "draft-review" || aiPhase === "rejected") && aiRun?.recommendation && <form id="catalog-ai-review-form" className="catalog-ai-result" onSubmit={approveAiRun}>
          <div className="catalog-ai-result-title"><span className={`status-badge ${aiRun.status === "Draft" ? "warning" : aiRun.status === "Approved" ? "success" : "muted"}`}>{aiRun.status}</span><span>Confidence {aiRun.recommendation.confidence}%</span></div>
          <div className="catalog-ai-product"><span>{aiRun.recommendation.brand}</span><h3>{id ? aiRun.recommendation.nameId : aiRun.recommendation.nameEn}</h3><p>{aiRun.recommendation.model} · {aiRun.recommendation.sku}</p></div>
          <div className="catalog-ai-prices">
            <article><span>{id ? "Harga pasar" : "Market price"}</span><strong>{formatCurrency(aiRun.recommendation.marketPrice.min, language)} – {formatCurrency(aiRun.recommendation.marketPrice.max, language)}</strong></article>
            <article><span>{id ? "Rekomendasi harga pokok" : "Recommended cost"}</span><strong>{formatCurrency(aiRun.recommendation.recommendedCostPrice, language)}</strong></article>
            <article><span>Harga 1 · +{aiRun.recommendation.margin1Percent}%</span><strong>{formatCurrency(aiRun.recommendation.price1, language)}</strong></article>
            <article><span>Harga 2 · +{aiRun.recommendation.margin2Percent}%</span><strong>{formatCurrency(aiRun.recommendation.price2, language)}</strong></article>
          </div>
          <section className="catalog-ai-section"><strong>{id ? "Spesifikasi teridentifikasi" : "Identified specifications"}</strong><ul>{aiRun.recommendation.specifications.map((entry) => <li key={entry}>{entry}</li>)}</ul></section>
          {(aiRun.recommendation.warnings.length > 0 || aiRun.recommendation.assumptions.length > 0) && <section className="catalog-ai-section warning"><strong><AlertTriangle size={14} /> {id ? "Asumsi dan catatan" : "Assumptions and notes"}</strong><ul>{[...aiRun.recommendation.warnings, ...aiRun.recommendation.assumptions].map((entry) => <li key={entry}>{entry}</li>)}</ul></section>}
          {aiRun.sources.length > 0 && <section className="catalog-ai-section"><strong>{id ? "Sumber publik" : "Public sources"}</strong><div className="catalog-ai-sources">{aiRun.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><span>{source.title}</span><ExternalLink size={13} /></a>)}</div></section>}
          {aiPhase === "draft-review" && <>
            <section className="catalog-ai-review">
              <strong>{id ? "Tinjau dan sesuaikan sebelum menyetujui" : "Review and adjust before approving"}</strong>
              <div className="form-grid two-columns">
                <label className="field"><span>SKU</span><input required minLength={2} maxLength={80} value={aiForm.sku} onChange={(event) => setAiForm((current) => ({ ...current, sku: event.target.value }))} /></label>
                <label className="field"><span>Model</span><input maxLength={120} value={aiForm.model} onChange={(event) => setAiForm((current) => ({ ...current, model: event.target.value }))} /></label>
              </div>
              <label className="field"><span>{id ? "Nama item" : "Item name"}</span><input required minLength={2} maxLength={180} value={aiForm.name} onChange={(event) => setAiForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <div className="form-grid two-columns">
                <label className="field"><span>{id ? "Satuan" : "Unit"}</span><input required maxLength={40} value={aiForm.unit} onChange={(event) => setAiForm((current) => ({ ...current, unit: event.target.value }))} /></label>
                <label className="field"><span>{id ? "Harga pokok" : "Cost price"}</span><input type="number" min="0" required value={aiForm.costPrice || ""} onChange={(event) => setAiForm((current) => ({ ...current, costPrice: Number(event.target.value) }))} /></label>
              </div>
              <div className="catalog-price-grid">
                <label className="field"><span>Margin 1 (%)</span><input type="number" min="0" max="1000" step="0.01" value={aiForm.margin1Percent} onChange={(event) => setAiForm((current) => ({ ...current, margin1Percent: Number(event.target.value) }))} /><strong>{formatCurrency(aiReviewPrice1, language)}</strong></label>
                <label className="field"><span>Margin 2 (%)</span><input type="number" min="0" max="1000" step="0.01" value={aiForm.margin2Percent} onChange={(event) => setAiForm((current) => ({ ...current, margin2Percent: Number(event.target.value) }))} /><strong>{formatCurrency(aiReviewPrice2, language)}</strong></label>
              </div>
              <details>
                <summary>{id ? "Detail lanjutan" : "Advanced details"}</summary>
                <label className="field"><span>{id ? "Nama Inggris" : "English name"}</span><input maxLength={180} value={aiForm.nameEn} onChange={(event) => setAiForm((current) => ({ ...current, nameEn: event.target.value }))} /></label>
                <label className="field"><span>{id ? "Spesifikasi" : "Specifications"}</span><textarea maxLength={2000} value={aiForm.specifications} onChange={(event) => setAiForm((current) => ({ ...current, specifications: event.target.value }))} /></label>
              </details>
            </section>
            <section className="catalog-ai-classification"><label className="field select-field"><span>{id ? "Kategori katalog" : "Catalog category"}</span><select required value={aiCategoryId} onChange={(event) => { setAiCategoryId(event.target.value); setAiBrandId(""); }}><option value="">{id ? "Pilih kategori" : "Select category"}</option>{data.categories.filter((entry) => entry.status === "Aktif").map((entry) => <option key={entry.id} value={entry.id}>{entry.boqRole} · {entry.name}</option>)}</select></label><label className="field select-field"><span>{id ? "Merek" : "Brand"}{aiRequiresBrand ? " *" : ""}</span><select required={aiRequiresBrand} value={aiBrandId} onChange={(event) => setAiBrandId(event.target.value)}><option value="">{id ? "Pilih merek" : "Select brand"}</option>{data.brands.filter((entry) => entry.status === "Aktif" && entry.categoryId === aiCategoryId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></section>
            {aiShowOverride && <section className="catalog-ai-section warning">
              <strong><AlertTriangle size={14} /> {id ? "Rekomendasi kedaluwarsa" : "Recommendation expired"}</strong>
              <label className="field"><span>{id ? "Alasan override (min. 5 karakter)" : "Override reason (min. 5 characters)"}</span><textarea required minLength={5} maxLength={500} value={aiOverrideReason} onChange={(event) => setAiOverrideReason(event.target.value)} placeholder={id ? "Rekomendasi lebih dari tujuh hari. Jelaskan alasan tetap menyetujui." : "This recommendation is older than seven days. Explain why you are approving anyway."} /></label>
            </section>}
            {aiActionError && <section className="catalog-ai-error" role="alert"><strong><AlertTriangle size={14} /> {id ? "Tindakan gagal" : "The action failed"}</strong><p>{aiActionError}</p></section>}
          </>}
        </form>}

        {(aiPhase === "draft-review" || aiPhase === "rejected") && aiRun?.recommendation && <footer className="catalog-ai-actions"><button className="button secondary" type="button" onClick={resetAiToIdle} disabled={aiLoading}>{id ? "Analisis baru" : "New analysis"}</button>{aiPhase === "draft-review" && <><button className="button danger" type="button" onClick={() => void rejectAiRun()} disabled={aiLoading}>{id ? "Tolak" : "Reject"}</button><button className="button primary" type="submit" form="catalog-ai-review-form" disabled={aiLoading || !aiReviewValid}><Check size={16} /> {id ? "Setujui ke katalog" : "Approve to catalog"}</button></>}</footer>}
      </aside>
    </div>}
  </div>;
}
