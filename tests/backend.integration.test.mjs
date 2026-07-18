import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";

let server;
let baseUrl;
let databasePath;
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
        category: "Jasa",
        description: "Instalasi integrasi",
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

  const template = await json(
    "/api/boq/templates",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Template Integrasi",
        items: boq.items,
      }),
    },
    201,
  );
  assert.equal((await json(`/api/boq/templates/${template.id}`)).items.length, 1);

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
  const paidInvoice = await json(`/api/invoices/${invoice.id}/payment`, {
    method: "POST",
    body: JSON.stringify({ paidDate: "2026-07-18" }),
  });
  assert.equal(paidInvoice.status, "Lunas");
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
  assert.equal((await request(`/api/spks/${spk.id}/pdf`)).status, 200);

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
        engineerName: "Dewa Mahardika",
        status: "Final",
      }),
    },
    201,
  );
  assert.equal((await request(`/api/bast/${bast.id}/pdf`)).status, 200);

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
      }),
    },
    201,
  );
  assert.equal(transaction.project, "Proyek Integrasi Backend");
  const finance = await json(`/api/finance/summary?projectId=${project.id}`);
  assert.equal(finance.income, 750_000);
  assert.equal(finance.expense, 125_000);
  assert.equal(finance.profit, 625_000);

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
  assert.equal((await json("/api/auth/session")).user.preferredLanguage, "en");

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
  const avatarResponse = await request(avatar.avatarUrl);
  assert.equal(avatarResponse.status, 200);
  assert.equal(avatarResponse.headers.get("content-type"), "image/png");

  const readOnlyUser = await json(
    "/api/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Viewer Integrasi",
        email: "viewer.integration@perumnet.id",
        password: "Viewer-Aman-2026",
        role: "Engineer",
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
  const audit = await json("/api/audit-logs");
  assert.ok(audit.some((entry) => entry.entity === "invoice"));

  await json(`/api/boq/items/${boqItem.id}?projectId=${project.id}`, { method: "DELETE" }, 204);
  await json(`/api/boq/templates/${template.id}`, { method: "DELETE" }, 204);

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
  assert.equal((await request("/api/projects")).status, 200);
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
  assert.equal((await request("/api/users")).status, 403);
  assert.deepEqual(await json("/api/search?q=Vendor"), []);

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
  assert.equal((await request("/api/projects")).status, 200);
}, { timeout: 45_000 });
