import "server-only";

import type { DatabaseClient } from "./client";

// Trailing sequence digits, tolerating revision suffixes like "QUO/PN/08/2026/003-R2".
const SUFFIX_PATTERN = /(\d+)(?:-R\d+)?$/;

async function seedFromExistingNumbers(
  client: DatabaseClient,
  key: string,
  seedSql: string,
) {
  const rows = await client.execute(seedSql);
  let max = rows.rows.length;
  for (const row of rows.rows) {
    const match = String(row.value ?? "").match(SUFFIX_PATTERN);
    if (match) max = Math.max(max, Number(match[1]));
  }
  await client.execute({
    sql: `INSERT INTO document_counters (key,last_value) VALUES (?,?)
      ON CONFLICT (key) DO NOTHING`,
    args: [key, max],
  });
}

// Atomically claims the next sequence number for a document series. Counters
// survive deletions, unlike the COUNT(*) approach they replace, so numbers can
// never be reissued. First use seeds the counter from the highest suffix among
// existing numbers (seedSql must return them in a column aliased `value`).
export async function claimSequence(
  client: DatabaseClient,
  key: string,
  seedSql: string,
): Promise<number> {
  const existing = await client.execute({
    sql: "SELECT last_value FROM document_counters WHERE key=? LIMIT 1",
    args: [key],
  });
  if (!existing.rows.length) {
    await seedFromExistingNumbers(client, key, seedSql);
  }
  const updated = await client.execute({
    sql: "UPDATE document_counters SET last_value=last_value+1 WHERE key=? RETURNING last_value",
    args: [key],
  });
  return Number(updated.rows[0]?.last_value ?? 1);
}
