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
let mockMode = "happy";
let mockRequests = [];

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
      groundingMetadata: {
        webSearchQueries: ["harga Ruijie RG-RAP2260"],
        groundingChunks: [
          {
            web: {
              uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123",
              title: "tokopedia.com",
            },
          },
          { web: { uri: "https://example.com/produk-rap2260", title: "Contoh Produk" } },
          {
            web: {
              uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123",
              title: "tokopedia.com",
            },
          },
        ],
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
});

test(
  "catalog AI on Gemini fails closed without a key and burns no quota",
  { timeout: 120_000 },
  async () => {
    await startApp({
      CATALOG_AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "",
      OPENAI_API_KEY: "",
    });
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
  "catalog AI on Gemini runs the two-step grounded analysis and surfaces zod failures",
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
        });
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
        if (Array.isArray(body.tools) && body.tools.length > 0) {
          payload = researchPayload();
        } else {
          let recommendation = happyRecommendation;
          if (mockMode === "bad") {
            recommendation = { ...happyRecommendation };
            delete recommendation.sku;
          }
          payload = formatPayload(recommendation);
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      });
    });
    await new Promise((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));

    await startApp({
      CATALOG_AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-gemini-key",
      GEMINI_BASE_URL: `http://127.0.0.1:${mockPort}`,
      OPENAI_API_KEY: "",
      CATALOG_AI_TIMEOUT_MS: "2000",
      CATALOG_AI_STALE_MS: "4000",
    });
    await login();

    // a. Happy path: 202 + Running, poll to Draft, grounded sources persisted.
    mockMode = "happy";
    mockRequests = [];
    const startedRun = await json("/api/catalog/ai/analyze", {
      method: "POST",
      body: JSON.stringify({
        query: "Ruijie RG-RAP2260 access point WiFi 6",
        sourceUrl: "https://example.com/rap2260",
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
      draftRun.sources.map((source) => ({ url: source.url, title: source.title }))
        .sort((left, right) => left.url.localeCompare(right.url)),
      [
        { url: "https://example.com/produk-rap2260", title: "Contoh Produk" },
        {
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123",
          title: "tokopedia.com",
        },
      ],
    );

    // The two-step contract: research with google_search first, then schema formatting.
    assert.equal(mockRequests.length, 2);
    assert.ok(mockRequests[0].url.includes("/v1beta/models/gemini-2.5-flash:generateContent"));
    assert.equal(mockRequests[0].apiKey, "test-gemini-key");
    assert.equal(mockRequests[0].hasTools, true);
    assert.equal(mockRequests[0].responseSchema, null);
    assert.equal(mockRequests[1].hasTools, false);
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

    await stopApp();
    mockServer.closeAllConnections?.();
    await new Promise((resolve) => mockServer.close(resolve));
    mockServer = undefined;
  },
);
