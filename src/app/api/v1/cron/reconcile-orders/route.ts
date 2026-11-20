import { NextRequest } from "next/server";
import { dbConnection } from "@topupsend/db";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import { runReconciliationSweep } from "@/lib/services/reconciliation.service";
import { logger } from "@/lib/logger";

// Cron routes must never be cached.
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/v1/cron/reconcile-orders
 *
 * Driven by Vercel Cron (see vercel.json). Protected by CRON_SECRET:
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` when the env var
 * is set. Fails closed — without CRON_SECRET configured the route
 * refuses to run at all.
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error("Reconciliation cron invoked but CRON_SECRET is not set");
    return createErrorResponse("Cron is not configured", 500);
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return createErrorResponse("Unauthorized", 401);
  }

  await dbConnection.connect();

  const summary = await runReconciliationSweep();

  return createSuccessResponse({
    success: true,
    message: "Reconciliation sweep completed",
    summary,
  });
}

export const GET = handle;
export const POST = handle;
