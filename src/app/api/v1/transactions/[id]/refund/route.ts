import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { Transaction } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { processRefund } from "@/lib/services/refund.service";

/** Statuses that can be manually refunded */
const REFUNDABLE_STATUSES = ["failed", "completed", "paid"];

/**
 * POST /api/v1/transactions/[id]/refund
 * Manually refund a transaction — credits customer balance and sends email notification.
 *
 * Permissions: REFUND_TRANSACTIONS (Admin, Operator)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    if (!hasPermission(session.roles, Permission.REFUND_TRANSACTIONS)) {
      logger.warn("Permission denied for transaction refund", {
        userId: session.userId,
        roles: session.roles,
        transactionId: id,
      });
      return createErrorResponse(
        "You do not have permission to refund transactions.",
        403,
      );
    }

    await dbConnection.connect();

    // Parse optional reason from body
    let reason = "Manual refund by admin";
    try {
      const body = await request.json();
      if (body.reason && typeof body.reason === "string") {
        reason = body.reason.trim().slice(0, 500);
      }
    } catch {
      // Body is optional — default reason is fine
    }

    // Find transaction scoped to org
    const transaction = await Transaction.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!transaction) {
      return createErrorResponse("Transaction not found", 404);
    }

    // Already refunded
    if (
      transaction.status === "refunded" &&
      transaction.timeline.refundedAt
    ) {
      return createErrorResponse(
        "Transaction has already been refunded.",
        409,
      );
    }

    // Validate refundable status
    if (!REFUNDABLE_STATUSES.includes(transaction.status)) {
      return createErrorResponse(
        `Transaction cannot be refunded — current status is "${transaction.status}". Only failed, completed, or paid transactions can be refunded.`,
        400,
      );
    }

    logger.info("Processing manual refund", {
      orgId: session.orgId,
      userId: session.userId,
      transactionId: id,
      orderId: transaction.orderId,
      currentStatus: transaction.status,
      amount: transaction.amount,
      reason,
    });

    const result = await processRefund({
      transaction,
      failureReason: reason,
      additionalMetadata: {
        refundSource: "admin_manual",
        refundedBy: session.userId,
        refundedAt: new Date().toISOString(),
      },
    });

    if (!result.success) {
      return createErrorResponse(
        result.error || "Failed to process refund",
        500,
      );
    }

    logger.info("Manual refund completed", {
      orgId: session.orgId,
      userId: session.userId,
      transactionId: id,
      orderId: transaction.orderId,
      balanceRefunded: result.balanceRefunded,
      customerId: result.customerId,
    });

    return createSuccessResponse({
      success: true,
      message: result.balanceRefunded
        ? "Transaction refunded successfully. Customer balance has been credited."
        : "Transaction marked as refunded. Customer balance could not be credited (no customer record found).",
      transaction: {
        _id: transaction._id,
        orderId: transaction.orderId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        timeline: transaction.timeline,
      },
      refund: {
        balanceRefunded: result.balanceRefunded,
        customerId: result.customerId,
        reason,
      },
    });
  } catch (error) {
    logger.error("Error processing manual refund", { error });
    return handleApiError(error);
  }
}
