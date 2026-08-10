/**
 * Replay Webhook Endpoint
 * POST /api/v1/webhooks/logs/[id]/replay
 */

import { NextRequest } from "next/server";
import { ApiErrors } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { webhookLoggingService } from "@/lib/services/webhook-logging.service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  const { id } = await params;

  // Check permission
  if (!hasPermission(session.roles, Permission.REPLAY_WEBHOOKS)) {
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

  const result = await webhookLoggingService.replay(id);

  if (!result.success) {
    throw ApiErrors.BadRequest(result.error || "Failed to replay webhook");
  }

  return createSuccessResponse({
    message: "Webhook replay initiated successfully",
  });
}
