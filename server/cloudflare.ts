import "server-only";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all(): Promise<{ results?: Array<Record<string, unknown>> }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}

export interface R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

export interface PerumNetCloudflareEnv {
  DB?: D1DatabaseLike;
  FILES?: R2BucketLike;
}

let environmentPromise: Promise<PerumNetCloudflareEnv | null> | undefined;

export function getCloudflareEnvironment() {
  environmentPromise ??= (async () => {
    try {
      const moduleName = "cloudflare:workers";
      const cloudflare = (await import(/* @vite-ignore */ moduleName)) as {
        env?: PerumNetCloudflareEnv;
      };
      return cloudflare.env ?? null;
    } catch {
      return null;
    }
  })();
  return environmentPromise;
}
