/**
 * Reads `NODE_ENV` as it actually is in the running process.
 *
 * Next.js replaces the literal member expression `process.env.NODE_ENV` with a
 * constant while it compiles: `"development"` under `next dev`, `"production"`
 * under `next build`. So a guard written as `process.env.NODE_ENV !==
 * "production"` is not a guard at all inside a dev-mode process — it stays
 * `true` no matter what the operator exported before starting the server. That
 * was measured on this codebase: `NODE_ENV=production next dev` still handed a
 * password-reset token back over HTTP.
 *
 * The rewrite covers `process.env.NODE_ENV` and `process.env["NODE_ENV"]`
 * alike — both were measured returning "development" inside a server started
 * with NODE_ENV=production — but it does not follow the access through
 * `globalThis`, which is why the lookup is written the long way round.
 *
 * Anything that must refuse in production should ask here. Anything that only
 * changes logging or formatting should keep using the plain expression, which
 * is cheaper and correct for that purpose.
 *
 * Deliberately not `server-only`: it is one property read with no request,
 * secret or database access, and the regression test imports it directly.
 */
export function runtimeNodeEnv() {
  const environment = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return environment?.NODE_ENV ?? "";
}

export function isProductionRuntime() {
  return runtimeNodeEnv() === "production";
}
