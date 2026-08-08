// `server/api/errors.ts` decided whether to hand the caller the internal error
// text from a compile-inlined constant.
//
// Next replaces the literal `process.env.NODE_ENV` while compiling, so inside a
// server started with `NODE_ENV=production next dev` the expression still reads
// "development" and `errorResponse` returned the raw exception message —
// driver text, file paths, SQL fragments — to whoever tripped it. The reading
// now goes through `isProductionRuntime()` in server/runtime-env.ts, which asks
// `globalThis.process.env` and is not rewritten.
//
// This lives in its own file rather than beside the other access regressions
// because two `next dev` processes cannot share this working directory, and the
// finding only exists in a production-mode process.
//
// This test fails on the commit before the fix.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";

const SEED_PASSWORD = "audit-error-leak-seed-2026";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
      lastError = new Error(`Health endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError ?? new Error("Server did not become ready.");
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-error-leak-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-error-leak-uploads-${process.pid}-${Date.now()}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        // The suite must never reach Nominatim: it is a third-party service with a
        // one-request-per-second policy, and a test run creates dozens of projects.
        GEOCODING_ENABLED: "false",
        TURSO_DATABASE_URL: `file:${databasePath}`,
        APP_URL: baseUrl,
        UPLOAD_DIR: uploadDirectory,
        MAIL_BRANDING_MODE: "capture",
        SEED_ADMIN_PASSWORD: SEED_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);

  const signIn = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: SEED_PASSWORD,
      remember: false,
    }),
  });
  assert.equal(signIn.status, 200, await signIn.text());
  cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0];
}, { timeout: 90_000 });

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      server.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
});

test("a production process answers an internal fault with the generic refusal", async () => {
  // A multipart handler handed a JSON body. Reachable by anyone who may manage
  // the catalog, and it raises a plain TypeError rather than an ApiError — the
  // exact shape whose text used to escape to the caller.
  const response = await fetch(`${baseUrl}/api/catalog/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ not: "a workbook" }),
  });
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.error.code, "INTERNAL_ERROR");
  assert.equal(
    payload.error.message,
    "Terjadi kesalahan internal. Silakan coba kembali.",
    "a production process must answer with the generic refusal, not the runtime's own words",
  );
});

test("the session cookie of a production process carries the Secure flag", async () => {
  // Same inlined-constant bug, same file family: `server/auth.ts` built the
  // cookie attributes from the compile-time literal, so this very server handed
  // out a session cookie a proxy would happily replay over plain HTTP.
  const signIn = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: SEED_PASSWORD,
      remember: false,
    }),
  });
  assert.equal(signIn.status, 200);
  const setCookie = signIn.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /perumnet_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /;\s*Secure/);
});
