// The three refusals that only exist in a production process.
//
// Written against a server started with NODE_ENV=production because the guards
// under test read that value — and reading it correctly is itself part of the
// fix. Next replaces the literal `process.env.NODE_ENV` while compiling, so a
// guard written the obvious way stays "development" inside this very server; it
// was measured handing a password-reset token back to an anonymous caller with
// NODE_ENV=production exported. See server/runtime-env.ts.
//
// Every test here fails on the commit before the fix.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { runtimeNodeEnv } from "../server/runtime-env.ts";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;

const SEED_PASSWORD = "audit-production-seed-2026";

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
  const deadline = Date.now() + 40_000;
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
  databasePath = `/tmp/perumnet-production-hardening-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-production-hardening-uploads-${process.pid}-${Date.now()}`;
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
        // Nothing can carry a security email, and no bot protection is
        // configured: the two states the old code answered by handing out
        // secrets and by accepting everything.
        EMAIL_MODE: "live",
        SMTP_HOST: "",
        SMTP_PORT: "",
        SMTP_USER: "",
        SMTP_PASS: "",
        SECURITY_SMTP_HOST: "",
        SECURITY_SMTP_USER: "",
        SECURITY_SMTP_PASS: "",
        RESEND_API_KEY: "",
        TURNSTILE_SECRET_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
}, { timeout: 60_000 });

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

test("NODE_ENV is read from the process, not from whatever the bundler inlined", () => {
  // Runs in the plain Node test process, where both readings agree. The point
  // of the assertion is the shape of the helper: anything that must refuse in
  // production has to go through it, because the inlined literal disagrees with
  // reality inside a Next server.
  assert.equal(runtimeNodeEnv(), process.env.NODE_ENV ?? "");
});

test("a production process never hands a password-reset token back over HTTP", async () => {
  const response = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.201",
    },
    body: JSON.stringify({ email: "admin@perumnet.id" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(
    payload.data.resetToken,
    undefined,
    "an anonymous caller must not be able to read the reset token out of the reply",
  );
  assert.deepEqual(Object.keys(payload.data), ["message"]);
});

test("an unset TURNSTILE_SECRET_KEY refuses public lead submissions instead of accepting them unverified", async () => {
  const response = await fetch(`${baseUrl}/api/cms/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "idempotency-key": "audit-production-lead-000001",
    },
    body: JSON.stringify({
      fullName: "Calon Pelanggan Audit",
      whatsapp: "081298761234",
      location: "Denpasar",
      serviceInterest: "Internet Dedicated",
      message: "Mohon informasi paket internet untuk kantor kami.",
      privacyConsent: true,
    }),
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "TURNSTILE_NOT_CONFIGURED");
  // A public visitor gets a way forward, not a stack trace.
  assert.match(payload.error.message, /WhatsApp atau email/);
});

test("the production CSP drops the development eval allowance", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});
