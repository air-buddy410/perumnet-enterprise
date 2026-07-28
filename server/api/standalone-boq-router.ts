import "server-only";

import { randomUUID } from "node:crypto";
import { canAccess } from "@/shared/access";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { asNumber } from "../format";
import {
  ApiError,
  created,
  jsonBody,
  noContent,
  ok,
} from "./errors";

const idSchema = z.string().trim().min(1).max(100);
const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const itemSchema = z.object({
  category: z.enum(["Perangkat", "Material", "Jasa", "Mobilitas"]),
  description: z.string().trim().min(2).max(240),
  quantity: z.number().int().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  costPrice: moneySchema,
  sellingPrice: moneySchema,
});

const standaloneBoqSchema = z.object({
  title: z.string().trim().min(3).max(160),
  client: z.string().trim().max(160).optional().default(""),
  status: z.enum(["Draft", "Final"]).default("Draft"),
  notes: z.string().trim().max(2_000).optional().default(""),
  items: z.array(itemSchema).max(500).default([]),
});

const attachSchema = z.object({
  projectId: idSchema,
  replace: z.boolean().default(false),
});

function assertStandaloneBoqAccess(user: AuthUser) {
  if (!["Admin", "Finance"].includes(user.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "BoQ tanpa proyek hanya dapat dikelola oleh Admin dan Finance.",
    );
  }
  if (!canAccess(user.permissions, "boq", "manage")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Akun Anda tidak memiliki izin untuk mengelola BoQ.",
    );
  }
}

function mapItem(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    category: String(row.category),
    description: String(row.description),
    quantity: asNumber(row.quantity),
    unit: String(row.unit),
    costPrice: asNumber(row.cost_price),
    sellingPrice: asNumber(row.selling_price),
  };
}

async function getStandaloneBoq(client: DatabaseClient, id: string) {
  const result = await client.execute({
    sql: `
      SELECT b.*,
        (SELECT COUNT(*) FROM standalone_boq_items i WHERE i.standalone_boq_id=b.id) AS item_count,
        (SELECT COALESCE(SUM(i.quantity*i.selling_price),0) FROM standalone_boq_items i WHERE i.standalone_boq_id=b.id) AS total
      FROM standalone_boqs b
      WHERE b.id=?
      LIMIT 1
    `,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "NOT_FOUND", "BoQ mandiri tidak ditemukan.");
  }
  const items = await client.execute({
    sql: `
      SELECT *
      FROM standalone_boq_items
      WHERE standalone_boq_id=?
      ORDER BY sort_order,created_at
    `,
    args: [id],
  });
  return {
    id: String(row.id),
    title: String(row.title),
    client: row.client ? String(row.client) : "",
    status: String(row.status),
    notes: row.notes ? String(row.notes) : "",
    itemCount: asNumber(row.item_count),
    total: asNumber(row.total),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items: items.rows.map((item) =>
      mapItem(item as Record<string, unknown>),
    ),
  };
}

async function replaceItems(
  client: DatabaseClient,
  boqId: string,
  items: z.infer<typeof itemSchema>[],
  timestamp: string,
) {
  await client.batch(
    [
      {
        sql: "DELETE FROM standalone_boq_items WHERE standalone_boq_id=?",
        args: [boqId],
      },
      ...items.map((item, index) => ({
        sql: `
          INSERT INTO standalone_boq_items
            (id,standalone_boq_id,category,description,quantity,unit,cost_price,selling_price,sort_order,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `,
        args: [
          randomUUID(),
          boqId,
          item.category,
          item.description,
          item.quantity,
          item.unit,
          item.costPrice,
          item.sellingPrice,
          index,
          timestamp,
          timestamp,
        ],
      })),
    ],
    "write",
  );
}

