/**
 * POST /api/v1/payments/manual/[id]/void
 * Void a manual payment (immutable records are never deleted or edited;
 * voiding is the only reversal, and it requires a reason).
 *
 * Permission: VOID_MANUAL_PAYMENT (Admin only)
 */

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { dbConnection } from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import {
  createSuccessResponse,
  createErrorResponse,
} from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { voidManualPaymentSchema } from "@/lib/validations/manual-payment";
import { voidManualPayment } from "@/lib/services/manual-payment.service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;

    if (!hasPermission(session.roles, Permission.VOID_MANUAL_PAYMENT)) {
      throw ApiErrors.Forbidden(
        "You do not have permission to void manual payments",
      );
    }

    await dbConnection.connect();

    const body = await request.json();

    let input;
    try {
      input = voidManualPaymentSchema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`,
        );
        return createErrorResponse(
          `Validation failed: ${errors.join(", ")}`,
          400,
        );
      }
      throw error;
    }

    const manualPayment = await voidManualPayment({
      orgId: session.orgId,
      voidedBy: session.userId,
      manualPaymentId: id,
      reason: input.reason,
    });

    return createSuccessResponse({
      message: "Manual payment voided",
      manualPayment: {
        id: manualPayment._id?.toString(),
        status: manualPayment.status,
        voidedBy: manualPayment.voidedBy,
        voidedAt: manualPayment.voidedAt,
        voidReason: manualPayment.voidReason,
      },
    });
  } catch (error) {
    logger.error("Error voiding manual payment", { error });
    return handleApiError(error);
  }
}
