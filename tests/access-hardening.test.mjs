// The access boundaries the owner decided to tighten, plus the export, upload
// and throttling findings that ride along with them.
//
//   * Project Expenses is its own access module instead of an OR over
//     `projects` and `finance`, and the bulk export additionally asks for
//     Pembukuan — an Engineer records receipts but does not download the sheet
//     carrying the company account and everyone's reimbursement payable;
//   * `project-expenses` and `tax` are registered in `resourceModules`, so the
//     generic dispatch gate finally runs for them;
//   * margin (base net profit, retained profit, BoQ budget versus commitment)
//     is split out of `finance: view` into its own module;
//   * permissions saved before those modules existed are backfilled from what
//     the account could already reach, never from the role default;
//   * the catalog XLSX export neutralises formulas — the last of four exports,
//     and the only one that round-trips through an upload;
//   * `CF-Connecting-IP` no longer buys a fresh login throttle bucket;
//   * a portfolio upload's declared type is checked against its actual bytes.
//
// The one finding that needs a production-mode process — internal error text
// escaping through `errorResponse` — lives in tests/production-error-leak.test.mjs,
// because two `next dev` servers cannot share this working directory.
//
// Every test here fails on the commit before the fix.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import {
  accessModules,
  defaultPermissions,
  moduleLabels,
} from "../shared/access.ts";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let database;
let cookie = "";

// Fixtures created once and reused by the matrix tests.
const context = {
  projectId: null,
  quotationId: null,
  users: {},
};

const ADMIN = { email: "admin@perumnet.id", password: "perumnet123" };

const ROLE_ACCOUNTS = {
  manager: {
    name: "Manajer Akses Regresi",
    email: "akses.pm@perumnet.id",
    password: "Akses-Manajer-2026",
    role: "Project Manager",
  },
  engineer: {
    name: "Engineer Akses Regresi",
    email: "akses.engineer@perumnet.id",
    password: "Akses-Engineer-2026",
    role: "Engineer",
  },
  finance: {
    name: "Finance Akses Regresi",
    email: "akses.finance@perumnet.id",
    password: "Akses-Finance-2026",
    role: "Finance",
  },
};

// 1x1 PNG. Used both as a genuine upload and, with a lying content type, as the
// mismatch case.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie && options.anonymous !== true) headers.set("Cookie", cookie);
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
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
    `${path} -> ${response.status}: ${JSON.stringify(payload?.error ?? payload)}`,
  );
  return payload?.data;
}

async function login(email, password) {
  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  return await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, remember: false }),
  });
}

const loginAsAdmin = () => login(ADMIN.email, ADMIN.password);

/** Status code only, so a refusal never explodes the helper. */
async function statusOf(path) {
  return (await request(path)).status;
}

async function errorOf(path) {
  const response = await request(path);
  const payload = await response.json().catch(() => null);
  return { status: response.status, code: payload?.error?.code, message: payload?.error?.message };
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-access-hardening-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-access-hardening-uploads-${process.pid}-${Date.now()}`;
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
  database = createClient({ url: `file:${databasePath}` });

  await loginAsAdmin();

  const project = await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Proyek Batas Akses",
        client: "Klien Akses",
        location: "Denpasar",
        status: "Aktif",
        value: 0,
      }),
    },
    201,
  );
  context.projectId = project.id;

  // Cash on the project, so the profit block in the financial report is not
  // filtered away as an all-zero row. Without it the margin assertions would
  // pass for the wrong reason.
  await json(
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        type: "Pemasukan",
        description: "Uang muka klien untuk pengujian batas akses",
        amount: 25_000_000,
        source: "Setoran klien",
        category: "Penjualan",
      }),
    },
    201,
  );

  // One BoQ item and one receipt, so both exports have rows to hide or show.
  await json(
    `/api/boq/items?projectId=${project.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Jasa",
        description: "Instalasi batas akses",
        quantity: 1,
        unit: "paket",
        costPrice: 4_000_000,
        sellingPrice: 9_000_000,
      }),
    },
    201,
  );
  // A GET only returns a synthetic draft with a null id until the quotation is
  // actually materialised, and the tax endpoints need a real document.
  const quotation = await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent" }),
  });
  context.quotationId = quotation.id;

  const categories = await json("/api/project-expense-categories");
  await json(
    "/api/project-expenses",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        purchaseDate: new Date().toISOString().slice(0, 10),
        merchant: "Toko Batas Akses",
        categoryId: categories[0].id,
        totalAmount: 750_000,
        fundingSource: "CompanyAccount",
        paymentMethod: "Tunai",
      }),
    },
    201,
  );

  for (const [key, account] of Object.entries(ROLE_ACCOUNTS)) {
    const created = await json(
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          name: account.name,
          email: account.email,
          password: account.password,
          role: account.role,
          status: "Aktif",
        }),
      },
      201,
    );
    context.users[key] = created;
  }
  await json(`/api/projects/${project.id}/access`, {
    method: "PUT",
    body: JSON.stringify({
      userIds: [context.users.manager.id, context.users.engineer.id],
    }),
  });
}, { timeout: 60_000 });

