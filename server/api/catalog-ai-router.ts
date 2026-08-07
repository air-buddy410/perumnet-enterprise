import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { callGemini, defaultGeminiModel } from "./catalog-ai-gemini";
import type { Recommendation } from "./catalog-ai-schema";
import { ApiError, created, jsonBody, ok, refuseOnReference } from "./errors";

const idSchema = z.string().trim().min(1).max(100);
const analyzeSchema = z.object({
  query: z.string().trim().min(2).max(500),
  sourceUrl: z.string().url().max(2_000).optional(),
  file: z.object({
    name: z.string().trim().min(1).max(180),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
    contentBase64: z.string().min(4).max(13_500_000),
  }).optional(),
});
const approveSchema = z.object({
  categoryId: idSchema,
  brandId: idSchema.optional().nullable(),
  sku: z.string().trim().min(2).max(80).optional(),
  name: z.string().trim().min(2).max(180).optional(),
  nameEn: z.string().trim().max(180).optional(),
  model: z.string().trim().max(120).optional(),
  specifications: z.string().trim().max(2_000).optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  costPrice: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  margin1Percent: z.number().min(0).max(1_000).optional(),
  margin2Percent: z.number().min(0).max(1_000).optional(),
  overrideReason: z.string().trim().min(5).max(500).optional(),
});
const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) });

function assertGeminiConfigured() {
  if (!process.env.GEMINI_API_KEY) {
    throw new ApiError(503, "GEMINI_NOT_CONFIGURED", "GEMINI_API_KEY belum tersedia pada secret server.");
  }
}

function pendingModelName() {
  return process.env.GEMINI_CATALOG_MODEL ?? defaultGeminiModel;
}

function manage(user: AuthUser) {
  if (!(["Admin", "Finance"] as string[]).includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin dan Finance yang dapat menggunakan AI Catalog Assistant.");
  }
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function mapRun(row: Record<string, unknown>, sources: Array<Record<string, unknown>> = []) {
  const recommendation = row.recommendation_json
    ? JSON.parse(String(row.recommendation_json)) as Recommendation
    : null;
  const cost = numberValue(recommendation?.recommendedCostPrice);
  const margin1 = Number(recommendation?.margin1Percent ?? 0);
  const margin2 = Number(recommendation?.margin2Percent ?? 0);
  return {
    id: String(row.id),
    status: String(row.status),
    query: String(row.query),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    model: String(row.model),
    confidence: numberValue(row.confidence),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    recommendation: recommendation
      ? {
          ...recommendation,
          price1: Math.round(cost * (1 + margin1 / 100)),
          price2: Math.round(cost * (1 + margin2 / 100)),
        }
      : null,
    sources: sources.map((source) => ({
      title: String(source.title),
      url: String(source.url),
      accessedAt: String(source.accessed_at),
    })),
    catalogItemId: row.catalog_item_id ? String(row.catalog_item_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function readRun(client: DatabaseClient, runId: string) {
  const result = await client.execute({ sql: "SELECT * FROM catalog_ai_runs WHERE id=? LIMIT 1", args: [runId] });
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Analisis AI tidak ditemukan.");
  const sources = await client.execute({ sql: "SELECT * FROM catalog_ai_sources WHERE run_id=? ORDER BY created_at", args: [runId] });
  return mapRun(result.rows[0], sources.rows);
}

export async function sweepStaleCatalogAiRuns(client: DatabaseClient) {
  const staleMs = Number(process.env.CATALOG_AI_STALE_MS ?? 600_000);
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const result = await client.execute({
    sql: `UPDATE catalog_ai_runs
      SET status='Failed',
        error_message='Analisis melewati batas waktu dan dihentikan otomatis.',
        updated_at=?
      WHERE status='Running' AND updated_at<? RETURNING id`,
    args: [new Date().toISOString(), cutoff],
  });
  return result.rows.length;
}

async function executeAnalysis(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  runId: string,
  input: z.infer<typeof analyzeSchema>,
) {
  try {
    const benchmarks = await client.execute(`SELECT c.boq_role,c.name AS category,
      COUNT(i.id) AS samples,ROUND(AVG(i.cost_price)) AS avg_cost,
      ROUND(AVG(i.margin_1_bps))/100.0 AS avg_margin_1,
      ROUND(AVG(i.margin_2_bps))/100.0 AS avg_margin_2
      FROM item_catalog_categories c LEFT JOIN item_catalog_items i ON i.category_id=c.id
      GROUP BY c.id,c.boq_role,c.name ORDER BY c.sort_order LIMIT 60`);
    const result = await callGemini(input, benchmarks.rows);
    const timestamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: `UPDATE catalog_ai_runs SET status='Draft',recommendation_json=?,model=?,
          confidence=?,expires_at=?,updated_at=? WHERE id=?`,
        args: [JSON.stringify(result.recommendation), result.model,
          result.recommendation.confidence, expiresAt, timestamp, runId],
      });
      for (const source of result.sources) {
        await tx.execute({
          sql: `INSERT INTO catalog_ai_sources
            (id,run_id,title,url,accessed_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?)`,
          args: [`catalog-ai-source-${randomUUID()}`, runId, source.title, source.url,
            timestamp, timestamp, timestamp],
        });
      }
    });
    await writeAuditLog(client, request, user, "analyze", "catalog_ai_run", runId, {
      query: input.query,
      sourceUrl: input.sourceUrl ?? null,
      sourceCount: result.sources.length,
    });
  } catch (error) {
    await client.execute({
      sql: "UPDATE catalog_ai_runs SET status='Failed',error_message=?,updated_at=? WHERE id=?",
      args: [
        error instanceof Error ? error.message.slice(0, 1_000) : "Analisis gagal",
        new Date().toISOString(),
        runId,
      ],
    });
  }
}

