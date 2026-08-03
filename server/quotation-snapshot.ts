import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./db/client";

export async function snapshotQuotationItems(
  client: DatabaseClient,
  quotationId: string,
) {
  const existing = await client.execute({
    sql: "SELECT 1 FROM quotation_items WHERE quotation_id=? LIMIT 1",
    args: [quotationId],
  });
  if (existing.rows.length) return;
  const quotation = await client.execute({
    sql: "SELECT scope_id FROM quotations WHERE id=? LIMIT 1",
    args: [quotationId],
  });
  const scopeId = quotation.rows[0]?.scope_id;
  if (!scopeId) return;
  const items = await client.execute({
    sql: "SELECT * FROM boq_items WHERE scope_id=? ORDER BY sort_order,created_at",
    args: [scopeId],
  });
  if (!items.rows.length) return;
  const timestamp = new Date().toISOString();
  await client.batch(items.rows.map((item) => ({
    sql: `INSERT INTO quotation_items
      (id,quotation_id,source_item_id,category,description,quantity,unit,cost_price,
       selling_price,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      `quotation-item-${randomUUID()}`, quotationId, item.id, item.category,
      item.description, item.quantity, item.unit, item.cost_price, item.selling_price,
      item.sort_order, timestamp,
    ],
  })), "write");
}
