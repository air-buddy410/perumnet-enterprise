// Regression tests for what the generated documents actually SAY.
//
// A PDF that answers 200 is not a PDF that is correct: every assertion here
// extracts the rendered text and checks the strings and the numbers a human
// reads off the page. The defects covered were all reproduced first against
// HEAD and each assertion below fails on the unfixed file.
//
//   1. The vendor's SPK/PO printed PerumNet's internal budget next to the
//      vendor's own price, on the document the contractor signs.
//   2. The cash-flow report contradicted itself: metric cards excluded the
//      unreconciled bank imports, the monthly and per-project tables did not.
//   3. The English editions printed Indonesian ("Lingkup Utama", "1 paket",
//      "Jasa").
//   4. The BAST verification page invented a handover time for a date-only
//      column.
//   5-7. The operations manual dated itself off the host clock, printed a bare
//      "Halaman N" with no total, and was laid out twice per request.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { PDFParse } from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
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
  databasePath = `/tmp/perumnet-documents-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-documents-uploads-${process.pid}-${Date.now()}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        // The suite must never reach Nominatim: it is a third-party service with a
        // one-request-per-second policy, and a test run creates dozens of projects.
        GEOCODING_ENABLED: "false",
        TURSO_DATABASE_URL: `file:${databasePath}`,
        APP_URL: baseUrl,
        UPLOAD_DIR: uploadDirectory,
        MAIL_BRANDING_MODE: "capture",
        // Production runs UTC. Every document is supposed to date itself in
        // Asia/Makassar regardless, so the server must not agree with the host
        // by accident.
        TZ: "UTC",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
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

// --------------------------------------------------------------- helpers ---

const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function attachment(label) {
  return {
    name: `${label}.png`,
    mimeType: "image/png",
    contentBase64: SIGNATURE.split(",")[1],
  };
}

async function loginAsAdmin(language = "id") {
  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  await json("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ preferredLanguage: language, emailNotifications: false }),
  });
}

async function createProject(name) {
  return await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        client: "Klien Dokumen",
        location: "Denpasar",
        status: "Aktif",
        value: 0,
      }),
    },
    201,
  );
}

async function addBoqItem(projectId, item) {
  return await json(
    `/api/boq/items?projectId=${projectId}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: item.category,
        description: item.description,
        quantity: 1,
        unit: "paket",
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
      }),
    },
    201,
  );
}

async function acceptQuotation(projectId, label) {
  const sent = await json(`/api/quotations?projectId=${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent" }),
  });
  const scope = await json(`/api/quotations/${sent.id}/accept`, {
    method: "POST",
    body: JSON.stringify({
      acceptedAt: "2026-08-01",
      attachment: attachment(label),
    }),
  });
  return { quotationId: sent.id, scope };
}

async function createVendor(name, vendorType) {
  return await json(
    "/api/vendors",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        vendorType,
        category: "Teknisi Jaringan",
        contact: "081200004444",
        rate: 0,
        status: "Aktif",
      }),
    },
    201,
  );
}

/** Downloads a PDF and returns its rendered text, per page and flattened. */
async function pdfText(path) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} -> ${response.status}`);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF", `${path} is a real PDF`);
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const info = await parser.getInfo();
    const parsed = await parser.getText({ first: info.total });
    const clean = (value) => value.replace(/ /g, " ");
    return {
      // Whitespace collapsed: a table cell is drawn as several lines, and an
      // assertion should not have to know where jsPDF wrapped it.
      flat: clean(parsed.text).replace(/\s+/g, " "),
      pages: parsed.pages.map((page) => clean(page.text)),
      total: info.total,
      disposition: response.headers.get("content-disposition") ?? "",
    };
  } finally {
    await parser.destroy();
  }
}

/** The date every PerumNet document is supposed to print, wherever it runs. */
function makassarToday(locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date());
}

// ------------------------------------------------------------------- (1) ---

