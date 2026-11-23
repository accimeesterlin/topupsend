import { NextRequest } from "next/server";
import { dbConnection } from "@topupsend/db";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import { processScheduledTopups } from "@/lib/services/scheduled-topups.service";
import { logger } from "@/lib/logger";

// Cron routes must never be cached.
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/v1/cron/scheduled-topups
 *
 * Driven by Vercel Cron (see vercel.json). This is the ONLY trigger
 * for the scheduled-topups executor — the previous in-process
 * node-cron timer registered from instrumentation could both miss
 * ticks (ephemeral serverless instances) and duplicate them (every
 * warm instance ran its own timer).
 *
 * Two independent gates, both fail-closed:
 * - CRON_SECRET: Vercel sends `Authorization: Bearer <CRON_SECRET>`;
 *   without it configured the route refuses to run at all (same
 *   pattern as /api/v1/cron/reconcile-orders).
 * - SCHEDULED_TOPUPS_ENABLED: the executor runs only when the flag
 *   is exactly 'true' — the kill-switch semantics the feature has
 *   always had. Any other value leaves every schedule untouched.
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error("Scheduled-topups cron invoked but CRON_SECRET is not set");
    return createErrorResponse("Cron is not configured", 500);
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return createErrorResponse("Unauthorized", 401);
  }

  if (process.env.SCHEDULED_TOPUPS_ENABLED !== "true") {
    logger.info("Scheduled-topups cron invoked while the feature is disabled");
    return createErrorResponse("Scheduled top-ups are not enabled", 503);
  }

  await dbConnection.connect();

  const results = await processScheduledTopups();

  const summary = {
    total: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  };

  logger.info("Scheduled-topups cron completed", summary);

  return createSuccessResponse({
    success: true,
    message: "Scheduled top-ups processing completed",
    summary,
  });
}

export const GET = handle;
export const POST = handle;
