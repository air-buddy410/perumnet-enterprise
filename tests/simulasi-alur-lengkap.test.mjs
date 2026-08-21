// Simulasi rantai bisnis LENGKAP, dua kali: pajak OFF lalu pajak ON.
//
// Calon klien → deal → proyek → BoQ → quotation → invoice → pembayaran klien →
// SPK vendor → verifikasi → pembayaran vendor → belanja proyek → validasi →
// BAST → mutasi bank → bagi laba → pajak → void & reversal.
//
// Setiap langkah punya test() sendiri dan membaca `K` (konteks putaran) supaya
// kegagalan menunjuk LANGKAH yang salah, bukan "rantai gagal". Yang dijaga di
// tiap langkah adalah invarian uang: angka yang dibaca dari satu layar harus
// sama persis dengan angka yang ditulis layar sebelumnya — quotation → invoice
// → kas → laba → pajak — bukan sekadar "endpoint menjawab 200".
//
// Saklar pajak bersifat global, jadi kedua putaran berjalan BERURUTAN di satu
// server: putaran OFF dulu, lalu saklar dinyalakan, lalu putaran ON. Itu
// sekaligus menguji aturan "menyalakan pajak tidak mengubah dokumen yang sudah
// ada": angka putaran OFF diperiksa ulang setelah saklar menyala.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";

let server;
let baseUrl;
let databasePath;
let uploadDirectory;
let cookie = "";

const SANDI = "perumnet123";
const ADMIN = "admin@perumnet.id";
const FINANCE = "sri@perumnet.id";

