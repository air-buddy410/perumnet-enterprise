import "server-only";

import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { calculateQuotationCommercialTotals } from "../commercial";
import { syncProjectCommercialValue } from "./commercial-scope-router";
import { getDatabase, type DatabaseClient } from "../db/client";
import { ApiError, created, jsonBody, noContent, ok, partialPatchSchema } from "./errors";

const roleSchema = z.enum(["Perangkat", "Material", "Jasa", "Mobilitas"]);
const statusSchema = z.enum(["Aktif", "Nonaktif"]);
const idSchema = z.string().trim().min(1).max(100);
const categorySchema = z.object({
  boqRole: roleSchema,
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).optional().default(""),
  defaultMargin1Percent: z.number().min(0).max(1_000).default(20),
  defaultMargin2Percent: z.number().min(0).max(1_000).default(30),
  status: statusSchema.default("Aktif"),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
const brandSchema = z.object({
  categoryId: idSchema,
  name: z.string().trim().min(1).max(120),
  status: statusSchema.default("Aktif"),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
const itemSchema = z.object({
  categoryId: idSchema,
  brandId: idSchema.nullable().optional(),
  sku: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(180),
  nameEn: z.string().trim().max(180).optional().default(""),
  model: z.string().trim().max(120).optional().default(""),
  specifications: z.string().trim().max(2_000).optional().default(""),
  unit: z.string().trim().min(1).max(40).default("unit"),
  costPrice: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  margin1Percent: z.number().min(0).max(1_000),
  margin2Percent: z.number().min(0).max(1_000),
  status: statusSchema.default("Aktif"),
});

function bps(percent: number) {
  return Math.round(percent * 100);
}

function price(cost: number, marginBps: number) {
  return Math.round((cost * (10_000 + marginBps)) / 10_000);
}

function manageCatalog(user: AuthUser) {
  if (!(["Admin", "Finance"] as string[]).includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin dan Finance yang dapat mengelola katalog.");
  }
}

async function categoryAndBrand(
  client: DatabaseClient,
  categoryId: string,
  brandId?: string | null,
) {
  const categoryResult = await client.execute({
    sql: "SELECT * FROM item_catalog_categories WHERE id=? LIMIT 1",
    args: [categoryId],
  });
  const category = categoryResult.rows[0];
  if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Kategori katalog tidak ditemukan.");
  let brand: Record<string, unknown> | undefined;
  if (brandId) {
    const brandResult = await client.execute({
      sql: "SELECT * FROM item_catalog_brands WHERE id=? AND category_id=? LIMIT 1",
      args: [brandId, categoryId],
    });
    brand = brandResult.rows[0];
    if (!brand) throw new ApiError(422, "BRAND_CATEGORY_MISMATCH", "Merek tidak termasuk dalam kategori yang dipilih.");
  }
  if (["Perangkat", "Material"].includes(String(category.boq_role)) && !brand) {
    throw new ApiError(422, "BRAND_REQUIRED", "Merek wajib dipilih untuk Perangkat dan Material.");
  }
  return { category, brand };
}

// Both item_catalog_brands.category_id and item_catalog_items.category_id are
// ON DELETE RESTRICT, so checking for items and then deleting in a separate
// statement leaves a window: a brand or an item committed in between turns the
// DELETE into a raw RESTRICT violation instead of the friendly 409 this route
// promises. Holding the category row for the whole check-and-delete closes it —
// on PostgreSQL through FOR UPDATE, which conflicts with the FOR KEY SHARE lock
// a child insert takes, and on SQLite through the write transaction itself.
async function deleteCatalogCategory(client: DatabaseClient, categoryId: string) {
  await client.transaction(async (tx) => {
    const locked = await tx.execute({
      sql: `SELECT id FROM item_catalog_categories WHERE id=?${
        tx.dialect === "postgres" ? " FOR UPDATE" : ""
      }`,
      args: [categoryId],
    });
    if (!locked.rows.length) {
      throw new ApiError(404, "NOT_FOUND", "Kategori tidak ditemukan.");
    }
    const usage = await tx.execute({
      sql: "SELECT id FROM item_catalog_items WHERE category_id=? LIMIT 1",
      args: [categoryId],
    });
    if (usage.rows.length) {
      throw new ApiError(
        409,
        "CATEGORY_IN_USE",
        "Kategori sudah memiliki item. Nonaktifkan kategori agar histori tetap aman.",
      );
    }
    await tx.execute({
      sql: "DELETE FROM item_catalog_brands WHERE category_id=?",
      args: [categoryId],
    });
    await tx.execute({
      sql: "DELETE FROM item_catalog_categories WHERE id=?",
      args: [categoryId],
    });
  });
}

function mapCategory(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    boqRole: String(row.boq_role),
    name: String(row.name),
    nameEn: String(row.name_en ?? ""),
    defaultMargin1Percent: Number(row.default_margin_1_bps ?? 0) / 100,
    defaultMargin2Percent: Number(row.default_margin_2_bps ?? 0) / 100,
    status: String(row.status),
    sortOrder: Number(row.sort_order ?? 0),
    itemCount: Number(row.item_count ?? 0),
  };
}

function mapBrand(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    categoryId: String(row.category_id),
    category: String(row.category_name ?? ""),
    name: String(row.name),
    status: String(row.status),
    sortOrder: Number(row.sort_order ?? 0),
    itemCount: Number(row.item_count ?? 0),
  };
}

function mapItem(row: Record<string, unknown>) {
  const costPrice = Number(row.cost_price ?? 0);
  const margin1Bps = Number(row.margin_1_bps ?? 0);
  const margin2Bps = Number(row.margin_2_bps ?? 0);
  return {
    id: String(row.id),
    categoryId: String(row.category_id),
    category: String(row.category_name ?? ""),
    categoryEn: String(row.category_name_en ?? ""),
    boqRole: String(row.boq_role),
    brandId: row.brand_id ? String(row.brand_id) : null,
    brand: row.brand_name ? String(row.brand_name) : null,
    sku: String(row.sku),
    name: String(row.name),
    nameEn: String(row.name_en ?? ""),
    model: String(row.model ?? ""),
    specifications: String(row.specifications ?? ""),
    unit: String(row.unit),
    costPrice,
    margin1Percent: margin1Bps / 100,
    margin2Percent: margin2Bps / 100,
    price1: price(costPrice, margin1Bps),
    price2: price(costPrice, margin2Bps),
    status: String(row.status),
    revision: Number(row.revision ?? 1),
    usageCount: Number(row.usage_count ?? 0),
  };
}

const itemSelect = `SELECT i.*,c.boq_role,c.name AS category_name,c.name_en AS category_name_en,
  b.name AS brand_name,
  (SELECT COUNT(*) FROM boq_items bi WHERE bi.catalog_item_id=i.id) +
  (SELECT COUNT(*) FROM standalone_boq_items si WHERE si.catalog_item_id=i.id) AS usage_count
  FROM item_catalog_items i
  JOIN item_catalog_categories c ON c.id=i.category_id
  LEFT JOIN item_catalog_brands b ON b.id=i.brand_id`;

async function resetAffectedQuotations(client: DatabaseClient, catalogItemId: string) {
  const scopes = await client.execute({
    sql: `SELECT DISTINCT s.id,s.boq_id,q.id AS quotation_id,q.project_id,q.status AS quotation_status
      FROM boq_items i
      JOIN boq_scopes s ON s.id=i.scope_id
      LEFT JOIN quotations q ON q.scope_id=s.id AND q.status IN ('Draft','Sent')
      WHERE i.catalog_item_id=? AND s.status<>'Accepted'`,
    args: [catalogItemId],
  });
  const timestamp = new Date().toISOString();
  let quotationsReset = 0;
  for (const scope of scopes.rows) {
    const totalResult = await client.execute({
      sql: "SELECT COALESCE(SUM(quantity*selling_price),0) AS total FROM boq_items WHERE scope_id=?",
      args: [scope.id],
    });
    const total = Number(totalResult.rows[0]?.total ?? 0);
    if (scope.quotation_id) {
      if (String(scope.quotation_status) === "Sent") {
        quotationsReset += 1;
        await client.execute({
          sql: "UPDATE quotations SET status='Draft',updated_at=? WHERE id=? AND status='Sent'",
          args: [timestamp, scope.quotation_id],
        });
      }
      const quote = await client.execute({
        sql: `SELECT discount_enabled,discount_type,discount_value,rounding_mode,
          rounding_step,rounding_adjustment FROM quotations WHERE id=? AND status='Draft' LIMIT 1`,
        args: [scope.quotation_id],
      });
      if (!quote.rows[0]) continue;
      const commercialBeforeTax = calculateQuotationCommercialTotals({
        subtotal: total,
        discountEnabled: Boolean(Number(quote.rows[0].discount_enabled ?? 0)),
        discountType: String(quote.rows[0].discount_type ?? "Nominal") as "Nominal" | "Percent",
        discountValue: Number(quote.rows[0].discount_value ?? 0),
        roundingMode: String(quote.rows[0].rounding_mode ?? "None") as "None" | "Up" | "Down" | "Custom",
        roundingStep: Number(quote.rows[0].rounding_step ?? 0),
        customRoundingAdjustment: String(quote.rows[0].rounding_mode) === "Custom"
          ? Number(quote.rows[0].rounding_adjustment ?? 0)
          : 0,
      });
      await client.execute({
        sql: `UPDATE document_taxes
          SET taxable_base=?,amount=ROUND(?*rate_bps/10000.0),locked=0,locked_at=NULL,updated_at=?
          WHERE document_type='Quotation' AND document_id=?`,
        args: [commercialBeforeTax.taxableBase, commercialBeforeTax.taxableBase, timestamp, scope.quotation_id],
      });
      const taxTotals = await client.execute({
        sql: `SELECT
          COALESCE(SUM(CASE WHEN effect='Add' THEN amount ELSE 0 END),0) AS additions,
          COALESCE(SUM(CASE WHEN effect='Withhold' THEN amount ELSE 0 END),0) AS withholdings
          FROM document_taxes WHERE document_type='Quotation' AND document_id=?`,
        args: [scope.quotation_id],
      });
      const commercial = calculateQuotationCommercialTotals({
        subtotal: total,
        discountEnabled: Boolean(Number(quote.rows[0].discount_enabled ?? 0)),
        discountType: String(quote.rows[0].discount_type ?? "Nominal") as "Nominal" | "Percent",
        discountValue: Number(quote.rows[0].discount_value ?? 0),
        taxAdditions: Number(taxTotals.rows[0]?.additions ?? 0),
        taxWithholdings: Number(taxTotals.rows[0]?.withholdings ?? 0),
        roundingMode: String(quote.rows[0].rounding_mode ?? "None") as "None" | "Up" | "Down" | "Custom",
        roundingStep: Number(quote.rows[0].rounding_step ?? 0),
        customRoundingAdjustment: String(quote.rows[0].rounding_mode) === "Custom"
          ? Number(quote.rows[0].rounding_adjustment ?? 0)
          : 0,
      });
      await client.execute({
        sql: `UPDATE quotations SET total=?,discount_amount=?,taxable_base=?,tax_additions_snapshot=?,
          tax_withholdings_snapshot=?,rounding_adjustment=?,grand_total=?,updated_at=?
          WHERE id=? AND status='Draft'`,
        args: [commercial.subtotal, commercial.discountAmount, commercial.taxableBase,
          commercial.taxAdditions, commercial.taxWithholdings, commercial.roundingAdjustment,
          commercial.grandTotal, timestamp, scope.quotation_id],
      });
    }
    await client.execute({
      sql: "UPDATE boq_scopes SET status=CASE WHEN status='Sent' THEN 'Draft' ELSE status END,updated_at=? WHERE id=?",
      args: [timestamp, scope.id],
    });
    if (scope.project_id) {
      await syncProjectCommercialValue(client, String(scope.project_id));
    }
  }
  return quotationsReset;
}

async function syncCatalogItem(client: DatabaseClient, itemId: string) {
  const result = await client.execute({ sql: `${itemSelect} WHERE i.id=? LIMIT 1`, args: [itemId] });
  const row = result.rows[0];
  if (!row) return { boqRows: 0, quotationsReset: 0 };
  const price1 = price(Number(row.cost_price), Number(row.margin_1_bps));
  const price2 = price(Number(row.cost_price), Number(row.margin_2_bps));
  const description = [row.name, row.model].filter(Boolean).join(" — ");
  const activeRows = await client.execute({
    sql: `SELECT i.id FROM boq_items i LEFT JOIN boq_scopes s ON s.id=i.scope_id
      WHERE i.catalog_item_id=? AND COALESCE(s.status,'Draft')<>'Accepted'`,
    args: [itemId],
  });
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: `UPDATE boq_items SET category=?,description=?,unit=?,cost_price=?,catalog_revision=?,
      selling_price=CASE WHEN manual_price_override=1 THEN selling_price
        WHEN catalog_price_tier=2 THEN ? ELSE ? END,updated_at=?
      WHERE catalog_item_id=? AND id IN (
        SELECT i.id FROM boq_items i LEFT JOIN boq_scopes s ON s.id=i.scope_id
        WHERE i.catalog_item_id=? AND COALESCE(s.status,'Draft')<>'Accepted'
      )`,
    args: [row.boq_role, description, row.unit, row.cost_price, row.revision, price2, price1, timestamp, itemId, itemId],
  });
  await client.execute({
    sql: `UPDATE boq_template_items SET category=?,description=?,unit=?,cost_price=?,catalog_revision=?,
      selling_price=CASE WHEN manual_price_override=1 THEN selling_price
        WHEN catalog_price_tier=2 THEN ? ELSE ? END WHERE catalog_item_id=?`,
    args: [row.boq_role, description, row.unit, row.cost_price, row.revision, price2, price1, itemId],
  });
  await client.execute({
    sql: `UPDATE standalone_boq_items SET category=?,description=?,unit=?,cost_price=?,catalog_revision=?,
      selling_price=CASE WHEN manual_price_override=1 THEN selling_price
        WHEN catalog_price_tier=2 THEN ? ELSE ? END,updated_at=?
      WHERE catalog_item_id=?`,
    args: [row.boq_role, description, row.unit, row.cost_price, row.revision, price2, price1, timestamp, itemId],
  });
  return { boqRows: activeRows.rows.length, quotationsReset: await resetAffectedQuotations(client, itemId) };
}

