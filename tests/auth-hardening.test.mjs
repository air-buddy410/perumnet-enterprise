// Regression cover for three reproduced HIGH findings:
//
//   H1  no throttle anywhere on authentication, plus a timing oracle that
//       enumerated which addresses have accounts;
//   H2  five PATCH endpoints on a plain Zod `.partial()`, which re-applied every
//       `.default()` the client never sent — most severely, renaming a user
//       reactivated a deactivated account;
//   H3  a stolen session became a permanent takeover, because the account email
//       could be moved without verification and a password change left every
//       other session alive.
//
// Every test here fails on the commit before the fix.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let adminCookie = "";

// Kept low so the throttle can be exercised without spending a minute in
// bcrypt. The identifier bucket stays above the IP bucket on purpose: it exists
// to catch one account being sprayed from many machines, not to make it cheap
// for an attacker to hold a real owner out of their own ERP.
const IP_ATTEMPT_LIMIT = 4;
const IDENTIFIER_ATTEMPT_LIMIT = 8;

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

/** Raw request. `ip` picks the throttle bucket, so tests never collide. */
async function call(path, { cookie, ip, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (ip) headers.set("x-forwarded-for", ip);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    redirect: "manual",
  });
  const payload =
    response.status === 204 || response.status === 302
      ? null
      : await response.json().catch(() => null);
  return {
    status: response.status,
    payload,
    data: payload?.data,
    code: payload?.error?.code,
    message: payload?.error?.message,
    setCookie: response.headers.get("set-cookie"),
    location: response.headers.get("location"),
  };
}

async function expect(path, options, status = 200) {
  const response = await call(path, options);
  assert.equal(
    response.status,
    status,
    `${path} -> ${response.status}: ${JSON.stringify(response.payload)}`,
  );
  return response;
}

