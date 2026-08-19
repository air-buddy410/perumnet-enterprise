"use client";

import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import type { CatalogItem, CatalogPayload } from "../data";
import { formatCurrency } from "../data";
import { type AppLanguage, BOQ_ROLES, localizedLabel } from "../i18n";

export function CatalogPicker({
  language,
  notify,
  onClose,
  onSelect,
}: {
  language: AppLanguage;
  notify: (message: string) => void;
  onClose: () => void;
  onSelect: (item: CatalogItem, tier: 1 | 2) => void;
}) {
  const id = language === "id";
  const [data, setData] = useState<CatalogPayload>({ categories: [], brands: [], items: [] });
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [tier, setTier] = useState<1 | 2>(1);

  useEffect(() => {
    api<CatalogPayload>("/api/catalog")
      .then(setData)
      .catch((error) => notify(messageOf(error, language)));
  }, [language, notify]);

  const categories = data.categories.filter((entry) => !role || entry.boqRole === role);
  const brands = data.brands.filter((entry) => !categoryId || entry.categoryId === categoryId);
  const items = useMemo(() => data.items.filter((entry) => {
    const needle = query.trim().toLowerCase();
    return (!role || entry.boqRole === role) && (!categoryId || entry.categoryId === categoryId) &&
      (!brandId || entry.brandId === brandId) && (!needle || [entry.name, entry.model, entry.sku, entry.brand ?? ""].some((value) => value.toLowerCase().includes(needle)));
  }), [brandId, categoryId, data.items, query, role]);
  const selected = data.items.find((entry) => entry.id === selectedId);

  return <div className="modal-backdrop catalog-picker-backdrop" role="presentation">
    <section className="catalog-picker" role="dialog" aria-modal="true" aria-labelledby="catalog-picker-title">
      <div className="catalog-picker-head"><div><span className="eyebrow">{id ? "DATABASE ITEM" : "ITEM DATABASE"}</span><h2 id="catalog-picker-title">{id ? "Pilih item untuk BoQ" : "Select an item for the BoQ"}</h2><p>{id ? "Filter berdasarkan kelompok, kategori produk, lalu merek." : "Filter by group, product category, then brand."}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label={id ? "Tutup" : "Close"}><X size={18} /></button></div>
      <div className="catalog-picker-filters">
        <label className="search-field"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari nama, SKU, model..." : "Search name, SKU, model..."} /></label>
        <select value={role} onChange={(event) => { setRole(event.target.value); setCategoryId(""); setBrandId(""); }}><option value="">{id ? "Semua kelompok" : "All groups"}</option>{BOQ_ROLES.map((entry) => <option key={entry} value={entry}>{localizedLabel(language, entry)}</option>)}</select>
        <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setBrandId(""); }}><option value="">{id ? "Semua kategori" : "All categories"}</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
        <select value={brandId} onChange={(event) => setBrandId(event.target.value)}><option value="">{id ? "Semua merek" : "All brands"}</option>{brands.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
      </div>
      <div className="catalog-picker-list">{items.map((item) => <button className={selectedId === item.id ? "selected" : ""} type="button" key={item.id} onClick={() => setSelectedId(item.id)}>
        <span className="catalog-picker-radio">{selectedId === item.id ? <Check size={14} /> : null}</span><span className="catalog-picker-copy"><strong>{item.name}</strong><small>{[item.category, item.brand, item.model].filter(Boolean).join(" · ")}</small><em>{item.sku}</em></span><span className="catalog-picker-prices"><strong>{formatCurrency(item.price1, language)}</strong><small>H1 · +{item.margin1Percent}%</small><strong>{formatCurrency(item.price2, language)}</strong><small>H2 · +{item.margin2Percent}%</small></span>
      </button>)}</div>
      {!items.length && <div className="catalog-empty">{id ? "Belum ada item sesuai filter." : "No matching items."}</div>}
      <div className="catalog-picker-footer"><div className="catalog-tier-control"><span>{id ? "Harga jual" : "Selling price"}</span><button className={tier === 1 ? "active" : ""} type="button" onClick={() => setTier(1)}>Harga 1</button><button className={tier === 2 ? "active" : ""} type="button" onClick={() => setTier(2)}>Harga 2</button></div><button className="button primary" type="button" disabled={!selected} onClick={() => { if (selected) onSelect(selected, tier); }}>{id ? "Gunakan item" : "Use item"} <Check size={16} /></button></div>
    </section>
  </div>;
}
