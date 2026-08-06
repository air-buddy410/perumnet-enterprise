// Regression cover for the Google Analytics 4 gate.
//
// Three properties have to hold, and all three are load-bearing:
//
//   * with NEXT_PUBLIC_GA_MEASUREMENT_ID set, the public marketing pages carry
//     the gtag loader and the Content-Security-Policy allows it through;
//   * with the variable unset — the state the demo build and the current
//     production build ship in — nothing analytics-related reaches the browser
//     and the CSP is byte-for-byte the policy that was there before GA existed;
//   * /admin, /panel and the BAST verification page never carry the tag, set
//     variable or not. Staff working in the ERP are not marketing traffic, and
//     a BAST URL carries a document token that must not be handed to Google.
//
// Every test here fails on the commit before the fix: the first block cannot
// even import app/analytics.ts, and the two server blocks find no gtag loader
// on / and no googletagmanager.com in the CSP.
//
// Two dev servers are needed rather than one. NEXT_PUBLIC_* values are inlined
// when a module is compiled and custom headers are resolved from next.config.ts
// at startup, so "configured" and "unconfigured" are two different processes —
// which is exactly the split between the production and demo builds on the VPS.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  ANALYTICS_EXCLUDED_PREFIXES,
  GA_CONFIG_PARAMETERS,
  createPageViewTracker,
  isAnalyticsPath,
  normaliseMeasurementId,
} from "../app/analytics.ts";

// Not the owner's property. A test run must never be able to write a pageview
// into real reporting, so this is a syntactically valid ID for a stream that
// does not exist.
const TEST_MEASUREMENT_ID = "G-TESTPERUMNET";

const CONSOLE_PATHS = ["/admin", "/panel", "/verify/bast/not-a-real-token"];
const PUBLIC_PATHS = ["/", "/en", "/services", "/contact"];

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
  const deadline = Date.now() + 60_000;
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

/**
 * Boots `next dev` with the analytics variable in a known state, hands the base
 * URL to `body`, and always tears the process and its database down again.
 */
async function withServer(measurementId, body) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const databasePath = `/tmp/perumnet-analytics-${process.pid}-${Date.now()}.db`;
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        TURSO_DATABASE_URL: `file:${databasePath}`,
        APP_URL: baseUrl,
        // "" and "absent" must behave identically: the demo build sets the
        // variable to an empty string rather than omitting the line.
        NEXT_PUBLIC_GA_MEASUREMENT_ID: measurementId ?? "",
        TURNSTILE_SECRET_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    await waitForServer(baseUrl);
    await body(baseUrl);
  } finally {
    if (!server.killed) {
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
      if (existsSync(`${databasePath}${suffix}`)) unlinkSync(`${databasePath}${suffix}`);
    }
  }
}

async function page(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    html: await response.text(),
    csp: response.headers.get("content-security-policy") ?? "",
  };
}

function directive(csp, name) {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  assert.ok(found, `CSP has no ${name} directive: ${csp}`);
  return found;
}

test("a Measurement ID is only accepted in GA4's own format", () => {
  assert.equal(normaliseMeasurementId("G-ABCD123456"), "G-ABCD123456");
  assert.equal(normaliseMeasurementId("  G-ABCD123456  "), "G-ABCD123456");
  assert.equal(normaliseMeasurementId("g-abcd123456"), "G-ABCD123456");

  // Unset, blank, and the mistakes an owner actually makes: a Tag Manager
  // container ID, a Universal Analytics property, a quoted paste.
  assert.equal(normaliseMeasurementId(undefined), null);
  assert.equal(normaliseMeasurementId(null), null);
  assert.equal(normaliseMeasurementId(""), null);
  assert.equal(normaliseMeasurementId("   "), null);
  assert.equal(normaliseMeasurementId("GTM-ABCD123"), null);
  assert.equal(normaliseMeasurementId("UA-12345-1"), null);
  assert.equal(normaliseMeasurementId('"G-ABCD123456"'), null);
  assert.equal(normaliseMeasurementId("G-ABC"), null);
});

