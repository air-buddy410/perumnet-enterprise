import "server-only";

import { randomUUID } from "node:crypto";
import { canAccess, type AccessLevel } from "@/shared/access";
import {
  assertMagicBytes,
  inlineDisposition,
  prepareUploadedAttachment,
  type PreparedAttachment,
} from "../attachments";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import { getDatabase, type DatabaseClient } from "../db/client";
import { KNOWN_LEDGER_SOURCES, ledgerSourcesOf } from "../finance-evidence";
import { asNumber } from "../format";
import { deleteStoredFile, readStoredFile, storeUploadedFile } from "../storage";
import {
  EVIDENCE_ATTACHMENT_LIMIT,
  EVIDENCE_ATTACHMENT_MAX_COUNT,
  financeEvidenceDirections,
  financeEvidenceKinds,
  financeEvidenceModule,
  isFinanceEvidenceKind,
  legacyProofKinds,
  type FinanceEvidenceKind,
} from "../../shared/finance-evidence";
import { ApiError, created, noContent, ok } from "./errors";

/**
 * Arsip bukti keuangan — satu tempat untuk "uang ini bergerak kapan, berapa,
 * ke siapa, dan mana buktinya?"
 *
 * Tulang punggungnya BUKU KAS: satu baris arsip per baris `transactions`,
 * termasuk reversal (supaya total arsip selalu cocok dengan total buku kas),
 * ditambah dua jenis bukti kontrak yang tidak menggerakkan uang tetapi
 * diperiksa Finance: tanda terima quotation dan BAST final.
 *
 * Sampai 22 Agustus 2026, tujuh jenis bukti yang diunggah orang — bukti
 * transfer invoice, bukti bayar vendor, bukti setor pajak, tanda terima
 * quotation — tidak punya SATU PUN rute baca. Diunggah, disimpan, lalu hanya
 * namanya yang pernah ditampilkan. Rute `/file` di bawah adalah yang pertama.
 *
 * Izin mengikuti modul jenisnya (shared/finance-evidence.ts), sama dengan izin
 * untuk MEMBUAT catatannya. Di atas itu, gerbang generik resource `finance`
 * sudah berlaku dari dispatchApi: view untuk membaca, manage untuk menulis.
 * Konsekuensinya PM/Engineer tidak bisa melampirkan bukti — disengaja, dan
 * ditulis di papan tugas Luna.
 */

type EvidenceRow = Record<string, unknown>;

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MIN = 10;
const PAGE_SIZE_MAX = 100;

// ── Cakupan & izin ───────────────────────────────────────────────────────

function hasGlobalProjectScope(user: AuthUser) {
  return user.role === "Admin" || user.role === "Finance";
}

function projectScopeCondition(user: AuthUser, projectAlias = "p") {
  if (hasGlobalProjectScope(user)) return { sql: "", args: [] as unknown[] };
  return {
    sql: `EXISTS (
      SELECT 1 FROM project_members access_pm
      WHERE access_pm.project_id = ${projectAlias}.id
        AND access_pm.user_id = ?
    )`,
    args: [user.id] as unknown[],
  };
}

async function assertProjectAccess(client: DatabaseClient, user: AuthUser, projectId: string) {
  if (hasGlobalProjectScope(user)) {
    const project = await client.execute({
      sql: "SELECT id FROM projects WHERE id=? LIMIT 1",
      args: [projectId],
    });
    if (project.rows.length) return;
  } else {
    const project = await client.execute({
      sql: `SELECT p.id FROM projects p
        WHERE p.id=? AND EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id=p.id AND pm.user_id=?
        ) LIMIT 1`,
      args: [projectId, user.id],
    });
    if (project.rows.length) return;
  }
  // 404, bukan 403: id proyek di luar cakupan tidak boleh bisa ditebak-tebak.
  throw new ApiError(404, "NOT_FOUND", "Proyek tidak ditemukan.");
}

function assertKind(value: string): FinanceEvidenceKind {
  if (!isFinanceEvidenceKind(value)) {
    throw new ApiError(404, "UNKNOWN_EVIDENCE_KIND", "Jenis bukti tidak dikenal.", {
      kind: value,
      kinds: financeEvidenceKinds,
    });
  }
  return value;
}

function assertKindAccess(user: AuthUser, kind: FinanceEvidenceKind, level: AccessLevel) {
  if (!canAccess(user.permissions, financeEvidenceModule[kind], level === "manage" ? "manage" : "view")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      level === "manage"
        ? "Anda hanya bisa melihat bukti jenis ini, tidak mengubahnya."
        : "Peran Anda tidak memiliki akses ke bukti jenis ini.",
      { kind, module: financeEvidenceModule[kind] },
    );
  }
}

function kindsFor(user: AuthUser, level: AccessLevel) {
  return financeEvidenceKinds.filter((kind) =>
    canAccess(user.permissions, financeEvidenceModule[kind], level === "manage" ? "manage" : "view"),
  );
}

/** Baris tanpa proyek (kas perusahaan) hanya untuk yang cakupannya global. */
async function assertEvidenceProjectAccess(
  client: DatabaseClient,
  user: AuthUser,
  projectId: string | null,
) {
  if (projectId) {
    await assertProjectAccess(client, user, projectId);
    return;
  }
  if (!hasGlobalProjectScope(user)) {
    throw new ApiError(404, "NOT_FOUND", "Bukti tidak ditemukan.");
  }
}

// ── Tulang punggung: UNION ALL per jenis ─────────────────────────────────
//
// Setiap cabang memulangkan 21 kolom yang sama, dengan nama dan urutan yang
// sama persis. NULL selalu di-CAST: PostgreSQL menolak UNION yang salah satu
// cabangnya memuat NULL tanpa tipe. Cabang `invoice-payment` diletakkan
// pertama supaya literal `kind` diturunkan sebagai text.
//
// Tabel Gen B (invoice_payments, spk_payments, tax_settlements, quotations)
// menyimpan blob base64 DI DALAM barisnya. Cabang-cabang ini hanya bertanya
// `IS NOT NULL` pada kolom itu — tidak pernah memindahkan isinya.