test("the work order a vendor signs never prints PerumNet's internal budget", async () => {
  await loginAsAdmin();
  const project = await createProject("Proyek Anggaran Vendor");
  await addBoqItem(project.id, {
    category: "Jasa",
    description: "Instalasi jaringan gedung",
    // Deliberately unmistakable: this number may appear on the internal print
    // and nowhere else.
    costPrice: 1_234_567,
    sellingPrice: 4_000_000,
  });
  const accepted = await acceptQuotation(project.id, "anggaran-vendor");
  const item = accepted.scope.items.find((row) => row.category === "Jasa");
  const vendor = await createVendor("Vendor Anggaran", "Jasa");
  const order = await json(
    "/api/procurement-orders",
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "SPK",
        vendorId: vendor.id,
        projectId: project.id,
        quotationId: accepted.quotationId,
        items: [{ boqItemId: item.id, quantity: 1, agreedUnitCost: 3_000_000 }],
        terms: [{ label: "Pelunasan", type: "Final", percentage: 100 }],
      }),
    },
    201,
  );

  const vendorCopy = await pdfText(`/api/procurement-orders/${order.id}/pdf`);
  assert.match(vendorCopy.flat, /HARGA VENDOR/, "the agreed price is still printed");
  assert.match(vendorCopy.flat, /3\.000\.000/, "the agreed price is still printed");
  assert.doesNotMatch(
    vendorCopy.flat,
    /1\.234\.567/,
    "the vendor must not read PerumNet's budget for the line it is quoting",
  );
  assert.doesNotMatch(vendorCopy.flat, /BUDGET/, "no budget column header");
  assert.doesNotMatch(
    vendorCopy.flat,
    /Anggaran internal/,
    "no caption advertising the internal budget",
  );

  // An unrecognised edition is not a way in: only the exact opt-in switches.
  const spoofed = await pdfText(
    `/api/procurement-orders/${order.id}/pdf?edition=Internal%20please`,
  );
  assert.doesNotMatch(spoofed.flat, /1\.234\.567/);

  const internalCopy = await pdfText(
    `/api/procurement-orders/${order.id}/pdf?edition=internal`,
  );
  assert.match(internalCopy.flat, /BUDGET/, "the internal print still shows the budget");
  assert.match(internalCopy.flat, /1\.234\.567/);
  assert.match(internalCopy.flat, /Anggaran internal/);
  assert.match(
    internalCopy.flat,
    /Jangan dikirim/i,
    "the internal print says on its face that it is not the vendor copy",
  );
  assert.match(
    internalCopy.disposition,
    /-INTERNAL\.pdf/,
    "the internal print cannot be mistaken for the vendor copy by filename",
  );
});

// ------------------------------------------------------------------- (2) ---