async function signIn(email, password, ip) {
  const response = await expect("/api/auth/login", {
    method: "POST",
    ip,
    body: JSON.stringify({ email, password, remember: false }),
  });
  return response.setCookie.split(";")[0];
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-auth-hardening-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-auth-hardening-uploads-${process.pid}-${Date.now()}`;
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
        AUTH_RATE_LIMIT_MAX_ATTEMPTS: String(IP_ATTEMPT_LIMIT),
        AUTH_RATE_LIMIT_IDENTIFIER_MAX_ATTEMPTS: String(IDENTIFIER_ATTEMPT_LIMIT),
        AUTH_RATE_LIMIT_WINDOW_MINUTES: "15",
        AUTH_RATE_LIMIT_BLOCK_SECONDS: "60",
        AUTH_RATE_LIMIT_MAX_BLOCK_SECONDS: "900",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
  adminCookie = await signIn("admin@perumnet.id", "perumnet123", "10.0.0.1");
}, { timeout: 60_000 });

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
// H1 — throttling
// ---------------------------------------------------------------------------

test("H1: a password-guessing run is blocked, and the correct password does not rescue it", async () => {
  const email = "guess.target@perumnet.id";
  const password = "Target-Rahasia-2026";
  await expect(
    "/api/users",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Sasaran Tebakan",
        email,
        password,
        role: "Engineer",
        status: "Aktif",
      }),
    },
    201,
  );

  const attackerIp = "203.0.113.10";
  const statuses = [];
  for (let attempt = 0; attempt < IP_ATTEMPT_LIMIT + 2; attempt += 1) {
    const response = await call("/api/auth/login", {
      method: "POST",
      ip: attackerIp,
      body: JSON.stringify({
        email,
        // Long enough to clear the schema, so every one of these reaches the
        // credential check rather than bouncing off validation.
        password: `kata-sandi-salah-${attempt}`,
        remember: false,
      }),
    });
    statuses.push(response.status);
  }

  // Before the fix every one of these was a plain 401 and the run continued.
  assert.ok(
    statuses.includes(429),
    `expected the run to be throttled, got ${statuses.join(",")}`,
  );

  // The whole point: the correct password must not slip through behind the
  // failures. On the vulnerable build this returned 200 with a live session.
  const withCorrectPassword = await call("/api/auth/login", {
    method: "POST",
    ip: attackerIp,
    body: JSON.stringify({ email, password, remember: false }),
  });
  assert.equal(withCorrectPassword.status, 429);
  assert.equal(withCorrectPassword.code, "AUTH_RATE_LIMITED");
  assert.equal(withCorrectPassword.setCookie, null, "no session may be issued");

  // A refusal a human will understand, in Indonesian, never a raw 500.
  assert.match(withCorrectPassword.message, /Terlalu banyak percobaan/);

  // The block is scoped. An untouched account from an untouched address still
  // signs in, so one attacker cannot take the whole workspace offline.
  const bystander = await call("/api/auth/login", {
    method: "POST",
    ip: "198.51.100.77",
    body: JSON.stringify({
      email: "admin@perumnet.id",
      password: "perumnet123",
      remember: false,
    }),
  });
  assert.equal(bystander.status, 200);
});

test("H1: the identifier is throttled too, so rotating IPs does not evade the block", async () => {
  const email = "spray.target@perumnet.id";
  await expect(
    "/api/users",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Sasaran Semprot",
        email,
        password: "Semprot-Rahasia-2026",
        role: "Engineer",
        status: "Aktif",
      }),
    },
    201,
  );

  let blocked = false;
  // A fresh IP every single time: only the identifier bucket can catch this.
  for (let attempt = 0; attempt < IDENTIFIER_ATTEMPT_LIMIT + 1; attempt += 1) {
    const response = await call("/api/auth/login", {
      method: "POST",
      ip: `192.0.2.${attempt + 1}`,
      body: JSON.stringify({
        email,
        password: `kata-sandi-salah-${attempt}`,
        remember: false,
      }),
    });
    if (response.status === 429) {
      blocked = true;
      break;
    }
    assert.equal(response.status, 401);
  }
  assert.ok(blocked, "rotating source addresses must still trip the throttle");
});

test("H1: password recovery is throttled as well", async () => {
  const recoveryIp = "203.0.113.50";
  let blocked = false;
  for (let attempt = 0; attempt < IP_ATTEMPT_LIMIT + 2; attempt += 1) {
    const response = await call("/api/auth/forgot-password", {
      method: "POST",
      ip: recoveryIp,
      body: JSON.stringify({ email: `recovery.probe.${attempt}@perumnet.id` }),
    });
    if (response.status === 429) {
      blocked = true;
      assert.equal(response.code, "AUTH_RATE_LIMITED");
      break;
    }
    assert.equal(response.status, 200);
  }
  assert.ok(blocked, "unbounded recovery requests are a mail-flood vector");
});

test("H1: signing in against an unknown address costs the same as a real one", async () => {
  // The oracle was pure timing: a missing row returned before bcrypt ever ran
  // (~4ms) while a real account paid the full hash (~227ms), which reliably
  // told an attacker which addresses are registered. The assertion is a ratio,
  // not an absolute, so it holds on a slow machine as well as a fast one.
  const known = [];
  const unknown = [];

  for (let sample = 0; sample < 3; sample += 1) {
    const email = `timing.known.${sample}@perumnet.id`;
    await expect(
      "/api/users",
      {
        method: "POST",
        cookie: adminCookie,
        body: JSON.stringify({
          name: `Timing Known ${sample}`,
          email,
          password: "Timing-Rahasia-2026",
          role: "Engineer",
          status: "Aktif",
        }),
      },
      201,
    );

    // A distinct source address per probe keeps every bucket well under its
    // limit, so the throttle never colours the measurement.
    const knownStart = performance.now();
    const knownResponse = await call("/api/auth/login", {
      method: "POST",
      ip: `198.18.0.${sample + 1}`,
      body: JSON.stringify({
        email,
        password: "jelas-salah-sekali",
        remember: false,
      }),
    });
    known.push(performance.now() - knownStart);
    assert.equal(knownResponse.status, 401);

    const unknownStart = performance.now();
    const unknownResponse = await call("/api/auth/login", {
      method: "POST",
      ip: `198.18.1.${sample + 1}`,
      body: JSON.stringify({
        email: `timing.absent.${sample}@perumnet.id`,
        password: "jelas-salah-sekali",
        remember: false,
      }),
    });
    unknown.push(performance.now() - unknownStart);
    assert.equal(unknownResponse.status, 401);
  }

  const median = (values) => [...values].sort((a, b) => a - b)[1];
  const knownMedian = median(known);
  const unknownMedian = median(unknown);
  const ratio = unknownMedian / knownMedian;

  // Vulnerable build: ~0.02. Fixed build: ~1.0. The 0.35 floor leaves a wide
  // margin for scheduler noise without letting a real oracle through.
  assert.ok(
    ratio > 0.35,
    `unknown-address sign-in returned far too fast (${unknownMedian.toFixed(1)}ms vs ${knownMedian.toFixed(1)}ms, ratio ${ratio.toFixed(3)})`,
  );
});

// ---------------------------------------------------------------------------
// H2 — PATCH bodies must not resurrect defaults the client never sent
// ---------------------------------------------------------------------------

test("H2: renaming a user does not reactivate a deactivated account", async () => {
  const email = "revoked.staff@perumnet.id";
  const password = "Revoked-Aman-2026";
  const created = await expect(
    "/api/users",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Staf Dicabut",
        email,
        password,
        role: "Engineer",
        status: "Aktif",
      }),
    },
    201,
  );

  await expect("/api/auth/login", {
    method: "POST",
    ip: "198.18.2.1",
    body: JSON.stringify({ email, password, remember: false }),
  });

  const deactivated = await expect(`/api/users/${created.data.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ status: "Nonaktif" }),
  });
  assert.equal(deactivated.data.status, "Nonaktif");
  assert.equal(
    (
      await call("/api/auth/login", {
        method: "POST",
        ip: "198.18.2.2",
        body: JSON.stringify({ email, password, remember: false }),
      })
    ).status,
    403,
  );

  // Name only. Nothing about the account status is in this body.
  const renamed = await expect(`/api/users/${created.data.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ name: "Staf Dicabut (ganti nama)" }),
  });
  assert.equal(renamed.data.name, "Staf Dicabut (ganti nama)");
  assert.equal(
    renamed.data.status,
    "Nonaktif",
    "a rename must never reinstate a revoked account",
  );

  // The proof that matters: revoked access stays revoked.
  const afterRename = await call("/api/auth/login", {
    method: "POST",
    ip: "198.18.2.3",
    body: JSON.stringify({ email, password, remember: false }),
  });
  assert.equal(afterRename.status, 403);
  assert.equal(afterRename.code, "ACCOUNT_INACTIVE");
});

test("H2: renaming a bank account keeps its currency, balance, and API linkage", async () => {
  const account = await expect(
    "/api/bank-accounts",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        bankName: "Bank Devisa",
        accountName: "Rekening Valas",
        accountNumber: "5566778899",
        currency: "USD",
        openingBalance: 4_500_000,
        syncMode: "API",
        externalAccountId: "ext-acc-77",
        status: "Aktif",
      }),
    },
    201,
  );
  assert.equal(account.data.currency, "USD");

  const renamed = await expect(`/api/bank-accounts/${account.data.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ accountName: "Rekening Valas (ganti nama)" }),
  });
  assert.equal(renamed.data.accountName, "Rekening Valas (ganti nama)");
  assert.equal(renamed.data.currency, "USD", "currency was reset to the IDR default");
  assert.equal(
    renamed.data.openingBalance,
    4_500_000,
    "opening balance was reset to the 0 default",
  );
  assert.equal(
    renamed.data.syncMode,
    "API",
    "sync mode was reset to the Manual default, dropping the API linkage",
  );
  assert.equal(
    renamed.data.hasExternalAccountId,
    true,
    "the provider account id was dropped",
  );
});

