import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { after, test } from "node:test";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";
let mockServer;
let pageServer;
let mockMode = "happy";
let mockRequests = [];

const pageMarker = "PN-PAGE-MARKER-RAP2260-HARGA-1600000";
const productPageHtml = `<html><head><title>Ruijie RG-RAP2260</title>
  <style>body { color: red }</style>
  <script>var tracking = "PN-SCRIPT-NOISE-SHOULD-BE-STRIPPED";</script></head>
  <body><h1>Ruijie RG-RAP2260 Access Point WiFi 6</h1>
  <p>${pageMarker} — dijual seharga Rp1.600.000 termasuk PPN.</p></body></html>`;

const happyRecommendation = {
  brand: "Ruijie",
  productCategory: "Networking",
  boqRole: "Perangkat",
  nameId: "Access Point WiFi 6 Indoor",
  nameEn: "Indoor WiFi 6 Access Point",
  model: "RG-RAP2260",
  sku: "RG-RAP2260-GEM",
  unit: "unit",
  specifications: ["WiFi 6 dual-band", "PoE 802.3at"],
  marketPrice: { min: 1_500_000, max: 1_900_000, currency: "IDR" },
  recommendedCostPrice: 1_600_000,
  margin1Percent: 20,
  margin2Percent: 30,
  confidence: 85,
  assumptions: ["Harga berdasarkan marketplace resmi"],
  warnings: ["Verifikasi garansi distributor"],
};

function researchPayload() {
  return {
    modelVersion: "gemini-mock",
    candidates: [{
      content: {
        role: "model",
        parts: [{ text: "Riset pasar: Ruijie RG-RAP2260 dijual sekitar Rp1,6 juta." }],
      },
    }],
  };
}

function formatPayload(recommendation) {
  return {
    modelVersion: "gemini-mock",
    candidates: [{
      content: { role: "model", parts: [{ text: JSON.stringify(recommendation) }] },
    }],
  };
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const listener = createNetServer();
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

async function startApp(extraEnv) {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-catalog-ai-gemini-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-catalog-ai-gemini-uploads-${process.pid}-${Date.now()}`;
  cookie = "";
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
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
}

async function stopApp() {
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
  server = undefined;
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
}

async function login() {
  const result = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@perumnet.id", password: "perumnet123" }),
  });
  assert.equal(result.user.role, "Admin");
}

async function pollRun(runId, targetStatuses, deadlineMs = 15_000) {
  const deadline = Date.now() + deadlineMs;
  let run;
  while (Date.now() < deadline) {
    run = await json(`/api/catalog/ai/runs/${runId}`);
    if (targetStatuses.includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Run ${runId} stuck in status ${run?.status}`);
}

after(async () => {
  if (server) await stopApp();
  if (mockServer) {
    mockServer.closeAllConnections?.();
    await new Promise((resolve) => mockServer.close(resolve));
    mockServer = undefined;
  }
  if (pageServer) {
    pageServer.closeAllConnections?.();
    await new Promise((resolve) => pageServer.close(resolve));
    pageServer = undefined;
  }
});

test(
  "catalog AI on Gemini fails closed without a key and burns no quota",
  { timeout: 120_000 },
  async () => {
    await startApp({ GEMINI_API_KEY: "" });
    await login();

    const analyze = await request("/api/catalog/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ query: "Ruijie access point WiFi 6 indoor" }),
    });
    assert.equal(analyze.status, 503);
    const payload = await analyze.json();
    assert.equal(payload.error.code, "GEMINI_NOT_CONFIGURED");

    const runs = await json("/api/catalog/ai");
    assert.deepEqual(runs, []);

    await stopApp();
  },
);