test("the cash-flow report reports one net cash figure, and marks what it did not count", async () => {
  await loginAsAdmin();
  const project = await createProject("Proyek Arus Kas Impor");
  // Two identical inflows inside the settlement window, so the importer cannot
  // decide which one the mutasi belongs to and leaves it unreconciled.
  for (const date of ["2027-05-05", "2027-05-06"]) {
    await json(
      "/api/transactions",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          date,
          type: "Pemasukan",
          description: `Pelunasan klien ${date}`,
          amount: 9_150_000,
          source: "Manual",
          category: "Penjualan",
        }),
      },
      201,
    );
  }
  await json(
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        date: "2027-05-07",
        type: "Pengeluaran",
        description: "Belanja material lapangan",
        amount: 3_050_000,
        source: "Manual",
        category: "Operasional",
      }),
    },
    201,
  );
  const bankAccount = await json(
    "/api/bank-accounts",
    {
      method: "POST",
      body: JSON.stringify({
        bankName: "BRI Laporan",
        accountName: "PerumNet BRI Laporan",
        accountNumber: `${Date.now()}`.slice(-10),
        openingBalance: 77_777_777,
        syncMode: "Manual",
      }),
    },
    201,
  );
  const statement = new FormData();
  statement.set(
    "file",
    new File(
      [
        [
          "Tanggal,Keterangan,Mutasi,Saldo,Referensi",
          "05/05/2027,PELUNASAN KLIEN,9150000 CR,86927777,TRX-LAPORAN",
        ].join("\r\n"),
      ],
      "Mutasi-Laporan.csv",
      { type: "text/csv" },
    ),
  );
  statement.set("statementMonth", "2027-05");
  const imported = await json(
    `/api/bank-accounts/${bankAccount.id}/import`,
    { method: "POST", body: statement },
    201,
  );
  assert.equal(imported.matchedCount, 0, "ambiguous, so no auto-match");
  assert.equal(imported.createdCount, 1);

  const window = "from=2027-05-01&to=2027-05-31";
  const summary = await json(`/api/finance/summary?${window}`);
  assert.equal(summary.income, 18_300_000);
  assert.equal(summary.netCash, 15_250_000);
  assert.equal(summary.unreconciled.entries, 1);

  const report = await pdfText(`/api/transactions/report.pdf?${window}`);
  // The headline cards.
  assert.match(report.flat, /18\.300\.000/, "cash inflow card");
  assert.match(report.flat, /15\.250\.000/, "net cash flow card");
  // The monthly and per-project tables used to add the unreconciled 9.150.000
  // on top, so the same page stated 27.450.000 in / 24.400.000 net as well.
  assert.doesNotMatch(
    report.flat,
    /27\.450\.000/,
    "the monthly table must not restate cash inflow with the unreconciled import added",
  );
  assert.doesNotMatch(
    report.flat,
    /24\.400\.000/,
    "the monthly table must not restate net cash with the unreconciled import added",
  );
  // It is never hidden: the ledger still prints it, marked, in the same wording
  // the finance screen uses.
  assert.match(report.flat, /9\.150\.000/, "the unreconciled mutasi is still listed");
  assert.match(
    report.flat,
    /Belum direkonsiliasi - belum dihitung sebagai kas/,
    "and the row says, where the reader sees it, that it was not counted",
  );
  assert.match(
    report.flat,
    /MUTASI BANK BELUM DIREKONSILIASI 1 mutasi impor belum dicocokkan: Rp 9\.150\.000 masuk/,
    "the page explains the difference instead of leaving two figures unexplained",
  );
  assert.match(report.flat, /4 transaksi \(3 dihitung sebagai kas\)/);

  // Reconciling it makes it count, through its source record, without doubling.
  const entry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((row) => row.reference === "TRX-LAPORAN");
  const candidates = await json(
    `/api/bank-accounts/${bankAccount.id}/entries/${entry.id}/candidates`,
  );
  await json(
    `/api/bank-accounts/${bankAccount.id}/entries/${entry.id}/reconcile`,
    {
      method: "PATCH",
      body: JSON.stringify({ action: "match", transactionId: candidates[0].id }),
    },
  );
  const reconciled = await pdfText(`/api/transactions/report.pdf?${window}`);
  assert.match(reconciled.flat, /15\.250\.000/, "net cash is unchanged");
  assert.doesNotMatch(
    reconciled.flat,
    /Belum direkonsiliasi/,
    "and nothing is flagged once it is matched",
  );
});

// ------------------------------------------------------------------- (4) ---

test("the BAST verification page prints the handover date only, never an invented time", async () => {
  await loginAsAdmin();
  const project = await createProject("Proyek Serah Terima Tanggal");
  await addBoqItem(project.id, {
    category: "Perangkat",
    description: "Access point serah terima",
    costPrice: 300_000,
    sellingPrice: 600_000,
  });
  await acceptQuotation(project.id, "serah-terima-tanggal");
  const validation = await json(
    `/api/validations?projectId=${project.id}`,
    { method: "POST" },
    201,
  );
  await json(`/api/validations/${validation.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Completed",
      notes: "Perangkat lulus pengujian.",
      items: validation.items.map((item) => ({ ...item, checked: true })),
    }),
  });
  const bast = await json(
    "/api/bast",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        // A date-only column. No clock time was ever recorded for it.
        completionDate: "2026-08-04",
        notes: "Pekerjaan diserahterimakan.",
        installedItems: [
          { name: "Access Point", quantity: "1 unit", status: "Terpasang" },
        ],
        clientName: "Klien Dokumen",
        clientRole: "Manager",
        clientSignature: SIGNATURE,
        engineerName: "Dewa Mahardika",
        engineerRole: "Project Manager",
        engineerSignature: SIGNATURE,
        status: "Draft",
      }),
    },
    201,
  );
  await json("/api/bast/settings/seal", {
    method: "PUT",
    body: JSON.stringify({
      enabled: true,
      signerName: "Direktur PerumNet",
      signerRole: "Direktur",
      sealMimeType: "image/png",
      sealContentBase64: SIGNATURE.split(",")[1],
    }),
  });
  const finalized = await json(`/api/bast/${bast.id}/finalize`, { method: "POST" });
  assert.ok(finalized.verificationToken);

  const page = await fetch(`${baseUrl}/verify/bast/${finalized.verificationToken}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const handover = html.match(/Tanggal serah terima<\/dt><dd>(.*?)<\/dd>/s);
  assert.ok(handover, "the verification page states a handover date");
  const printed = handover[1].replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, "").trim();
  assert.equal(
    printed,
    "4 Agustus 2026",
    "a date-only column must not grow a time the record never held",
  );
  assert.doesNotMatch(
    printed,
    /pukul/,
    "08.00 was only an artifact of UTC midnight rendered in Asia/Makassar",
  );
  // The finalisation timestamp is a real timestamp and keeps its clock time.
  const finalisation = html.match(/Finalisasi<\/dt><dd>(.*?)<\/dd>/s);
  assert.ok(finalisation);
  assert.match(finalisation[1], /pukul/);
});

