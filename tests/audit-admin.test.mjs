// Regresi dari audit logika /admin, 21 Agustus 2026 — bagian yang TIDAK
// dilalui simulasi rantai lengkap (tests/simulasi-alur-lengkap.test.mjs).
//
// Setiap tes di sini gagal pada commit sebelum perbaikannya. Polanya hampir
// selalu sama: satu pembaca menebak "dokumen terbaru" tanpa disematkan ke
// paket/scope, atau dua penulis untuk satu tindakan yang diam-diam menyimpang.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const lampiran = (label) => ({ name: `${label}.png`, mimeType: "image/png", contentBase64: PNG_1X1 });

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
  const deadline = Date.now() + 40_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
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
  return await fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function json(path, options = {}, expectedStatus = 200) {
  const response = await request(path, options);
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  assert.equal(
    response.status,
    expectedStatus,
    `${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload?.error ?? payload)}`,
  );
  return payload?.data ?? payload;
}

async function galat(path, options = {}) {
  const response = await request(path, options);
  const payload = await response.json().catch(() => null);
  return { status: response.status, code: payload?.error?.code, message: payload?.error?.message, details: payload?.error?.details };
}

async function masuk(email) {
  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "perumnet123", remember: false }),
    redirect: "manual",
  });
  assert.equal(response.status, 200, `login ${email}`);
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

let urutan = 0;
async function buatProyek(nama) {
  urutan += 1;
  return await json("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: `${nama} ${urutan}`, client: "Klien Audit", location: "Gianyar", status: "Aktif", value: 0, clientEmail: `klien${urutan}@contoh.test` }),
  }, 201);
}

async function tambahItem(projectId, packageId, sellingPrice, category = "Jasa", description = "Pekerjaan audit") {
  const paket = packageId ? `&packageId=${packageId}` : "";
  return await json(`/api/boq/items?projectId=${projectId}${paket}`, {
    method: "POST",
    body: JSON.stringify({ category, description: `${description} ${sellingPrice}`, quantity: 1, unit: "paket", costPrice: Math.round(sellingPrice / 2), sellingPrice }),
  }, 201);
}

async function quotation(projectId, packageId) {
  const paket = packageId ? `&packageId=${packageId}` : "";
  return await json(`/api/quotations?projectId=${projectId}${paket}`);
}

async function patchQuotation(projectId, packageId, body) {
  const paket = packageId ? `&packageId=${packageId}` : "";
  return await json(`/api/quotations?projectId=${projectId}${paket}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function terimaQuotation(projectId, packageId, label) {
  await patchQuotation(projectId, packageId, { status: "Sent" });
  const q = await quotation(projectId, packageId);
  await json(`/api/quotations/${q.id}/accept`, {
    method: "POST",
    body: JSON.stringify({ acceptedAt: "2026-07-01", attachment: lampiran(label) }),
  });
  return await quotation(projectId, packageId);
}

async function paketKedua(projectId, judul = "Paket Kedua") {
  // Paket default lahir saat pertama kali dibaca/dipakai. Membacanya dulu
  // memastikan paket yang dibuat di bawah benar-benar paket KEDUA.
  await json(`/api/projects/${projectId}/packages`);
  return await json(`/api/projects/${projectId}/packages`, {
    method: "POST",
    body: JSON.stringify({ title: judul, status: "Active", sortOrder: 1 }),
  }, 201);
}

async function rekening(label) {
  return await json("/api/bank-accounts", {
    method: "POST",
    body: JSON.stringify({ bankName: label, accountName: `PerumNet ${label}`, accountNumber: `${Date.now()}${urutan}`.slice(-10), openingBalance: 100_000_000, syncMode: "Manual" }),
  }, 201);
}

async function vendorJasa(label) {
  return await json("/api/vendors", {
    method: "POST",
    body: JSON.stringify({ name: label, vendorType: "Jasa", category: "Teknisi Jaringan", contact: "0812", email: `${label.toLowerCase().replace(/\s+/g, "-")}@contoh.test`, rate: 0, status: "Aktif" }),
  }, 201);
}

async function spkDraft(projectId, quotationId, vendorId, boqItemId, agreedUnitCost) {
  return await json("/api/procurement-orders", {
    method: "POST",
    body: JSON.stringify({
      documentType: "SPK", vendorId, projectId, quotationId,
      items: [{ boqItemId, quantity: 1, agreedUnitCost }],
      terms: [{ label: "DP", type: "DP", percentage: 30 }, { label: "Pelunasan", type: "Final", percentage: 70 }],
    }),
  }, 201);
}

function dbClient() {
  return createClient({ url: `file:${databasePath}` });
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-audit-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-audit-uploads-${process.pid}-${Date.now()}`;
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
        MAIL_BRANDING_MODE: "capture",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
  await masuk("admin@perumnet.id");
}, { timeout: 60_000 });

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