async function assertCatalogPriceUpdateCoversInvoices(
  client: DatabaseClient,
  itemId: string,
  costPrice: number,
  margin1Bps: number,
  margin2Bps: number,
) {
  const projects = await client.execute({
    sql: `SELECT DISTINCT b.project_id
      FROM boq_items i
      JOIN boqs b ON b.id=i.boq_id
      LEFT JOIN boq_scopes s ON s.id=i.scope_id
      WHERE i.catalog_item_id=? AND COALESCE(s.status,'Draft')='Draft'`,
    args: [itemId],
  });
  const tier1 = price(costPrice, margin1Bps);
  const tier2 = price(costPrice, margin2Bps);
  for (const project of projects.rows) {
    const totals = await client.execute({
      sql: `SELECT
        COALESCE((SELECT SUM(i.quantity*i.selling_price)
          FROM boq_items i JOIN boqs b ON b.id=i.boq_id
          WHERE b.project_id=?),0) AS current_total,
        COALESCE((SELECT SUM(i.quantity *
          ((CASE WHEN i.catalog_price_tier=2 THEN ? ELSE ? END)-i.selling_price))
          FROM boq_items i
          JOIN boqs b ON b.id=i.boq_id
          LEFT JOIN boq_scopes s ON s.id=i.scope_id
          WHERE b.project_id=? AND i.catalog_item_id=?
            AND i.manual_price_override=0
            AND COALESCE(s.status,'Draft')='Draft'),0) AS delta,
        COALESCE((SELECT SUM(amount) FROM invoices WHERE project_id=?),0) AS invoiced_total`,
      args: [project.project_id, tier2, tier1, project.project_id, itemId, project.project_id],
    });
    const currentTotal = Number(totals.rows[0]?.current_total ?? 0);
    const proposedTotal = currentTotal + Number(totals.rows[0]?.delta ?? 0);
    const invoicedTotal = Number(totals.rows[0]?.invoiced_total ?? 0);
    if (proposedTotal < invoicedTotal) {
      throw new ApiError(
        409,
        "CATALOG_PRICE_BELOW_INVOICED_TOTAL",
        `Pembaruan diblokir karena nilai BoQ proyek ${project.project_id} akan menjadi lebih kecil daripada Invoice yang sudah diterbitkan.`,
      );
    }
  }
}

