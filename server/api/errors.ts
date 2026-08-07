import { z, ZodError } from "zod";
import { isProductionRuntime } from "../runtime-env";

// In Zod 4 `.partial()` keeps `.default()` values firing for missing keys, so
// `schema.partial().parse({one:"field"})` silently materializes every other
// defaulted field, and PATCH handlers written as `input.x ?? current.x` then
// reset stored data to the defaults. Patch schemas must strip the defaults
// BEFORE making the fields optional.
export function partialPatchSchema<S extends z.ZodObject<z.ZodRawShape>>(schema: S) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      let inner = field as z.ZodType;
      while (inner instanceof z.ZodDefault) {
        inner = (inner as z.ZodDefault<z.ZodType>).removeDefault() as z.ZodType;
      }
      return [key, inner.optional()];
    }),
  );
  return z.object(shape) as unknown as ReturnType<S["partial"]>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * True when the driver refused a write because another row still references the
 * one we touched (or because the row we point at is gone).
 *
 * PostgreSQL uses SQLSTATE 23001 (restrict_violation, raised by ON DELETE
 * RESTRICT) and 23503 (foreign_key_violation). libSQL/SQLite and D1 report
 * "FOREIGN KEY constraint failed". Matching the SQLite message rather than its
 * SQLITE_CONSTRAINT code on purpose: that code also covers UNIQUE and CHECK
 * failures, which are a different conversation with the user.
 */
export function isReferenceViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  if (code === "23001" || code === "23503") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return /foreign key constraint/i.test(message);
}

/**
 * Awaits a database write and turns an escaping reference violation into a
 * friendly ApiError. A user-reachable action must never surface a raw 500 just
 * because the rows underneath it changed between the check and the write.
 */
export async function refuseOnReference<T>(
  work: Promise<T>,
  refusal: () => ApiError,
): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isReferenceViolation(error)) throw refusal();
    throw error;
  }
}

export function ok(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json({ data }, { status, headers });
}

export function created(data: unknown, headers?: HeadersInit) {
  return ok(data, 201, headers);
}

export function noContent(headers?: HeadersInit) {
  return new Response(null, { status: 204, headers });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Data yang dikirim belum valid.",
          details: error.flatten(),
        },
      },
      { status: 422 },
    );
  }

  const message = error instanceof Error ? error.message : "Terjadi kesalahan internal.";
  console.error(error);
  // Whether the caller is shown the internal error text is a security decision,
  // so it has to read the environment the process is actually running in.
  // Next inlines a literal `process.env.NODE_ENV` at compile time, which means
  // the obvious spelling stays "development" inside any server started with
  // `NODE_ENV=production next dev` and hands out driver messages, file paths and
  // SQL fragments. See server/runtime-env.ts.
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: isProductionRuntime()
          ? "Terjadi kesalahan internal. Silakan coba kembali."
          : message,
      },
    },
    { status: 500 },
  );
}

export async function jsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Body request harus berupa JSON yang valid.");
  }
}

export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;

  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = new Set([requestOrigin]);
  const configuredOrigins = [
    process.env.APP_URL,
    ...(process.env.APP_ALLOWED_ORIGINS?.split(",") ?? []),
  ];

  for (const configuredOrigin of configuredOrigins) {
    const value = configuredOrigin?.trim();
    if (!value) continue;
    try {
      allowedOrigins.add(new URL(value).origin);
    } catch {
      console.error(`Origin aplikasi tidak valid: ${value}`);
    }
  }

  if (!allowedOrigins.has(origin)) {
    throw new ApiError(403, "INVALID_ORIGIN", "Request ditolak karena origin tidak sesuai.");
  }
}