test(
  "catalog AI on Gemini runs the two-step free-tier analysis with page fetch, failure handling, sweeper, and approval",
  { timeout: 240_000 },
  async () => {
    const mockPort = await freePort();
    mockServer = createHttpServer((incoming, response) => {
      let raw = "";
      incoming.on("data", (chunk) => { raw += chunk; });
      incoming.on("end", () => {
        let body = {};
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          body = {};
        }
        mockRequests.push({
          url: incoming.url,
          apiKey: incoming.headers["x-goog-api-key"],
          hasTools: Array.isArray(body.tools) && body.tools.length > 0,
          responseSchema: body.generationConfig?.responseSchema ?? null,
          raw,
        });
        if (mockMode === "hang") return;
        if (incoming.headers["x-goog-api-key"] !== "test-gemini-key") {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "API key salah." } }));
          return;
        }
        if (!incoming.url.includes(":generateContent")) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Endpoint tidak dikenal." } }));
          return;
        }
        let payload;
        if (body.generationConfig?.responseSchema) {
          let recommendation = happyRecommendation;
          if (mockMode === "bad") {
            recommendation = { ...happyRecommendation };
            delete recommendation.sku;
          }
          payload = formatPayload(recommendation);
        } else {
          payload = researchPayload();
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      });
    });
    await new Promise((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));

    const pagePort = await freePort();
    pageServer = createHttpServer((incoming, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(productPageHtml);
    });
    await new Promise((resolve) => pageServer.listen(pagePort, "127.0.0.1", resolve));
    const productPageUrl = `http://127.0.0.1:${pagePort}/produk/rap2260`;

    await startApp({
      GEMINI_API_KEY: "test-gemini-key",
      GEMINI_BASE_URL: `http://127.0.0.1:${mockPort}`,
      CATALOG_AI_TIMEOUT_MS: "2000",
      CATALOG_AI_STALE_MS: "4000",
      // Test-only seam: the mock product page server lives on 127.0.0.1, which
      // the sourceUrl guard would otherwise reject.
      CATALOG_AI_ALLOW_PRIVATE_SOURCE: "1",
    });
    await login();

    const catalog = await json("/api/catalog?includeInactive=true");
    const networking = catalog.categories.find(
      (entry) => entry.boqRole === "Perangkat" && entry.name === "Networking",
    );
    assert.ok(networking);
    const brand = await json("/api/catalog/brands", {
      method: "POST",
      body: JSON.stringify({
        categoryId: networking.id,
        name: "Ruijie",
        status: "Aktif",
        sortOrder: 10,
      }),
    }, 201);

    // a. Happy path: 202 + Running, poll to Draft, fetched source page persisted.
    mockMode = "happy";
    mockRequests = [];
    const startedRun = await json("/api/catalog/ai/analyze", {
      method: "POST",
      body: JSON.stringify({
        query: "Ruijie RG-RAP2260 access point WiFi 6",
        sourceUrl: productPageUrl,
      }),
    }, 202);
    assert.equal(startedRun.status, "Running");
    assert.ok(startedRun.id);
    const draftRun = await pollRun(startedRun.id, ["Draft", "Failed"]);
    assert.equal(draftRun.status, "Draft");
    assert.equal(draftRun.model, "gemini-mock");
    assert.equal(draftRun.confidence, 85);
    assert.equal(draftRun.recommendation.sku, "RG-RAP2260-GEM");
    assert.equal(draftRun.recommendation.recommendedCostPrice, 1_600_000);
    assert.equal(draftRun.recommendation.price1, 1_920_000);
    assert.equal(draftRun.recommendation.price2, 2_080_000);
    assert.ok(draftRun.expiresAt);
    assert.deepEqual(
      draftRun.sources.map((source) => ({ url: source.url, title: source.title })),
      [{ url: productPageUrl, title: "127.0.0.1" }],
    );

    // The two-step free-tier contract: plain research first (no tools, page
    // text inlined), then schema-constrained formatting.
    assert.equal(mockRequests.length, 2);
    assert.ok(mockRequests[0].url.includes("/v1beta/models/gemini-2.5-flash:generateContent"));
    assert.equal(mockRequests[0].apiKey, "test-gemini-key");
    assert.equal(mockRequests[0].hasTools, false);
    assert.equal(mockRequests[0].responseSchema, null);
    assert.ok(mockRequests[0].raw.includes(pageMarker));
    assert.equal(mockRequests[0].raw.includes("PN-SCRIPT-NOISE-SHOULD-BE-STRIPPED"), false);
    assert.equal(mockRequests[1].hasTools, false);
    assert.equal(mockRequests[1].raw.includes(pageMarker), false);
    assert.equal(mockRequests[1].responseSchema?.type, "object");
    assert.equal("additionalProperties" in mockRequests[1].responseSchema, false);
    assert.deepEqual(
      mockRequests[1].responseSchema.properties.boqRole.enum,
      ["Perangkat", "Material", "Jasa", "Mobilitas"],
    );

    // b. Structurally invalid step-2 output marks the run Failed with the zod message.
    mockMode = "bad";
    const badRun = await json("/api/catalog/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ query: "Perangkat dengan output tidak valid" }),
    }, 202);
    const failedRun = await pollRun(badRun.id, ["Draft", "Failed"]);
    assert.equal(failedRun.status, "Failed");
    assert.match(failedRun.errorMessage, /Struktur rekomendasi AI tidak valid/);
    assert.match(failedRun.errorMessage, /sku/);

    // c. A hanging upstream times out, and a new analyze is not blocked afterwards.
    mockMode = "hang";
    const hangRun = await json("/api/catalog/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ query: "Perangkat dengan upstream menggantung" }),
    }, 202);
    assert.equal(hangRun.status, "Running");
    const timedOutRun = await pollRun(hangRun.id, ["Failed"], 20_000);
    assert.equal(timedOutRun.status, "Failed");
    assert.ok(timedOutRun.errorMessage);

    mockMode = "happy";
    const secondRun = await json("/api/catalog/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ query: "Ruijie RG-RAP2260 unit kedua" }),
    }, 202);
    assert.equal(secondRun.status, "Running");
    const secondDraft = await pollRun(secondRun.id, ["Draft", "Failed"]);
    assert.equal(secondDraft.status, "Draft");
    // Without a sourceUrl there is no fetched page, so no sources are stored.
    assert.deepEqual(secondDraft.sources, []);

    // d. Approve with overridden fields creates the catalog item with the overrides.
    const approved = await json(`/api/catalog/ai/runs/${draftRun.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        categoryId: networking.id,
        brandId: brand.id,
        sku: "RG-RAP2260-CUSTOM",
        name: "Access Point Kustom Review",
        model: "RG-RAP2260 Rev B",
        unit: "unit",
        costPrice: 1_750_000,
        margin1Percent: 25,
        margin2Percent: 40,
      }),
    }, 201);
    assert.equal(approved.status, "Approved");
    assert.ok(approved.catalogItemId);

    const catalogAfter = await json("/api/catalog?includeInactive=true");
    const item = catalogAfter.items.find((entry) => entry.id === approved.catalogItemId);
    assert.ok(item);
    assert.equal(item.sku, "RG-RAP2260-CUSTOM");
    assert.equal(item.name, "Access Point Kustom Review");
    assert.equal(item.model, "RG-RAP2260 Rev B");
    assert.equal(item.brand, "Ruijie");
    assert.equal(item.costPrice, 1_750_000);
    assert.equal(item.margin1Percent, 25);
    assert.equal(item.margin2Percent, 40);
    assert.equal(item.price1, Math.round(1_750_000 * 1.25));
    assert.equal(item.price2, Math.round(1_750_000 * 1.4));

    // e. Approving a second draft with an already-used SKU is rejected.
    const duplicate = await request(`/api/catalog/ai/runs/${secondDraft.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        categoryId: networking.id,
        brandId: brand.id,
        sku: "RG-RAP2260-CUSTOM",
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "SKU_EXISTS");

    await stopApp();
    mockServer.closeAllConnections?.();
    await new Promise((resolve) => mockServer.close(resolve));
    mockServer = undefined;
    pageServer.closeAllConnections?.();
    await new Promise((resolve) => pageServer.close(resolve));
    pageServer = undefined;
  },
);
