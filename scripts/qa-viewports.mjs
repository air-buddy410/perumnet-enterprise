// Sweeps every admin view, the CMS panel, and the public pages at desktop,
// tablet, and mobile widths. Captures a screenshot per view/viewport and
// reports elements that overflow their container — `html { overflow-x: clip }`
// hides document-level overflow, so per-element probing is the only signal.
//
// Usage: node scripts/qa-viewports.mjs [outputDir] [baseUrl]
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debuggingPort = 9226;
const outputDirectory = process.argv[2] || "/tmp/perumnet-viewport-qa";
const baseUrl = (process.argv[3] || "http://127.0.0.1:3111").replace(/\/$/, "");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000, scale: 1 },
  { name: "tablet", width: 820, height: 1000, scale: 1 },
  { name: "mobile", width: 390, height: 844, scale: 2 },
];

// Sidebar order is deterministic for an Admin session: 4 main + 5 operations
// + 2 administration + settings. Index-based clicking avoids i18n label drift.
const ADMIN_VIEWS = [
  { key: "dashboard", index: 0 },
  { key: "project", index: 1 },
  { key: "boq", index: 2 },
  { key: "billing", index: 3 },
  { key: "expenses", index: 4 },
  { key: "procurement", index: 5 },
  { key: "validation", index: 6 },
  { key: "bast", index: 7 },
  { key: "finance", index: 8 },
  { key: "catalog", index: 9 },
  { key: "users", index: 10 },
  { key: "settings", index: 11 },
];

const PUBLIC_PAGES = [
  { key: "public-home", path: "/" },
  { key: "public-services", path: "/services" },
  { key: "public-portfolio", path: "/portfolio" },
  { key: "public-testimonials", path: "/testimonials" },
  { key: "public-contact", path: "/contact" },
  { key: "public-home-en", path: "/en" },
];

const chrome = spawn(chromePath, [
  "--headless=new",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=/tmp/perumnet-viewport-qa-chrome-${process.pid}`,
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function devtoolsReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await wait(100);
  }
  throw new Error("Chrome DevTools did not start.");
}

await devtoolsReady();
const targetResponse = await fetch(
  `http://127.0.0.1:${debuggingPort}/json/new?about:blank`,
  { method: "PUT" },
);
if (!targetResponse.ok) throw new Error("Could not create a Chrome page target.");
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function command(method, params = {}) {
  sequence += 1;
  const id = sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function navigate(url) {
  await command("Page.navigate", { url });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate("document.readyState === 'complete'")) break;
    await wait(100);
  }
  await wait(700);
}

async function viewport({ width, height, scale }) {
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: width <= 600,
    screenWidth: width,
    screenHeight: height,
  });
  await wait(300);
}

