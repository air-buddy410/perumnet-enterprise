import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canAccess } from "@/shared/access";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { claimSequence } from "../db/counters";
import { snapshotQuotationItems } from "../quotation-snapshot";
import { lockDocumentTaxes } from "../tax";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";
import { renderBusinessPdf } from "./pdf";

const idSchema = z.string().trim().min(1).max(100);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(240),
  mimeType: z
    .string()
    .trim()
    .regex(/^(application\/pdf|image\/(png|jpeg|webp))$/),
  contentBase64: z.string().min(4).max(8_500_000),
});
const itemSchema = z.object({
  id: idSchema.optional(),
  category: z.enum(["Perangkat", "Material", "Jasa", "Mobilitas"]),
  description: z.string().trim().min(2).max(240),
  quantity: z.number().int().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  costPrice: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sellingPrice: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  catalogItemId: idSchema.nullable().optional(),
  catalogPriceTier: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  manualPriceOverride: z.boolean().optional().default(false),
  priceOverrideReason: z.string().trim().max(500).nullable().optional(),
});
const scopeSchema = z.object({
  title: z.string().trim().min(3).max(160),
  issuedAt: isoDateSchema.optional(),
  validUntil: isoDateSchema.optional(),
  items: z.array(itemSchema).min(1).max(500),
});

function now() {
  return new Date().toISOString();
}

