import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import sharp, { type Metadata } from "sharp";
import type { DatabaseClient } from "./db/client";
import { ApiError } from "./api/errors";
import { readProjectFile, storeProjectFile } from "./storage";

export type MailLoginThemeKey = "enterprise" | "perumnet";
export type MailLoginDeploymentMode = "capture" | "ssh";
export type MailLoginDeploymentStatus = "Publishing" | "Deployed" | "Failed" | "Rolled Back";

export type MailLoginConfig = {
  themeKey: MailLoginThemeKey;
  browserTitle: string;
  eyebrow: string;
  headline: string;
  description: string;
  cardTitle: string;
  logoUrl: string;
  logoSourceStorageUrl: string | null;
  logoStorageUrl: string | null;
  logoMimeType: string | null;
  faviconUrl: string;
  faviconStorageUrl: string | null;
  faviconMimeType: string | null;
  revision: number;
  isActive: boolean;
  updatedAt: string;
};

export type MailLoginSnapshot = {
  activeTheme: MailLoginThemeKey;
  themes: Record<MailLoginThemeKey, MailLoginConfig>;
};

export type MailLoginVersion = {
  id: string;
  activeTheme: MailLoginThemeKey;
  contentHash: string;
  deploymentMode: MailLoginDeploymentMode;
  status: MailLoginDeploymentStatus;
  errorMessage: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  deployedAt: string | null;
};

const THEME_KEYS: MailLoginThemeKey[] = ["enterprise", "perumnet"];
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const FORMAT_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function configFromRow(row: Record<string, unknown>): MailLoginConfig {
  const themeKey = row.theme_key === "perumnet" ? "perumnet" : "enterprise";
  return {
    themeKey,
    browserTitle: String(row.browser_title),
    eyebrow: String(row.eyebrow),
    headline: String(row.headline),
    description: String(row.description),
    cardTitle: String(row.card_title),
    logoUrl: String(row.logo_url ?? ""),
    logoSourceStorageUrl: row.logo_source_storage_url ? String(row.logo_source_storage_url) : null,
    logoStorageUrl: row.logo_storage_url ? String(row.logo_storage_url) : null,
    logoMimeType: row.logo_mime_type ? String(row.logo_mime_type) : null,
    faviconUrl: String(row.favicon_url ?? ""),
    faviconStorageUrl: row.favicon_storage_url ? String(row.favicon_storage_url) : null,
    faviconMimeType: row.favicon_mime_type ? String(row.favicon_mime_type) : null,
    revision: numberValue(row.revision, 1),
    isActive: row.is_active === true || row.is_active === 1 || row.is_active === "1",
    updatedAt: String(row.updated_at),
  };
}

function versionFromRow(row: Record<string, unknown>): MailLoginVersion {
  return {
    id: String(row.id),
    activeTheme: row.active_theme === "perumnet" ? "perumnet" : "enterprise",
    contentHash: String(row.content_hash),
    deploymentMode: row.deployment_mode === "ssh" ? "ssh" : "capture",
    status: String(row.status) as MailLoginDeploymentStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    createdAt: String(row.created_at),
    deployedAt: row.deployed_at ? String(row.deployed_at) : null,
  };
}

export async function getMailLoginSnapshot(client: DatabaseClient): Promise<MailLoginSnapshot> {
  const result = await client.execute(
    "SELECT * FROM cms_mail_login_configs ORDER BY theme_key",
  );
  const configs = result.rows.map(configFromRow);
  const enterprise = configs.find((item) => item.themeKey === "enterprise");
  const perumnet = configs.find((item) => item.themeKey === "perumnet");
  if (!enterprise || !perumnet) {
    throw new ApiError(500, "MAIL_LOGIN_CONFIG_MISSING", "Konfigurasi login PerumNet Mail belum lengkap.");
  }
  return {
    activeTheme: configs.find((item) => item.isActive)?.themeKey ?? "enterprise",
    themes: { enterprise, perumnet },
  };
}

export async function getMailLoginVersions(client: DatabaseClient, limit = 12) {
  const result = await client.execute({
    sql: `SELECT v.*,u.name AS created_by_name
      FROM cms_mail_login_versions v
      LEFT JOIN users u ON u.id=v.created_by
      ORDER BY v.created_at DESC LIMIT ?`,
    args: [Math.max(1, Math.min(50, Math.trunc(limit)))],
  });
  return result.rows.map(versionFromRow);
}