// --------------------------------------------------------------- (5,6,7) ---

test("the operations manual numbers its pages, dates itself in Asia/Makassar, and its contents point at the right pages", async () => {
  await loginAsAdmin();
  const manual = await pdfText("/api/help/sop.pdf?language=id");
  assert.ok(manual.total > 30, `a full manual, got ${manual.total} pages`);

  // (6) Every page but the cover states how many pages there are, so a reader
  // holding a printed copy can tell whether any are missing.
  assert.doesNotMatch(manual.pages[0], /Halaman/, "the cover carries no footer");
  for (let page = 2; page <= manual.total; page += 1) {
    assert.match(
      manual.pages[page - 1].replace(/\s+/g, " "),
      new RegExp(`Halaman ${page} dari ${manual.total}`),
      `page ${page} states its position in the whole document`,
    );
  }

  // (5) Generated on the date the business is in, not the date the host is in.
  assert.match(
    manual.pages[0].replace(/\s+/g, " "),
    new RegExp(`Dibuat pada ${makassarToday("id-ID")}`),
    "the manual dates itself in Asia/Makassar like every other document",
  );

  // (7) One layout pass, and the table of contents is still right: each of the
  // Every row must point at the page its chapter actually starts on. The count
  // is read from the source rather than written here: it used to be the
  // literal 19, and adding a twentieth chapter shifted every row by one so the
  // failure read "chapter 1 starts on page 5" instead of "there are 20 now".
  const chapterCount = countGuideChapters();
  const tocIndex = manual.pages.findIndex((page) => /Daftar isi/.test(page));
  assert.ok(tocIndex >= 0, "the manual has a table of contents");
  // The footer is written after the contents rows, so it sits at the end of the
  // page's text stream and has to come off before the trailing page numbers.
  const tokens = manual.pages[tocIndex]
    .replace(/it@perumnet\.id/, "")
    .replace(/Halaman \d+ dari \d+/, "")
    .split(/\s+/)
    .filter(Boolean);
  const listed = tokens.slice(-chapterCount).map(Number);
  assert.equal(listed.length, chapterCount);
  for (const [index, target] of listed.entries()) {
    assert.ok(
      Number.isInteger(target) && target > tocIndex + 1 && target <= manual.total,
      `contents row ${index + 1} points at a real page, got ${tokens.slice(-chapterCount)[index]}`,
    );
    if (index > 0) {
      assert.ok(target > listed[index - 1], "chapters are listed in order");
    }
    // Below the two header lines, a chapter opens its page with its own number
    // in the accent circle, followed by the chapter title.
    const body = manual.pages[target - 1].split("\n").slice(2).join("\n");
    assert.equal(
      body.trimStart().match(/^(\d+)\s/)?.[1],
      String(index + 1),
      `contents says chapter ${index + 1} starts on page ${target}`,
    );
  }
});

