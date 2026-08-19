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
import { authProviderMode, verifyMailserverPassword } from "./mail-auth";
import { isProductionRuntime } from "./runtime-env";
import type { DatabaseClient } from "./db/client";
import { ApiError } from "./api/errors";

export const SESSION_COOKIE = "perumnet_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const REMEMBER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

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

export function avatarUrlForUser(userId: unknown, version: unknown) {
  const suffix = version
    ? `?v=${encodeURIComponent(String(version))}`
    : "";
  return `/api/profile/avatar/${String(userId)}${suffix}`;
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
    ...(row.avatar_mime_type
      ? {
          avatarUrl: avatarUrlForUser(
            row.id,
            row.profile_updated_at ?? row.updated_at,
          ),
        }
      : {}),
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
  // Read through the runtime helper, not the bare literal: Next inlines
  // `process.env.NODE_ENV` at compile time, so a server started with
  // `NODE_ENV=production next dev` would hand out a session cookie without the
  // Secure flag. See server/runtime-env.ts.
  const secure = isProductionRuntime() ? "; Secure" : "";
  const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const cookiePath =
    configuredBasePath && configuredBasePath !== "/"
      ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
      : "/";
  return `${name}=${encodeURIComponent(value)}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// A bcrypt digest at the same cost factor the application uses for real
// passwords (12). When no account matches, we still run a full comparison
// against this value so both paths cost the same. Without it the request that
// finds no row returned in a few milliseconds while a real account spent the
// ~200ms bcrypt needs, and that gap alone told an attacker which addresses are
// registered. Nothing hashes to it; it is not a usable password.
const ABSENT_ACCOUNT_PASSWORD_HASH =
  "$2b$12$hrZ1mh6YKsTSNlHAQsAzy.gvJYs4rUXP2sAoADK/jNt00Im9gQXWq";

/**
 * Memetakan apa yang diketik di kolom login ke alamat lengkap milik akun yang
 * benar-benar ada. Yang mengandung `@` dipakai apa adanya; yang tidak
 * diperlakukan sebagai username, yaitu bagian sebelum `@`.
 *
 * Pemetaannya lewat baris yang ADA, bukan dengan menempelkan domain bawaan.
 * Menempelkan domain berarti mengarang alamat — dan alamat karangan itulah
 * yang nanti dikirim ke mailcow, persis yang dilarang aturan kedua
 * `docs/LOGIN-MAILCOW.md`.
 *
 * Kalau dua akun punya bagian-lokal yang sama, tidak ada yang dipilih.
 * Menebak di situ berarti seseorang bisa masuk ke akun orang lain.
 */
export async function resolveLoginIdentity(
  identity: string,
): Promise<string | null> {
  const bersih = identity.trim().toLowerCase();
  if (!bersih) return null;
  if (bersih.includes("@")) return bersih;

  const { client } = await getDatabase();
  // LIKE, bukan split_part(): yang terakhir hanya ada di Postgres sedangkan
  // aplikasi ini juga jalan di libsql. `_` dan `%` sah di bagian-lokal alamat,
  // jadi keduanya di-escape lebih dulu — tanpa itu `a_b` ikut mencocoki `axb`.
  const pola = `${bersih.replace(/[\\%_]/g, (c) => `\\${c}`)}@%`;
  const hasil = await client.execute({
    sql: "SELECT email FROM users WHERE lower(email) LIKE ? ESCAPE '\\' LIMIT 2",
    args: [pola],
  });
  if (hasil.rows.length !== 1) return null;
  return String(hasil.rows[0].email).toLowerCase();
}

export async function verifyCredentials(email: string, password: string) {
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT u.id,u.name,u.email,u.password_hash,u.role,u.status,u.allow_local_login,
        p.preferred_language,p.avatar_mime_type,p.updated_at AS profile_updated_at,
        up.permissions_json
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id=u.id
      LEFT JOIN user_permissions up ON up.user_id=u.id
      WHERE lower(u.email) = lower(?) LIMIT 1
    `,
    args: [email],
  });
  const row = result.rows[0];

  // ── Di mana kata sandi diperiksa ────────────────────────────────
  //
  // Mode MAILSERVER memindahkan pemeriksaan dari hash lokal ke mailcow: yang
  // sah adalah kata sandi EMAIL orang itu. Hash lokal tetap dipakai untuk akun
  // darurat (`allow_local_login`) — tanpa itu, mailserver yang mati berarti
  // tidak ada seorang pun bisa masuk untuk membetulkannya.
  //
  // Alamat yang TIDAK punya akun di sini tidak pernah dikirim ke mailcow, walau
  // mode mailserver menyala. Kalau dikirim, aplikasi ini berubah jadi alat
  // menebak mailbox: siapa pun bisa menanyakan "apakah alamat ini ada" dan
  // "apakah kata sandi ini benar" untuk alamat yang bukan penggunanya.
  const allowLocalLogin = row ? Number(row.allow_local_login ?? 0) === 1 : false;
  const lewatMailserver =
    Boolean(row) && authProviderMode() === "MAILSERVER" && !allowLocalLogin;

  if (lewatMailserver) {
    const hasil = await verifyMailserverPassword(String(row.email), password);
    if (!hasil.ok) {
      if (hasil.reason === "REJECTED") {
        throw new ApiError(401, "INVALID_CREDENTIALS", "Email atau kata sandi tidak sesuai.");
      }
      // Dibedakan DENGAN SENGAJA dari "kata sandi salah": memberitahu yang
      // keliru membuat orang mereset kata sandi email yang sebenarnya tidak
      // bermasalah. `hasil.detail` sengaja TIDAK ikut ke pemanggil — ia
      // menyebut nama host dan kondisi jaringan.
      console.warn(`[auth] mailserver tidak terjawab: ${hasil.detail}`);
      throw new ApiError(
        503,
        "MAILSERVER_UNREACHABLE",
        "Mailserver sedang tidak bisa dihubungi, jadi login belum bisa diproses. Coba lagi sebentar lagi atau hubungi IT.",
      );
    }
  } else {
    // Always hash, even when there is no account, so the two paths are
    // indistinguishable by timing.
    const passwordMatches = await compare(
      password,
      row ? String(row.password_hash) : ABSENT_ACCOUNT_PASSWORD_HASH,
    );
    if (!row || !passwordMatches) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email atau kata sandi tidak sesuai.");
    }
  }
  if (row.status !== "Aktif") {
    throw new ApiError(403, "ACCOUNT_INACTIVE", "Akun ini sedang dinonaktifkan.");
  }

  return {
    user: authUserFromRow(row),
    /** Dipakai audit log: pemakaian pintu darurat harus terlihat. */
    jalur: lewatMailserver ? ("mailserver" as const) : ("lokal" as const),
  };
}