export function publicMailLoginConfig(config: MailLoginConfig) {
  const version = encodeURIComponent(String(config.revision));
  return {
    ...config,
    logoUrl: config.logoStorageUrl
      ? `/api/cms/mail-login/media/${config.themeKey}/logo?v=${version}`
      : config.logoUrl,
    faviconUrl: config.faviconStorageUrl
      ? `/api/cms/mail-login/media/${config.themeKey}/favicon?v=${version}`
      : config.faviconUrl,
    logoSourceStorageUrl: undefined,
    logoStorageUrl: undefined,
    logoMimeType: undefined,
    faviconStorageUrl: undefined,
    faviconMimeType: undefined,
  };
}

async function staticAsset(pathname: string) {
  const relative = normalize(pathname.replace(/^\/+/, ""));
  if (!relative.startsWith(`mailcow/`) || relative.includes("..")) {
    throw new ApiError(500, "INVALID_MAIL_ASSET", "Aset bawaan login Mailcow tidak valid.");
  }
  return readFile(join(process.cwd(), "public", relative));
}

async function assetBuffer(storageUrl: string | null, publicUrl: string) {
  if (storageUrl) {
    const stored = await readProjectFile(storageUrl);
    if (!stored) throw new ApiError(500, "MAIL_ASSET_MISSING", "Aset login Mailcow tidak ditemukan.");
    return Buffer.from(stored.content);
  }
  return staticAsset(publicUrl);
}

export async function getMailLoginMedia(
  client: DatabaseClient,
  theme: MailLoginThemeKey,
  kind: "logo" | "favicon",
) {
  const snapshot = await getMailLoginSnapshot(client);
  const config = snapshot.themes[theme];
  const storageUrl = kind === "logo" ? config.logoStorageUrl : config.faviconStorageUrl;
  const publicUrl = kind === "logo" ? config.logoUrl : config.faviconUrl;
  const content = await assetBuffer(storageUrl, publicUrl);
  return {
    content,
    contentType: kind === "logo"
      ? config.logoMimeType ?? "image/png"
      : config.faviconMimeType ?? "image/png",
  };
}

async function validatedImage(file: File) {
  if (file.size <= 0) throw new ApiError(422, "EMPTY_FILE", "File gambar masih kosong.");
  if (file.size > MAX_IMAGE_SIZE) {
    throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran logo atau favicon maksimal 2 MB.");
  }
  if (!Object.values(FORMAT_MIME).includes(file.type)) {
    throw new ApiError(415, "UNSUPPORTED_FILE", "Gunakan gambar PNG, JPG, atau WebP.");
  }
  const source = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION,
    }).metadata();
  } catch {
    throw new ApiError(415, "INVALID_IMAGE", "Isi file bukan gambar yang valid.");
  }
  const detectedMime = metadata.format ? FORMAT_MIME[metadata.format] : undefined;
  if (!detectedMime || detectedMime !== file.type) {
    throw new ApiError(415, "IMAGE_TYPE_MISMATCH", "Tipe file tidak sesuai dengan isi gambarnya.");
  }
  if (!metadata.width || !metadata.height || metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) {
    throw new ApiError(422, "IMAGE_DIMENSIONS", "Dimensi gambar maksimal 4096 × 4096 piksel.");
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new ApiError(415, "ANIMATED_IMAGE", "Gambar animasi tidak didukung.");
  }
  return { source, metadata };
}

async function trimmedPng(source: Buffer) {
  try {
    return await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION,
    })
      .rotate()
      .trim({ threshold: 10 })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new ApiError(422, "IMAGE_PROCESSING_FAILED", "Gambar tidak dapat diproses.");
  }
}

