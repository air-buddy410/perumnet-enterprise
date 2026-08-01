"use client";

import {
  Boxes,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  FileInput,
  FileSpreadsheet,
  Layers3,
  LibraryBig,
  Pencil,
  Plus,
  Save,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { BoqItem, type CatalogItem, formatCurrency, Project } from "../data";
import { type AppLanguage, localizedLabel } from "../i18n";
import { CatalogPicker } from "./catalog-picker";

interface StandaloneBoqSummary {
  id: string;
  title: string;
  client: string;
  status: "Draft" | "Final";
  notes: string;
  itemCount: number;
  total: number;
  updatedAt: string;
}

interface StandaloneBoq extends StandaloneBoqSummary {
  items: BoqItem[];
}

interface StandaloneBoqViewProps {
  language: AppLanguage;
  notify: (message: string) => void;
  projects: Project[];
}

const categoryIcons = {
  Perangkat: Boxes,
  Material: Layers3,
  Jasa: BriefcaseBusiness,
  Mobilitas: Truck,
};

export function StandaloneBoqView({
  language,
  notify,
  projects,
}: StandaloneBoqViewProps) {
  const id = language === "id";
  const [boqs, setBoqs] = useState<StandaloneBoqSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<StandaloneBoq | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [attachProjectId, setAttachProjectId] = useState("");
  const [replaceProjectBoq, setReplaceProjectBoq] = useState(false);
  const [category, setCategory] =
    useState<BoqItem["category"]>("Perangkat");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("unit");
  const [costPrice, setCostPrice] = useState(0);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [editingItemId, setEditingItemId] = useState("");
  const [saving, setSaving] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogItemId, setCatalogItemId] = useState<string | null>(null);
  const [catalogPriceTier, setCatalogPriceTier] = useState<1 | 2 | null>(null);

  const loadList = useCallback(async () => {
    const next = await api<StandaloneBoqSummary[]>("/api/boq/standalone");
    setBoqs(next);
    setSelectedId((current) =>
      next.some((boq) => boq.id === current) ? current : next[0]?.id ?? "",
    );
  }, []);

  useEffect(() => {
    const update = window.setTimeout(() => {
      void loadList().catch((error) => notify(messageOf(error, language)));
    }, 0);
    return () => window.clearTimeout(update);
  }, [language, loadList, notify]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    api<StandaloneBoq>(`/api/boq/standalone/${selectedId}`)
      .then((result) => {
        if (active) setSelected(result);
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => {
      active = false;
    };
  }, [language, notify, selectedId]);

  const totals = useMemo(() => {
    const items = selected?.items ?? [];
    const cost = items.reduce(
      (sum, item) => sum + item.quantity * item.costPrice,
      0,
    );
    const selling = items.reduce(
      (sum, item) => sum + item.quantity * item.sellingPrice,
      0,
    );
    return { cost, selling, margin: selling - cost };
  }, [selected?.items]);

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
  }

  async function persist(next: StandaloneBoq) {
    setSaving(true);
    try {
      const saved = await api<StandaloneBoq>(
        `/api/boq/standalone/${next.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: next.title,
            client: next.client,
            status: next.status,
            notes: next.notes,
            items: next.items.map((item) => ({
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
      setSelected(saved);
      await loadList();
      return true;
    } catch (error) {
      notify(messageOf(error, language));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createBoq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await api<StandaloneBoq>("/api/boq/standalone", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          client: clientName.trim(),
          status: "Draft",
          notes: "",
          items: [],
        }),
      });
      setShowCreate(false);
      setTitle("");
      setClientName("");
      await loadList();
      setSelectedId(created.id);
      notify(id ? "BoQ mandiri berhasil dibuat." : "Standalone BoQ created.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function addOrUpdateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !description.trim() || sellingPrice < 0) return;
    const item: BoqItem = {
      id: editingItemId || `draft-${Date.now()}`,
      category,
      description: description.trim(),
      quantity,
      unit,
      costPrice,
      sellingPrice,
      catalogItemId,
      catalogPriceTier,
    };
    const nextItems = editingItemId
      ? selected.items.map((current) =>
          current.id === editingItemId ? item : current,
        )
      : [...selected.items, item];
    if (await persist({ ...selected, items: nextItems })) {
      resetItemForm();
      notify(
        editingItemId
          ? id
            ? "Item BoQ diperbarui."
            : "BoQ item updated."
          : id
            ? "Item BoQ ditambahkan."
            : "BoQ item added.",
      );
    }
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
  }

  function useCatalogItem(item: CatalogItem, tier: 1 | 2) {
    setCatalogItemId(item.id);
    setCatalogPriceTier(tier);
    setCategory(item.boqRole);
    setDescription([item.name, item.model].filter(Boolean).join(" — "));
    setUnit(item.unit);
    setCostPrice(item.costPrice);
    setSellingPrice(tier === 2 ? item.price2 : item.price1);
    setCatalogOpen(false);
  }

  async function deleteItem(item: BoqItem) {
    if (!selected) return;
    if (
      !window.confirm(
        id ? `Hapus item "${item.description}"?` : `Delete "${item.description}"?`,
      )
    ) {
      return;
    }
    await persist({
      ...selected,
      items: selected.items.filter((current) => current.id !== item.id),
    });
  }

  async function saveMetadata() {
    if (!selected) return;
    if (await persist(selected)) {
      notify(id ? "BoQ mandiri berhasil disimpan." : "Standalone BoQ saved.");
    }
  }

  async function deleteBoq() {
    if (!selected) return;
    if (
      !window.confirm(
        id
          ? `Hapus BoQ mandiri "${selected.title}" secara permanen?`
          : `Permanently delete "${selected.title}"?`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/boq/standalone/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setSelectedId("");
      await loadList();
      notify(id ? "BoQ mandiri dihapus." : "Standalone BoQ deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function attachToProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !attachProjectId) return;
    try {
      await api(`/api/boq/standalone/${selected.id}/attach`, {
        method: "POST",
        body: JSON.stringify({
          projectId: attachProjectId,
          replace: replaceProjectBoq,
        }),
      });
      setShowAttach(false);
      setReplaceProjectBoq(false);
      notify(
        id
          ? "BoQ berhasil disalin ke proyek dan nilai proyek disinkronkan."
          : "The BoQ was copied to the project and its value synchronized.",
      );
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  return (
    <div className="page-stack standalone-boq-page" data-testid="standalone-boq-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">
            {id ? "BOQ TANPA PROYEK" : "STANDALONE BOQ"}
          </span>
          <h1>{id ? "Draft kebutuhan awal" : "Early requirement drafts"}</h1>
          <p>
            {id
              ? "Susun estimasi sebelum proyek dibuat, lalu salin ke proyek ketika pekerjaan disetujui."
              : "Prepare estimates before a project exists, then copy them into a project after approval."}
          </p>
        </div>
        <div className="title-actions">
          <button
            className="button primary"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} /> {id ? "BoQ baru" : "New BoQ"}
          </button>
        </div>
      </section>

      <section className="standalone-boq-layout">
        <aside className="panel standalone-boq-list">
          <div className="panel-head">
            <div>
              <span className="eyebrow">{id ? "DRAFT TERSIMPAN" : "SAVED DRAFTS"}</span>
              <h2>{id ? "Daftar BoQ" : "BoQ list"}</h2>
            </div>
            <span className="count-badge">{boqs.length}</span>
          </div>
          <div className="workspace-project-list">
            {boqs.map((boq) => (
              <button
                className={selectedId === boq.id ? "active" : ""}
                type="button"
                key={boq.id}
                onClick={() => setSelectedId(boq.id)}
              >
                <FileSpreadsheet size={17} />
                <span>
                  <strong>{boq.title}</strong>
                  <small>
                    {boq.client || (id ? "Klien belum diisi" : "Client not set")} ·{" "}
                    {boq.itemCount} item
                  </small>
                </span>
                <b>{formatCurrency(boq.total, language)}</b>
              </button>
            ))}
          </div>
          {!boqs.length ? (
            <div className="empty-state compact">
              <FileSpreadsheet size={26} />
              <p>{id ? "Belum ada BoQ mandiri." : "No standalone BoQs yet."}</p>
            </div>
          ) : null}
        </aside>

        {selected ? (
          <div className="standalone-boq-editor">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">{id ? "IDENTITAS BOQ" : "BOQ DETAILS"}</span>
                  <h2>{selected.title}</h2>
                </div>
                <div className="title-actions">
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={() => {
                      setAttachProjectId(projects[0]?.id ?? "");
                      setShowAttach(true);
                    }}
                    disabled={!projects.length}
                  >
                    <FileInput size={15} /> {id ? "Salin ke proyek" : "Copy to project"}
                  </button>
                  <button
                    className="button primary small"
                    type="button"
                    disabled={saving}
                    onClick={saveMetadata}
                  >
                    <Save size={15} /> {id ? "Simpan" : "Save"}
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    aria-label={id ? "Hapus BoQ mandiri" : "Delete standalone BoQ"}
                    onClick={deleteBoq}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="form-grid standalone-boq-meta">
                <label className="field">
                  <span>{id ? "Judul BoQ" : "BoQ title"}</span>
                  <input
                    value={selected.title}
                    onChange={(event) =>
                      setSelected({ ...selected, title: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>{id ? "Calon klien" : "Prospective client"}</span>
                  <input
                    value={selected.client}
                    onChange={(event) =>
                      setSelected({ ...selected, client: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select
                    value={selected.status}
                    onChange={(event) =>
                      setSelected({
                        ...selected,
                        status: event.target.value as "Draft" | "Final",
                      })
                    }
                  >
                    <option value="Draft">Draft</option>
                    <option value="Final">Final</option>
                  </select>
                </label>
                <label className="field">
                  <span>{id ? "Catatan" : "Notes"}</span>
                  <input
                    value={selected.notes}
                    onChange={(event) =>
                      setSelected({ ...selected, notes: event.target.value })
                    }
                  />
                </label>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">{id ? "ENTRI ITEM" : "ITEM ENTRY"}</span>
                  <h2>{id ? "Tambah kebutuhan" : "Add requirements"}</h2>
                </div>
              </div>
              <form className="boq-entry-form" onSubmit={addOrUpdateItem}>
                <div className="boq-catalog-callout">
                  <span className="metric-icon teal">
                    <LibraryBig size={18} />
                  </span>
                  <span>
                    <strong>
                      {id ? "Ambil dari Database Item" : "Select from Item Database"}
                    </strong>
                    <small>
                      {id
                        ? "Pilih kategori produk, merek, model, lalu gunakan Harga 1 atau Harga 2."
                        : "Choose a product category, brand, model, then use Price 1 or Price 2."}
                    </small>
                  </span>
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={() => setCatalogOpen(true)}
                  >
                    <LibraryBig size={15} /> {id ? "Buka katalog" : "Open catalog"}
                  </button>
                </div>
                {catalogItemId ? (
                  <div className="boq-catalog-selection">
                    <span>
                      <strong>{description}</strong>
                      <small>
                        {id ? "Tertaut ke katalog" : "Linked to catalog"} · H
                        {catalogPriceTier}
                      </small>
                    </span>
                    <button
                      className="button ghost small"
                      type="button"
                      onClick={resetItemForm}
                    >
                      <X size={14} /> {id ? "Gunakan item manual" : "Use manual item"}
                    </button>
                  </div>
                ) : null}
                <div className="category-selector">
                  {(Object.keys(categoryIcons) as BoqItem["category"][]).map(
                    (itemCategory) => {
                      const Icon = categoryIcons[itemCategory];
                      return (
                        <button
                          className={category === itemCategory ? "active" : ""}
                          type="button"
                          key={itemCategory}
                          onClick={() => setCategory(itemCategory)}
                          disabled={Boolean(catalogItemId)}
                        >
                          <Icon size={16} />
                          {localizedLabel(language, itemCategory)}
                        </button>
                      );
                    },
                  )}
                </div>
                <div className="form-grid boq-form-grid">
                  <label className="field description-field">
                    <span>{id ? "Deskripsi" : "Description"}</span>
                    <input
                      required
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      readOnly={Boolean(catalogItemId)}
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
                    <select
                      value={unit}
                      disabled={Boolean(catalogItemId)}
                      onChange={(event) => setUnit(event.target.value)}
                    >
                      <option value="unit">unit</option>
                      <option value="box">box</option>
                      <option value="meter">meter</option>
                      <option value="paket">{id ? "paket" : "package"}</option>
                      <option value="hari">{id ? "hari" : "day"}</option>
                    </select>
                    <ChevronDown size={14} />
                  </label>
                  <label className="field">
                    <span>{id ? "Harga pokok" : "Cost price"}</span>
                    <input
                      type="number"
                      min="0"
                      value={costPrice || ""}
                      onChange={(event) => setCostPrice(Number(event.target.value))}
                      readOnly={Boolean(catalogItemId)}
                    />
                  </label>
                  <label className="field">
                    <span>{id ? "Harga jual" : "Selling price"}</span>
                    <input
                      type="number"
                      min="0"
                      value={sellingPrice || ""}
                      onChange={(event) =>
                        setSellingPrice(Number(event.target.value))
                      }
                      readOnly={Boolean(catalogItemId)}
                    />
                  </label>
                  <div className="boq-form-actions">
                    <button className="button primary" type="submit" disabled={saving}>
                      {editingItemId ? <Check size={16} /> : <Plus size={16} />}
                      {editingItemId
                        ? id
                          ? "Simpan item"
                          : "Save item"
                        : id
                          ? "Tambah item"
                          : "Add item"}
                    </button>
                    {editingItemId ? (
                      <button className="button secondary" type="button" onClick={resetItemForm}>
                        <X size={15} /> {id ? "Batal" : "Cancel"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </form>
            </section>

            <section className="panel boq-table-panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">{id ? "RINCIAN BIAYA" : "COST DETAILS"}</span>
                  <h2>{id ? "Item BoQ mandiri" : "Standalone BoQ items"}</h2>
                </div>
                <span className="count-badge">{selected.items.length} item</span>
              </div>
              <div className="table-scroll">
                <table className="data-table boq-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>{id ? "Harga pokok" : "Cost"}</th>
                      <th>{id ? "Harga jual" : "Selling"}</th>
                      <th>Subtotal</th>
                      <th><span className="sr-only">{id ? "Aksi" : "Actions"}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.description}</strong>
                          <small>{localizedLabel(language, item.category)}</small>
                        </td>
                        <td>{item.quantity} {localizedLabel(language, item.unit)}</td>
                        <td>{formatCurrency(item.costPrice, language)}</td>
                        <td>{formatCurrency(item.sellingPrice, language)}</td>
                        <td><strong>{formatCurrency(item.quantity * item.sellingPrice, language)}</strong></td>
                        <td>
                          <div className="table-row-actions">
                            <button className="icon-button" type="button" onClick={() => editItem(item)}><Pencil size={15} /></button>
                            <button className="icon-button danger" type="button" onClick={() => deleteItem(item)}><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="boq-table-summary">
                <div><span>{id ? "Harga pokok" : "Cost"}</span><strong>{formatCurrency(totals.cost, language)}</strong></div>
                <div><span>{id ? "Harga jual" : "Selling"}</span><strong>{formatCurrency(totals.selling, language)}</strong></div>
                <div><span>{id ? "Margin" : "Margin"}</span><strong>{formatCurrency(totals.margin, language)}</strong></div>
              </div>
            </section>
          </div>
        ) : (
          <section className="panel empty-state">
            <FileSpreadsheet size={30} />
            <h3>{id ? "Pilih atau buat BoQ mandiri" : "Select or create a standalone BoQ"}</h3>
          </section>
        )}
      </section>

      {showCreate ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "BOQ MANDIRI BARU" : "NEW STANDALONE BOQ"}</span><h2>{id ? "Mulai estimasi awal" : "Start an early estimate"}</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowCreate(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={createBoq}>
              <label className="field full"><span>{id ? "Judul BoQ" : "BoQ title"}</span><input required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="field full"><span>{id ? "Calon klien (opsional)" : "Prospective client (optional)"}</span><input value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowCreate(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><Plus size={16} /> {id ? "Buat BoQ" : "Create BoQ"}</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {showAttach && selected ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAttach(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{id ? "SALIN KE PROYEK" : "COPY TO PROJECT"}</span><h2>{selected.title}</h2></div>
              <button className="icon-button" type="button" onClick={() => setShowAttach(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={attachToProject}>
              <label className="field full"><span>{id ? "Proyek tujuan" : "Destination project"}</span><select required value={attachProjectId} onChange={(event) => setAttachProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label>
              <label className="checkbox-label full"><input type="checkbox" checked={replaceProjectBoq} onChange={(event) => setReplaceProjectBoq(event.target.checked)} /><span>{id ? "Ganti BoQ proyek jika sudah ada" : "Replace the project BoQ if one exists"}</span></label>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowAttach(false)}>{id ? "Batal" : "Cancel"}</button><button className="button primary" type="submit"><Check size={16} /> {id ? "Salin BoQ" : "Copy BoQ"}</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {catalogOpen ? (
        <CatalogPicker
          language={language}
          notify={notify}
          onClose={() => setCatalogOpen(false)}
          onSelect={useCatalogItem}
        />
      ) : null}
    </div>
  );
}
