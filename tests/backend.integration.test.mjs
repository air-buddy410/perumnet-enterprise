import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";

let server;
let baseUrl;
let databasePath;
let cookie = "";
let lastSetCookie = "";

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
  if (setCookie) {
    lastSetCookie = setCookie;
    cookie = setCookie.split(";")[0];
  }
  return response;
}

async function requestWithHost(path, host) {
  const target = new URL(path, baseUrl);
  return await new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers: { Host: host },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

async function json(path, options = {}, expectedStatus = 200) {
  const response = await request(path, options);
  const payload = response.status === 204 ? null : await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    JSON.stringify(payload?.error ?? payload),
  );
  return payload?.data;
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-enterprise-${process.pid}-${Date.now()}.db`;
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
});

test("backend PRD works end-to-end with persistence, PDF, auth, and RBAC", async () => {
  const health = await json("/api/health");
  assert.equal(health.status, "ok");

  const dotComEnglish = await requestWithHost(
    "/services?source=integration",
    "enterprise.perumnet.com",
  );
  assert.equal(dotComEnglish.statusCode, 301);
  assert.equal(
    dotComEnglish.headers.location,
    "https://enterprise.perumnet.id/en/services?source=integration",
  );
  const dotComPanel = await requestWithHost(
    "/panel?source=integration",
    "enterprise.perumnet.com",
  );
  assert.equal(dotComPanel.statusCode, 301);
  assert.equal(
    dotComPanel.headers.location,
    "https://enterprise.perumnet.id/panel?source=integration",
  );

  const unauthorized = await request("/api/projects");
  assert.equal(unauthorized.status, 401);

  const login = await json(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        email: "admin@perumnet.id",
        password: "perumnet123",
        remember: true,
      }),
    },
  );
  assert.equal(login.user.role, "Admin");
  assert.match(cookie, /^perumnet_session=/);
  assert.match(lastSetCookie, /Max-Age=2592000/);

  const panelRecovery = await json("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      surface: "panel",
    }),
  });
  assert.ok(panelRecovery.resetToken);
  const recoveryDelivery = (await json("/api/notifications/email")).find(
    (delivery) => delivery.eventType === "password_reset",
  );
  assert.equal(recoveryDelivery.senderProfile, "security");

  const leadKey = `lead-integration-${Date.now()}`;
  const leadPayload = {
    fullName: "Made Customer Lead",
    whatsapp: "+628123456789",
    email: "made.lead@example.com",
    companyName: "Villa Integrasi",
    jobTitle: "Manager",
    location: "Ubud, Gianyar",
    serviceInterest: "Smart Home & Building Automation",
    budgetRange: "Rp75–250 juta",
    targetStart: "2026-09-01",
    message: "Perlu kontrol pencahayaan, akses, dan sensor untuk villa.",
    privacyConsent: true,
    sourcePath: "/contact",
    language: "id",
    turnstileToken: "",
    website: "",
  };
  const createdLead = await json("/api/cms/leads", {
    method: "POST",
    headers: { "Idempotency-Key": leadKey },
    body: JSON.stringify(leadPayload),
  }, 201);
  assert.ok(createdLead.id);
  const duplicateLead = await json("/api/cms/leads", {
    method: "POST",
    headers: { "Idempotency-Key": leadKey },
    body: JSON.stringify(leadPayload),
  });
  assert.equal(duplicateLead.duplicate, true);
  const honeypotLead = await json("/api/cms/leads", {
    method: "POST",
    headers: { "Idempotency-Key": `${leadKey}-honeypot` },
    body: JSON.stringify({ ...leadPayload, website: "bot-filled" }),
  }, 201);
  assert.equal(honeypotLead.received, true);
  const leadList = await json("/api/cms/leads?q=Made%20Customer");
  assert.equal(leadList.total, 1);
  const qualifiedLead = await json(`/api/cms/leads/${createdLead.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Qualified",
      note: "Kebutuhan awal sudah dikonfirmasi melalui WhatsApp.",
    }),
  });
  assert.equal(qualifiedLead.status, "Qualified");
  assert.equal(qualifiedLead.notes.length, 2);
  const leadCsv = await request("/api/cms/leads/export.csv?status=Qualified");
  assert.equal(leadCsv.status, 200);
  const leadCsvBody = await leadCsv.text();
  assert.match(leadCsvBody, /Made Customer Lead/);
  assert.doesNotMatch(leadCsvBody, /fingerprint/i);
  const leadXlsx = await request("/api/cms/leads/export.xlsx?status=Qualified");
  assert.equal(leadXlsx.status, 200);
  const leadWorkbook = new ExcelJS.Workbook();
  await leadWorkbook.xlsx.load(Buffer.from(await leadXlsx.arrayBuffer()));
  assert.equal(leadWorkbook.worksheets[0].getCell("B2").value, "Made Customer Lead");
  assert.ok(leadWorkbook.worksheets[0].getCell("A2").value instanceof Date);
  const leadPdf = await request("/api/cms/leads/export.pdf?status=Qualified");
  assert.equal(leadPdf.status, 200);
  assert.equal(Buffer.from(await leadPdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");

  const projects = await json("/api/projects");
  assert.ok(projects.length >= 5);
  assert.equal(projects.find((project) => project.id === "project-1").paidRatio, 50);

  const project = await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Proyek Integrasi Backend",
        client: "Klien Pengujian",
        location: "Gianyar",
        status: "Draft",
        value: 12_500_000,
      }),
    },
    201,
  );
  assert.match(project.code, /^PN-/);
  assert.equal((await json(`/api/projects/${project.id}`)).name, "Proyek Integrasi Backend");

  const task = await json(
    `/api/projects/${project.id}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Survey integrasi",
        owner: "Dewa Mahardika",
        startDate: "2026-07-18",
        status: "Belum Mulai",
      }),
    },
    201,
  );
  await json(`/api/projects/${project.id}/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Selesai" }),
  });
  const tasks = await json(`/api/projects/${project.id}/tasks`);
  assert.equal(tasks[0].status, "Selesai");

  const boqItem = await json(
    `/api/boq/items?projectId=${project.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Perangkat",
        description: "Access Point integrasi",
        quantity: 1,
        unit: "paket",
        costPrice: 1_000_000,
        sellingPrice: 1_500_000,
      }),
    },
    201,
  );
  const boq = await json(`/api/boq?projectId=${project.id}`);
  assert.equal(boq.totals.margin, 500_000);
  const quotation = await request(`/api/projects/${project.id}/quotation.pdf`);
  assert.equal(quotation.status, 200);
  assert.equal(Buffer.from(await quotation.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  const sentQuotation = await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent" }),
  });
  assert.equal(sentQuotation.status, "Sent");
  assert.equal((await json(`/api/quotations?projectId=${project.id}`)).status, "Sent");

  const updatedBoqItem = await json(
    `/api/boq/items/${boqItem.id}?projectId=${project.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        description: "Access Point integrasi terkelola",
        sellingPrice: 1_800_000,
      }),
    },
  );
  assert.equal(updatedBoqItem.sellingPrice, 1_800_000);
  const synchronizedQuotation = await json(`/api/quotations?projectId=${project.id}`);
  assert.equal(synchronizedQuotation.status, "Draft");
  assert.equal(synchronizedQuotation.total, 1_800_000);
  assert.equal((await json(`/api/projects/${project.id}`)).value, 1_800_000);
  const editedQuotation = await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Sent",
      issuedAt: "2026-07-19",
      validUntil: "2026-08-05",
    }),
  });
  assert.equal(editedQuotation.validUntil, "2026-08-05");

  const template = await json(
    "/api/boq/templates",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Template Integrasi",
        items: [updatedBoqItem],
      }),
    },
    201,
  );
  assert.equal((await json(`/api/boq/templates/${template.id}`)).items.length, 1);

  const standaloneBoq = await json(
    "/api/boq/standalone",
    {
      method: "POST",
      body: JSON.stringify({
        title: "BoQ Pra-Proyek Integrasi",
        client: "Calon Klien",
        status: "Draft",
        notes: "Disusun sebelum proyek dibuat.",
        items: [
          {
            category: "Perangkat",
            description: "Gateway integrasi",
            quantity: 2,
            unit: "unit",
            costPrice: 500_000,
            sellingPrice: 750_000,
          },
        ],
      }),
    },
    201,
  );
  assert.equal(standaloneBoq.total, 1_500_000);
  assert.equal((await json("/api/boq/standalone")).length, 1);
  assert.equal(
    (await json(`/api/boq/standalone/${standaloneBoq.id}`)).items.length,
    1,
  );

  const invoice = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        type: "DP 50%",
        issueDate: "2026-07-18",
        dueDate: "2026-07-25",
        amount: 750_000,
      }),
    },
    201,
  );
  const paidInvoice = await json(`/api/invoices/${invoice.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      type: "DP Tahap 1",
      amount: 800_000,
      dueDate: "2026-07-28",
    }),
  });
  assert.equal(paidInvoice.amount, 800_000);
  assert.equal(paidInvoice.issueDateIso, "2026-07-18");
  const excessiveInvoice = await request("/api/invoices", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      type: "Melebihi Quotation",
      issueDate: "2026-07-18",
      dueDate: "2026-07-25",
      amount: 1_100_000,
    }),
  });
  assert.equal(excessiveInvoice.status, 409);
  const confirmedInvoice = await json(`/api/invoices/${invoice.id}/payment`, {
    method: "POST",
    body: JSON.stringify({ paidDate: "2026-07-18" }),
  });
  assert.equal(confirmedInvoice.status, "Lunas");
  assert.equal(
    (
      await request(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({ amount: 850_000 }),
      })
    ).status,
    409,
  );
  assert.equal(
    (await json(`/api/transactions?projectId=${project.id}`)).find(
      (entry) => entry.source === "Invoice Payment",
    )?.amount,
    800_000,
  );
  const correctedInvoice = await json(
    `/api/invoices/${invoice.id}/payments/${confirmedInvoice.payments[0].id}/void`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: "Referensi pembayaran integrasi perlu dikoreksi.",
      }),
    },
  );
  assert.equal(correctedInvoice.status, "Belum Lunas");
  assert.equal(
    (await json(`/api/transactions?projectId=${project.id}`)).some(
      (entry) => entry.source === "Invoice Payment Reversal",
    ),
    true,
  );
  await json(`/api/invoices/${invoice.id}/payment`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Lunas",
      paidDate: "2026-07-18",
    }),
  });
  const invoicePdf = await request(`/api/invoices/${invoice.id}/pdf`);
  assert.equal(invoicePdf.status, 200);
  assert.equal(Buffer.from(await invoicePdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");

  const vendor = await json(
    "/api/vendors",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Vendor Integrasi",
        category: "Teknisi Jaringan",
        contact: "081234567890",
        rate: 500_000,
        status: "Aktif",
      }),
    },
    201,
  );
  const spk = await json(
    "/api/spks",
    {
      method: "POST",
      body: JSON.stringify({
        vendorId: vendor.id,
        projectId: project.id,
        scope: "Pekerjaan integrasi jaringan",
        cost: 500_000,
        status: "Draft",
      }),
    },
    201,
  );
  assert.equal(
    (await json(`/api/spks/${spk.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Dikerjakan" }),
    })).status,
    "Dikerjakan",
  );
  const editedSpk = await json(`/api/spks/${spk.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      scope: "Pekerjaan integrasi jaringan dan dokumentasi",
      cost: 600_000,
      status: "Selesai",
      endDate: "2026-07-29",
    }),
  });
  assert.equal(editedSpk.cost, 600_000);
  let spkTransactions = await json(`/api/transactions?projectId=${project.id}`);
  assert.equal(editedSpk.paymentStatus, "Belum Dibayar");
  assert.equal(
    spkTransactions.some((entry) => entry.source === "SPK"),
    false,
  );
  const paidSpk = await json(`/api/spks/${spk.id}/payment`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Dibayar",
      paidDate: "2026-07-29",
    }),
  });
  assert.equal(paidSpk.paymentStatus, "Dibayar");
  assert.equal(paidSpk.paidDate, "2026-07-29");
  spkTransactions = await json(`/api/transactions?projectId=${project.id}`);
  assert.equal(
    spkTransactions.find((entry) => entry.source === "SPK")?.amount,
    600_000,
  );
  const financialPdf = await request(
    `/api/transactions/report.pdf?projectId=${project.id}`,
  );
  assert.equal(financialPdf.status, 200);
  assert.equal(financialPdf.headers.get("content-type"), "application/pdf");
  assert.ok((await financialPdf.arrayBuffer()).byteLength > 5_000);
  await json(`/api/spks/${spk.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Dikerjakan" }),
  });
  spkTransactions = await json(`/api/transactions?projectId=${project.id}`);
  assert.equal(
    spkTransactions.some((entry) => entry.source === "SPK"),
    true,
  );
  const unpaidSpk = await json(`/api/spks/${spk.id}/payment`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Belum Dibayar" }),
  });
  assert.equal(unpaidSpk.paymentStatus, "Belum Dibayar");
  spkTransactions = await json(`/api/transactions?projectId=${project.id}`);
  assert.equal(spkTransactions.some((entry) => entry.source === "SPK"), false);
  await json(`/api/spks/${spk.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Selesai" }),
  });
  const completedSpkDeliveries = (
    await json("/api/notifications/email")
  ).filter((delivery) => delivery.eventType === "spk_completed");
  assert.ok(completedSpkDeliveries.length > 0);
  assert.ok(
    completedSpkDeliveries.every(
      (delivery) =>
        delivery.subject.includes(spk.number) &&
        !delivery.subject.includes("undefined"),
    ),
  );
  await json(`/api/spks/${spk.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Selesai" }),
  });
  assert.equal(
    (await json("/api/notifications/email")).filter(
      (delivery) => delivery.eventType === "spk_completed",
    ).length,
    completedSpkDeliveries.length,
  );
  await json(`/api/spks/${spk.id}/payment`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Dibayar", paidDate: "2026-07-29" }),
  });
  assert.equal((await request(`/api/spks/${spk.id}/pdf`)).status, 200);

  const blockedBast = await request("/api/bast", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      completionDate: "2026-07-30",
      notes: "Seluruh pekerjaan integrasi telah diuji dengan baik.",
      installedItems: [{ name: "Access Point", quantity: "1 unit", status: "Terpasang" }],
      clientName: "Klien Pengujian",
      clientRole: "Manager",
      engineerName: "Dewa Mahardika",
      engineerRole: "Project Manager",
      status: "Draft",
    }),
  });
  assert.equal(blockedBast.status, 409);

  const validation = await json(`/api/validations?projectId=${project.id}`, {
    method: "POST",
  }, 201);
  assert.equal(validation.totalCount, 1);
  assert.equal(validation.items[0].category, "Perangkat");
  const completedValidation = await json(`/api/validations/${validation.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Completed",
      notes: "Perangkat lulus pengujian fungsi dan kondisi fisik.",
      items: validation.items.map((item) => ({ ...item, checked: true })),
    }),
  });
  assert.equal(completedValidation.status, "Completed");
  assert.equal(completedValidation.checkedCount, completedValidation.totalCount);
  assert.equal((await request(`/api/validations/${validation.id}/pdf`)).status, 200);

  const signature =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const bast = await json(
    "/api/bast",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        completionDate: "2026-07-30",
        notes: "Seluruh pekerjaan integrasi telah diuji dengan baik.",
        installedItems: [
          { name: "Access Point", quantity: "1 unit", status: "Terpasang" },
        ],
        clientName: "Klien Pengujian",
        clientRole: "Manager",
        clientSignature: signature,
        engineerName: "Dewa Mahardika",
        engineerRole: "Project Manager",
        engineerSignature: signature,
        status: "Final",
      }),
    },
    201,
  );
  assert.equal(bast.engineerRole, "Project Manager");
  assert.equal((await request(`/api/bast/${bast.id}/pdf`)).status, 200);
  const editedBast = await json(`/api/bast/${bast.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      notes: "BAST telah ditinjau dan diperbarui oleh kedua pihak.",
      installedItems: [
        {
          name: "Instalasi integrasi terkelola",
          quantity: "1 paket",
          status: "Terpasang dan diuji",
        },
      ],
      engineerRole: "Engineer",
    }),
  });
  assert.match(editedBast.notes, /diperbarui/);
  assert.equal(editedBast.installedItems[0].name, "Instalasi integrasi terkelola");
  assert.equal(editedBast.engineerRole, "Engineer");
  assert.equal(
    (await json(`/api/bast/${bast.id}`)).engineerRole,
    "Engineer",
  );

  const transaction = await json(
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        date: "2026-07-18",
        type: "Pengeluaran",
        description: "Biaya pengujian",
        amount: 125_000,
        source: "Operasional",
        category: "Operasional",
      }),
    },
    201,
  );
  assert.equal(transaction.project, "Proyek Integrasi Backend");
  assert.equal(transaction.category, "Operasional");
  const finance = await json(`/api/finance/summary?projectId=${project.id}`);
  assert.equal(finance.income, 1_600_000);
  assert.equal(finance.expense, 1_525_000);
  assert.equal(finance.netCash, 75_000);

  const incorrectBonus = await json(
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        date: "2026-07-18",
        type: "Pengeluaran",
        description: "Bonus pegawai perlu koreksi",
        amount: 35_000,
        source: "Manual",
        category: "Bonus Pegawai",
      }),
    },
    201,
  );
  assert.equal(incorrectBonus.editable, true);
  const correctedBonus = await json(`/api/transactions/${incorrectBonus.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      description: "Bonus pegawai proyek",
      amount: 25_000,
    }),
  });
  assert.equal(correctedBonus.amount, 25_000);

  const allocation = await json(
    "/api/profit-shares",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        recipientName: "Partner Integrasi",
        percentage: 25,
        notes: "Pembagian laba partner.",
      }),
    },
    201,
  );
  assert.equal(allocation.status, "Draft");
  const approvedAllocation = await json(
    `/api/profit-shares/${allocation.id}/approve`,
    { method: "POST" },
  );
  assert.equal(approvedAllocation.status, "Approved");
  assert.equal(approvedAllocation.amount, 12_500);
  const paidAllocation = await json(
    `/api/profit-shares/${allocation.id}/pay`,
    {
      method: "POST",
      body: JSON.stringify({ paidDate: "2026-07-31" }),
    },
  );
  assert.equal(paidAllocation.status, "Paid");
  const profitSummary = await json(
    `/api/profit-shares?projectId=${project.id}`,
  );
  assert.equal(profitSummary.netProfit, 50_000);
  assert.equal(profitSummary.allocatedAmount, 12_500);
  assert.equal(profitSummary.paidAmount, 12_500);
  assert.equal(profitSummary.retainedProfit, 37_500);
  assert.equal(
    (
      await request("/api/profit-shares", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          recipientName: "Alokasi Berlebih",
          percentage: 80,
        }),
      })
    ).status,
    409,
  );
  const financeAfterDistribution = await json(
    `/api/finance/summary?projectId=${project.id}`,
  );
  assert.equal(financeAfterDistribution.netCash, 37_500);

  const bankAccount = await json(
    "/api/bank-accounts",
    {
      method: "POST",
      body: JSON.stringify({
        bankName: "BCA",
        accountName: "PerumNet Enterprise",
        accountNumber: "1234567890",
        openingBalance: 1_000_000,
        syncMode: "Manual",
      }),
    },
    201,
  );
  assert.equal(bankAccount.accountNumberMasked, "•••• 7890");
  assert.equal(bankAccount.currentBalance, 1_000_000);
  assert.equal(bankAccount.apiConfigured, false);
  const disposableBankAccount = await json("/api/bank-accounts", {
    method: "POST",
    body: JSON.stringify({
      bankName: "Bank Uji",
      accountName: "Rekening Belum Dipakai",
      accountNumber: "9988776655",
      openingBalance: 250_000,
      syncMode: "Manual",
    }),
  }, 201);
  const editedBankAccount = await json(`/api/bank-accounts/${disposableBankAccount.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      bankName: "Bank Uji Diperbarui",
      accountName: "Rekening Kosong",
      accountNumber: "9988776600",
      openingBalance: 300_000,
      syncMode: "Manual",
      currency: "IDR",
      status: "Aktif",
    }),
  });
  assert.equal(editedBankAccount.bankName, "Bank Uji Diperbarui");
  assert.equal(editedBankAccount.openingBalance, 300_000);
  await json(`/api/bank-accounts/${disposableBankAccount.id}`, { method: "DELETE" }, 204);

  const initialTaxSettings = await json("/api/tax/settings");
  assert.equal(initialTaxSettings.enabled, false);
  const taxRules = await json("/api/tax/rules");
  const ppnRule = taxRules.find((rule) => rule.code === "PPN");
  const pph23Rule = taxRules.find((rule) => rule.code === "PPH23");
  assert.ok(ppnRule);
  assert.ok(pph23Rule);
  assert.equal(ppnRule.rateBps, 0);
  assert.equal(ppnRule.status, "Inactive");

  const taxProject = await json(
    "/api/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Proyek Integrasi Pajak",
        client: "Klien Pajak",
        location: "Denpasar",
        status: "Aktif",
        value: 1_000_000,
      }),
    },
    201,
  );
  await json(
    `/api/boq/items?projectId=${taxProject.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "Jasa",
        description: "Implementasi integrasi pajak",
        quantity: 1,
        unit: "paket",
        costPrice: 150_000,
        sellingPrice: 500_000,
      }),
    },
    201,
  );
  const taxableInvoice = await json(
    "/api/invoices",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: taxProject.id,
        type: "Termin Pajak",
        issueDate: "2026-07-20",
        dueDate: "2026-08-03",
        amount: 300_000,
      }),
    },
    201,
  );
  assert.equal(
    (
      await request(`/api/invoices/${taxableInvoice.id}/taxes`, {
        method: "PUT",
        body: JSON.stringify({ ruleIds: [ppnRule.id] }),
      })
    ).status,
    409,
  );
  await json(`/api/tax/rules/${ppnRule.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      rateBps: 1_100,
      status: "Active",
    }),
  });
  await json(`/api/tax/rules/${pph23Rule.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      scope: "Client",
      accountingTreatment: "Receivable",
      rateBps: 200,
      status: "Active",
    }),
  });
  assert.equal(
    (
      await json("/api/tax/settings", {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      })
    ).enabled,
    true,
  );
  const taxableSummary = await json(
    `/api/invoices/${taxableInvoice.id}/taxes`,
    {
      method: "PUT",
      body: JSON.stringify({ ruleIds: [ppnRule.id, pph23Rule.id] }),
    },
  );
  assert.equal(taxableSummary.baseAmount, 300_000);
  assert.equal(taxableSummary.taxAdditions, 33_000);
  assert.equal(taxableSummary.taxWithholdings, 6_000);
  assert.equal(taxableSummary.grossTotal, 333_000);
  assert.equal(taxableSummary.netCashDue, 327_000);

  const taxAttachment = {
    name: "bukti-pajak.png",
    mimeType: "image/png",
    contentBase64: Buffer.from("tax-payment-evidence").toString("base64"),
  };
  const taxablePaidInvoice = await json(
    `/api/invoices/${taxableInvoice.id}/payments`,
    {
      method: "POST",
      body: JSON.stringify({
        grossAmount: 333_000,
        cashAmount: 327_000,
        withholdingAmount: 6_000,
        paidDate: "2026-07-29",
        paymentReference: "BCA-INV-TAX-001",
        paymentMethod: "Transfer Bank",
        bankAccountId: bankAccount.id,
        attachment: taxAttachment,
      }),
    },
    201,
  );
  assert.equal(taxablePaidInvoice.status, "Lunas");
  assert.equal(taxablePaidInvoice.paidGross, 333_000);
  assert.equal(taxablePaidInvoice.paidCash, 327_000);
  assert.equal(taxablePaidInvoice.withheldTax, 6_000);
  const taxTransactions = await json(
    `/api/transactions?projectId=${taxProject.id}`,
  );
  assert.ok(
    taxTransactions.some(
      (entry) =>
        entry.source === "Invoice Payment" && entry.amount === 327_000,
    ),
  );
  const taxObligations = await json("/api/tax/obligations");
  const ppnObligation = taxObligations.find(
    (obligation) =>
      obligation.documentId === taxableInvoice.id &&
      obligation.ruleCode === "PPN",
  );
  const pphObligation = taxObligations.find(
    (obligation) =>
      obligation.documentId === taxableInvoice.id &&
      obligation.ruleCode === "PPH23",
  );
  assert.equal(ppnObligation.direction, "Payable");
  assert.equal(ppnObligation.outstandingAmount, 33_000);
  assert.equal(pphObligation.direction, "Receivable");
  assert.equal(pphObligation.outstandingAmount, 6_000);
  const taxProtectedProfit = await json(
    `/api/profit-shares?projectId=${taxProject.id}`,
  );
  assert.equal(taxProtectedProfit.outstandingTaxPayable, 33_000);

  const taxSettlement = await json(
    "/api/tax/settlements",
    {
      method: "POST",
      body: JSON.stringify({
        obligationId: ppnObligation.id,
        amount: 20_000,
        settlementDate: "2026-07-30",
        paymentReference: "BCA-PAJAK-001",
        paymentMethod: "Transfer Bank",
        bankAccountId: bankAccount.id,
        attachment: taxAttachment,
      }),
    },
    201,
  );
  assert.equal(taxSettlement.status, "Posted");
  assert.equal(
    (await json("/api/tax/obligations")).find(
      (obligation) => obligation.id === ppnObligation.id,
    ).outstandingAmount,
    13_000,
  );
  const taxCsv = await request("/api/tax/report.csv");
  assert.equal(taxCsv.status, 200);
  assert.match(await taxCsv.text(), /Pajak Pertambahan Nilai/);
  const taxPdf = await request("/api/tax/report.pdf");
  assert.equal(taxPdf.status, 200);
  assert.equal(
    Buffer.from(await taxPdf.arrayBuffer()).subarray(0, 4).toString(),
    "%PDF",
  );
  const voidedTaxSettlement = await json(
    `/api/tax/settlements/${taxSettlement.id}/void`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: "Referensi settlement pajak perlu dikoreksi.",
      }),
    },
  );
  assert.equal(voidedTaxSettlement.status, "Void");
  assert.equal(
    (
      await json("/api/tax/settings", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
    ).enabled,
    false,
  );
  const retainedTaxSnapshot = await json(
    `/api/invoices/${taxableInvoice.id}/taxes`,
  );
  assert.equal(retainedTaxSnapshot.locked, true);
  assert.equal(retainedTaxSnapshot.grossTotal, 333_000);

  const statementFile = [
    "MUTASI REKENING BCA",
    "Nomor Rekening,1234567890",
    "Tanggal,Keterangan,Mutasi,Saldo,Referensi",
    "19/07/2026,TRANSFER MASUK,250000 CR,1250000,TRX-001",
    "20/07/2026,BIAYA ADMIN,2500 DB,1247500,TRX-002",
  ].join("\r\n");
  const statementForm = new FormData();
  statementForm.set(
    "file",
    new File([statementFile], "Mutasi-BCA-Juli-2026.csv", {
      type: "text/csv",
    }),
  );
  statementForm.set("statementMonth", "2026-07");
  const importedStatement = await json(
    `/api/bank-accounts/${bankAccount.id}/import`,
    { method: "POST", body: statementForm },
    201,
  );
  assert.equal(importedStatement.importedCount, 2);
  assert.equal(importedStatement.duplicateCount, 0);
  assert.equal(importedStatement.currentBalance, 1_247_500);

  const repeatedStatementForm = new FormData();
  repeatedStatementForm.set(
    "file",
    new File([statementFile], "Mutasi-BCA-Juli-2026.csv", {
      type: "text/csv",
    }),
  );
  repeatedStatementForm.set("statementMonth", "2026-07");
  const repeatedImport = await json(
    `/api/bank-accounts/${bankAccount.id}/import`,
    { method: "POST", body: repeatedStatementForm },
    201,
  );
  assert.equal(repeatedImport.importedCount, 0);
  assert.equal(repeatedImport.duplicateCount, 2);

  const bankAccounts = await json("/api/bank-accounts");
  assert.equal(
    bankAccounts.find((account) => account.id === bankAccount.id).currentBalance,
    1_247_500,
  );
  const bankEntries = await json(
    `/api/bank-accounts/${bankAccount.id}/entries`,
  );
  assert.equal(bankEntries.length, 2);
  assert.deepEqual(
    bankEntries.map((entry) => entry.type).sort(),
    ["Pemasukan", "Pengeluaran"].sort(),
  );
  assert.equal(
    (await request(`/api/bank-accounts/${bankAccount.id}`, {
      method: "PATCH",
      body: JSON.stringify({ openingBalance: 9_999_999 }),
    })).status,
    409,
  );
  assert.equal(
    (await request(`/api/bank-accounts/${bankAccount.id}`, { method: "DELETE" })).status,
    409,
  );

  const pdfBankAccount = await json(
    "/api/bank-accounts",
    {
      method: "POST",
      body: JSON.stringify({
        bankName: "BCA",
        accountName: "Rekening PDF",
        accountNumber: "9988776655",
        openingBalance: 1_000_000,
        syncMode: "Manual",
      }),
    },
    201,
  );
  const statementPdf = new jsPDF({ unit: "pt", format: "a4" });
  [
    "REKENING TAHAPAN",
    "NO. REKENING : 9988776655",
    "PERIODE : JULI 2026",
    "MATA UANG : IDR",
    "TANGGAL KETERANGAN CBG MUTASI SALDO",
    "21/07 TRSF E-BANKING CR 2107/FTSCY/WS10001",
    "500000.00",
    "PT PELANGGAN",
    "500,000.00 1,500,000.00",
    "22/07 BIAYA ADM 5,000.00 DB 1,495,000.00",
    "SALDO AWAL : 1,000,000.00",
    "MUTASI CR : 500,000.00 1",
    "MUTASI DB : 5,000.00 1",
    "SALDO AKHIR : 1,495,000.00",
  ].forEach((line, index) => {
    statementPdf.text(line, 40, 50 + index * 24);
  });
  const statementPdfBytes = statementPdf.output("arraybuffer");
  const pdfStatementForm = new FormData();
  pdfStatementForm.set(
    "file",
    new File([statementPdfBytes], "e-Statement-BCA-Juli-2026.pdf", {
      type: "application/pdf",
    }),
  );
  pdfStatementForm.set("statementMonth", "2026-07");
  const importedPdfStatement = await json(
    `/api/bank-accounts/${pdfBankAccount.id}/import`,
    { method: "POST", body: pdfStatementForm },
    201,
  );
  assert.equal(importedPdfStatement.importedCount, 2);
  assert.equal(importedPdfStatement.duplicateCount, 0);
  assert.equal(importedPdfStatement.currentBalance, 1_495_000);

  const pdfBankEntries = await json(
    `/api/bank-accounts/${pdfBankAccount.id}/entries`,
  );
  assert.equal(pdfBankEntries.length, 2);
  assert.equal(
    pdfBankEntries.find((entry) => entry.type === "Pemasukan").amount,
    500_000,
  );
  assert.match(
    pdfBankEntries.find((entry) => entry.type === "Pemasukan").description,
    /PT PELANGGAN/,
  );
  assert.equal(
    pdfBankEntries.find((entry) => entry.type === "Pengeluaran").amount,
    5_000,
  );
  assert.equal(
    pdfBankEntries.every((entry) => entry.source === "Manual Upload"),
    true,
  );

  const repeatedPdfForm = new FormData();
  repeatedPdfForm.set(
    "file",
    new File([statementPdfBytes], "e-Statement-BCA-Juli-2026.pdf", {
      type: "application/pdf",
    }),
  );
  repeatedPdfForm.set("statementMonth", "2026-07");
  const repeatedPdfImport = await json(
    `/api/bank-accounts/${pdfBankAccount.id}/import`,
    { method: "POST", body: repeatedPdfForm },
    201,
  );
  assert.equal(repeatedPdfImport.importedCount, 0);
  assert.equal(repeatedPdfImport.duplicateCount, 2);

  const deletablePdfEntry = pdfBankEntries.find(
    (entry) => entry.type === "Pengeluaran",
  );
  assert.ok(deletablePdfEntry);

  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "sri@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  assert.match(lastSetCookie, /Max-Age=28800/);
  assert.equal(
    (
      await request(
        `/api/bank-accounts/${pdfBankAccount.id}/entries/${deletablePdfEntry.id}`,
        { method: "DELETE" },
      )
    ).status,
    403,
  );
  const financeVendor = await json(
    "/api/vendors",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Vendor Tanpa Proyek",
        category: "Supplier Perangkat",
        contact: "081111111111",
        rate: 0,
        status: "Aktif",
      }),
    },
    201,
  );
  assert.equal(financeVendor.name, "Vendor Tanpa Proyek");
  const financeStandaloneBoq = await json(
    "/api/boq/standalone",
    {
      method: "POST",
      body: JSON.stringify({
        title: "BoQ Mandiri Finance",
        client: "",
        status: "Draft",
        items: [],
      }),
    },
    201,
  );
  assert.equal(financeStandaloneBoq.title, "BoQ Mandiri Finance");

  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  await json(
    `/api/bank-accounts/${pdfBankAccount.id}/entries/${deletablePdfEntry.id}`,
    { method: "DELETE" },
    204,
  );
  assert.equal(
    (
      await json(`/api/bank-accounts/${pdfBankAccount.id}/entries`)
    ).some((entry) => entry.id === deletablePdfEntry.id),
    false,
  );

  const mismatchedPeriodForm = new FormData();
  mismatchedPeriodForm.set(
    "file",
    new File([statementPdfBytes], "e-Statement-BCA-Juli-2026.pdf", {
      type: "application/pdf",
    }),
  );
  mismatchedPeriodForm.set("statementMonth", "2026-06");
  assert.equal(
    (
      await request(`/api/bank-accounts/${pdfBankAccount.id}/import`, {
        method: "POST",
        body: mismatchedPeriodForm,
      })
    ).status,
    422,
  );

  const mismatchedAccountForm = new FormData();
  mismatchedAccountForm.set(
    "file",
    new File([statementPdfBytes], "e-Statement-BCA-Juli-2026.pdf", {
      type: "application/pdf",
    }),
  );
  mismatchedAccountForm.set("statementMonth", "2026-07");
  assert.equal(
    (
      await request(`/api/bank-accounts/${bankAccount.id}/import`, {
        method: "POST",
        body: mismatchedAccountForm,
      })
    ).status,
    422,
  );

  const generatedBankTransaction = (
    await json("/api/transactions")
  ).find(
    (entry) =>
      entry.source === "Bank: BCA" &&
      entry.description === "TRANSFER MASUK",
  );
  assert.ok(generatedBankTransaction);
  assert.equal(
    (
      await request(`/api/transactions/${generatedBankTransaction.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description: "Tidak boleh diubah" }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/transactions/${generatedBankTransaction.id}`, {
        method: "DELETE",
      })
    ).status,
    409,
  );

  const olderStatementForm = new FormData();
  olderStatementForm.set(
    "file",
    new File(
      [
        [
          "Tanggal,Keterangan,Mutasi,Saldo,Referensi",
          "30/06/2026,SALDO BULAN LAMA,100000 CR,900000,TRX-OLD",
        ].join("\r\n"),
      ],
      "Mutasi-BCA-Juni-2026.csv",
      { type: "text/csv" },
    ),
  );
  olderStatementForm.set("statementMonth", "2026-06");
  await json(
    `/api/bank-accounts/${bankAccount.id}/import`,
    { method: "POST", body: olderStatementForm },
    201,
  );
  assert.equal(
    (
      await json("/api/bank-accounts")
    ).find((account) => account.id === bankAccount.id).currentBalance,
    1_247_500,
  );

  const settlementTransaction = await json(
    "/api/transactions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        date: "2026-07-10",
        type: "Pemasukan",
        description: "Settlement H+1",
        amount: 333_123,
        source: "Manual",
        category: "Penjualan",
      }),
    },
    201,
  );
  const settlementForm = new FormData();
  settlementForm.set(
    "file",
    new File(
      [
        [
          "Tanggal,Keterangan,Mutasi,Saldo,Referensi",
          "11/07/2026,SETTLEMENT H+1,333123 CR,1333123,TRX-H1",
        ].join("\r\n"),
      ],
      "Settlement-H1.csv",
      { type: "text/csv" },
    ),
  );
  settlementForm.set("statementMonth", "2026-07");
  const settlementImport = await json(
    `/api/bank-accounts/${bankAccount.id}/import`,
    { method: "POST", body: settlementForm },
    201,
  );
  assert.equal(settlementImport.matchedCount, 1);
  const settlementEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.reference === "TRX-H1");
  assert.equal(settlementEntry.reconciliationStatus, "Matched");
  assert.equal(settlementEntry.transactionId, settlementTransaction.id);
  assert.equal(
    (await json("/api/transactions")).filter(
      (entry) =>
        entry.amount === 333_123 && entry.source.startsWith("Bank:"),
    ).length,
    0,
  );

  const ambiguousTransactions = await Promise.all(
    ["2026-07-14", "2026-07-16"].map((date, index) =>
      json(
        "/api/transactions",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            date,
            type: "Pemasukan",
            description: `Kandidat rekonsiliasi ${index + 1}`,
            amount: 444_123,
            source: "Manual",
            category: "Penjualan",
          }),
        },
        201,
      ),
    ),
  );
  const ambiguousForm = new FormData();
  ambiguousForm.set(
    "file",
    new File(
      [
        [
          "Tanggal,Keterangan,Mutasi,Saldo,Referensi",
          "15/07/2026,TRANSFER AMBIGU,444123 CR,1444123,TRX-AMB",
        ].join("\r\n"),
      ],
      "Mutasi-Ambigu.csv",
      { type: "text/csv" },
    ),
  );
  ambiguousForm.set("statementMonth", "2026-07");
  const ambiguousImport = await json(
    `/api/bank-accounts/${bankAccount.id}/import`,
    { method: "POST", body: ambiguousForm },
    201,
  );
  assert.equal(ambiguousImport.matchedCount, 0);
  const ambiguousEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.reference === "TRX-AMB");
  assert.equal(ambiguousEntry.reconciliationStatus, "Imported");
  const candidates = await json(
    `/api/bank-accounts/${bankAccount.id}/entries/${ambiguousEntry.id}/candidates`,
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.id).sort(),
    ambiguousTransactions.map((candidate) => candidate.id).sort(),
  );
  await json(
    `/api/bank-accounts/${bankAccount.id}/entries/${ambiguousEntry.id}/reconcile`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "match",
        transactionId: ambiguousTransactions[0].id,
      }),
    },
  );
  let reconciledEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.id === ambiguousEntry.id);
  assert.equal(reconciledEntry.reconciliationStatus, "Matched");
  assert.equal(reconciledEntry.transactionId, ambiguousTransactions[0].id);
  await json(
    `/api/bank-accounts/${bankAccount.id}/entries/${ambiguousEntry.id}/reconcile`,
    {
      method: "PATCH",
      body: JSON.stringify({ action: "exclude" }),
    },
  );
  reconciledEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.id === ambiguousEntry.id);
  assert.equal(reconciledEntry.reconciliationStatus, "Excluded");
  assert.equal(reconciledEntry.transactionId, undefined);
  await json(
    `/api/bank-accounts/${bankAccount.id}/entries/${ambiguousEntry.id}/reconcile`,
    {
      method: "PATCH",
      body: JSON.stringify({ action: "restore" }),
    },
  );
  reconciledEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.id === ambiguousEntry.id);
  assert.equal(reconciledEntry.reconciliationStatus, "Imported");
  assert.ok(reconciledEntry.transactionId);

  const paidSpkStatementForm = new FormData();
  paidSpkStatementForm.set(
    "file",
    new File(
      [
        [
          "Tanggal,Keterangan,Mutasi,Saldo,Referensi",
          "30/07/2026,PEMBAYARAN VENDOR SPK,600000 DB,647500,TRX-SPK",
        ].join("\r\n"),
      ],
      "Mutasi-SPK.csv",
      { type: "text/csv" },
    ),
  );
  paidSpkStatementForm.set("statementMonth", "2026-07");
  const paidSpkImport = await json(
    `/api/bank-accounts/${bankAccount.id}/import`,
    { method: "POST", body: paidSpkStatementForm },
    201,
  );
  assert.equal(paidSpkImport.matchedCount, 1);
  let paidSpkEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.reference === "TRX-SPK");
  assert.equal(paidSpkEntry.reconciliationStatus, "Matched");
  await json(`/api/spks/${spk.id}/payment`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Belum Dibayar" }),
  });
  paidSpkEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.reference === "TRX-SPK");
  assert.equal(paidSpkEntry.reconciliationStatus, "Imported");
  assert.ok(
    (await json("/api/transactions")).some(
      (entry) =>
        entry.id === paidSpkEntry.transactionId &&
        entry.source === "Bank: BCA",
    ),
  );
  await json(`/api/spks/${spk.id}/payment`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Dibayar", paidDate: "2026-07-29" }),
  });
  paidSpkEntry = (
    await json(`/api/bank-accounts/${bankAccount.id}/entries`)
  ).find((entry) => entry.reference === "TRX-SPK");
  assert.equal(paidSpkEntry.reconciliationStatus, "Matched");
  assert.equal(
    (await json("/api/transactions")).filter(
      (entry) => entry.source === "SPK" && entry.amount === 600_000,
    ).length,
    1,
  );
  assert.equal(
    (await json("/api/transactions")).filter(
      (entry) => entry.source.startsWith("Bank:") && entry.amount === 600_000,
    ).length,
    0,
  );

  const quotationForProcurement = await json(
    `/api/quotations?projectId=${project.id}`,
  );
  const acceptanceAttachment = {
    name: "persetujuan-klien.png",
    mimeType: "image/png",
    contentBase64: Buffer.from("client-approval").toString("base64"),
  };
  await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent", issuedAt: "2019-12-01", validUntil: "2020-01-01" }),
  });
  assert.equal(
    (await request(`/api/quotations/${quotationForProcurement.id}/accept`, {
      method: "POST",
      body: JSON.stringify({ acceptedAt: "2026-07-29", attachment: acceptanceAttachment }),
    })).status,
    409,
  );
  await json(`/api/quotations?projectId=${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Sent", issuedAt: "2026-07-19", validUntil: "2099-12-31" }),
  });
  const acceptedOriginal = await json(
    `/api/quotations/${quotationForProcurement.id}/accept`,
    {
      method: "POST",
      body: JSON.stringify({
        acceptedAt: "2026-07-29",
        attachment: acceptanceAttachment,
      }),
    },
  );
  assert.equal(acceptedOriginal.status, "Accepted");
  assert.equal(acceptedOriginal.quotation.status, "Accepted");
  assert.equal(
    (await request(`/api/vendors/${vendor.id}`, { method: "DELETE" })).status,
    409,
  );
  const disposableVendor = await json("/api/vendors", {
    method: "POST",
    body: JSON.stringify({
      name: "Vendor Tanpa Histori",
      category: "Teknisi Jaringan",
      contact: "081234567899",
      rate: 0,
      status: "Aktif",
    }),
  }, 201);
  await json(`/api/vendors/${disposableVendor.id}`, { method: "DELETE" }, 204);
  assert.equal(
    (
      await request(`/api/boq/items/${boqItem.id}?projectId=${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sellingPrice: 2_000_000 }),
      })
    ).status,
    409,
  );

  const categories = await json("/api/vendor-categories");
  const supplierCategory = categories.find(
    (category) => category.name === "Supplier Perangkat",
  );
  assert.ok(supplierCategory);
  assert.equal(supplierCategory.vendorType, "Supplier");
  const updatedFinanceVendor = await json(`/api/vendors/${financeVendor.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      vendorType: "Supplier",
      categoryIds: [supplierCategory.id],
    }),
  });
  assert.equal(updatedFinanceVendor.vendorType, "Supplier");
  assert.deepEqual(updatedFinanceVendor.categoryIds, [supplierCategory.id]);

  const purchaseOrder = await json(
    "/api/procurement-orders",
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "PO",
        vendorId: financeVendor.id,
        projectId: project.id,
        quotationId: quotationForProcurement.id,
        items: [
          {
            boqItemId: boqItem.id,
            quantity: 1,
            agreedUnitCost: 900_000,
          },
        ],
        terms: [
          { label: "DP 50%", type: "DP", percentage: 50 },
          { label: "Pelunasan", type: "Final", percentage: 50 },
        ],
      }),
    },
    201,
  );
  assert.equal(purchaseOrder.documentType, "PO");
  assert.equal(purchaseOrder.cost, 900_000);
  assert.equal(purchaseOrder.budgetCost, 1_000_000);
  assert.equal(purchaseOrder.paymentStatus, "Belum Dibayar");
  assert.equal(
    (
      await request("/api/procurement-orders", {
        method: "POST",
        body: JSON.stringify({
          documentType: "PO",
          vendorId: financeVendor.id,
          projectId: project.id,
          quotationId: quotationForProcurement.id,
          items: [
            {
              boqItemId: boqItem.id,
              quantity: 1,
              agreedUnitCost: 800_000,
            },
          ],
          terms: [{ label: "Penuh", type: "Final", percentage: 100 }],
        }),
      })
    ).status,
    409,
  );
  await json(`/api/procurement-orders/${purchaseOrder.id}/submit`, {
    method: "POST",
  });
  assert.equal(
    (
      await request(`/api/procurement-orders/${purchaseOrder.id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      })
    ).status,
    422,
  );
  const approvedPurchaseOrder = await json(
    `/api/procurement-orders/${purchaseOrder.id}/approve`,
    {
      method: "POST",
      body: JSON.stringify({
        overrideReason: "Admin menguji workflow demo dengan audit lengkap.",
      }),
    },
  );
  assert.equal(approvedPurchaseOrder.approvalStatus, "Approved");
  assert.equal(
    (
      await json(`/api/procurement-orders/${purchaseOrder.id}/send`, {
        method: "POST",
      })
    ).workflowStatus,
    "Dikirim",
  );

  const paymentEvidence = {
    name: "bukti-transfer.png",
    mimeType: "image/png",
    contentBase64: Buffer.from("payment-evidence").toString("base64"),
  };
  const dpPayment = await json(
    `/api/procurement-orders/${purchaseOrder.id}/payments`,
    {
      method: "POST",
      body: JSON.stringify({
        termId: approvedPurchaseOrder.terms.find((term) => term.type === "DP").id,
        amount: 450_000,
        paidDate: "2026-07-29",
        vendorInvoiceNumber: "TAG-PO-001",
        paymentReference: "BCA-PO-DP-001",
        paymentMethod: "Transfer Bank",
        bankAccountId: bankAccount.id,
        attachment: paymentEvidence,
      }),
    },
    201,
  );
  assert.equal(dpPayment.paid, 450_000);
  assert.equal(dpPayment.paymentStatus, "Dibayar Sebagian");
  assert.equal(
    (
      await request(`/api/procurement-orders/${purchaseOrder.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: 450_000,
          paidDate: "2026-07-29",
          vendorInvoiceNumber: "TAG-PO-002",
          paymentReference: "BCA-PO-FINAL-EARLY",
          paymentMethod: "Transfer Bank",
          bankAccountId: bankAccount.id,
          attachment: paymentEvidence,
        }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await json(`/api/transactions?projectId=${project.id}`)
    ).find(
      (transaction) =>
        transaction.source === "Procurement Payment" &&
        transaction.amount === 450_000,
    )?.amount,
    450_000,
  );

  const receivingEngineer = await json(
    "/api/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Engineer Procurement",
        email: "procurement.engineer@perumnet.id",
        password: "Engineer-Aman-2026",
        role: "Engineer",
        status: "Aktif",
        permissions: {
          dashboard: "view",
          projects: "view",
          boq: "view",
          billing: "view",
          procurement: "manage",
          bast: "manage",
          finance: "none",
          users: "none",
          settings: "view",
        },
      }),
    },
    201,
  );
  await json(`/api/projects/${project.id}/access`, {
    method: "PUT",
    body: JSON.stringify({ userIds: [receivingEngineer.id] }),
  });
  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "procurement.engineer@perumnet.id",
      password: "Engineer-Aman-2026",
      remember: false,
    }),
  });
  const receivedPurchaseOrder = await json(
    `/api/procurement-orders/${purchaseOrder.id}/receipts`,
    {
      method: "POST",
      body: JSON.stringify({
        receiptNumber: "SJ-PO-001",
        receivedAt: "2026-07-30",
        notes: "Perangkat diterima lengkap dan sesuai.",
        items: [
          {
            spkItemId: approvedPurchaseOrder.items[0].id,
            quantity: 1,
          },
        ],
      }),
    },
    201,
  );
  assert.equal(receivedPurchaseOrder.workflowStatus, "Diterima");
  assert.equal(receivedPurchaseOrder.verifiedPayable, 900_000);
  assert.equal(
    (
      await json(`/api/procurement-orders/${purchaseOrder.id}/complete`, {
        method: "POST",
      })
    ).workflowStatus,
    "Selesai",
  );

  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  const completedPurchaseOrder = await json(
    `/api/procurement-orders/${purchaseOrder.id}/payments`,
    {
      method: "POST",
      body: JSON.stringify({
        termId: approvedPurchaseOrder.terms.find((term) => term.type === "Final").id,
        amount: 450_000,
        paidDate: "2026-07-30",
        vendorInvoiceNumber: "TAG-PO-002",
        paymentReference: "BCA-PO-FINAL-001",
        paymentMethod: "Transfer Bank",
        bankAccountId: bankAccount.id,
        attachment: paymentEvidence,
      }),
    },
    201,
  );
  assert.equal(completedPurchaseOrder.paymentStatus, "Lunas");
  assert.equal(completedPurchaseOrder.paid, 900_000);
  const finalPayment = completedPurchaseOrder.payments.find(
    (payment) => payment.paymentReference === "BCA-PO-FINAL-001",
  );
  assert.ok(finalPayment);
  const voidedPurchaseOrder = await json(
    `/api/procurement-orders/${purchaseOrder.id}/payments/${finalPayment.id}/void`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: "Referensi pembayaran salah dan perlu dicatat ulang.",
      }),
    },
  );
  assert.equal(voidedPurchaseOrder.paymentStatus, "Dibayar Sebagian");
  assert.equal(
    (
      await json(`/api/transactions?projectId=${project.id}`)
    ).some(
      (transaction) =>
        transaction.source === "Procurement Reversal" &&
        transaction.amount === 450_000,
    ),
    true,
  );
  assert.equal(
    (
      await request(`/api/procurement-orders/${purchaseOrder.id}/void`, {
        method: "POST",
        body: JSON.stringify({
          reason: "Percobaan void dengan pembayaran DP yang masih aktif.",
        }),
      })
    ).status,
    409,
  );
  const procurementSummary = await json(
    `/api/procurement-orders?projectId=${project.id}&summary=1`,
  );
  assert.equal(procurementSummary.committedVendorCost, 900_000);
  assert.equal(procurementSummary.paid, 450_000);
  assert.equal(procurementSummary.outstanding, 450_000);
  const protectedProfit = await json(
    `/api/profit-shares?projectId=${project.id}`,
  );
  assert.equal(protectedProfit.outstandingVendorCommitment, 450_000);
  assert.equal(
    protectedProfit.distributableProfit,
    Math.max(0, protectedProfit.netProfit - 450_000),
  );
  const procurementPdf = await request(
    `/api/procurement-orders/${purchaseOrder.id}/pdf`,
  );
  assert.equal(procurementPdf.status, 200);
  assert.equal(
    Buffer.from(await procurementPdf.arrayBuffer()).subarray(0, 4).toString(),
    "%PDF",
  );

  const addendum = await json(
    `/api/boq/scopes?projectId=${project.id}`,
    {
      method: "POST",
      body: JSON.stringify({
        title: "Pekerjaan Tambah Konfigurasi",
        issuedAt: "2026-07-30",
        validUntil: "2026-08-13",
        items: [
          {
            category: "Jasa",
            description: "Konfigurasi tambahan controller",
            quantity: 1,
            unit: "paket",
            costPrice: 300_000,
            sellingPrice: 500_000,
          },
        ],
      }),
    },
    201,
  );
  assert.equal(addendum.kind, "Addendum");
  await json(`/api/quotations/${addendum.quotation.id}/send`, {
    method: "POST",
  });
  const acceptedAddendum = await json(
    `/api/quotations/${addendum.quotation.id}/accept`,
    {
      method: "POST",
      body: JSON.stringify({
        acceptedAt: "2026-07-31",
        attachment: {
          ...acceptanceAttachment,
          name: "persetujuan-addendum.png",
        },
      }),
    },
  );
  assert.equal(acceptedAddendum.status, "Accepted");
  assert.equal((await json(`/api/projects/${project.id}`)).value, 2_300_000);

  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "sri@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  const financeSpk = await json(
    "/api/procurement-orders",
    {
      method: "POST",
      body: JSON.stringify({
        documentType: "SPK",
        vendorId: vendor.id,
        projectId: project.id,
        quotationId: addendum.quotation.id,
        items: [
          {
            boqItemId: acceptedAddendum.items[0].id,
            quantity: 1,
            agreedUnitCost: 250_000,
          },
        ],
        terms: [{ label: "Pelunasan", type: "Final", percentage: 100 }],
      }),
    },
    201,
  );
  const editedFinanceSpk = await json(
    `/api/procurement-orders/${financeSpk.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        documentType: "SPK",
        vendorId: vendor.id,
        projectId: project.id,
        quotationId: addendum.quotation.id,
        items: [
          {
            boqItemId: acceptedAddendum.items[0].id,
            quantity: 1,
            agreedUnitCost: 240_000,
          },
        ],
        terms: [{ label: "Pelunasan", type: "Final", percentage: 100 }],
      }),
    },
  );
  assert.equal(editedFinanceSpk.cost, 240_000);
  await json(`/api/procurement-orders/${financeSpk.id}/submit`, {
    method: "POST",
  });
  assert.equal(
    (
      await request(`/api/procurement-orders/${financeSpk.id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      })
    ).status,
    409,
  );
  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  assert.equal(
    (
      await json(`/api/procurement-orders/${financeSpk.id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      })
    ).approvalStatus,
    "Approved",
  );

  assert.equal(
    (
      await request(`/api/bank-accounts/${bankAccount.id}/sync`, {
        method: "POST",
      })
    ).status,
    409,
  );

  const users = await json("/api/users");
  assert.ok(users.some((user) => user.role === "Finance"));
  assert.equal(users.find((user) => user.role === "Admin").permissions.users, "manage");

  const updatedProfile = await json("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({
      name: "Dewa Mahardika",
      email: "admin@perumnet.id",
      phone: "+628123456789",
      jobTitle: "Enterprise Administrator",
      bio: "Mengelola operasional PerumNet Enterprise.",
      address: "Gianyar, Bali",
      birthDate: "1990-01-01",
    }),
  });
  assert.equal(updatedProfile.phone, "+628123456789");

  const settings = await json("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ preferredLanguage: "en", emailNotifications: false }),
  });
  assert.equal(settings.preferredLanguage, "en");
  assert.equal(settings.emailDeliveryConfigured, false);
  assert.equal((await json("/api/auth/session")).user.preferredLanguage, "en");
  const englishCsv = await request(`/api/transactions/report.csv?projectId=${project.id}`);
  assert.equal(englishCsv.status, 200);
  const csvText = await englishCsv.text();
  assert.match(csvText, /"Date","Type","Project"/);
  assert.doesNotMatch(csvText, /"Tanggal"/);
  const englishValidationPdf = await request(`/api/validations/${validation.id}/pdf`);
  assert.equal(englishValidationPdf.status, 200);
  assert.match(csvText, /PROJECT PROFIT DISTRIBUTION - LIFETIME/);
  assert.match(csvText, /COMPANY BANK POSITION/);
  assert.match(csvText, /VENDOR COMMITMENTS/);
  const sopPdf = await request("/api/help/sop.pdf?language=en");
  assert.equal(sopPdf.status, 200);
  assert.equal(sopPdf.headers.get("content-type"), "application/pdf");
  assert.ok((await sopPdf.arrayBuffer()).byteLength > 10_000);

  const avatarForm = new FormData();
  avatarForm.set(
    "file",
    new File(
      [Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")],
      "avatar.png",
      { type: "image/png" },
    ),
  );
  const avatar = await json("/api/profile/avatar", { method: "POST", body: avatarForm });
  assert.match(avatar.avatarUrl, /^\/api\/profile\/avatar\//);
  assert.match(avatar.avatarUrl, /\?v=/);
  const avatarResponse = await request(avatar.avatarUrl);
  assert.equal(avatarResponse.status, 200);
  assert.equal(avatarResponse.headers.get("content-type"), "image/png");
  assert.match(
    avatarResponse.headers.get("cache-control"),
    /private, max-age=3600, immutable/,
  );
  assert.match((await json("/api/profile")).avatarUrl, /\?v=/);
  assert.match((await json("/api/auth/session")).user.avatarUrl, /\?v=/);
  assert.match(
    (await json("/api/users")).find((entry) => entry.id === "user-1").avatarUrl,
    /\?v=/,
  );

  const readOnlyUser = await json(
    "/api/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Viewer Integrasi",
        email: "viewer.integration@perumnet.id",
        password: "Viewer-Aman-2026",
        role: "Project Manager",
        status: "Aktif",
        permissions: {
          dashboard: "view",
          projects: "view",
          boq: "none",
          billing: "none",
          procurement: "none",
          bast: "none",
          finance: "none",
          users: "none",
          settings: "view",
        },
      }),
    },
    201,
  );
  assert.equal(readOnlyUser.permissions.projects, "view");
  assert.equal(readOnlyUser.permissions.bast, "none");
  const emailDeliveries = await json("/api/notifications/email");
  assert.ok(
    emailDeliveries.some(
      (delivery) =>
        delivery.recipient === "viewer.integration@perumnet.id" &&
        delivery.eventType === "account_created" &&
        delivery.status === "skipped",
    ),
  );
  const testEmail = await json("/api/notifications/email/test", {
    method: "POST",
  });
  assert.equal(testEmail.configured, false);
  assert.equal(testEmail.status, "skipped");
  await json(`/api/projects/${project.id}/access`, {
    method: "PUT",
    body: JSON.stringify({ userIds: [readOnlyUser.id] }),
  });
  const projectAccess = await json(`/api/projects/${project.id}/access`);
  assert.equal(projectAccess.find((candidate) => candidate.id === readOnlyUser.id).assigned, true);
  const audit = await json("/api/audit-logs");
  assert.ok(audit.some((entry) => entry.entity === "invoice"));

  assert.equal(
    (await request(`/api/boq/items/${boqItem.id}?projectId=${project.id}`, {
      method: "DELETE",
    })).status,
    409,
  );
  await json(`/api/boq/templates/${template.id}`, { method: "DELETE" }, 204);
  assert.equal(
    (await json("/api/boq/templates")).some(
      (savedTemplate) => savedTemplate.id === template.id,
    ),
    false,
  );
  assert.equal(
    (await request(`/api/boq/templates/${template.id}`)).status,
    404,
  );
  assert.equal(
    (await request(`/api/boq/templates/${template.id}`, {
      method: "DELETE",
    })).status,
    404,
  );

  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ayu@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  assert.equal(
    (
      await request(`/api/invoices/${invoice.id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "Lunas",
          paidDate: "2026-07-29",
        }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/spks/${spk.id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "Dibayar",
          paidDate: "2026-07-29",
        }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({ amount: 860_000 }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/invoices/${invoice.id}`, {
        method: "DELETE",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/spks/${spk.id}`, {
        method: "PATCH",
        body: JSON.stringify({ scope: "Tidak boleh mengubah kas" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/spks/${spk.id}`, {
        method: "DELETE",
      })
    ).status,
    403,
  );
  const projectManagerProject = await json("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Proyek Buatan Project Manager",
      client: "Klien PM",
      location: "Denpasar",
      status: "Draft",
      value: 0,
    }),
  }, 201);
  assert.equal(
    (
      await request("/api/vendors", {
        method: "POST",
        body: JSON.stringify({
          name: "Vendor Tidak Diizinkan",
          category: "Teknisi",
          contact: "081234567899",
          rate: 0,
          status: "Aktif",
        }),
      })
    ).status,
    403,
  );
  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  const viewerLogin = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "viewer.integration@perumnet.id",
      password: "Viewer-Aman-2026",
      remember: false,
    }),
  });
  assert.equal(viewerLogin.user.permissions.projects, "view");
  const viewerProjects = await json("/api/projects");
  assert.deepEqual(
    viewerProjects.map((item) => item.id).sort(),
    [project.id].sort(),
  );
  assert.ok(viewerProjects.every((item) => item.payment === "Tidak Diizinkan"));
  assert.equal((await request(`/api/projects/${project.id}`)).status, 200);
  assert.equal((await request(`/api/projects/${project.id}/access`)).status, 403);
  assert.equal((await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Tidak Boleh Dibuat",
      client: "Klien",
      location: "Bali",
      status: "Draft",
      value: 0,
    }),
  })).status, 403);
  assert.equal((await request("/api/bast")).status, 403);
  assert.equal((await request("/api/transactions/report.pdf")).status, 403);
  assert.equal((await request("/api/bank-accounts")).status, 403);
  assert.equal((await request("/api/users")).status, 403);
  assert.equal((await request(`/api/invoices/${invoice.id}`)).status, 403);
  assert.equal(
    (await request("/api/profile/avatar/user-1")).status,
    403,
  );
  assert.deepEqual(await json("/api/search?q=Vendor"), []);
  assert.equal((await json("/api/search?q=Proyek%20Integrasi")).length, 1);

  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "agus@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  assert.equal((await request("/api/finance/summary")).status, 403);
  assert.equal((await request("/api/users")).status, 403);
  const engineerProjects = await json("/api/projects");
  assert.deepEqual(
    engineerProjects.map((item) => item.id).sort(),
    ["project-1", "project-2", "project-4"].sort(),
  );
  assert.equal(engineerProjects[0].value, 0);
  assert.equal(engineerProjects[0].payment, "Tidak Diizinkan");
  assert.equal(
    (await request("/api/projects/project-1/quotation.pdf")).status,
    403,
  );
  assert.equal((await request(`/api/boq?projectId=${project.id}`)).status, 404);
  assert.equal((await request(`/api/spks/${spk.id}/pdf`)).status, 404);

  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  await json(`/api/projects/${projectManagerProject.id}/access`, {
    method: "PUT",
    body: JSON.stringify({ userIds: [] }),
  });
  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ayu@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  assert.equal(
    (await request(`/api/projects/${projectManagerProject.id}`)).status,
    404,
  );
  await json("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  await json(`/api/projects/${project.id}`, { method: "DELETE" }, 204);
  await json(`/api/projects/${taxProject.id}`, { method: "DELETE" }, 204);
  await json(`/api/projects/${projectManagerProject.id}`, { method: "DELETE" }, 204);
  assert.equal((await request(`/api/projects/${project.id}`)).status, 404);
  assert.equal((await request(`/api/invoices/${invoice.id}`)).status, 404);
  assert.equal((await request(`/api/spks/${spk.id}`)).status, 404);
  assert.equal((await request(`/api/bast/${bast.id}`)).status, 404);
  assert.equal(
    (await json("/api/transactions")).some(
      (entry) => entry.projectId === project.id,
    ),
    false,
  );
}, { timeout: 45_000 });
