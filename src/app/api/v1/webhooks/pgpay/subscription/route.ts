import { NextRequest } from "next/server";
import { dbConnection, Organization, WebhookLog } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { PGPayService } from "@/lib/services/pgpay.service";
import { SubscriptionTier } from "@/lib/pricing";
import {
  checkSubscriptionBinding,
  isVerificationCompleted,
  pgpayEventId,
} from "@/lib/services/pgpay-binding";
import { webhookLoggingService } from "@/lib/services/webhook-logging.service";

/**
 * PGPay Webhook Handler for Subscription Payments
 * Called by PGPay when a payment status changes
 *
 * SECURITY (F-C3): success is determined ONLY from the server-to-server
 * PGPay verification — the webhook body's `status` field is attacker-
 * controlled and is never consulted. Activation additionally requires
 * confirmation binding (F-C2/F-C4): the verified token must equal the
 * pending upgrade's stored token and the verified amount must equal
 * the stored upgrade amount.
 */
export async function POST(req: NextRequest) {
  try {
    // Ensure database connection is established for webhook processing
    await dbConnection.connect();

    const body = await req.json();
    const { pgPayToken, orderId } = body as {
      pgPayToken?: string;
      orderId?: string;
      // NOTE: body.status is deliberately not read — see header comment.
      [key: string]: unknown;
    };

    if (!pgPayToken) {
      return createErrorResponse("Missing pgPayToken", 400);
    }

    // F-H5: type gates before any query — object values would flow
    // into the pending-upgrade lookups as Mongo operators.
    if (typeof pgPayToken !== "string") {
      return createErrorResponse("Invalid pgPayToken", 400);
    }

    if (orderId !== undefined && typeof orderId !== "string") {
      return createErrorResponse("Invalid orderId", 400);
    }

    console.log("PGPay subscription webhook received:", {
      orderId,
      token: pgPayToken.substring(0, 10) + "...",
    });

    // Verify payment with PGPay
    const pgPayUserId = process.env.PGPAY_USER_ID;
    const pgPayApiKey = process.env.PGPAY_API_KEY;
    const pgPayEnvironment =
      (process.env.PGPAY_ENVIRONMENT as "sandbox" | "production") || "sandbox";

    if (!pgPayUserId && !pgPayApiKey) {
      console.error("PGPAY_USER_ID / PGPAY_API_KEY not configured");
      return createErrorResponse("Payment service not configured", 500);
    }

    const pgPayService = new PGPayService({
      userId: pgPayUserId,
      apiKey: pgPayApiKey,
      merchantId: process.env.PGPAY_MERCHANT_ID,
      environment: pgPayEnvironment,
    });

    const verification = await pgPayService.verifyPayment({ pgPayToken });

    // Find the organization whose pending upgrade this payment belongs
    // to — by its stored token first, then by its stored orderId.
    const organization =
      (await Organization.findOne({
        "subscription.pendingUpgrade.token": pgPayToken,
      })) ||
      (orderId
        ? await Organization.findOne({
            "subscription.pendingUpgrade.orderId": orderId,
          })
        : null);

    if (!organization) {
      console.error("Organization not found for subscription webhook", {
        orderId,
      });
      return createErrorResponse("Organization not found", 404);
    }

    const pendingUpgrade = organization.subscription?.pendingUpgrade;

    if (!pendingUpgrade) {
      return createErrorResponse("No pending upgrade found", 404);
    }

    // Webhook event log with a real event id (F-H12) + dedupe.
    const eventId = pgpayEventId(pgPayToken);
    const alreadyProcessed = await WebhookLog.findOne({
      source: "pgpay",
      eventId,
      status: "success",
    }).catch(() => null);
    if (alreadyProcessed) {
      return createSuccessResponse({
        message: "Webhook event already processed",
      });
    }
    const webhookLog = await webhookLoggingService
      .logIncoming({
        orgId: organization._id?.toString() as string,
        event: "subscription.webhook",
        source: "pgpay",
        eventId,
        payload: body,
      })
      .catch(() => null);
    const finishLog = async (ok: boolean, errorMessage?: string) => {
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

    // Success comes from the verified provider state ONLY.
    if (isVerificationCompleted(verification)) {
      // Confirmation binding BEFORE any activation.
      const binding = checkSubscriptionBinding({
        organization,
        pgPayToken,
        orderId,
        verification,
      });
      if (!binding.ok) {
        console.error(
          "Subscription webhook binding failed - refusing to activate",
          {
            organizationId: organization._id?.toString(),
            reason: binding.reason,
            verifiedAmount: verification.amount,
            expectedAmount: pendingUpgrade.amount,
          },
        );
        await finishLog(false, `Binding failed: ${binding.reason}`);
        return createErrorResponse(
          "Payment confirmation does not match the pending upgrade",
          400,
        );
      }

      const newTier = pendingUpgrade.tier as SubscriptionTier;
      const months = pendingUpgrade.months || 1;

      // Calculate subscription end date based on months paid
      const daysToAdd = months * 30;
      const periodEnd = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

      // Update organization subscription
      const paymentRecord = {
        orderId: pendingUpgrade.orderId || orderId,
        tier: newTier,
        amount: verification.amount,
        months,
        status: "completed" as const,
        paidAt: new Date(),
      };

      await Organization.findByIdAndUpdate(organization._id, {
        $set: {
          subscriptionTier: newTier,
          "subscription.status": "active",
          "subscription.currentPeriodStart": new Date(),
          "subscription.currentPeriodEnd": periodEnd,
          "subscription.prepaidMonths": months,
          "subscription.lastPayment": paymentRecord,
        },
        $unset: { "subscription.pendingUpgrade": "" },
        $push: { "subscription.paymentHistory": paymentRecord },
      });

      console.log("Subscription upgraded successfully:", {
        organizationId: organization._id,
        newTier,
        months,
        orderId,
      });

      await finishLog(true);
      return createSuccessResponse({
        message: "Subscription upgraded successfully",
        tier: newTier,
      });
    }

    // Payment failed or pending — record the verified status only.
    await Organization.findByIdAndUpdate(organization._id, {
      "subscription.pendingUpgrade.status": verification.status,
      "subscription.pendingUpgrade.lastChecked": new Date(),
    });

    await finishLog(true);
    return createSuccessResponse({
      message: "Payment status updated",
      status: verification.status,
    });
  } catch (error: any) {
    console.error("Error processing PGPay subscription webhook:", error);
    return createErrorResponse(
      error.message || "Failed to process webhook",
      500,
    );
  }
}
