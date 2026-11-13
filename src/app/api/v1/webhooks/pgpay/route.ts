import { NextRequest } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import {
  dbConnection,
  Transaction,
  PaymentProvider,
  WebhookLog,
} from "@topupsend/db";
import { createPGPayService } from "@/lib/services/pgpay.service";
import { logger } from "@/lib/logger";
import { fulfillPaidTransaction } from "@/lib/services/fulfillment.service";
import { isManuallyPaidTransaction } from "@/lib/services/manual-payment.service";
import {
  checkTransactionBinding,
  isVerificationCompleted,
  pgpayEventId,
} from "@/lib/services/pgpay-binding";
import { webhookLoggingService } from "@/lib/services/webhook-logging.service";

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

    // Webhook event log with a real event id (F-H12): the same PGPay
    // payment always produces the same event id, so a delivery that was
    // already processed successfully is acknowledged without re-running.
    const eventId = pgpayEventId(pgPayToken);
    const alreadyProcessed = await WebhookLog.findOne({
      source: "pgpay",
      eventId,
      status: "success",
    }).catch(() => null);
    if (alreadyProcessed) {
      logger.info("Duplicate PGPay webhook delivery - already processed", {
        orderId: transaction.orderId,
        eventId,
      });
      return createSuccessResponse({
        success: true,
        message: "Webhook event already processed",
      });
    }

    const webhookLog = await webhookLoggingService
      .logIncoming({
        orgId: transaction.orgId,
        event: "payment.webhook",
        source: "pgpay",
        eventId,
        payload: webhookData,
        transactionId: transaction._id?.toString(),
      })
      .catch((error) => {
        logger.warn("Failed to write PGPay webhook log", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return null;
      });
    const finishLog = async (
      ok: boolean,
      errorMessage?: string,
    ): Promise<void> => {
      if (!webhookLog?._id) return;
      try {
        if (ok) {
          await webhookLoggingService.markSuccess(webhookLog._id.toString());
        } else {
          await webhookLoggingService.markFailed(
            webhookLog._id.toString(),
            errorMessage || "Webhook processing failed",
          );
        }
      } catch {
        // Logging must never break webhook processing.
      }
    };

    // If already completed, skip processing (but allow retrying failed transactions)
    if (transaction.status === "completed") {
      logger.info("Transaction already completed", {
        orderId: transaction.orderId,
        status: transaction.status,
      });
      await finishLog(true);
      return createSuccessResponse({
        success: true,
        message: "Transaction already completed",
      });
    }

    // A refunded order must NEVER be fulfilled (F-C7/F-C8): a replayed
    // or late webhook for a refunded order is acknowledged and dropped.
    if (transaction.status === "refunded") {
      logger.warn(
        "PGPay webhook received for a refunded transaction - fulfillment refused",
        { orderId: transaction.orderId },
      );
      await finishLog(true);
      return createSuccessResponse({
        success: true,
        message: "Transaction was refunded; fulfillment refused",
      });
    }

    // Fulfillment already claimed this order (by an earlier delivery or
    // the reconciliation sweep): never reset it back to "paid".
    if (transaction.status === "processing") {
      logger.info(
        "PGPay webhook received while fulfillment is in progress - skipping",
        { orderId: transaction.orderId },
      );
      await finishLog(true);
      return createSuccessResponse({
        success: true,
        message: "Fulfillment already in progress",
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
    }).select("+credentials.userId +credentials.apiKey +credentials.merchantId");

    if (!paymentProvider) {
      logger.error("PGPay payment provider not found", {
        orgId: transaction.orgId,
      });
      return createErrorResponse("Payment provider not configured", 500);
    }

    // Initialize PGPay service to verify payment (v2 org-key contract
    // when the provider carries an API key, else v1)
    const pgpay = createPGPayService({
      userId: paymentProvider.credentials.userId as string,
      merchantId: paymentProvider.credentials.merchantId as string,
      apiKey: paymentProvider.credentials.apiKey as string,
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

      // A verification TRANSPORT failure proves nothing about the
      // payment (F-C6): do not fail the order. Record the failure and
      // leave the status for PGPay's retry and the reconciliation
      // sweep, which re-verifies pending orders.
      transaction.metadata.failureReason =
        "Payment verification failed: " + errorMessage;
      (transaction.metadata as Record<string, unknown>).lastVerificationError =
        errorMessage;
      await transaction.save();
      await finishLog(false, "Payment verification failed: " + errorMessage);

      return createErrorResponse("Payment verification failed", 500);
    }

    // Check payment status — from the server-to-server verification
    // response only, never from the webhook body.
    logger.info("Checking payment status", {
      orderId: transaction.orderId,
      expectedStatus: "completed",
      actualStatus: verificationResult.status,
      expectedPaymentStatus: "paid",
      actualPaymentStatus: verificationResult.paymentStatus,
      allKeys: Object.keys(verificationResult),
    });

    if (!isVerificationCompleted(verificationResult)) {
      logger.warn("Payment not completed", {
        orderId: transaction.orderId,
        status: verificationResult.status,
        paymentStatus: verificationResult.paymentStatus,
      });

      // Payment might still be processing — keep the order pending for
      // PGPay's next delivery and the reconciliation sweep. Never
      // downgrade an already-paid order here.
      if (transaction.status !== "paid") {
        transaction.status = "pending";
      }
      (transaction.metadata as Record<string, unknown>).lastWebhookCheck =
        new Date();
      await transaction.save();
      await finishLog(true);

      return createSuccessResponse({
        success: true,
        message: "Payment not yet completed",
      });
    }

    // Confirmation binding (F-C4): the verified payment must be THIS
    // order's payment — the presented token must equal the token stored
    // on the transaction and the verified amount must equal the order
    // amount. Anything else changes no state.
    const binding = checkTransactionBinding({
      transaction,
      pgPayToken,
      verification: verificationResult,
    });
    if (!binding.ok) {
      logger.error("PGPay confirmation binding failed - refusing to fulfill", {
        orderId: transaction.orderId,
        reason: binding.reason,
        verifiedAmount: verificationResult.amount,
        orderAmount: transaction.amount,
      });
      await finishLog(false, `Binding failed: ${binding.reason}`);
      return createErrorResponse(
        "Payment confirmation does not match this order",
        400,
      );
    }

    // Payment verified successfully - update transaction
    if (transaction.status !== "paid") {
      transaction.status = "paid";
      transaction.timeline.paidAt = new Date();
    }
    if (!transaction.paymentId && verificationResult.orderId) {
      transaction.paymentId = verificationResult.orderId;
    }
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
      await finishLog(false, fulfillment.errorMessage);
      return createErrorResponse(fulfillment.errorMessage, 500);
    }

    if (fulfillment.outcome === "refund-error") {
      await finishLog(true);
      // Return generic customer-facing error (don't expose internal issues)
      return createErrorResponse(fulfillment.userMessage, 503);
    }

    await finishLog(true);

    if (fulfillment.outcome === "skipped") {
      // Another caller owns (or already finished) this fulfillment;
      // the payment itself is confirmed, so acknowledge the webhook.
      return createSuccessResponse({
        success: true,
        message: "Payment confirmed; fulfillment already handled",
        data: {
          orderId: transaction.orderId,
          status: transaction.status,
        },
      });
    }

    if (fulfillment.outcome === "pending-verification") {
      // The provider's answer is not final yet; the reconciliation
      // sweep settles the order. Still a successful webhook.
      return createSuccessResponse({
        success: true,
        message: "Payment confirmed; top-up delivery pending verification",
        data: {
          orderId: transaction.orderId,
          status: transaction.status,
        },
      });
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
