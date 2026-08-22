// Arsip bukti keuangan: satu daftar untuk semua yang bergerak uang, plus bukti
// kontrak, dengan jalan baca ke bukti yang sampai 22 Agustus 2026 tidak pernah
// bisa dibuka dari mana pun.
//
// Satu rantai data dibangun sekali (dua proyek, dua pembayaran invoice, SPK,
// uang muka, transaksi manual, mutasi bank), lalu tiap skenario membaca arsip
// dari sudut akun yang berbeda. Yang dijaga bukan "daftarnya ada", melainkan:
// PM tidak melihat proyek orang lain maupun kas perusahaan; bukti yang
// dilayani adalah byte yang dulu diunggah (sidik sha256 sama); baris tanpa
// bukti benar-benar tanpa bukti; dan reversal berbagi bukti asalnya.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import sharp from "sharp";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";

const SANDI = "Arsip-Bukti-2026";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address();
      listener.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
      lastError = new Error(`Health ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError ?? new Error("Server tidak pernah siap.");
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
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expectedStatus, `${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload?.data ?? payload;
}

async function galat(path, options = {}) {
  const response = await request(path, options);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, code: payload?.error?.code, message: payload?.error?.message, details: payload?.error?.details };
}

async function masuk(email, password = "perumnet123") {
  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  await json("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, remember: false }) });
}

const ADMIN = "admin@perumnet.id";

/** PNG kecil yang berbeda per warna — lampiran diperiksa dari ISI berkasnya. */
async function png(color) {
  return sharp({ create: { width: 6, height: 4, channels: 3, background: color } }).png().toBuffer();
}
function lampiran(name, bytes) {
  return { name: `${name}.png`, mimeType: "image/png", contentBase64: bytes.toString("base64") };
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let nomorPdf = 0;
function pdfStub() {
  nomorPdf += 1;
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Bukti ${nomorPdf}>>endobj\n%%EOF`);
}

const K = {};

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-arsip-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-arsip-uploads-${process.pid}-${Date.now()}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        GEOCODING_ENABLED: "false",
        TURSO_DATABASE_URL: `file:${databasePath}`,
        APP_URL: baseUrl,
        UPLOAD_DIR: uploadDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
  await masuk(ADMIN);

  K.png = {
    terima: await png("#ff0000"),
    dp: await png("#00ff00"),
    lunas: await png("#0000ff"),
    vendor: await png("#ffff00"),
    b: await png("#ff00ff"),
    extra: await png("#00ffff"),
    f1: await png("#808080"),
    rekon: await png("#123456"),
  };

  const bank = await json("/api/bank-accounts", {
    method: "POST",
    body: JSON.stringify({ bankName: "Bank Arsip", accountName: "PerumNet Arsip", accountNumber: "8800112233", openingBalance: 100_000_000, syncMode: "Manual" }),
  }, 201);
  K.bankId = bank.id;

  // Proyek A: quotation diterima berlampiran, dua invoice, dua pembayaran
  // berlampiran, SPK dengan pembayaran DP, uang muka, transaksi manual.
  const proyekA = await json("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Arsip Proyek A", client: "PT Klien Arsip", location: "Gianyar", status: "Aktif", value: 0, clientEmail: "klien-a@contoh.test" }),
  }, 201);
  K.proyekA = proyekA;
  const itemA = await json(`/api/boq/items?projectId=${proyekA.id}`, {
    method: "POST",
    body: JSON.stringify({ category: "Jasa", description: "Instalasi jaringan A", quantity: 1, unit: "paket", costPrice: 5_000_000, sellingPrice: 10_000_000 }),
  }, 201);
  await json(`/api/quotations?projectId=${proyekA.id}`, { method: "PATCH", body: JSON.stringify({ status: "Sent" }) });
  const qA = await json(`/api/quotations?projectId=${proyekA.id}`);
  await json(`/api/quotations/${qA.id}/accept`, {
    method: "POST",
    body: JSON.stringify({ acceptedAt: "2026-07-01", attachment: lampiran("terima-a", K.png.terima) }),
  });
  K.quotationA = await json(`/api/quotations?projectId=${proyekA.id}`);

  const invoice = (type, bps, issueDate) => json("/api/invoices", {
    method: "POST",
    body: JSON.stringify({ projectId: proyekA.id, quotationId: K.quotationA.id, type, issueDate, dueDate: "2026-08-15", calculationMode: "Percent", installmentBps: bps }),
  }, 201);
  K.invDp = await invoice("DP", 3000, "2026-07-02");
  K.invLunas = await invoice("Pelunasan", 7000, "2026-07-03");

  // POST pembayaran memulangkan INVOICE-nya (dengan payments[]), bukan baris
  // pembayaran — tiap invoice di sini hanya punya satu pembayaran.
  const bayar = async (inv, ref, tanggal, bytes) => {
    const updated = await json(`/api/invoices/${inv.id}/payments`, {
      method: "POST",
      body: JSON.stringify({
        grossAmount: inv.amount, cashAmount: inv.amount, withholdingAmount: 0, paidDate: tanggal,
        paymentReference: ref, paymentMethod: "Transfer Bank", bankAccountId: bank.id, attachment: lampiran(ref, bytes),
      }),
    }, 201);
    const pembayaran = (updated.payments ?? []).find((p) => p.status !== "Void") ?? updated.payments?.[0];
    assert.ok(pembayaran?.id, `pembayaran ${ref} tidak ada di balasan: ${Object.keys(updated).join(",")}`);
    return pembayaran;
  };
  K.payDp = await bayar(K.invDp, "ARSIP-DP", "2026-07-20", K.png.dp);
  K.payLunas = await bayar(K.invLunas, "ARSIP-LUNAS", "2026-07-25", K.png.lunas);

  // Akun: PM anggota proyek A saja; dua Finance.
  const buatAkun = async (name, email, role) => json("/api/users", {
    method: "POST",
    body: JSON.stringify({ name, email, password: SANDI, role, status: "Aktif" }),
  }, 201);
  K.pm = await buatAkun("PM Arsip", "pm.arsip@perumnet.id", "Project Manager");
  K.f1 = await buatAkun("Finance Satu", "finance1.arsip@perumnet.id", "Finance");
  K.f2 = await buatAkun("Finance Dua", "finance2.arsip@perumnet.id", "Finance");
  await json(`/api/projects/${proyekA.id}/access`, { method: "PUT", body: JSON.stringify({ userIds: [K.pm.id] }) });

  K.advance = await json("/api/project-advances", {
    method: "POST",
    body: JSON.stringify({ projectId: proyekA.id, recipientUserId: K.pm.id, amount: 500_000, disbursedDate: "2026-07-21", bankAccountId: bank.id, paymentReference: "UM-ARSIP-1", notes: "Uang muka lapangan." }),
  }, 201);

  K.manualA = await json("/api/transactions", {
    method: "POST",
    body: JSON.stringify({ projectId: proyekA.id, date: "2026-07-22", type: "Pengeluaran", description: "Konsumsi rapat lapangan", amount: 150_000, source: "Kas kecil", category: "Operasional" }),
  }, 201);

  // SPK vendor dengan pembayaran DP (bukti NOT NULL di spk_payments).
  const vendor = await json("/api/vendors", {
    method: "POST",
    body: JSON.stringify({ name: "Vendor Arsip", vendorType: "Jasa", category: "Teknisi Jaringan", contact: "0812", email: "vendor.arsip@contoh.test", rate: 0, status: "Aktif" }),
  }, 201);
  const spk = await json("/api/procurement-orders", {
    method: "POST",
    body: JSON.stringify({
      documentType: "SPK", vendorId: vendor.id, projectId: proyekA.id, quotationId: K.quotationA.id,
      items: [{ boqItemId: itemA.id, quantity: 1, agreedUnitCost: 4_000_000 }],
      terms: [{ label: "DP", type: "DP", percentage: 30 }, { label: "Pelunasan", type: "Final", percentage: 70 }],
    }),
  }, 201);
  await json(`/api/procurement-orders/${spk.id}/submit`, { method: "POST", body: JSON.stringify({}) });
  await json(`/api/procurement-orders/${spk.id}/approve`, { method: "POST", body: JSON.stringify({ overrideReason: "Pengajuan uji arsip" }) });
  await json(`/api/procurement-orders/${spk.id}/send`, { method: "POST" });
  const detail = await json(`/api/procurement-orders/${spk.id}`);
  const termin = (detail.terms ?? detail.paymentTerms ?? []).find((t) => t.type === "DP");
  assert.ok(termin, `termin DP tidak ditemukan di ${Object.keys(detail).join(",")}`);
  K.spk = detail;
  await json(`/api/procurement-orders/${spk.id}/payments`, {
    method: "POST",
    body: JSON.stringify({
      termId: termin.id, grossAmount: 1_200_000, cashAmount: 1_200_000, withholdingAmount: 0, paidDate: "2026-07-23",
      vendorInvoiceNumber: "TAG-ARSIP-DP", paymentReference: "VND-ARSIP-DP", paymentMethod: "Transfer Bank",
      bankAccountId: bank.id, attachment: lampiran("bukti-vendor", K.png.vendor),
    }),
  }, 201);
  const sesudahBayar = await json(`/api/procurement-orders/${spk.id}`);
  K.paySpk = (sesudahBayar.payments ?? [])[0];
  assert.ok(K.paySpk?.id, `pembayaran SPK tidak ada di detail: ${Object.keys(sesudahBayar).join(",")}`);

  // Proyek B: PM bukan anggota. Satu pembayaran berlampiran + satu manual.
  const proyekB = await json("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Arsip Proyek B", client: "CV Klien Lain", location: "Tabanan", status: "Aktif", value: 0, clientEmail: "klien-b@contoh.test" }),
  }, 201);
  K.proyekB = proyekB;
  await json(`/api/boq/items?projectId=${proyekB.id}`, {
    method: "POST",
    body: JSON.stringify({ category: "Jasa", description: "Instalasi B", quantity: 1, unit: "paket", costPrice: 1_000_000, sellingPrice: 2_000_000 }),
  }, 201);
  await json(`/api/quotations?projectId=${proyekB.id}`, { method: "PATCH", body: JSON.stringify({ status: "Sent" }) });
  const qB = await json(`/api/quotations?projectId=${proyekB.id}`);
  await json(`/api/quotations/${qB.id}/accept`, { method: "POST", body: JSON.stringify({ acceptedAt: "2026-07-05", attachment: lampiran("terima-b", K.png.b) }) });
  const qBFinal = await json(`/api/quotations?projectId=${proyekB.id}`);
  const invB = await json("/api/invoices", {
    method: "POST",
    body: JSON.stringify({ projectId: proyekB.id, quotationId: qBFinal.id, type: "Pelunasan", issueDate: "2026-07-06", dueDate: "2026-08-06", calculationMode: "Percent", installmentBps: 10_000 }),
  }, 201);
  K.payB = await json(`/api/invoices/${invB.id}/payments`, {
    method: "POST",
    body: JSON.stringify({
      grossAmount: invB.amount, cashAmount: invB.amount, withholdingAmount: 0, paidDate: "2026-07-26",
      paymentReference: "ARSIP-B", paymentMethod: "Transfer Bank", bankAccountId: bank.id, attachment: lampiran("bukti-b", K.png.b),
    }),
  }, 201);
  K.manualB = await json("/api/transactions", {
    method: "POST",
    body: JSON.stringify({ projectId: proyekB.id, date: "2026-07-27", type: "Pengeluaran", description: "Parkir proyek B", amount: 20_000, source: "Kas kecil", category: "Operasional" }),
  }, 201);

  // Mutasi bank: satu baris cocok dengan pembayaran DP (→ Matched), satu asing
  // (→ baris Bank: tingkat perusahaan, tanpa proyek).
  const csv = new FormData();
  csv.set("file", new File([[
    "Tanggal,Keterangan,Mutasi,Saldo,Referensi",
    `20/07/2026,TRANSFER KLIEN DP,${K.invDp.amount} CR,103000000,ARSIP-DP`,
    "01/07/2026,BIAYA ADMIN,6500 DB,99993500,ADM-07",
  ].join("\r\n")], "mutasi-arsip.csv", { type: "text/csv" }));
  csv.set("statementMonth", "2026-07");
  const imported = await json(`/api/bank-accounts/${bank.id}/import`, { method: "POST", body: csv }, 201);
  assert.equal(imported.matchedCount, 1, "pembayaran DP harus tercocokkan");
  assert.equal(imported.createdCount, 1, "baris asing harus jadi baris Bank:");
}, { timeout: 180_000 });

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      server.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
  if (uploadDirectory) rmSync(uploadDirectory, { recursive: true, force: true });
});

const daftar = (query = "") => json(`/api/finance/evidence${query ? `?${query}` : ""}`);
const jenis = (items) => [...new Set(items.map((i) => i.kind))].sort();

test("Admin melihat seluruh jenis: dua proyek, kas perusahaan, bukti kontrak", async () => {
  await masuk(ADMIN);
  const hasil = await daftar("pageSize=100");
  assert.deepEqual(hasil.summary.kinds.length, 11, "Admin boleh melihat semua jenis");
  const ada = jenis(hasil.items);
  for (const k of ["invoice-payment", "spk-payment", "advance", "manual", "bank-line", "quotation-acceptance"]) {
    assert.ok(ada.includes(k), `jenis ${k} tidak muncul; yang ada: ${ada.join(", ")}`);
  }
  assert.equal(hasil.total, hasil.items.length);
  const bank = hasil.items.find((i) => i.kind === "bank-line");
  assert.equal(bank.project, null, "baris mutasi bank tidak berproyek");
  const dp = hasil.items.find((i) => i.kind === "invoice-payment" && i.evidenceId === K.payDp.id);
  assert.ok(dp, `pembayaran DP tidak ada; yang ada: ${JSON.stringify(hasil.items.map((i) => [i.kind, i.evidenceId]))}`);
  assert.equal(dp.document.number, K.invDp.number);
  assert.equal(dp.document.pdfUrl, `/api/invoices/${K.invDp.id}/pdf`);
  assert.equal(dp.proof.hasProof, true);
  assert.equal(dp.proof.legacy[0].url, `/api/finance/evidence/invoice-payment/${K.payDp.id}/file`);
  const spk = hasil.items.find((i) => i.kind === "spk-payment");
  assert.equal(spk.counterparty, "Vendor Arsip");
  assert.equal(spk.document.pdfUrl, `/api/procurement-orders/${K.spk.id}/pdf`);
  const quo = hasil.items.find((i) => i.kind === "quotation-acceptance" && i.evidenceId === K.quotationA.id);
  assert.ok(quo, "tanda terima quotation A tidak muncul");
  assert.equal(quo.amount, K.quotationA.total);
  // Basis data baru disemai data contoh bersumber 'Invoice'/'SPK' warisan —
  // cabang `other` harus menangkapnya, bukan menjatuhkannya.
  assert.ok(ada.includes("other"), "baris kas warisan (sumber tak dikenal) harus tetap tampil sebagai other");
  assert.equal(quo.direction, null, "bukti kontrak tidak berarah");
  assert.equal(quo.proof.legacy[0].url, `/api/finance/evidence/quotation-acceptance/${K.quotationA.id}/file`);
});

test("PM hanya melihat proyeknya: tanpa proyek B, tanpa kas perusahaan, tanpa bagi hasil", async () => {
  await masuk(K.pm.email, SANDI);
  const hasil = await daftar("pageSize=100");
  assert.ok(hasil.items.length > 0);
  for (const item of hasil.items) {
    assert.equal(item.project?.id, K.proyekA.id, `${item.kind} ${item.title} bukan proyek A`);
  }
  assert.ok(!jenis(hasil.items).includes("bank-line"), "baris Bank: bocor ke PM");
  assert.ok(!hasil.summary.kinds.includes("profit-share"), "PM tidak punya modul Laba");
  const asing = await galat(`/api/finance/evidence?projectId=${K.proyekB.id}`);
  assert.equal(asing.status, 404, "proyek di luar cakupan = tidak ada");
});

test("pencarian: nomor invoice, nominal persis, dan huruf campuran", async () => {
  await masuk(ADMIN);
  const nomor = await daftar(`q=${encodeURIComponent(K.invDp.number)}`);
  assert.ok(nomor.items.length >= 1);
  for (const item of nomor.items) assert.equal(item.document?.number, K.invDp.number);
  const nominal = await daftar(`q=${encodeURIComponent("Rp 3.000.000")}`);
  assert.ok(nominal.items.some((i) => i.amount === K.invDp.amount), "nominal dengan pemisah titik harus cocok");
  const campuran = await daftar("q=KONSUMSI%20RAPAT");
  assert.ok(campuran.items.some((i) => i.kind === "manual" && i.project.id === K.proyekA.id), "pencarian tidak peka huruf");
});

test("proof=without menandai yang benar-benar tanpa bukti, dan ringkasannya cocok", async () => {
  await masuk(ADMIN);
  const hasil = await daftar("proof=without&pageSize=100");
  const ada = jenis(hasil.items);
  assert.ok(ada.includes("advance") && ada.includes("manual") && ada.includes("bank-line"), ada.join(", "));
  assert.ok(!hasil.items.some((i) => i.kind === "invoice-payment"), "pembayaran berlampiran ikut terhitung tanpa bukti");
  assert.ok(!hasil.items.some((i) => i.kind === "spk-payment"));
  // Basis data baru ikut disemai transaksi contoh tanpa bukti, jadi yang
  // dijaga adalah keanggotaan dan konsistensi — bukan jumlah mutlak.
  assert.ok(hasil.items.some((i) => i.kind === "advance" && i.evidenceId === K.advance.id));
  assert.ok(hasil.items.some((i) => i.kind === "manual" && i.id === K.manualA.id));
  assert.ok(hasil.items.some((i) => i.kind === "manual" && i.id === K.manualB.id));
  assert.equal(hasil.summary.withoutProof, hasil.total, "ringkasan dan daftar tidak sepakat");
  assert.equal(hasil.summary.byKind.advance.withoutProof, 1);
  assert.equal(hasil.summary.byKind["invoice-payment"].withoutProof, 0);
});

test("bukti legacy dilayani persis seperti yang diunggah, dengan nosniff dan tanpa cache", async () => {
  await masuk(ADMIN);
  const response = await request(`/api/finance/evidence/invoice-payment/${K.payDp.id}/file`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline/);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(sha256(body), sha256(K.png.dp), "byte yang dilayani bukan byte yang diunggah");

  const vendor = await request(`/api/finance/evidence/spk-payment/${K.paySpk.id}/file`);
  assert.equal(vendor.status, 200);
  assert.equal(sha256(Buffer.from(await vendor.arrayBuffer())), sha256(K.png.vendor));

  const tanpa = await galat(`/api/finance/evidence/advance/${K.advance.id}/file`);
  assert.equal(tanpa.code, "NO_LEGACY_PROOF");

  await masuk(K.pm.email, SANDI);
  const punyaSendiri = await request(`/api/finance/evidence/invoice-payment/${K.payDp.id}/file`);
  assert.equal(punyaSendiri.status, 200, "PM anggota proyek A boleh membuka bukti A");
  const asing = await galat(`/api/finance/evidence/invoice-payment/${K.payB.id}/file`);
  assert.equal(asing.status, 404, "bukti proyek B harus tidak ada bagi PM");
});

test("melampirkan bukti ke uang muka: PM ditolak, Admin boleh, duplikat dan batas dijaga", async () => {
  await masuk(K.pm.email, SANDI);
  const form = new FormData();
  form.append("files", new File([K.png.extra], "extra.png", { type: "image/png" }));
  const tolak = await galat(`/api/finance/evidence/advance/${K.advance.id}/attachments`, { method: "POST", body: form });
  assert.equal(tolak.status, 403, "PM tidak punya finance:manage");

  await masuk(ADMIN);
  const dua = new FormData();
  dua.append("files", new File([K.png.extra], "bukti-transfer.png", { type: "image/png" }));
  dua.append("files", new File([pdfStub()], "kwitansi.pdf", { type: "application/pdf" }));
  dua.set("note", "Bukti dari WhatsApp PM");
  const hasil = await json(`/api/finance/evidence/advance/${K.advance.id}/attachments`, { method: "POST", body: dua }, 201);
  assert.equal(hasil.items.length, 2);
  assert.equal(hasil.items[0].note, "Bukti dari WhatsApp PM");
  K.lampiran = hasil.items;

  const baris = (await daftar(`kind=advance`)).items.find((i) => i.evidenceId === K.advance.id);
  assert.equal(baris.proof.hasProof, true);
  assert.equal(baris.proof.attachments.length, 2);
  assert.equal(baris.proof.legacy.length, 0);
  const tanpaBukti = await daftar("proof=without&pageSize=100");
  assert.ok(!tanpaBukti.items.some((i) => i.kind === "advance"), "uang muka masih dianggap tanpa bukti");

  const lagi = new FormData();
  lagi.append("files", new File([K.png.extra], "sama.png", { type: "image/png" }));
  const duplikat = await galat(`/api/finance/evidence/advance/${K.advance.id}/attachments`, { method: "POST", body: lagi });
  assert.equal(duplikat.code, "DUPLICATE_ATTACHMENT");
  assert.equal(duplikat.details?.attachmentId, K.lampiran[0].id);

  const enam = new FormData();
  for (let i = 0; i < 6; i += 1) enam.append("files", new File([pdfStub()], `k${i}.pdf`, { type: "application/pdf" }));
  const terlalu = await galat(`/api/finance/evidence/advance/${K.advance.id}/attachments`, { method: "POST", body: enam });
  assert.equal(terlalu.code, "ATTACHMENT_TOO_MANY");

  const bohong = new FormData();
  bohong.append("files", new File([K.png.f1], "bukan.jpg", { type: "image/jpeg" }));
  const tipe = await galat(`/api/finance/evidence/advance/${K.advance.id}/attachments`, { method: "POST", body: bohong });
  assert.equal(tipe.status, 415);
});

test("lampiran diunduh utuh, dan Admin menghapusnya sampai ke berkasnya", async () => {
  await masuk(ADMIN);
  const [gambar, pdf] = K.lampiran;
  const response = await request(gambar.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(sha256(Buffer.from(await response.arrayBuffer())), sha256(K.png.extra));
  assert.ok(existsSync(`${uploadDirectory}/${pdf.id}`), "berkas lampiran harus ada di UPLOAD_DIR");

  const hapus = await request(`/api/finance/evidence/attachments/${pdf.id}`, { method: "DELETE" });
  assert.equal(hapus.status, 204);
  assert.equal((await galat(pdf.url)).status, 404);
  assert.equal(existsSync(`${uploadDirectory}/${pdf.id}`), false, "berkas tertinggal setelah dihapus");
});

test("aturan hapus: hanya pengunggah atau Admin, dan tidak bila sudah Matched dengan bank", async () => {
  await masuk(K.f1.email, SANDI);
  const form = new FormData();
  form.append("files", new File([K.png.f1], "dari-f1.png", { type: "image/png" }));
  const unggah = await json(`/api/finance/evidence/advance/${K.advance.id}/attachments`, { method: "POST", body: form }, 201);
  const milikF1 = unggah.items[0];

  await masuk(K.f2.email, SANDI);
  const orangLain = await galat(`/api/finance/evidence/attachments/${milikF1.id}`, { method: "DELETE" });
  assert.equal(orangLain.status, 403, "Finance lain tidak boleh menghapus unggahan orang");

  await masuk(ADMIN);
  assert.equal((await request(`/api/finance/evidence/attachments/${milikF1.id}`, { method: "DELETE" })).status, 204);

  // Pembayaran DP sudah Matched dengan mutasi bank sejak impor.
  const rekon = new FormData();
  rekon.append("files", new File([K.png.rekon], "rekon.png", { type: "image/png" }));
  const tambah = await json(`/api/finance/evidence/invoice-payment/${K.payDp.id}/attachments`, { method: "POST", body: rekon }, 201);
  const kunci = await galat(`/api/finance/evidence/attachments/${tambah.items[0].id}`, { method: "DELETE" });
  assert.equal(kunci.code, "EVIDENCE_RECONCILED");
});

test("Finance tanpa izin Procurement tidak melihat maupun membuka bukti vendor", async () => {
  await masuk(ADMIN);
  await json(`/api/users/${K.f2.id}`, { method: "PATCH", body: JSON.stringify({ permissions: { ...K.f2.permissions, procurement: "none" } }) });
  await masuk(K.f2.email, SANDI);
  const hasil = await daftar("pageSize=100");
  assert.ok(!jenis(hasil.items).includes("spk-payment"), "pembayaran vendor bocor ke akun tanpa izin Procurement");
  assert.ok(!hasil.summary.kinds.includes("spk-payment"));
  assert.ok(hasil.summary.kinds.includes("bank-line"), "Finance tetap melihat kas perusahaan");
  const tolak = await galat(`/api/finance/evidence/spk-payment/${K.paySpk.id}/file`);
  assert.equal(tolak.status, 403);
});

test("pembatalan pembayaran muncul sebagai baris reversal yang berbagi bukti asalnya", async () => {
  await masuk(ADMIN);
  await json(`/api/invoices/${K.invLunas.id}/payments/${K.payLunas.id}/void`, { method: "POST", body: JSON.stringify({ reason: "Salah rekening tujuan" }) });
  const hasil = await daftar("kind=invoice-payment&pageSize=100");
  const pasangan = hasil.items.filter((i) => i.evidenceId === K.payLunas.id);
  assert.equal(pasangan.length, 2, "pembayaran dan pembalikannya harus dua baris");
  const asal = pasangan.find((i) => !i.reversal);
  const balik = pasangan.find((i) => i.reversal);
  assert.equal(asal.direction, "Pemasukan");
  assert.equal(balik.direction, "Pengeluaran");
  assert.equal(balik.status, "Void");
  assert.equal(balik.proof.legacy[0].url, asal.proof.legacy[0].url, "reversal harus menunjuk bukti yang sama");
  const tanpa = await daftar("proof=without&pageSize=100");
  assert.ok(!tanpa.items.some((i) => i.reversal), "reversal tidak pernah 'tanpa bukti'");
});

test("pagination konsisten dan pageSize dijepit", async () => {
  await masuk(ADMIN);
  const satu = await daftar("pageSize=10&page=1");
  const dua = await daftar("pageSize=10&page=2");
  assert.equal(satu.pageSize, 10);
  assert.ok(satu.items.length <= 10);
  assert.equal(satu.total, dua.total);
  const idSatu = new Set(satu.items.map((i) => i.id));
  for (const item of dua.items) assert.ok(!idSatu.has(item.id), "halaman 2 mengulang halaman 1");
  const jepit = await daftar("pageSize=5");
  assert.equal(jepit.pageSize, 10);
});

test("buku kas kini membawa referenceId, origin, dan kunci bukti", async () => {
  await masuk(ADMIN);
  const transaksi = await json(`/api/transactions?projectId=${K.proyekA.id}`);
  const daftarTx = Array.isArray(transaksi) ? transaksi : transaksi.transactions ?? transaksi.items;
  const dp = daftarTx.find((t) => t.referenceId === K.payDp.id);
  assert.ok(dp, "transaksi pembayaran DP tidak ditemukan lewat referenceId");
  assert.equal(dp.origin, "system");
  assert.deepEqual(dp.evidence, { kind: "invoice-payment", evidenceId: K.payDp.id });
  const manual = daftarTx.find((t) => t.id === K.manualA.id);
  assert.equal(manual.origin, "manual");
  assert.equal(manual.evidence.kind, "manual");
});
