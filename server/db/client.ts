import "server-only";

import { createClient, type Client, type InStatement } from "@libsql/client";
import { Pool } from "pg";
import { getCloudflareEnvironment, type D1DatabaseLike } from "../cloudflare";
import { isProductionRuntime } from "../runtime-env";
import { initializeDatabase } from "./initialize";

export interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface DatabaseStatement {
  sql: string;
  args?: unknown[];
}

export type DatabaseDialect = "postgres" | "sqlite";

export interface DatabaseClient {
  readonly dialect: DatabaseDialect;
  execute(statement: string | DatabaseStatement): Promise<QueryResult>;
  batch(statements: DatabaseStatement[], mode?: "read" | "write" | "deferred"): Promise<unknown>;
  transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T>;
  executeMultiple(sql: string): Promise<unknown>;
  close?(): void | Promise<void>;
}

/**
 * Suffix that locks the rows a SELECT returns for the rest of the transaction.
 *
 * PostgreSQL runs every statement of a READ COMMITTED transaction against a
 * fresh snapshot, and the RESTRICT trigger behind a foreign key uses the very
 * latest one. A parent row that has no children when we check can therefore
 * gain one — committed by another request — before we delete it, and the
 * delete then fails with a raw `restrict_violation`. Locking the parent row
 * FOR UPDATE first blocks the FOR KEY SHARE lock that inserting or moving a
 * child row needs, which closes that window.
 *
 * SQLite/libSQL has no FOR UPDATE syntax and does not need it: a write
 * transaction (BEGIN IMMEDIATE) already serialises every other writer.
 */
export function rowLock(client: DatabaseClient) {
  return client.dialect === "postgres" ? " FOR UPDATE" : "";
}

type DatabaseState = {
  client: DatabaseClient;
};

declare global {
  var __perumnetDatabasePromise: Promise<DatabaseState> | undefined;
}

function libSqlAdapter(client: Client): DatabaseClient {
  return {
    dialect: "sqlite",
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
    async transaction(callback) {
      const transaction = await client.transaction("write");
      const transactionClient: DatabaseClient = {
        dialect: "sqlite",
        async execute(input) {
          const statement =
            typeof input === "string"
              ? input
              : ({ sql: input.sql, args: (input.args ?? []) as never[] } satisfies InStatement);
          const result = await transaction.execute(statement);
          return { rows: result.rows as unknown as Array<Record<string, unknown>> };
        },
        batch(statements) {
          return transaction.batch(
            statements.map((item) => ({
              sql: item.sql,
              args: (item.args ?? []) as never[],
            })),
          );
        },
        async transaction(nestedCallback) {
          return nestedCallback(transactionClient);
        },
        async executeMultiple(sql) {
          for (const statement of sql.split(";").map((item) => item.trim()).filter(Boolean)) {
            await transaction.execute(statement);
          }
        },
      };
      try {
        const result = await callback(transactionClient);
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback();
        throw error;
      } finally {
        transaction.close();
      }
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
  const adapter: DatabaseClient = {
    dialect: "sqlite",
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
    async transaction(callback) {
      // D1 only exposes atomic prepared-statement batches. The canonical
      // production/demo runtime uses PostgreSQL; keep callback semantics for
      // read/validation compatibility when this adapter is used.
      return callback(adapter);
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
  return adapter;
}

function postgresQuery(sql: string) {
  let parameter = 0;
  return sql
    .replace(/\bgroup_concat\s*\(/gi, "string_agg(")
    .replace(/\?/g, () => `$${++parameter}`);
}

function postgresAdapter(pool: Pool): DatabaseClient {
  return {
    dialect: "postgres",
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
    async transaction(callback) {
      const connection = await pool.connect();
      const transactionClient: DatabaseClient = {
        dialect: "postgres",
        async execute(input) {
          const statement = typeof input === "string" ? { sql: input, args: [] } : input;
          const result = await connection.query(
            postgresQuery(statement.sql),
            statement.args ?? [],
          );
          return { rows: result.rows as Array<Record<string, unknown>> };
        },
        async batch(statements) {
          for (const statement of statements) {
            await connection.query(
              postgresQuery(statement.sql),
              statement.args ?? [],
            );
          }
        },
        async transaction(nestedCallback) {
          return nestedCallback(transactionClient);
        },
        async executeMultiple(sql) {
          await connection.query(sql);
        },
      };
      try {
        await connection.query("BEGIN");
        const result = await callback(transactionClient);
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
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
  // `isProductionRuntime()` rather than the bare literal: Next inlines
  // `process.env.NODE_ENV` while compiling, so inside a server started with
  // `NODE_ENV=production next dev` the plain expression reads "development" and
  // this guard — the one that keeps a demo workspace off the production
  // database — never fires. See server/runtime-env.ts.
  if (demoMode && !postgresUrl && !remoteUrl && isProductionRuntime()) {
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
    } else if (!isProductionRuntime()) {
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
