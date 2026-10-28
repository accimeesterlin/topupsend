import { NextRequest } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import {
  dbConnection,
  Transaction,
  PaymentProvider,
} from "@topupsend/db";
import { createPGPayService } from "@/lib/services/pgpay.service";
import { logger } from "@/lib/logger";
import { fulfillPaidTransaction } from "@/lib/services/fulfillment.service";
import { isManuallyPaidTransaction } from "@/lib/services/manual-payment.service";

/**
 * POST /api/v1/webhooks/pgpay
 * Handle PGPay payment webhook callbacks
 * Public endpoint - no auth required (PGPay calls this)
 */
export async function POST(request: NextRequest) {
  let webhookData: unknown;

  try {
    await dbConnection.connect();

    const data = await request.json();
    webhookData = data;

    logger.info("PGPay webhook received", {
      data: webhookData,
    });

    const { pgPayToken, orderId } = data as {
      pgPayToken?: string;
      orderId?: string;
    };

    if (!pgPayToken) {
      logger.error("PGPay webhook missing token", { webhookData });
      return createErrorResponse("Missing pgPayToken", 400);
    }

    // Find transaction by PGPay token or by orderId as fallback
    let transaction = await Transaction.findOne({
      "metadata.pgpayToken": pgPayToken,
    });

    // If not found by token, try by orderId (from PGPay or our system)
    if (!transaction && orderId) {
      logger.info("Transaction not found by token, trying orderId", {
        orderId,
        pgPayToken: pgPayToken.substring(0, 10) + "...",
      });

      // Try finding by our orderId or by PGPay's orderId in metadata
      transaction = await Transaction.findOne({
        $or: [{ orderId }, { "metadata.pgpayOrderId": orderId }],
      });
    }

    if (!transaction) {
      logger.error("Transaction not found for PGPay token or orderId", {
        pgPayToken: pgPayToken.substring(0, 10) + "...",
        orderId,
      });
      return createErrorResponse("Transaction not found", 404);
    }

    logger.info("Transaction found for webhook", {
      orderId: transaction.orderId,
      transactionId: transaction._id?.toString(),
      currentStatus: transaction.status,
    });

    // If already completed, skip processing (but allow retrying failed transactions)
    if (transaction.status === "completed") {
      logger.info("Transaction already completed", {
        orderId: transaction.orderId,
        status: transaction.status,
      });
      return createSuccessResponse({
        success: true,
        message: "Transaction already completed",
      });
    }

    // Double-fulfillment guard: an order paid manually (offline payment
    // recorded by staff) must never be fulfilled a second time, even if a
    // PGPay checkout for the same order later completes. The payments/verify
    // route delegates to this webhook, so it is covered by the same guard.
    if (isManuallyPaidTransaction(transaction)) {
      logger.warn(
        "PGPay webhook received for a manually paid transaction - skipping fulfillment",
        {
          orderId: transaction.orderId,
          status: transaction.status,
          manualPaymentId: transaction.paymentId,
        },
      );
      return createSuccessResponse({
        success: true,
        message: "Transaction already paid manually",
      });
    }

    // If failed, log that we're retrying
    if (transaction.status === "failed") {
      logger.info("Retrying failed transaction", {
        orderId: transaction.orderId,
        previousStatus: transaction.status,
      });
    }

    // Get payment provider to verify payment
    const paymentProvider = await PaymentProvider.findOne({
      orgId: transaction.orgId,
      provider: "pgpay",
      status: "active",
    }).select("+credentials.userId");

    if (!paymentProvider) {
      logger.error("PGPay payment provider not found", {
        orgId: transaction.orgId,
      });
      return createErrorResponse("Payment provider not configured", 500);
    }

    // Initialize PGPay service to verify payment
    const pgpay = createPGPayService({
      userId: paymentProvider.credentials.userId as string,
      environment: paymentProvider.environment,
    });

    logger.info("Verifying PGPay payment", {
      orderId: transaction.orderId,
      pgPayToken: pgPayToken.substring(0, 10) + "...",
    });

    // Verify payment with PGPay
    let verificationResult;
    try {
      verificationResult = await pgpay.verifyPayment({ pgPayToken });

      logger.info("PGPay verification result", {
        orderId: transaction.orderId,
        status: verificationResult.status,
        paymentStatus: verificationResult.paymentStatus,
        amount: verificationResult.amount,
        fullResponse: JSON.stringify(verificationResult), // Log full response to see all fields
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to verify PGPay payment", {
        error: errorMessage,
        orderId: transaction.orderId,
      });

      transaction.status = "failed";
      transaction.timeline.failedAt = new Date();
      transaction.metadata.failureReason =
        "Payment verification failed: " + errorMessage;
      await transaction.save();

      return createErrorResponse("Payment verification failed", 500);
    }

    // Check payment status
    // Log what we're checking against
    logger.info("Checking payment status", {
      orderId: transaction.orderId,
      expectedStatus: "completed",
      actualStatus: verificationResult.status,
      expectedPaymentStatus: "paid",
      actualPaymentStatus: verificationResult.paymentStatus,
      allKeys: Object.keys(verificationResult),
    });

    // Check if payment is completed (be flexible with status values)
    const isStatusCompleted =
      verificationResult.status?.toLowerCase() === "completed" ||
      verificationResult.status?.toLowerCase() === "success" ||
      verificationResult.status?.toLowerCase() === "succeeded";

    const isPaymentPaid =
      verificationResult.paymentStatus?.toLowerCase() === "paid" ||
      verificationResult.paymentStatus?.toLowerCase() === "success" ||
      verificationResult.paymentStatus?.toLowerCase() === "succeeded" ||
      verificationResult.paymentStatus?.toLowerCase() === "completed";

    if (!isStatusCompleted && !isPaymentPaid) {
      logger.warn("Payment not completed", {
        orderId: transaction.orderId,
        status: verificationResult.status,
        paymentStatus: verificationResult.paymentStatus,
        isStatusCompleted,
        isPaymentPaid,
      });

      // Update transaction but don't fail yet - payment might still be processing
      transaction.status = "pending";
      (transaction.metadata as Record<string, unknown>).lastWebhookCheck =
        new Date();
      await transaction.save();

      return createSuccessResponse({
        success: true,
        message: "Payment not yet completed",
      });
    }

    // Payment verified successfully - update transaction
    transaction.status = "paid";
    transaction.timeline.paidAt = new Date();
    (transaction.metadata as Record<string, unknown>).pgpayVerification =
      verificationResult;
    await transaction.save();

    logger.info("Payment verified successfully", {
      orderId: transaction.orderId,
      amount: verificationResult.amount,
    });

    // Fulfill the paid transaction (shared with manual payments)
    const fulfillment = await fulfillPaidTransaction({
      transaction,
      pgpayMetadata: verificationResult.metadata as
        | Record<string, unknown>
        | undefined,
      refundSource: "pgpay_webhook",
    });

    if (fulfillment.outcome === "configuration-error") {
      return createErrorResponse(fulfillment.errorMessage, 500);
    }

    if (fulfillment.outcome === "refund-error") {
      // Return generic customer-facing error (don't expose internal issues)
      return createErrorResponse(fulfillment.userMessage, 503);
    }

    logger.info("Webhook processing completed successfully", {
      orderId: transaction.orderId,
      status: transaction.status,
    });

    return createSuccessResponse({
      success: true,
      message: "Payment confirmed and top-up sent",
      data: {
        orderId: transaction.orderId,
        status: transaction.status,
      },
    });
  } catch (error) {
    logger.error("Webhook processing error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      webhookData,
    });

    return createErrorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
}