// ------------------------------------------------------------------- (3) ---

function countGuideChapters() {
  const source = readFileSync(
    new URL("../server/api/sop-pdf-content.ts", import.meta.url),
    "utf8",
  );
  const opening = "export const guideChapters: Chapter[] = [";
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, "guideChapters must still be a plain array literal");
  const end = source.indexOf("\n];", start);
  const entries = source
    .slice(start + opening.length, end)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  assert.ok(entries.length > 0, "guideChapters must not be empty");
  return entries.length;
}

test("the English editions print English", async () => {
  await loginAsAdmin("en");
  const project = await createProject("English Edition Project");
  await addBoqItem(project.id, {
    category: "Jasa",
    description: "Managed network installation",
    costPrice: 500_000,
    sellingPrice: 2_000_000,
  });
  const accepted = await acceptQuotation(project.id, "english-edition");

  const quotation = await pdfText(`/api/quotations/${accepted.quotationId}/pdf`);
  assert.match(quotation.flat, /COMMERCIAL PACKAGE Main Scope/);
  assert.match(quotation.flat, /SCOPE TYPE Original - Main Scope/);
  assert.doesNotMatch(quotation.flat, /Lingkup Utama/);
  assert.match(quotation.flat, /1 package/, "quotation already localised its units");
  assert.doesNotMatch(quotation.flat, /1 paket/);

  const invoice = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        quotationId: accepted.quotationId,
        type: "Pelunasan",
        issueDate: "2026-08-04",
        dueDate: "2026-09-04",
        calculationMode: "Percent",
        installmentPercent: 100,
      }),
    },
    201,
  );
  const invoicePdf = await pdfText(`/api/invoices/${invoice.id}/pdf`);
  assert.match(invoicePdf.flat, /PACKAGE \/ QUOTATION Main Scope/);
  assert.doesNotMatch(invoicePdf.flat, /Lingkup Utama/);

  const item = accepted.scope.items.find((row) => row.category === "Jasa");
  const vendor = await createVendor("English Vendor", "Jasa");
  const order = await json(
    "/api/procurement-orders",
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "SPK",
        vendorId: vendor.id,
        projectId: project.id,
        quotationId: accepted.quotationId,
        items: [{ boqItemId: item.id, quantity: 1, agreedUnitCost: 900_000 }],
        terms: [{ label: "Final payment", type: "Final", percentage: 100 }],
      }),
    },
    201,
  );
  const workOrder = await pdfText(`/api/procurement-orders/${order.id}/pdf`);
  // The same values the quotation already ran through the same translation.
  assert.match(workOrder.flat, /1 package/, "units are localised like the quotation");
  assert.doesNotMatch(workOrder.flat, /1 paket/);
  assert.match(workOrder.flat, /English Vendor - Service/, "vendor type is localised");
  assert.doesNotMatch(workOrder.flat, /English Vendor - Jasa/);
  assert.doesNotMatch(workOrder.flat, /Lingkup Utama/);
  assert.match(workOrder.flat, /Main Scope/);

  const manual = await pdfText("/api/help/sop.pdf?language=en");
  assert.match(
    manual.pages[1].replace(/\s+/g, " "),
    /Page 2 of \d+/,
    "the English manual numbers its pages too",
  );
  assert.match(
    manual.pages[0].replace(/\s+/g, " "),
    new RegExp(`Generated on ${makassarToday("en-GB")}`),
  );

  await loginAsAdmin();
});

// ------------------------------------------------------------------- (8) ---
//
// (8) Panduan operasional tertinggal di belakang aplikasinya.
//
// Kirim dokumen lewat email sudah berjalan di produksi sejak Agustus 2026 —
// SPK ke vendor, Quotation dan Invoice ke klien, dengan PDF resminya dilampirkan
// aplikasi — tetapi panduan yang diunduh pengguna sama sekali tidak menyebutnya.
// Panduan yang diam tentang fitur yang ada lebih berbahaya daripada panduan yang
// tidak ada: pembacanya menyimpulkan fiturnya memang belum ada.
//
// Batas lampiran DIBACA DARI SUMBERNYA, bukan ditulis ulang di sini. Kalau
// suatu hari batasnya diubah di shared/document-email.ts dan panduannya tidak
// ikut, tes ini yang gagal — bukan pengguna yang menghitung ulang sendiri
// kenapa suratnya ditolak.

