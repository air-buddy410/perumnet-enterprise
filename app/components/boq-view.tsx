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
  PackagePlus,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Truck,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { BoqItem, formatCurrency, initialBoqItems, ViewKey } from "../data";

interface BoqViewProps {
  navigate: (view: ViewKey) => void;
  notify: (message: string) => void;
}

const categoryIcons = {
  Perangkat: Boxes,
  Material: Layers3,
  Jasa: BriefcaseBusiness,
  Mobilitas: Truck,
};

const templates = [
  { id: "tpl-1", name: "WiFi Hospitality — 12 AP", items: 18, lastUsed: "8 Jul 2026" },
  { id: "tpl-2", name: "CCTV Warehouse — 16 Cam", items: 24, lastUsed: "3 Jul 2026" },
  { id: "tpl-3", name: "Managed Service — Standard", items: 9, lastUsed: "25 Jun 2026" },
];

export function BoqView({ navigate, notify }: BoqViewProps) {
  const [items, setItems] = useState<BoqItem[]>(initialBoqItems);
  const [category, setCategory] = useState<BoqItem["category"]>("Perangkat");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("unit");
  const [costPrice, setCostPrice] = useState(0);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [templateName, setTemplateName] = useState("");
  const [templateList, setTemplateList] = useState(templates);
  const [activeTemplate, setActiveTemplate] = useState("tpl-1");

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

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || quantity < 1 || sellingPrice <= 0) return;
    const item: BoqItem = {
      id: `boq-${Date.now()}`,
      category,
      description: description.trim(),
      quantity,
      unit,
      costPrice,
      sellingPrice,
    };
    setItems((current) => [...current, item]);
    setDescription("");
    setQuantity(1);
    setCostPrice(0);
    setSellingPrice(0);
    notify("Item BoQ berhasil ditambahkan.");
  }

  function deleteItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    notify("Item dihapus dari BoQ.");
  }

  function saveTemplate() {
    const name = templateName.trim() || `Template BoQ ${templateList.length + 1}`;
    const newTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      items: items.length,
      lastUsed: "Baru saja",
    };
    setTemplateList((current) => [newTemplate, ...current]);
    setActiveTemplate(newTemplate.id);
    setTemplateName("");
    notify("BoQ berhasil disimpan sebagai template.");
  }

  function loadTemplate(id: string) {
    setActiveTemplate(id);
    setItems(initialBoqItems);
    notify("Template dimuat ke BoQ aktif.");
  }

  return (
    <div className="page-stack" data-testid="boq-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">PENAWARAN PROYEK</span>
          <h1>BoQ Generator</h1>
          <p>Susun kebutuhan, harga pokok, dan margin proyek secara terstruktur.</p>
        </div>
        <div className="title-actions">
          <button className="button secondary" type="button" onClick={saveTemplate}>
            <Save size={16} /> Simpan template
          </button>
          <button className="button primary" type="button" onClick={() => navigate("billing")}>
            Buat quotation <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section className="context-bar">
        <div className="context-project">
          <span className="context-icon"><FileSpreadsheet size={19} /></span>
          <div>
            <span>BoQ untuk proyek</span>
            <strong>Implementasi WiFi Resort Ubud</strong>
          </div>
        </div>
        <div className="context-details">
          <span>PN-2607-014</span>
          <span>Bali Serenity Resort</span>
          <span className="status-badge info"><span className="badge-dot" /> Draft</span>
        </div>
      </section>

      <section className="boq-layout">
        <div className="boq-main">
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">ENTRI ITEM</span>
                <h2>Tambah kebutuhan proyek</h2>
              </div>
              <span className="helper-copy"><Sparkles size={15} /> Total dihitung otomatis</span>
            </div>
            <form className="boq-entry-form" onSubmit={addItem}>
              <div className="category-selector" role="group" aria-label="Kategori item">
                {(Object.keys(categoryIcons) as BoqItem["category"][]).map((itemCategory) => {
                  const Icon = categoryIcons[itemCategory];
                  return (
                    <button
                      className={category === itemCategory ? "active" : ""}
                      key={itemCategory}
                      type="button"
                      onClick={() => setCategory(itemCategory)}
                    >
                      <Icon size={17} />
                      {itemCategory}
                    </button>
                  );
                })}
              </div>
              <div className="form-grid boq-form-grid">
                <label className="field description-field">
                  <span>Deskripsi item</span>
                  <input
                    required
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Contoh: Access Point WiFi 6"
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
                  <span>Satuan</span>
                  <select value={unit} onChange={(event) => setUnit(event.target.value)}>
                    <option value="unit">unit</option>
                    <option value="box">box</option>
                    <option value="meter">meter</option>
                    <option value="paket">paket</option>
                    <option value="hari">hari</option>
                  </select>
                  <ChevronDown size={15} />
                </label>
                <label className="field">
                  <span>Harga pokok</span>
                  <input
                    type="number"
                    min="0"
                    value={costPrice || ""}
                    onChange={(event) => setCostPrice(Number(event.target.value))}
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>Harga jual</span>
                  <input
                    type="number"
                    min="0"
                    required
                    value={sellingPrice || ""}
                    onChange={(event) => setSellingPrice(Number(event.target.value))}
                    placeholder="0"
                  />
                </label>
                <button className="button primary add-item-button" type="submit">
                  <PackagePlus size={17} /> Tambah item
                </button>
              </div>
            </form>
          </section>

          <section className="panel boq-table-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">RINCIAN BIAYA</span>
                <h2>Daftar item BoQ</h2>
              </div>
              <span className="count-badge">{items.length} item</span>
            </div>
            <div className="table-scroll">
              <table className="data-table boq-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Harga pokok</th>
                    <th>Harga jual</th>
                    <th>Subtotal</th>
                    <th><span className="sr-only">Aksi</span></th>
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
                              <small>{item.category}</small>
                            </div>
                          </div>
                        </td>
                        <td>{item.quantity} {item.unit}</td>
                        <td>{formatCurrency(item.costPrice)}</td>
                        <td>{formatCurrency(item.sellingPrice)}</td>
                        <td><strong>{formatCurrency(item.quantity * item.sellingPrice)}</strong></td>
                        <td>
                          <button
                            className="icon-button danger"
                            type="button"
                            aria-label={`Hapus ${item.description}`}
                            onClick={() => deleteItem(item.id)}
                          >
                            <Trash2 size={16} />
                          </button>
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
                  <span>{item.category}</span>
                  <strong>{formatCurrency(item.amount)}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="boq-sidebar">
          <section className="panel total-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">REKAPITULASI</span>
                <h2>Total BoQ</h2>
              </div>
              <span className="metric-icon teal"><CircleDollarSign size={19} /></span>
            </div>
            <div className="total-list">
              <div>
                <span>Total harga pokok</span>
                <strong>{formatCurrency(totals.cost)}</strong>
              </div>
              <div>
                <span>Total harga jual</span>
                <strong>{formatCurrency(totals.selling)}</strong>
              </div>
              <div className="total-divider" />
              <div className="margin-total">
                <span>Estimasi margin</span>
                <strong>{formatCurrency(totals.margin)}</strong>
                <small>{totals.marginPercentage.toFixed(1)}% dari nilai penawaran</small>
              </div>
            </div>
            <div className="margin-meter">
              <span style={{ width: `${Math.min(totals.marginPercentage, 100)}%` }} />
            </div>
            <button className="button primary full-width" type="button" onClick={() => navigate("billing")}>
              Buat quotation <ArrowRight size={16} />
            </button>
          </section>

          <section className="panel template-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">TEMPLATE</span>
                <h2>BoQ tersimpan</h2>
              </div>
            </div>
            <div className="template-list">
              {templateList.map((template) => (
                <button
                  key={template.id}
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
              ))}
            </div>
            <div className="save-template-form">
              <label className="field">
                <span>Nama template baru</span>
                <input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Nama template"
                />
              </label>
              <button className="button secondary full-width" type="button" onClick={saveTemplate}>
                <Plus size={16} /> Simpan BoQ saat ini
              </button>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
