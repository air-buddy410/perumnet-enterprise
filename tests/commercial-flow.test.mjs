// Contract tests for the BoQ -> Quotation -> Invoice commercial flow.
//
// Business formula (the law):
//   subtotal − discount = taxable base
//   taxable base + Add-effect taxes = before rounding
//   before rounding ± rounding = grand total billed to the client
//   Withhold-effect taxes reduce net cash only, never the bill.
//
// Every scenario drives the REAL API the same way the UI does and asserts the
// exact numbers, the stored-column path, the PDF, and the deletion lifecycle.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { PDFParse } from "pdf-parse";

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

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-commercial-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-commercial-uploads-${process.pid}-${Date.now()}`;
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10);

function isoInDays(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

let projectCounter = 0;
async function createProject(name) {
  projectCounter += 1;
  return await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: `${name} ${projectCounter}`,
        client: "Klien Uji Komersial",
        location: "Gianyar",
        status: "Aktif",
        value: 0,
      }),
    },
    201,
  );
}

async function addBoqItem(projectId, sellingPrice, quantity = 1, description = "Pekerjaan uji") {
  return await json(
    `/api/boq/items?projectId=${projectId}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Jasa",
        description: `${description} ${sellingPrice}`,
        quantity,
        unit: "paket",
        costPrice: Math.round(sellingPrice / 2),
        sellingPrice,
      }),
    },
    201,
  );
}

