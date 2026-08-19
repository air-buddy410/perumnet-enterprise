// The dashboard project map, and the five things about it that are easy to get
// wrong and expensive to get wrong:
//
//   1. Access scoping. A map is a new way to ask "which projects exist", and a
//      Project Manager must not be able to reach through it to the coordinates
//      of work they cannot otherwise see. The pins come from GET /api/projects
//      and from nothing else, so the map inherits `projectScopeCondition`; this
//      file proves the list, the single-project read, and the pin write are all
//      scoped, and that an inaccessible project is a 404 rather than a 403 that
//      would confirm the id exists.
//   2. The migration. `server/db/README.md` says every column needs both a
//      `schemaSql` entry and an `ensureColumn` step, and that only doing the
//      first has bitten this project twice. The server here boots against a
//      database whose `projects` table predates the five new columns, exactly
//      like demo and production will.
//   3. Coordinate validation on write — out of range, and a half pair.
//   4. A geocoding failure still saves the project. Nominatim being slow, rate
//      limited or down may never turn into a failed save.
//   5. A pin somebody placed by hand is never overwritten by a later guess.
//
// Plus the two clauses of the Nominatim usage policy that are load-bearing and
// invisible: one request per second, and a User-Agent naming the application
// and a contact address.
//
// Nominatim itself is never contacted. NOMINATIM_ENDPOINT points at a local
// stub that answers from a fixture table, records what it was asked, and can be
// told to fail.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let database;
let geocoder;
let geocoderUrl;
let cookie = "";

const ADMIN = { email: "admin@perumnet.id", password: "perumnet123" };
const MANAGER = {
  name: "Manajer Peta Regresi",
  email: "peta.pm@perumnet.id",
  password: "Peta-Manajer-2026",
  role: "Project Manager",
};

// The project row that already exists in the legacy-shaped database, written
// before the coordinate columns were invented.
const LEGACY_PROJECT_ID = "legacy-map-project";

const context = { managerId: null, ownProjectId: null, foreignProjectId: null };

// What the stub geocoder answers for a given location text. Everything not
// listed here comes back as "nothing found"; the one FAILING_LOCATION comes
// back as a 503, which is what a rate-limited or unwell Nominatim looks like.
const FIXTURES = {
  "Ubud, Gianyar": { lat: "-8.5069", lon: "115.2625", display_name: "Ubud, Gianyar, Bali, Indonesia" },
  "Amlapura, Karangasem": { lat: "-8.4489", lon: "115.6122", display_name: "Amlapura, Karangasem, Bali, Indonesia" },
  "Singaraja, Buleleng": { lat: "-8.1120", lon: "115.0882", display_name: "Singaraja, Buleleng, Bali, Indonesia" },
  "Denpasar, Bali": { lat: "-8.6500", lon: "115.2167", display_name: "Denpasar, Bali, Indonesia" },
};
const FAILING_LOCATION = "Lokasi Yang Tidak Dikenali";

const geocoderCalls = [];

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
  if (cookie) headers.set("Cookie", cookie);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
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