test("H2: editing a transaction description keeps its date and category", async () => {
  const transaction = await expect(
    "/api/transactions",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        date: "2026-01-05",
        type: "Pengeluaran",
        description: "Sewa kantor Januari",
        amount: 3_000_000,
        source: "Operasional",
        category: "Operasional",
      }),
    },
    201,
  );
  assert.equal(transaction.data.dateIso, "2026-01-05");

  const edited = await expect(`/api/transactions/${transaction.data.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ description: "Sewa kantor Januari (revisi)" }),
  });
  assert.equal(edited.data.description, "Sewa kantor Januari (revisi)");
  assert.equal(
    edited.data.dateIso,
    "2026-01-05",
    "the transaction was silently re-dated to today",
  );
  assert.equal(
    edited.data.categoryKey,
    "Operasional",
    "the category was silently reset to Lainnya",
  );
});

test("H2: renaming a retired vendor category does not put it back in circulation", async () => {
  const category = await expect(
    "/api/vendor-categories",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Kategori Vendor Pensiun",
        vendorType: "Jasa",
        status: "Nonaktif",
      }),
    },
    201,
  );

  const renamed = await expect(`/api/vendor-categories/${category.data.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ name: "Kategori Vendor Pensiun (ganti nama)" }),
  });
  assert.equal(renamed.data.name, "Kategori Vendor Pensiun (ganti nama)");
  assert.equal(
    renamed.data.status,
    "Nonaktif",
    "a rename reactivated a retired vendor category",
  );
});