let cachedPpnRuleId = null;
async function activatePpn() {
  await json("/api/tax/settings", {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  if (!cachedPpnRuleId) {
    const rules = await json("/api/tax/rules");
    const ppn = rules.find((rule) => rule.code === "PPN");
    assert.ok(ppn, "seeded PPN rule exists");
    cachedPpnRuleId = ppn.id;
  }
  await json(`/api/tax/rules/${cachedPpnRuleId}`, {
    method: "PATCH",
    body: JSON.stringify({ rateBps: 1_100, status: "Active" }),
  });
  return cachedPpnRuleId;
}

async function getQuotation(projectId) {
  return await json(`/api/quotations?projectId=${projectId}`);
}

async function patchQuotation(projectId, body, expectedStatus = 200) {
  return await json(
    `/api/quotations?projectId=${projectId}`,
    { method: "PATCH", body: JSON.stringify(body) },
    expectedStatus,
  );
}

async function quotationHistory(projectId) {
  return await json(`/api/quotations/history?projectId=${projectId}`);
}

async function scopeQuotation(projectId, quotationId) {
  const scopes = await json(`/api/boq/scopes?projectId=${projectId}`);
  const scope = scopes.find((entry) => entry.quotation?.id === quotationId);
  assert.ok(scope, `scope detail carries quotation ${quotationId}`);
  return scope;
}

function acceptanceAttachment(label) {
  return {
    name: `${label}.png`,
    mimeType: "image/png",
    contentBase64: Buffer.from(`acceptance-${label}`).toString("base64"),
  };
}

async function acceptQuotation(quotationId, label = "persetujuan") {
  return await json(`/api/quotations/${quotationId}/accept`, {
    method: "POST",
    body: JSON.stringify({
      acceptedAt: TODAY,
      attachment: acceptanceAttachment(label),
    }),
  });
}

// The one formula every representation must satisfy.
function assertQuotationConsistent(quotation, label) {
  assert.equal(
    quotation.grandTotal,
    quotation.total - quotation.discountAmount + quotation.taxAdditions + quotation.roundingAdjustment,
    `${label}: grandTotal == subtotal − discount + taxAdditions ± rounding`,
  );
  assert.equal(quotation.taxableBase, quotation.total - quotation.discountAmount, `${label}: taxableBase`);
  assert.equal(quotation.grossTotal, quotation.grandTotal, `${label}: grossTotal mirrors grandTotal`);
  assert.equal(
    quotation.netCashDue,
    Math.max(0, quotation.grandTotal - quotation.taxWithholdings),
    `${label}: netCashDue`,
  );
}

// Assert both the API JSON and the persisted grand_total column (via scope
// detail, which reads the stored column) agree.
async function assertStoredGrandTotal(projectId, quotation, label) {
  const scope = await scopeQuotation(projectId, quotation.id);
  assert.equal(
    scope.quotation.grandTotal,
    quotation.grandTotal,
    `${label}: stored quotations.grand_total matches API JSON`,
  );
}

// ---------------------------------------------------------------------------
// Scenario A — canonical happy path with exact math
// ---------------------------------------------------------------------------

test("scenario A: discount, Add-effect tax, rounding, revision, acceptance, and invoice splits keep exact math", async () => {
  const ppnRuleId = await activatePpn();

  // Regression: renaming a tax rule must not silently reset the fields the
  // request omitted (Zod 4 .partial() still fires .default(), which used to
  // flip status back to Inactive and sort_order to 0).
  const renamedRule = await json(`/api/tax/rules/${ppnRuleId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "PPN Keluaran" }),
  });
  assert.equal(renamedRule.status, "Active", "rename keeps the rule active");
  assert.equal(renamedRule.rateBps, 1_100, "rename keeps the rate");

  const project = await createProject("Proyek Alur Komersial");
  await addBoqItem(project.id, 3_000_000, 2, "Instalasi jaringan");
  await addBoqItem(project.id, 4_000_000, 1, "Konfigurasi perangkat");

  // 1. Create the quotation from the BoQ.
  let quotation = await patchQuotation(project.id, {
    status: "Draft",
    issuedAt: TODAY,
    validUntil: isoInDays(30),
  });
  assert.equal(quotation.total, 10_000_000);
  assert.equal(quotation.subtotal, 10_000_000);
  assert.equal(quotation.grandTotal, 10_000_000);
  assertQuotationConsistent(quotation, "fresh quotation");

  // 2. Enable tax mode and attach PPN 11%.
  const taxMode = await json(`/api/quotations/${quotation.id}/tax-mode`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(taxMode.taxEnabled, true);
  const taxSummary = await json(`/api/quotations/${quotation.id}/taxes`, {
    method: "PUT",
    body: JSON.stringify({ ruleIds: [ppnRuleId] }),
  });
  assert.equal(taxSummary.taxAdditions, 1_100_000);
  quotation = await getQuotation(project.id);
  assert.equal(quotation.taxAdditions, 1_100_000);
  // Add-effect tax INCREASES the client bill.
  assert.equal(quotation.grandTotal, 11_100_000);
  assertQuotationConsistent(quotation, "PPN attached");

  // 3. Percent discount 10% (UI sends basis points: 10% == 1000 bps).
  quotation = await patchQuotation(project.id, {
    discountEnabled: true,
    discountType: "Percent",
    discountValue: 1_000,
  });
  assert.equal(quotation.discountAmount, 1_000_000);
  assert.equal(quotation.taxableBase, 9_000_000);
  // Tax must be recomputed on the discounted base, not the raw subtotal.
  assert.equal(quotation.taxAdditions, 990_000);
  assert.equal(quotation.grandTotal, 9_990_000);
  assertQuotationConsistent(quotation, "10% discount");
  await assertStoredGrandTotal(project.id, quotation, "10% discount");

  // 4. Rounding modes. beforeRounding = 9_990_000.
  quotation = await patchQuotation(project.id, { roundingMode: "Up", roundingStep: 10_000 });
  // Regression: a partial PATCH (only rounding fields) must never reset the
  // stored discount — Zod 4 .partial() used to re-apply every schema default.
  assert.equal(quotation.discountAmount, 1_000_000, "partial PATCH keeps the stored discount");
  assert.equal(quotation.taxAdditions, 990_000, "partial PATCH keeps the recomputed tax");
  assert.equal(quotation.roundingAdjustment, 0, "already a multiple of 10.000");
  assert.equal(quotation.grandTotal, 9_990_000);

  quotation = await patchQuotation(project.id, { roundingMode: "Up", roundingStep: 100_000 });
  assert.equal(quotation.roundingAdjustment, 10_000, "round up adds a positive adjustment");
  assert.equal(quotation.grandTotal, 10_000_000);
  assertQuotationConsistent(quotation, "round up 100k");
  await assertStoredGrandTotal(project.id, quotation, "round up 100k");

  quotation = await patchQuotation(project.id, { roundingMode: "Down", roundingStep: 100_000 });
  assert.equal(quotation.roundingAdjustment, -90_000, "round down subtracts");
  assert.equal(quotation.grandTotal, 9_900_000);
  assertQuotationConsistent(quotation, "round down 100k");

  // Custom without an explicit adjustment must start at 0, never inherit the
  // stale −90_000 delta from the Down mode.
  quotation = await patchQuotation(project.id, {
    roundingMode: "Custom",
    roundingReason: "Transisi ke pembulatan khusus.",
  });
  assert.equal(quotation.roundingAdjustment, 0);
  assert.equal(quotation.grandTotal, 9_990_000);

  quotation = await patchQuotation(project.id, {
    roundingMode: "Custom",
    roundingAdjustment: -40_000,
    roundingReason: "Negosiasi akhir dengan klien.",
  });
  assert.equal(quotation.roundingAdjustment, -40_000);
  assert.equal(quotation.grandTotal, 9_950_000);
  assertQuotationConsistent(quotation, "custom −40k");
  await assertStoredGrandTotal(project.id, quotation, "custom −40k");

  // 5. The UI's exact save payload includes roundingReason:null when the
  //    rounding mode needs no reason. This used to 422 (VALIDATION_ERROR:
  //    "Data yang dikirim belum valid") because the schema rejected null.
  quotation = await patchQuotation(project.id, {
    status: "Draft",
    issuedAt: TODAY,
    validUntil: isoInDays(30),
    discountEnabled: true,
    discountType: "Percent",
    discountValue: 1_000,
    roundingMode: "None",
    roundingStep: 0,
    roundingAdjustment: 0,
    roundingReason: null,
  });
  assert.equal(quotation.roundingAdjustment, 0);
  assert.equal(quotation.grandTotal, 9_990_000);
  assert.equal(quotation.roundingReason, null, "null clears the rounding reason");

  // Restore the negotiated rounding for the rest of the scenario.
  quotation = await patchQuotation(project.id, {
    roundingMode: "Custom",
    roundingAdjustment: -40_000,
    roundingReason: "Negosiasi akhir dengan klien.",
  });
  assert.equal(quotation.grandTotal, 9_950_000);

  // 6. Send. The UI's "Mark as sent" sends ONLY {status:"Sent"} — it must not
  //    wipe the discount/rounding config, and taxes lock with the snapshot.
  quotation = await patchQuotation(project.id, { status: "Sent" });
  assert.equal(quotation.status, "Sent");
  assert.equal(quotation.discountAmount, 1_000_000, "sending keeps the discount");
  assert.equal(quotation.roundingAdjustment, -40_000, "sending keeps the rounding");
  assert.equal(quotation.grandTotal, 9_950_000);
  assert.ok(quotation.taxes.length === 1 && quotation.taxes[0].locked, "sent quotation locks its taxes");

  // 7. Editing a Sent quotation creates revision R2 which must carry the
  //    discount/tax/rounding config AND correctly recomputed totals.
  const revision = await patchQuotation(project.id, { validUntil: isoInDays(60) });
  assert.notEqual(revision.id, quotation.id);
  assert.equal(revision.revisionNo, 2);
  assert.match(revision.number, /-R2$/);
  assert.equal(revision.status, "Draft");
  assert.equal(revision.discountAmount, 1_000_000);
  assert.equal(revision.taxableBase, 9_000_000);
  assert.equal(revision.taxAdditions, 990_000, "revision recomputes copied tax amounts");
  assert.equal(revision.roundingAdjustment, -40_000);
  assert.equal(revision.grandTotal, 9_950_000, "revision grand total equals the original");
  assert.equal(revision.taxes.length, 1);
  assert.equal(revision.taxes[0].amount, 990_000);
  assert.equal(revision.taxes[0].locked, false, "revision taxes start unlocked");
  assertQuotationConsistent(revision, "revision R2");
  await assertStoredGrandTotal(project.id, revision, "revision R2");

  const history = await quotationHistory(project.id);
  assert.equal(history.length, 2);
  const r1 = history.find((row) => row.id === quotation.id);
  const r2 = history.find((row) => row.id === revision.id);
  assert.equal(r1.status, "Superseded");
  assert.equal(r2.status, "Draft");
  assert.equal(r2.grandTotal, 9_950_000);
  assert.equal(r2.supersedesId, quotation.id);

  // 8. Send + accept R2. Project value must equal the grand total.
  await patchQuotation(project.id, { status: "Sent" });
  const acceptedScope = await acceptQuotation(revision.id, "alur-komersial");
  assert.equal(acceptedScope.quotation.status, "Accepted");
  const acceptedQuotation = await getQuotation(project.id);
  assert.equal(acceptedQuotation.status, "Accepted");
  assert.equal(acceptedQuotation.grandTotal, 9_950_000);
  assert.ok(acceptedQuotation.taxes[0].locked, "accepted quotation locks taxes");
  const projectAfterAccept = await json(`/api/projects/${project.id}`);
  assert.equal(projectAfterAccept.value, 9_950_000, "project value equals the accepted grand total");

  // 9. Invoices 30% + 70%: proportional allocation, tax inheritance, and the
  //    final invoice absorbing every residual so the sum is EXACT.
  const invoice30 = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        quotationId: revision.id,
        type: "DP 30%",
        issueDate: TODAY,
        dueDate: isoInDays(14),
        calculationMode: "Percent",
        installmentPercent: 30,
      }),
    },
    201,
  );
  assert.equal(invoice30.amount, 2_985_000, "30% of 9_950_000");
  assert.equal(invoice30.contractGrandTotal, 9_950_000);
  assert.equal(invoice30.subtotalSnapshot, 3_000_000);
  assert.equal(invoice30.discountSnapshot, 300_000);
  assert.equal(invoice30.taxableBaseSnapshot, 2_700_000);
  assert.equal(invoice30.taxAdditionsSnapshot, 297_000);
  assert.equal(invoice30.taxAdditions, 297_000, "invoice inherits allocated PPN");
  assert.equal(invoice30.taxes.length, 1);
  assert.equal(invoice30.grossTotal, 2_985_000);
  assert.equal(
    invoice30.roundingSnapshot,
    invoice30.amount - invoice30.taxableBaseSnapshot - invoice30.taxAdditionsSnapshot,
  );

  const invoice70 = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        quotationId: revision.id,
        type: "Pelunasan",
        issueDate: TODAY,
        dueDate: isoInDays(30),
        calculationMode: "Percent",
        installmentPercent: 70,
      }),
    },
    201,
  );
  assert.equal(invoice70.amount, 6_965_000, "final invoice absorbs the residual");
  assert.equal(invoice70.taxableBaseSnapshot, 6_300_000);
  assert.equal(invoice70.taxAdditionsSnapshot, 693_000);
  assert.equal(invoice70.taxAdditions, 693_000);
  assert.equal(
    invoice30.amount + invoice70.amount,
    9_950_000,
    "sum of invoices equals the quotation grand total EXACTLY",
  );
  assert.equal(
    invoice30.taxAdditionsSnapshot + invoice70.taxAdditionsSnapshot,
    990_000,
    "allocated tax sums exactly to the quotation tax",
  );
  assert.equal(
    invoice30.roundingSnapshot + invoice70.roundingSnapshot,
    -40_000,
    "allocated rounding sums exactly to the quotation rounding",
  );

  // 10. Editing invoice metadata (type/dueDate) must work while the invoice
  //     has no payments and no committed tax, and must NOT change or
  //     duplicate the allocation.
  const editedInvoice30 = await json(`/api/invoices/${invoice30.id}`, {
    method: "PATCH",
    body: JSON.stringify({ type: "DP 30% Revisi", dueDate: isoInDays(21) }),
  });
  assert.equal(editedInvoice30.type, "DP 30% Revisi");
  assert.equal(editedInvoice30.amount, 2_985_000, "allocation unchanged after metadata edit");
  assert.equal(editedInvoice30.taxableBaseSnapshot, 2_700_000);
  assert.equal(editedInvoice30.taxAdditionsSnapshot, 297_000);
  assert.equal(editedInvoice30.taxAdditions, 297_000, "tax rows are not duplicated by the edit");
  assert.equal(editedInvoice30.taxes.length, 1);
  assert.equal(editedInvoice30.grossTotal, 2_985_000);

  // 11. Delete + recreate the 70% invoice: the recreated allocation must be
  //     identical.
  await json(`/api/invoices/${invoice70.id}`, { method: "DELETE" }, 204);
  const recreated70 = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        quotationId: revision.id,
        type: "Pelunasan",
        issueDate: TODAY,
        dueDate: isoInDays(30),
        calculationMode: "Percent",
        installmentPercent: 70,
      }),
    },
    201,
  );
  assert.equal(recreated70.amount, 6_965_000);
  assert.equal(recreated70.taxableBaseSnapshot, 6_300_000);
  assert.equal(recreated70.taxAdditionsSnapshot, 693_000);
  assert.equal(recreated70.roundingSnapshot, invoice70.roundingSnapshot);

  // 12. Scenario C — cross-representation sweep for the accepted document:
  //     API JSON, stored columns, and the rendered PDF must agree, and the
  //     PDF grand total must INCLUDE the Add-effect tax.
  const pdfResponse = await request(`/api/quotations/${revision.id}/pdf`);
  assert.equal(pdfResponse.status, 200);
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 4).toString(), "%PDF");
  const parser = new PDFParse({ data: new Uint8Array(pdfBytes) });
  try {
    const parsed = await parser.getText();
    const normalized = parsed.text.replace(/ /g, " ");
    assert.match(normalized, /Rp\s?9\.950\.000/, "PDF shows the tax-inclusive grand total");
    assert.match(normalized, /Rp\s?990\.000/, "PDF itemizes the PPN addition");
    assert.match(normalized, /Rp\s?1\.000\.000/, "PDF itemizes the discount");
  } finally {
    await parser.destroy();
  }
});

// ---------------------------------------------------------------------------
// Scenario B — quotation deletion in every state
// ---------------------------------------------------------------------------

// Reload exactly like the UI does after deleteQuotation() bumps reloadKey.
async function uiReloadAfterDelete(projectId) {
  const [invoices, boq, quotation, project, history] = await Promise.all([
    json(`/api/invoices?projectId=${projectId}`),
    json(`/api/boq?projectId=${projectId}`),
    json(`/api/quotations?projectId=${projectId}`),
    json(`/api/projects/${projectId}`),
    json(`/api/quotations/history?projectId=${projectId}`),
  ]);
  return { invoices, boq, quotation, project, history };
}

function assertCreatableNullShape(quotation, subtotal) {
  assert.equal(quotation.id, null);
  assert.equal(quotation.status, "Draft");
  assert.equal(quotation.total, subtotal);
  assert.equal(quotation.discountEnabled, false);
  assert.equal(quotation.discountAmount, 0);
  assert.equal(quotation.roundingMode, "None");
  assert.equal(quotation.roundingAdjustment, 0);
  assert.equal(quotation.grandTotal, subtotal);
}

test("scenario B1: delete a plain Draft quotation, reload like the UI, recreate", async () => {
  const project = await createProject("Proyek Hapus Draft");
  await addBoqItem(project.id, 1_000_000);
  const quotation = await patchQuotation(project.id, { status: "Draft" });
  assert.ok(quotation.id);

  await json(`/api/quotations?projectId=${project.id}`, { method: "DELETE" }, 204);
  const reloaded = await uiReloadAfterDelete(project.id);
  assertCreatableNullShape(reloaded.quotation, 1_000_000);
  assert.equal(reloaded.history.length, 0);

  // The UI save payload (roundingReason:null included) must recreate cleanly.
  const recreated = await patchQuotation(project.id, {
    status: "Draft",
    issuedAt: TODAY,
    validUntil: isoInDays(14),
    discountEnabled: false,
    discountType: "Nominal",
    discountValue: 0,
    roundingMode: "None",
    roundingStep: 0,
    roundingAdjustment: 0,
    roundingReason: null,
  });
  assert.ok(recreated.id);
  assert.equal(recreated.revisionNo, 1);
  assert.equal(recreated.grandTotal, 1_000_000);

  // Regression (same Zod 4 .partial() class): renaming a commercial package
  // must not reset its status or sort order to the schema defaults.
  const extraPackage = await json(
    `/api/projects/${project.id}/packages`,
    { method: "POST", body: JSON.stringify({ title: "Paket Tambahan" }) },
    201,
  );
  await json(`/api/projects/${project.id}/packages/${extraPackage.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Active" }),
  });
  const renamedPackage = await json(`/api/projects/${project.id}/packages/${extraPackage.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Paket Tambahan Baru" }),
  });
  assert.equal(renamedPackage.title, "Paket Tambahan Baru");
  assert.equal(renamedPackage.status, "Active", "rename keeps the package status");
});

test("scenario B2: delete a Draft quotation with attached taxes", async () => {
  const ppnRuleId = await activatePpn();
  const project = await createProject("Proyek Hapus Draft Pajak");
  await addBoqItem(project.id, 2_000_000);
  const quotation = await patchQuotation(project.id, { status: "Draft" });
  await json(`/api/quotations/${quotation.id}/tax-mode`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  await json(`/api/quotations/${quotation.id}/taxes`, {
    method: "PUT",
    body: JSON.stringify({ ruleIds: [ppnRuleId] }),
  });
  assert.equal((await getQuotation(project.id)).taxAdditions, 220_000);

  await json(`/api/quotations?projectId=${project.id}`, { method: "DELETE" }, 204);
  const reloaded = await uiReloadAfterDelete(project.id);
  assertCreatableNullShape(reloaded.quotation, 2_000_000);
  assert.equal(reloaded.quotation.taxEnabled, false);
  assert.deepEqual(reloaded.quotation.taxes, []);

  const recreated = await patchQuotation(project.id, { status: "Draft" });
  assert.ok(recreated.id);
  assert.equal(recreated.taxEnabled, false, "deleted tax config does not leak into the new quotation");
  assert.deepEqual(recreated.taxes, []);
});

test("scenario B3: delete a Sent quotation and reset the scope state", async () => {
  const project = await createProject("Proyek Hapus Sent");
  await addBoqItem(project.id, 3_000_000);
  const quotation = await patchQuotation(project.id, { status: "Draft" });
  await patchQuotation(project.id, { status: "Sent" });

  await json(`/api/quotations?projectId=${project.id}`, { method: "DELETE" }, 204);
  const reloaded = await uiReloadAfterDelete(project.id);
  assertCreatableNullShape(reloaded.quotation, 3_000_000);

  const scopes = await json(`/api/boq/scopes?projectId=${project.id}`);
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].status, "Draft", "scope status resets after the quotation is deleted");
  assert.equal(scopes[0].quotation, null);

  const recreated = await patchQuotation(project.id, { status: "Draft" });
  assert.ok(recreated.id);
  assert.notEqual(recreated.id, quotation.id);
  assert.equal(recreated.status, "Draft");
});

test("scenario B4: deleting the active revision promotes the previous revision instead of 500", async () => {
  const ppnRuleId = await activatePpn();
  const project = await createProject("Proyek Hapus Revisi");
  await addBoqItem(project.id, 5_000_000);
  const original = await patchQuotation(project.id, {
    status: "Draft",
    issuedAt: TODAY,
    validUntil: isoInDays(30),
  });
  await json(`/api/quotations/${original.id}/tax-mode`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  await json(`/api/quotations/${original.id}/taxes`, {
    method: "PUT",
    body: JSON.stringify({ ruleIds: [ppnRuleId] }),
  });
  await patchQuotation(project.id, { status: "Sent" });

  // Revise while Sent -> R2 exists, R1 is Superseded (with locked taxes).
  const revision = await patchQuotation(project.id, { validUntil: isoInDays(45) });
  assert.equal(revision.revisionNo, 2);
  // Send R2 so its taxes lock too — the hardest deletion case.
  await patchQuotation(project.id, { status: "Sent" });

  // Delete the active R2.
  await json(`/api/quotations?projectId=${project.id}`, { method: "DELETE" }, 204);

  // R1 must be promoted back to the active document as an editable Draft.
  const reloaded = await uiReloadAfterDelete(project.id);
  assert.equal(reloaded.quotation.id, original.id, "R1 becomes the active quotation again");
  assert.equal(reloaded.quotation.status, "Draft");
  assert.equal(reloaded.quotation.revisionNo, 1);
  assert.equal(reloaded.quotation.acceptedAt, null);
  assert.equal(reloaded.quotation.taxAdditions, 550_000, "promoted revision recomputes its taxes");
  assert.equal(reloaded.quotation.grandTotal, 5_550_000);
  assert.ok(
    reloaded.quotation.taxes.every((tax) => !tax.locked),
    "promoted revision unlocks its taxes so it is editable again",
  );
  assert.equal(reloaded.history.length, 1, "history keeps the promoted revision");
  assert.equal(reloaded.history[0].id, original.id);
  assert.equal(reloaded.history[0].status, "Draft");

  const scopes = await json(`/api/boq/scopes?projectId=${project.id}`);
  assert.equal(scopes[0].status, "Draft");

  // PATCHing the promoted revision must work — this used to 500 with a
  // UNIQUE(scope_id,revision_no) collision when a new row was inserted next
  // to the orphaned Superseded revision.
  const edited = await patchQuotation(project.id, {
    discountEnabled: true,
    discountType: "Percent",
    discountValue: 1_000,
  });
  assert.equal(edited.id, original.id, "edit updates the promoted revision in place");
  assert.equal(edited.discountAmount, 500_000);
  assert.equal(edited.taxAdditions, 495_000);
  assert.equal(edited.grandTotal, 4_995_000);
  assertQuotationConsistent(edited, "promoted revision after edit");

  // The full cycle still works afterwards: send, revise, delete, promote.
  await patchQuotation(project.id, { status: "Sent" });
  const secondRevision = await patchQuotation(project.id, { validUntil: isoInDays(60) });
  assert.equal(secondRevision.revisionNo, 2);
  assert.match(secondRevision.number, /-R2$/);
  await json(`/api/quotations?projectId=${project.id}`, { method: "DELETE" }, 204);
  const promotedAgain = await getQuotation(project.id);
  assert.equal(promotedAgain.id, original.id);
  assert.equal(promotedAgain.status, "Draft");

  // Deleting the last remaining revision falls back to the creatable shape.
  await json(`/api/quotations?projectId=${project.id}`, { method: "DELETE" }, 204);
  const emptied = await uiReloadAfterDelete(project.id);
  assertCreatableNullShape(emptied.quotation, 5_000_000);
  assert.equal(emptied.history.length, 0);
  const recreated = await patchQuotation(project.id, { status: "Draft" });
  assert.ok(recreated.id);
  assert.equal(recreated.revisionNo, 1);
});

test("scenario B5: a quotation referenced by procurement documents cannot be deleted (friendly 409)", async () => {
  const project = await createProject("Proyek Procurement Guard");
  const boqItem = await addBoqItem(project.id, 4_000_000);
  await patchQuotation(project.id, { status: "Draft" });
  await patchQuotation(project.id, { status: "Sent" });
  const quotation = await getQuotation(project.id);
  await acceptQuotation(quotation.id, "procurement-guard");

  const vendor = await json(
    "/api/vendors",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Vendor Guard Komersial",
        category: "Teknisi Jaringan",
        contact: "081234500001",
        rate: 0,
        status: "Aktif",
      }),
    },
    201,
  );
  const order = await json(
    "/api/procurement-orders",
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "SPK",
        vendorId: vendor.id,
        projectId: project.id,
        quotationId: quotation.id,
        items: [{ boqItemId: boqItem.id, quantity: 1, agreedUnitCost: 2_000_000 }],
        terms: [{ label: "Penuh", type: "Final", percentage: 100 }],
      }),
    },
    201,
  );

  // Accepted quotations refuse deletion outright.
  const acceptedDelete = await request(`/api/quotations?projectId=${project.id}`, { method: "DELETE" });
  assert.equal(acceptedDelete.status, 409);
  assert.equal((await acceptedDelete.json()).error.code, "ACCEPTED_QUOTATION_LOCKED");

  // Void the SPK, then void the quotation — the quotation becomes deletable by
  // status, but the (voided) SPK still references it. Deleting would orphan the
  // procurement record, so the API must refuse with a clear 409 — never a raw
  // constraint 500 and never a silent dangling reference.
  await json(`/api/procurement-orders/${order.id}/void`, {
    method: "POST",
    body: JSON.stringify({ reason: "Uji guard penghapusan quotation." }),
  });
  await json(`/api/quotations/${quotation.id}/void`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const guardedDelete = await request(`/api/quotations?projectId=${project.id}`, { method: "DELETE" });
  assert.equal(guardedDelete.status, 409, "deletion with procurement references is a friendly 409");
  const guardedPayload = await guardedDelete.json();
  assert.equal(guardedPayload.error.code, "QUOTATION_IN_USE_PROCUREMENT");
  assert.ok(guardedPayload.error.message.length > 10);
});

test("scenario B6: quotation with invoices refuses deletion, and deletion never surfaces 500", async () => {
  const project = await createProject("Proyek Hapus Dengan Invoice");
  await addBoqItem(project.id, 6_000_000);
  await patchQuotation(project.id, { status: "Draft" });
  await patchQuotation(project.id, { status: "Sent" });
  const quotation = await getQuotation(project.id);
  await acceptQuotation(quotation.id, "hapus-dengan-invoice");
  await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        quotationId: quotation.id,
        type: "DP 50%",
        issueDate: TODAY,
        dueDate: isoInDays(14),
        calculationMode: "Percent",
        installmentPercent: 50,
      }),
    },
    201,
  );
  const blocked = await request(`/api/quotations?projectId=${project.id}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "ACCEPTED_QUOTATION_LOCKED");

  // Deleting a quotation that does not exist stays a friendly 404.
  const emptyProject = await createProject("Proyek Tanpa Quotation");
  await addBoqItem(emptyProject.id, 1_000_000);
  const missing = await request(`/api/quotations?projectId=${emptyProject.id}`, { method: "DELETE" });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "NOT_FOUND");
});