async function errorOf(path, options = {}) {
  const response = await request(path, options);
  const payload = await response.json().catch(() => null);
  return { status: response.status, code: payload?.error?.code, message: payload?.error?.message };
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

function createProject(name, location, status = "Aktif") {
  return json(
    "/api/projects",
    { method: "POST", body: JSON.stringify({ name, client: "Klien Peta", location, status, value: 0 }) },
    201,
  );
}

/**
 * A `projects` table exactly as it was before this change: no latitude, no
 * longitude, no coordinate bookkeeping. `CREATE TABLE IF NOT EXISTS` in
 * `schemaSql` will skip it, so the five columns can only arrive through the
 * `ensureColumn` migration — which is the whole point of the exercise.
 */
async function seedLegacyDatabase(path) {
  const legacy = createClient({ url: `file:${path}` });
  await legacy.execute(`CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Aktif', 'Selesai', 'Draft')),
    start_date TEXT,
    target_date TEXT,
    value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
    manager_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const timestamp = new Date().toISOString();
  await legacy.execute({
    sql: "INSERT INTO projects (id,code,name,client,location,status,value,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [
      LEGACY_PROJECT_ID,
      "PN-2501-901",
      "Proyek Warisan Sebelum Peta",
      "Klien Warisan",
      "Denpasar, Bali",
      "Aktif",
      12_500_000,
      timestamp,
      timestamp,
    ],
  });
  legacy.close();
}

function startGeocoderStub() {
  return new Promise((resolve) => {
    const stub = createHttpServer((request_, response) => {
      const url = new URL(request_.url, "http://127.0.0.1");
      const query = url.searchParams.get("q") ?? "";
      geocoderCalls.push({
        at: Date.now(),
        query,
        countrycodes: url.searchParams.get("countrycodes"),
        limit: url.searchParams.get("limit"),
        userAgent: request_.headers["user-agent"] ?? "",
      });
      if (query.includes(FAILING_LOCATION)) {
        response.writeHead(503, { "Content-Type": "text/plain" });
        response.end("Service Unavailable");
        return;
      }
      const hit = FIXTURES[query];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(hit ? [hit] : []));
    });
    stub.listen(0, "127.0.0.1", () => resolve(stub));
  });
}

before(async () => {
  geocoder = await startGeocoderStub();
  geocoderUrl = `http://127.0.0.1:${geocoder.address().port}/search`;

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-project-map-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-project-map-uploads-${process.pid}-${Date.now()}`;

  // The database exists, and it is old, before the server ever sees it.
  await seedLegacyDatabase(databasePath);

  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        // This is the one file that exercises geocoding, and it does so against
        // the local stub above. Nominatim is never contacted.
        GEOCODING_ENABLED: "true",
        NOMINATIM_ENDPOINT: geocoderUrl,
        NOMINATIM_CONTACT_EMAIL: "it@perumnet.id",
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
  const manager = await json(
    "/api/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: MANAGER.name,
        email: MANAGER.email,
        password: MANAGER.password,
        role: MANAGER.role,
        status: "Aktif",
      }),
    },
    201,
  );
  context.managerId = manager.id;

  const own = await createProject("Peta Proyek Manajer", "Ubud, Gianyar");
  context.ownProjectId = own.id;
  await json(`/api/projects/${own.id}/access`, {
    method: "PUT",
    body: JSON.stringify({ userIds: [manager.id] }),
  });

  const foreign = await createProject("Peta Proyek Tim Lain", "Amlapura, Karangasem");
  context.foreignProjectId = foreign.id;
  await json(`/api/projects/${foreign.id}/access`, {
    method: "PUT",
    body: JSON.stringify({ userIds: [] }),
  });
}, { timeout: 90_000 });

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
  if (geocoder) await new Promise((resolve) => geocoder.close(resolve));
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2. The migration, on a database that already existed.
// ---------------------------------------------------------------------------

test("a projects table that predates the map gains the coordinate columns and keeps its rows", async () => {
  const columns = await database.execute("PRAGMA table_info(projects)");
  const names = columns.rows.map((row) => String(row.name));
  for (const column of [
    "latitude",
    "longitude",
    "coordinate_source",
    "geocoded_query",
    "geocoded_label",
  ]) {
    assert.ok(
      names.includes(column),
      `booting migrated the existing table: expected ${column} in ${names.join(", ")}`,
    );
  }

  // The row written before the columns existed is untouched, not recreated.
  const legacy = await database.execute({
    sql: "SELECT name,location,value,latitude,longitude,coordinate_source FROM projects WHERE id=?",
    args: [LEGACY_PROJECT_ID],
  });
  assert.equal(legacy.rows.length, 1, "the pre-existing project survived the migration");
  assert.equal(String(legacy.rows[0].name), "Proyek Warisan Sebelum Peta");
  assert.equal(Number(legacy.rows[0].value), 12_500_000);
  assert.equal(legacy.rows[0].latitude, null, "an old row starts with no pin, not a made-up one");
  assert.equal(legacy.rows[0].coordinate_source, null);

  // And the columns are usable through the application, not just present.
  await loginAsAdmin();
  const pinned = await json(`/api/projects/${LEGACY_PROJECT_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ latitude: -8.65, longitude: 115.2167 }),
  });
  assert.equal(pinned.latitude, -8.65);
  assert.equal(pinned.longitude, 115.2167);
  assert.equal(pinned.coordinateSource, "manual");
});

