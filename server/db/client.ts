import "server-only";

import { createClient, type Client, type InStatement } from "@libsql/client";
import { getCloudflareEnvironment, type D1DatabaseLike } from "../cloudflare";
import { initializeDatabase } from "./initialize";

export interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface DatabaseStatement {
  sql: string;
  args?: unknown[];
}

export interface DatabaseClient {
  execute(statement: string | DatabaseStatement): Promise<QueryResult>;
  batch(statements: DatabaseStatement[], mode?: "read" | "write" | "deferred"): Promise<unknown>;
  executeMultiple(sql: string): Promise<unknown>;
  close?(): void;
}

type DatabaseState = {
  client: DatabaseClient;
};

declare global {
  var __perumnetDatabasePromise: Promise<DatabaseState> | undefined;
}

function libSqlAdapter(client: Client): DatabaseClient {
  return {
    async execute(input) {
      const statement =
        typeof input === "string"
          ? input
          : ({ sql: input.sql, args: (input.args ?? []) as never[] } satisfies InStatement);
      const result = await client.execute(statement);
      return { rows: result.rows as unknown as Array<Record<string, unknown>> };
    },
    batch(statements, mode) {
      return client.batch(
        statements.map((item) => ({ sql: item.sql, args: (item.args ?? []) as never[] })),
        mode,
      );
    },
    executeMultiple(sql) {
      return client.executeMultiple(sql);
    },
    close() {
      client.close();
    },
  };
}

function d1Adapter(database: D1DatabaseLike): DatabaseClient {
  return {
    async execute(input) {
      const statement = typeof input === "string" ? { sql: input, args: [] } : input;
      const result = await database
        .prepare(statement.sql)
        .bind(...(statement.args ?? []))
        .all();
      return { rows: result.results ?? [] };
    },
    async batch(statements) {
      return database.batch(
        statements.map((item) =>
          database.prepare(item.sql).bind(...(item.args ?? [])),
        ),
      );
    },
    executeMultiple(sql) {
      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => database.prepare(statement));
      return database.batch(statements);
    },
  };
}

async function createDatabaseState(): Promise<DatabaseState> {
  const remoteUrl = process.env.TURSO_DATABASE_URL;
  let client: DatabaseClient;

  if (remoteUrl) {
    client = libSqlAdapter(
      createClient({
        url: remoteUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
    );
  } else {
    const cloudflare = await getCloudflareEnvironment();
    if (cloudflare?.DB) {
      client = d1Adapter(cloudflare.DB);
    } else if (process.env.NODE_ENV !== "production") {
      client = libSqlAdapter(createClient({ url: "file:perumnet.local.db" }));
    } else {
      throw new Error(
        "Database belum dikonfigurasi. Hubungkan D1 atau isi TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN.",
      );
    }
  }

  await initializeDatabase(client);
  return { client };
}

export async function getDatabase() {
  globalThis.__perumnetDatabasePromise ??= createDatabaseState();
  return globalThis.__perumnetDatabasePromise;
}

export async function closeDatabaseForTests() {
  const state = await globalThis.__perumnetDatabasePromise;
  state?.client.close?.();
  globalThis.__perumnetDatabasePromise = undefined;
}
