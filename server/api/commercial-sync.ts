import "server-only";

import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../audit";
import type { AuthUser } from "../auth";
import type { DatabaseClient } from "../db/client";
import { asNumber } from "../format";
import { snapshotQuotationItems } from "../quotation-snapshot";
import { resolveCommercialPackageId } from "./commercial-package-router";
import { ApiError } from "./errors";
import { refreshQuotationCommercialSnapshot } from "./tax-router";

function now() {
  return new Date().toISOString();
}

// A BoQ may never shrink below the money already billed against it, otherwise
// the invoices reference work the priced scope no longer contains.
export async function assertBoqTotalCoversInvoices(
  client: DatabaseClient,
  projectId: string,
  proposedTotal: number,
  packageId?: string,
) {
  const result = await client.execute({
    sql: `SELECT COALESCE(SUM(amount),0) AS total FROM invoices
      WHERE project_id=?${packageId ? " AND package_id=?" : ""}`,
    args: packageId ? [projectId, packageId] : [projectId],
  });
  const invoicedTotal = asNumber(result.rows[0]?.total);
  if (proposedTotal < invoicedTotal) {
    throw new ApiError(
      409,
      "BOQ_BELOW_INVOICED_TOTAL",
      `Nilai BoQ tidak boleh lebih kecil dari total Invoice yang sudah diterbitkan (${invoicedTotal}). Edit atau hapus Invoice terlebih dahulu.`,
    );
  }
}

// A validation checklist describes the BoQ it was signed against. The moment the
// BoQ of a package changes — Original items or an Addendum — the checklist no
// longer covers the delivered scope, so it drops back to Draft and every tick is
// discarded. Both the BoQ handlers and the commercial scope handlers call this.
export async function resetProjectValidation(
  client: DatabaseClient,
  projectId: string,
  packageId?: string,
) {
  const timestamp = now();
  const packageFilter = packageId ? " AND package_id=?" : "";
  const args = packageId ? [projectId, packageId] : [projectId];
  await client.batch(
    [
      {
        sql: `DELETE FROM project_validation_items WHERE validation_id IN
          (SELECT id FROM project_validations WHERE project_id=?${packageFilter})`,
        args,
      },
      {
        sql: `UPDATE project_validations SET status='Draft',validated_by=NULL,
          completed_at=NULL,updated_at=? WHERE project_id=?${packageFilter}`,
        args: [timestamp, ...args],
      },
    ],
    "write",
  );
}

// The ONE place a priced BoQ change is reflected into the commercial documents.
// A quotation that was already sent to the client is never rewritten in place:
// it is superseded and a fresh Draft revision carries the new numbers, with the
// tax selection copied across unlocked. Draft quotations simply follow the BoQ.
export async function syncCommercialValues(
  client: DatabaseClient,
  projectId: string,
  auditContext?: { request: Request; user: AuthUser },
) {
  const sentChanges = await client.execute({
    sql: `SELECT q.*,
      COALESCE((SELECT SUM(i.quantity*i.selling_price) FROM boq_items i
        WHERE i.scope_id=q.scope_id),0) AS live_total
      FROM quotations q
      WHERE q.project_id=? AND q.status='Sent'
        AND COALESCE((SELECT SUM(i.quantity*i.selling_price) FROM boq_items i
          WHERE i.scope_id=q.scope_id),0)<>q.total`,
    args: [projectId],
  });
  for (const oldQuote of sentChanges.rows) {
    const timestamp = now();
    const quotationId = randomUUID();
    const revisionNo = asNumber(oldQuote.revision_no) + 1;
    await snapshotQuotationItems(client, String(oldQuote.id));
    await client.transaction(async (tx) => {
      await tx.execute({
        sql: "UPDATE quotations SET status='Superseded',updated_at=? WHERE id=? AND status='Sent'",
        args: [timestamp, oldQuote.id],
      });
      await tx.execute({
        sql: `INSERT INTO quotations
          (id,project_id,package_id,scope_id,number,status,issued_at,valid_until,
           total,revision_no,supersedes_id,discount_enabled,discount_type,
           discount_value,discount_amount,taxable_base,tax_enabled,tax_revision,
           rounding_mode,rounding_step,rounding_adjustment,rounding_reason,
           grand_total,created_at,updated_at)
          VALUES (?,?,?,?,?,'Draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          quotationId, oldQuote.project_id, oldQuote.package_id, oldQuote.scope_id,
          `${String(oldQuote.number).replace(/-R\d+$/, "")}-R${revisionNo}`,
          oldQuote.issued_at, oldQuote.valid_until, asNumber(oldQuote.live_total), revisionNo,
          oldQuote.id, oldQuote.discount_enabled, oldQuote.discount_type,
          oldQuote.discount_value, 0, 0, oldQuote.tax_enabled,
          asNumber(oldQuote.tax_revision) + 1, oldQuote.rounding_mode,
          oldQuote.rounding_step, oldQuote.rounding_adjustment, oldQuote.rounding_reason,
          0, timestamp, timestamp,
        ],
      });
      const taxes = await tx.execute({
        sql: "SELECT * FROM document_taxes WHERE document_type='Quotation' AND document_id=?",
        args: [oldQuote.id],
      });
      for (const tax of taxes.rows) {
        await tx.execute({
          sql: `INSERT INTO document_taxes
            (id,document_type,document_id,project_id,rule_id,rule_code,rule_name,
             rule_name_en,scope,effect,accounting_treatment,rate_bps,taxable_base,
             amount,locked,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
          args: [
            `document-tax-${randomUUID()}`, "Quotation", quotationId, oldQuote.project_id,
            tax.rule_id, tax.rule_code, tax.rule_name, tax.rule_name_en, tax.scope,
            tax.effect, tax.accounting_treatment, tax.rate_bps, 0, 0,
            auditContext?.user.id ?? null, timestamp, timestamp,
          ],
        });
      }
    });
    if (auditContext) {
      await writeAuditLog(
        client,
        auditContext.request,
        auditContext.user,
        "revise",
        "quotation",
        quotationId,
        { supersedesId: oldQuote.id, revisionNo, reason: "BoQ changed after quotation was sent" },
      );
    }
  }
  const totalResult = await client.execute({
    sql: `
      SELECT
        COALESCE(SUM(i.quantity * i.selling_price), 0) AS boq_total,
        COALESCE((
          SELECT SUM(CASE WHEN q.grand_total>0 THEN q.grand_total ELSE q.total END)
          FROM quotations q
          WHERE q.project_id=? AND q.status='Accepted'
        ),0) AS accepted_total
      FROM boq_items i
      JOIN boqs b ON b.id = i.boq_id
      WHERE b.project_id = ?
    `,
    args: [projectId, projectId],
  });
  const acceptedTotal = asNumber(totalResult.rows[0]?.accepted_total);
  const total =
    acceptedTotal > 0
      ? acceptedTotal
      : asNumber(totalResult.rows[0]?.boq_total);
  const timestamp = now();
  await client.batch(
    [
      {
        sql: "UPDATE projects SET value=?,updated_at=? WHERE id=?",
        args: [total, timestamp, projectId],
      },
      {
        sql: `UPDATE quotations SET total=COALESCE((
          SELECT SUM(i.quantity*i.selling_price)
          FROM boq_items i WHERE i.scope_id=quotations.scope_id
        ),0),updated_at=? WHERE project_id=? AND status='Draft'`,
        args: [timestamp, projectId],
      },
      {
        sql: `UPDATE boq_scopes SET status='Draft',updated_at=?
          WHERE id IN (
            SELECT q.scope_id FROM quotations q
            WHERE q.project_id=? AND q.status='Draft'
          )`,
        args: [timestamp, projectId],
      },
    ],
    "write",
  );
  const draftQuotations = await client.execute({
    sql: "SELECT id FROM quotations WHERE project_id=? AND status='Draft'",
    args: [projectId],
  });
  for (const quotation of draftQuotations.rows) {
    await refreshQuotationCommercialSnapshot(client, String(quotation.id));
  }
  return total;
}

