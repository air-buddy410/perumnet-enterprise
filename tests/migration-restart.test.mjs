import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";

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
      lastError = new Error(
        `Health endpoint returned ${response.status}: ${await response.text()}`,
      );
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError ?? new Error("Server did not become ready.");
}

function startServer(port) {
  return spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        TURSO_DATABASE_URL: `file:${databasePath}`,
        APP_URL: baseUrl,
        UPLOAD_DIR: uploadDirectory,
        MAIL_BRANDING_MODE: "capture",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function stopServer() {
  if (!server || server.killed) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function json(path, options = {}, expected = 200) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const payload = await response.json();
  assert.equal(response.status, expected, JSON.stringify(payload));
  return payload.data ?? payload;
}

async function login() {
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-migration-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-migration-uploads-${process.pid}-${Date.now()}`;
  server = startServer(port);
  await waitForServer(baseUrl);
}, { timeout: 60_000 });

after(async () => {
  await stopServer();
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
});

test("restart re-runs migrations against quotation revisions and multi-package data", async () => {
  await login();
  const project = await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Proyek Migrasi Restart",
        client: "Klien Restart",
        location: "Denpasar",
        status: "Draft",
        value: 5_000_000,
      }),
    },
    201,
  );

  await json(
    `/api/boq/items?projectId=${project.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Perangkat",
        description: "Switch distribusi",
        quantity: 1,
        unit: "unit",
        costPrice: 1_000_000,
        sellingPrice: 1_500_000,
      }),
    },
    201,
  );
  await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent" }),
  });
  const revised = await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent" }),
  });
  assert.match(revised.number, /-R2$/);

  const secondPackage = await json(
    `/api/projects/${project.id}/packages`,
    { method: "POST", body: JSON.stringify({ title: "Paket Smart Home" }) },
    201,
  );
  await json(
    `/api/boq/items?projectId=${project.id}&packageId=${secondPackage.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Perangkat",
        description: "Smart hub",
        quantity: 1,
        unit: "unit",
        costPrice: 500_000,
        sellingPrice: 750_000,
      }),
    },
    201,
  );
  // An addendum belongs to the package it was raised from. The startup
  // backfill must never drag it back to the project's default package.
  const addendum = await json(
    `/api/boq/scopes?projectId=${project.id}&packageId=${secondPackage.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        title: "Addendum Smart Home",
        items: [
          {
            category: "Perangkat",
            description: "Sensor tambahan",
            quantity: 2,
            unit: "unit",
            costPrice: 150_000,
            sellingPrice: 250_000,
          },
        ],
      }),
    },
    201,
  );
  assert.equal(addendum.packageId, secondPackage.id);

  const defaultValidation = await json(
    `/api/validations?projectId=${project.id}`,
    { method: "POST" },
    201,
  );
  const packageValidation = await json(
    `/api/validations?projectId=${project.id}&packageId=${secondPackage.id}`,
    { method: "POST" },
    201,
  );
  assert.notEqual(defaultValidation.id, packageValidation.id);

  await stopServer();
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = startServer(port);
  await waitForServer(baseUrl);

  await login();
  assert.equal(
    (await json(`/api/quotations?projectId=${project.id}`)).number,
    revised.number,
  );
  const packagesAfterRestart = await json(`/api/projects/${project.id}/packages`);
  assert.equal(packagesAfterRestart.length, 2);
  assert.equal(
    (await json(`/api/validations?projectId=${project.id}`)).id,
    defaultValidation.id,
  );

  // Re-running the migration is idempotent for package-scoped scopes: the
  // addendum keeps its own package and the default package is untouched.
  const restartedScopes = await json(
    `/api/boq/scopes?projectId=${project.id}&packageId=${secondPackage.id}`,
  );
  assert.equal(
    restartedScopes.find((scope) => scope.id === addendum.id)?.packageId,
    secondPackage.id,
  );
  const defaultPackage = packagesAfterRestart.find(
    (entry) => entry.id !== secondPackage.id,
  );
  const defaultScopes = await json(
    `/api/boq/scopes?projectId=${project.id}&packageId=${defaultPackage.id}`,
  );
  assert.equal(
    defaultScopes.some((scope) => scope.id === addendum.id),
    false,
    "the backfill never reassigns an addendum to the default package",
  );
  assert.equal(
    packagesAfterRestart.find((entry) => entry.id === secondPackage.id).scopeCount,
    2,
  );
  assert.equal(defaultPackage.scopeCount, 1);
}, { timeout: 150_000 });