// ---------------------------------------------------------------------------
// 1. Access scoping — the requirement most likely to be got wrong.
// ---------------------------------------------------------------------------

test("a Project Manager's map carries only their own projects, and cannot be made to carry more", async () => {
  await loginAsAdmin();
  const adminView = await json("/api/projects");
  const adminIds = adminView.map((project) => project.id);
  assert.ok(adminIds.includes(context.ownProjectId));
  assert.ok(adminIds.includes(context.foreignProjectId));
  assert.ok(
    adminView.every((project) => "latitude" in project && "coordinateSource" in project),
    "the pins ride on the ordinary project list rather than a second endpoint",
  );

  await login(MANAGER.email, MANAGER.password);
  const managerView = await json("/api/projects");
  assert.deepEqual(
    managerView.map((project) => project.id),
    [context.ownProjectId],
    "the list the map draws from is already narrowed to the manager's projects",
  );
  assert.equal(typeof managerView[0].latitude, "number", "their own project keeps its pin");

  // Reading the other team's project directly, and writing a pin onto it, are
  // both refused — and refused as "not found", so the response cannot be used
  // to confirm that the id exists.
  const read = await errorOf(`/api/projects/${context.foreignProjectId}`);
  assert.equal(read.status, 404);
  assert.equal(read.code, "NOT_FOUND");

  const write = await errorOf(`/api/projects/${context.foreignProjectId}`, {
    method: "PATCH",
    body: JSON.stringify({ latitude: -8.4489, longitude: 115.6122 }),
  });
  assert.equal(write.status, 404, "a pin write is scoped exactly like every other project write");
  assert.equal(write.code, "NOT_FOUND");

  // The refusal really did refuse: the foreign project's pin is still the
  // geocoded one, not the manager's.
  const stored = await database.execute({
    sql: "SELECT coordinate_source FROM projects WHERE id=?",
    args: [context.foreignProjectId],
  });
  assert.equal(String(stored.rows[0].coordinate_source), "geocoded");

  await loginAsAdmin();
});

// ---------------------------------------------------------------------------
// 3. Coordinate validation.
// ---------------------------------------------------------------------------

test("a coordinate outside the possible range, or half of a pair, is refused with its own message", async () => {
  await loginAsAdmin();
  const project = await createProject("Peta Validasi Koordinat", "Singaraja, Buleleng");

  const tooFarNorth = await errorOf(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ latitude: 91, longitude: 115 }),
  });
  assert.equal(tooFarNorth.status, 422);
  assert.equal(tooFarNorth.code, "INVALID_COORDINATE");
  assert.match(tooFarNorth.message, /-90 dan 90/);

  const tooFarEast = await errorOf(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ latitude: -8.5, longitude: 180.5 }),
  });
  assert.equal(tooFarEast.status, 422);
  assert.equal(tooFarEast.code, "INVALID_COORDINATE");
  assert.match(tooFarEast.message, /-180 dan 180/);

  // A latitude with no longitude is not a location. It is refused rather than
  // half-stored, because half-storing it would look like a placed pin.
  const halfPair = await errorOf(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ latitude: -8.5 }),
  });
  assert.equal(halfPair.status, 422);
  assert.equal(halfPair.code, "INCOMPLETE_COORDINATE");

  const halfPairOnCreate = await errorOf("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Peta Setengah Pasangan",
      client: "Klien Peta",
      location: "Ubud, Gianyar",
      longitude: 115.26,
    }),
  });
  assert.equal(halfPairOnCreate.status, 422);
  assert.equal(halfPairOnCreate.code, "INCOMPLETE_COORDINATE");

  // None of the refusals left anything behind.
  const untouched = await json(`/api/projects/${project.id}`);
  assert.equal(untouched.latitude, -8.112, "the geocoded pin is exactly where it was");
  assert.equal(untouched.coordinateSource, "geocoded");

  // Clearing both halves at once is allowed: that is how a project is taken off
  // the map, and it puts the geocoder back in play for the next save.
  const cleared = await json(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ latitude: null, longitude: null }),
  });
  assert.equal(cleared.latitude, null);
  assert.equal(cleared.longitude, null);
  assert.equal(cleared.coordinateSource, null);
});

// ---------------------------------------------------------------------------
// 4. A geocoder having a bad day never costs a project.
// ---------------------------------------------------------------------------

