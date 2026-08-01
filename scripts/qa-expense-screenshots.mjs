import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debuggingPort = 9225;
const outputDirectory = process.argv[2] || "/tmp/perumnet-expense-qa";
const appUrl = process.argv[3] || "http://127.0.0.1:3111/admin";

const chrome = spawn(chromePath, [
  "--headless=new",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=/tmp/perumnet-expense-qa-chrome-${process.pid}`,
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function version() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await wait(100);
  }
  throw new Error("Chrome DevTools did not start.");
}

await version();
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

async function viewport(width, height, scale = 1) {
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: width <= 600,
    screenWidth: width,
    screenHeight: height,
  });
  await wait(250);
}

async function screenshot(name) {
  const result = await command("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(`${outputDirectory}/${name}.png`, Buffer.from(result.data, "base64"));
}

try {
  await mkdir(outputDirectory, { recursive: true });
  await command("Page.enable");
  await command("Runtime.enable");
  await viewport(1440, 1000);
  await navigate(appUrl);
  const loginResult = await evaluate(`fetch('/api/auth/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email:'admin@perumnet.id',password:'perumnet123',remember:false})
  }).then(async r => ({ok:r.ok, body:await r.text()}))`);
  if (!loginResult.ok) throw new Error(`Login failed: ${loginResult.body}`);
  await navigate(appUrl);
  await evaluate(`(async () => {
    const parse = async (response) => (await response.json()).data;
    const projects = await parse(await fetch('/api/projects'));
    const categories = await parse(await fetch('/api/project-expense-categories'));
    const project = projects[0];
    const category = categories.find(item => item.status === 'Aktif');
    const draft = await parse(await fetch('/api/project-expenses', {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        projectId:project.id,purchaseDate:'2026-08-01',merchant:'Sinar Teknologi Bali',
        categoryId:category.id,totalAmount:875000,fundingSource:'EmployeePaid',
        notes:'Material konektor dan kabel untuk instalasi lantai dua.',itemDetails:[]
      })
    }));
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4\\n1 0 obj<</Type/Catalog>>endobj\\n%%EOF'], 'nota-sinar-teknologi.pdf', {type:'application/pdf'}));
    await fetch('/api/project-expenses/'+draft.id+'/attachments',{method:'POST',body:form});
    await fetch('/api/project-expenses/'+draft.id+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duplicateAcknowledged:false})});
  })()`);
  await navigate(appUrl);
  await evaluate(`Array.from(document.querySelectorAll('.sidebar-link')).find(button => button.textContent.includes('Belanja Proyek'))?.click()`);
  await wait(900);
  const desktopStyles = await evaluate(`(() => {
    const kpis = document.querySelector('.expense-kpis');
    const row = document.querySelector('.expense-table-row');
    const hero = document.querySelector('.expense-hero');
    return {
      kpis: kpis ? {display:getComputedStyle(kpis).display,columns:getComputedStyle(kpis).gridTemplateColumns} : null,
      kpiItems: kpis ? Array.from(kpis.children).map(item => { const r=item.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,gridColumn:getComputedStyle(item).gridColumn}; }) : [],
      row: row ? {display:getComputedStyle(row).display,columns:getComputedStyle(row).gridTemplateColumns} : null,
      hero: hero ? {display:getComputedStyle(hero).display,padding:getComputedStyle(hero).padding} : null
    };
  })()`);
  await evaluate(`document.querySelector('.expense-table-row .expense-row-actions button:last-child')?.click()`);
  await wait(500);
  await screenshot("expense-desktop-1440");
  await evaluate(`document.querySelector('.expense-detail-panel > header .icon-button')?.click()`);
  await viewport(820, 1000);
  await wait(500);
  await screenshot("expense-tablet-820");
  await viewport(390, 844, 2);
  await wait(500);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Catat belanja'))?.click()`);
  await wait(900);
  await screenshot("expense-mobile-390");
  const overflow = await evaluate(`({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
  })`);
  process.stdout.write(`${JSON.stringify({ outputDirectory, desktopStyles, overflow })}\n`);
} finally {
  socket.close();
  chrome.kill("SIGTERM");
}
