import { NextRequest } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import {
  dbConnection,
  Transaction,
} from "@topupsend/db";
import { logger } from "@/lib/logger";

/**
 * POST /api/v1/payments/verify
 * Verify a payment and trigger the webhook flow manually
 * This is called from the success page to verify the payment
 */
export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const { orderId, pgPayToken } = body as {
      orderId?: string;
      pgPayToken?: string;
    };

    if (!orderId) {
      return createErrorResponse("Missing orderId", 400);
    }

    logger.info("Payment verification requested", { orderId });

    // Find transaction
    const transaction = await Transaction.findOne({ orderId });

    if (!transaction) {
      logger.error("Transaction not found", { orderId });
      return createErrorResponse("Transaction not found", 404);
    }

    // If already completed, return success
    if (transaction.status === "completed") {
      logger.info("Transaction already completed", { orderId });
      return createSuccessResponse({
        success: true,
        status: "completed",
        message: "Payment already processed",
        testMode: (transaction.metadata as any)?.testMode || false,
        transaction: {
          orderId: transaction.orderId,
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency,
        },
      });
    }

    // If pending, try to verify with PGPay
    if (
      transaction.status === "pending" ||
      transaction.status === "paid" ||
      transaction.status === "failed"
    ) {
      const token = pgPayToken || (transaction.metadata as any)?.pgpayToken;

      if (!token) {
        logger.error("Missing payment token", {
          orderId,
          hasProvidedToken: !!pgPayToken,
          hasStoredToken: !!(transaction.metadata as any)?.pgpayToken,
        });
        return createErrorResponse("Missing payment token", 400);
      }

      logger.info("Triggering payment verification", {
        orderId,
        hasToken: !!token,
        tokenPreview: token.substring(0, 20) + "...",
        transactionStatus: transaction.status,
      });

      // Call the webhook endpoint internally to process the payment
      const webhookUrl = `${request.nextUrl.origin}/api/v1/webhooks/pgpay`;

      try {
        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pgPayToken: token,
            orderId: orderId, // Pass orderId to help webhook find transaction
          }),
        });

        const webhookResult = await webhookResponse.json();

        logger.info("Webhook processing result", {
          orderId,
          httpStatus: webhookResponse.status,
          success: webhookResult.success,
          message: webhookResult.message,
          resultData: webhookResult.data,
        });

        // If webhook returned an error, log it
        if (!webhookResponse.ok) {
          logger.error("Webhook returned error", {
            orderId,
            status: webhookResponse.status,
            error: webhookResult,
          });

          // Refresh transaction to get latest status even if webhook failed
          const updatedTransaction = await Transaction.findOne({ orderId });

          if (!updatedTransaction) {
            return createErrorResponse(
              "Transaction lost during processing",
              500
            );
          }

          // Return current transaction status with webhook error info
          return createSuccessResponse({
            success: true, // Still return success so frontend can see the status
            status: updatedTransaction.status,
            message: `Payment verification in progress. Status: ${updatedTransaction.status}`,
            webhookError: webhookResult.detail || webhookResult.message,
            testMode: (updatedTransaction.metadata as any)?.testMode || false,
            transaction: {
              orderId: updatedTransaction.orderId,
              status: updatedTransaction.status,
              amount: updatedTransaction.amount,
              currency: updatedTransaction.currency,
              recipient: updatedTransaction.recipient,
            },
          });
        }

        // Refresh transaction data
        const updatedTransaction = await Transaction.findOne({ orderId });

        if (!updatedTransaction) {
          return createErrorResponse("Transaction lost during processing", 500);
        }

        return createSuccessResponse({
          success: true,
          status: updatedTransaction.status,
          message: webhookResult.message || "Payment verification completed",
          testMode: (updatedTransaction.metadata as any)?.testMode || false,
          transaction: {
            orderId: updatedTransaction.orderId,
            status: updatedTransaction.status,
            amount: updatedTransaction.amount,
            currency: updatedTransaction.currency,
            recipient: updatedTransaction.recipient,
          },
        });
      } catch (error) {
        logger.error("Failed to call webhook", {
          error: error instanceof Error ? error.message : "Unknown error",
          orderId,
        });

        return createErrorResponse("Failed to verify payment", 500);
      }
    }

    // Return current transaction status
    return createSuccessResponse({
      success: true,
      status: transaction.status,
      message: "Transaction status retrieved",
      testMode: (transaction.metadata as any)?.testMode || false,
      transaction: {
        orderId: transaction.orderId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
      },
    });
  } catch (error) {
    logger.error("Payment verification error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
}

/**
 * GET /api/v1/payments/verify?orderId=XXX
 * Check payment status without triggering verification
 */
export async function GET(request: NextRequest) {
  try {
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return createErrorResponse("Missing orderId", 400);
    }

    const transaction = await Transaction.findOne({ orderId });

    if (!transaction) {
      return createErrorResponse("Transaction not found", 404);
    }

    return createSuccessResponse({
      success: true,
      status: transaction.status,
      testMode: (transaction.metadata as any)?.testMode || false,
      transaction: {
        orderId: transaction.orderId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        recipient: transaction.recipient,
        createdAt: transaction.createdAt,
        timeline: transaction.timeline,
      },
    });
  } catch (error) {
    logger.error("Payment status check error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return createErrorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
}