export async function createSession(userId: string, remember: boolean) {
  const { client } = await getDatabase();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const maxAge = remember
    ? REMEMBER_SESSION_MAX_AGE_SECONDS
    : SESSION_MAX_AGE_SECONDS;
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

/**
 * Ends every session belonging to `userId` except the one that made this
 * request. Changing your own password has to evict whoever else is holding a
 * stolen cookie; logging yourself out at the same moment would only teach
 * people to avoid rotating their password.
 */
export async function revokeOtherSessions(
  client: DatabaseClient,
  request: Request,
  userId: string,
) {
  const token = parseCookies(request.headers.get("cookie")).get(SESSION_COOKIE);
  if (!token) {
    await revokeAllSessions(client, userId);
    return;
  }
  await client.execute({
    sql: "DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?",
    args: [userId, sha256(token)],
  });
}

/** Ends every session belonging to `userId`, including the caller's own. */
export async function revokeAllSessions(client: DatabaseClient, userId: string) {
  await client.execute({
    sql: "DELETE FROM sessions WHERE user_id = ?",
    args: [userId],
  });
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const token = parseCookies(request.headers.get("cookie")).get(SESSION_COOKIE);
  if (!token) return null;

  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `
      SELECT u.id,u.name,u.email,u.role,u.status,
        p.preferred_language,p.avatar_mime_type,p.updated_at AS profile_updated_at,
        up.permissions_json
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

export function emailChangeTokenMinutes() {
  const configured = Number(process.env.EMAIL_CHANGE_TOKEN_MINUTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : 60;
}

/**
 * Stores a pending email change and returns the raw confirmation token. The
 * account keeps its current address until the token comes back, so a stolen
 * session cannot move the recovery address out from under the real owner.
 * Requesting a new change supersedes any earlier pending one.
 */
export async function createEmailChangeToken(
  client: DatabaseClient,
  input: {
    userId: string;
    currentEmail: string;
    newEmail: string;
    requestedBy: string;
  },
) {
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  await client.batch(
    [
      {
        sql: "DELETE FROM email_change_requests WHERE user_id = ? OR expires_at <= ?",
        args: [input.userId, now.toISOString()],
      },
      {
        sql: `INSERT INTO email_change_requests
          (id,user_id,current_email,new_email,token_hash,requested_by,expires_at,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
        args: [
          randomUUID(),
          input.userId,
          input.currentEmail,
          input.newEmail,
          sha256(rawToken),
          input.requestedBy,
          new Date(
            now.getTime() + emailChangeTokenMinutes() * 60 * 1000,
          ).toISOString(),
          now.toISOString(),
        ],
      },
    ],
    "write",
  );
  return rawToken;
}
