import { dispatchCmsApi } from "@/server/api/cms-router";
import { errorResponse } from "@/server/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ path: string[] }>;
};

async function handler(request: Request, context: Context) {
  try {
    const { path } = await context.params;
    return await dispatchCmsApi(request, path);
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