test("a project whose location cannot be geocoded still saves, with no pin", async () => {
  await loginAsAdmin();
  const project = await createProject("Peta Geocoder Gagal", FAILING_LOCATION, "Draft");

  assert.equal(project.name, "Peta Geocoder Gagal", "the project itself saved");
  assert.equal(project.latitude, null);
  assert.equal(project.longitude, null);
  assert.equal(project.coordinateSource, null, "a failed lookup records no guess");

  assert.ok(
    geocoderCalls.some((call) => call.query.includes(FAILING_LOCATION)),
    "the lookup was genuinely attempted and genuinely failed",
  );

  // The row is complete apart from its coordinates, and it is still listed —
  // the dashboard counts it as "no pin yet" rather than dropping it.
  const listed = await json("/api/projects");
  const found = listed.find((item) => item.id === project.id);
  assert.ok(found, "a project with no coordinates is still a project");
  assert.equal(found.location, FAILING_LOCATION);

  // An unreachable host is the same story as a 503, and neither is retried
  // inside the request: one attempt per save, no more.
  const attemptsBefore = geocoderCalls.length;
  await json(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ location: `${FAILING_LOCATION} Dua` }),
  });
  assert.equal(
    geocoderCalls.length - attemptsBefore,
    1,
    "one save, one lookup — a failure is never retried in the request path",
  );
});

// ---------------------------------------------------------------------------
// 5. A hand-placed pin outranks every later guess.
// ---------------------------------------------------------------------------

test("a pin placed by a person survives a later geocode of a changed location", async () => {
  await loginAsAdmin();
  const project = await createProject("Peta Pin Manual", "Ubud, Gianyar");
  assert.equal(project.coordinateSource, "geocoded", "the first save guessed from the location text");
  assert.equal(project.latitude, -8.5069);

  // Somebody corrects the guess. Their point, and their 'manual' mark.
  const pinned = await json(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ latitude: -8.51234, longitude: 115.26543 }),
  });
  assert.equal(pinned.coordinateSource, "manual");
  assert.equal(pinned.latitude, -8.51234);
  assert.equal(pinned.longitude, 115.26543);

  // The location text now changes to somewhere the stub answers confidently.
  // The guess must lose.
  const moved = await json(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ location: "Singaraja, Buleleng" }),
  });
  assert.equal(moved.location, "Singaraja, Buleleng", "the location text did change");
  assert.equal(moved.coordinateSource, "manual");
  assert.equal(moved.latitude, -8.51234, "the hand-placed pin did not move");
  assert.equal(moved.longitude, 115.26543);

  // And it is still there after another unrelated save.
  const renamed = await json(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Selesai" }),
  });
  assert.equal(renamed.latitude, -8.51234);
  assert.equal(renamed.coordinateSource, "manual");
});

// ---------------------------------------------------------------------------
// The Nominatim usage policy, which is a condition of being allowed to call it.
// ---------------------------------------------------------------------------

test("lookups identify this application, stay inside Indonesia, and never exceed one per second", async () => {
  assert.ok(geocoderCalls.length >= 3, "the earlier tests already exercised the geocoder");

  for (const call of geocoderCalls) {
    assert.match(
      call.userAgent,
      /PerumNetEnterprise\/[\d.]+ \(\+https?:\/\/[^;]+; [^@\s]+@[^)\s]+\)/,
      `the User-Agent names the application and a contact address, got "${call.userAgent}"`,
    );
    assert.equal(call.countrycodes, "id", "results are biased to Indonesia");
    assert.equal(call.limit, "1", "one result is asked for, never a bulk page");
  }

  // Back-to-back saves, so the throttle is the only thing that can separate the
  // two lookups.
  await loginAsAdmin();
  const before = geocoderCalls.length;
  await createProject("Peta Laju Satu", "Ubud, Gianyar");
  await createProject("Peta Laju Dua", "Denpasar, Bali");
  const fresh = geocoderCalls.slice(before);
  assert.equal(fresh.length, 2, "both saves asked exactly once");
  assert.ok(
    fresh[1].at - fresh[0].at >= 1_000,
    `consecutive lookups are at least a second apart, got ${fresh[1].at - fresh[0].at}ms`,
  );
});