// ---------------------------------------------------------------------------
// Databases created before the BAST void fix carry
// CHECK (status IN ('Draft','Final')), so every revocation died on a raw
// constraint error. Startup must relax that constraint in place — without
// losing a single row or index.
// ---------------------------------------------------------------------------
const CHECK_PATTERN = /CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)/i;

test("startup relaxes a legacy BAST status constraint without losing rows or indexes", async () => {
  await login();
  await stopServer();

  const legacy = createClient({ url: `file:${databasePath}` });
  const tableSql = String(
    (
      await legacy.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='basts' LIMIT 1",
      )
    ).rows[0].sql,
  );
  assert.match(tableSql, /'Void'/, "fresh databases already declare the Void status");
  const indexes = (
    await legacy.execute(
      "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='basts' AND sql IS NOT NULL",
    )
  ).rows.map((row) => ({ name: String(row.name), sql: String(row.sql) }));
  assert.ok(indexes.length > 0, "the table carries named indexes worth preserving");
  const projectId = String(
    (await legacy.execute("SELECT id FROM projects LIMIT 1")).rows[0].id,
  );

  // Rewind the table to the pre-fix shape and seed a finalized document on it.
  await legacy.execute("ALTER TABLE basts RENAME TO basts_legacy_probe");
  await legacy.execute(
    tableSql.replace(CHECK_PATTERN, "CHECK (status IN ('Draft', 'Final'))"),
  );
  await legacy.execute("INSERT INTO basts SELECT * FROM basts_legacy_probe");
  await legacy.execute("DROP TABLE basts_legacy_probe");
  for (const index of indexes) await legacy.execute(index.sql);
  const stamp = new Date().toISOString();
  await legacy.execute({
    sql: `INSERT INTO basts
      (id,number,project_id,delivery_cycle,revision_no,completion_date,notes,
       installed_items_json,client_name,client_role,engineer_name,engineer_role,
       status,created_at,updated_at)
      VALUES ('bast-legacy-probe','BAST/PN/LEGACY/001',?,1,1,'2026-01-01',
        'Dokumen warisan sebelum perbaikan.','[]','Klien Warisan','Manager',
        'Insinyur Warisan','Project Manager','Final',?,?)`,
    args: [projectId, stamp, stamp],
  });
  await assert.rejects(
    legacy.execute("UPDATE basts SET status='Void' WHERE id='bast-legacy-probe'"),
    /CHECK/,
    "the legacy constraint really is back in place",
  );
  legacy.close();

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = startServer(port);
  await waitForServer(baseUrl);
  await login();

  const migrated = createClient({ url: `file:${databasePath}` });
  const migratedSql = String(
    (
      await migrated.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='basts' LIMIT 1",
      )
    ).rows[0].sql,
  );
  assert.match(migratedSql, /'Void'/, "the constraint now allows Void");
  await migrated.execute("UPDATE basts SET status='Void' WHERE id='bast-legacy-probe'");
  const row = (
    await migrated.execute(
      "SELECT status,notes,number FROM basts WHERE id='bast-legacy-probe' LIMIT 1",
    )
  ).rows[0];
  assert.equal(String(row.status), "Void");
  assert.equal(String(row.notes), "Dokumen warisan sebelum perbaikan.");
  assert.equal(String(row.number), "BAST/PN/LEGACY/001");
  const rebuiltIndexes = (
    await migrated.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='basts' AND sql IS NOT NULL",
    )
  ).rows.map((entry) => String(entry.name)).sort();
  assert.deepEqual(
    rebuiltIndexes,
    indexes.map((index) => index.name).sort(),
    "every named index survives the rebuild",
  );
  migrated.close();

  // Re-running the migration against an already-correct database is a no-op.
  await stopServer();
  const secondPort = await freePort();
  baseUrl = `http://127.0.0.1:${secondPort}`;
  server = startServer(secondPort);
  await waitForServer(baseUrl);
  await login();
  const rerun = createClient({ url: `file:${databasePath}` });
  const stillVoid = (
    await rerun.execute(
      "SELECT status FROM basts WHERE id='bast-legacy-probe' LIMIT 1",
    )
  ).rows[0];
  assert.equal(String(stillVoid.status), "Void", "the re-run keeps the data intact");
  rerun.close();
}, { timeout: 150_000 });