async function listCatalog(request: Request) {
  const { client } = await getDatabase();
  const url = new URL(request.url);
  const role = url.searchParams.get("role");
  const categoryId = url.searchParams.get("categoryId");
  const brandId = url.searchParams.get("brandId");
  const query = url.searchParams.get("q")?.trim().toLowerCase();
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (!includeInactive) conditions.push("i.status='Aktif'", "c.status='Aktif'", "(b.id IS NULL OR b.status='Aktif')");
  if (role) { conditions.push("c.boq_role=?"); args.push(role); }
  if (categoryId) { conditions.push("i.category_id=?"); args.push(categoryId); }
  if (brandId) { conditions.push("i.brand_id=?"); args.push(brandId); }
  if (query) {
    conditions.push("(lower(i.name) LIKE ? OR lower(i.sku) LIKE ? OR lower(i.model) LIKE ? OR lower(COALESCE(b.name,'')) LIKE ?)");
    args.push(...Array(4).fill(`%${query}%`));
  }
  const [categories, brands, items] = await Promise.all([
    client.execute(`SELECT c.*,(SELECT COUNT(*) FROM item_catalog_items i WHERE i.category_id=c.id) AS item_count
      FROM item_catalog_categories c ORDER BY c.boq_role,c.sort_order,c.name`),
    client.execute(`SELECT b.*,c.name AS category_name,(SELECT COUNT(*) FROM item_catalog_items i WHERE i.brand_id=b.id) AS item_count
      FROM item_catalog_brands b JOIN item_catalog_categories c ON c.id=b.category_id
      ORDER BY c.sort_order,b.sort_order,b.name`),
    client.execute({
      sql: `${itemSelect}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY c.sort_order,b.sort_order,i.name,i.model`,
      args,
    }),
  ]);
  return ok({
    categories: categories.rows.map(mapCategory),
    brands: brands.rows.map(mapBrand),
    items: items.rows.map(mapItem),
  });
}

