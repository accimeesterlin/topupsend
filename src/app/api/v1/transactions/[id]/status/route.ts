import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { Transaction, Customer } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { TransactionStatus, Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import {
  updateTransactionStatusSchema,
  validateStatusUpdate,
  isReasonRequired,
} from "@/lib/validations/transaction";
import { ZodError } from "zod";
import { trackTransactionCompletion } from "@/lib/services/usage-tracking.service";

/**
 * PATCH /api/v1/transactions/[id]/status
 * Update transaction status
 *
 * Permissions: UPDATE_TRANSACTION_STATUS (Admin, Operator)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    // Check permissions
    if (!hasPermission(session.roles, Permission.UPDATE_TRANSACTION_STATUS)) {
      logger.warn("Permission denied for transaction status update", {
        userId: session.userId,
        roles: session.roles,
        transactionId: id,
      });
      return createErrorResponse(
        "You do not have permission to update transaction status. Only Admin and Operator roles can perform this action.",
        403,
      );
    }

    await dbConnection.connect();

    const body = await request.json();

    // Validate input with Zod
    let validatedData;
    try {
      validatedData = updateTransactionStatusSchema.parse(body);
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

    const { status, reason } = validatedData;

    // Check if reason is required but missing
    if (isReasonRequired(status) && !reason) {
      return createErrorResponse(
        `A reason is required when setting status to ${status}`,
        400,
      );
    }

    logger.info("Updating transaction status", {
      orgId: session.orgId,
      userId: session.userId,
      transactionId: id,
      newStatus: status,
      hasReason: !!reason,
    });

    // Find transaction
    const transaction = await Transaction.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!transaction) {
      return createErrorResponse("Transaction not found", 404);
    }

    const oldStatus = transaction.status as TransactionStatus;

    // Validate status transition
    const transitionValidation = validateStatusUpdate(oldStatus, status);
    if (!transitionValidation.valid) {
      return createErrorResponse(transitionValidation.error!, 400);
    }

    // Update status
    transaction.status = status;

    // Update timeline based on new status
    const now = new Date();
    switch (status) {
      case TransactionStatus.PAID:
        if (!transaction.timeline.paidAt) {
          transaction.timeline.paidAt = now;
        }
        break;
      case TransactionStatus.PROCESSING:
        if (!transaction.timeline.processingAt) {
          transaction.timeline.processingAt = now;
        }
        break;
      case TransactionStatus.COMPLETED:
        if (!transaction.timeline.completedAt) {
          transaction.timeline.completedAt = now;
        }
        break;
      case TransactionStatus.FAILED:
        if (!transaction.timeline.failedAt) {
          transaction.timeline.failedAt = now;
        }
        if (reason) {
          transaction.metadata.failureReason = reason;
        }
        break;
      case TransactionStatus.REFUNDED:
        if (!transaction.timeline.refundedAt) {
          transaction.timeline.refundedAt = now;
        }
        if (reason) {
          // Store refund reason in metadata
          transaction.metadata.failureReason = reason;
        }
        break;
    }

    await transaction.save();

    // Track plan usage for completed transactions
    if (status === TransactionStatus.COMPLETED) {
      void trackTransactionCompletion({
        orgId: session.orgId,
        transactionAmount: transaction.amount,
      });
    }

    // Create or update customer if transaction is completed
    if (
      status === TransactionStatus.COMPLETED &&
      transaction.recipient?.phoneNumber
    ) {
      try {
        const existingCustomer = await Customer.findByOrgAndIdentifier(
          session.orgId,
          {
            phoneNumber: transaction.recipient.phoneNumber,
            email: transaction.recipient.email,
          },
        );

        if (!existingCustomer) {
          // Create new customer
          await Customer.create({
            orgId: session.orgId,
            phoneNumber: transaction.recipient.phoneNumber,
            email: transaction.recipient.email,
            name: transaction.recipient.name,
            country: transaction.operator?.country,
            metadata: {
              totalPurchases: 1,
              totalSpent: transaction.amount,
              currency: transaction.currency,
              lastPurchaseAt: now,
              acquisitionSource: "transaction",
            },
          });

          logger.info("Customer created from transaction", {
            orgId: session.orgId,
            phoneNumber: transaction.recipient.phoneNumber,
            transactionId: id,
          });
        } else {
          // Update existing customer metrics
          existingCustomer.metadata.totalPurchases =
            (existingCustomer.metadata.totalPurchases || 0) + 1;
          existingCustomer.metadata.totalSpent =
            (existingCustomer.metadata.totalSpent || 0) + transaction.amount;
          existingCustomer.metadata.lastPurchaseAt = now;

          // Backfill missing fields
          if (!existingCustomer.name && transaction.recipient.name) {
            existingCustomer.name = transaction.recipient.name;
          }
          if (!existingCustomer.email && transaction.recipient.email) {
            existingCustomer.email = transaction.recipient.email;
          }
          if (!existingCustomer.country && transaction.operator?.country) {
            existingCustomer.country = transaction.operator.country;
          }
          if (!existingCustomer.phoneNumber && transaction.recipient.phoneNumber) {
            existingCustomer.phoneNumber = transaction.recipient.phoneNumber;
          }

          await existingCustomer.save();

          logger.info("Customer updated from transaction", {
            orgId: session.orgId,
            phoneNumber: transaction.recipient.phoneNumber,
            transactionId: id,
          });
        }
      } catch (customerError) {
        // Log the error but don't fail the transaction status update
        logger.error("Error creating/updating customer from transaction", {
          error: customerError,
          transactionId: id,
          phoneNumber: transaction.recipient.phoneNumber,
        });
      }
    }

    logger.info("Transaction status updated successfully", {
      orgId: session.orgId,
      userId: session.userId,
      transactionId: id,
      orderId: transaction.orderId,
      oldStatus,
      newStatus: status,
    });

    return createSuccessResponse({
      success: true,
      message: "Transaction status updated successfully",
      transaction: {
        _id: transaction._id,
        orderId: transaction.orderId,
        status: transaction.status,
        timeline: transaction.timeline,
        metadata: transaction.metadata,
      },
    });
  } catch (error) {
    logger.error("Error updating transaction status", { error });
    return handleApiError(error);
  }
}
