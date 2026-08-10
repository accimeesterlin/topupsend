/**
 * Single Webhook Log Endpoints
 * GET /api/v1/webhooks/logs/[id] - Get webhook log details
 * POST /api/v1/webhooks/logs/[id]/replay - Replay webhook
 */

import { NextRequest } from "next/server";
import { ApiErrors } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { webhookLoggingService } from "@/lib/services/webhook-logging.service";

/**
 * GET - Get webhook log details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  const { id } = await params;

  // Check permission
  if (!hasPermission(session.roles, Permission.VIEW_WEBHOOK_LOGS)) {
    throw ApiErrors.Forbidden("Insufficient permissions");
  }

  const log = await webhookLoggingService.getLogById(id);

  if (!log) {
    throw ApiErrors.NotFound("Webhook log not found");
  }

  // Verify belongs to user's org
  if (log.orgId !== session.orgId) {
    throw ApiErrors.Forbidden("Access denied");
  }

  return createSuccessResponse({
    log: {
      id: String(log._id),
      event: log.event,
      source: log.source,
      status: log.status,
      payload: log.payload,
      headers: log.headers,
      signature: log.signature,
      ipAddress: log.ipAddress,
      responseCode: log.responseCode,
      responseBody: log.responseBody,
      errorMessage: log.errorMessage,
      attempts: log.attempts,
      maxAttempts: log.maxAttempts,
      nextRetryAt: log.nextRetryAt,
      lastAttemptAt: log.lastAttemptAt,
      processedAt: log.processedAt,
      processingDuration: log.processingDuration,
      transactionId: log.transactionId,
      customerId: log.customerId,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    },
  });
}