after(async () => {
  if (database) database.close();
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

// ---------------------------------------------------------------------------
// 1a. Project Expenses is its own module, and its export is a finance artefact.
// ---------------------------------------------------------------------------

test("the four roles get the documented answer on Project Expenses and its export", async () => {
  const matrix = [];

  await loginAsAdmin();
  matrix.push(["Admin", await statusOf("/api/project-expenses"), await statusOf("/api/project-expenses/report.csv")]);

  for (const key of ["manager", "engineer", "finance"]) {
    const account = ROLE_ACCOUNTS[key];
    await login(account.email, account.password);
    matrix.push([
      account.role,
      await statusOf("/api/project-expenses"),
      await statusOf("/api/project-expenses/report.csv"),
    ]);
  }

  assert.deepEqual(matrix, [
    // role, list the menu, download the report
    ["Admin", 200, 200],
    ["Project Manager", 200, 200],
    // The Engineer records receipts all day and is refused only the sheet that
    // aggregates every project with the paying account and the reimbursement
    // creditor on it.
    ["Engineer", 200, 403],
    ["Finance", 200, 200],
  ]);
});

test("the Engineer's refusal on the expense export explains itself in Indonesian", async () => {
  const account = ROLE_ACCOUNTS.engineer;
  await login(account.email, account.password);
  for (const format of ["csv", "pdf"]) {
    const failure = await errorOf(`/api/project-expenses/report.${format}`);
    assert.equal(failure.status, 403, `report.${format} must be refused`);
    assert.equal(failure.code, "EXPENSE_REPORT_FORBIDDEN");
    assert.match(failure.message, /Pembukuan/);
    assert.match(failure.message, /Lihat/);
  }
});

test("Belanja Proyek can be revoked without touching Manajemen Proyek", async () => {
  const engineer = context.users.engineer;
  await loginAsAdmin();
  await json(`/api/users/${engineer.id}`, {
    method: "PATCH",
    body: JSON.stringify({ permissions: { ...engineer.permissions, expenses: "none" } }),
  });

  const account = ROLE_ACCOUNTS.engineer;
  const session = await login(account.email, account.password);
  assert.equal(session.user.permissions.expenses, "none", "the new module has to persist");
  assert.equal(
    session.user.permissions.projects,
    "manage",
    "revoking expenses must not disturb project management",
  );
  assert.equal(await statusOf("/api/project-expenses"), 403);
  assert.equal(await statusOf("/api/projects"), 200, "the Engineer keeps their projects");

  await loginAsAdmin();
  await json(`/api/users/${engineer.id}`, {
    method: "PATCH",
    body: JSON.stringify({ permissions: { ...engineer.permissions, expenses: "manage" } }),
  });
});

test("the tax endpoints run through the module gate instead of no gate at all", async () => {
  const documentPath = `/api/tax/documents/Quotation/${context.quotationId}`;
  const matrix = [];

  await loginAsAdmin();
  matrix.push(["Admin", await statusOf(documentPath)]);
  for (const key of ["manager", "engineer", "finance"]) {
    const account = ROLE_ACCOUNTS[key];
    await login(account.email, account.password);
    matrix.push([account.role, await statusOf(documentPath)]);
  }

  assert.deepEqual(matrix, [
    ["Admin", 200],
    ["Project Manager", 200],
    // A project member with no Pembukuan permission used to read the tax
    // position of any document in that project: `tax` was missing from
    // resourceModules, and this handler has no check of its own on GET.
    ["Engineer", 403],
    ["Finance", 200],
  ]);
});

// ---------------------------------------------------------------------------
// 1b. Margin is no longer implied by `finance: view`.
// ---------------------------------------------------------------------------

const MARGIN_HEADINGS = [
  "DISTRIBUSI LABA PROYEK",
  "Laba Bersih Dasar",
  "Laba Ditahan",
  "Budget BoQ",
  "KOMITMEN VENDOR",
];

async function financialReportCsv() {
  const response = await request("/api/transactions/report.csv");
  assert.equal(response.status, 200);
  return await response.text();
}

test("Admin and Finance still see the margin blocks in the financial report", async () => {
  for (const account of [ADMIN, ROLE_ACCOUNTS.finance]) {
    await login(account.email, account.password);
    const csv = await financialReportCsv();
    for (const heading of MARGIN_HEADINGS) {
      assert.ok(
        csv.includes(heading),
        `${account.email} must still see "${heading}"`,
      );
    }
  }
});

test("a Project Manager keeps the cash ledger and loses the margin on their own jobs", async () => {
  const account = ROLE_ACCOUNTS.manager;
  await login(account.email, account.password);
  const session = await login(account.email, account.password);
  assert.equal(session.user.permissions.finance, "view", "the ledger permission is unchanged");
  assert.equal(session.user.permissions.margin, "none", "margin is its own permission now");

  const csv = await financialReportCsv();
  // The ledger itself is still theirs: the report downloads and carries the
  // project's own cash. Only the profit blocks are absent.
  assert.match(csv, /Setoran klien/, "the cash ledger must still be in the export");
  for (const heading of MARGIN_HEADINGS) {
    assert.ok(
      !csv.includes(heading),
      `a Project Manager must not see "${heading}"`,
    );
  }

  const pdf = await request("/api/transactions/report.pdf");
  assert.equal(pdf.status, 200, "the PDF edition still downloads");
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
});

test("profit sharing follows the margin module across all four roles", async () => {
  const path = `/api/profit-shares?projectId=${context.projectId}`;
  const matrix = [];
  await loginAsAdmin();
  matrix.push(["Admin", await statusOf(path)]);
  for (const key of ["manager", "engineer", "finance"]) {
    const account = ROLE_ACCOUNTS[key];
    await login(account.email, account.password);
    matrix.push([account.role, await statusOf(path)]);
  }
  assert.deepEqual(matrix, [
    ["Admin", 200],
    ["Project Manager", 403],
    ["Engineer", 403],
    ["Finance", 200],
  ]);
});

// ---------------------------------------------------------------------------
// 1c. Migration: what happens to permissions stored before the split.
// ---------------------------------------------------------------------------

/** Writes a permissions row exactly as it was stored before the two new modules existed. */
async function storeLegacyPermissions(userId, permissions) {
  await database.execute({
    sql: `INSERT INTO user_permissions (user_id,permissions_json,updated_at) VALUES (?,?,?)
      ON CONFLICT (user_id) DO UPDATE SET permissions_json=excluded.permissions_json,
        updated_at=excluded.updated_at`,
    args: [userId, JSON.stringify(permissions), new Date().toISOString()],
  });
}

const LEGACY_MODULES = [
  "dashboard",
  "projects",
  "boq",
  "billing",
  "procurement",
  "bast",
  "finance",
  "users",
  "settings",
];

function legacyPermissions(overrides) {
  const stored = {};
  for (const legacyModule of LEGACY_MODULES) stored[legacyModule] = "view";
  return { ...stored, ...overrides };
}

test("a stored permission set with neither projects nor finance is not handed the new expense module", async () => {
  const account = ROLE_ACCOUNTS.engineer;
  await storeLegacyPermissions(
    context.users.engineer.id,
    legacyPermissions({ projects: "none", finance: "none" }),
  );
  const session = await login(account.email, account.password);
  // The role default for an Engineer is "manage". Taking it here would hand
  // back a menu an administrator deliberately closed, which is exactly the
  // silent grant the backfill exists to prevent.
  assert.equal(session.user.permissions.expenses, "none");
  assert.equal(await statusOf("/api/project-expenses"), 403);
});

test("a stored permission set that reached expenses through finance keeps reaching them", async () => {
  const account = ROLE_ACCOUNTS.engineer;
  await storeLegacyPermissions(
    context.users.engineer.id,
    // The old rule was `projects OR finance`, so this account could open the
    // menu before the split and must still open it after.
    legacyPermissions({ projects: "none", finance: "view" }),
  );
  const session = await login(account.email, account.password);
  assert.equal(session.user.permissions.expenses, "view");
  assert.equal(await statusOf("/api/project-expenses"), 200);
});

test("a stored permission set that could manage expenses keeps managing them", async () => {
  const account = ROLE_ACCOUNTS.engineer;
  await storeLegacyPermissions(
    context.users.engineer.id,
    legacyPermissions({ projects: "manage", finance: "none" }),
  );
  const session = await login(account.email, account.password);
  assert.equal(session.user.permissions.expenses, "manage");
});

test("margin is withheld from a stored Project Manager set even when finance was raised to manage", async () => {
  const account = ROLE_ACCOUNTS.manager;
  await storeLegacyPermissions(
    context.users.manager.id,
    legacyPermissions({ finance: "manage" }),
  );
  const session = await login(account.email, account.password);
  assert.equal(session.user.permissions.finance, "manage");
  // Deliberate: splitting margin out of the finance permission is the point of
  // the change, so the new module takes the role default rather than inheriting
  // whatever `finance` happened to be.
  assert.equal(session.user.permissions.margin, "none");
});

test("an Admin keeps its permission floor on the modules added later", async () => {
  const admin = (await (async () => {
    await loginAsAdmin();
    return await json("/api/users");
  })()).find((entry) => entry.email === ADMIN.email);
  await storeLegacyPermissions(admin.id, legacyPermissions({ users: "none", finance: "none" }));
  const session = await loginAsAdmin();
  assert.equal(session.user.permissions.users, "manage");
  assert.equal(session.user.permissions.expenses, "manage");
  assert.equal(session.user.permissions.margin, "manage");
  // Put the row back the way the application would write it.
  await json(`/api/users/${admin.id}`, {
    method: "PATCH",
    body: JSON.stringify({ permissions: session.user.permissions }),
  });
});

// ---------------------------------------------------------------------------
// 2. Catalog XLSX export: formula injection.
// ---------------------------------------------------------------------------

test("the catalog XLSX export neutralises every formula-leading text cell", async () => {
  await loginAsAdmin();
  const category = await json(
    "/api/catalog/categories",
    {
      method: "POST",
      body: JSON.stringify({
        boqRole: "Perangkat",
        name: `=cmd|' /C calc'!A0`,
        nameEn: "@SUM(1+1)*cmd",
        defaultMargin1Percent: 20,
        defaultMargin2Percent: 30,
        status: "Aktif",
        sortOrder: 0,
      }),
    },
    201,
  );
  const brand = await json(
    "/api/catalog/brands",
    {
      method: "POST",
      body: JSON.stringify({
        categoryId: category.id,
        name: `+HYPERLINK("http://contoh.invalid","klik")`,
        status: "Aktif",
        sortOrder: 0,
      }),
    },
    201,
  );
  await json(
    "/api/catalog/items",
    {
      method: "POST",
      body: JSON.stringify({
        categoryId: category.id,
        brandId: brand.id,
        sku: "SKU-INJEKSI-1",
        name: `-2+3+cmd|' /C calc'!A0`,
        nameEn: "Injection probe",
        model: "\t=1+1",
        specifications: "=1+1",
        unit: "unit",
        costPrice: 1_000_000,
        margin1Percent: 20,
        margin2Percent: 30,
        status: "Aktif",
      }),
    },
    201,
  );

  const response = await request("/api/catalog/export.xlsx");
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.worksheets[0];

  const injected = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    for (const value of row.values.slice(1)) {
      if (typeof value !== "string") continue;
      if (/^[=+\-@\t\r]/.test(value)) injected.push(value);
    }
  });
  assert.deepEqual(
    injected,
    [],
    "no exported cell may open with a character a spreadsheet reads as a formula",
  );

  // And the escape really is the documented apostrophe, not a mangled value.
  const target = sheet.getRow(2).values.slice(1);
  assert.ok(
    target.some((value) => value === `'=cmd|' /C calc'!A0`),
    `the category name must survive as text: ${JSON.stringify(target)}`,
  );
  // Prices are numbers and must stay numbers, or every sum in the sheet breaks.
  assert.equal(typeof target[9], "number");
  assert.equal(target[9], 1_000_000);
});