// Kolom tiap cabang, dalam urutan ini:
//   kind, row_id, evidence_id, date, amount, direction, reversal,
//   project_id, project_code, project_name, title, counterparty, reference,
//   document_kind, document_id, document_number,
//   legacy_proof_name, legacy_proof_mime, legacy_proof, status, created_at
const NULL_TEXT = "CAST(NULL AS TEXT)";
const NULL_INT = "CAST(NULL AS INTEGER)";

interface Branch {
  sql: string;
  args: unknown[];
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(",");
}

function scoped(scope: { sql: string; args: unknown[] }, requireProject: boolean) {
  if (!scope.sql) return "";
  // Cabang dengan LEFT JOIN proyek: baris tanpa proyek tidak boleh lolos untuk
  // anggota, dan EXISTS atas p.id yang NULL memang selalu salah — tetapi
  // disebut eksplisit supaya terbaca saat review.
  return requireProject ? ` AND (p.id IS NOT NULL AND ${scope.sql})` : ` AND ${scope.sql}`;
}

function buildBranch(kind: FinanceEvidenceKind, user: AuthUser): Branch | null {
  const scope = projectScopeCondition(user, "p");
  const global = hasGlobalProjectScope(user);
  switch (kind) {
    case "invoice-payment": {
      const sources = ledgerSourcesOf(kind);
      return {
        sql: `SELECT 'invoice-payment' AS kind, t.id AS row_id, ip.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction,
          CASE WHEN t.source='Invoice Payment Reversal' THEN 1 ELSE 0 END AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, p.client AS counterparty, ip.payment_reference AS reference,
          'invoice' AS document_kind, i.id AS document_id, i.number AS document_number,
          ip.attachment_name AS legacy_proof_name, ip.attachment_mime_type AS legacy_proof_mime,
          CASE WHEN ip.attachment_content_base64 IS NOT NULL THEN 1 ELSE 0 END AS legacy_proof,
          ip.status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN invoice_payments ip ON ip.id=t.reference_id
        JOIN invoices i ON i.id=ip.invoice_id
        JOIN projects p ON p.id=i.project_id
        WHERE t.source IN (${placeholders(sources)})${scoped(scope, false)}`,
        args: [...sources, ...scope.args],
      };
    }
    case "spk-payment": {
      const sources = ledgerSourcesOf(kind);
      return {
        sql: `SELECT 'spk-payment' AS kind, t.id AS row_id, sp.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction,
          CASE WHEN t.source='Procurement Reversal' THEN 1 ELSE 0 END AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, v.name AS counterparty, sp.payment_reference AS reference,
          lower(s.document_type) AS document_kind, s.id AS document_id, s.number AS document_number,
          sp.attachment_name AS legacy_proof_name, sp.attachment_mime_type AS legacy_proof_mime,
          CASE WHEN sp.attachment_content_base64 IS NOT NULL THEN 1 ELSE 0 END AS legacy_proof,
          sp.status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN spk_payments sp ON sp.id=replace(t.reference_id, ':void', '')
        JOIN spks s ON s.id=sp.spk_id
        JOIN vendors v ON v.id=s.vendor_id
        JOIN projects p ON p.id=s.project_id
        WHERE t.source IN (${placeholders(sources)})${scoped(scope, false)}`,
        args: [...sources, ...scope.args],
      };
    }
    case "tax-settlement": {
      const sources = ledgerSourcesOf(kind);
      return {
        sql: `SELECT 'tax-settlement' AS kind, t.id AS row_id, ts.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction,
          CASE WHEN t.source='Tax Settlement Reversal' THEN 1 ELSE 0 END AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, dt.rule_name AS counterparty, ts.payment_reference AS reference,
          lower(dt.document_type) AS document_kind, dt.document_id AS document_id,
          CASE dt.document_type
            WHEN 'Invoice' THEN (SELECT number FROM invoices WHERE id=dt.document_id)
            WHEN 'Quotation' THEN (SELECT number FROM quotations WHERE id=dt.document_id)
            ELSE (SELECT number FROM spks WHERE id=dt.document_id)
          END AS document_number,
          ts.attachment_name AS legacy_proof_name, ts.attachment_mime_type AS legacy_proof_mime,
          CASE WHEN ts.attachment_content_base64 IS NOT NULL THEN 1 ELSE 0 END AS legacy_proof,
          ts.status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN tax_settlements ts ON ts.id=t.reference_id
        JOIN tax_obligations o ON o.id=ts.obligation_id
        JOIN document_taxes dt ON dt.id=o.document_tax_id
        LEFT JOIN projects p ON p.id=t.project_id
        WHERE t.source IN (${placeholders(sources)})${scoped(scope, true)}`,
        args: [...sources, ...scope.args],
      };
    }
    case "expense-settlement": {
      const sources = ledgerSourcesOf(kind);
      return {
        sql: `SELECT 'expense-settlement' AS kind, t.id AS row_id, s.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction,
          CASE WHEN t.source='Project Expense Reversal' THEN 1 ELSE 0 END AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, e.merchant AS counterparty, s.payment_reference AS reference,
          CASE WHEN s.expense_id IS NOT NULL THEN 'expense' ELSE 'advance' END AS document_kind,
          COALESCE(s.expense_id, s.advance_id) AS document_id,
          COALESCE(e.number, a.number) AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime,
          CASE WHEN EXISTS (
            SELECT 1 FROM project_expense_attachments pa WHERE pa.expense_id=s.expense_id
          ) THEN 1 ELSE 0 END AS legacy_proof,
          s.status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN project_expense_settlements s ON s.id=t.reference_id
        LEFT JOIN project_expenses e ON e.id=s.expense_id
        LEFT JOIN project_advances a ON a.id=s.advance_id
        JOIN projects p ON p.id=t.project_id
        WHERE t.source IN (${placeholders(sources)})${scoped(scope, false)}`,
        args: [...sources, ...scope.args],
      };
    }
    case "advance": {
      // Dua cabang: pencairan menunjuk uang mukanya langsung; pembatalannya
      // menunjuk baris settlement baru bertipe Reversal, jadi uang mukanya
      // dicari lewat advance_id. evidence_id keduanya = id uang muka.
      return {
        sql: `SELECT 'advance' AS kind, t.id AS row_id, a.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction, 0 AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, u.name AS counterparty, a.payment_reference AS reference,
          'advance' AS document_kind, a.id AS document_id, a.number AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime, 0 AS legacy_proof,
          a.status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN project_advances a ON a.id=t.reference_id
        LEFT JOIN users u ON u.id=a.recipient_user_id
        JOIN projects p ON p.id=a.project_id
        WHERE t.source='Project Advance'${scoped(scope, false)}
        UNION ALL
        SELECT 'advance' AS kind, t.id AS row_id, a.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction, 1 AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, u.name AS counterparty, a.payment_reference AS reference,
          'advance' AS document_kind, a.id AS document_id, a.number AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime, 0 AS legacy_proof,
          a.status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN project_expense_settlements s ON s.id=t.reference_id
        JOIN project_advances a ON a.id=s.advance_id
        LEFT JOIN users u ON u.id=a.recipient_user_id
        JOIN projects p ON p.id=a.project_id
        WHERE t.source='Project Advance Reversal'${scoped(scope, false)}`,
        args: [...scope.args, ...scope.args],
      };
    }
    case "profit-share": {
      const sources = ledgerSourcesOf(kind);
      return {
        sql: `SELECT 'profit-share' AS kind, t.id AS row_id, ps.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction,
          CASE WHEN t.source LIKE '%Reversal' THEN 1 ELSE 0 END AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, ps.recipient_name AS counterparty, ${NULL_TEXT} AS reference,
          'profit-share' AS document_kind, ps.id AS document_id, ${NULL_TEXT} AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime, 0 AS legacy_proof,
          ps.status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN project_profit_shares ps ON ps.id=replace(t.reference_id, ':void', '')
        LEFT JOIN projects p ON p.id=t.project_id
        WHERE t.source IN (${placeholders(sources)})${scoped(scope, true)}`,
        args: [...sources, ...scope.args],
      };
    }
    case "bank-line": {
      // Baris mutasi tidak pernah berproyek — hanya untuk cakupan global.
      if (!global) return null;
      return {
        sql: `SELECT 'bank-line' AS kind, t.id AS row_id, be.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction, 0 AS reversal,
          ${NULL_TEXT} AS project_id, ${NULL_TEXT} AS project_code, ${NULL_TEXT} AS project_name,
          t.description AS title,
          ba.bank_name || ' ' || COALESCE(ba.account_number_masked, '') AS counterparty,
          be.reference AS reference,
          ${NULL_TEXT} AS document_kind, ${NULL_TEXT} AS document_id, ${NULL_TEXT} AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime, 0 AS legacy_proof,
          be.reconciliation_status AS status, t.created_at AS created_at
        FROM transactions t
        JOIN bank_statement_entries be ON be.id=t.reference_id
        JOIN bank_accounts ba ON ba.id=be.bank_account_id
        WHERE t.source LIKE 'Bank:%'`,
        args: [],
      };
    }
    case "manual": {
      return {
        sql: `SELECT 'manual' AS kind, t.id AS row_id, t.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction, 0 AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, ${NULL_TEXT} AS counterparty, ${NULL_TEXT} AS reference,
          ${NULL_TEXT} AS document_kind, ${NULL_TEXT} AS document_id, ${NULL_TEXT} AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime, 0 AS legacy_proof,
          'Posted' AS status, t.created_at AS created_at
        FROM transactions t
        LEFT JOIN projects p ON p.id=t.project_id
        WHERE t.origin='manual'${scoped(scope, true)}`,
        args: [...scope.args],
      };
    }
    case "other": {
      return {
        sql: `SELECT 'other' AS kind, t.id AS row_id, t.id AS evidence_id, t.date AS date,
          t.amount AS amount, t.type AS direction, 0 AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          t.description AS title, ${NULL_TEXT} AS counterparty, t.reference_id AS reference,
          ${NULL_TEXT} AS document_kind, ${NULL_TEXT} AS document_id, ${NULL_TEXT} AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime, 0 AS legacy_proof,
          'Posted' AS status, t.created_at AS created_at
        FROM transactions t
        LEFT JOIN projects p ON p.id=t.project_id
        WHERE t.origin<>'manual' AND t.source NOT LIKE 'Bank:%'
          AND t.source NOT IN (${placeholders(KNOWN_LEDGER_SOURCES)})${scoped(scope, true)}`,
        args: [...KNOWN_LEDGER_SOURCES, ...scope.args],
      };
    }
    case "quotation-acceptance": {
      return {
        sql: `SELECT 'quotation-acceptance' AS kind, q.id AS row_id, q.id AS evidence_id,
          q.accepted_at AS date, q.total AS amount, ${NULL_TEXT} AS direction, 0 AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          'Persetujuan quotation ' || q.number AS title, p.client AS counterparty, ${NULL_TEXT} AS reference,
          'quotation' AS document_kind, q.id AS document_id, q.number AS document_number,
          q.acceptance_attachment_name AS legacy_proof_name,
          q.acceptance_attachment_mime_type AS legacy_proof_mime,
          CASE WHEN q.acceptance_attachment_content_base64 IS NOT NULL THEN 1 ELSE 0 END AS legacy_proof,
          q.status AS status, q.created_at AS created_at
        FROM quotations q
        JOIN projects p ON p.id=q.project_id
        WHERE q.accepted_at IS NOT NULL${scoped(scope, false)}`,
        args: [...scope.args],
      };
    }
    case "bast": {
      return {
        sql: `SELECT 'bast' AS kind, b.id AS row_id, b.id AS evidence_id,
          b.completion_date AS date, ${NULL_INT} AS amount, ${NULL_TEXT} AS direction, 0 AS reversal,
          p.id AS project_id, p.code AS project_code, p.name AS project_name,
          'BAST ' || b.number AS title, b.client_name AS counterparty, ${NULL_TEXT} AS reference,
          'bast' AS document_kind, b.id AS document_id, b.number AS document_number,
          ${NULL_TEXT} AS legacy_proof_name, ${NULL_TEXT} AS legacy_proof_mime,
          CASE WHEN b.finalized_pdf_storage_url IS NOT NULL OR b.finalized_pdf_content_base64 IS NOT NULL
            THEN 1 ELSE 0 END AS legacy_proof,
          b.status AS status, b.created_at AS created_at
        FROM basts b
        JOIN projects p ON p.id=b.project_id
        WHERE b.status IN ('Final','Void')${scoped(scope, false)}`,
        args: [...scope.args],
      };
    }
    default:
      return null;
  }
}

