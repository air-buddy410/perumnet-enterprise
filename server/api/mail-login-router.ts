import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import {
  deployMailLoginSnapshot,
  getMailLoginMedia,
  getMailLoginSnapshot,
  getMailLoginVersions,
  mailBrandingMode,
  parseMailLoginSnapshot,
  prepareMailFavicon,
  prepareMailLogo,
  publicMailLoginConfig,
  serializeMailLoginSnapshot,
  snapshotHash,
  storeMailBrandingFile,
  type MailLoginConfig,
  type MailLoginSnapshot,
} from "../mail-branding";
import { ApiError, ok } from "./errors";

const themeKey = z.enum(["enterprise", "perumnet"]);
const configInput = z.object({
  theme: themeKey,
  activeTheme: themeKey,
  revision: z.number().int().min(1),
  browserTitle: z.string().trim().min(3).max(80),
  eyebrow: z.string().trim().min(2).max(80),
  headline: z.string().trim().min(4).max(180),
  description: z.string().trim().min(8).max(500),
  cardTitle: z.string().trim().min(3).max(100),
}).strict();

let publishQueue: Promise<void> = Promise.resolve();

async function serialized<T>(job: () => Promise<T>): Promise<T> {
  const previous = publishQueue;
  let release = () => {};
  publishQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await job();
  } finally {
    release();
  }
}

function stateResponse(snapshot: MailLoginSnapshot, versions: Awaited<ReturnType<typeof getMailLoginVersions>>) {
  const mode = mailBrandingMode();
  return {
    activeTheme: snapshot.activeTheme,
    themes: {
      enterprise: publicMailLoginConfig(snapshot.themes.enterprise),
      perumnet: publicMailLoginConfig(snapshot.themes.perumnet),
    },
    deployment: {
      mode,
      live: mode === "ssh",
      last: versions[0] ?? null,
    },
    versions,
  };
}

async function currentState(client: DatabaseClient) {
  const [snapshot, versions] = await Promise.all([
    getMailLoginSnapshot(client),
    getMailLoginVersions(client),
  ]);
  return stateResponse(snapshot, versions);
}

