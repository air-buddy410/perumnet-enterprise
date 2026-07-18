import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { compare } from "bcryptjs";
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
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function verifyCredentials(email: string, password: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: "SELECT id,name,email,password_hash,role,status FROM users WHERE lower(email) = lower(?) LIMIT 1",
    args: [email],
  });
  const row = result.rows[0];

  if (!row || !(await compare(password, String(row.password_hash)))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email atau kata sandi tidak sesuai.");
  }
  if (row.status !== "Aktif") {
    throw new ApiError(403, "ACCOUNT_INACTIVE", "Akun ini sedang dinonaktifkan.");
  }

  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as UserRole,
    status: String(row.status) as AuthUser["status"],
  } satisfies AuthUser;
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
      SELECT u.id,u.name,u.email,u.role,u.status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'Aktif'
      LIMIT 1
    `,
    args: [sha256(token), new Date().toISOString()],
  });
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as UserRole,
    status: String(row.status) as AuthUser["status"],
  };
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
