import "server-only";

import { randomUUID } from "node:crypto";
import { canAccess } from "@/shared/access";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import type { DatabaseClient } from "../db/client";
import { getDatabase } from "../db/client";
import { ApiError, created, jsonBody, noContent, ok } from "./errors";

const packageSchema = z.object({
  title: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/).optional(),
  status: z.enum(["Draft", "Active", "Completed", "Void"]).default("Draft"),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

function now() {
  return new Date().toISOString();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function assertProjectAccess(
  client: DatabaseClient,
  user: AuthUser,
  projectId: string,
) {
  if (["Admin", "Finance"].includes(user.role)) return;
  const result = await client.execute({
    sql: "SELECT 1 FROM project_members WHERE project_id=? AND user_id=? LIMIT 1",
    args: [projectId, user.id],
  });
  if (!result.rows.length) {
    throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
  }
}

function assertPackageManage(user: AuthUser) {
  if (
    !canAccess(user.permissions, "boq", "manage") ||
    !canAccess(user.permissions, "billing", "manage")
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Akun tidak memiliki akses untuk mengelola paket komersial.",
    );
  }
}

export async function ensureDefaultCommercialPackage(
  client: DatabaseClient,
  projectId: string,
  userId?: string,
) {
  const existing = await client.execute({
    sql: `SELECT id FROM project_commercial_packages
      WHERE project_id=? ORDER BY sort_order,created_at LIMIT 1`,
    args: [projectId],
  });
  if (existing.rows[0]) return String(existing.rows[0].id);
  const id = `commercial-package-${randomUUID()}`;
  const timestamp = now();
  await client.execute({
    sql: `INSERT INTO project_commercial_packages
      (id,project_id,code,title,status,sort_order,created_by,created_at,updated_at)
      VALUES (?,?,?,'Lingkup Utama','Active',0,?,?,?)`,
    args: [id, projectId, "PKG-01", userId ?? null, timestamp, timestamp],
  });
  return id;
}

async function listPackages(client: DatabaseClient, projectId: string) {
  const result = await client.execute({
    sql: `SELECT cp.*,
      (SELECT COUNT(*) FROM boq_scopes s WHERE s.package_id=cp.id) AS scope_count,
      (SELECT COUNT(*) FROM boq_items bi JOIN boq_scopes s ON s.id=bi.scope_id
        WHERE s.package_id=cp.id) AS item_count,
      (SELECT COUNT(*) FROM invoices i WHERE i.package_id=cp.id) AS invoice_count,
      (SELECT COUNT(*) FROM project_validations v WHERE v.package_id=cp.id) AS validation_count,
      (SELECT COUNT(*) FROM basts b WHERE b.package_id=cp.id) AS bast_count,
      (SELECT q.id FROM quotations q WHERE q.package_id=cp.id
        AND q.status<>'Superseded' ORDER BY q.revision_no DESC,q.created_at DESC LIMIT 1) AS quotation_id,
      (SELECT q.number FROM quotations q WHERE q.package_id=cp.id
        AND q.status<>'Superseded' ORDER BY q.revision_no DESC,q.created_at DESC LIMIT 1) AS quotation_number,
      (SELECT q.status FROM quotations q WHERE q.package_id=cp.id
        AND q.status<>'Superseded' ORDER BY q.revision_no DESC,q.created_at DESC LIMIT 1) AS quotation_status,
      (SELECT q.grand_total FROM quotations q WHERE q.package_id=cp.id
        AND q.status<>'Superseded' ORDER BY q.revision_no DESC,q.created_at DESC LIMIT 1) AS grand_total
      FROM project_commercial_packages cp
      WHERE cp.project_id=? ORDER BY cp.sort_order,cp.created_at`,
    args: [projectId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    code: String(row.code),
    title: String(row.title),
    status: String(row.status),
    sortOrder: numberValue(row.sort_order),
    scopeCount: numberValue(row.scope_count),
    itemCount: numberValue(row.item_count),
    invoiceCount: numberValue(row.invoice_count),
    validationCount: numberValue(row.validation_count),
    bastCount: numberValue(row.bast_count),
    quotationId: row.quotation_id ? String(row.quotation_id) : null,
    quotationNumber: row.quotation_number ? String(row.quotation_number) : null,
    quotationStatus: row.quotation_status ? String(row.quotation_status) : null,
    grandTotal: numberValue(row.grand_total),
  }));
}

export async function handleCommercialPackages(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const { client } = await getDatabase();
  const projectId = path[1];
  const packageId = path[3];
  if (!projectId || path[2] !== "packages") {
    throw new ApiError(404, "NOT_FOUND", "Paket komersial tidak ditemukan.");
  }
  await assertProjectAccess(client, user, projectId);

  if (request.method === "GET" && !packageId) {
    await ensureDefaultCommercialPackage(client, projectId, user.id);
    return ok(await listPackages(client, projectId));
  }

  assertPackageManage(user);
  if (request.method === "POST" && !packageId) {
    const input = packageSchema.parse(await jsonBody(request));
    const project = await client.execute({
      sql: "SELECT id FROM projects WHERE id=? LIMIT 1",
      args: [projectId],
    });
    if (!project.rows.length) throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
    const existingCount = await client.execute({
      sql: "SELECT COUNT(*) AS count FROM project_commercial_packages WHERE project_id=?",
      args: [projectId],
    });
    const code = input.code ?? `PKG-${String(numberValue(existingCount.rows[0]?.count) + 1).padStart(2, "0")}`;
    const duplicate = await client.execute({
      sql: "SELECT id FROM project_commercial_packages WHERE project_id=? AND code=? LIMIT 1",
      args: [projectId, code],
    });
    if (duplicate.rows.length) {
      throw new ApiError(409, "PACKAGE_CODE_EXISTS", "Kode paket sudah digunakan pada proyek ini.");
    }
    const id = `commercial-package-${randomUUID()}`;
    const timestamp = now();
    await client.execute({
      sql: `INSERT INTO project_commercial_packages
        (id,project_id,code,title,status,sort_order,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [id, projectId, code, input.title, input.status, input.sortOrder, user.id, timestamp, timestamp],
    });
    await writeAuditLog(client, request, user, "create", "commercial_package", id, {
      projectId,
      code,
      title: input.title,
    });
    const packages = await listPackages(client, projectId);
    return created(packages.find((entry) => entry.id === id));
  }

  if (!packageId) throw new ApiError(404, "NOT_FOUND", "Paket komersial tidak ditemukan.");
  const current = await client.execute({
    sql: "SELECT * FROM project_commercial_packages WHERE id=? AND project_id=? LIMIT 1",
    args: [packageId, projectId],
  });
  if (!current.rows[0]) throw new ApiError(404, "NOT_FOUND", "Paket komersial tidak ditemukan.");

  if (request.method === "PATCH") {
    const input = packageSchema.partial().parse(await jsonBody(request));
    const merged = packageSchema.parse({
      title: input.title ?? current.rows[0].title,
      code: input.code ?? current.rows[0].code,
      status: input.status ?? current.rows[0].status,
      sortOrder: input.sortOrder ?? numberValue(current.rows[0].sort_order),
    });
    await client.execute({
      sql: `UPDATE project_commercial_packages
        SET code=?,title=?,status=?,sort_order=?,updated_at=? WHERE id=?`,
      args: [merged.code, merged.title, merged.status, merged.sortOrder, now(), packageId],
    });
    await writeAuditLog(client, request, user, "update", "commercial_package", packageId, input);
    const packages = await listPackages(client, projectId);
    return ok(packages.find((entry) => entry.id === packageId));
  }

  if (request.method === "DELETE") {
    const usage = await client.execute({
      sql: `SELECT
        (SELECT COUNT(*) FROM boq_items bi JOIN boq_scopes s ON s.id=bi.scope_id WHERE s.package_id=?) AS items,
        (SELECT COUNT(*) FROM quotations WHERE package_id=?) AS quotations,
        (SELECT COUNT(*) FROM invoices WHERE package_id=?) AS invoices,
        (SELECT COUNT(*) FROM project_validations WHERE package_id=?) AS validations,
        (SELECT COUNT(*) FROM basts WHERE package_id=?) AS basts`,
      args: [packageId, packageId, packageId, packageId, packageId],
    });
    const used = usage.rows[0];
    if (Object.values(used ?? {}).some((value) => numberValue(value) > 0)) {
      throw new ApiError(
        409,
        "PACKAGE_IN_USE",
        "Paket yang sudah memiliki dokumen tidak dapat dihapus. Ubah status menjadi Void.",
        used,
      );
    }
    await client.execute({ sql: "DELETE FROM project_commercial_packages WHERE id=?", args: [packageId] });
    await writeAuditLog(client, request, user, "delete", "commercial_package", packageId, { projectId });
    return noContent();
  }

  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
}