function candidateConfig(
  current: MailLoginConfig,
  input: z.infer<typeof configInput>,
) {
  return {
    ...current,
    browserTitle: input.browserTitle,
    eyebrow: input.eyebrow,
    headline: input.headline,
    description: input.description,
    cardTitle: input.cardTitle,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

async function updateConfigRows(
  client: DatabaseClient,
  snapshot: MailLoginSnapshot,
  userId: string,
  versionId: string,
  contentHash: string,
) {
  const timestamp = new Date().toISOString();
  const statements = (Object.values(snapshot.themes) as MailLoginConfig[]).map((config) => ({
    sql: `UPDATE cms_mail_login_configs SET
      browser_title=?,eyebrow=?,headline=?,description=?,card_title=?,
      logo_url=?,logo_source_storage_url=?,logo_storage_url=?,logo_mime_type=?,
      favicon_url=?,favicon_storage_url=?,favicon_mime_type=?,revision=?,is_active=?,
      updated_by=?,updated_at=? WHERE theme_key=?`,
    args: [
      config.browserTitle,
      config.eyebrow,
      config.headline,
      config.description,
      config.cardTitle,
      config.logoUrl,
      config.logoSourceStorageUrl,
      config.logoStorageUrl,
      config.logoMimeType,
      config.faviconUrl,
      config.faviconStorageUrl,
      config.faviconMimeType,
      config.revision,
      config.themeKey === snapshot.activeTheme ? 1 : 0,
      userId,
      timestamp,
      config.themeKey,
    ],
  }));
  statements.push({
    sql: `UPDATE cms_mail_login_versions SET
      status='Deployed',content_hash=?,deployed_at=?,error_message=NULL
      WHERE id=?`,
    args: [contentHash, timestamp, versionId],
  });
  await client.batch(statements, "write");
}

async function markFailed(
  client: DatabaseClient,
  versionId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Deployment Mailcow gagal.";
  await client.execute({
    sql: "UPDATE cms_mail_login_versions SET status='Failed',error_message=? WHERE id=?",
    args: [message.slice(0, 1_000), versionId],
  });
  return message;
}

async function insertPublishingVersion(
  client: DatabaseClient,
  snapshot: MailLoginSnapshot,
  user: AuthUser,
) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO cms_mail_login_versions
      (id,active_theme,snapshot_json,content_hash,deployment_mode,status,
       error_message,created_by,created_at,deployed_at)
      VALUES (?,?,?,?,?,'Publishing',NULL,?,?,NULL)`,
    args: [
      id,
      snapshot.activeTheme,
      serializeMailLoginSnapshot(snapshot),
      snapshotHash(snapshot),
      mailBrandingMode(),
      user.id,
      timestamp,
    ],
  });
  return id;
}

async function publishSnapshot(
  request: Request,
  user: AuthUser,
  previous: MailLoginSnapshot,
  candidate: MailLoginSnapshot,
  auditAction: "publish" | "rollback",
  auditMetadata: Record<string, unknown>,
) {
  const { client } = await getDatabase();
  const versionId = await insertPublishingVersion(client, candidate, user);
  try {
    const deployed = await deployMailLoginSnapshot(candidate, versionId);
    try {
      await updateConfigRows(client, candidate, user.id, versionId, deployed.contentHash);
    } catch (databaseError) {
      await deployMailLoginSnapshot(previous, `rollback-${versionId}`).catch(() => undefined);
      throw databaseError;
    }
    await writeAuditLog(client, request, user, auditAction, "cms_mail_login", versionId, {
      activeTheme: candidate.activeTheme,
      deploymentMode: deployed.mode,
      contentHash: deployed.contentHash,
      ...auditMetadata,
    });
    return currentState(client);
  } catch (error) {
    const message = await markFailed(client, versionId, error);
    await writeAuditLog(client, request, user, "deploy_failed", "cms_mail_login", versionId, {
      activeTheme: candidate.activeTheme,
      message,
      ...auditMetadata,
    });
    throw error;
  }
}

async function updateMailLogin(request: Request, user: AuthUser) {
  return serialized(async () => {
    const form = await request.formData();
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(String(form.get("payload") ?? ""));
    } catch {
      throw new ApiError(400, "INVALID_PAYLOAD", "Konfigurasi tema belum valid.");
    }
    const input = configInput.parse(rawPayload);
    const { client } = await getDatabase();
    const previous = await getMailLoginSnapshot(client);
    const current = previous.themes[input.theme];
    if (current.revision !== input.revision) {
      throw new ApiError(409, "STALE_REVISION", "Konfigurasi telah berubah di tab lain. Muat ulang sebelum menyimpan.");
    }

    const nextConfig = candidateConfig(current, input);
    const logo = form.get("logo");
    const favicon = form.get("favicon");
    if (logo instanceof File && logo.size > 0) {
      const prepared = await prepareMailLogo(logo);
      nextConfig.logoSourceStorageUrl = await storeMailBrandingFile(input.theme, "source", prepared.sourceMimeType, prepared.source);
      nextConfig.logoStorageUrl = await storeMailBrandingFile(input.theme, "logo", "image/png", prepared.logo);
      nextConfig.logoMimeType = "image/png";
      nextConfig.logoUrl = "";
      if (!(favicon instanceof File) || favicon.size === 0) {
        nextConfig.faviconStorageUrl = await storeMailBrandingFile(input.theme, "favicon", "image/png", prepared.favicon);
        nextConfig.faviconMimeType = "image/png";
        nextConfig.faviconUrl = "";
      }
    }
    if (favicon instanceof File && favicon.size > 0) {
      const prepared = await prepareMailFavicon(favicon);
      nextConfig.faviconStorageUrl = await storeMailBrandingFile(input.theme, "favicon", "image/png", prepared);
      nextConfig.faviconMimeType = "image/png";
      nextConfig.faviconUrl = "";
    }

    const candidate: MailLoginSnapshot = {
      activeTheme: input.activeTheme,
      themes: {
        enterprise: { ...previous.themes.enterprise },
        perumnet: { ...previous.themes.perumnet },
        [input.theme]: nextConfig,
      },
    };
    for (const config of Object.values(candidate.themes)) {
      config.isActive = config.themeKey === candidate.activeTheme;
    }
    return publishSnapshot(request, user, previous, candidate, "publish", {
      editedTheme: input.theme,
      previousRevision: input.revision,
      nextRevision: nextConfig.revision,
      changedLogo: logo instanceof File && logo.size > 0,
      changedFavicon: favicon instanceof File && favicon.size > 0,
    });
  });
}

async function rollbackMailLogin(request: Request, versionId: string, user: AuthUser) {
  return serialized(async () => {
    const { client } = await getDatabase();
    const [previous, versionResult] = await Promise.all([
      getMailLoginSnapshot(client),
      client.execute({
        sql: "SELECT snapshot_json,status FROM cms_mail_login_versions WHERE id=? LIMIT 1",
        args: [versionId],
      }),
    ]);
    const row = versionResult.rows[0];
    if (!row) throw new ApiError(404, "VERSION_NOT_FOUND", "Versi tema login tidak ditemukan.");
    if (row.status !== "Deployed" && row.status !== "Rolled Back") {
      throw new ApiError(409, "VERSION_NOT_DEPLOYED", "Hanya versi yang pernah berhasil diterapkan yang dapat dipulihkan.");
    }
    const restored = parseMailLoginSnapshot(String(row.snapshot_json));
    const timestamp = new Date().toISOString();
    for (const key of ["enterprise", "perumnet"] as const) {
      restored.themes[key].revision = previous.themes[key].revision + 1;
      restored.themes[key].updatedAt = timestamp;
      restored.themes[key].isActive = key === restored.activeTheme;
    }
    await publishSnapshot(request, user, previous, restored, "rollback", {
      restoredVersionId: versionId,
    });
    await client.execute({
      sql: "UPDATE cms_mail_login_versions SET status='Rolled Back' WHERE id=?",
      args: [versionId],
    });
    return currentState(client);
  });
}

export async function dispatchMailLoginApi(
  request: Request,
  path: string[],
  user: AuthUser,
) {
  const action = path[1];
  const { client } = await getDatabase();

  if (!action && request.method === "GET") {
    return ok(await currentState(client), 200, { "Cache-Control": "no-store" });
  }
  if (!action && request.method === "PUT") return ok(await updateMailLogin(request, user));
  if (action === "history" && request.method === "GET") {
    return ok(
      { versions: await getMailLoginVersions(client, 30) },
      200,
      { "Cache-Control": "no-store" },
    );
  }
  if (action === "media" && request.method === "GET") {
    const theme = themeKey.safeParse(path[2]);
    const kind = path[3] === "favicon" ? "favicon" : path[3] === "logo" ? "logo" : null;
    if (!theme.success || !kind) throw new ApiError(404, "MEDIA_NOT_FOUND", "Aset tema login tidak ditemukan.");
    const media = await getMailLoginMedia(client, theme.data, kind);
    return new Response(media.content, {
      headers: {
        "Content-Type": media.contentType,
        "Cache-Control": "private, max-age=300, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (action === "rollback" && path[2] && request.method === "POST") {
    return ok(await rollbackMailLogin(request, path[2], user));
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint tema login PerumNet Mail tidak ditemukan.");
}
