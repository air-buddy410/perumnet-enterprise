import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { CheckCircle2, FileCheck2, ShieldAlert } from "lucide-react";
import { getDatabase } from "@/server/db/client";
import { readProjectFile } from "@/server/storage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verifikasi BAST | PerumNet Enterprise",
  robots: { index: false, follow: false },
};

function longDate(value: unknown) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Makassar",
  }).format(new Date(String(value)));
}

/**
 * `basts.completion_date` is a date-only column: no clock time was ever
 * recorded. Formatting it with `longDate` invented one — `new Date("2026-08-04")`
 * is UTC midnight, which renders as "pukul 08.00" in Asia/Makassar — and the
 * `.split(",")` that was meant to drop it never matched, because the `id-ID`
 * long format has no comma. This page is a client-facing legal verification, so
 * it must assert only the date the document actually carries.
 */
function longDateOnly(value: unknown) {
  if (!value) return "-";
  const day = String(value).slice(0, 10);
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00+08:00` : String(value),
  );
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(date);
}

export default async function BastVerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { client } = await getDatabase();
  const result = await client.execute({
    sql: `SELECT b.number,b.status,b.completion_date,b.finalized_at,b.revoked_at,
      b.revocation_reason,b.pdf_hash,b.finalized_pdf_storage_url,
      b.finalized_pdf_content_base64,p.code AS project_code,p.name AS project_name,
      cp.title AS package_title
      FROM basts b JOIN projects p ON p.id=b.project_id
      LEFT JOIN project_commercial_packages cp ON cp.id=b.package_id
      WHERE b.verification_token=? LIMIT 1`,
    args: [token],
  });
  const row = result.rows[0];
  let hashMatches = false;
  if (row?.pdf_hash) {
    const stored = row.finalized_pdf_storage_url
      ? await readProjectFile(String(row.finalized_pdf_storage_url))
      : null;
    const bytes = stored?.content ?? Buffer.from(
      String(row.finalized_pdf_content_base64 ?? ""),
      "base64",
    );
    if (bytes.byteLength) {
      const actual = createHash("sha256")
        .update(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
        .digest("hex");
      hashMatches = actual === String(row.pdf_hash);
    }
  }
  const valid = Boolean(row && row.finalized_at && !row.revoked_at && hashMatches);

  return (
    <main className="verification-page">
      <section className="verification-card" aria-labelledby="verification-title">
        <div className={`verification-icon ${valid ? "is-valid" : "is-invalid"}`}>
          {valid ? <CheckCircle2 size={34} /> : <ShieldAlert size={34} />}
        </div>
        <p className="eyebrow">PERUMNET ENTERPRISE</p>
        <h1 id="verification-title">
          {valid ? "Dokumen terverifikasi" : "Dokumen tidak aktif"}
        </h1>
        <p className="verification-lead">
          {valid
            ? "BAST ini cocok dengan arsip final PerumNet Enterprise dan belum dicabut."
            : row?.revoked_at
              ? "BAST ini telah dicabut. Gunakan revisi terbaru yang diterbitkan PerumNet Enterprise."
              : "Token atau integritas arsip tidak dapat diverifikasi."}
        </p>
        {row && (
          <dl className="verification-details">
            <div><dt>Nomor dokumen</dt><dd>{String(row.number)}</dd></div>
            <div><dt>Proyek</dt><dd>{String(row.project_code)} · {String(row.project_name)}</dd></div>
            <div><dt>Paket</dt><dd>{String(row.package_title ?? "Lingkup Utama")}</dd></div>
            <div><dt>Tanggal serah terima</dt><dd>{longDateOnly(row.completion_date)}</dd></div>
            <div><dt>Finalisasi</dt><dd>{longDate(row.finalized_at)}</dd></div>
            <div><dt>Status</dt><dd>{row.revoked_at ? "Dicabut" : String(row.status)}</dd></div>
            <div><dt>Hash SHA-256</dt><dd className="verification-hash">{String(row.pdf_hash ?? "-")}</dd></div>
          </dl>
        )}
        <div className="verification-note">
          <FileCheck2 size={18} />
          <span>Cap ini adalah segel internal tamper-evident, bukan Tanda Tangan Elektronik Tersertifikasi PSrE.</span>
        </div>
      </section>
    </main>
  );
}
