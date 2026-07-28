import "server-only";

import { createClient, type Client, type InStatement } from "@libsql/client";
import { Pool } from "pg";
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
  close?(): void | Promise<void>;
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

function postgresQuery(sql: string) {
  let parameter = 0;
  return sql
    .replace(/\bgroup_concat\s*\(/gi, "string_agg(")
    .replace(/\?/g, () => `$${++parameter}`);
}

function postgresAdapter(pool: Pool): DatabaseClient {
  return {
    async execute(input) {
      const statement = typeof input === "string" ? { sql: input, args: [] } : input;
      const result = await pool.query(postgresQuery(statement.sql), statement.args ?? []);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    async batch(statements) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) {
          await client.query(postgresQuery(statement.sql), statement.args ?? []);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async executeMultiple(sql) {
      await pool.query(sql);
    },
    close() {
      return pool.end();
    },
  };
}

async function createDatabaseState(): Promise<DatabaseState> {
  const demoMode = process.env.APP_MODE === "demo";
  const postgresUrl = demoMode
    ? process.env.DEMO_DATABASE_URL
    : process.env.DATABASE_URL;
  const remoteUrl = demoMode
    ? process.env.DEMO_TURSO_DATABASE_URL
    : process.env.TURSO_DATABASE_URL;
  if (
    demoMode &&
    !postgresUrl &&
    !remoteUrl &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "APP_MODE=demo wajib menggunakan DEMO_DATABASE_URL atau DEMO_TURSO_DATABASE_URL yang terpisah.",
    );
  }
  if (
    demoMode &&
    postgresUrl &&
    process.env.DATABASE_URL &&
    postgresUrl === process.env.DATABASE_URL
  ) {
    throw new Error(
      "DEMO_DATABASE_URL tidak boleh sama dengan DATABASE_URL production.",
    );
  }
  if (
    demoMode &&
    remoteUrl &&
    process.env.TURSO_DATABASE_URL &&
    remoteUrl === process.env.TURSO_DATABASE_URL
  ) {
    throw new Error(
      "DEMO_TURSO_DATABASE_URL tidak boleh sama dengan TURSO_DATABASE_URL production.",
    );
  }
  let client: DatabaseClient;

  if (postgresUrl) {
    client = postgresAdapter(
      new Pool({
        connectionString: postgresUrl,
        max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
        ssl:
          process.env.DATABASE_SSL === "require"
            ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
            : undefined,
      }),
    );
  } else if (remoteUrl) {
    client = libSqlAdapter(
      createClient({
        url: remoteUrl,
        authToken: demoMode
          ? process.env.DEMO_TURSO_AUTH_TOKEN
          : process.env.TURSO_AUTH_TOKEN,
      }),
    );
  } else {
    const cloudflare = await getCloudflareEnvironment();
    if (cloudflare?.DB) {
      client = d1Adapter(cloudflare.DB);
    } else if (process.env.NODE_ENV !== "production") {
      client = libSqlAdapter(
        createClient({
          url: demoMode
            ? "file:perumnet.demo.local.db"
            : "file:perumnet.local.db",
        }),
      );
    } else {
      throw new Error(
        "Database belum dikonfigurasi. Isi DATABASE_URL, hubungkan D1, atau isi TURSO_DATABASE_URL.",
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
  await state?.client.close?.();
  globalThis.__perumnetDatabasePromise = undefined;
}
