// Referential-integrity contract for the item catalog.
//
// item_catalog_brands.category_id and item_catalog_items.category_id are both
// declared ON DELETE RESTRICT, so the database refuses to drop a category that
// still has children. Every route that can delete or re-point a category is a
// user-reachable button, so none of them may ever surface the raw driver error
// as a 500 — the answer has to be a friendly ApiError the UI can translate.
//
// A demo server logged exactly that raw 500 while deleting a category:
//   update or delete on table "item_catalog_categories" violates RESTRICT
//   setting of foreign key constraint "item_catalog_brands_category_id_fkey"
// These tests pin the shape of the answer, not just the absence of a crash.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { errorResponse, isForeignKeyViolation } from "../server/api/errors.ts";

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
  const deadline = Date.now() + 30_000;
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

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return response;
}

async function json(path, options = {}, expectedStatus = 200) {
  const response = await request(path, options);
  const payload = response.status === 204 ? null : await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${options.method ?? "GET"} ${path} -> ${JSON.stringify(payload?.error ?? payload)}`,
  );
  return payload?.data;
}

async function errorOf(path, options) {
  const response = await request(path, options);
  const payload = response.status === 204 ? null : await response.json();
  return { status: response.status, ...(payload?.error ?? {}) };
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-catalog-integrity-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-catalog-integrity-uploads-${process.pid}-${Date.now()}`;
  server = spawn(
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
  await waitForServer(baseUrl);
  const login = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: true,
    }),
  });
  assert.equal(login.user.role, "Admin");
}, { timeout: 40_000 });

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

let categoryCounter = 0;
async function createCategory(overrides = {}) {
  categoryCounter += 1;
  return await json(
    "/api/catalog/categories",
    {
      method: "POST",
      body: JSON.stringify({
        boqRole: "Perangkat",
        name: `Kategori Integritas ${categoryCounter}`,
        nameEn: `Integrity Category ${categoryCounter}`,
        defaultMargin1Percent: 20,
        defaultMargin2Percent: 30,
        status: "Aktif",
        sortOrder: 900 + categoryCounter,
        ...overrides,
      }),
    },
    201,
  );
}

let brandCounter = 0;
async function createBrand(categoryId, overrides = {}) {
  brandCounter += 1;
  return await json(
    "/api/catalog/brands",
    {
      method: "POST",
      body: JSON.stringify({
        categoryId,
        name: `Merek Integritas ${brandCounter}`,
        status: "Aktif",
        sortOrder: brandCounter,
        ...overrides,
      }),
    },
    201,
  );
}

let itemCounter = 0;
async function createItem(categoryId, brandId) {
  itemCounter += 1;
  return await json(
    "/api/catalog/items",
    {
      method: "POST",
      body: JSON.stringify({
        categoryId,
        brandId,
        sku: `INTEGRITY-${itemCounter}`,
        name: `Item Integritas ${itemCounter}`,
        unit: "unit",
        costPrice: 1_000_000,
        margin1Percent: 20,
        margin2Percent: 30,
        status: "Aktif",
      }),
    },
    201,
  );
}

// The exact shape the demo server failed on: a category that owns brands but
// no items. The brands have to go with it instead of blocking it.
test("deleting a category with brands and no items removes both", async () => {
  const category = await createCategory();
  const brands = [await createBrand(category.id), await createBrand(category.id)];

  await json(`/api/catalog/categories/${category.id}`, { method: "DELETE" }, 204);

  const catalog = await json("/api/catalog?includeInactive=true");
  assert.equal(catalog.categories.some((entry) => entry.id === category.id), false);
  for (const brand of brands) {
    assert.equal(catalog.brands.some((entry) => entry.id === brand.id), false);
  }
});

// A category holding items keeps its friendly 409 rather than cascading the
// items away — history has to stay intact.
test("deleting a category that still has items answers CATEGORY_IN_USE", async () => {
  const category = await createCategory();
  const brand = await createBrand(category.id);
  await createItem(category.id, brand.id);

  const failure = await errorOf(`/api/catalog/categories/${category.id}`, { method: "DELETE" });
  assert.equal(failure.status, 409);
  assert.equal(failure.code, "CATEGORY_IN_USE");
  assert.match(failure.message, /Nonaktifkan kategori/);

  const catalog = await json("/api/catalog?includeInactive=true");
  assert.equal(catalog.categories.some((entry) => entry.id === category.id), true);
  assert.equal(catalog.brands.some((entry) => entry.id === brand.id), true);
});

// Re-pointing a brand at a category that does not exist used to reach the
// database and come back as a raw 500 from the FK constraint. The route has to
// answer before the driver does.
test("re-pointing a brand at a missing category is refused, not a 500", async () => {
  const category = await createCategory();
  const brand = await createBrand(category.id);

  const failure = await errorOf(`/api/catalog/brands/${brand.id}`, {
    method: "PATCH",
    body: JSON.stringify({ categoryId: "kategori-yang-tidak-ada" }),
  });
  assert.notEqual(failure.status, 500);
  assert.equal(failure.status, 404);
  assert.equal(failure.code, "CATEGORY_NOT_FOUND");

  const catalog = await json("/api/catalog?includeInactive=true");
  const stored = catalog.brands.find((entry) => entry.id === brand.id);
  assert.equal(stored.categoryId, category.id);
});

