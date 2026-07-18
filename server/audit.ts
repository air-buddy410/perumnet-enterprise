import "server-only";

import { randomUUID } from "node:crypto";
import type { AuthUser } from "./auth";
import type { DatabaseClient } from "./db/client";

export async function writeAuditLog(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  action: string,
  entity: string,
  entityId?: string,
  metadata?: unknown,
) {
  await client.execute({
    sql: "INSERT INTO audit_logs (id,user_id,action,entity,entity_id,metadata_json,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?)",
    args: [
      randomUUID(),
      user.id,
      action,
      entity,
      entityId ?? null,
      metadata === undefined ? null : JSON.stringify(metadata),
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      new Date().toISOString(),
    ],
  });
}
