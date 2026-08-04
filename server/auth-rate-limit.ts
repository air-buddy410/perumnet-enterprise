import "server-only";

import { createHmac } from "node:crypto";
import type { DatabaseClient } from "./db/client";
import { ApiError } from "./api/errors";

// Every credential-accepting endpoint is throttled on two independent buckets:
//
//   * the caller's IP, so one machine cannot grind through a password list; and
//   * the submitted identifier, so rotating IPs against one account is caught.
//
// Both buckets are deliberately time-boxed. A permanent lock would let an
// attacker who knows the owner's address keep the owner out of their own ERP
// forever, which for a small internal tool costs more than the attack it
// prevents. Instead the block window grows with each extra failure and stops at
// AUTH_RATE_LIMIT_MAX_BLOCK_SECONDS, so a legitimate owner is never more than
// that away from another attempt.
//
// State lives in the database, not in a module-level Map. The app runs one PM2
// process per environment today, so a Map would technically work, but it would
// reset on every deploy — which is exactly when an attacker mid-spray benefits
// most — and it would silently stop working the day a second worker is added.
// `public_form_rate_limits` already establishes the table-backed precedent in
// this codebase; this table follows it.

export type AuthRateLimitRoute = "login" | "forgot-password" | "reset-password";

// Identical text for every bucket. Telling the caller whether the IP or the
// identifier tripped would confirm that the identifier exists.
const RATE_LIMITED_MESSAGE =
  "Terlalu banyak percobaan. Tunggu beberapa menit sebelum mencoba lagi.";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function limits() {
  return {
    ipAttempts: positiveInteger(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS, 8),
    identifierAttempts: positiveInteger(
      process.env.AUTH_RATE_LIMIT_IDENTIFIER_MAX_ATTEMPTS,
      12,
    ),
    windowMs:
      positiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES, 15) * 60_000,
    blockSeconds: positiveInteger(process.env.AUTH_RATE_LIMIT_BLOCK_SECONDS, 60),
    maxBlockSeconds: positiveInteger(
      process.env.AUTH_RATE_LIMIT_MAX_BLOCK_SECONDS,
      900,
    ),
  };
}

export function authClientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function secret() {
  return (
    process.env.AUTH_RATE_LIMIT_SECRET ??
    process.env.LEAD_FINGERPRINT_SECRET ??
    process.env.SESSION_SECRET ??
    process.env.SEED_ADMIN_PASSWORD ??
    "perumnet-local-auth-rate-limit"
  );
}

// Neither the IP nor the email address is stored in the clear: the table would
// otherwise become a list of which addresses have accounts here.
function digest(kind: "ip" | "id", value: string) {
  return createHmac("sha256", secret())
    .update(`${kind}|${value.trim().toLowerCase()}`)
    .digest("hex");
}

function scopeKeys(request: Request, identifier: string | undefined) {
  const keys = [digest("ip", authClientIp(request))];
  if (identifier?.trim()) keys.push(digest("id", identifier));
  return keys;
}

function attemptLimit(index: number) {
  const configured = limits();
  return index === 0 ? configured.ipAttempts : configured.identifierAttempts;
}

/**
 * Refuses the request when either bucket is currently blocked. Call this before
 * any password hashing so a blocked caller cannot also burn server CPU.
 */
export async function assertAuthRateLimit(
  client: DatabaseClient,
  request: Request,
  route: AuthRateLimitRoute,
  identifier?: string,
) {
  const keys = scopeKeys(request, identifier);
  const nowIso = new Date().toISOString();
  const result = await client.execute({
    sql: `SELECT blocked_until FROM auth_rate_limits
      WHERE route_key=? AND scope_key IN (${keys.map(() => "?").join(",")})
        AND blocked_until IS NOT NULL AND blocked_until > ?
      LIMIT 1`,
    args: [route, ...keys, nowIso],
  });
  if (result.rows.length) {
    throw new ApiError(429, "AUTH_RATE_LIMITED", RATE_LIMITED_MESSAGE);
  }
}

/**
 * Records one rejected attempt against both buckets and blocks whichever bucket
 * has crossed its limit. The block length doubles per extra failure, capped.
 */
export async function recordAuthFailure(
  client: DatabaseClient,
  request: Request,
  route: AuthRateLimitRoute,
  identifier?: string,
) {
  const configured = limits();
  const keys = scopeKeys(request, identifier);
  const now = new Date();
  const nowIso = now.toISOString();
  let blocked = false;

  for (const [index, scopeKey] of keys.entries()) {
    const current = await client.execute({
      sql: "SELECT window_started_at,failure_count FROM auth_rate_limits WHERE scope_key=? AND route_key=? LIMIT 1",
      args: [scopeKey, route],
    });
    const row = current.rows[0];
    const windowStart = row?.window_started_at
      ? new Date(String(row.window_started_at))
      : now;
    const withinWindow =
      Boolean(row) && now.getTime() - windowStart.getTime() < configured.windowMs;
    const failureCount = withinWindow ? Number(row?.failure_count ?? 0) + 1 : 1;
    const limit = attemptLimit(index);
    const overshoot = failureCount - limit;
    const blockSeconds =
      overshoot >= 0
        ? Math.min(
            configured.maxBlockSeconds,
            configured.blockSeconds * 2 ** Math.min(overshoot, 20),
          )
        : 0;
    const blockedUntil = blockSeconds
      ? new Date(now.getTime() + blockSeconds * 1_000).toISOString()
      : null;
    if (blockedUntil) blocked = true;
    await client.execute({
      sql: `INSERT INTO auth_rate_limits
        (scope_key,route_key,window_started_at,failure_count,blocked_until,updated_at)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT (scope_key,route_key) DO UPDATE SET
          window_started_at=excluded.window_started_at,
          failure_count=excluded.failure_count,
          blocked_until=excluded.blocked_until,
          updated_at=excluded.updated_at`,
      args: [
        scopeKey,
        route,
        withinWindow ? windowStart.toISOString() : nowIso,
        failureCount,
        blockedUntil,
        nowIso,
      ],
    });
  }

  if (blocked) {
    throw new ApiError(429, "AUTH_RATE_LIMITED", RATE_LIMITED_MESSAGE);
  }
}

/** Clears both buckets after a genuine success so real users are never stuck. */
export async function clearAuthRateLimit(
  client: DatabaseClient,
  request: Request,
  route: AuthRateLimitRoute,
  identifier?: string,
) {
  const keys = scopeKeys(request, identifier);
  await client.execute({
    sql: `DELETE FROM auth_rate_limits
      WHERE route_key=? AND scope_key IN (${keys.map(() => "?").join(",")})`,
    args: [route, ...keys],
  });
}