test("the console and the BAST receipt are excluded from analytics", () => {
  for (const path of ["/", "/en", "/services", "/en/contact", "/portfolio", "/syarat-ketentuan"]) {
    assert.equal(isAnalyticsPath(path), true, `${path} should be eligible`);
  }
  for (const prefix of ANALYTICS_EXCLUDED_PREFIXES) {
    assert.equal(isAnalyticsPath(prefix), false, `${prefix} should be excluded`);
    assert.equal(isAnalyticsPath(`${prefix}/`), false, `${prefix}/ should be excluded`);
    assert.equal(isAnalyticsPath(`${prefix}/nested/page`), false, `${prefix}/… should be excluded`);
    assert.equal(isAnalyticsPath(`${prefix}?a=1`), false, `${prefix}?… should be excluded`);
  }
  // A public route that merely starts with the same letters is not excluded.
  assert.equal(isAnalyticsPath("/administrasi-jaringan"), true);
  assert.equal(isAnalyticsPath("/panel-surya"), true);
});

test("client-side route changes are reported, the landing page is not counted twice", () => {
  const shouldReport = createPageViewTracker();

  // gtag('config', …) already reported the landing page.
  assert.equal(shouldReport("/"), false);
  // React double-invokes effects in development; the same location must not
  // produce a second hit.
  assert.equal(shouldReport("/"), false);

  // Every App Router navigation after that is ours to send. This is the case
  // that regressed: the analytics component is unmounted and remounted on each
  // navigation, so per-component state made this return false forever and the
  // property saw one pageview per session.
  assert.equal(shouldReport("/services"), true);
  assert.equal(shouldReport("/services"), false);
  assert.equal(shouldReport("/contact?utm_source=wa"), true);
  // Going back to a page is a real second view.
  assert.equal(shouldReport("/"), true);

  // Trackers do not share state: a fresh document starts over, because that
  // load runs gtag('config', …) again.
  assert.equal(createPageViewTracker()("/services"), false);
});

test("advertising signals are off by default", () => {
  assert.equal(GA_CONFIG_PARAMETERS.allow_google_signals, false);
  assert.equal(GA_CONFIG_PARAMETERS.allow_ad_personalization_signals, false);
  assert.equal(GA_CONFIG_PARAMETERS.anonymize_ip, true);
});

test(
  "with a Measurement ID configured the tag loads on public pages only",
  { timeout: 300_000 },
  async () => {
    await withServer(TEST_MEASUREMENT_ID, async (baseUrl) => {
      for (const path of PUBLIC_PATHS) {
        const { status, html } = await page(baseUrl, path);
        assert.equal(status, 200, `${path} returned ${status}`);
        assert.ok(
          html.includes(`https://www.googletagmanager.com/gtag/js?id=${TEST_MEASUREMENT_ID}`),
          `${path} does not load gtag.js`,
        );
      }

      for (const path of CONSOLE_PATHS) {
        const { html } = await page(baseUrl, path);
        assert.ok(
          !html.includes("googletagmanager"),
          `${path} pulls in gtag.js and must not`,
        );
        assert.ok(
          !html.includes(TEST_MEASUREMENT_ID),
          `${path} leaks the Measurement ID and must not`,
        );
      }

      // The policy has to let through exactly what gtag.js reaches for, and
      // must not have dropped anything that was already trusted.
      const { csp } = await page(baseUrl, "/");
      const scriptSrc = directive(csp, "script-src");
      assert.ok(scriptSrc.includes("https://www.googletagmanager.com"), scriptSrc);
      assert.ok(scriptSrc.includes("'self'"), scriptSrc);
      assert.ok(scriptSrc.includes("https://challenges.cloudflare.com"), scriptSrc);

      const connectSrc = directive(csp, "connect-src");
      for (const host of [
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://*.googletagmanager.com",
      ]) {
        assert.ok(connectSrc.includes(host), `connect-src is missing ${host}: ${connectSrc}`);
      }
      assert.ok(connectSrc.includes("'self'"), connectSrc);
      assert.ok(connectSrc.includes("https://challenges.cloudflare.com"), connectSrc);

      assert.ok(directive(csp, "img-src").includes("https://*.google-analytics.com"), csp);

      // Widened, not relaxed.
      assert.ok(csp.includes("frame-ancestors 'none'"), csp);
      assert.ok(csp.includes("object-src 'none'"), csp);
      assert.ok(csp.includes("default-src 'self'"), csp);
      assert.ok(!csp.includes("script-src *"), csp);
    });
  },
);