test("H2: renaming a retired expense category does not put it back in circulation", async () => {
  const category = await expect(
    "/api/project-expense-categories",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Kategori Belanja Pensiun",
        nameEn: "Retired Expense Category",
        status: "Nonaktif",
      }),
    },
    201,
  );

  await expect(`/api/project-expense-categories/${category.data.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ name: "Kategori Belanja Pensiun (ganti nama)" }),
  });

  const listed = (
    await expect("/api/project-expense-categories", { cookie: adminCookie })
  ).data.find((entry) => entry.id === category.data.id);
  assert.equal(listed.name, "Kategori Belanja Pensiun (ganti nama)");
  assert.equal(
    listed.status,
    "Nonaktif",
    "a rename reactivated a retired expense category",
  );
});

// ---------------------------------------------------------------------------
// H3 — a stolen session must not become a permanent takeover
// ---------------------------------------------------------------------------

test("H3: a self-service email change waits for confirmation from the new address", async () => {
  const ownerEmail = "takeover.owner@perumnet.id";
  const attackerEmail = "attacker.inbox@perumnet.id";
  const password = "Owner-Rahasia-2026";
  await expect(
    "/api/users",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Pemilik Akun",
        email: ownerEmail,
        password,
        role: "Engineer",
        status: "Aktif",
      }),
    },
    201,
  );
  const stolenSession = await signIn(ownerEmail, password, "198.18.3.1");

  // The attack: repoint the account at an inbox the attacker controls.
  const patched = await expect("/api/profile", {
    method: "PATCH",
    cookie: stolenSession,
    body: JSON.stringify({
      name: "Pemilik Akun",
      email: attackerEmail,
      phone: "",
      jobTitle: "",
      bio: "",
      address: "",
      birthDate: "",
    }),
  });

  // The account is untouched until somebody proves they own the new inbox.
  assert.equal(patched.data.email, ownerEmail, "the address moved immediately");
  assert.equal(patched.data.pendingEmailChange.pendingEmail, attackerEmail);
  assert.equal(
    (await expect("/api/profile", { cookie: stolenSession })).data.email,
    ownerEmail,
  );

  // And the owner is told, at the address that is still theirs.
  const deliveries = (
    await expect("/api/notifications/email", { cookie: adminCookie })
  ).data;
  const confirmation = deliveries.find(
    (entry) =>
      entry.eventType === "email_change_confirm" &&
      entry.recipient === attackerEmail,
  );
  const notice = deliveries.find(
    (entry) =>
      entry.eventType === "email_change_requested" &&
      entry.recipient === ownerEmail,
  );
  assert.ok(confirmation, "the confirmation link must go to the new address");
  assert.ok(notice, "the current address must be told a change was requested");
  assert.equal(notice.senderProfile, "security");

  // Recovery still belongs to the real owner: asking for a reset as the
  // attacker's address finds no account, so no link is ever issued.
  const attackerRecovery = await expect("/api/auth/forgot-password", {
    method: "POST",
    ip: "198.18.3.9",
    body: JSON.stringify({ email: attackerEmail }),
  });
  assert.equal(
    attackerRecovery.data.resetToken,
    undefined,
    "an unconfirmed address must not be able to recover the account",
  );

  // Now complete the change the honest way and check it lands.
  const confirmed = await expect("/api/auth/confirm-email-change", {
    method: "POST",
    body: JSON.stringify({
      token: patched.data.pendingEmailChange.confirmationToken,
    }),
  });
  assert.equal(confirmed.data.email, attackerEmail);

  // Every session dies with the address it was opened under.
  assert.equal(
    (await call("/api/profile", { cookie: stolenSession })).status,
    401,
  );
  const rotated = await signIn(attackerEmail, password, "198.18.3.2");
  assert.equal(
    (await expect("/api/profile", { cookie: rotated })).data.email,
    attackerEmail,
  );

  // The token is single use.
  const replay = await call("/api/auth/confirm-email-change", {
    method: "POST",
    body: JSON.stringify({
      token: patched.data.pendingEmailChange.confirmationToken,
    }),
  });
  assert.equal(replay.status, 400);
  assert.equal(replay.code, "INVALID_EMAIL_CHANGE_TOKEN");
  assert.match(replay.message, /tidak valid atau sudah kedaluwarsa/);
});

test("H3: the emailed confirmation link works as a plain GET and refuses a bad token", async () => {
  const email = "link.owner@perumnet.id";
  const nextEmail = "link.owner.baru@perumnet.id";
  const password = "Link-Rahasia-2026";
  await expect(
    "/api/users",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Pemilik Tautan",
        email,
        password,
        role: "Engineer",
        status: "Aktif",
      }),
    },
    201,
  );
  const session = await signIn(email, password, "198.18.4.1");
  const patched = await expect("/api/profile", {
    method: "PATCH",
    cookie: session,
    body: JSON.stringify({
      name: "Pemilik Tautan",
      email: nextEmail,
      phone: "",
      jobTitle: "",
      bio: "",
      address: "",
      birthDate: "",
    }),
  });

  const bad = await call(
    "/api/auth/confirm-email-change?token=tidak-berlaku-sama-sekali-tapi-cukup-panjang",
  );
  assert.equal(bad.status, 302);
  assert.match(bad.location, /emailChange=invalid/);

  const good = await call(
    `/api/auth/confirm-email-change?token=${encodeURIComponent(patched.data.pendingEmailChange.confirmationToken)}`,
  );
  assert.equal(good.status, 302);
  assert.match(good.location, /emailChange=confirmed/);

  const rotated = await signIn(nextEmail, password, "198.18.4.2");
  assert.equal(
    (await expect("/api/profile", { cookie: rotated })).data.email,
    nextEmail,
  );
});

test("H3: changing your own password evicts every other session", async () => {
  const email = "rotate.owner@perumnet.id";
  const password = "Rotate-Rahasia-2026";
  const nextPassword = "Rotate-Rahasia-Baru-2026";
  await expect(
    "/api/users",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Pemilik Rotasi",
        email,
        password,
        role: "Engineer",
        status: "Aktif",
      }),
    },
    201,
  );

  // Two live sessions: the intruder's stolen cookie and the owner's own.
  const intruderSession = await signIn(email, password, "198.18.5.1");
  const ownerSession = await signIn(email, password, "198.18.5.2");
  assert.equal((await call("/api/profile", { cookie: intruderSession })).status, 200);

  await expect("/api/profile/password", {
    method: "PATCH",
    cookie: ownerSession,
    body: JSON.stringify({
      currentPassword: password,
      newPassword: nextPassword,
    }),
  });

  assert.equal(
    (await call("/api/profile", { cookie: intruderSession })).status,
    401,
    "a password change must evict the session the attacker is holding",
  );
  assert.equal(
    (await call("/api/profile", { cookie: ownerSession })).status,
    200,
    "the person who just rotated their password stays signed in",
  );
});

test("H3: an Admin cannot move their own address without confirming it either", async () => {
  // /api/users is the second door to the same takeover: an Admin patching their
  // own row would otherwise repoint account recovery with no verification.
  const before = (await expect("/api/users", { cookie: adminCookie })).data.find(
    (entry) => entry.id === "user-1",
  );
  const patched = await expect("/api/users/user-1", {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ email: "admin.dipindah@perumnet.id" }),
  });
  assert.equal(
    patched.data.email,
    before.email,
    "an Admin's own address moved without confirmation",
  );
  assert.equal(
    patched.data.pendingEmailChange.pendingEmail,
    "admin.dipindah@perumnet.id",
  );
  assert.equal(
    (await expect("/api/auth/session", { cookie: adminCookie })).data.user.email,
    before.email,
  );
});

test("H3: an Admin changing someone else's address ends that person's sessions", async () => {
  const email = "moved.staff@perumnet.id";
  const movedEmail = "moved.staff.baru@perumnet.id";
  const password = "Moved-Rahasia-2026";
  const created = await expect(
    "/api/users",
    {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        name: "Staf Dipindah",
        email,
        password,
        role: "Engineer",
        status: "Aktif",
      }),
    },
    201,
  );
  const staffSession = await signIn(email, password, "198.18.6.1");
  assert.equal((await call("/api/profile", { cookie: staffSession })).status, 200);

  const patched = await expect(`/api/users/${created.data.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ email: movedEmail }),
  });
  assert.equal(patched.data.email, movedEmail);
  assert.equal(
    (await call("/api/profile", { cookie: staffSession })).status,
    401,
    "sessions opened under the old address must not survive the change",
  );

  const announced = (
    await expect("/api/notifications/email", { cookie: adminCookie })
  ).data.find(
    (entry) => entry.eventType === "email_changed" && entry.recipient === email,
  );
  assert.ok(announced, "the old address must be told the account moved");
});