function todayInMakassar() {
  return new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

function assertValidityManager(user: AuthUser, input: { issuedAt?: string; validUntil?: string }) {
  if (
    (input.issuedAt !== undefined || input.validUntil !== undefined) &&
    !["Admin", "Finance"].includes(user.role)
  ) {
    throw new ApiError(
      403,
      "QUOTATION_VALIDITY_FORBIDDEN",
      "Hanya Admin dan Finance yang dapat mengubah tanggal dan masa berlaku Quotation.",
    );
  }
}

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

type ScopeItemInput = z.infer<typeof itemSchema>;

async function resolveScopeItems(
  client: DatabaseClient,
  user: AuthUser,
  items: ScopeItemInput[],
) {
  return Promise.all(
    items.map(async (item) => {
      if (!item.catalogItemId) {
        return {
          ...item,
          catalogItemId: null,
          catalogPriceTier: null,
          catalogRevision: null,
          manualPriceOverride: false,
          priceOverrideReason: null,
        };
      }
      const result = await client.execute({
        sql: `SELECT i.*,c.boq_role,b.id AS active_brand_id
          FROM item_catalog_items i
          JOIN item_catalog_categories c ON c.id=i.category_id
          LEFT JOIN item_catalog_brands b ON b.id=i.brand_id AND b.status='Aktif'
          WHERE i.id=? AND i.status='Aktif' AND c.status='Aktif' LIMIT 1`,
        args: [item.catalogItemId],
      });
      const catalog = result.rows[0];
      if (
        !catalog ||
        (catalog.brand_id && !catalog.active_brand_id)
      ) {
        throw new ApiError(
          422,
          "CATALOG_ITEM_UNAVAILABLE",
          "Item katalog tidak tersedia atau sudah dinonaktifkan.",
        );
      }
      const tier = item.catalogPriceTier === 2 ? 2 : 1;
      const costPrice = numberValue(catalog.cost_price);
      const marginBps = numberValue(
        tier === 2 ? catalog.margin_2_bps : catalog.margin_1_bps,
      );
      const sellingPrice = Math.round(
        (costPrice * (10_000 + marginBps)) / 10_000,
      );
      if (item.manualPriceOverride && !["Admin", "Finance"].includes(user.role)) {
        throw new ApiError(
          403,
          "PRICE_OVERRIDE_FORBIDDEN",
          "Hanya Admin dan Finance yang dapat mengganti harga katalog secara manual.",
        );
      }
      if (item.manualPriceOverride && !item.priceOverrideReason?.trim()) {
        throw new ApiError(
          422,
          "PRICE_OVERRIDE_REASON_REQUIRED",
          "Alasan perubahan harga wajib diisi.",
        );
      }
      return {
        ...item,
        category: String(catalog.boq_role) as ScopeItemInput["category"],
        description: [catalog.name, catalog.model].filter(Boolean).join(" — "),
        unit: String(catalog.unit),
        costPrice,
        sellingPrice: item.manualPriceOverride ? item.sellingPrice : sellingPrice,
        catalogItemId: String(catalog.id),
        catalogPriceTier: tier,
        catalogRevision: numberValue(catalog.revision),
        manualPriceOverride: Boolean(item.manualPriceOverride),
        priceOverrideReason: item.manualPriceOverride
          ? item.priceOverrideReason?.trim() ?? null
          : null,
      };
    }),
  );
}

function assertManage(user: AuthUser, module: "boq" | "billing") {
  if (!canAccess(user.permissions, module, "manage")) {
    throw new ApiError(403, "FORBIDDEN", "Akun Anda tidak memiliki izin untuk mengelola dokumen ini.");
  }
}

async function assertProjectAccess(
  client: DatabaseClient,
  user: AuthUser,
  projectId: string,
) {
  const global = user.role === "Admin" || user.role === "Finance";
  const result = await client.execute({
    sql: `SELECT p.id FROM projects p WHERE p.id=?${
      global
        ? ""
        : ` AND EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id=p.id AND pm.user_id=?
        )`
    } LIMIT 1`,
    args: global ? [projectId] : [projectId, user.id],
  });
  if (!result.rows.length) {
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
}

function quotationNumber(count: number) {
  const date = new Date();
  return `QUO/PN/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}/${String(count).padStart(3, "0")}`;
}

export async function syncProjectCommercialValue(client: DatabaseClient, projectId: string) {
  await client.execute({
    sql: `UPDATE quotations SET total=COALESCE((
      SELECT SUM(i.quantity*i.selling_price)
      FROM boq_items i WHERE i.scope_id=quotations.scope_id
    ),0),updated_at=? WHERE project_id=?`,
    args: [now(), projectId],
  });
  const totals = await client.execute({
    sql: `SELECT
      COALESCE(SUM(CASE WHEN q.status='Accepted'
        THEN CASE WHEN q.grand_total>0 THEN q.grand_total ELSE q.total END
        ELSE 0 END),0) AS accepted_total,
      COALESCE((SELECT SUM(i.quantity*i.selling_price)
        FROM boq_items i JOIN boqs b ON b.id=i.boq_id
        WHERE b.project_id=?),0) AS boq_total
      FROM quotations q WHERE q.project_id=?`,
    args: [projectId, projectId],
  });
  const accepted = numberValue(totals.rows[0]?.accepted_total);
  const total = accepted > 0 ? accepted : numberValue(totals.rows[0]?.boq_total);
  await client.execute({
    sql: "UPDATE projects SET value=?,updated_at=? WHERE id=?",
    args: [total, now(), projectId],
  });
  return total;
}

async function scopeDetail(client: DatabaseClient, scopeId: string) {
  const scopeResult = await client.execute({
    sql: `SELECT s.*,b.project_id,q.id AS quotation_id,q.number AS quotation_number,
      q.status AS quotation_status,q.issued_at,q.valid_until,q.total,q.grand_total,
      q.tax_enabled,q.tax_revision,
      q.accepted_at AS quotation_accepted_at,
      q.acceptance_attachment_name AS quotation_attachment_name
      FROM boq_scopes s
      JOIN boqs b ON b.id=s.boq_id
      LEFT JOIN quotations q ON q.id=(
        SELECT id FROM quotations WHERE scope_id=s.id AND status<>'Superseded'
        ORDER BY revision_no DESC,created_at DESC LIMIT 1
      )
      WHERE s.id=? LIMIT 1`,
    args: [scopeId],
  });
  const scope = scopeResult.rows[0];
  if (!scope) {
    throw new ApiError(404, "NOT_FOUND", "Scope BoQ tidak ditemukan.");
  }
  const items = await client.execute({
    sql: "SELECT * FROM boq_items WHERE scope_id=? ORDER BY sort_order,created_at",
    args: [scopeId],
  });
  return {
    id: String(scope.id),
    boqId: String(scope.boq_id),
    projectId: String(scope.project_id),
    kind: String(scope.kind),
    sequence: numberValue(scope.sequence),
    title: String(scope.title),
    status: String(scope.status),
    acceptedAt: scope.accepted_at ? String(scope.accepted_at) : null,
    quotation: scope.quotation_id
      ? {
          id: String(scope.quotation_id),
          number: String(scope.quotation_number),
          status: String(scope.quotation_status),
          issuedAt: String(scope.issued_at),
          validUntil: scope.valid_until ? String(scope.valid_until) : null,
          total: numberValue(scope.total),
          grandTotal: numberValue(scope.grand_total) > 0
            ? numberValue(scope.grand_total)
            : numberValue(scope.total),
          taxEnabled: Number(scope.tax_enabled) === 1,
          taxRevision: numberValue(scope.tax_revision),
          acceptedAt: scope.quotation_accepted_at
            ? String(scope.quotation_accepted_at)
            : null,
          attachmentName: scope.quotation_attachment_name
            ? String(scope.quotation_attachment_name)
            : null,
        }
      : null,
    items: items.rows.map((item) => ({
      id: String(item.id),
      category: String(item.category),
      description: String(item.description),
      quantity: numberValue(item.quantity),
      unit: String(item.unit),
      costPrice: numberValue(item.cost_price),
      sellingPrice: numberValue(item.selling_price),
      catalogItemId: item.catalog_item_id ? String(item.catalog_item_id) : null,
      catalogPriceTier: item.catalog_price_tier
        ? numberValue(item.catalog_price_tier)
        : null,
      catalogRevision: item.catalog_revision
        ? numberValue(item.catalog_revision)
        : null,
      manualPriceOverride: Number(item.manual_price_override) === 1,
      priceOverrideReason: item.price_override_reason
        ? String(item.price_override_reason)
        : null,
    })),
  };
}

export async function handleBoqScopes(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const { client } = await getDatabase();
  const scopeId = path[2];
  const projectId = new URL(request.url).searchParams.get("projectId");

  if (request.method === "GET" && !scopeId) {
    if (!projectId) {
      throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    }
    await assertProjectAccess(client, user, projectId);
    const result = await client.execute({
      sql: `SELECT s.id FROM boq_scopes s
        JOIN boqs b ON b.id=s.boq_id
        WHERE b.project_id=? ORDER BY s.sequence,s.created_at`,
      args: [projectId],
    });
    return ok(
      await Promise.all(result.rows.map((row) => scopeDetail(client, String(row.id)))),
    );
  }

  if (request.method === "POST" && !scopeId) {
    assertManage(user, "boq");
    assertManage(user, "billing");
    if (!projectId) {
      throw new ApiError(400, "PROJECT_REQUIRED", "Pilih proyek terlebih dahulu.");
    }
    await assertProjectAccess(client, user, projectId);
    const input = scopeSchema.parse(await jsonBody(request));
    const resolvedItems = await resolveScopeItems(client, user, input.items);
    assertValidityManager(user, input);
    if (input.issuedAt && input.validUntil && input.validUntil < input.issuedAt) {
      throw new ApiError(422, "INVALID_DATE_RANGE", "Masa berlaku tidak boleh lebih awal dari tanggal terbit.");
    }
    const boq = await client.execute({
      sql: "SELECT id FROM boqs WHERE project_id=? LIMIT 1",
      args: [projectId],
    });
    if (!boq.rows[0]) {
      throw new ApiError(
        409,
        "BOQ_REQUIRED",
        "Buat BoQ Original terlebih dahulu sebelum menambahkan pekerjaan tambah.",
      );
    }
    const sequenceResult = await client.execute({
      sql: "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM boq_scopes WHERE boq_id=?",
      args: [boq.rows[0].id],
    });
    const sequence = await claimSequence(client, "quotations", "SELECT number AS value FROM quotations");
    const scopeIdValue = randomUUID();
    const quotationId = randomUUID();
    const timestamp = now();
    const issuedAt = input.issuedAt ?? timestamp.slice(0, 10);
    const validUntil =
      input.validUntil ??
      new Date(new Date(`${issuedAt}T00:00:00.000Z`).getTime() + 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const total = resolvedItems.reduce(
      (sum, item) => sum + item.quantity * item.sellingPrice,
      0,
    );
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO boq_scopes
          (id,boq_id,kind,sequence,title,status,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          scopeIdValue,
          boq.rows[0].id,
          "Addendum",
          sequenceResult.rows[0]?.sequence ?? 1,
          input.title,
          "Draft",
          user.id,
          timestamp,
          timestamp,
        ],
      });
      await tx.batch(
        resolvedItems.map((item, index) => ({
          sql: `INSERT INTO boq_items
            (id,boq_id,scope_id,category,description,quantity,unit,cost_price,
             selling_price,catalog_item_id,catalog_price_tier,catalog_revision,
             manual_price_override,price_override_reason,sort_order,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            item.id ?? randomUUID(),
            boq.rows[0].id,
            scopeIdValue,
            item.category,
            item.description,
            item.quantity,
            item.unit,
            item.costPrice,
            item.sellingPrice,
            item.catalogItemId,
            item.catalogPriceTier,
            item.catalogRevision,
            item.manualPriceOverride ? 1 : 0,
            item.priceOverrideReason,
            index,
            timestamp,
            timestamp,
          ],
        })),
        "write",
      );
      await tx.execute({
        sql: `INSERT INTO quotations
          (id,project_id,scope_id,number,status,issued_at,valid_until,total,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [
          quotationId,
          projectId,
          scopeIdValue,
          quotationNumber(sequence),
          "Draft",
          issuedAt,
          validUntil,
          total,
          timestamp,
          timestamp,
        ],
      });
    });
    await syncProjectCommercialValue(client, projectId);
    await writeAuditLog(client, request, user, "create", "boq_addendum", scopeIdValue, {
      title: input.title,
      quotationId,
      itemCount: resolvedItems.length,
      total,
    });
    return created(await scopeDetail(client, scopeIdValue));
  }

  if (!scopeId) {
    throw new ApiError(404, "NOT_FOUND", "Scope BoQ tidak ditemukan.");
  }
  const current = await scopeDetail(client, scopeId);
  await assertProjectAccess(client, user, current.projectId);

  if (request.method === "GET") {
    return ok(current);
  }

  if (request.method === "PATCH") {
    assertManage(user, "boq");
    const input = scopeSchema
      .pick({ title: true, issuedAt: true, validUntil: true, items: true })
      .partial()
      .parse(await jsonBody(request));
    const resolvedItems = input.items
      ? await resolveScopeItems(client, user, input.items)
      : undefined;
    assertValidityManager(user, input);
    if (current.status === "Accepted" || current.quotation?.status === "Accepted") {
      throw new ApiError(
        409,
        "ACCEPTED_SCOPE_LOCKED",
        "Item yang sudah diterima klien tidak dapat diedit. Buat Addendum baru.",
      );
    }
    const issuedAt = input.issuedAt ?? current.quotation?.issuedAt;
    const validUntil =
      input.validUntil === undefined
        ? current.quotation?.validUntil
        : input.validUntil;
    if (issuedAt && validUntil && validUntil < issuedAt) {
      throw new ApiError(422, "INVALID_DATE_RANGE", "Masa berlaku tidak boleh lebih awal dari tanggal terbit.");
    }
    const timestamp = now();
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: "UPDATE boq_scopes SET title=?,status='Draft',updated_at=? WHERE id=?",
        args: [input.title ?? current.title, timestamp, scopeId],
      });
      if (resolvedItems) {
        await tx.execute({ sql: "DELETE FROM boq_items WHERE scope_id=?", args: [scopeId] });
        await tx.batch(
          resolvedItems.map((item, index) => ({
            sql: `INSERT INTO boq_items
              (id,boq_id,scope_id,category,description,quantity,unit,cost_price,
               selling_price,catalog_item_id,catalog_price_tier,catalog_revision,
               manual_price_override,price_override_reason,sort_order,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [
              item.id ?? randomUUID(),
              current.boqId,
              scopeId,
              item.category,
              item.description,
              item.quantity,
              item.unit,
              item.costPrice,
              item.sellingPrice,
              item.catalogItemId,
              item.catalogPriceTier,
              item.catalogRevision,
              item.manualPriceOverride ? 1 : 0,
              item.priceOverrideReason,
              index,
              timestamp,
              timestamp,
            ],
          })),
          "write",
        );
      }
      if (current.quotation) {
        await tx.execute({
          sql: `UPDATE quotations SET issued_at=?,valid_until=?,status='Draft',
            accepted_at=NULL,acceptance_attachment_name=NULL,
            acceptance_attachment_mime_type=NULL,
            acceptance_attachment_content_base64=NULL,updated_at=? WHERE id=?`,
          args: [
            issuedAt,
            validUntil,
            timestamp,
            current.quotation.id,
          ],
        });
      }
    });
    await syncProjectCommercialValue(client, current.projectId);
    await writeAuditLog(client, request, user, "update", "boq_scope", scopeId, {
      ...input,
      itemCount: resolvedItems?.length,
    });
    return ok(await scopeDetail(client, scopeId));
  }

  if (request.method === "DELETE") {
    assertManage(user, "boq");
    if (current.kind === "Original") {
      throw new ApiError(409, "ORIGINAL_REQUIRED", "BoQ Original tidak dapat dihapus.");
    }
    if (current.status === "Accepted" || current.quotation?.status === "Accepted") {
      throw new ApiError(409, "ACCEPTED_SCOPE_LOCKED", "Addendum yang diterima klien tidak dapat dihapus.");
    }
    const usage = await client.execute({
      sql: "SELECT id FROM spks WHERE quotation_id=? LIMIT 1",
      args: [current.quotation?.id ?? ""],
    });
    if (usage.rows.length) {
      throw new ApiError(409, "SCOPE_IN_USE", "Addendum sudah digunakan dokumen procurement.");
    }
    await client.execute({ sql: "DELETE FROM boq_scopes WHERE id=?", args: [scopeId] });
    await syncProjectCommercialValue(client, current.projectId);
    await writeAuditLog(client, request, user, "delete", "boq_addendum", scopeId);
    return noContent();
  }

  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}

export async function handleQuotationLifecycle(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const quotationId = path[1];
  const action = path[2];
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT q.*,s.id AS boq_scope_id,s.status AS scope_status
      FROM quotations q
      LEFT JOIN boq_scopes s ON s.id=q.scope_id
      WHERE q.id=? LIMIT 1`,
    args: [quotationId],
  });
  const quotation = result.rows[0];
  if (!quotation) {
    throw new ApiError(404, "NOT_FOUND", "Quotation tidak ditemukan.");
  }
  await assertProjectAccess(client, user, String(quotation.project_id));

  if (request.method === "GET" && action === "pdf") {
    return renderBusinessPdf("quotation", quotationId, user.preferredLanguage);
  }
  assertManage(user, "billing");

  if (request.method === "POST" && action === "accept") {
    const input = z
      .object({
        acceptedAt: isoDateSchema,
        attachment: attachmentSchema,
      })
      .parse(await jsonBody(request));
    if (quotation.valid_until && String(quotation.valid_until) < todayInMakassar()) {
      throw new ApiError(
        409,
        "QUOTATION_EXPIRED",
        "Quotation sudah kedaluwarsa. Admin atau Finance harus memperpanjang masa berlaku sebelum dapat diterima.",
      );
    }
    if (Number(quotation.tax_enabled) === 1) {
      const tax = await client.execute({
        sql: "SELECT id FROM document_taxes WHERE document_type='Quotation' AND document_id=? LIMIT 1",
        args: [quotationId],
      });
      if (!tax.rows.length) {
        throw new ApiError(409, "TAX_RULE_REQUIRED", "Pilih minimal satu aturan pajak sebelum menerima Quotation.");
      }
    }
    const timestamp = now();
    await snapshotQuotationItems(client, quotationId);
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: "UPDATE quotations SET updated_at=updated_at WHERE id=?",
        args: [quotationId],
      });
      const locked = await tx.execute({
        sql: "SELECT status,tax_enabled FROM quotations WHERE id=? LIMIT 1",
        args: [quotationId],
      });
      if (String(locked.rows[0]?.status) !== "Sent") {
        throw new ApiError(
          409,
          "INVALID_QUOTATION_STATUS",
          "Hanya Quotation berstatus Sent yang dapat diterima klien.",
        );
      }
      await tx.batch([
        {
          sql: `UPDATE quotations SET status='Accepted',accepted_at=?,
            acceptance_attachment_name=?,acceptance_attachment_mime_type=?,
            acceptance_attachment_content_base64=?,updated_at=? WHERE id=?`,
          args: [
            input.acceptedAt,
            input.attachment.name,
            input.attachment.mimeType,
            input.attachment.contentBase64,
            timestamp,
            quotationId,
          ],
        },
        {
          sql: `UPDATE boq_scopes SET status='Accepted',accepted_at=?,
            acceptance_attachment_name=?,acceptance_attachment_mime_type=?,
            acceptance_attachment_content_base64=?,updated_at=? WHERE id=?`,
          args: [
            input.acceptedAt,
            input.attachment.name,
            input.attachment.mimeType,
            input.attachment.contentBase64,
            timestamp,
            quotation.boq_scope_id,
          ],
        },
      ], "write");
    });
    await lockDocumentTaxes(
      client,
      "Quotation",
      quotationId,
      input.acceptedAt,
    );
    await syncProjectCommercialValue(client, String(quotation.project_id));
    await writeAuditLog(client, request, user, "accept", "quotation", quotationId, {
      acceptedAt: input.acceptedAt,
      attachment: {
        name: input.attachment.name,
        mimeType: input.attachment.mimeType,
      },
    });
    return ok(await scopeDetail(client, String(quotation.boq_scope_id)));
  }

  if (request.method === "POST" && ["send", "reject", "void"].includes(action ?? "")) {
    const nextStatus =
      action === "send" ? "Sent" : action === "reject" ? "Rejected" : "Void";
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: "UPDATE quotations SET updated_at=updated_at WHERE id=?",
        args: [quotationId],
      });
      const locked = await tx.execute({
        sql: "SELECT status,tax_enabled FROM quotations WHERE id=? LIMIT 1",
        args: [quotationId],
      });
      const currentStatus = String(locked.rows[0]?.status);
      if (nextStatus === "Sent" && Number(locked.rows[0]?.tax_enabled) === 1) {
        const tax = await tx.execute({
          sql: "SELECT id FROM document_taxes WHERE document_type='Quotation' AND document_id=? LIMIT 1",
          args: [quotationId],
        });
        if (!tax.rows.length) {
          throw new ApiError(409, "TAX_RULE_REQUIRED", "Pilih minimal satu aturan pajak sebelum mengirim Quotation.");
        }
      }
      if (
        (nextStatus === "Sent" && currentStatus !== "Draft") ||
        (nextStatus === "Rejected" && currentStatus !== "Sent") ||
        (nextStatus === "Void" && currentStatus === "Void")
      ) {
        throw new ApiError(
          409,
          "INVALID_QUOTATION_STATUS",
          "Perubahan status Quotation tidak sesuai urutan workflow.",
        );
      }
      if (currentStatus === "Accepted" && nextStatus !== "Void") {
        throw new ApiError(409, "ACCEPTED_QUOTATION_LOCKED", "Quotation yang diterima sudah dikunci.");
      }
      if (nextStatus === "Void") {
        const usage = await tx.execute({
          sql: "SELECT id FROM spks WHERE quotation_id=? AND workflow_status<>'Void' LIMIT 1",
          args: [quotationId],
        });
        if (usage.rows.length) {
          throw new ApiError(409, "QUOTATION_IN_USE", "Void dokumen procurement aktif terlebih dahulu.");
        }
      }
      await tx.batch([
        {
          sql: "UPDATE quotations SET status=?,updated_at=? WHERE id=?",
          args: [nextStatus, now(), quotationId],
        },
        {
          sql: "UPDATE boq_scopes SET status=?,updated_at=? WHERE id=?",
          args: [nextStatus, now(), quotation.boq_scope_id],
        },
      ], "write");
    });
    if (nextStatus === "Sent") await snapshotQuotationItems(client, quotationId);
    await syncProjectCommercialValue(client, String(quotation.project_id));
    await writeAuditLog(client, request, user, action ?? "update", "quotation", quotationId, {
      status: nextStatus,
    });
    return ok(await scopeDetail(client, String(quotation.boq_scope_id)));
  }

  throw new ApiError(404, "NOT_FOUND", "Aksi Quotation tidak ditemukan.");
}