// Same hole on create: a brand pointed at a category that is not there.
test("creating a brand under a missing category is refused, not a 500", async () => {
  const failure = await errorOf("/api/catalog/brands", {
    method: "POST",
    body: JSON.stringify({
      categoryId: "kategori-yang-tidak-ada",
      name: "Merek Tanpa Kategori",
      status: "Aktif",
      sortOrder: 1,
    }),
  });
  assert.notEqual(failure.status, 500);
  assert.equal(failure.status, 404);
  assert.equal(failure.code, "CATEGORY_NOT_FOUND");
});

// The last line of defence. A handler guard can always lose a race against a
// concurrent write, so whatever the driver raises has to leave the server as a
// translatable conflict — never a 500, and never the constraint name.
test("driver foreign-key violations leave as a friendly conflict, not a 500", async () => {
  const violations = [
    // The exact error the demo server logged.
    Object.assign(
      new Error(
        'update or delete on table "item_catalog_categories" violates RESTRICT setting of ' +
          'foreign key constraint "item_catalog_brands_category_id_fkey" on table "item_catalog_brands"',
      ),
      { code: "23001", constraint: "item_catalog_brands_category_id_fkey" },
    ),
    // The other direction: the parent vanished under an insert.
    Object.assign(
      new Error(
        'insert or update on table "item_catalog_brands" violates foreign key constraint ' +
          '"item_catalog_brands_category_id_fkey"',
      ),
      { code: "23503", constraint: "item_catalog_brands_category_id_fkey" },
    ),
    // SQLite collapses both into one code.
    Object.assign(new Error("FOREIGN KEY constraint failed"), {
      code: "SQLITE_CONSTRAINT_FOREIGNKEY",
    }),
  ];

  for (const violation of violations) {
    assert.equal(isForeignKeyViolation(violation), true, violation.message);
    const response = errorResponse(violation);
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.error.code, "RELATED_DATA_CONFLICT");
    assert.match(payload.error.message, /Muat ulang halaman/);
    assert.doesNotMatch(payload.error.message, /RESTRICT|foreign key|constraint|_fkey/i);
  }

  // Unrelated failures keep reporting as internal errors.
  assert.equal(isForeignKeyViolation(new Error("kaboom")), false);
  assert.equal(isForeignKeyViolation(null), false);
  assert.equal(errorResponse(new Error("kaboom")).status, 500);
});

// The guard-then-delete window is not the UI's problem: firing the same delete
// twice at once must leave one 204 and no raw driver error.
test("two concurrent deletes of the same category never surface a 500", async () => {
  const category = await createCategory();
  await createBrand(category.id);
  await createBrand(category.id);

  const responses = await Promise.all([
    request(`/api/catalog/categories/${category.id}`, { method: "DELETE" }),
    request(`/api/catalog/categories/${category.id}`, { method: "DELETE" }),
  ]);

  for (const response of responses) {
    assert.notEqual(response.status, 500, "a concurrent delete leaked a raw 500");
    assert.ok(
      [204, 404, 409].includes(response.status),
      `unexpected concurrent delete status ${response.status}`,
    );
  }
  assert.ok(responses.some((response) => response.status === 204));

  const catalog = await json("/api/catalog?includeInactive=true");
  assert.equal(catalog.categories.some((entry) => entry.id === category.id), false);
});

// A brand created while the category is being deleted is the race the demo log
// caught. Either order is a legitimate outcome; a raw 500 is not.
test("a brand insert racing a category delete never surfaces a 500", async () => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const category = await createCategory();
    await createBrand(category.id);

    const [deleteResponse, brandResponse] = await Promise.all([
      request(`/api/catalog/categories/${category.id}`, { method: "DELETE" }),
      request("/api/catalog/brands", {
        method: "POST",
        body: JSON.stringify({
          categoryId: category.id,
          name: `Merek Balapan ${attempt}`,
          status: "Aktif",
          sortOrder: 1,
        }),
      }),
    ]);

    assert.notEqual(deleteResponse.status, 500, "the delete leaked a raw 500");
    assert.notEqual(brandResponse.status, 500, "the racing brand insert leaked a raw 500");

    if (deleteResponse.status === 204) {
      // The category is gone, so the brand must not have been stranded on it.
      const catalog = await json("/api/catalog?includeInactive=true");
      assert.equal(catalog.categories.some((entry) => entry.id === category.id), false);
      assert.equal(
        catalog.brands.some((entry) => entry.categoryId === category.id),
        false,
        "a brand survived the category it belongs to",
      );
    }
  }
});