// ---------------------------------------------------------------------------
// 4. Login throttle: a spoofed CF-Connecting-IP is not a new bucket.
// ---------------------------------------------------------------------------

test("rotating CF-Connecting-IP without CF-Ray no longer buys a fresh login bucket", async () => {
  const statuses = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The real hop. Constant, because it is the caller's actual address.
        "x-forwarded-for": "198.51.100.77",
        // The forged hop, different on every attempt and with no CF-Ray beside
        // it, so nothing here came through Cloudflare.
        "cf-connecting-ip": `203.0.113.${attempt + 1}`,
      },
      // A different address per attempt, so the identifier bucket never trips
      // and only the IP bucket can catch this.
      body: JSON.stringify({
        email: `spray.${attempt}@perumnet.id`,
        password: "salah-sekali-2026",
        remember: false,
      }),
    });
    statuses.push(response.status);
    if (response.status === 429) break;
  }
  assert.ok(
    statuses.includes(429),
    `a password spray from one host must be throttled; saw ${statuses.join(",")}`,
  );
});

test("a genuine Cloudflare hop is still trusted for the throttle bucket", async () => {
  // Same forged address as above, but this time with the CF-Ray that only
  // Cloudflare adds. It is a different bucket, so it is not already blocked.
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "198.51.100.77",
      "cf-connecting-ip": "203.0.113.240",
      "cf-ray": "8f2a1b3c4d5e6f70-CGK",
    },
    body: JSON.stringify({
      email: "cloudflare.probe@perumnet.id",
      password: "salah-sekali-2026",
      remember: false,
    }),
  });
  assert.equal(
    response.status,
    401,
    "a proxied request keeps its own bucket instead of inheriting the origin's block",
  );
});

