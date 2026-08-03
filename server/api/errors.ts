import { z, ZodError } from "zod";

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
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env.NODE_ENV === "production"
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
