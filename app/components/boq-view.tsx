"use client";

import {
  ArrowRight,
  Boxes,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileSpreadsheet,
  Layers3,
  LibraryBig,
  PackagePlus,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { BoqItem, type CatalogItem, type CommercialPackage, formatCurrency, ViewKey } from "../data";
import { type AppLanguage, localizedLabel } from "../i18n";
import { CatalogPicker } from "./catalog-picker";
import { CommercialPackageSwitcher } from "./commercial-package-switcher";

interface BoqViewProps {
  language: AppLanguage;
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
  projectId: string;
  canManage: boolean;
  canManageCatalog: boolean;
}

const categoryIcons = {
  Perangkat: Boxes,
  Material: Layers3,
  Jasa: BriefcaseBusiness,
  Mobilitas: Truck,
};

interface BoqTemplate {
  id: string;
  name: string;
  items: number;
  lastUsed: string;
}

// GET /api/boq reports the commercial scope status, which follows the quotation
// lifecycle (Draft → Sent → Accepted/Rejected/Void). PUT /api/boq only accepts
// Draft or Final, so the status is echoed back only when it is a value that
// endpoint understands; otherwise it is omitted and the server keeps its own.
const SAVEABLE_BOQ_STATUSES = ["Draft", "Final"];

export function BoqView({ language, navigate, notify, projectId, canManage, canManageCatalog }: BoqViewProps) {
  const id = language === "id";
  const [items, setItems] = useState<BoqItem[]>([]);
  const [project, setProject] = useState({ name: "", code: "", client: "" });
  const [boqStatus, setBoqStatus] = useState("Draft");
  const [category, setCategory] = useState<BoqItem["category"]>("Perangkat");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("unit");
  const [costPrice, setCostPrice] = useState(0);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [templateName, setTemplateName] = useState("");
  const [templateList, setTemplateList] = useState<BoqTemplate[]>([]);
  const [activeTemplate, setActiveTemplate] = useState("");
  const [editingItemId, setEditingItemId] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogItemId, setCatalogItemId] = useState<string | null>(null);
  const [catalogPriceTier, setCatalogPriceTier] = useState<1 | 2 | null>(null);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogItem | null>(null);
  const [manualPriceOverride, setManualPriceOverride] = useState(false);
  const [priceOverrideReason, setPriceOverrideReason] = useState("");
  const [packageId, setPackageId] = useState("");
  const selectPackage = useCallback((nextPackageId: string, packages: CommercialPackage[]) => {
    void packages;
    setPackageId(nextPackageId);
  }, []);

  useEffect(() => {
    if (!packageId) return;
    let active = true;
    Promise.all([
      api<{ items: BoqItem[]; project: typeof project; status: string }>(`/api/boq?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`),
      api<BoqTemplate[]>("/api/boq/templates"),
    ])
      .then(([boq, savedTemplates]) => {
        if (!active) return;
        setItems(boq.items);
        setProject(boq.project);
        setBoqStatus(boq.status);
        setTemplateList(savedTemplates);
        setActiveTemplate(savedTemplates[0]?.id ?? "");
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify, packageId, projectId]);

  // Once the client accepts the quotation the server locks the Original scope:
  // every write returns ACCEPTED_SCOPE_LOCKED and further work goes through an
  // Addendum. Reflect that instead of offering a button that can only fail.
  const boqLocked = boqStatus === "Accepted";

  const totals = useMemo(() => {
    const cost = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
    const selling = items.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0);
    const margin = selling - cost;
    const marginPercentage = selling ? (margin / selling) * 100 : 0;
    return { cost, selling, margin, marginPercentage };
  }, [items]);

  const categoryTotals = useMemo(
    () =>
      (Object.keys(categoryIcons) as BoqItem["category"][]).map((itemCategory) => ({
        category: itemCategory,
        amount: items
          .filter((item) => item.category === itemCategory)
          .reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0),
      })),
    [items],
  );

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || quantity < 1 || sellingPrice <= 0) return;
    try {
      const item = await api<BoqItem>(editingItemId
        ? `/api/boq/items/${editingItemId}?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`
        : `/api/boq/items?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`, {
        method: editingItemId ? "PATCH" : "POST",
        body: JSON.stringify({ category, description: description.trim(), quantity, unit, costPrice, sellingPrice,
          catalogItemId, catalogPriceTier, manualPriceOverride, priceOverrideReason: manualPriceOverride ? priceOverrideReason : null }),
      });
      setItems((current) => editingItemId
        ? current.map((currentItem) => currentItem.id === item.id ? item : currentItem)
        : [...current, item]);
      resetItemForm();
      notify(editingItemId ? (id ? "Item BoQ berhasil diperbarui." : "BoQ item updated.") : (id ? "Item BoQ berhasil ditambahkan." : "BoQ item added."));
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  function resetItemForm() {
    setEditingItemId("");
    setCategory("Perangkat");
    setDescription("");
    setQuantity(1);
    setUnit("unit");
    setCostPrice(0);
    setSellingPrice(0);
    setCatalogItemId(null);
    setCatalogPriceTier(null);
    setSelectedCatalog(null);
    setManualPriceOverride(false);
    setPriceOverrideReason("");
  }

  function editItem(item: BoqItem) {
    setEditingItemId(item.id);
    setCategory(item.category);
    setDescription(item.description);
    setQuantity(item.quantity);
    setUnit(item.unit);
    setCostPrice(item.costPrice);
    setSellingPrice(item.sellingPrice);
    setCatalogItemId(item.catalogItemId ?? null);
    setCatalogPriceTier(item.catalogPriceTier ?? null);
    setSelectedCatalog(null);
    setManualPriceOverride(Boolean(item.manualPriceOverride));
    setPriceOverrideReason(item.priceOverrideReason ?? "");
    window.scrollTo({ top: 180, behavior: "smooth" });
  }

  async function saveBoq(nextItems = items) {
    try {
      const saved = await api<{ items: BoqItem[]; status: string }>(
        `/api/boq?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...(SAVEABLE_BOQ_STATUSES.includes(boqStatus) ? { status: boqStatus } : {}),
            items: nextItems.map((item) => ({
              category: item.category,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              costPrice: item.costPrice,
              sellingPrice: item.sellingPrice,
              catalogItemId: item.catalogItemId ?? null,
              catalogPriceTier: item.catalogPriceTier ?? null,
              manualPriceOverride: Boolean(item.manualPriceOverride),
              priceOverrideReason: item.priceOverrideReason ?? null,
            })),
          }),
        },
      );
      setItems(saved.items);
      setBoqStatus(saved.status);
      notify(id ? "BoQ tersimpan dan nilai proyek telah disinkronkan." : "The BoQ was saved and the project value synchronized.");
      return true;
    } catch (error) {
      notify(messageOf(error, language));
      return false;
    }
  }

  async function deleteItem(itemId: string) {
    try {
      await api(`/api/boq/items/${itemId}?projectId=${encodeURIComponent(projectId)}&packageId=${encodeURIComponent(packageId)}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== itemId));
      notify(id ? "Item dihapus dari BoQ." : "The item was removed from the BoQ.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function saveTemplate() {
    const name = templateName.trim() || `Template BoQ ${templateList.length + 1}`;
    try {
      const newTemplate = await api<BoqTemplate>("/api/boq/templates", {
        method: "POST",
        body: JSON.stringify({ name, items }),
      });
      setTemplateList((current) => [newTemplate, ...current]);
      setActiveTemplate(newTemplate.id);
      setTemplateName("");
      notify(id ? "BoQ berhasil disimpan sebagai template." : "The BoQ was saved as a template.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function loadTemplate(templateId: string) {
    try {
      const template = await api<{ id: string; items: BoqItem[] }>(`/api/boq/templates/${templateId}`);
      setActiveTemplate(templateId);
      const nextItems = template.items.map((item, index) => ({
        category: item.category,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        catalogItemId: item.catalogItemId ?? null,
        catalogPriceTier: item.catalogPriceTier ?? null,
        manualPriceOverride: Boolean(item.manualPriceOverride),
        priceOverrideReason: item.priceOverrideReason ?? null,
        id: `template-${templateId}-${index}`,
      }));
      await saveBoq(nextItems);
      notify(id ? "Template dimuat dan disimpan ke BoQ aktif." : "The template was loaded into the active BoQ.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteTemplate(template: BoqTemplate) {
    if (
      !window.confirm(
        id ? `Hapus template "${template.name}"? Template akan dihapus permanen, tetapi BoQ proyek yang sudah memakai template ini tidak berubah.` : `Delete template "${template.name}"? The template will be permanently deleted, but existing project BoQs will not change.`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/boq/templates/${template.id}`, { method: "DELETE" });
      setTemplateList((current) =>
        current.filter((item) => item.id !== template.id),
      );
      setActiveTemplate((current) =>
        current === template.id ? "" : current,
      );
      notify(id ? `Template "${template.name}" berhasil dihapus.` : `Template "${template.name}" was deleted.`);
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function continueToQuotation() {
    if (!items.length) {
      notify(id ? "Tambahkan minimal satu item sebelum membuat Quotation." : "Add at least one item before creating a Quotation.");
      return;
    }
    // An accepted scope is locked server-side; saving it would only surface a
    // 409, so go straight to the quotation the client already approved.
    if (canManage && !boqLocked && !(await saveBoq())) return;
    navigate("billing");
  }

  function useCatalogItem(item: CatalogItem, tier: 1 | 2) {
    setCatalogItemId(item.id);
    setCatalogPriceTier(tier);
    setSelectedCatalog(item);
    setCategory(item.boqRole);
    setDescription([item.name, item.model].filter(Boolean).join(" — "));
    setUnit(item.unit);
    setCostPrice(item.costPrice);
    setSellingPrice(tier === 2 ? item.price2 : item.price1);
    setManualPriceOverride(false);
    setPriceOverrideReason("");
    setCatalogOpen(false);
  }

  return (
    <div className="page-stack" data-testid="boq-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">{id ? "PENAWARAN PROYEK" : "PROJECT QUOTATION"}</span>
          <h1>BoQ Generator</h1>
          <p>{id ? "Susun kebutuhan, harga pokok, dan margin proyek secara terstruktur." : "Structure project requirements, costs, and margins."}</p>
        </div>
        <div className="title-actions">
          <CommercialPackageSwitcher projectId={projectId} language={language} canManage={canManage} value={packageId} onChange={selectPackage} notify={notify} />
          {canManage && (
            <>
              <button className="button secondary" type="button" disabled={boqLocked} onClick={() => saveBoq()}>
                <Save size={16} /> {id ? "Simpan BoQ" : "Save BoQ"}
              </button>
              <button className="button secondary" type="button" onClick={saveTemplate}>
                <Save size={16} /> {id ? "Simpan template" : "Save template"}
              </button>
            </>
          )}
          <button className="button primary" type="button" onClick={continueToQuotation}>
            {id ? "Buat quotation" : "Create quotation"} <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section className="context-bar">
        <div className="context-project">
          <span className="context-icon"><FileSpreadsheet size={19} /></span>
          <div>
            <span>{id ? "BoQ untuk proyek" : "BoQ for project"}</span>
            <strong>{project.name}</strong>
          </div>
        </div>
        <div className="context-details">
          <span>{project.code}</span>
          <span>{project.client}</span>
          <span className="status-badge info"><span className="badge-dot" /> {boqStatus}</span>
          {boqLocked && (
            <span>{id
              ? "BoQ dikunci setelah disetujui klien. Tambahkan pekerjaan melalui Addendum."
              : "The BoQ is locked after client acceptance. Add work through an Addendum."}</span>
          )}
        </div>
      </section>

      <section className="boq-layout">
        <div className="boq-main">
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">{id ? "ENTRI ITEM" : "ITEM ENTRY"}</span>
                <h2>{id ? "Tambah kebutuhan proyek" : "Add project requirements"}</h2>
              </div>
              <span className="helper-copy"><Sparkles size={15} /> {id ? "Total dihitung otomatis" : "Totals calculated automatically"}</span>
            </div>
            <form className="boq-entry-form" onSubmit={addItem}>
              {canManage && <div className="boq-catalog-callout"><div><LibraryBig size={19} /><span><strong>{id ? "Ambil dari database item" : "Use the item database"}</strong><small>{id ? "Pilih kategori produk, merek, model, lalu Harga 1 atau Harga 2." : "Select product category, brand, model, then Price 1 or Price 2."}</small></span></div><button className="button secondary" type="button" onClick={() => setCatalogOpen(true)}><LibraryBig size={16} /> {id ? "Pilih dari katalog" : "Choose from catalog"}</button></div>}
              {catalogItemId && <div className="catalog-selection-banner"><span><Check size={16} /><strong>{selectedCatalog ? `${selectedCatalog.category} · ${selectedCatalog.brand ?? "Tanpa merek"}` : (id ? "Item terhubung ke katalog" : "Catalog-linked item")}</strong><small>{id ? `Harga ${catalogPriceTier ?? 1} aktif; harga pokok mengikuti database.` : `Price ${catalogPriceTier ?? 1} active; cost follows the database.`}</small></span><button className="text-button" type="button" onClick={() => { setCatalogItemId(null); setCatalogPriceTier(null); setSelectedCatalog(null); setManualPriceOverride(false); }}>{id ? "Jadikan manual" : "Make manual"}</button></div>}
              <div className="category-selector" role="group" aria-label={id ? "Kategori item" : "Item category"}>
                {(Object.keys(categoryIcons) as BoqItem["category"][]).map((itemCategory) => {
                  const Icon = categoryIcons[itemCategory];
                  return (
                    <button
                      className={category === itemCategory ? "active" : ""}
                      key={itemCategory}
                      type="button"
                      onClick={() => { if (!catalogItemId) setCategory(itemCategory); }}
                      disabled={Boolean(catalogItemId)}
                    >
                      <Icon size={17} />
                      {localizedLabel(language, itemCategory)}
                    </button>
                  );
                })}
              </div>
              <div className="form-grid boq-form-grid">
                <label className="field description-field">
                  <span>{id ? "Deskripsi item" : "Item description"}</span>
                  <input
                    required
                    readOnly={Boolean(catalogItemId)}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={id ? "Contoh: Access Point WiFi 6" : "Example: WiFi 6 Access Point"}
                  />
                </label>
                <label className="field">
                  <span>Qty</span>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                  />
                </label>
                <label className="field select-field">
                  <span>{id ? "Satuan" : "Unit"}</span>
                  <select disabled={Boolean(catalogItemId)} value={unit} onChange={(event) => setUnit(event.target.value)}>
                    <option value="unit">unit</option>
                    <option value="box">box</option>
                    <option value="meter">meter</option>
                    <option value="paket">{id ? "paket" : "package"}</option>
                    <option value="hari">{id ? "hari" : "day"}</option>
                  </select>
                  <ChevronDown size={15} />
                </label>
                <label className="field">
                  <span>{id ? "Harga pokok" : "Cost price"}</span>
                  <input
                    type="number"
                    min="0"
                    readOnly={Boolean(catalogItemId)}
                    value={costPrice || ""}
                    onChange={(event) => setCostPrice(Number(event.target.value))}
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>{id ? "Harga jual" : "Selling price"}</span>
                  <input
                    type="number"
                    min="0"
                    required
                    readOnly={Boolean(catalogItemId) && !manualPriceOverride}
                    value={sellingPrice || ""}
                    onChange={(event) => setSellingPrice(Number(event.target.value))}
                    placeholder="0"
                />
                </label>
                {catalogItemId && canManageCatalog && <div className="catalog-override-fields"><label className="toggle-row compact"><input type="checkbox" checked={manualPriceOverride} onChange={(event) => { setManualPriceOverride(event.target.checked); if (!event.target.checked && selectedCatalog) setSellingPrice(catalogPriceTier === 2 ? selectedCatalog.price2 : selectedCatalog.price1); }} /><span>{id ? "Override harga" : "Override price"}</span></label>{manualPriceOverride && <label className="field"><span>{id ? "Alasan wajib" : "Required reason"}</span><input required value={priceOverrideReason} onChange={(event) => setPriceOverrideReason(event.target.value)} /></label>}</div>}
                {canManage && (
                  <div className="boq-form-actions">
                    <button className="button primary add-item-button" type="submit">
                      {editingItemId ? <Pencil size={17} /> : <PackagePlus size={17} />}
                      {editingItemId ? (id ? "Simpan item" : "Save item") : (id ? "Tambah item" : "Add item")}
                    </button>
                    {editingItemId && (
                      <button className="button secondary" type="button" onClick={resetItemForm}>
                        <X size={16} /> {id ? "Batal" : "Cancel"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </form>
          </section>

          <section className="panel boq-table-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">{id ? "RINCIAN BIAYA" : "COST DETAILS"}</span>
                <h2>{id ? "Daftar item BoQ" : "BoQ items"}</h2>
              </div>
              <span className="count-badge">{items.length} item</span>
            </div>
            <div className="table-scroll">
              <table className="data-table boq-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>{id ? "Harga pokok" : "Cost price"}</th>
                    <th>{id ? "Harga jual" : "Selling price"}</th>
                    <th>Subtotal</th>
                    <th><span className="sr-only">{id ? "Aksi" : "Actions"}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const Icon = categoryIcons[item.category];
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="table-item-name">
                            <span className={`category-icon ${item.category.toLowerCase()}`}>
                              <Icon size={16} />
                            </span>
                            <div>
                              <strong>{item.description}</strong>
                              <small>{localizedLabel(language, item.category)}</small>
                            </div>
                          </div>
                        </td>
                        <td>{item.quantity} {localizedLabel(language, item.unit)}</td>
                        <td>{formatCurrency(item.costPrice, language)}</td>
                        <td>{formatCurrency(item.sellingPrice, language)}</td>
                        <td><strong>{formatCurrency(item.quantity * item.sellingPrice, language)}</strong></td>
                        <td>
                          {canManage && (
                            <div className="table-row-actions">
                              <button className="icon-button" type="button" aria-label={`Edit ${item.description}`} onClick={() => editItem(item)}>
                                <Pencil size={16} />
                              </button>
                              <button
                                className="icon-button danger"
                                type="button"
                                aria-label={`Hapus ${item.description}`}
                                onClick={() => deleteItem(item.id)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="boq-table-summary">
              {categoryTotals.map((item) => (
                <div key={item.category}>
                  <span>{localizedLabel(language, item.category)}</span>
                  <strong>{formatCurrency(item.amount, language)}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="boq-sidebar">
          <section className="panel total-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">{id ? "REKAPITULASI" : "SUMMARY"}</span>
                <h2>Total BoQ</h2>
              </div>
              <span className="metric-icon teal"><CircleDollarSign size={19} /></span>
            </div>
            <div className="total-list">
              <div>
                <span>{id ? "Total harga pokok" : "Total cost"}</span>
                <strong>{formatCurrency(totals.cost, language)}</strong>
              </div>
              <div>
                <span>{id ? "Total harga jual" : "Total selling price"}</span>
                <strong>{formatCurrency(totals.selling, language)}</strong>
              </div>
              <div className="total-divider" />
              <div className="margin-total">
                <span>{id ? "Estimasi margin" : "Estimated margin"}</span>
                <strong>{formatCurrency(totals.margin, language)}</strong>
                <small>{totals.marginPercentage.toFixed(1)}% {id ? "dari nilai penawaran" : "of quotation value"}</small>
              </div>
            </div>
            <div className="margin-meter">
              <span style={{ width: `${Math.min(totals.marginPercentage, 100)}%` }} />
            </div>
            <button className="button primary full-width" type="button" onClick={continueToQuotation}>
              {id ? "Buat quotation" : "Create quotation"} <ArrowRight size={16} />
            </button>
          </section>

          <section className="panel template-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">TEMPLATE</span>
                <h2>{id ? "BoQ tersimpan" : "Saved BoQs"}</h2>
              </div>
            </div>
            <div className="template-list">
              {templateList.map((template) => (
                <div className="template-row" key={template.id}>
                  <button
                    type="button"
                    className={`template-item ${activeTemplate === template.id ? "active" : ""}`}
                    onClick={() => loadTemplate(template.id)}
                  >
                    <span className="template-icon"><FileSpreadsheet size={17} /></span>
                    <span>
                      <strong>{template.name}</strong>
                      <small>{template.items} item · {template.lastUsed}</small>
                    </span>
                    {activeTemplate === template.id ? <Check size={16} /> : <ArrowRight size={15} />}
                  </button>
                  {canManage && (
                    <button
                      className="icon-button danger template-delete"
                      type="button"
                      aria-label={`Hapus template ${template.name}`}
                      onClick={() => deleteTemplate(template)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
              {!templateList.length && (
                <div className="empty-state compact">
                  <p>{id ? "Belum ada template BoQ tersimpan." : "No saved BoQ templates."}</p>
                </div>
              )}
            </div>
            {canManage && <div className="save-template-form">
              <label className="field">
                <span>{id ? "Nama template baru" : "New template name"}</span>
                <input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder={id ? "Nama template" : "Template name"}
                />
              </label>
              <button className="button secondary full-width" type="button" onClick={saveTemplate}>
                <Plus size={16} /> {id ? "Simpan BoQ saat ini" : "Save current BoQ"}
              </button>
            </div>}
          </section>
        </aside>
      </section>
      {catalogOpen && <CatalogPicker language={language} notify={notify} onClose={() => setCatalogOpen(false)} onSelect={useCatalogItem} />}
    </div>
  );
}
