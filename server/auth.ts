import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { compare } from "bcryptjs";
import {
  defaultPermissions,
  normalizePermissions,
  type AccessPermissions,
  type EnterpriseRole,
} from "@/shared/access";
import { getDatabase } from "./db/client";
import type { DatabaseClient } from "./db/client";
import { ApiError } from "./api/errors";

export const SESSION_COOKIE = "perumnet_session";

export type UserRole = "Admin" | "Project Manager" | "Engineer" | "Finance";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "Aktif" | "Nonaktif";
  permissions: AccessPermissions;
  preferredLanguage: "id" | "en";
  avatarUrl?: string;
}

function authUserFromRow(row: Record<string, unknown>): AuthUser {
  const role = String(row.role) as EnterpriseRole;
  let storedPermissions: Partial<AccessPermissions> | undefined;
  try {
    storedPermissions = row.permissions_json
      ? (JSON.parse(String(row.permissions_json)) as Partial<AccessPermissions>)
      : undefined;
  } catch {
    storedPermissions = undefined;
  }
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role,
    status: String(row.status) as AuthUser["status"],
    permissions: storedPermissions
      ? normalizePermissions(role, storedPermissions)
      : defaultPermissions(role),
    preferredLanguage: row.preferred_language === "en" ? "en" : "id",
    ...(row.avatar_mime_type ? { avatarUrl: `/api/profile/avatar/${String(row.id)}` } : {}),
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseCookies(header: string | null) {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    cookies.set(
      part.slice(0, separator).trim(),
      decodeURIComponent(part.slice(separator + 1).trim()),
    );
  }
  return cookies;
}

function serializeCookie(name: string, value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const cookiePath =
    configuredBasePath && configuredBasePath !== "/"
      ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
      : "/";
  return `${name}=${encodeURIComponent(value)}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function verifyCredentials(email: string, password: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT u.id,u.name,u.email,u.password_hash,u.role,u.status,
        p.preferred_language,p.avatar_mime_type,up.permissions_json
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id=u.id
      LEFT JOIN user_permissions up ON up.user_id=u.id
      WHERE lower(u.email) = lower(?) LIMIT 1
    `,
    args: [email],
  });
  const row = result.rows[0];

  if (!row || !(await compare(password, String(row.password_hash)))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email atau kata sandi tidak sesuai.");
  }
  if (row.status !== "Aktif") {
    throw new ApiError(403, "ACCOUNT_INACTIVE", "Akun ini sedang dinonaktifkan.");
  }

  return authUserFromRow(row);
}

export async function createSession(userId: string, remember: boolean) {
  const { client } = await getDatabase();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const expiresAt = new Date(now.getTime() + maxAge * 1000).toISOString();

  await client.batch(
    [
      {
        sql: "DELETE FROM sessions WHERE expires_at <= ?",
        args: [now.toISOString()],
      },
      {
        sql: "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
        args: [randomUUID(), userId, sha256(token), expiresAt, now.toISOString()],
      },
      {
        sql: "UPDATE users SET last_active_at = ?, updated_at = ? WHERE id = ?",
        args: [now.toISOString(), now.toISOString(), userId],
      },
    ],
    "write",
  );

  return { token, maxAge };
}

export async function revokeSession(request: Request) {
  const token = parseCookies(request.headers.get("cookie")).get(SESSION_COOKIE);
  if (!token) return;
  const { client } = await getDatabase();
  await client.execute({
    sql: "DELETE FROM sessions WHERE token_hash = ?",
    args: [sha256(token)],
  });
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const token = parseCookies(request.headers.get("cookie")).get(SESSION_COOKIE);
  if (!token) return null;

  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT u.id,u.name,u.email,u.role,u.status,
        p.preferred_language,p.avatar_mime_type,up.permissions_json
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN user_profiles p ON p.user_id=u.id
      LEFT JOIN user_permissions up ON up.user_id=u.id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'Aktif'
      LIMIT 1
    `,
    args: [sha256(token), new Date().toISOString()],
  });
  const row = result.rows[0];
  if (!row) return null;

  return authUserFromRow(row);
}

export async function requireUser(request: Request, roles?: UserRole[]) {
  const user = await getSessionUser(request);
  if (!user) {
    throw new ApiError(401, "UNAUTHENTICATED", "Silakan masuk untuk melanjutkan.");
  }
  if (roles && !roles.includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "Peran Anda tidak memiliki akses ke fitur ini.");
  }
  return user;
}

export function withSessionCookie(response: Response, token: string, maxAge: number) {
  response.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, token, maxAge));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function withClearedSessionCookie(response: Response) {
  response.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, "", 0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function createPasswordResetToken(client: DatabaseClient, userId: string) {
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  await client.batch(
    [
      {
        sql: "DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?",
        args: [userId, now.toISOString()],
      },
      {
        sql: "INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
        args: [
          randomUUID(),
          userId,
          sha256(rawToken),
          new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
          now.toISOString(),
        ],
      },
    ],
    "write",
  );
  return rawToken;
}

export function hashResetToken(token: string) {
  return sha256(token);
}