export async function prepareMailLogo(file: File) {
  const { source } = await validatedImage(file);
  const trimmed = await trimmedPng(source);
  const logo = await sharp(trimmed)
    .resize({ width: 900, height: 520, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const favicon = await sharp(trimmed)
    .resize({ width: 224, height: 224, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { source, sourceMimeType: file.type, logo, favicon };
}

export async function prepareMailFavicon(file: File) {
  const { source } = await validatedImage(file);
  const trimmed = await trimmedPng(source);
  return sharp(trimmed)
    .resize({ width: 224, height: 224, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function storeMailBrandingFile(
  theme: MailLoginThemeKey,
  kind: "source" | "logo" | "favicon",
  mimeType: string,
  content: Buffer,
) {
  const id = `cms-mail-${theme}-${kind}-${randomUUID()}`;
  const transferable = new Uint8Array(content.byteLength);
  transferable.set(content);
  const stored = await storeProjectFile(
    id,
    mimeType,
    transferable.buffer,
  );
  if (!stored.storageUrl) {
    throw new ApiError(503, "FILE_STORAGE_UNAVAILABLE", "Penyimpanan aset CMS belum dikonfigurasi.");
  }
  return stored.storageUrl;
}

function escapeCssContent(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\A ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function contentRule(selector: string, value: string) {
  return `${selector}{content:"${escapeCssContent(value)}";}`;
}

async function themeBaseCss(theme: MailLoginThemeKey) {
  const path = theme === "enterprise"
    ? join(process.cwd(), "deploy", "mailcow", "0081-custom-mailcow.css")
    : join(process.cwd(), "deploy", "mailcow", "themes", "perumnet.css");
  return readFile(path, "utf8");
}

export async function renderMailBrandingCss(config: MailLoginConfig) {
  const raw = await themeBaseCss(config.themeKey);
  const base = raw.replaceAll(
    "/img/perumnet-enterprise-brand.png",
    "/img/perumnet-mail-brand.png",
  );
  const visualCopy = `${config.eyebrow}\n\n${config.headline}\n\n${config.description}`;
  const compactCopy = `${config.eyebrow}\n\n${config.headline}`;
  return [
    base,
    "\n/* CMS-managed copy. Values are escaped; raw CSS is never accepted. */",
    contentRule("body:has(#login_user) .overlay::after", visualCopy),
    contentRule("body:has(#login_user) .card-header::before", config.cardTitle),
    contentRule("body:has(#login_user) .mailcow-logo::after", config.eyebrow),
    `@media(max-width:760px){${contentRule("body:has(#login_user) .overlay::after", compactCopy)}}`,
    "",
  ].join("\n");
}

function sha256(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export function serializeMailLoginSnapshot(snapshot: MailLoginSnapshot) {
  return JSON.stringify({
    activeTheme: snapshot.activeTheme,
    themes: Object.fromEntries(THEME_KEYS.map((key) => [key, snapshot.themes[key]])),
  });
}

export function parseMailLoginSnapshot(value: string): MailLoginSnapshot {
  let parsed: Partial<MailLoginSnapshot>;
  try {
    parsed = JSON.parse(value) as Partial<MailLoginSnapshot>;
  } catch {
    throw new ApiError(500, "INVALID_MAIL_SNAPSHOT", "Snapshot tema login Mailcow rusak.");
  }
  if (!parsed.themes?.enterprise || !parsed.themes?.perumnet) {
    throw new ApiError(500, "INVALID_MAIL_SNAPSHOT", "Snapshot tema login Mailcow tidak lengkap.");
  }
  const activeTheme = parsed.activeTheme === "perumnet" ? "perumnet" : "enterprise";
  const normalizeConfig = (
    input: Partial<MailLoginConfig>,
    key: MailLoginThemeKey,
  ): MailLoginConfig => ({
    themeKey: key,
    browserTitle: String(input.browserTitle ?? "PerumNet Mail"),
    eyebrow: String(input.eyebrow ?? "PERUMNET MAIL"),
    headline: String(input.headline ?? "Mail & Collaboration"),
    description: String(input.description ?? "Email bisnis yang aman dan terpusat."),
    cardTitle: String(input.cardTitle ?? "Masuk ke PerumNet Mail"),
    logoUrl: String(input.logoUrl ?? `/mailcow/${key}-logo.png`),
    logoSourceStorageUrl: input.logoSourceStorageUrl ?? null,
    logoStorageUrl: input.logoStorageUrl ?? null,
    logoMimeType: input.logoMimeType ?? null,
    faviconUrl: String(input.faviconUrl ?? `/mailcow/${key}-favicon.png`),
    faviconStorageUrl: input.faviconStorageUrl ?? null,
    faviconMimeType: input.faviconMimeType ?? null,
    revision: numberValue(input.revision, 1),
    isActive: key === activeTheme,
    updatedAt: String(input.updatedAt ?? new Date().toISOString()),
  });
  return {
    activeTheme,
    themes: {
      enterprise: normalizeConfig(parsed.themes.enterprise, "enterprise"),
      perumnet: normalizeConfig(parsed.themes.perumnet, "perumnet"),
    },
  };
}

export function mailBrandingMode(): MailLoginDeploymentMode {
  if (process.env.APP_MODE === "demo") return "capture";
  const configured = process.env.MAIL_BRANDING_MODE?.trim().toLowerCase();
  if (configured === "capture" || configured === "ssh") return configured;
  return process.env.NODE_ENV === "production" ? "ssh" : "capture";
}

async function runSshDeployment(payload: string) {
  const target = process.env.MAIL_BRANDING_SSH_TARGET?.trim();
  const keyPath = process.env.MAIL_BRANDING_SSH_KEY_PATH?.trim();
  const knownHostsPath = process.env.MAIL_BRANDING_KNOWN_HOSTS_PATH?.trim();
  if (!target || !keyPath || !knownHostsPath) {
    throw new ApiError(503, "MAIL_BRANDING_NOT_CONFIGURED", "Secret deployment Mailcow belum dikonfigurasi.");
  }
  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsPath}`,
    "-o", "ConnectTimeout=8",
    "-i", keyPath,
    target,
  ];
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 25_000);
    child.stdout.on("data", (chunk) => { if (stdout.length < 16_000) stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 16_000) stderr += String(chunk); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new ApiError(502, "MAIL_BRANDING_SSH_FAILED", `Koneksi deployment Mailcow gagal: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new ApiError(502, "MAIL_BRANDING_DEPLOY_FAILED", `Mailcow menolak deployment (${code}): ${stderr.trim().slice(0, 600) || "tanpa detail"}`));
        return;
      }
      try {
        const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
        if (response.ok !== true) throw new Error("Respons deployer tidak menyatakan sukses.");
        resolve(response);
      } catch (error) {
        reject(new ApiError(502, "MAIL_BRANDING_INVALID_RESPONSE", error instanceof Error ? error.message : "Respons deployer Mailcow tidak valid."));
      }
    });
    child.stdin.end(payload);
  });
}

export async function deployMailLoginSnapshot(snapshot: MailLoginSnapshot, versionId: string) {
  const config = snapshot.themes[snapshot.activeTheme];
  const [css, logo, favicon] = await Promise.all([
    renderMailBrandingCss(config),
    assetBuffer(config.logoStorageUrl, config.logoUrl),
    assetBuffer(config.faviconStorageUrl, config.faviconUrl),
  ]);
  const contentHash = sha256(Buffer.concat([
    Buffer.from(css),
    logo,
    favicon,
    Buffer.from(config.browserTitle),
  ]));
  const mode = mailBrandingMode();
  const manifest = {
    schemaVersion: 1,
    action: "apply",
    versionId,
    theme: snapshot.activeTheme,
    contentHash,
    browserTitle: config.browserTitle,
    mainName: config.browserTitle,
    files: {
      css: {
        path: "data/web/css/build/0081-custom-mailcow.css",
        sha256: sha256(css),
        contentBase64: Buffer.from(css).toString("base64"),
      },
      logo: {
        path: "data/web/img/perumnet-mail-brand.png",
        sha256: sha256(logo),
        contentBase64: logo.toString("base64"),
      },
      favicon: {
        path: "data/web/favicon.png",
        sha256: sha256(favicon),
        contentBase64: favicon.toString("base64"),
      },
    },
  };
  if (mode === "capture") {
    return { mode, contentHash, remoteVersion: versionId, captured: true };
  }
  const remote = await runSshDeployment(JSON.stringify(manifest));
  if (remote.contentHash !== contentHash) {
    throw new ApiError(502, "MAIL_BRANDING_HASH_MISMATCH", "Hash deployment Mailcow tidak sesuai.");
  }
  return { mode, contentHash, remoteVersion: String(remote.versionId ?? versionId), captured: false };
}

export function snapshotHash(snapshot: MailLoginSnapshot) {
  return sha256(serializeMailLoginSnapshot(snapshot));
}
