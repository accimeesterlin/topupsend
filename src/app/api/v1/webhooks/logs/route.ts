/**
 * Webhook Logs Management Endpoints
 * GET /api/v1/webhooks/logs - List webhook logs
 */

import { NextRequest } from "next/server";
import { ApiErrors } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { webhookLoggingService } from "@/lib/services/webhook-logging.service";
import { type WebhookSource } from "@topupsend/db";

/**
 * GET - List webhook logs
 */
export async function GET(request: NextRequest) {
  const session = await requireAuth(request);

  // Check permission
  if (!hasPermission(session.roles, Permission.VIEW_WEBHOOK_LOGS)) {
    throw ApiErrors.Forbidden("Insufficient permissions");
  }

  const { searchParams } = new URL(request.url);

  const source = searchParams.get("source") as WebhookSource | null;
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const skip = (page - 1) * limit;

  const { logs, total } = await webhookLoggingService.getLogsByOrg(
    session.orgId,
    {
      source: source || undefined,
      status: status || undefined,
      limit,
      skip,
    },
  );

  return createSuccessResponse({
    logs: logs.map((log) => ({
      id: String(log._id),
      event: log.event,
      source: log.source,
      status: log.status,
      attempts: log.attempts,
      maxAttempts: log.maxAttempts,
      nextRetryAt: log.nextRetryAt,
      lastAttemptAt: log.lastAttemptAt,
      transactionId: log.transactionId,
      customerId: log.customerId,
      errorMessage: log.errorMessage,
      responseCode: log.responseCode,
      processingDuration: log.processingDuration,
      createdAt: log.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