// ── Nilai proyek & riwayat revisi ────────────────────────────────────────────

test("L2: nilai proyek multi-paket = kontrak paket yang diterima + BoQ paket yang belum", async () => {
  await masuk("admin@perumnet.id");
  const proyek = await buatProyek("Nilai Multi Paket");
  const kedua = await paketKedua(proyek.id);
  await tambahItem(proyek.id, null, 100_000_000);
  await tambahItem(proyek.id, kedua.id, 50_000_000);
  await terimaQuotation(proyek.id, null, "l2");
  const sesudah = await json(`/api/projects/${proyek.id}`);
  // Dulu 100 jt: paket B yang masih Draft lenyap begitu paket A diterima.
  assert.equal(sesudah.value, 150_000_000);
});

test("L1: total revisi Superseded tidak ditimpa BoQ hidup oleh sinkronisasi ringan", async () => {
  await masuk("admin@perumnet.id");
  const proyek = await buatProyek("Riwayat Revisi");
  const kedua = await paketKedua(proyek.id);
  await tambahItem(proyek.id, null, 20_000_000);
  await terimaQuotation(proyek.id, null, "l1");
  const itemB = await tambahItem(proyek.id, kedua.id, 5_000_000);
  await patchQuotation(proyek.id, kedua.id, { status: "Sent" });
  // BoQ berubah setelah Sent → revisi: R1 Superseded (5 jt), R2 Draft (6 jt).
  await json(`/api/boq/items/${itemB.id}?projectId=${proyek.id}&packageId=${kedua.id}`, {
    method: "PATCH",
    body: JSON.stringify({ category: "Jasa", description: "Pekerjaan audit 6 jt", quantity: 1, unit: "paket", costPrice: 3_000_000, sellingPrice: 6_000_000 }),
  });
  // Addendum di paket A memanggil syncProjectCommercialValue — yang dulu
  // menulis ulang `total` SEMUA quotation proyek, termasuk yang Superseded.
  await json(`/api/boq/scopes?projectId=${proyek.id}`, {
    method: "POST",
    body: JSON.stringify({ title: "Addendum A", items: [{ category: "Jasa", description: "Tambahan", quantity: 1, unit: "paket", costPrice: 100_000, sellingPrice: 250_000 }] }),
  }, 201);
  const riwayat = await json(`/api/quotations/history?projectId=${proyek.id}&packageId=${kedua.id}`);
  const lama = riwayat.find((r) => r.status === "Superseded");
  assert.ok(lama, "revisi lama tercatat Superseded");
  assert.equal(lama.total, 5_000_000, "angka historis revisi lama tetap 5 jt");
});

test("L8: diskon nominal yang dibawa ke revisi dipotong ke subtotal baru", async () => {
  await masuk("admin@perumnet.id");
  const proyek = await buatProyek("Diskon Revisi");
  const item = await tambahItem(proyek.id, null, 10_000_000);
  await patchQuotation(proyek.id, null, { discountEnabled: true, discountType: "Nominal", discountValue: 5_000_000 });
  await patchQuotation(proyek.id, null, { status: "Sent" });
  await json(`/api/boq/items/${item.id}?projectId=${proyek.id}`, {
    method: "PATCH",
    body: JSON.stringify({ category: "Jasa", description: "Pekerjaan audit 3 jt", quantity: 1, unit: "paket", costPrice: 1_500_000, sellingPrice: 3_000_000 }),
  });
  const revisi = await quotation(proyek.id, null);
  assert.match(revisi.number, /-R2$/);
  assert.ok(revisi.discountValue <= 3_000_000, `diskon tersimpan ${revisi.discountValue} ≤ subtotal baru`);
  assert.equal(revisi.grandTotal, 3_000_000 - revisi.discountAmount);
});