async function exportCatalog(request: Request, user: AuthUser) {
  manageCatalog(user);
  const { client } = await getDatabase();
  const rows = await client.execute(`${itemSelect} ORDER BY c.sort_order,b.sort_order,i.name,i.model`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PerumNet Enterprise";
  const sheet = workbook.addWorksheet("Katalog Item", { views: [{ state: "frozen", ySplit: 1 }] });
  const columns: Array<[string, number]> = [
    ["Peran BoQ", 16], ["Kategori", 24], ["Merek", 20], ["SKU", 18], ["Nama Item", 30],
    ["Nama Inggris", 30], ["Model", 20], ["Spesifikasi", 40], ["Satuan", 12],
    ["Harga Pokok", 16], ["Margin 1 (%)", 14], ["Harga 1", 16], ["Margin 2 (%)", 14],
    ["Harga 2", 16], ["Status", 12],
  ];
  sheet.columns = columns.map(([header, width], index) => ({ header, key: `c${index}`, width }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF078E87" } };
  for (const row of rows.rows.map(mapItem)) {
    sheet.addRow([row.boqRole, row.category, row.brand ?? "", row.sku, row.name, row.nameEn, row.model,
      row.specifications, row.unit, row.costPrice, row.margin1Percent, row.price1, row.margin2Percent, row.price2, row.status]);
  }
  [10, 12, 14].forEach((column) => { sheet.getColumn(column).numFmt = "#,##0"; });
  const buffer = await workbook.xlsx.writeBuffer();
  await writeAuditLog(client, request, user, "export", "item_catalog", undefined, { format: "xlsx", rows: rows.rows.length });
  return new Response(buffer as ArrayBuffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="katalog-item-${new Date().toISOString().slice(0, 10)}.xlsx"`,
  } });
}

async function importCatalog(request: Request, user: AuthUser) {
  manageCatalog(user);
  const { client } = await getDatabase();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || !/\.xlsx$/i.test(file.name)) {
    throw new ApiError(422, "INVALID_FILE", "Gunakan file XLSX maksimal 5 MB.");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ApiError(422, "EMPTY_WORKBOOK", "Workbook tidak memiliki worksheet.");
  const rows: Array<Record<string, unknown>> = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = row.values as unknown[];
    if (!String(values[4] ?? "").trim()) return;
    rows.push({
      boqRole: String(values[1] ?? "").trim(), category: String(values[2] ?? "").trim(),
      brand: String(values[3] ?? "").trim(), sku: String(values[4] ?? "").trim(), name: String(values[5] ?? "").trim(),
      nameEn: String(values[6] ?? "").trim(), model: String(values[7] ?? "").trim(), specifications: String(values[8] ?? "").trim(),
      unit: String(values[9] ?? "unit").trim(), costPrice: Number(values[10] ?? 0), margin1Percent: Number(values[11] ?? 0),
      margin2Percent: Number(values[13] ?? 0), status: String(values[15] ?? "Aktif").trim(), row: index,
    });
  });
  if (!rows.length || rows.length > 2_000) throw new ApiError(422, "INVALID_ROWS", "File harus berisi 1 sampai 2.000 item.");
  const errors: Array<{ row: number; message: string }> = [];
  const prepared: Array<ReturnType<typeof itemSchema.parse> & { id: string; categoryId: string; brandId: string | null }> = [];
  for (const raw of rows) {
    try {
      const role = roleSchema.parse(raw.boqRole);
      let category = (await client.execute({ sql: "SELECT * FROM item_catalog_categories WHERE boq_role=? AND lower(name)=lower(?) LIMIT 1", args: [role, raw.category] })).rows[0];
      if (!category) {
        const categoryId = randomUUID();
        const timestamp = new Date().toISOString();
        await client.execute({ sql: `INSERT INTO item_catalog_categories
          (id,boq_role,name,name_en,default_margin_1_bps,default_margin_2_bps,status,sort_order,created_by,created_at,updated_at)
          VALUES (?,?,?,?,2000,3000,'Aktif',999,?,?,?)`, args: [categoryId, role, raw.category, raw.category, user.id, timestamp, timestamp] });
        category = { id: categoryId, boq_role: role };
      }
      let brandId: string | null = null;
      if (raw.brand) {
        let brand = (await client.execute({ sql: "SELECT id FROM item_catalog_brands WHERE category_id=? AND lower(name)=lower(?) LIMIT 1", args: [category.id, raw.brand] })).rows[0];
        if (!brand) {
          brand = { id: randomUUID() };
          const timestamp = new Date().toISOString();
          await client.execute({ sql: `INSERT INTO item_catalog_brands
            (id,category_id,name,status,sort_order,created_by,created_at,updated_at) VALUES (?,?,?,'Aktif',999,?,?,?)`,
            args: [brand.id, category.id, raw.brand, user.id, timestamp, timestamp] });
        }
        brandId = String(brand.id);
      }
      const parsed = itemSchema.parse({ ...raw, categoryId: String(category.id), brandId });
      await categoryAndBrand(client, parsed.categoryId, parsed.brandId);
      const existing = await client.execute({ sql: "SELECT id FROM item_catalog_items WHERE sku=? LIMIT 1", args: [parsed.sku] });
      prepared.push({ ...parsed, id: existing.rows[0] ? String(existing.rows[0].id) : randomUUID(), categoryId: parsed.categoryId, brandId: parsed.brandId ?? null });
    } catch (error) {
      errors.push({ row: Number(raw.row), message: error instanceof Error ? error.message : "Data tidak valid" });
    }
  }
  if (errors.length) throw new ApiError(422, "IMPORT_VALIDATION_FAILED", "Import dibatalkan karena terdapat baris tidak valid.", errors);
  const timestamp = new Date().toISOString();
  await client.transaction(async (tx) => {
    for (const item of prepared) {
      await tx.execute({ sql: `INSERT INTO item_catalog_items
        (id,category_id,brand_id,sku,name,name_en,model,specifications,unit,cost_price,margin_1_bps,margin_2_bps,status,revision,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)
        ON CONFLICT (sku) DO UPDATE SET category_id=excluded.category_id,brand_id=excluded.brand_id,name=excluded.name,
          name_en=excluded.name_en,model=excluded.model,specifications=excluded.specifications,unit=excluded.unit,
          cost_price=excluded.cost_price,margin_1_bps=excluded.margin_1_bps,margin_2_bps=excluded.margin_2_bps,
          status=excluded.status,revision=item_catalog_items.revision+1,updated_at=excluded.updated_at`,
        args: [item.id,item.categoryId,item.brandId,item.sku,item.name,item.nameEn,item.model,item.specifications,item.unit,
          item.costPrice,bps(item.margin1Percent),bps(item.margin2Percent),item.status,user.id,timestamp,timestamp] });
    }
  });
  let synchronized = 0;
  for (const item of prepared) synchronized += (await syncCatalogItem(client, item.id)).boqRows;
  await writeAuditLog(client, request, user, "import", "item_catalog", undefined, { items: prepared.length, synchronized });
  return created({ imported: prepared.length, synchronized });
}

export async function handleCatalog(request: Request, path: string[], user: AuthUser) {
  const { client } = await getDatabase();
  const child = path[1];
  const id = path[2];
  if (request.method === "GET" && !child) return listCatalog(request);
  if (request.method === "GET" && child === "export.xlsx") return exportCatalog(request, user);
  if (request.method === "POST" && child === "import") return importCatalog(request, user);
  manageCatalog(user);

  if (child === "categories" && request.method === "POST" && !id) {
    const input = categorySchema.parse(await jsonBody(request));
    const categoryId = randomUUID();
    const timestamp = new Date().toISOString();
    await client.execute({ sql: `INSERT INTO item_catalog_categories
      (id,boq_role,name,name_en,default_margin_1_bps,default_margin_2_bps,status,sort_order,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, args: [categoryId,input.boqRole,input.name,input.nameEn,bps(input.defaultMargin1Percent),
      bps(input.defaultMargin2Percent),input.status,input.sortOrder,user.id,timestamp,timestamp] });
    await writeAuditLog(client, request, user, "create", "item_catalog_category", categoryId, input);
    return created({ id: categoryId });
  }
  if (child === "categories" && id && request.method === "PATCH") {
    const current = (await client.execute({ sql: "SELECT * FROM item_catalog_categories WHERE id=?", args: [id] })).rows[0];
    if (!current) throw new ApiError(404, "NOT_FOUND", "Kategori tidak ditemukan.");
    const input = partialPatchSchema(categorySchema).parse(await jsonBody(request));
    await client.execute({ sql: `UPDATE item_catalog_categories SET boq_role=?,name=?,name_en=?,default_margin_1_bps=?,
      default_margin_2_bps=?,status=?,sort_order=?,updated_at=? WHERE id=?`, args: [input.boqRole ?? current.boq_role,
      input.name ?? current.name,input.nameEn ?? current.name_en,input.defaultMargin1Percent === undefined ? current.default_margin_1_bps : bps(input.defaultMargin1Percent),
      input.defaultMargin2Percent === undefined ? current.default_margin_2_bps : bps(input.defaultMargin2Percent),input.status ?? current.status,
      input.sortOrder ?? current.sort_order,new Date().toISOString(),id] });
    await writeAuditLog(client, request, user, "update", "item_catalog_category", id, input);
    return ok({ id });
  }
  if (child === "categories" && id && request.method === "DELETE") {
    await deleteCatalogCategory(client, id);
    await writeAuditLog(client, request, user, "delete", "item_catalog_category", id);
    return noContent();
  }
  if (child === "brands" && request.method === "POST" && !id) {
    const input = brandSchema.parse(await jsonBody(request));
    await categoryAndBrand(client, input.categoryId, null).catch((error) => {
      if (error instanceof ApiError && error.code === "BRAND_REQUIRED") return undefined;
      throw error;
    });
    const brandId = randomUUID(); const timestamp = new Date().toISOString();
    await client.execute({ sql: `INSERT INTO item_catalog_brands
      (id,category_id,name,status,sort_order,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      args: [brandId,input.categoryId,input.name,input.status,input.sortOrder,user.id,timestamp,timestamp] });
    await writeAuditLog(client, request, user, "create", "item_catalog_brand", brandId, input);
    return created({ id: brandId });
  }
  if (child === "brands" && id && request.method === "PATCH") {
    const current = (await client.execute({ sql: "SELECT * FROM item_catalog_brands WHERE id=?", args: [id] })).rows[0];
    if (!current) throw new ApiError(404, "NOT_FOUND", "Merek tidak ditemukan.");
    const input = partialPatchSchema(brandSchema).parse(await jsonBody(request));
    const nextCategoryId = String(input.categoryId ?? current.category_id);
    // Nothing else validated this id, so an unknown category reached the
    // RESTRICT constraint and came back as a raw 500 on a plain edit.
    if (nextCategoryId !== String(current.category_id)) {
      const target = await client.execute({
        sql: "SELECT id FROM item_catalog_categories WHERE id=? LIMIT 1",
        args: [nextCategoryId],
      });
      if (!target.rows.length) {
        throw new ApiError(404, "CATEGORY_NOT_FOUND", "Kategori katalog tidak ditemukan.");
      }
    }
    await client.execute({ sql: "UPDATE item_catalog_brands SET category_id=?,name=?,status=?,sort_order=?,updated_at=? WHERE id=?",
      args: [nextCategoryId,input.name ?? current.name,input.status ?? current.status,input.sortOrder ?? current.sort_order,new Date().toISOString(),id] });
    await writeAuditLog(client, request, user, "update", "item_catalog_brand", id, input); return ok({ id });
  }
  if (child === "brands" && id && request.method === "DELETE") {
    const usage = await client.execute({ sql: "SELECT id FROM item_catalog_items WHERE brand_id=? LIMIT 1", args: [id] });
    if (usage.rows.length) throw new ApiError(409, "BRAND_IN_USE", "Merek sudah digunakan. Nonaktifkan merek agar histori tetap aman.");
    await client.execute({ sql: "DELETE FROM item_catalog_brands WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "item_catalog_brand", id); return noContent();
  }
  if (child === "items" && request.method === "POST" && !id) {
    const input = itemSchema.parse(await jsonBody(request));
    await categoryAndBrand(client, input.categoryId, input.brandId);
    const itemId = randomUUID(); const timestamp = new Date().toISOString();
    await client.execute({ sql: `INSERT INTO item_catalog_items
      (id,category_id,brand_id,sku,name,name_en,model,specifications,unit,cost_price,margin_1_bps,margin_2_bps,status,revision,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`, args: [itemId,input.categoryId,input.brandId ?? null,input.sku,input.name,input.nameEn,
      input.model,input.specifications,input.unit,input.costPrice,bps(input.margin1Percent),bps(input.margin2Percent),input.status,user.id,timestamp,timestamp] });
    await writeAuditLog(client, request, user, "create", "item_catalog_item", itemId, input); return created({ id: itemId });
  }
  if (child === "items" && id && request.method === "PATCH") {
    const current = (await client.execute({ sql: "SELECT * FROM item_catalog_items WHERE id=?", args: [id] })).rows[0];
    if (!current) throw new ApiError(404, "NOT_FOUND", "Item katalog tidak ditemukan.");
    const input = partialPatchSchema(itemSchema).parse(await jsonBody(request));
    const nextCategoryId = String(input.categoryId ?? current.category_id);
    const nextBrandId = input.brandId === undefined ? (current.brand_id ? String(current.brand_id) : null) : input.brandId;
    await categoryAndBrand(client, nextCategoryId, nextBrandId);
    const nextCostPrice = Number(input.costPrice ?? current.cost_price);
    const nextMargin1Bps = input.margin1Percent === undefined
      ? Number(current.margin_1_bps)
      : bps(input.margin1Percent);
    const nextMargin2Bps = input.margin2Percent === undefined
      ? Number(current.margin_2_bps)
      : bps(input.margin2Percent);
    await assertCatalogPriceUpdateCoversInvoices(
      client,
      id,
      nextCostPrice,
      nextMargin1Bps,
      nextMargin2Bps,
    );
    await client.execute({ sql: `UPDATE item_catalog_items SET category_id=?,brand_id=?,sku=?,name=?,name_en=?,model=?,specifications=?,unit=?,
      cost_price=?,margin_1_bps=?,margin_2_bps=?,status=?,revision=revision+1,updated_at=? WHERE id=?`, args: [nextCategoryId,nextBrandId,
      input.sku ?? current.sku,input.name ?? current.name,input.nameEn ?? current.name_en,input.model ?? current.model,input.specifications ?? current.specifications,
      input.unit ?? current.unit,nextCostPrice,nextMargin1Bps,
      nextMargin2Bps,input.status ?? current.status,new Date().toISOString(),id] });
    const sync = await syncCatalogItem(client, id);
    await writeAuditLog(client, request, user, "update", "item_catalog_item", id, { ...input, sync }); return ok({ id, ...sync });
  }
  if (child === "items" && id && request.method === "DELETE") {
    const usage = await client.execute({ sql: `SELECT id FROM boq_items WHERE catalog_item_id=? UNION ALL
      SELECT id FROM standalone_boq_items WHERE catalog_item_id=? LIMIT 1`, args: [id,id] });
    if (usage.rows.length) throw new ApiError(409, "ITEM_IN_USE", "Item sudah dipakai dalam BoQ. Nonaktifkan item agar histori tetap aman.");
    await client.execute({ sql: "DELETE FROM item_catalog_items WHERE id=?", args: [id] });
    await writeAuditLog(client, request, user, "delete", "item_catalog_item", id); return noContent();
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint katalog tidak ditemukan.");
}