// PNG 1×1 yang sah — lampiran diperiksa dari ISI berkasnya.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// Nota dibedakan per pemakaian: berkas yang sama persis ditolak sebagai
// DUPLICATE_RECEIPT — itu memang pengaman, bukan gangguan.
let nomorNota = 0;
function notaPdf() {
  nomorNota += 1;
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Nota ${nomorNota}>>endobj\n%%EOF`);
}

function lampiran(label) {
  return { name: `${label}.png`, mimeType: "image/png", contentBase64: PNG_1X1 };
}

// Tanggal-tanggal dipaksa ke Juli 2026 supaya laporan bulanan bisa diperiksa
// dengan angka pasti, dan void yang terjadi "hari ini" jatuh di bulan lain.
const TGL = {
  invoice1Terbit: "2026-07-03",
  invoice1Tempo: "2026-07-17",
  invoice2Terbit: "2026-07-10",
  invoice2Tempo: "2026-07-24",
  bayarKlien: "2026-07-08",
  bayarDpVendor: "2026-07-12",
  bayarFinalVendor: "2026-07-20",
  belanja: "2026-07-14",
  reimburse: "2026-07-15",
  bast: "2026-07-22",
  bagiLaba: "2026-07-28",
  setorPajak: "2026-07-30",
};
const BULAN = "2026-07";

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
    body: JSON.stringify({ email, password: SANDI, remember: false }),
    redirect: "manual",
  });
  assert.equal(response.status, 200, `login ${email}`);
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-simulasi-${process.pid}-${Date.now()}.db`;
  uploadDirectory = `/tmp/perumnet-simulasi-uploads-${process.pid}-${Date.now()}`;
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

// ── Angka acuan ──────────────────────────────────────────────────────────────
//
// BoQ: Perangkat 20 jt + Material 5 jt + Jasa 10 jt = 35 jt. Diskon 1 jt.
// Taxable base 34 jt. PPN 11% = 3.740.000. PPh 23 klien 2% = 680.000.
// Vendor: Jasa 8 jt, DP 30% / Final 70%. PPN vendor 11% = 880.000 (Recoverable),
// PPh 23 vendor 2% = 160.000 (Withhold).

const SUBTOTAL = 35_000_000;
const DISKON = 1_000_000;
const BASE = SUBTOTAL - DISKON;
const PPN_BPS = 1_100;
const PPH_BPS = 200;
const VENDOR_KONTRAK = 8_000_000;

function angka(pajak) {
  const ppn = pajak ? Math.round((BASE * PPN_BPS) / 10_000) : 0;
  const pphKlien = pajak ? Math.round((BASE * PPH_BPS) / 10_000) : 0;
  const grandTotal = BASE + ppn;
  const invoice1 = Math.round((grandTotal * 3_000) / 10_000);
  const invoice2 = grandTotal - invoice1;
  const potong1 = pajak ? Math.round((pphKlien * 3_000) / 10_000) : 0;
  const potong2 = pphKlien - potong1;
  const vendorPpn = pajak ? Math.round((VENDOR_KONTRAK * PPN_BPS) / 10_000) : 0;
  const vendorPph = pajak ? Math.round((VENDOR_KONTRAK * PPH_BPS) / 10_000) : 0;
  const vendorGross = VENDOR_KONTRAK + vendorPpn;
  const faktor = vendorGross / VENDOR_KONTRAK;
  const dpPlanned = Math.round((VENDOR_KONTRAK * 3_000) / 10_000);
  const finalPlanned = VENDOR_KONTRAK - dpPlanned;
  const dpGross = Math.round(dpPlanned * faktor);
  const finalGross = vendorGross - dpGross;
  const dpPotong = pajak ? Math.round((dpPlanned * PPH_BPS) / 10_000) : 0;
  const finalPotong = vendorPph - dpPotong;
  // Pelunasan vendor dibayar dua kali, 40% lalu 60% — sengaja TIDAK sama besar
  // supaya pencocokan bank tidak menemukan dua kandidat kembar di satu tanggal.
  const final1Gross = Math.round(finalGross * 0.4);
  const final1Potong = Math.round(finalPotong * 0.4);
  const final2Gross = finalGross - final1Gross;
  const final2Potong = finalPotong - final1Potong;
  return {
    ppn, pphKlien, grandTotal, invoice1, invoice2, potong1, potong2,
    vendorPpn, vendorPph, vendorGross, dpPlanned, finalPlanned,
    dpGross, finalGross, dpPotong, finalPotong,
    final1Gross, final1Potong, final2Gross, final2Potong,
    final1Cash: final1Gross - final1Potong, final2Cash: final2Gross - final2Potong,
    dpCash: dpGross - dpPotong, finalCash: finalGross - finalPotong,
    kasKlien1: invoice1 - potong1,
    kasKlien2: invoice2 - potong2,
    kasKlien: grandTotal - pphKlien,
  };
}

const BELANJA = 500_000;

// Konteks per putaran. Diisi langkah demi langkah.
const putaran = { off: { pajak: false, A: angka(false) }, on: { pajak: true, A: angka(true) } };
let bersama = {};

async function siapkanBersama() {
  if (bersama.bankId) return;
  await masuk(ADMIN);
  const bank = await json("/api/bank-accounts", {
    method: "POST",
    body: JSON.stringify({
      bankName: "BCA Simulasi",
      accountName: "PerumNet Simulasi",
      accountNumber: `${Date.now()}`.slice(-10),
      openingBalance: 50_000_000,
      syncMode: "Manual",
    }),
  }, 201);
  const kategori = await json("/api/project-expense-categories");
  const material = kategori.find((item) => item.name === "Material");
  assert.ok(material, "kategori belanja Material tersedia");
  const vendor = await json("/api/vendors", {
    method: "POST",
    body: JSON.stringify({
      name: "PT Vendor Simulasi",
      vendorType: "Jasa",
      category: "Teknisi Jaringan",
      contact: "081200009999",
      email: "vendor-simulasi@contoh.test",
      rate: 0,
      status: "Aktif",
    }),
  }, 201);
  bersama = { bankId: bank.id, kategoriId: material.id, vendorId: vendor.id };
}

function daftarkanPutaran(mode) {
  const K = putaran[mode];
  const A = K.A;
  const label = (teks) => `[pajak ${mode.toUpperCase()}] ${teks}`;

  // ── 1. Calon klien → proyek ───────────────────────────────────────────────
  test(label("1. calon klien berjalan New→Contacted→Qualified→Proposal lalu menjadi proyek"), async () => {
    await siapkanBersama();
    await masuk(ADMIN);
    const prospek = await json("/api/cms/prospects", {
      method: "POST",
      body: JSON.stringify({
        fullName: `Kontak Simulasi ${mode}`,
        email: `klien-${mode}@contoh.test`,
        companyName: `PT Klien Simulasi ${mode.toUpperCase()}`,
        location: "Denpasar",
        source: "referensi mitra",
      }),
    }, 201);
    for (const status of ["Contacted", "Qualified", "Proposal"]) {
      const hasil = await json(`/api/cms/prospects/${prospek.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      assert.equal(hasil.status, status);
    }
    // Lompatan mundur dua langkah tidak boleh: Proposal → New.
    const mundur = await galat(`/api/cms/prospects/${prospek.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "New" }),
    });
    assert.equal(mundur.status, 409, "transisi Proposal→New ditolak");
    assert.equal(mundur.code, "INVALID_PROSPECT_TRANSITION");

    const konversi = await json(`/api/cms/prospects/${prospek.id}/convert`, {
      method: "POST",
      body: JSON.stringify({ status: "Aktif" }),
    }, 201);
    assert.match(konversi.project.code, /^PN-\d{4}-\d{3}$/);
    assert.equal(konversi.project.client, `PT Klien Simulasi ${mode.toUpperCase()}`);
    assert.equal(konversi.project.clientEmail, `klien-${mode}@contoh.test`);
    assert.equal(konversi.project.clientContactName, `Kontak Simulasi ${mode}`);
    assert.equal(konversi.project.location, "Denpasar");
    assert.equal(konversi.prospect.status, "Won");
    assert.equal(konversi.prospect.projectId, konversi.project.id);

    const lagi = await galat(`/api/cms/prospects/${prospek.id}/convert`, { method: "POST", body: "{}" });
    assert.equal(lagi.status, 409, "konversi kedua ditolak");
    assert.equal(lagi.code, "PROSPECT_ALREADY_CONVERTED");
    assert.equal(lagi.details?.projectCode, konversi.project.code);

    K.prospekId = prospek.id;
    K.projectId = konversi.project.id;
  });

  // ── 2. BoQ ────────────────────────────────────────────────────────────────
  test(label("2. BoQ tiga kategori, nilai proyek mengikuti subtotal"), async () => {
    await masuk(ADMIN);
    const items = [
      ["Perangkat", "Access point & switch", 20_000_000],
      ["Material", "Kabel & konektor", 5_000_000],
      ["Jasa", "Instalasi & konfigurasi", 10_000_000],
    ];
    K.boq = {};
    for (const [category, description, sellingPrice] of items) {
      const item = await json(`/api/boq/items?projectId=${K.projectId}`, {
        method: "POST",
        body: JSON.stringify({
          category, description, quantity: 1, unit: "paket",
          costPrice: sellingPrice / 2, sellingPrice,
        }),
      }, 201);
      K.boq[category] = item.id;
    }
    const boq = await json(`/api/boq?projectId=${K.projectId}`);
    assert.equal(boq.totals.selling, SUBTOTAL);
    const proyek = await json(`/api/projects/${K.projectId}`);
    assert.equal(proyek.value, SUBTOTAL, "nilai proyek = subtotal BoQ sebelum ada kontrak");
  });

  // ── 3. Quotation ──────────────────────────────────────────────────────────
  test(label("3. quotation: diskon, pajak sesuai saklar, kirim, terima — angkanya konsisten"), async () => {
    await masuk(ADMIN);
    await json(`/api/quotations?projectId=${K.projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ discountEnabled: true, discountType: "Nominal", discountValue: DISKON }),
    });
    let q = await json(`/api/quotations?projectId=${K.projectId}`);
    if (K.pajak) {
      // Tanpa aturan, quotation bertax tidak boleh dikirim.
      await json(`/api/quotations/${q.id}/tax-mode`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
      const tanpaAturan = await galat(`/api/quotations?projectId=${K.projectId}`, {
        method: "PATCH", body: JSON.stringify({ status: "Sent" }),
      });
      assert.equal(tanpaAturan.code, "TAX_RULE_REQUIRED");
      await json(`/api/quotations/${q.id}/taxes`, {
        method: "PUT",
        body: JSON.stringify({ ruleIds: [bersama.ppnId, bersama.pphKlienId] }),
      });
      q = await json(`/api/quotations?projectId=${K.projectId}`);
    }
    assert.equal(q.total, SUBTOTAL);
    assert.equal(q.discountAmount, DISKON);
    assert.equal(q.taxableBase, BASE);
    assert.equal(q.taxAdditions, A.ppn, "PPN ikut saklar");
    assert.equal(q.taxWithholdings, A.pphKlien, "PPh klien ikut saklar");
    assert.equal(q.grandTotal, A.grandTotal);
    assert.equal(q.netCashDue, A.grandTotal - A.pphKlien);

    await json(`/api/quotations?projectId=${K.projectId}`, { method: "PATCH", body: JSON.stringify({ status: "Sent" }) });
    q = await json(`/api/quotations?projectId=${K.projectId}`);
    assert.equal(q.status, "Sent");
    await json(`/api/quotations/${q.id}/accept`, {
      method: "POST",
      body: JSON.stringify({ acceptedAt: "2026-07-01", attachment: lampiran("persetujuan") }),
    });
    q = await json(`/api/quotations?projectId=${K.projectId}`);
    assert.equal(q.status, "Accepted");
    K.quotationId = q.id;

    const proyek = await json(`/api/projects/${K.projectId}`);
    assert.equal(proyek.value, A.grandTotal, "nilai proyek = grand total kontrak");
    const terkunci = await galat(`/api/boq/items?projectId=${K.projectId}`, {
      method: "POST",
      body: JSON.stringify({ category: "Jasa", description: "Tambahan", quantity: 1, unit: "paket", costPrice: 1, sellingPrice: 2 }),
    });
    assert.equal(terkunci.code, "ACCEPTED_SCOPE_LOCKED");
  });

  // ── 4. Invoice ────────────────────────────────────────────────────────────
  test(label("4. invoice 30% + 70% menjumlah persis ke grand total"), async () => {
    await masuk(ADMIN);
    const buat = (type, bps, issueDate, dueDate) => json("/api/invoices", {
      method: "POST",
      body: JSON.stringify({ projectId: K.projectId, quotationId: K.quotationId, type, issueDate, dueDate, calculationMode: "Percent", installmentBps: bps }),
    }, 201);
    const inv1 = await buat("DP 30%", 3_000, TGL.invoice1Terbit, TGL.invoice1Tempo);
    const inv2 = await buat("Pelunasan 70%", 7_000, TGL.invoice2Terbit, TGL.invoice2Tempo);
    assert.equal(inv1.amount, A.invoice1);
    assert.equal(inv2.amount, A.invoice2);
    assert.equal(inv1.amount + inv2.amount, A.grandTotal, "dua termin menjumlah persis ke grand total");
    assert.equal((inv1.taxAdditions ?? 0) + (inv2.taxAdditions ?? 0), A.ppn, "PPN terbagi persis");
    assert.equal(inv1.taxWithholdings ?? 0, A.potong1);
    const lebih = await galat("/api/invoices", {
      method: "POST",
      body: JSON.stringify({ projectId: K.projectId, quotationId: K.quotationId, type: "Lebih", issueDate: TGL.invoice2Terbit, dueDate: TGL.invoice2Tempo, calculationMode: "Percent", installmentBps: 100 }),
    });
    assert.equal(lebih.code, "INVOICE_PERCENT_EXCEEDED");
    K.invoice1 = inv1.id;
    K.invoice2 = inv2.id;
  });

  // ── 5. Pembayaran klien ───────────────────────────────────────────────────
  test(label("5. pembayaran klien menulis kas sebesar yang benar-benar diterima"), async () => {
    await masuk(ADMIN);
    const terlalu = await galat(`/api/invoices/${K.invoice1}/payments`, {
      method: "POST",
      body: JSON.stringify({
        grossAmount: A.invoice1 + 1, cashAmount: A.invoice1 + 1, withholdingAmount: 0,
        paidDate: TGL.bayarKlien, paymentReference: "SIM-OVER", paymentMethod: "Transfer Bank",
        bankAccountId: bersama.bankId, attachment: lampiran("bukti"),
      }),
    });
    assert.equal(terlalu.code, "OVERPAYMENT");
    if (K.pajak) {
      const potonganLebih = await galat(`/api/invoices/${K.invoice1}/payments`, {
        method: "POST",
        body: JSON.stringify({
          grossAmount: A.invoice1, cashAmount: A.invoice1 - A.potong1 - 1, withholdingAmount: A.potong1 + 1,
          paidDate: TGL.bayarKlien, paymentReference: "SIM-WH", paymentMethod: "Transfer Bank",
          bankAccountId: bersama.bankId, attachment: lampiran("bukti"),
        }),
      });
      assert.equal(potonganLebih.code, "WITHHOLDING_EXCEEDED");
    }
    const bayar = await json(`/api/invoices/${K.invoice1}/payments`, {
      method: "POST",
      body: JSON.stringify({
        grossAmount: A.invoice1, cashAmount: A.kasKlien1, withholdingAmount: A.potong1,
        paidDate: TGL.bayarKlien, paymentReference: `SIM-INV-${mode}`, paymentMethod: "Transfer Bank",
        bankAccountId: bersama.bankId, attachment: lampiran("bukti"),
      }),
    }, 201);
    assert.equal(bayar.status, "Lunas");
    let ringkas = await json(`/api/finance/summary?projectId=${K.projectId}`);
    assert.equal(ringkas.income, A.kasKlien1, "kas masuk = cash, bukan gross");
    if (K.pajak) {
      const obligasi = (await json("/api/tax/obligations")).filter((o) => o.projectId === K.projectId);
      const piutangPph = obligasi.filter((o) => o.direction === "Receivable");
      assert.equal(
        piutangPph.reduce((s, o) => s + o.amount, 0),
        A.potong1,
        "piutang PPh klien lahir sebesar yang benar-benar dipotong klien",
      );
    }
    // Pelunasan klien juga masuk sebelum laba dibagi — PPN invoice 2 sudah
    // terutang sejak terbit, jadi tanpa kasnya laba aman akan negatif.
    const lunas = await json(`/api/invoices/${K.invoice2}/payments`, {
      method: "POST",
      body: JSON.stringify({
        grossAmount: A.invoice2, cashAmount: A.kasKlien2, withholdingAmount: A.potong2,
        paidDate: TGL.bayarKlien, paymentReference: `SIM-INV2-${mode}`, paymentMethod: "Transfer Bank",
        bankAccountId: bersama.bankId, attachment: lampiran("bukti"),
      }),
    }, 201);
    assert.equal(lunas.status, "Lunas");
    ringkas = await json(`/api/finance/summary?projectId=${K.projectId}`);
    assert.equal(ringkas.income, A.kasKlien, "kas masuk total = grand total − potongan klien");
  });

  // ── 6. Vendor: SPK ────────────────────────────────────────────────────────
  test(label("6. SPK vendor: pisah tugas, pajak vendor, bukti per termin, kas per pembayaran"), async () => {
    await masuk(ADMIN);
    const spk = await json("/api/procurement-orders", {
      method: "POST",
      body: JSON.stringify({
        documentType: "SPK", vendorId: bersama.vendorId, projectId: K.projectId, quotationId: K.quotationId,
        items: [{ boqItemId: K.boq.Jasa, quantity: 1, agreedUnitCost: VENDOR_KONTRAK }],
        terms: [
          { label: "DP 30%", type: "DP", percentage: 30 },
          { label: "Pelunasan 70%", type: "Final", percentage: 70 },
        ],
      }),
    }, 201);
    assert.equal(spk.cost, VENDOR_KONTRAK);
    if (K.pajak) {
      await json(`/api/procurement-orders/${spk.id}/taxes`, {
        method: "PUT",
        body: JSON.stringify({ ruleIds: [bersama.ppnVendorId, bersama.pph23Id] }),
      });
    }
    await json(`/api/procurement-orders/${spk.id}/submit`, { method: "POST" });
    // Finance yang tidak menulis dokumen boleh menyetujui; Admin pembuat perlu alasan.
    const tanpaAlasan = await galat(`/api/procurement-orders/${spk.id}/approve`, { method: "POST", body: "{}" });
    assert.equal(tanpaAlasan.status, 422, "Admin menyetujui pengajuannya sendiri wajib beralasan");
    await masuk(FINANCE);
    const disetujui = await json(`/api/procurement-orders/${spk.id}/approve`, { method: "POST", body: "{}" });
    assert.equal(disetujui.approvalStatus, "Approved");
    assert.equal(disetujui.grossTotal, A.vendorGross, "kontrak vendor gross ikut saklar pajak");
    assert.equal(disetujui.taxWithholdings, A.vendorPph);
    const termDp = disetujui.terms.find((t) => t.type === "DP");
    const termFinal = disetujui.terms.find((t) => t.type === "Final");
    assert.equal(termDp.plannedAmount, A.dpPlanned);
    assert.equal(termFinal.plannedAmount, A.finalPlanned);
    if (K.pajak) {
      const obligasiVendor = (await json("/api/tax/obligations")).filter((o) => o.projectId === K.projectId && o.direction === "Payable");
      assert.equal(
        obligasiVendor.filter((o) => o.amount === A.vendorPph).length,
        0,
        "kewajiban PPh vendor BELUM lahir saat disetujui — lahir saat dipotong",
      );
    }
    await masuk(ADMIN);
    await json(`/api/procurement-orders/${spk.id}/send`, { method: "POST" });

    const bayar = (termId, gross, potong, tanggal, ref, expected = 201) => json(`/api/procurement-orders/${spk.id}/payments`, {
      method: "POST",
      body: JSON.stringify({
        termId, grossAmount: gross, cashAmount: gross - potong, withholdingAmount: potong,
        paidDate: tanggal, vendorInvoiceNumber: `TAG-${ref}`, paymentReference: ref,
        paymentMethod: "Transfer Bank", bankAccountId: bersama.bankId, attachment: lampiran("bukti"),
      }),
    }, expected);

    // Tanpa termin ditolak rapi.
    const tanpaTermin = await galat(`/api/procurement-orders/${spk.id}/payments`, {
      method: "POST",
      body: JSON.stringify({
        grossAmount: A.dpGross, cashAmount: A.dpCash, withholdingAmount: A.dpPotong,
        paidDate: TGL.bayarDpVendor, vendorInvoiceNumber: "TAG-X", paymentReference: "SIM-X",
        paymentMethod: "Transfer Bank", bankAccountId: bersama.bankId, attachment: lampiran("bukti"),
      }),
    });
    assert.equal(tanpaTermin.code, "TERM_REQUIRED");

    const dp = await bayar(termDp.id, A.dpGross, A.dpPotong, TGL.bayarDpVendor, `SIM-DP-${mode}`);
    assert.equal(dp.paidGross, A.dpGross);
    assert.equal(dp.terms.find((t) => t.id === termDp.id).status, "Paid", "DP penuh = Paid, dihitung gross");
    assert.equal(dp.terms.find((t) => t.id === termFinal.id).status, "Pending");

    // Pelunasan SEBELUM verifikasi ditolak — bukti per termin, bukan agregat.
    const belumBukti = await galat(`/api/procurement-orders/${spk.id}/payments`, {
      method: "POST",
      body: JSON.stringify({
        termId: termFinal.id, grossAmount: A.finalGross, cashAmount: A.finalCash, withholdingAmount: A.finalPotong,
        paidDate: TGL.bayarFinalVendor, vendorInvoiceNumber: "TAG-F", paymentReference: "SIM-F",
        paymentMethod: "Transfer Bank", bankAccountId: bersama.bankId, attachment: lampiran("bukti"),
      }),
    });
    assert.equal(belumBukti.status, 409);
    assert.match(belumBukti.code, /PAYMENT_NOT_EARNED/);

    await json(`/api/procurement-orders/${spk.id}/verifications`, {
      method: "POST",
      body: JSON.stringify({ termId: termFinal.id, verifiedAmount: A.finalPlanned, progressPercentage: 100 }),
    }, 201);
    // Sebagian dari gross final → Partial, bukan Paid.
    const bayar1 = await bayar(termFinal.id, A.final1Gross, A.final1Potong, TGL.bayarFinalVendor, `SIM-F1-${mode}`);
    assert.equal(bayar1.terms.find((t) => t.id === termFinal.id).status, "Partial");
    const bayar2 = await bayar(termFinal.id, A.final2Gross, A.final2Potong, TGL.bayarFinalVendor, `SIM-F2-${mode}`);
    assert.equal(bayar2.terms.find((t) => t.id === termFinal.id).status, "Paid");
    assert.equal(bayar2.paidGross, A.vendorGross);
    assert.equal(bayar2.paymentStatus, "Lunas");
    assert.equal(bayar2.withheldTax, A.vendorPph);

    const selesai = await json(`/api/procurement-orders/${spk.id}/complete`, { method: "POST" });
    assert.equal(selesai.workflowStatus, "Selesai");

    const ringkas = await json(`/api/finance/summary?projectId=${K.projectId}`);
    assert.equal(ringkas.expense, A.dpCash + A.finalCash, "kas vendor = Σ cash, bukan gross");
    if (K.pajak) {
      const obligasiVendor = (await json("/api/tax/obligations")).filter((o) => o.projectId === K.projectId && o.direction === "Payable" && o.amount === A.vendorPph);
      assert.equal(obligasiVendor.length, 1, "kewajiban PPh vendor = Σ yang dipotong");
    }
    K.spkId = spk.id;
    K.termDpId = termDp.id;
    K.pembayaranDpId = dp.payments.find((p) => p.paymentReference === `SIM-DP-${mode}`)?.id ?? dp.payments[0]?.id;
    assert.ok(K.pembayaranDpId, "id pembayaran DP terbaca");
  });

  // ── 7. Belanja proyek ─────────────────────────────────────────────────────
  test(label("7. belanja talangan pegawai: disetujui Finance, reimburse menulis kas"), async () => {
    await masuk(ADMIN);
    const belanja = await json("/api/project-expenses", {
      method: "POST",
      body: JSON.stringify({
        projectId: K.projectId, purchaseDate: TGL.belanja, merchant: "Toko Simulasi",
        categoryId: bersama.kategoriId, totalAmount: BELANJA, fundingSource: "EmployeePaid",
        notes: "Talangan konektor.", itemDetails: [],
      }),
    }, 201);
    const form = new FormData();
    form.set("file", new File([notaPdf()],"nota.pdf", { type: "application/pdf" }));
    await json(`/api/project-expenses/${belanja.id}/attachments`, { method: "POST", body: form }, 201);
    await json(`/api/project-expenses/${belanja.id}/submit`, { method: "POST", body: JSON.stringify({ duplicateAcknowledged: false }) });
    await masuk(FINANCE);
    const disetujui = await json(`/api/project-expenses/${belanja.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ settlementDate: TGL.belanja, duplicateAcknowledged: false, paymentReference: "" }),
    });
    assert.equal(disetujui.settlementStatus, "AwaitingReimbursement");
    const dibayar = await json(`/api/project-expenses/${belanja.id}/reimburse`, {
      method: "POST",
      body: JSON.stringify({ amount: BELANJA, settlementDate: TGL.reimburse, bankAccountId: bersama.bankId, paymentReference: `SIM-REIMB-${mode}` }),
    });
    assert.equal(dibayar.settlementStatus, "Reimbursed");
    await masuk(ADMIN);
    const ringkas = await json(`/api/finance/summary?projectId=${K.projectId}`);
    assert.equal(ringkas.expense, A.dpCash + A.finalCash + BELANJA);
    K.belanjaId = belanja.id;
  });

  // ── 8. Validasi + BAST ────────────────────────────────────────────────────
  test(label("8. validasi perangkat lalu BAST final menutup proyek"), async () => {
    await masuk(ADMIN);
    const validasi = await json(`/api/validations?projectId=${K.projectId}`, { method: "POST" }, 201);
    assert.equal(validasi.totalCount, 2, "hanya Perangkat & Material yang divalidasi");
    await json(`/api/validations/${validasi.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Completed", notes: "Lulus uji.", items: validasi.items.map((item) => ({ ...item, checked: true })) }),
    });
    await json("/api/bast/settings/seal", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, signerName: "Direktur", signerRole: "Direktur", sealMimeType: "image/png", sealContentBase64: PNG_1X1 }),
    });
    const ttd = `data:image/png;base64,${PNG_1X1}`;
    const bast = await json("/api/bast", {
      method: "POST",
      body: JSON.stringify({
        projectId: K.projectId, completionDate: TGL.bast, notes: "Serah terima simulasi.",
        installedItems: [{ name: "Access Point", quantity: "1 unit", status: "Terpasang" }],
        clientName: "Klien", clientRole: "Manager", engineerName: "Engineer", engineerRole: "Project Manager",
        status: "Draft", clientSignature: ttd, engineerSignature: ttd,
      }),
    }, 201);
    const final = await json(`/api/bast/${bast.id}/finalize`, { method: "POST" });
    assert.equal(final.status, "Final");
    assert.ok(final.finalizedAt, "status Final ⇔ finalized_at terisi");
    const proyek = await json(`/api/projects/${K.projectId}`);
    assert.equal(proyek.status, "Selesai", "semua paket berkontrak sudah BAST → Selesai");
    K.bastId = bast.id;
  });

  // ── 9. Mutasi bank ────────────────────────────────────────────────────────
  test(label("9. impor mutasi: yang cocok ter-Match, yang asing tidak dihitung kas"), async () => {
    await masuk(ADMIN);
    const tgl = (iso) => iso.split("-").reverse().join("/");
    let saldo = 50_000_000;
    const baris = [];
    const tambah = (iso, ket, jumlah, arah, ref) => {
      saldo += arah === "CR" ? jumlah : -jumlah;
      baris.push(`${tgl(iso)},${ket},${jumlah} ${arah},${saldo},${ref}`);
    };
    tambah(TGL.bayarKlien, `TRANSFER MASUK KLIEN ${mode}`, A.kasKlien1, "CR", `SIM-INV-${mode}`);
    tambah(TGL.bayarFinalVendor, `TRANSFER VENDOR F1 ${mode}`, A.final1Cash, "DB", `SIM-F1-${mode}`);
    tambah(TGL.reimburse, `REIMBURSE ${mode}`, BELANJA, "DB", `SIM-REIMB-${mode}`);
    tambah(TGL.reimburse, `BIAYA ADMIN ${mode}`, 6_500, "DB", `ADM-${mode}`);
    const csv = ["MUTASI REKENING BCA", "Nomor Rekening,1234567890", "Tanggal,Keterangan,Mutasi,Saldo,Referensi", ...baris].join("\r\n");
    const form = new FormData();
    form.set("file", new File([csv], `mutasi-${mode}.csv`, { type: "text/csv" }));
    form.set("statementMonth", BULAN);
    const impor = await json(`/api/bank-accounts/${bersama.bankId}/import`, { method: "POST", body: form }, 201);
    assert.equal(impor.importedCount, 4);
    assert.equal(impor.matchedCount, 3, "tiga mutasi cocok otomatis dengan pembayaran");
    const sebelum = await json(`/api/finance/summary?projectId=${K.projectId}`);
    const semua = await json("/api/finance/summary");
    assert.equal(semua.unreconciled.entries >= 1, true, "biaya admin yang asing tercatat tapi tidak dihitung kas");
    assert.equal(sebelum.income, A.kasKlien, "mutasi yang tidak cocok tidak menambah kas proyek");
    K.kasProyek = { income: sebelum.income, expense: sebelum.expense };
  });

  // ── 10. Bagi laba ─────────────────────────────────────────────────────────
  test(label("10. bagi laba: laba aman dihitung dari kas, total alokasi dibatasi"), async () => {
    await masuk(ADMIN);
    const ringkas = await json(`/api/profit-shares?projectId=${K.projectId}`);
    const income = A.kasKlien;
    const expense = A.dpCash + A.finalCash + BELANJA;
    assert.equal(ringkas.netProfit, income - expense + (ringkas.recoverableTax ?? 0));
    assert.equal(ringkas.outstandingVendorCommitment, 0, "vendor lunas");
    assert.equal(ringkas.outstandingReimbursement, 0, "talangan sudah diganti");
    if (K.pajak) {
      // PPN kedua invoice (utang sejak terbit) + PPh vendor sebesar yang
      // benar-benar dipotong — bukan snapshot penuh.
      assert.equal(ringkas.outstandingTaxPayable, A.ppn + A.vendorPph, "utang pajak = PPN invoice + PPh vendor yang dipotong");
    } else {
      assert.equal(ringkas.outstandingTaxPayable ?? 0, 0);
    }
    const aman = ringkas.distributableProfit;
    assert.ok(aman > 0, `laba aman positif (${aman})`);

    const a = await json("/api/profit-shares", {
      method: "POST",
      body: JSON.stringify({ projectId: K.projectId, recipientName: "Mitra A", percentage: 50, notes: "Simulasi A" }),
    }, 201);
    const aSetuju = await json(`/api/profit-shares/${a.id}/approve`, { method: "POST" });
    assert.equal(aSetuju.amount, Math.floor((aman * 5_000) / 10_000));

    // Laba turun setelah alokasi A dikunci: belanja perusahaan sebesar 80% laba.
    const potongan = Math.floor(aman * 0.8);
    const belanja = await json("/api/project-expenses", {
      method: "POST",
      body: JSON.stringify({
        projectId: K.projectId, purchaseDate: TGL.bagiLaba, merchant: "Sewa alat",
        categoryId: bersama.kategoriId, totalAmount: potongan, fundingSource: "CompanyAccount",
        paymentMethod: "Transfer Bank", bankAccountId: bersama.bankId, notes: "Biaya tak terduga.", itemDetails: [],
      }),
    }, 201);
    const form = new FormData();
    form.set("file", new File([notaPdf()],"nota-sewa.pdf", { type: "application/pdf" }));
    await json(`/api/project-expenses/${belanja.id}/attachments`, { method: "POST", body: form }, 201);
    await json(`/api/project-expenses/${belanja.id}/submit`, { method: "POST", body: JSON.stringify({ duplicateAcknowledged: false }) });
    await masuk(FINANCE);
    await json(`/api/project-expenses/${belanja.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ settlementDate: TGL.bagiLaba, duplicateAcknowledged: false, paymentReference: `SIM-SEWA-${mode}` }),
    });
    await masuk(ADMIN);
    const sesudah = await json(`/api/profit-shares?projectId=${K.projectId}`);
    assert.ok(sesudah.distributableProfit < aSetuju.amount, "laba aman kini di bawah yang sudah dikunci untuk A");

    const b = await json("/api/profit-shares", {
      method: "POST",
      body: JSON.stringify({ projectId: K.projectId, recipientName: "Mitra B", percentage: 40, notes: "Simulasi B" }),
    }, 201);
    const bDitolak = await galat(`/api/profit-shares/${b.id}/approve`, { method: "POST" });
    assert.equal(bDitolak.status, 409, "alokasi B ditolak: yang sudah dikunci + B melampaui laba aman");
    assert.equal(bDitolak.code, "NO_DISTRIBUTABLE_PROFIT");

    const dibayar = await json(`/api/profit-shares/${a.id}/pay`, { method: "POST", body: JSON.stringify({ paidDate: TGL.bagiLaba }) });
    assert.equal(dibayar.status, "Paid");
    const akhir = await json(`/api/profit-shares?projectId=${K.projectId}`);
    assert.equal(akhir.lockedAmount, aSetuju.amount, "lockedAmount = yang benar-benar dikunci");
    K.labaA = aSetuju.amount;
  });

  // ── 11. Pajak ─────────────────────────────────────────────────────────────
  test(label("11. kewajiban pajak: PPN disetor, PPh mengikuti potongan, pelaporan maju"), async () => {
    await masuk(ADMIN);
    const obligasi = (await json("/api/tax/obligations")).filter((o) => o.projectId === K.projectId);
    if (!K.pajak) {
      assert.equal(obligasi.length, 0, "tanpa pajak tidak ada kewajiban");
      return;
    }
    const ppnInvoice1 = obligasi.find((o) => o.direction === "Payable" && o.amount === Math.round((A.ppn * 3_000) / 10_000));
    assert.ok(ppnInvoice1, "PPN invoice 1 tercatat sebagai kewajiban");
    const lebih = await galat("/api/tax/settlements", {
      method: "POST",
      body: JSON.stringify({ obligationId: ppnInvoice1.id, amount: ppnInvoice1.amount + 1, settlementDate: TGL.setorPajak, paymentReference: "SIM-PJK-X", paymentMethod: "Transfer Bank", bankAccountId: bersama.bankId, attachment: lampiran("pajak") }),
    });
    assert.equal(lebih.code, "OVER_SETTLEMENT");
    const kasSebelum = (await json(`/api/finance/summary?projectId=${K.projectId}`)).expense;
    await json("/api/tax/settlements", {
      method: "POST",
      body: JSON.stringify({ obligationId: ppnInvoice1.id, amount: ppnInvoice1.amount, settlementDate: TGL.setorPajak, paymentReference: `SIM-PJK-${mode}`, paymentMethod: "Transfer Bank", bankAccountId: bersama.bankId, attachment: lampiran("pajak") }),
    }, 201);
    const sesudah = (await json("/api/tax/obligations")).find((o) => o.id === ppnInvoice1.id);
    assert.equal(sesudah.status, "Settled");
    const laporanButuhRef = await galat(`/api/tax/obligations/${ppnInvoice1.id}/reporting`, {
      method: "PATCH", body: JSON.stringify({ reportingStatus: "Reported" }),
    });
    assert.equal(laporanButuhRef.status, 422, "Reported butuh nomor bukti lapor");
    const kasSesudah = (await json(`/api/finance/summary?projectId=${K.projectId}`)).expense;
    assert.equal(kasSesudah - kasSebelum, ppnInvoice1.amount, "setoran pajak menjadi kas keluar sebesar setorannya");
  });

  // ── 12. Void & reversal ───────────────────────────────────────────────────
  test(label("12. void pembayaran vendor: reversal bertanggal asal, termin & kewajiban mundur"), async () => {
    await masuk(ADMIN);
    const juliSebelum = await json(`/api/finance/summary?projectId=${K.projectId}&from=${BULAN}-01&to=${BULAN}-31`);
    const dibatalkan = await json(`/api/procurement-orders/${K.spkId}/payments/${K.pembayaranDpId}/void`, {
      method: "POST", body: JSON.stringify({ reason: "Salah input simulasi." }),
    });
    assert.equal(dibatalkan.terms.find((t) => t.id === K.termDpId).status, "Pending", "termin DP kembali Pending");
    const juliSesudah = await json(`/api/finance/summary?projectId=${K.projectId}&from=${BULAN}-01&to=${BULAN}-31`);
    assert.equal(
      juliSesudah.expense,
      juliSebelum.expense - A.dpCash,
      "reversal bertanggal asal: kas keluar Juli turun sebesar DP yang dibatalkan",
    );
    if (K.pajak) {
      const obligasiVendor = (await json("/api/tax/obligations")).filter((o) => o.projectId === K.projectId && o.direction === "Payable" && o.documentType !== "Invoice");
      const totalPph = obligasiVendor.reduce((s, o) => s + o.amount, 0);
      assert.equal(totalPph, A.vendorPph - A.dpPotong, "kewajiban PPh turun sebesar potongan DP yang dibatalkan");
    }
  });
}