// ── Invoice Nominal per paket ────────────────────────────────────────────────

test("L3: batas invoice Nominal dihitung per paket, bukan se-proyek", async () => {
  await masuk("admin@perumnet.id");
  const proyek = await buatProyek("Nominal Per Paket");
  const kedua = await paketKedua(proyek.id);
  await tambahItem(proyek.id, null, 10_000_000);
  await tambahItem(proyek.id, kedua.id, 5_000_000);
  const qA = await terimaQuotation(proyek.id, null, "l3a");
  const qB = await terimaQuotation(proyek.id, kedua.id, "l3b");
  // Paket A sudah ditagih 100%.
  await json("/api/invoices", {
    method: "POST",
    body: JSON.stringify({ projectId: proyek.id, quotationId: qA.id, type: "Pelunasan", issueDate: "2026-07-02", dueDate: "2026-07-16", calculationMode: "Percent", installmentBps: 10_000 }),
  }, 201);
  // Invoice Nominal paket B sebesar kontrak paket B harus diterima. Dulu
  // jumlah invoice se-proyek (10 jt) + 5 jt dibandingkan dengan satu quotation
  // yang kebetulan terpilih → INVOICE_EXCEEDS_QUOTATION tanpa alasan.
  const nominal = await json("/api/invoices", {
    method: "POST",
    body: JSON.stringify({ projectId: proyek.id, packageId: kedua.id, quotationId: qB.id, type: "Nominal B", issueDate: "2026-07-03", dueDate: "2026-07-17", calculationMode: "Nominal", amount: 5_000_000 }),
  }, 201);
  assert.equal(nominal.amount, 5_000_000);
  const lebih = await galat("/api/invoices", {
    method: "POST",
    body: JSON.stringify({ projectId: proyek.id, packageId: kedua.id, quotationId: qB.id, type: "Nominal B2", issueDate: "2026-07-03", dueDate: "2026-07-17", calculationMode: "Nominal", amount: 1 }),
  });
  assert.equal(lebih.code, "INVOICE_EXCEEDS_QUOTATION", "jatah paket B memang sudah habis");
});

// ── Procurement ──────────────────────────────────────────────────────────────

test("P1: pembayaran vendor tanpa kas ditolak rapi, bukan 500", async () => {
  await masuk("admin@perumnet.id");
  const proyek = await buatProyek("Kas Nol");
  const item = await tambahItem(proyek.id, null, 8_000_000);
  const q = await terimaQuotation(proyek.id, null, "p1");
  const vendor = await vendorJasa("Vendor Kas Nol");
  const spk = await spkDraft(proyek.id, q.id, vendor.id, item.id, 4_000_000);
  await json(`/api/procurement-orders/${spk.id}/submit`, { method: "POST" });
  await masuk("sri@perumnet.id");
  const disetujui = await json(`/api/procurement-orders/${spk.id}/approve`, { method: "POST", body: "{}" });
  await masuk("admin@perumnet.id");
  await json(`/api/procurement-orders/${spk.id}/send`, { method: "POST" });
  const bank = await rekening("BCA Kas Nol");
  const gagal = await galat(`/api/procurement-orders/${spk.id}/payments`, {
    method: "POST",
    body: JSON.stringify({
      termId: disetujui.terms.find((t) => t.type === "DP").id,
      grossAmount: 1_000, cashAmount: 0, withholdingAmount: 1_000,
      paidDate: "2026-07-10", vendorInvoiceNumber: "TAG-0", paymentReference: "REF-0",
      paymentMethod: "Transfer Bank", bankAccountId: bank.id, attachment: lampiran("bukti"),
    }),
  });
  assert.equal(gagal.status, 422);
  assert.equal(gagal.code, "CASH_AMOUNT_REQUIRED");
});