function buildUnion(user: AuthUser, kinds: readonly FinanceEvidenceKind[]): Branch | null {
  const branches = kinds
    .map((kind) => buildBranch(kind, user))
    .filter((branch): branch is Branch => branch !== null);
  if (!branches.length) return null;
  return {
    sql: branches.map((branch) => branch.sql).join("\n        UNION ALL\n        "),
    args: branches.flatMap((branch) => branch.args),
  };
}

// ── Filter luar ──────────────────────────────────────────────────────────

interface ListFilters {
  q: string;
  from: string | null;
  to: string | null;
  projectId: string | null;
  direction: string | null;
  proof: "with" | "without" | null;
}

/** "9.150.000", "Rp 9,150,000" → 9150000; "INV/2026/001" → null. */
function amountFromQuery(q: string) {
  const cleaned = q.replace(/rp/gi, "").replace(/[\s.,]/g, "");
  return /^\d{1,15}$/.test(cleaned) ? Number(cleaned) : null;
}

const NO_ATTACHMENT = `NOT EXISTS (
  SELECT 1 FROM finance_evidence_attachments fa
  WHERE fa.evidence_kind=ev.kind AND fa.evidence_id=ev.evidence_id
)`;

function buildWhere(filters: ListFilters, withProof: boolean) {
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (filters.from) {
    conditions.push("ev.date>=?");
    args.push(filters.from);
  }
  if (filters.to) {
    conditions.push("ev.date<=?");
    args.push(filters.to);
  }
  if (filters.projectId) {
    conditions.push("ev.project_id=?");
    args.push(filters.projectId);
  }
  if (filters.direction) {
    conditions.push("ev.direction=?");
    args.push(filters.direction);
  }
  if (filters.q) {
    const pattern = `%${filters.q.toLowerCase()}%`;
    const amount = amountFromQuery(filters.q);
    const parts = [
      "lower(ev.title) LIKE ?",
      "lower(ev.counterparty) LIKE ?",
      "lower(ev.reference) LIKE ?",
      "lower(ev.document_number) LIKE ?",
      "lower(ev.project_code) LIKE ?",
    ];
    args.push(pattern, pattern, pattern, pattern, pattern);
    if (amount !== null) {
      parts.push("ev.amount=?");
      args.push(amount);
    }
    conditions.push(`(${parts.join(" OR ")})`);
  }
  if (withProof && filters.proof === "without") {
    conditions.push(`ev.reversal=0 AND ev.legacy_proof=0 AND ${NO_ATTACHMENT}`);
  } else if (withProof && filters.proof === "with") {
    conditions.push(`(ev.legacy_proof=1 OR NOT ${NO_ATTACHMENT})`);
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", args };
}

// ── Bentuk balasan ───────────────────────────────────────────────────────

function pdfUrlFor(documentKind: string | null, documentId: string | null) {
  if (!documentKind || !documentId) return null;
  switch (documentKind) {
    case "invoice":
      return `/api/invoices/${documentId}/pdf`;
    case "quotation":
      return `/api/quotations/${documentId}/pdf`;
    case "spk":
    case "po":
      return `/api/procurement-orders/${documentId}/pdf`;
    case "bast":
      return `/api/bast/${documentId}/pdf`;
    default:
      return null;
  }
}

function text(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  note: string | null;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
  url: string;
}

function mapAttachment(row: Record<string, unknown>): AttachmentDto {
  return {
    id: String(row.id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    byteSize: asNumber(row.byte_size),
    sha256: String(row.sha256),
    note: text(row.note),
    uploadedBy: row.uploaded_by
      ? { id: String(row.uploaded_by), name: String(row.uploader_name ?? "") }
      : null,
    createdAt: String(row.created_at),
    url: `/api/finance/evidence/attachments/${String(row.id)}/file`,
  };
}

async function attachmentsForPage(client: DatabaseClient, rows: EvidenceRow[]) {
  const byKind = new Map<string, Set<string>>();
  for (const row of rows) {
    const kind = String(row.kind);
    if (!byKind.has(kind)) byKind.set(kind, new Set());
    byKind.get(kind)!.add(String(row.evidence_id));
  }
  const result = new Map<string, AttachmentDto[]>();
  for (const [kind, ids] of byKind) {
    const list = [...ids];
    const found = await client.execute({
      sql: `SELECT a.id,a.evidence_kind,a.evidence_id,a.filename,a.mime_type,a.byte_size,a.sha256,
          a.note,a.uploaded_by,a.created_at,u.name AS uploader_name
        FROM finance_evidence_attachments a
        LEFT JOIN users u ON u.id=a.uploaded_by
        WHERE a.evidence_kind=? AND a.evidence_id IN (${placeholders(list)})
        ORDER BY a.created_at`,
      args: [kind, ...list],
    });
    for (const row of found.rows as unknown as Record<string, unknown>[]) {
      const key = `${kind}:${String(row.evidence_id)}`;
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push(mapAttachment(row));
    }
  }
  return result;
}

async function expenseProofsForPage(client: DatabaseClient, rows: EvidenceRow[]) {
  const expenseIds = [
    ...new Set(
      rows
        .filter((row) => String(row.kind) === "expense-settlement" && String(row.document_kind) === "expense")
        .map((row) => String(row.document_id)),
    ),
  ];
  const result = new Map<string, { name: string; mimeType: string; url: string }[]>();
  if (!expenseIds.length) return result;
  const found = await client.execute({
    sql: `SELECT id,expense_id,name,mime_type FROM project_expense_attachments
      WHERE expense_id IN (${placeholders(expenseIds)}) ORDER BY created_at`,
    args: expenseIds,
  });
  for (const row of found.rows as unknown as Record<string, unknown>[]) {
    const key = String(row.expense_id);
    if (!result.has(key)) result.set(key, []);
    result.get(key)!.push({
      name: String(row.name),
      mimeType: String(row.mime_type),
      url: `/api/project-expenses/${key}/attachments/${String(row.id)}`,
    });
  }
  return result;
}

function legacyProofsFor(row: EvidenceRow, expenseProofs: Map<string, { name: string; mimeType: string; url: string }[]>) {
  const kind = String(row.kind) as FinanceEvidenceKind;
  const evidenceId = String(row.evidence_id);
  if (!asNumber(row.legacy_proof)) return [];
  if ((legacyProofKinds as readonly string[]).includes(kind)) {
    return [
      {
        name: String(row.legacy_proof_name ?? "bukti"),
        mimeType: String(row.legacy_proof_mime ?? "application/octet-stream"),
        url: `/api/finance/evidence/${kind}/${evidenceId}/file`,
      },
    ];
  }
  if (kind === "expense-settlement") {
    return expenseProofs.get(String(row.document_id)) ?? [];
  }
  if (kind === "bast") {
    return [
      {
        name: `${String(row.document_number ?? "BAST").replaceAll("/", "-")}.pdf`,
        mimeType: "application/pdf",
        url: `/api/bast/${evidenceId}/pdf`,
      },
    ];
  }
  return [];
}

// ── GET /api/finance/evidence ────────────────────────────────────────────

async function listEvidence(request: Request, user: AuthUser) {
  const { client } = await getDatabase();
  const url = new URL(request.url);
  const params = url.searchParams;

  const viewable = kindsFor(user, "view");
  const requestedKinds = (params.get("kind") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of requestedKinds) assertKind(value);
  const kinds = requestedKinds.length
    ? viewable.filter((kind) => requestedKinds.includes(kind))
    : viewable;

  const direction = params.get("direction");
  if (direction && !(financeEvidenceDirections as readonly string[]).includes(direction)) {
    throw new ApiError(422, "INVALID_DIRECTION", "Arah harus Pemasukan atau Pengeluaran.");
  }
  const proofParam = params.get("proof");
  if (proofParam && proofParam !== "with" && proofParam !== "without") {
    throw new ApiError(422, "INVALID_PROOF_FILTER", "Filter bukti harus with atau without.");
  }
  const projectId = params.get("projectId");
  if (projectId) await assertProjectAccess(client, user, projectId);

  const filters: ListFilters = {
    q: (params.get("q") ?? "").trim().slice(0, 120),
    from: params.get("from") || null,
    to: params.get("to") || null,
    projectId: projectId || null,
    direction: direction || null,
    proof: (proofParam as "with" | "without" | null) || null,
  };
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const pageSize = Math.max(
    PAGE_SIZE_MIN,
    Math.min(PAGE_SIZE_MAX, Number(params.get("pageSize") ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT),
  );

  const union = buildUnion(user, kinds);
  const summaryUnion = buildUnion(user, viewable);
  const empty = {
    items: [] as unknown[],
    page,
    pageSize,
    total: 0,
    summary: { byKind: {} as Record<string, { total: number; withoutProof: number }>, withoutProof: 0, kinds: viewable },
  };
  if (!union || !summaryUnion) return ok(empty, 200, { "Cache-Control": "no-store" });

  const where = buildWhere(filters, true);
  const summaryWhere = buildWhere(filters, false);
  const [pageRows, countRows, summaryRows] = await Promise.all([
    client.execute({
      sql: `SELECT ev.*,
          CASE WHEN ${NO_ATTACHMENT} THEN 0 ELSE 1 END AS has_attachments
        FROM (
        ${union.sql}
        ) ev ${where.sql}
        ORDER BY ev.date DESC, ev.created_at DESC, ev.row_id
        LIMIT ? OFFSET ?`,
      args: [...union.args, ...where.args, pageSize, (page - 1) * pageSize],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS total FROM (
        ${union.sql}
        ) ev ${where.sql}`,
      args: [...union.args, ...where.args],
    }),
    client.execute({
      sql: `SELECT ev.kind AS kind, COUNT(*) AS total,
          SUM(CASE WHEN ev.reversal=0 AND ev.legacy_proof=0 AND ${NO_ATTACHMENT} THEN 1 ELSE 0 END) AS without_proof
        FROM (
        ${summaryUnion.sql}
        ) ev ${summaryWhere.sql}
        GROUP BY ev.kind`,
      args: [...summaryUnion.args, ...summaryWhere.args],
    }),
  ]);

  const rows = pageRows.rows as unknown as EvidenceRow[];
  const [attachments, expenseProofs] = await Promise.all([
    attachmentsForPage(client, rows),
    expenseProofsForPage(client, rows),
  ]);

  const items = rows.map((row) => {
    const kind = String(row.kind) as FinanceEvidenceKind;
    const evidenceId = String(row.evidence_id);
    const legacy = legacyProofsFor(row, expenseProofs);
    const extra = attachments.get(`${kind}:${evidenceId}`) ?? [];
    const documentKind = text(row.document_kind);
    const documentId = text(row.document_id);
    return {
      kind,
      id: String(row.row_id),
      evidenceId,
      date: text(row.date),
      amount: row.amount === null || row.amount === undefined ? null : asNumber(row.amount),
      direction: text(row.direction),
      reversal: Boolean(asNumber(row.reversal)),
      status: text(row.status),
      project: row.project_id
        ? { id: String(row.project_id), code: text(row.project_code), name: text(row.project_name) }
        : null,
      title: text(row.title),
      counterparty: text(row.counterparty),
      reference: text(row.reference),
      document: documentKind
        ? { kind: documentKind, id: documentId, number: text(row.document_number), pdfUrl: pdfUrlFor(documentKind, documentId) }
        : null,
      proof: { hasProof: legacy.length > 0 || extra.length > 0, legacy, attachments: extra },
      createdAt: text(row.created_at),
    };
  });

  const byKind: Record<string, { total: number; withoutProof: number }> = {};
  let withoutProof = 0;
  for (const row of summaryRows.rows as unknown as Record<string, unknown>[]) {
    const missing = asNumber(row.without_proof);
    byKind[String(row.kind)] = { total: asNumber(row.total), withoutProof: missing };
    withoutProof += missing;
  }

  return ok(
    {
      items,
      page,
      pageSize,
      total: asNumber(countRows.rows[0]?.total),
      summary: { byKind, withoutProof, kinds: viewable },
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

// ── Menemukan satu baris bukti ───────────────────────────────────────────

interface ResolvedEvidence {
  projectId: string | null;
  transactionId: string | null;
}

async function resolveEvidence(
  client: DatabaseClient,
  kind: FinanceEvidenceKind,
  evidenceId: string,
): Promise<ResolvedEvidence> {
  const first = async (sql: string, args: unknown[]) =>
    (await client.execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
  let row: Record<string, unknown> | undefined;
  switch (kind) {
    case "invoice-payment":
      row = await first(
        `SELECT i.project_id AS project_id, ip.transaction_id AS transaction_id
          FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id WHERE ip.id=? LIMIT 1`,
        [evidenceId],
      );
      break;
    case "spk-payment":
      row = await first(
        `SELECT s.project_id AS project_id, sp.transaction_id AS transaction_id
          FROM spk_payments sp JOIN spks s ON s.id=sp.spk_id WHERE sp.id=? LIMIT 1`,
        [evidenceId],
      );
      break;
    case "tax-settlement":
      row = await first(
        `SELECT o.project_id AS project_id, ts.transaction_id AS transaction_id
          FROM tax_settlements ts JOIN tax_obligations o ON o.id=ts.obligation_id WHERE ts.id=? LIMIT 1`,
        [evidenceId],
      );
      break;
    case "expense-settlement":
      row = await first(
        `SELECT COALESCE(e.project_id, a.project_id) AS project_id, s.transaction_id AS transaction_id
          FROM project_expense_settlements s
          LEFT JOIN project_expenses e ON e.id=s.expense_id
          LEFT JOIN project_advances a ON a.id=s.advance_id
          WHERE s.id=? LIMIT 1`,
        [evidenceId],
      );
      break;
    case "advance":
      row = await first(
        "SELECT project_id, transaction_id FROM project_advances WHERE id=? LIMIT 1",
        [evidenceId],
      );
      break;
    case "profit-share":
      row = await first(
        "SELECT project_id, transaction_id FROM project_profit_shares WHERE id=? LIMIT 1",
        [evidenceId],
      );
      break;
    case "bank-line":
      row = await first(
        "SELECT transaction_id FROM bank_statement_entries WHERE id=? LIMIT 1",
        [evidenceId],
      );
      break;
    case "manual":
    case "other":
      row = await first(
        "SELECT project_id, id AS transaction_id FROM transactions WHERE id=? LIMIT 1",
        [evidenceId],
      );
      break;
    case "quotation-acceptance":
      row = await first(
        "SELECT project_id FROM quotations WHERE id=? AND accepted_at IS NOT NULL LIMIT 1",
        [evidenceId],
      );
      break;
    case "bast":
      row = await first(
        "SELECT project_id FROM basts WHERE id=? AND status IN ('Final','Void') LIMIT 1",
        [evidenceId],
      );
      break;
  }
  if (!row) throw new ApiError(404, "NOT_FOUND", "Bukti tidak ditemukan.");
  return {
    projectId: row.project_id ? String(row.project_id) : null,
    transactionId: row.transaction_id ? String(row.transaction_id) : null,
  };
}

async function requireEvidence(
  client: DatabaseClient,
  user: AuthUser,
  kind: FinanceEvidenceKind,
  evidenceId: string,
  level: AccessLevel,
) {
  assertKindAccess(user, kind, level);
  const resolved = await resolveEvidence(client, kind, evidenceId);
  await assertEvidenceProjectAccess(client, user, resolved.projectId);
  return resolved;
}

// ── GET /api/finance/evidence/:kind/:id/file ─────────────────────────────
//
// Blob Gen B dibaca SATU baris, kolom disebut — tidak pernah `SELECT *` pada
// tabel-tabel ini. Isinya tidak pernah di-sniff saat diunggah, jadi disniff
// di sini: yang tidak cocok dengan tipe tersimpannya dilayani sebagai
// octet-stream unduhan, bukan ditampilkan inline dengan tipe yang diklaim.

const FILE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
} as const;

function serveBytes(bytes: Buffer, name: string, mimeType: string) {
  let type = mimeType;
  let disposition = inlineDisposition(name);
  try {
    assertMagicBytes(bytes, mimeType);
  } catch {
    type = "application/octet-stream";
    disposition = disposition.replace(/^inline/, "attachment");
  }
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Response(body as ArrayBuffer, {
    headers: { "Content-Type": type, "Content-Disposition": disposition, ...FILE_HEADERS },
  });
}

async function serveLegacyProof(
  client: DatabaseClient,
  user: AuthUser,
  kind: FinanceEvidenceKind,
  evidenceId: string,
) {
  if (!(legacyProofKinds as readonly string[]).includes(kind)) {
    throw new ApiError(404, "NO_LEGACY_PROOF", "Bukti jenis ini tersimpan sebagai lampiran arsip, bukan di catatannya.");
  }
  assertKindAccess(user, kind, "view");
  const queries: Record<string, string> = {
    "invoice-payment": `SELECT ip.attachment_name AS name, ip.attachment_mime_type AS mime,
        ip.attachment_content_base64 AS content, i.project_id AS project_id
      FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id WHERE ip.id=? LIMIT 1`,
    "spk-payment": `SELECT sp.attachment_name AS name, sp.attachment_mime_type AS mime,
        sp.attachment_content_base64 AS content, s.project_id AS project_id
      FROM spk_payments sp JOIN spks s ON s.id=sp.spk_id WHERE sp.id=? LIMIT 1`,
    "tax-settlement": `SELECT ts.attachment_name AS name, ts.attachment_mime_type AS mime,
        ts.attachment_content_base64 AS content, o.project_id AS project_id
      FROM tax_settlements ts JOIN tax_obligations o ON o.id=ts.obligation_id WHERE ts.id=? LIMIT 1`,
    "quotation-acceptance": `SELECT q.acceptance_attachment_name AS name,
        q.acceptance_attachment_mime_type AS mime,
        q.acceptance_attachment_content_base64 AS content, q.project_id AS project_id
      FROM quotations q WHERE q.id=? LIMIT 1`,
  };
  const result = await client.execute({ sql: queries[kind], args: [evidenceId] });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "Bukti tidak ditemukan.");
  await assertEvidenceProjectAccess(client, user, row.project_id ? String(row.project_id) : null);
  if (!row.content) {
    throw new ApiError(404, "NO_LEGACY_PROOF", "Catatan ini tidak menyimpan bukti.");
  }
  const bytes = Buffer.from(String(row.content), "base64");
  if (!bytes.byteLength) throw new ApiError(404, "NO_LEGACY_PROOF", "Berkas bukti kosong.");
  return serveBytes(bytes, String(row.name ?? "bukti"), String(row.mime ?? "application/octet-stream"));
}

// ── Lampiran arsip ───────────────────────────────────────────────────────

async function loadAttachment(client: DatabaseClient, attachmentId: string) {
  const result = await client.execute({
    sql: `SELECT a.id,a.evidence_kind,a.evidence_id,a.filename,a.mime_type,a.byte_size,a.sha256,
        a.storage_url,a.content_base64,a.note,a.uploaded_by,a.created_at,u.name AS uploader_name
      FROM finance_evidence_attachments a LEFT JOIN users u ON u.id=a.uploaded_by
      WHERE a.id=? LIMIT 1`,
    args: [attachmentId],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "NOT_FOUND", "Lampiran tidak ditemukan.");
  const kind = String(row.evidence_kind);
  if (!isFinanceEvidenceKind(kind)) throw new ApiError(404, "NOT_FOUND", "Lampiran tidak ditemukan.");
  return { row, kind, evidenceId: String(row.evidence_id) };
}

async function readFiles(form: FormData) {
  const files: PreparedAttachment[] = [];
  for (const value of form.getAll("files")) {
    if (!(value instanceof File) || !value.size) continue;
    files.push(prepareUploadedAttachment(value.name, value.type, await value.arrayBuffer()));
  }
  return files;
}

async function attachEvidence(
  request: Request,
  user: AuthUser,
  kind: FinanceEvidenceKind,
  evidenceId: string,
) {
  const { client } = await getDatabase();
  const resolved = await requireEvidence(client, user, kind, evidenceId, "manage");
  const form = await request.formData();
  const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;
  const files = await readFiles(form);
  if (!files.length) {
    throw new ApiError(422, "FILE_REQUIRED", "Pilih berkas bukti yang akan dilampirkan.");
  }
  if (files.length > EVIDENCE_ATTACHMENT_MAX_COUNT) {
    throw new ApiError(
      422,
      "ATTACHMENT_TOO_MANY",
      `Maksimal ${EVIDENCE_ATTACHMENT_MAX_COUNT} berkas per unggahan.`,
      { count: files.length, limit: EVIDENCE_ATTACHMENT_MAX_COUNT },
    );
  }
  // Semua diperiksa dulu, baru ditulis: unggahan setengah jadi menyisakan
  // berkas yang alasannya sudah tidak ada.
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.sha256)) {
      throw new ApiError(409, "DUPLICATE_ATTACHMENT", `${file.filename} dikirim dua kali.`, {
        filename: file.filename,
      });
    }
    seen.add(file.sha256);
  }
  const existing = await client.execute({
    sql: `SELECT id,sha256 FROM finance_evidence_attachments WHERE evidence_kind=? AND evidence_id=?`,
    args: [kind, evidenceId],
  });
  if (existing.rows.length + files.length > EVIDENCE_ATTACHMENT_LIMIT) {
    throw new ApiError(
      409,
      "ATTACHMENT_LIMIT",
      `Satu bukti menampung maksimal ${EVIDENCE_ATTACHMENT_LIMIT} lampiran.`,
      { existing: existing.rows.length, limit: EVIDENCE_ATTACHMENT_LIMIT },
    );
  }
  for (const file of files) {
    const duplicate = existing.rows.find((row) => String(row.sha256) === file.sha256);
    if (duplicate) {
      throw new ApiError(
        409,
        "DUPLICATE_ATTACHMENT",
        `${file.filename} sudah dilampirkan pada bukti ini.`,
        { filename: file.filename, attachmentId: String(duplicate.id) },
      );
    }
  }

  const timestamp = new Date().toISOString();
  const items: AttachmentDto[] = [];
  for (const file of files) {
    const id = randomUUID();
    const stored = await storeUploadedFile("finance-evidence", id, file.mimeType, file.content);
    try {
      await client.execute({
        sql: `INSERT INTO finance_evidence_attachments
          (id,evidence_kind,evidence_id,filename,mime_type,byte_size,sha256,storage_url,
           content_base64,note,uploaded_by,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          id, kind, evidenceId, file.filename, file.mimeType, file.byteSize, file.sha256,
          stored.storageUrl, stored.contentBase64, note, user.id, timestamp,
        ],
      });
    } catch (error) {
      // Indeks unik sha256 menang atas dua unggahan yang bersamaan.
      await deleteStoredFile(stored.storageUrl).catch(() => undefined);
      if (/unique/i.test(String((error as Error).message))) {
        throw new ApiError(409, "DUPLICATE_ATTACHMENT", `${file.filename} sudah dilampirkan pada bukti ini.`, {
          filename: file.filename,
        });
      }
      throw error;
    }
    await writeAuditLog(client, request, user, "upload", "finance_evidence_attachment", id, {
      kind,
      evidenceId,
      transactionId: resolved.transactionId,
      filename: file.filename,
      sha256: file.sha256,
      byteSize: file.byteSize,
    });
    items.push({
      id,
      filename: file.filename,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      sha256: file.sha256,
      note,
      uploadedBy: { id: user.id, name: user.name },
      createdAt: timestamp,
      url: `/api/finance/evidence/attachments/${id}/file`,
    });
  }
  return created({ items }, { "Cache-Control": "no-store" });
}

async function serveAttachment(user: AuthUser, attachmentId: string) {
  const { client } = await getDatabase();
  const { row, kind, evidenceId } = await loadAttachment(client, attachmentId);
  await requireEvidence(client, user, kind, evidenceId, "view");
  const stored = await readStoredFile(row.storage_url ? String(row.storage_url) : null);
  const bytes = stored
    ? Buffer.from(stored.content)
    : row.content_base64
      ? Buffer.from(String(row.content_base64), "base64")
      : null;
  if (!bytes || !bytes.byteLength) {
    throw new ApiError(404, "FILE_MISSING", "Isi lampiran tidak tersedia.");
  }
  return serveBytes(bytes, String(row.filename), String(row.mime_type));
}

async function deleteAttachment(request: Request, user: AuthUser, attachmentId: string) {
  const { client } = await getDatabase();
  const { row, kind, evidenceId } = await loadAttachment(client, attachmentId);
  const resolved = await requireEvidence(client, user, kind, evidenceId, "manage");
  // Bukti adalah jejak audit. Admin boleh menghapus apa saja; orang lain hanya
  // unggahannya sendiri — dan tidak ada yang menghapus bukti dari transaksi
  // yang sudah dicocokkan dengan mutasi bank (cermin TRANSACTION_RECONCILED).
  if (user.role !== "Admin" && String(row.uploaded_by ?? "") !== user.id) {
    throw new ApiError(403, "FORBIDDEN", "Hanya Admin atau pengunggahnya yang dapat menghapus lampiran ini.");
  }
  if (resolved.transactionId) {
    const matched = await client.execute({
      sql: `SELECT id FROM bank_statement_entries
        WHERE transaction_id=? AND reconciliation_status='Matched' LIMIT 1`,
      args: [resolved.transactionId],
    });
    if (matched.rows.length) {
      throw new ApiError(
        409,
        "EVIDENCE_RECONCILED",
        "Transaksi ini sudah dicocokkan dengan mutasi bank; lampirannya tidak dapat dihapus.",
      );
    }
  }
  await client.execute({
    sql: "DELETE FROM finance_evidence_attachments WHERE id=?",
    args: [attachmentId],
  });
  await deleteStoredFile(row.storage_url ? String(row.storage_url) : null).catch((error) => {
    console.error("Gagal menghapus berkas lampiran bukti", attachmentId, error);
  });
  await writeAuditLog(client, request, user, "delete", "finance_evidence_attachment", attachmentId, {
    kind,
    evidenceId,
    filename: String(row.filename),
    sha256: String(row.sha256),
  });
  return noContent();
}

// ── Dispatch: /api/finance/evidence/… ────────────────────────────────────

export async function handleFinanceEvidence(request: Request, path: string[], user: AuthUser) {
  // path = ["finance", "evidence", ...]
  const [, , first, second, third] = path;

  if (!first) {
    if (request.method === "GET") return listEvidence(request, user);
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  }

  if (first === "attachments" && second) {
    if (request.method === "GET" && third === "file") return serveAttachment(user, second);
    if (request.method === "DELETE" && !third) return deleteAttachment(request, user, second);
    throw new ApiError(404, "NOT_FOUND", "Endpoint lampiran bukti tidak ditemukan.");
  }

  const kind = assertKind(first);
  if (!second) throw new ApiError(404, "NOT_FOUND", "Endpoint bukti tidak ditemukan.");
  const { client } = await getDatabase();
  if (request.method === "GET" && third === "file") {
    return serveLegacyProof(client, user, kind, second);
  }
  if (request.method === "POST" && third === "attachments") {
    return attachEvidence(request, user, kind, second);
  }
  throw new ApiError(404, "NOT_FOUND", "Endpoint bukti tidak ditemukan.");
}