// ── Putaran 1: pajak OFF ──────────────────────────────────────────────────────
daftarkanPutaran("off");

// ── Saklar dinyalakan ────────────────────────────────────────────────────────
test("saklar pajak dinyalakan: aturan disiapkan, dokumen putaran OFF tidak berubah", async () => {
  await masuk(ADMIN);
  await json("/api/tax/settings", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  const rules = await json("/api/tax/rules");
  const ppn = rules.find((r) => r.code === "PPN");
  const pph23 = rules.find((r) => r.code === "PPH23");
  assert.ok(ppn && pph23, "preset PPN dan PPH23 ada");
  await json(`/api/tax/rules/${ppn.id}`, { method: "PATCH", body: JSON.stringify({ rateBps: PPN_BPS, status: "Active" }) });
  await json(`/api/tax/rules/${pph23.id}`, { method: "PATCH", body: JSON.stringify({ rateBps: PPH_BPS, status: "Active" }) });
  const ppnVendor = await json("/api/tax/rules", {
    method: "POST",
    body: JSON.stringify({ code: "PPN-MASUKAN", name: "PPN Masukan", nameEn: "Input VAT", scope: "Vendor", effect: "Add", rateBps: PPN_BPS, accountingTreatment: "Recoverable", status: "Active" }),
  }, 201);
  const pphKlien = await json("/api/tax/rules", {
    method: "POST",
    body: JSON.stringify({ code: "PPH23-KLIEN", name: "PPh 23 dipotong klien", nameEn: "Client-withheld Art. 23", scope: "Client", effect: "Withhold", rateBps: PPH_BPS, accountingTreatment: "Receivable", status: "Active" }),
  }, 201);
  bersama.ppnId = ppn.id;
  bersama.pph23Id = pph23.id;
  bersama.ppnVendorId = ppnVendor.id;
  bersama.pphKlienId = pphKlien.id;
  // Withhold yang dibukukan sebagai Expense tidak masuk akal: uang potongannya
  // tidak pernah menjadi kewajiban siapa pun.
  const salah = await galat("/api/tax/rules", {
    method: "POST",
    body: JSON.stringify({ code: "SALAH", name: "Potongan biaya", nameEn: "Expense withhold", scope: "Vendor", effect: "Withhold", rateBps: 100, accountingTreatment: "Expense", status: "Active" }),
  });
  assert.equal(salah.status, 422);
  assert.equal(salah.code, "TAX_RULE_TREATMENT_INVALID");

  // Dokumen putaran OFF tetap apa adanya.
  const qOff = await json(`/api/quotations?projectId=${putaran.off.projectId}`);
  assert.equal(qOff.grandTotal, putaran.off.A.grandTotal, "quotation lama tidak ikut terkena pajak");
  assert.equal(qOff.taxAdditions, 0);
});

// ── Putaran 2: pajak ON ───────────────────────────────────────────────────────
daftarkanPutaran("on");
