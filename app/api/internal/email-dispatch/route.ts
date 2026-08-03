import { timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { dispatchEmailOutbox } from "@/server/email";
import { anonymizeExpiredLeads } from "@/server/api/lead-router";
import { sweepStaleCatalogAiRuns } from "@/server/api/catalog-ai-router";
import { ApiError, errorResponse, ok } from "@/server/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.EMAIL_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      throw new ApiError(401, "UNAUTHORIZED", "Worker email tidak terotorisasi.");
    }
    const { client } = await getDatabase();
    const anonymizedLeads = await anonymizeExpiredLeads(client);
    const sweptAiRuns = await sweepStaleCatalogAiRuns(client);
    const result = await dispatchEmailOutbox(client, 25);
    return ok({
      processed: result.length,
      sent: result.filter((item) => item.status === "sent").length,
      failed: result.filter((item) => item.status === "failed").length,
      anonymizedLeads,
      sweptAiRuns,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