test(
  "with no Measurement ID nothing analytics-related ships",
  { timeout: 300_000 },
  async () => {
    await withServer("", async (baseUrl) => {
      for (const path of [...PUBLIC_PATHS, ...CONSOLE_PATHS]) {
        const { html } = await page(baseUrl, path);
        for (const needle of ["googletagmanager", "google-analytics", "gtag"]) {
          assert.ok(!html.includes(needle), `${path} still mentions ${needle}`);
        }
      }

      // No host was opened up for a tag that is not there. Checked against the
      // analytics origins by name rather than by searching for "google", so
      // that this keeps testing the analytics gate specifically and does not
      // quietly start passing or failing on some unrelated Google origin.
      const { csp, html } = await page(baseUrl, "/");
      for (const host of [
        "googletagmanager.com",
        "google-analytics.com",
        "analytics.google.com",
      ]) {
        assert.ok(!csp.includes(host), `CSP was widened for absent analytics: ${csp}`);
      }
      assert.ok(directive(csp, "script-src").includes("https://challenges.cloudflare.com"), csp);
      assert.ok(directive(csp, "connect-src").includes("https://challenges.cloudflare.com"), csp);
      assert.equal(directive(csp, "img-src"), "img-src 'self' data: blob:");

      // The brand typefaces are committed to the repo and served by next/font
      // from this origin, so neither Google Fonts host belongs in the policy
      // any more. These two directives are asserted whole: a later change that
      // re-adds an origin here has to come past this line.
      assert.equal(directive(csp, "style-src"), "style-src 'self' 'unsafe-inline'");
      assert.equal(directive(csp, "font-src"), "font-src 'self' data:");

      // …and the page does not reach for them either, so the tightened policy
      // is not quietly breaking the design the way it did before this landed.
      for (const host of ["fonts.googleapis.com", "fonts.gstatic.com"]) {
        assert.ok(!html.includes(host), `the home page still reaches for ${host}`);
      }

      // Follow the real chain the browser follows: the document's stylesheets,
      // the @font-face rules inside them, and then the font files those point
      // at. Checking the HTML alone would pass just as happily if the fonts
      // had stopped loading altogether.
      const stylesheets = [...html.matchAll(/href="(\/[^"]*\.css[^"]*)"/g)].map((match) => match[1]);
      assert.ok(stylesheets.length > 0, "the home page links no stylesheet");

      const fontFiles = new Set();
      let css = "";
      for (const href of stylesheets) {
        const sheetUrl = new URL(href, baseUrl);
        const response = await fetch(sheetUrl);
        assert.equal(response.status, 200, `${href} returned ${response.status}`);
        const text = await response.text();
        css += text;
        for (const [, reference] of text.matchAll(/url\(["']?([^"')]+\.woff2?)["']?\)/g)) {
          fontFiles.add(new URL(reference, sheetUrl).href);
        }
      }

      // Named faces, not next/font's hashed handles: every font-family rule in
      // globals.css and the CSS modules asks for these two names literally.
      for (const family of ["DM Sans", "Plus Jakarta Sans"]) {
        assert.match(
          css,
          new RegExp(`@font-face\\s*{[^}]*font-family:\\s*["']?${family}["']?\\s*[;}]`),
          `no @font-face declares the family "${family}"`,
        );
      }
      assert.ok(css.includes("font-display: swap"), "the faces are not declared font-display: swap");

      assert.ok(fontFiles.size >= 2, `expected both families' files, saw ${[...fontFiles]}`);
      for (const file of fontFiles) {
        assert.ok(file.startsWith(baseUrl), `a font is loaded off-origin: ${file}`);
        const response = await fetch(file);
        assert.equal(response.status, 200, `${file} returned ${response.status}`);
        const bytes = await response.arrayBuffer();
        // wOF2 — proves the committed file is what actually gets served.
        assert.equal(Buffer.from(bytes.slice(0, 4)).toString("latin1"), "wOF2", `${file} is not woff2`);
      }
    });
  },
);