// ---------------------------------------------------------------------------
// 5. Portfolio upload: declared type versus actual bytes.
// ---------------------------------------------------------------------------

async function postPortfolio(title, filename, declaredType, bytes) {
  const form = new FormData();
  form.set("title", title);
  form.set("description", "Dokumentasi pengujian unggahan portofolio.");
  form.set("location", "Denpasar");
  form.set("sortOrder", "0");
  form.set("isPublished", "true");
  form.set("image", new File([bytes], filename, { type: declaredType }));
  const response = await fetch(`${baseUrl}/api/cms/portfolios`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

test("a portfolio upload whose declared type contradicts its bytes is refused", async () => {
  await loginAsAdmin();
  const lying = await postPortfolio(
    "Portofolio Tipe Palsu",
    "berkas.jpg",
    "image/jpeg",
    TINY_PNG,
  );
  assert.equal(lying.status, 415, JSON.stringify(lying.payload));
  assert.equal(lying.payload.error.code, "IMAGE_TYPE_MISMATCH");
});

test("a portfolio upload that tells the truth about its bytes still works", async () => {
  await loginAsAdmin();
  const honest = await postPortfolio(
    "Portofolio Tipe Benar",
    "berkas.png",
    "image/png",
    TINY_PNG,
  );
  assert.equal(honest.status, 201, JSON.stringify(honest.payload));
  const media = await fetch(`${baseUrl}/api/cms/media/${honest.payload.data.id}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "image/png");
  assert.equal(media.headers.get("x-content-type-options"), "nosniff");
});

test("a portfolio upload of something that is not an image at all is refused", async () => {
  await loginAsAdmin();
  const notAnImage = await postPortfolio(
    "Portofolio Bukan Gambar",
    "berkas.png",
    "image/png",
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
  );
  assert.equal(notAnImage.status, 415, JSON.stringify(notAnImage.payload));
  assert.ok(
    ["INVALID_IMAGE", "IMAGE_TYPE_MISMATCH"].includes(notAnImage.payload.error.code),
    notAnImage.payload.error.code,
  );
});

// ---------------------------------------------------------------------------
// 6. The seeded commercial package title reaches the English UI translated.
// ---------------------------------------------------------------------------

test("the seeded package title is translated for an English session, not printed in Indonesian", async () => {
  await loginAsAdmin();
  await json("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ preferredLanguage: "en", emailNotifications: true }),
  });
  try {
    const draft = await json(`/api/quotations?projectId=${context.projectId}`);
    assert.equal(draft.packageTitle, "Main Scope");
  } finally {
    await json("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ preferredLanguage: "id", emailNotifications: true }),
    });
  }
  const indonesian = await json(`/api/quotations?projectId=${context.projectId}`);
  assert.equal(indonesian.packageTitle, "Lingkup Utama");
});

// ---------------------------------------------------------------------------
// 7. The internal edition of a vendor document is reachable from the UI.
// ---------------------------------------------------------------------------

test("the procurement screen offers the internal edition of a vendor document", () => {
  const source = readFileSync(
    new URL("../app/components/procurement-v2-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /pdf\?edition=internal/,
    "the internal copy has to be reachable from the order actions",
  );
  assert.match(source, /Cetak salinan internal/, "Indonesian label");
  assert.match(source, /Print internal copy/, "English label");
  assert.match(
    source,
    /-INTERNAL\.pdf/,
    "the download must not land next to the vendor file under the same name",
  );
  assert.match(
    source,
    /button internal small/,
    "it must not look like the button that prints the vendor's copy",
  );
});

// ---------------------------------------------------------------------------
// 8. The manual's role matrix has to keep matching the code it describes.
// ---------------------------------------------------------------------------

test("the operations manual's role matrix matches shared/access.ts cell for cell", () => {
  // `sop-pdf-content.ts` is marked `server-only`, so the table is read out of
  // the source rather than imported. The point of the test is that the two
  // never drift again: the matrix was correct for nine modules and silently
  // became wrong the moment an eleventh existed.
  const source = readFileSync(
    new URL("../server/api/sop-pdf-content.ts", import.meta.url),
    "utf8",
  );
  const opening = "const roleMatrix: Bilingual[][] = [";
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, "roleMatrix must still be a plain array literal");
  const end = source.indexOf("\n];", start);
  const literal = `[${source.slice(start + opening.length, end)}]`
    .replace(/,(\s*[\]}])/g, "$1");
  const matrix = JSON.parse(literal);

  const roles = ["Admin", "Project Manager", "Engineer", "Finance"];
  const levelLabel = { none: "Tidak ada", view: "Lihat", manage: "Kelola" };
  const levelLabelEn = { none: "No access", view: "View", manage: "Manage" };

  assert.equal(
    matrix.length,
    accessModules.length,
    "every access module needs a row in the manual",
  );

  const expected = accessModules.map((accessModule) => [
    accessModule,
    ...roles.map((role) => defaultPermissions(role)[accessModule]),
  ]);
  const documented = matrix.map((row, index) => {
    const accessModule = accessModules[index];
    const label = moduleLabels[accessModule];
    // Rows may carry a parenthetical ("BoQ Generator (termasuk Database
    // Item)"), but they must still name the module they stand for.
    assert.ok(
      row[0][0].startsWith(label.id) && row[0][1].startsWith(label.en),
      `row ${index} should describe ${accessModule}, found ${JSON.stringify(row[0])}`,
    );
    return [
      accessModule,
      ...row.slice(1).map(([indonesian, english], column) => {
        const level = Object.keys(levelLabel).find(
          (candidate) => levelLabel[candidate] === indonesian,
        );
        assert.ok(level, `unknown level "${indonesian}" in row ${index}`);
        assert.equal(
          english,
          levelLabelEn[level],
          `the two languages disagree in row ${index}, column ${column}`,
        );
        return level;
      }),
    ];
  });

  assert.deepEqual(documented, expected);
});