export async function handleStandaloneBoqs(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  assertStandaloneBoqAccess(user);
  const { client } = await getDatabase();
  const boqId = path[2];
  const action = path[3];

  if (request.method === "GET" && !boqId) {
    const result = await client.execute(`
      SELECT b.*,
        (SELECT COUNT(*) FROM standalone_boq_items i WHERE i.standalone_boq_id=b.id) AS item_count,
        (SELECT COALESCE(SUM(i.quantity*i.selling_price),0) FROM standalone_boq_items i WHERE i.standalone_boq_id=b.id) AS total
      FROM standalone_boqs b
      ORDER BY b.updated_at DESC
    `);
    return ok(
      result.rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        client: row.client ? String(row.client) : "",
        status: String(row.status),
        notes: row.notes ? String(row.notes) : "",
        itemCount: asNumber(row.item_count),
        total: asNumber(row.total),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })),
    );
  }

  if (request.method === "POST" && !boqId) {
    const input = standaloneBoqSchema.parse(await jsonBody(request));
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `
        INSERT INTO standalone_boqs
          (id,title,client,status,notes,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)
      `,
      args: [
        id,
        input.title,
        input.client || null,
        input.status,
        input.notes || null,
        user.id,
        timestamp,
        timestamp,
      ],
    });
    await replaceItems(client, id, input.items, timestamp);
    await writeAuditLog(client, request, user, "create", "standalone_boq", id, {
      title: input.title,
      itemCount: input.items.length,
    });
    return created(await getStandaloneBoq(client, id));
  }

  if (request.method === "GET" && boqId && !action) {
    return ok(await getStandaloneBoq(client, boqId));
  }

  if (request.method === "PUT" && boqId && !action) {
    const current = await getStandaloneBoq(client, boqId);
    const input = standaloneBoqSchema.parse(await jsonBody(request));
    const timestamp = new Date().toISOString();
    await client.execute({
      sql: `
        UPDATE standalone_boqs
        SET title=?,client=?,status=?,notes=?,updated_at=?
        WHERE id=?
      `,
      args: [
        input.title,
        input.client || null,
        input.status,
        input.notes || null,
        timestamp,
        boqId,
      ],
    });
    await replaceItems(client, boqId, input.items, timestamp);
    await writeAuditLog(client, request, user, "update", "standalone_boq", boqId, {
      beforeItemCount: current.itemCount,
      itemCount: input.items.length,
    });
    return ok(await getStandaloneBoq(client, boqId));
  }

  if (request.method === "POST" && boqId && action === "attach") {
    const input = attachSchema.parse(await jsonBody(request));
    const project = await client.execute({
      sql: "SELECT id FROM projects WHERE id=? LIMIT 1",
      args: [input.projectId],
    });
    if (!project.rows.length) {
      throw new ApiError(404, "NOT_FOUND", "Proyek tujuan tidak ditemukan.");
    }
    const source = await getStandaloneBoq(client, boqId);
    const existing = await client.execute({
      sql: "SELECT id FROM boqs WHERE project_id=? LIMIT 1",
      args: [input.projectId],
    });
    if (existing.rows.length && !input.replace) {
      throw new ApiError(
        409,
        "PROJECT_BOQ_EXISTS",
        "Proyek tujuan sudah memiliki BoQ. Aktifkan opsi ganti untuk melanjutkan.",
      );
    }
    const projectBoqId = existing.rows[0]
      ? String(existing.rows[0].id)
      : randomUUID();
    const timestamp = new Date().toISOString();
    await client.batch(
      [
        ...(existing.rows.length
          ? [
              {
                sql: "DELETE FROM boq_items WHERE boq_id=?",
                args: [projectBoqId],
              },
              {
                sql: "UPDATE boqs SET status=?,notes=?,updated_at=? WHERE id=?",
                args: [source.status, source.notes || null, timestamp, projectBoqId],
              },
            ]
          : [
              {
                sql: `
                  INSERT INTO boqs
                    (id,project_id,status,notes,created_at,updated_at)
                  VALUES (?,?,?,?,?,?)
                `,
                args: [
                  projectBoqId,
                  input.projectId,
                  source.status,
                  source.notes || null,
                  timestamp,
                  timestamp,
                ],
              },
            ]),
        ...source.items.map((item, index) => ({
          sql: `
            INSERT INTO boq_items
              (id,boq_id,category,description,quantity,unit,cost_price,selling_price,sort_order,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
          `,
          args: [
            randomUUID(),
            projectBoqId,
            item.category,
            item.description,
            item.quantity,
            item.unit,
            item.costPrice,
            item.sellingPrice,
            index,
            timestamp,
            timestamp,
          ],
        })),
        {
          sql: "UPDATE projects SET value=?,updated_at=? WHERE id=?",
          args: [source.total, timestamp, input.projectId],
        },
      ],
      "write",
    );
    await writeAuditLog(
      client,
      request,
      user,
      "attach",
      "standalone_boq",
      boqId,
      { projectId: input.projectId, replace: input.replace },
    );
    return ok({ projectId: input.projectId, boqId: projectBoqId });
  }

  if (request.method === "DELETE" && boqId && !action) {
    await getStandaloneBoq(client, boqId);
    await client.execute({
      sql: "DELETE FROM standalone_boqs WHERE id=?",
      args: [boqId],
    });
    await writeAuditLog(
      client,
      request,
      user,
      "delete",
      "standalone_boq",
      boqId,
    );
    return noContent();
  }

  throw new ApiError(404, "NOT_FOUND", "Endpoint BoQ mandiri tidak ditemukan.");
}