function constantFromSource(name) {
  const source = readFileSync(
    new URL("../shared/document-email.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(new RegExp(`export const ${name} = ([^;]+);`));
  assert.ok(match, `${name} must still be a plain constant`);
  // Nilainya ditulis sebagai perkalian (10 * 1024 * 1024), jadi dihitung, bukan
  // dibaca sebagai angka tunggal.
  return match[1]
    .split("*")
    .map((part) => Number(part.trim()))
    .reduce((hasil, angka) => hasil * angka, 1);
}

test("the manual documents sending documents by email, with the limits the server actually enforces", async () => {
  await loginAsAdmin();
  const manual = await pdfText("/api/help/sop.pdf?language=id");

  assert.match(manual.flat, /Mengirim dokumen resmi lewat email/);

  // Pembedaan yang paling mudah salah dipahami di seluruh fitur ini: Kirim
  // membuka pembayaran, Kirim Email mengirim suratnya. Menggabungkan keduanya
  // membuat kemampuan membayar bergantung pada jabat tangan SMTP. Yang diperiksa
  // isi catatannya, bukan judulnya — judul callout dicetak huruf besar semua.
  assert.match(manual.flat, /tidak pernah bergantung pada berhasil atau gagalnya satu jabat tangan SMTP/);

  // Aturan status yang berbeda per dokumen, dan mudah dikira seragam.
  assert.match(manual.flat, /Status Invoice TIDAK berubah karena dikirim/);

  const jumlah = constantFromSource("ATTACHMENT_MAX_COUNT");
  const totalMb = Math.round(
    constantFromSource("ATTACHMENT_TOTAL_MAX_BYTES") / (1024 * 1024),
  );
  assert.match(manual.flat, new RegExp(`${jumlah} berkas`));
  assert.match(manual.flat, new RegExp(`${totalMb} MB, termasuk dokumen resminya`));

  // Penolakan yang paling sering ditemui pengguna harus punya jalan keluar
  // tertulis, bukan cuma muncul di layar.
  assert.match(manual.flat, /belum punya alamat email klien/);
  assert.match(manual.flat, /Template ini bukan untuk Quotation/);
});

test("the English edition of the manual documents it in English too", async () => {
  await loginAsAdmin("en");
  const manual = await pdfText("/api/help/sop.pdf?language=en");
  assert.match(manual.flat, /Sending official documents by email/);
  assert.match(manual.flat, /never depends on whether one SMTP handshake succeeded/);
  assert.doesNotMatch(manual.flat, /Mengirim dokumen resmi lewat email/);
});

// ------------------------------------------------------------------- (9) ---
//
// (9) Audit logika /admin, 21–22 Agustus 2026: alur yang berubah harus ada di
// panduan yang diunduh pengguna, dalam kedua bahasa, beserta bagan alurnya.

test("the manual carries the audited flows: deal conversion, per-term evidence, withholding on payment, profit cap, bank window, reversal dating", async () => {
  await loginAsAdmin();
  const manual = await pdfText("/api/help/sop.pdf?language=id");
  assert.match(manual.flat, /Edisi 2\.3/);
  assert.match(manual.flat, /Jadikan proyek: dari calon klien ke proyek/);
  // Judul callout dicetak HURUF BESAR; yang dicocokkan kalimat isinya.
  assert.match(manual.flat, /termin wajib dipilih saat mencatat pembayaran vendor/);
  assert.match(manual.flat, /menjadi kewajiban sebesar yang benar-benar dipotong/);
  assert.match(manual.flat, /tidak boleh melebihi laba aman dibagikan SAAT INI/);
  assert.match(manual.flat, /memakai jendela yang sama: 14 hari/);
  assert.match(manual.flat, /baris pembalik memakai tanggal pembayaran asal/);
  assert.match(manual.flat, /tetap Aktif walau BAST-nya final/);
  assert.match(manual.flat, /Bagan alur pemakaian aplikasi/, "keterangan bagan tercetak di bab alur");
  // Daftar isi mengikuti jumlah bab yang sebenarnya.
  assert.match(manual.flat, /Bab 3 sampai 18/);
});

test("the English edition carries the same audited flows", async () => {
  await loginAsAdmin("en");
  const manual = await pdfText("/api/help/sop.pdf?language=en");
  assert.match(manual.flat, /Edition 2\.3/);
  assert.match(manual.flat, /Convert to project: from prospect to project/);
  assert.match(manual.flat, /Since 21 August 2026 withholding taxes/);
  assert.match(manual.flat, /all use the same window: 14 days/);
  assert.match(manual.flat, /Chapters 3 to 18/);
});

test("the manual says where document templates live and whose permission governs them", async () => {
  await loginAsAdmin();
  const manual = await pdfText("/api/help/sop.pdf?language=id");
  assert.match(manual.flat, /Template SPK dan PO dikelola di Procurement & Vendor/);
  assert.match(manual.flat, /Quotation dan Invoice di Quotation & Invoice/);
  assert.match(manual.flat, /template BAST di BAST Digital/);
  assert.match(manual.flat, /Finance tidak lagi perlu izin Procurement/);
});

// Panduan harus menyebut ALASAN lampiran BAST diambil dari arsip, bukan sekadar
// menyebut fiturnya ada. Ini kalimat yang menjawab pertanyaan "kenapa nomor di
// email saya beda dengan yang di layar verifikasi" — dan satu-satunya tempat
// pemakai bisa menemukannya sendiri.
// Angka yang salah paham di sini akan muncul sebagai "kok kas masuk kita naik
// terus" berbulan-bulan kemudian. Panduan harus menyebut alasannya, bukan
// hanya menyebut tombolnya ada.
test("panduan menjelaskan alokasi ke kas perusahaan dan kenapa kas tidak bergerak", async () => {
  await loginAsAdmin();
  const id = await pdfText("/api/help/sop.pdf?language=id");
  assert.match(id.flat, /Alokasikan sisanya ke kas perusahaan/);
  assert.match(id.flat, /Kas bersih perusahaan tidak bergerak satu rupiah pun/);
  assert.match(id.flat, /tidak ikut mengurangi laba yang menjadi dasarnya sendiri/);
  assert.match(id.flat, /Proyek ini sudah punya alokasi ke kas perusahaan/);

  await loginAsAdmin("en");
  const en = await pdfText("/api/help/sop.pdf?language=en");
  assert.match(en.flat, /Net company cash does not move by a single rupiah/);
});

test("panduan memuat bab foto proyek dan arsip bukti, dalam dua bahasa", async () => {
  await loginAsAdmin();
  const id = await pdfText("/api/help/sop.pdf?language=id");
  assert.match(id.flat, /Dokumentasi foto dan berkas proyek/);
  assert.match(id.flat, /bukan kapan seseorang sempat mengunggahnya/);
  assert.match(id.flat, /Maksimal 10 berkas per unggahan/);
  assert.match(id.flat, /Arsip bukti keuangan/);
  assert.match(id.flat, /tidak pernah bisa dibuka dari mana pun; kini dibuka dari arsip/);
  assert.match(id.flat, /Baris pembalikan tidak pernah dihitung sebagai tanpa bukti/);
  assert.match(id.flat, /Tipe file tidak sesuai dengan isi gambarnya/);

  await loginAsAdmin("en");
  const en = await pdfText("/api/help/sop.pdf?language=en");
  assert.match(en.flat, /Project photos and files/);
  assert.match(en.flat, /Financial evidence archive/);
  assert.match(en.flat, /Reversal rows are never counted as missing proof/);
});

test("panduan menjelaskan kenapa lampiran BAST adalah arsip, bukan cetakan baru", async () => {
  await loginAsAdmin();
  const id = await pdfText("/api/help/sop.pdf?language=id");
  assert.match(id.flat, /Cetakan baru akan menghasilkan sidik yang berbeda/);
  assert.match(id.flat, /BAST hanya dapat dikirim setelah difinalisasi/);
  assert.match(id.flat, /Mengirim BAST memerlukan izin Kelola pada BAST Digital/);
  assert.match(id.flat, /BAST ini belum difinalisasi/);
  assert.match(id.flat, /Sidik arsip BAST tidak cocok dengan catatannya/);

  await loginAsAdmin("en");
  const en = await pdfText("/api/help/sop.pdf?language=en");
  assert.match(en.flat, /A new rendering would produce a different fingerprint/);
  assert.match(en.flat, /only be sent once it has been finalised/);
});

// ── Tata letak panduan, bukan cuma isinya ───────────────────────────────────
//
// Halaman 28 edisi 2.2 rusak dan tidak satu pun tes menyadarinya: sebuah butir
// memuat karakter panah "→", yang TIDAK ADA di WinAnsi — satu-satunya encoding
// yang dikenal font bawaan jsPDF. Glyph-nya digambar sebagai sampah, lebarnya
// dihitung keliru, dan barisnya tidak pernah dibungkus: teksnya berjalan lurus
// keluar dari tepi kertas.
//
// Seluruh tes panduan yang ada memeriksa TEKS ("apakah kalimat ini tercetak"),
// dan teks tetap ditemukan — pdf-parse membacanya kembali dari isi berkas,
// bukan dari yang terlihat. Yang tidak pernah diperiksa adalah DI MANA teks itu
// mendarat. Karena itu penjaganya geometri, bukan karakter: apa pun sebabnya —
// panah, kata panjang tanpa spasi, metrik font yang meleset — teks yang keluar
// halaman akan tertangkap.

const MARGIN_AMAN = 6; // titik; toleransi pembulatan jsPDF

async function petaTeks(path) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} -> ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const halaman = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const isi = await page.getTextContent();
    halaman.push({
      nomor: n,
      width,
      height,
      items: isi.items
        .filter((item) => item.str.trim())
        .map((item) => ({ x: item.transform[4], y: item.transform[5], w: item.width, s: item.str })),
    });
  }
  return halaman;
}