export async function handleCatalogAi(request: Request, path: string[], user: AuthUser) {
  manage(user);
  const { client } = await getDatabase();
  await sweepStaleCatalogAiRuns(client);
  const action = path[2];
  const runId = path[3];
  const subAction = path[4];

  if (request.method === "GET" && !action) {
    const mine = new URL(request.url).searchParams.get("mine") === "1";
    const result = await client.execute(
      mine
        ? {
            sql: "SELECT * FROM catalog_ai_runs WHERE requested_by=? ORDER BY created_at DESC LIMIT 20",
            args: [user.id],
          }
        : { sql: "SELECT * FROM catalog_ai_runs ORDER BY created_at DESC LIMIT 50", args: [] },
    );
    return ok(await Promise.all(result.rows.map((row) => readRun(client, String(row.id)))));
  }

  if (request.method === "GET" && action === "runs" && runId && !subAction) {
    return ok(await readRun(client, runId));
  }

  if (request.method === "POST" && action === "analyze" && !runId) {
    const input = analyzeSchema.parse(await jsonBody(request));
    assertGeminiConfigured();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const usage = await client.execute({
      sql: `SELECT
        SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS daily,
        SUM(CASE WHEN status='Running' THEN 1 ELSE 0 END) AS running
        FROM catalog_ai_runs WHERE requested_by=?`,
      args: [since, user.id],
    });
    if (numberValue(usage.rows[0]?.daily) >= 20) {
      throw new ApiError(429, "AI_DAILY_LIMIT", "Batas 20 analisis AI per pengguna per hari telah tercapai.");
    }
    if (numberValue(usage.rows[0]?.running) >= 2) {
      throw new ApiError(429, "AI_CONCURRENCY_LIMIT", "Maksimal dua analisis AI dapat berjalan bersamaan.");
    }
    const newRunId = `catalog-ai-${randomUUID()}`;
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO catalog_ai_runs
        (id,requested_by,status,query,source_url,input_mime_type,model,confidence,
         created_at,updated_at) VALUES (?,?, 'Running',?,?,?,?,0,?,?)`,
      args: [newRunId, user.id, input.query, input.sourceUrl ?? null, input.file?.mimeType ?? null,
        pendingModelName(), timestamp, timestamp],
    });
    void executeAnalysis(client, request, user, newRunId, input).catch(console.error);
    return ok(await readRun(client, newRunId), 202);
  }

  if (request.method === "POST" && action === "runs" && runId && subAction === "approve") {
    const input = approveSchema.parse(await jsonBody(request));
    const runResult = await client.execute({ sql: "SELECT * FROM catalog_ai_runs WHERE id=? LIMIT 1", args: [runId] });
    const run = runResult.rows[0];
    if (!run) throw new ApiError(404, "NOT_FOUND", "Analisis AI tidak ditemukan.");
    if (String(run.status) !== "Draft") throw new ApiError(409, "AI_RUN_NOT_DRAFT", "Hanya rekomendasi Draft yang dapat disetujui.");
    if (run.expires_at && String(run.expires_at) < new Date().toISOString() && !input.overrideReason) {
      throw new ApiError(409, "AI_RECOMMENDATION_EXPIRED", "Rekomendasi lebih dari tujuh hari. Refresh analisis atau isi alasan override.");
    }
    const recommendation = JSON.parse(String(run.recommendation_json)) as Recommendation;
    const category = await client.execute({ sql: "SELECT * FROM item_catalog_categories WHERE id=? AND status='Aktif' LIMIT 1", args: [input.categoryId] });
    if (!category.rows[0]) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Kategori aktif tidak ditemukan.");
    if (["Perangkat", "Material"].includes(String(category.rows[0].boq_role)) && !input.brandId) {
      throw new ApiError(422, "BRAND_REQUIRED", "Pilih merek untuk Perangkat atau Material.");
    }
    if (input.brandId) {
      const brand = await client.execute({ sql: "SELECT id FROM item_catalog_brands WHERE id=? AND category_id=? AND status='Aktif'", args: [input.brandId, input.categoryId] });
      if (!brand.rows[0]) throw new ApiError(422, "BRAND_CATEGORY_MISMATCH", "Merek tidak termasuk dalam kategori aktif.");
    }
    const itemId = randomUUID();
    const timestamp = new Date().toISOString();
    const sku = input.sku ?? recommendation.sku;
    const duplicate = await client.execute({ sql: "SELECT id FROM item_catalog_items WHERE sku=? LIMIT 1", args: [sku] });
    if (duplicate.rows.length) throw new ApiError(409, "SKU_EXISTS", "SKU sudah digunakan item lain.");
    // The category and brand above were read before this transaction opened, so
    // either can be deleted in the meantime. Refuse cleanly instead of letting
    // the foreign-key error escape as a raw 500.
    await refuseOnReference(client.transaction(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO item_catalog_items
          (id,category_id,brand_id,sku,name,name_en,model,specifications,unit,
           cost_price,margin_1_bps,margin_2_bps,status,revision,created_by,
           created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'Aktif',1,?,?,?)`,
        args: [itemId, input.categoryId, input.brandId ?? null, sku,
          input.name ?? recommendation.nameId, input.nameEn ?? recommendation.nameEn,
          input.model ?? recommendation.model,
          input.specifications ?? recommendation.specifications.join("\n"),
          input.unit ?? recommendation.unit,
          input.costPrice ?? recommendation.recommendedCostPrice,
          Math.round((input.margin1Percent ?? recommendation.margin1Percent) * 100),
          Math.round((input.margin2Percent ?? recommendation.margin2Percent) * 100),
          user.id, timestamp, timestamp],
      });
      await tx.execute({
        sql: `UPDATE catalog_ai_runs SET status='Approved',approved_by=?,approved_at=?,
          override_reason=?,catalog_item_id=?,updated_at=? WHERE id=?`,
        args: [user.id, timestamp, input.overrideReason ?? null, itemId, timestamp, runId],
      });
    }), () => new ApiError(404, "CATEGORY_NOT_FOUND", "Kategori atau merek katalog tidak ditemukan lagi. Muat ulang katalog lalu setujui kembali."));
    await writeAuditLog(client, request, user, "approve", "catalog_ai_run", runId, {
      catalogItemId: itemId,
      categoryId: input.categoryId,
      brandId: input.brandId ?? null,
      overrideReason: input.overrideReason ?? null,
    });
    return created({ ...(await readRun(client, runId)), catalogItemId: itemId });
  }

  if (request.method === "POST" && action === "runs" && runId && subAction === "reject") {
    const input = rejectSchema.parse(await jsonBody(request));
    const current = await readRun(client, runId);
    if (current.status !== "Draft") {
      throw new ApiError(409, "AI_RUN_NOT_DRAFT", "Rekomendasi tidak lagi berstatus Draft.");
    }
    await client.execute({
      sql: `UPDATE catalog_ai_runs SET status='Rejected',rejected_by=?,rejected_at=?,
        error_message=?,updated_at=? WHERE id=? AND status='Draft'`,
      args: [user.id, new Date().toISOString(), input.reason, new Date().toISOString(), runId],
    });
    await writeAuditLog(client, request, user, "reject", "catalog_ai_run", runId, input);
    return ok(await readRun(client, runId));
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint AI Catalog tidak ditemukan.");
}