async function screenshot(name) {
  const result = await command("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(`${outputDirectory}/${name}.png`, Buffer.from(result.data, "base64"));
}

// Reports content wider than the window and any element whose own content
// overflows it. Scroll containers are allowed to scroll, but a container
// wider than the viewport still traps content off-screen, so both are flagged.
const OVERFLOW_PROBE = `(() => {
  const findings = [];
  const limit = window.innerWidth + 1;
  if (document.documentElement.scrollWidth > limit) {
    findings.push({ what: 'document', scrollWidth: document.documentElement.scrollWidth, limit });
  }
  for (const element of document.querySelectorAll('main *')) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right > limit + 2 || rect.left < -2) {
      const style = getComputedStyle(element);
      const scrollable = ['auto', 'scroll'].includes(style.overflowX);
      let ancestorHandles = false;
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (['auto', 'scroll', 'hidden', 'clip'].includes(overflowX)) { ancestorHandles = true; break; }
      }
      if (scrollable || ancestorHandles) continue;
      if (rect.right < 0 || rect.left > limit + window.innerWidth) continue; // intentionally off-screen (honeypot)
      findings.push({
        what: element.tagName.toLowerCase() + (element.className && typeof element.className === 'string'
          ? '.' + element.className.trim().split(/\\s+/).slice(0, 2).join('.')
          : ''),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        limit,
      });
    }
  }
  const seen = new Set();
  return findings.filter((finding) => {
    if (seen.has(finding.what)) return false;
    seen.add(finding.what);
    return true;
  }).slice(0, 8);
})()`;

const report = [];

async function capture(key, viewportSpec) {
  await viewport(viewportSpec);
  await wait(400);
  await screenshot(`${key}-${viewportSpec.name}`);
  const overflow = await evaluate(OVERFLOW_PROBE);
  if (overflow?.length) {
    report.push({ view: key, viewport: viewportSpec.name, overflow });
    console.log(`  ⚠ ${key} @ ${viewportSpec.name}:`, JSON.stringify(overflow));
  }
}

async function openAdminView(index) {
  const clicked = await evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('.app-sidebar .sidebar-link'));
    const match = links[${index}];
    if (!match) return false;
    match.click();
    return true;
  })()`);
  await wait(900);
  // The off-canvas nav closes itself on selection; clear any leftover backdrop.
  await evaluate("document.querySelector('.mobile-nav-backdrop')?.click()");
  await wait(300);
  return clicked;
}

try {
  await mkdir(outputDirectory, { recursive: true });
  await command("Page.enable");
  await command("Runtime.enable");
  await viewport(VIEWPORTS[0]);

  if (!process.env.QA_SKIP_PUBLIC) console.log("PUBLIC PAGES");
  for (const page of process.env.QA_SKIP_PUBLIC ? [] : PUBLIC_PAGES) {
    await navigate(`${baseUrl}${page.path}`);
    for (const spec of VIEWPORTS) await capture(page.key, spec);
  }

  console.log("ADMIN APP");
  await navigate(`${baseUrl}/admin`);
  const loginResult = await evaluate(`fetch('/api/auth/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email:'admin@perumnet.id',password:'perumnet123',remember:false})
  }).then(async r => ({ok:r.ok, body:await r.text()}))`);
  if (!loginResult.ok) throw new Error(`Login failed: ${loginResult.body}`);

  // Project-scoped views (BoQ, billing, validation, BAST, Gantt) render an
  // empty state until a workspace is chosen; pick the first seeded project.
  await navigate(`${baseUrl}/admin`);
  await evaluate(`(() => {
    document.querySelector('.workspace-switcher')?.click();
    return true;
  })()`);
  await wait(400);
  await evaluate(`(() => {
    const options = Array.from(document.querySelectorAll('.workspace-menu button'));
    const project = options.find((button) => !button.textContent.includes('Semua') && !button.textContent.includes('All'));
    project?.click();
    return options.length;
  })()`);
  await wait(700);

  for (const view of ADMIN_VIEWS) {
    for (const spec of VIEWPORTS) {
      await navigate(`${baseUrl}/admin`);
      await viewport(spec);
      await wait(400);
      // Below 960px the sidebar is off-canvas; the workspace switcher lives
      // inside it, so open the nav before selecting the project workspace.
      if (spec.width < 960) {
        await evaluate("document.querySelector('.menu-button')?.click()");
        await wait(400);
      }
      await evaluate(`(() => {
        document.querySelector('.workspace-switcher')?.click();
        return true;
      })()`);
      await wait(300);
      await evaluate(`(() => {
        const options = Array.from(document.querySelectorAll('.workspace-menu button'));
        const project = options.find((button) => !button.textContent.includes('Semua') && !button.textContent.includes('All'));
        project?.click();
        return true;
      })()`);
      await wait(500);
      const opened = await openAdminView(view.index);
      if (!opened) {
        console.log(`  – ${view.key} @ ${spec.name}: nav entry not found, skipped`);
        continue;
      }
      await capture(view.key, spec);
    }
  }

  console.log("CMS PANEL");
  await navigate(`${baseUrl}/panel`);
  for (const spec of VIEWPORTS) await capture("cms-panel", spec);

  console.log("\n=== SUMMARY ===");
  if (!report.length) {
    console.log("No overflow detected across all views and viewports.");
  } else {
    for (const entry of report) {
      console.log(`${entry.view} @ ${entry.viewport}`);
      for (const item of entry.overflow) console.log(`   ${item.what} → ${JSON.stringify(item)}`);
    }
  }
  await writeFile(
    `${outputDirectory}/report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(`\nScreenshots + report.json in ${outputDirectory}`);
} finally {
  socket.close();
  chrome.kill();
}