test("P4+P5: pajak SPK Draft mengikuti harga baru, dan ikut terhapus bersama dokumennya", async () => {
  await masuk("admin@perumnet.id");
  await json("/api/tax/settings", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  const rules = await json("/api/tax/rules");
  const ppn = rules.find((r) => r.code === "PPN");
  await json(`/api/tax/rules/${ppn.id}`, { method: "PATCH", body: JSON.stringify({ rateBps: 1_100, status: "Active", scope: "Both" }) });
  const proyek = await buatProyek("Pajak Draft SPK");
  const item = await tambahItem(proyek.id, null, 10_000_000);
  const q = await terimaQuotation(proyek.id, null, "p4");
  const vendor = await vendorJasa("Vendor Pajak Draft");
  const spk = await spkDraft(proyek.id, q.id, vendor.id, item.id, 4_000_000);
  await json(`/api/procurement-orders/${spk.id}/taxes`, { method: "PUT", body: JSON.stringify({ ruleIds: [ppn.id] }) });
  const sebelum = await json(`/api/procurement-orders/${spk.id}`);
  assert.equal(sebelum.taxAdditions, 440_000);
  await json(`/api/procurement-orders/${spk.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      documentType: "SPK", vendorId: vendor.id, projectId: proyek.id, quotationId: q.id,
      items: [{ boqItemId: item.id, quantity: 1, agreedUnitCost: 6_000_000 }],
      terms: [{ label: "DP", type: "DP", percentage: 30 }, { label: "Pelunasan", type: "Final", percentage: 70 }],
    }),
  });
  const sesudah = await json(`/api/procurement-orders/${spk.id}`);
  // Dulu tetap 440.000: pajak terpaku di harga lama, dan itu yang dikunci approve.
  assert.equal(sesudah.taxAdditions, 660_000, "PPN mengikuti harga baru");
  assert.equal(sesudah.grossTotal, 6_660_000);

  await json(`/api/procurement-orders/${spk.id}`, { method: "DELETE" }, 204);
  const db = dbClient();
  const sisa = await db.execute({ sql: "SELECT COUNT(*) AS n FROM document_taxes WHERE document_id=?", args: [spk.id] });
  db.close();
  assert.equal(Number(sisa.rows[0].n), 0, "baris pajak tidak yatim setelah dokumen dihapus");
});

// ── Bank ─────────────────────────────────────────────────────────────────────

test("P9: dua kandidat kembar — yang dibayar lewat rekening ini yang dicocokkan; pencocokan manual menolak tanggal jauh", async () => {
  await masuk("admin@perumnet.id");
  const bank1 = await rekening("BCA Utama");
  const bank2 = await rekening("Mandiri Cadangan");
  const proyek = await buatProyek("Kembar Rekening");
  await tambahItem(proyek.id, null, 2_000_000);
  const q = await terimaQuotation(proyek.id, null, "p9");
  const inv1 = await json("/api/invoices", { method: "POST", body: JSON.stringify({ projectId: proyek.id, quotationId: q.id, type: "Termin A", issueDate: "2026-07-01", dueDate: "2026-07-15", calculationMode: "Percent", installmentBps: 5_000 }) }, 201);
  const inv2 = await json("/api/invoices", { method: "POST", body: JSON.stringify({ projectId: proyek.id, quotationId: q.id, type: "Termin B", issueDate: "2026-07-01", dueDate: "2026-07-15", calculationMode: "Percent", installmentBps: 5_000 }) }, 201);
  assert.equal(inv1.amount, inv2.amount, "dua invoice bernilai sama");
  const bayar = (invoiceId, bankId, ref) => json(`/api/invoices/${invoiceId}/payments`, {
    method: "POST",
    body: JSON.stringify({ grossAmount: inv1.amount, cashAmount: inv1.amount, withholdingAmount: 0, paidDate: "2026-07-05", paymentReference: ref, paymentMethod: "Transfer Bank", bankAccountId: bankId, attachment: lampiran("bukti") }),
  }, 201);
  await bayar(inv1.id, bank1.id, "MASUK-1");
  await bayar(inv2.id, bank2.id, "MASUK-2");
  const csv = ["MUTASI REKENING BCA", "Nomor Rekening,1234567890", "Tanggal,Keterangan,Mutasi,Saldo,Referensi", `05/07/2026,TRANSFER MASUK,${inv1.amount} CR,${100_000_000 + inv1.amount},MASUK-1`].join("\r\n");
  const form = new FormData();
  form.set("file", new File([csv], "mutasi.csv", { type: "text/csv" }));
  form.set("statementMonth", "2026-07");
  const impor = await json(`/api/bank-accounts/${bank1.id}/import`, { method: "POST", body: form }, 201);
  // Dulu 0: dua kandidat sama arah/nominal/tanggal → tidak ada yang dicocokkan,
  // padahal hanya satu yang memang dibayar lewat rekening ini.
  assert.equal(impor.matchedCount, 1, "kandidat dari rekening ini yang menang");

  // Pencocokan manual ke transaksi 40 hari jauhnya ditolak.
  const jauh = await json("/api/invoices", { method: "POST", body: JSON.stringify({ projectId: proyek.id, quotationId: q.id, type: "C", issueDate: "2026-05-01", dueDate: "2026-05-15", calculationMode: "Percent", installmentBps: 1 }) }, 201).catch(() => null);
  void jauh;
  const csv2 = ["MUTASI REKENING BCA", "Nomor Rekening,1234567890", "Tanggal,Keterangan,Mutasi,Saldo,Referensi", `20/08/2026,TRANSFER ASING,${inv2.amount} CR,${100_000_000 + inv1.amount + inv2.amount},ASING-1`].join("\r\n");
  const form2 = new FormData();
  form2.set("file", new File([csv2], "mutasi2.csv", { type: "text/csv" }));
  form2.set("statementMonth", "2026-08");
  const impor2 = await json(`/api/bank-accounts/${bank1.id}/import`, { method: "POST", body: form2 }, 201);
  assert.equal(impor2.matchedCount, 0);
  const entri = (await json(`/api/bank-accounts/${bank1.id}/entries`)).items?.find?.((e) => e.reference === "ASING-1")
    ?? (await json(`/api/bank-accounts/${bank1.id}/entries`)).find?.((e) => e.reference === "ASING-1");
  assert.ok(entri, "mutasi asing terbaca");
  const transaksi = (await json(`/api/transactions?projectId=${proyek.id}`)).find((t) => t.description?.includes("MASUK-2"));
  assert.ok(transaksi, "transaksi pembayaran kedua terbaca");
  const ditolak = await galat(`/api/bank-accounts/${bank1.id}/entries/${entri.id}/reconcile`, {
    method: "PATCH",
    body: JSON.stringify({ action: "match", transactionId: transaksi.id }),
  });
  assert.equal(ditolak.status, 422);
  assert.equal(ditolak.code, "MATCH_DATE_TOO_FAR");
});

// ── BAST & validasi ──────────────────────────────────────────────────────────

test("P11: BAST pada proyek tanpa kontrak diterima tidak menutup proyek", async () => {
  await masuk("admin@perumnet.id");
  const proyek = await buatProyek("BAST Tanpa Kontrak");
  await tambahItem(proyek.id, null, 3_000_000, "Perangkat", "Access point");
  const validasi = await json(`/api/validations?projectId=${proyek.id}`, { method: "POST" }, 201);
  await json(`/api/validations/${validasi.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Completed", notes: "Lulus.", items: validasi.items.map((i) => ({ ...i, checked: true })) }),
  });
  await json("/api/bast/settings/seal", {
    method: "PUT",
    body: JSON.stringify({ enabled: true, signerName: "Direktur", signerRole: "Direktur", sealMimeType: "image/png", sealContentBase64: PNG_1X1 }),
  });
  const ttd = `data:image/png;base64,${PNG_1X1}`;
  const bast = await json("/api/bast", {
    method: "POST",
    body: JSON.stringify({
      projectId: proyek.id, completionDate: "2026-07-20", notes: "Serah terima uji audit.",
      installedItems: [{ name: "Access Point", quantity: "1 unit", status: "Terpasang" }],
      clientName: "Klien", clientRole: "Manager", engineerName: "Engineer", engineerRole: "PM",
      status: "Draft", clientSignature: ttd, engineerSignature: ttd,
    }),
  }, 201);
  const final = await json(`/api/bast/${bast.id}/finalize`, { method: "POST" });
  assert.equal(final.status, "Final");
  assert.ok(final.finalizedAt);
  const sesudah = await json(`/api/projects/${proyek.id}`);
  // Dulu langsung Selesai: cabang `delivering === 0` menutup proyek yang
  // belum punya satu pun quotation Accepted.
  assert.equal(sesudah.status, "Aktif");
});

test("P12: siklus serah terima yang bukan bilangan ditolak, bukan jadi NaN", async () => {
  await masuk("admin@perumnet.id");
  const proyek = await buatProyek("Siklus NaN");
  const gagal = await galat(`/api/validations?projectId=${proyek.id}&deliveryCycle=abc`);
  assert.equal(gagal.status, 422);
  assert.equal(gagal.code, "INVALID_DELIVERY_CYCLE");
});

// ── Bagan alur ───────────────────────────────────────────────────────────────

test("E: /api/help/alur.png memulangkan PNG sungguhan per bahasa, di balik sesi", async () => {
  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  const tanpaSesi = await request("/api/help/alur.png");
  assert.equal(tanpaSesi.status, 401);
  await masuk("agus@perumnet.id");
  for (const language of ["id", "en"]) {
    const response = await request(`/api/help/alur.png?language=${language}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "magic bytes PNG");
    // Lebar dibaca dari chunk IHDR (byte 16–19, big-endian): 1400 px × 2.
    assert.equal(bytes.readUInt32BE(16), 2800, "lebar bagan 2800 px");
    assert.ok(bytes.length > 20_000 && bytes.length < 3_000_000, `ukuran wajar (${bytes.length} bait)`);
  }
  const svgDitolak = await request("/api/help/alur.svg");
  assert.equal(svgDitolak.status, 404, "tidak ada SVG yang dilayani");
});

// ── Alur deal: izin & transisi ───────────────────────────────────────────────

test("D: konversi prospek butuh izin proyek; Lost tidak bisa langsung Won tapi bisa dibuka kembali", async () => {
  await masuk("admin@perumnet.id");
  const prospek = await json("/api/cms/prospects", {
    method: "POST",
    body: JSON.stringify({ fullName: "Kontak Audit", email: "audit-deal@contoh.test", companyName: "PT Audit Deal", location: "Ubud", source: "referensi" }),
  }, 201);
  await json(`/api/cms/prospects/${prospek.id}`, { method: "PATCH", body: JSON.stringify({ status: "Lost" }) });
  const langsungWon = await galat(`/api/cms/prospects/${prospek.id}`, { method: "PATCH", body: JSON.stringify({ status: "Won" }) });
  assert.equal(langsungWon.code, "INVALID_PROSPECT_TRANSITION");
  const konversiLost = await galat(`/api/cms/prospects/${prospek.id}/convert`, { method: "POST", body: "{}" });
  assert.equal(konversiLost.code, "PROSPECT_NOT_CONVERTIBLE");
  const dibuka = await json(`/api/cms/prospects/${prospek.id}`, { method: "PATCH", body: JSON.stringify({ status: "New" }) });
  assert.equal(dibuka.status, "New");

  // Finance: prospects:manage tapi projects hanya view → tidak boleh membuat proyek.
  await masuk("sri@perumnet.id");
  const finance = await galat(`/api/cms/prospects/${prospek.id}/convert`, { method: "POST", body: "{}" });
  assert.equal(finance.status, 403);

  await masuk("admin@perumnet.id");
  const hasil = await json(`/api/cms/prospects/${prospek.id}/convert`, { method: "POST", body: JSON.stringify({ status: "Aktif" }) }, 201);
  assert.equal(hasil.prospect.status, "Won");
  const daftar = await json("/api/cms/prospects?q=Audit%20Deal");
  const baris = daftar.items.find((p) => p.id === prospek.id);
  assert.equal(baris.projectCode, hasil.project.code, "daftar prospek menampilkan kode proyeknya");
});

// ── Template surat dokumen: izin mengikuti jenis dokumennya ─────────────────
//
// Dilaporkan pemilik 22 Agustus 2026: template quotation dibuat di Calon Klien
// dan tidak pernah muncul di dialog Kirim. Dua sistem berbeda — itu benar —
// tetapi pengelola template dokumen dijaga izin Procurement untuk SEMUA jenis,
// sehingga Finance tanpa izin Procurement tidak bisa membuat template invoice
// sekalipun ia yang menagih.

test("T: template quotation/invoice ikut izin Billing, SPK ikut Procurement", async () => {
  await masuk("admin@perumnet.id");
  const buat = (documentKind, name) => json("/api/document-email-templates", {
    method: "POST",
    body: JSON.stringify({
      documentKind, name,
      subject: `${name} {{nomor}}`,
      bodyHtml: "Yth. {{klien}},\n\nTerlampir {{nomor}}.",
      bodyFormat: "text",
    }),
  }, 201);
  const tplQuotation = await buat("quotation", `Pengantar Penawaran ${Date.now()}`);
  const tplSpk = await buat("spk", `Pengantar SPK ${Date.now()}`);

  const semua = await json("/api/document-email-templates");
  assert.deepEqual(semua.viewableKinds.sort(), ["invoice", "quotation", "spk"], "Admin melihat semua jenis");
  assert.equal(semua.audience.quotation, "klien");
  assert.equal(semua.audience.spk, "vendor");

  // Akun Finance khusus: izin Billing penuh, Procurement dicabut.
  const email = `finance.template.${Date.now()}@perumnet.id`;
  const sandi = "Finance-Template-2026";
  const akun = await json("/api/users", {
    method: "POST",
    body: JSON.stringify({
      name: "Finance Template", email, password: sandi, role: "Finance", status: "Aktif",
    }),
  }, 201);
  await json(`/api/users/${akun.id}`, {
    method: "PATCH",
    body: JSON.stringify({ permissions: { ...akun.permissions, procurement: "none", billing: "manage" } }),
  });

  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  const masukFinance = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: sandi, remember: false }),
    redirect: "manual",
  });
  assert.equal(masukFinance.status, 200);
  cookie = masukFinance.headers.get("set-cookie")?.split(";")[0] ?? "";

  // Boleh mengelola template klien...
  const daftar = await json("/api/document-email-templates");
  assert.deepEqual(daftar.viewableKinds.sort(), ["invoice", "quotation"], "hanya jenis klien yang terlihat");
  assert.equal(daftar.items.some((t) => t.id === tplQuotation.id), true, "template quotation terbaca");
  assert.equal(daftar.items.some((t) => t.id === tplSpk.id), false, "template SPK disaring, bukan menolak seluruh daftar");
  const invoiceBaru = await json("/api/document-email-templates", {
    method: "POST",
    body: JSON.stringify({
      documentKind: "invoice", name: `Pengantar Invoice ${Date.now()}`,
      subject: "Invoice {{nomor}}", bodyHtml: "Yth. {{klien}},\n\nInvoice {{nomor}}.", bodyFormat: "text",
    }),
  }, 201);
  assert.equal(invoiceBaru.documentKind, "invoice");

  // ...tetapi tidak boleh menyentuh template vendor.
  const bacaSpk = await galat(`/api/document-email-templates/${tplSpk.id}`);
  assert.equal(bacaSpk.status, 403);
  assert.equal(bacaSpk.details?.module, "procurement");
  const buatSpk = await galat("/api/document-email-templates", {
    method: "POST",
    body: JSON.stringify({
      documentKind: "spk", name: "SPK Terlarang",
      subject: "SPK {{nomor}}", bodyHtml: "Yth. {{vendor}},\n\nTerlampir {{nomor}}.", bodyFormat: "text",
    }),
  });
  assert.equal(buatSpk.status, 403);
  const hapusSpk = await galat(`/api/document-email-templates/${tplSpk.id}`, { method: "DELETE" });
  assert.equal(hapusSpk.status, 403);
  // Memindahkan template klien menjadi template vendor juga ditolak.
  const pindah = await galat(`/api/document-email-templates/${tplQuotation.id}`, {
    method: "PATCH",
    body: JSON.stringify({ documentKind: "spk" }),
  });
  assert.equal(pindah.status, 403);

  await masuk("admin@perumnet.id");
});