/**
 * Memastikan proyek punya BoQ dan scope Original untuk paketnya, lalu
 * memulangkan ketiga id-nya.
 *
 * Dipindahkan ke berkas ini dari router.ts supaya penempelan BoQ mandiri
 * memakai penyelesai yang SAMA. Sebelumnya penempelan menebak sendiri: ia
 * menghapus `boq_items` per `boq_id` dan menyisipkan ulang TANPA `scope_id`,
 * sehingga itemnya tidak menjadi milik scope mana pun — tak terbaca layar BoQ,
 * tak terhitung nilai quotation, dan quotation yang sudah Accepted ikut jatuh
 * ke nol.
 */
export async function ensureBoq(
  client: DatabaseClient,
  projectId: string,
  requestedPackageId?: string | null,
) {
  const packageId = await resolveCommercialPackageId(client, projectId, requestedPackageId);
  const existing = await client.execute({
    sql: "SELECT id FROM boqs WHERE project_id = ? LIMIT 1",
    args: [projectId],
  });
  const id = existing.rows[0] ? String(existing.rows[0].id) : randomUUID();
  const timestamp = now();
  if (!existing.rows[0]) {
    await client.execute({
      sql: "INSERT INTO boqs (id,project_id,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      args: [id, projectId, "Draft", "", timestamp, timestamp],
    });
  }
  const scope = await client.execute({
    sql: `SELECT id FROM boq_scopes WHERE boq_id=? AND package_id=?
      AND kind='Original' AND parent_scope_id IS NULL ORDER BY sequence LIMIT 1`,
    args: [id, packageId],
  });
  let scopeId = scope.rows[0] ? String(scope.rows[0].id) : "";
  if (!scope.rows[0]) {
    const sequence = await client.execute({
      sql: "SELECT COALESCE(MAX(sequence),-1)+1 AS sequence FROM boq_scopes WHERE boq_id=?",
      args: [id],
    });
    const packageResult = await client.execute({
      sql: "SELECT title FROM project_commercial_packages WHERE id=? LIMIT 1",
      args: [packageId],
    });
    scopeId = randomUUID();
    await client.execute({
      sql: `INSERT INTO boq_scopes
        (id,boq_id,package_id,kind,sequence,title,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [scopeId, id, packageId, "Original", asNumber(sequence.rows[0]?.sequence),
        String(packageResult.rows[0]?.title ?? "Lingkup Utama"), "Draft", timestamp, timestamp],
    });
  }
  return { boqId: id, scopeId, packageId };
}