for (const bahasa of ["id", "en"]) {
  test(`tidak ada teks panduan yang keluar halaman (${bahasa})`, async () => {
    await loginAsAdmin(bahasa);
    const halaman = await petaTeks(`/api/help/sop.pdf?language=${bahasa}`);
    assert.ok(halaman.length > 20, `panduan cuma ${halaman.length} halaman`);
    const luber = [];
    for (const h of halaman) {
      for (const item of h.items) {
        const kanan = item.x + item.w;
        if (kanan > h.width - MARGIN_AMAN || item.x < MARGIN_AMAN) {
          luber.push(`hal ${h.nomor}: x=${item.x.toFixed(0)}..${kanan.toFixed(0)} (lebar kertas ${h.width.toFixed(0)}) ${JSON.stringify(item.s.slice(0, 60))}`);
        }
      }
    }
    assert.deepEqual(luber, [], `teks keluar halaman:\n  ${luber.join("\n  ")}`);
  });
}

// Penyebab paling mungkin, disebut namanya supaya kegagalannya bisa langsung
// ditindak. Font bawaan jsPDF memakai WinAnsi (cp1252): apa pun di luar itu
// digambar sebagai sampah DAN mengacaukan perhitungan lebar baris.
test("isi panduan hanya memakai karakter yang bisa dirender font PDF", () => {
  // cp1252 = Latin-1 yang bisa dicetak, ditambah blok khusus 0x80–0x9F.
  const KHUSUS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const sumber = [
    "server/api/sop-pdf-content.ts",
    "server/api/sop-pdf.ts",
  ].map((relatif) => [relatif, readFileSync(new URL(`../${relatif}`, import.meta.url), "utf8")]);

  const temuan = [];
  for (const [nama, isi] of sumber) {
    isi.split("\n").forEach((baris, index) => {
      for (const ch of baris) {
        const kode = ch.codePointAt(0);
        if (kode < 0x100 || KHUSUS.includes(ch)) continue;
        temuan.push(`${nama}:${index + 1} U+${kode.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(ch)}`);
      }
    });
  }
  assert.deepEqual(
    [...new Set(temuan)],
    [],
    "karakter di luar WinAnsi akan dicetak sebagai sampah dan merusak pembungkusan baris",
  );
});
