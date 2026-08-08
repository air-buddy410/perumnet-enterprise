// Regression tests for the Zod 4 .partial() + .default() PATCH bug class.
//
// In Zod 4, schema.partial().parse({one:"field"}) still fires .default() for
// every omitted key, so handlers written as `input.x ?? current.x` silently
// reset stored data back to schema defaults. Each scenario below sets a
// NON-default value, PATCHes an unrelated field, and asserts the value
// survived. Every module that switched to partialPatchSchema() is covered:
// users & transactions (router.ts), bank-router, catalog-router,
// project-expense-router, procurement-router, profit-share-router.

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

function patch(path, body, expectedStatus = 200) {
  return json(path, { method: "PATCH", body: JSON.stringify(body) }, expectedStatus);
}

function post(path, body, expectedStatus = 201) {
  return json(path, { method: "POST", body: JSON.stringify(body) }, expectedStatus);
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-patch-defaults-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-patch-defaults-uploads-${process.pid}-${Date.now()}`;
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

function isoInDays(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test("users: renaming a deactivated user must not reactivate the account", async () => {
  const createdUser = await post("/api/users", {
    name: "Pegawai Uji Patch",
    email: "patch-defaults@perumnet.id",
    role: "Engineer",
    password: "rahasia-uji-12345",
    status: "Aktif",
  });
  const deactivated = await patch(`/api/users/${createdUser.id}`, { status: "Nonaktif" });
  assert.equal(deactivated.status, "Nonaktif");

  // Regression: userSchema.status defaults to "Aktif", so a profile edit that
  // omitted status used to silently reactivate the account.
  const renamed = await patch(`/api/users/${createdUser.id}`, { name: "Pegawai Uji Patch Baru" });
  assert.equal(renamed.name, "Pegawai Uji Patch Baru");
  assert.equal(renamed.status, "Nonaktif", "rename keeps the user deactivated");
});

test("transactions: editing the description must not reset date or category", async () => {
  const pastDate = isoInDays(-30);
  const transaction = await post("/api/transactions", {
    date: pastDate,
    type: "Pengeluaran",
    description: "Pembelian kabel uji",
    amount: 150_000,
    source: "Kas Kecil",
    category: "Operasional",
  });
  assert.equal(transaction.dateIso, pastDate);

  // Regression: transactionSchema defaults date to today and category to
  // "Lainnya", so an unrelated edit used to rewrite both.
  const updated = await patch(`/api/transactions/${transaction.id}`, {
    description: "Pembelian kabel uji revisi",
  });
  assert.equal(updated.dateIso, pastDate, "edit keeps the transaction date");
  assert.equal(updated.categoryKey, "Operasional", "edit keeps the category");
});

test("bank accounts: renaming must not reset currency, opening balance, or sync mode", async () => {
  const account = await post("/api/bank-accounts", {
    bankName: "Bank Uji Patch",
    accountName: "Rekening Operasional Uji",
    accountNumber: "9876543210",
    currency: "USD",
    openingBalance: 5_000_000,
    syncMode: "Manual",
    status: "Aktif",
  });
  assert.equal(account.currency, "USD");

  // Regression: accountSchema defaults currency to "IDR", openingBalance to 0,
  // and syncMode to "Manual" — a rename used to wipe all three.
  await patch(`/api/bank-accounts/${account.id}`, { accountName: "Rekening Uji Baru" });
  const accounts = await json("/api/bank-accounts");
  const updated = accounts.find((entry) => entry.id === account.id);
  assert.ok(updated, "updated account is listed");
  assert.equal(updated.accountName, "Rekening Uji Baru");
  assert.equal(updated.currency, "USD", "rename keeps the currency");
  assert.equal(updated.openingBalance, 5_000_000, "rename keeps the opening balance");
  assert.equal(updated.syncMode, "Manual", "rename keeps the sync mode");
});

test("catalog: renaming categories and items must not reset margins, unit, or details", async () => {
  const category = await post("/api/catalog/categories", {
    boqRole: "Material",
    name: "Kategori Uji Patch",
    nameEn: "Patch Test Category",
    defaultMargin1Percent: 35,
    defaultMargin2Percent: 45,
    status: "Aktif",
    sortOrder: 7,
  });

  // Regression: categorySchema defaults margins to 20/30 and sortOrder to 0.
  await patch(`/api/catalog/categories/${category.id}`, { name: "Kategori Uji Patch Baru" });
  let catalog = await json("/api/catalog?includeInactive=true");
  const updatedCategory = catalog.categories.find((entry) => entry.id === category.id);
  assert.ok(updatedCategory, "updated category is listed");
  assert.equal(updatedCategory.name, "Kategori Uji Patch Baru");
  assert.equal(updatedCategory.defaultMargin1Percent, 35, "rename keeps margin 1");
  assert.equal(updatedCategory.defaultMargin2Percent, 45, "rename keeps margin 2");
  assert.equal(updatedCategory.sortOrder, 7, "rename keeps the sort order");
  assert.equal(updatedCategory.nameEn, "Patch Test Category", "rename keeps the English name");

  const brand = await post("/api/catalog/brands", {
    categoryId: category.id,
    name: "Merek Uji Patch",
    status: "Aktif",
    sortOrder: 5,
  });

  // Regression: brandSchema defaults sortOrder to 0 and status to "Aktif".
  await patch(`/api/catalog/brands/${brand.id}`, { name: "Merek Uji Patch Baru" });
  const catalogAfterBrand = await json("/api/catalog?includeInactive=true");
  const updatedBrand = catalogAfterBrand.brands.find((entry) => entry.id === brand.id);
  assert.ok(updatedBrand, "updated brand is listed");
  assert.equal(updatedBrand.name, "Merek Uji Patch Baru");
  assert.equal(updatedBrand.sortOrder, 5, "rename keeps the brand sort order");

  const item = await post("/api/catalog/items", {
    categoryId: category.id,
    brandId: brand.id,
    sku: "PATCH-UJI-001",
    name: "Item Uji Patch",
    nameEn: "Patch Test Item",
    model: "X-100",
    specifications: "Spesifikasi uji",
    unit: "meter",
    costPrice: 100_000,
    margin1Percent: 25,
    margin2Percent: 40,
    status: "Aktif",
  });

  // Regression: itemSchema defaults unit to "unit" and nameEn/model/
  // specifications to "" — a rename used to blank them all.
  await patch(`/api/catalog/items/${item.id}`, { name: "Item Uji Patch Baru" });
  catalog = await json("/api/catalog?includeInactive=true");
  const updatedItem = catalog.items.find((entry) => entry.id === item.id);
  assert.ok(updatedItem, "updated item is listed");
  assert.equal(updatedItem.name, "Item Uji Patch Baru");
  assert.equal(updatedItem.unit, "meter", "rename keeps the unit");
  assert.equal(updatedItem.model, "X-100", "rename keeps the model");
  assert.equal(updatedItem.nameEn, "Patch Test Item", "rename keeps the English name");
  assert.equal(updatedItem.specifications, "Spesifikasi uji", "rename keeps the specifications");
});

test("project expenses: editing the merchant must not clear notes or item details", async () => {
  const project = await post("/api/projects", {
    name: "Proyek Uji Patch Belanja",
    client: "Klien Uji Patch",
    location: "Gianyar",
    status: "Aktif",
    value: 0,
  });
  const category = await post("/api/project-expense-categories", {
    name: "Kategori Biaya Uji",
    nameEn: "Patch Test Expense Category",
    status: "Aktif",
    sortOrder: 9,
  });

  // Regression: the expense category schema defaults sortOrder to 0.
  await patch(`/api/project-expense-categories/${category.id}`, { name: "Kategori Biaya Uji Baru" });
  const categories = await json("/api/project-expense-categories");
  const updatedCategory = categories.find((entry) => entry.id === category.id);
  assert.ok(updatedCategory, "updated expense category is listed");
  assert.equal(updatedCategory.sortOrder, 9, "rename keeps the sort order");
  assert.equal(updatedCategory.status, "Aktif", "rename keeps the status");

  const expense = await post("/api/project-expenses", {
    projectId: project.id,
    purchaseDate: isoInDays(-3),
    merchant: "Toko Kabel Uji",
    categoryId: category.id,
    totalAmount: 500_000,
    fundingSource: "CompanyAccount",
    paymentMethod: "QRIS",
    notes: "Catatan penting belanja",
    itemDetails: [
      { description: "Kabel LAN Cat6", quantity: 2, unit: "roll", unitPrice: 250_000 },
    ],
  });
  assert.equal(expense.notes, "Catatan penting belanja");
  assert.equal(expense.paymentMethod, "QRIS");

  // Regression: expenseSchema defaults notes to "", itemDetails to [], and
  // paymentMethod to "Tunai" — an unrelated edit used to wipe all three.
  const updatedExpense = await patch(`/api/project-expenses/${expense.id}`, {
    merchant: "Toko Kabel Uji Baru",
  });
  assert.equal(updatedExpense.merchant, "Toko Kabel Uji Baru");
  assert.equal(updatedExpense.notes, "Catatan penting belanja", "edit keeps the notes");
  assert.equal(updatedExpense.paymentMethod, "QRIS", "edit keeps the payment method");
  assert.equal(updatedExpense.itemDetails.length, 1, "edit keeps the item details");
  assert.equal(updatedExpense.itemDetails[0].description, "Kabel LAN Cat6");
});

test("vendor categories: renaming must not reset the English name or sort order", async () => {
  const category = await post("/api/vendor-categories", {
    name: "Kategori Vendor Uji",
    nameEn: "Patch Test Vendor Category",
    vendorType: "Supplier",
    status: "Aktif",
    sortOrder: 4,
  });

  // Regression: vendorCategorySchema defaults nameEn to "" and sortOrder to 0.
  const updated = await patch(`/api/vendor-categories/${category.id}`, {
    name: "Kategori Vendor Uji Baru",
  });
  assert.equal(updated.name, "Kategori Vendor Uji Baru");
  assert.equal(updated.nameEn, "Patch Test Vendor Category", "rename keeps the English name");
  assert.equal(updated.sortOrder, 4, "rename keeps the sort order");
  assert.equal(updated.status, "Aktif", "rename keeps the status");
});

test("profit shares: adjusting the percentage must not clear the notes", async () => {
  const project = await post("/api/projects", {
    name: "Proyek Uji Patch Bagi Hasil",
    client: "Klien Uji Patch",
    location: "Gianyar",
    status: "Aktif",
    value: 0,
  });
  const allocation = await post("/api/profit-shares", {
    projectId: project.id,
    recipientName: "Mitra Uji Patch",
    percentage: 10,
    notes: "Catatan bagi hasil uji",
  });
  assert.equal(allocation.notes, "Catatan bagi hasil uji");

  // Regression: allocationSchema defaults notes to "" — a percentage change
  // used to erase the note.
  const updated = await patch(`/api/profit-shares/${allocation.id}`, { percentage: 12.5 });
  assert.equal(updated.percentage, 12.5);
  assert.equal(updated.notes, "Catatan bagi hasil uji", "percentage change keeps the notes");
  assert.equal(updated.recipientName, "Mitra Uji Patch", "percentage change keeps the recipient");
});
