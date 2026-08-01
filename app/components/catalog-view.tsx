"use client";

import {
  Boxes,
  Download,
  FileUp,
  Layers3,
  Pencil,
  Plus,
  Save,
  Search,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadApiFile, messageOf } from "../api-client";
import type { CatalogBrand, CatalogCategory, CatalogItem, CatalogPayload } from "../data";
import { formatCurrency } from "../data";
import type { AppLanguage } from "../i18n";

type EditorMode = "item" | "category" | "brand" | null;
type ItemFormState = {
  categoryId: string; brandId: string; sku: string; name: string; nameEn: string;
  model: string; specifications: string; unit: string; costPrice: number;
  margin1Percent: number; margin2Percent: number; status: "Aktif" | "Nonaktif";
};

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

  const selectedCategory = data.categories.find((entry) => entry.id === itemForm.categoryId);
  const itemBrands = data.brands.filter((entry) => entry.categoryId === itemForm.categoryId && entry.status === "Aktif");
  const projectProducts = ["Networking", "CCTV", "IP PABX", "Smart Home Device"]
    .map((name) => data.categories.find((entry) => entry.boqRole === "Perangkat" && entry.name === name))
    .filter((entry): entry is CatalogCategory => Boolean(entry));
  const price1 = Math.round(itemForm.costPrice * (1 + itemForm.margin1Percent / 100));
  const price2 = Math.round(itemForm.costPrice * (1 + itemForm.margin2Percent / 100));

  return <div className="page-stack catalog-page" data-testid="catalog-view">
    <section className="page-title-row">
      <div><span className="eyebrow">{id ? "MASTER DATA BOQ" : "BOQ MASTER DATA"}</span><h1>{id ? "Database item & harga" : "Item & pricing database"}</h1>
        <p>{id ? "Kelompokkan perangkat dan material berdasarkan kategori produk, merek, lalu model." : "Organize equipment and materials by product category, brand, then model."}</p></div>
      <div className="title-actions">
        <input ref={importRef} hidden type="file" accept=".xlsx" onChange={(event) => void importFile(event.target.files?.[0])} />
        <button className="button secondary" type="button" onClick={() => importRef.current?.click()}><FileUp size={16} /> Import Excel</button>
        <button className="button secondary" type="button" onClick={() => void downloadApiFile("/api/catalog/export.xlsx", "katalog-item.xlsx")}><Download size={16} /> Export</button>
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
  </div>;
}
