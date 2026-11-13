import { NextRequest } from "next/server";
import { dbConnection, Organization } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { PGPayService } from "@/lib/services/pgpay.service";
import {
  checkSubscriptionBinding,
  isVerificationCompleted,
} from "@/lib/services/pgpay-binding";

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Verify subscription payment status
 * Called by the frontend after payment redirect
 *
 * SECURITY (F-C2): this endpoint is intentionally reachable without a
 * staff session — it is polled by the buyer's browser on the public
 * payment success page, which is shared with storefront customers.
 * Safety therefore comes from confirmation binding, not session auth:
 * activation happens ONLY when the PGPay-verified token equals the
 * token stored on the organization's pending upgrade AND the verified
 * amount equals the server-derived amount stored with it. A token
 * that merely verifies as "completed" — for any other payment, any
 * other organization, or any other amount — activates nothing, and
 * payment metadata (organizationId, tier, months) is never trusted.
 */
export async function POST(req: NextRequest) {
  try {
    // Ensure database connection is established
    await dbConnection.connect();

    const body = await req.json();
    const { orderId, pgPayToken } = body as {
      orderId?: string;
      pgPayToken?: string;
    };

    // F-H5: type gates before any query — an object value such as
    // {"$ne": null} would otherwise flow into the pending-upgrade
    // $or lookup and match an arbitrary organization.
    if (orderId !== undefined && typeof orderId !== "string") {
      return createErrorResponse("Invalid orderId", 400);
    }

    if (pgPayToken !== undefined && typeof pgPayToken !== "string") {
      return createErrorResponse("Invalid pgPayToken", 400);
    }

    console.log("Verifying subscription payment:", {
      orderId,
      token: pgPayToken?.substring(0, 10) + "...",
    });

    if (!orderId && !pgPayToken) {
      return createErrorResponse("Order ID or pgPayToken is required", 400);
    }

    // Build flexible lookup: try orderId first, then token as fallback.
    // The organization is located ONLY from server-side records —
    // never from payment metadata supplied through PGPay.
    const orConditions: any[] = [];

    if (orderId) {
      orConditions.push(
        { "subscription.pendingUpgrade.orderId": orderId },
        { "subscription.lastPayment.orderId": orderId },
      );
    }

    if (pgPayToken) {
      orConditions.push({ "subscription.pendingUpgrade.token": pgPayToken });
    }

    const organization = orConditions.length
      ? await Organization.findOne({ $or: orConditions })
      : null;

    let verification: any | null = null;

    // If we have a PGPay token, verify with PGPay to get the
    // authoritative status.
    if (pgPayToken) {
      const pgPayUserId = process.env.PGPAY_USER_ID;
      const pgPayApiKey = process.env.PGPAY_API_KEY;
      const pgPayEnvironment =
        (process.env.PGPAY_ENVIRONMENT as "sandbox" | "production") ||
        "sandbox";

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

      try {
        verification = await pgPayService.verifyPayment({ pgPayToken });
      } catch (error: any) {
        console.error("PGPay verification failed:", error);
      }
    }

    if (!organization) {
      console.error("Organization not found for subscription payment", {
        orderId,
        hasToken: !!pgPayToken,
      });
      // Treat as pending rather than a hard 404 so the frontend
      // can continue polling while webhooks/processors catch up.
      return createSuccessResponse({
        success: true,
        status: "pending",
        message:
          "Subscription payment is being processed. Please wait a moment and refresh.",
        debug: verification
          ? {
              status: verification.status,
              paymentStatus: verification.paymentStatus,
            }
          : undefined,
      });
    }

    // Check if already processed
    if (
      organization.subscription?.lastPayment?.orderId === orderId &&
      organization.subscription?.lastPayment?.status === "completed"
    ) {
      console.log("Payment already processed successfully");
      return createSuccessResponse({
        success: true,
        status: "completed",
        tier: organization.subscriptionTier,
        currentPeriodEnd: organization.subscription.currentPeriodEnd,
        prepaidMonths: organization.subscription.prepaidMonths,
        message: "Subscription activated successfully",
      });
    }

    const pendingUpgrade = organization.subscription?.pendingUpgrade;

    // Activate ONLY on a bound confirmation: verified-completed AND
    // the presented token is this pending upgrade's token AND the
    // verified amount equals the stored upgrade amount. Tier and
    // months come from the server-side pending upgrade record only.
    if (verification && isVerificationCompleted(verification)) {
      const binding = checkSubscriptionBinding({
        organization,
        pgPayToken,
        orderId,
        verification,
      });

      if (!binding.ok) {
        console.warn("Subscription activation refused - binding failed", {
          organizationId: organization._id?.toString(),
          reason: binding.reason,
        });
        return createSuccessResponse({
          success: true,
          status: "pending",
          message:
            "Payment is being processed. Please wait a moment and refresh.",
        });
      }

      const months = (pendingUpgrade?.months as number | undefined) || 1;
      const daysToAdd = months * 30;
      const effectiveTier = pendingUpgrade?.tier || organization.subscriptionTier;
      const periodEnd = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

      const paymentRecord = {
        orderId: pendingUpgrade?.orderId || orderId || verification.orderId,
        tier: effectiveTier,
        amount: verification.amount,
        months,
        status: "completed" as const,
        paidAt: new Date(),
      };

      await Organization.findByIdAndUpdate(organization._id, {
        $set: {
          subscriptionTier: effectiveTier,
          "subscription.status": "active",
          "subscription.currentPeriodStart": new Date(),
          "subscription.currentPeriodEnd": periodEnd,
          "subscription.prepaidMonths": months,
          "subscription.lastPayment": paymentRecord,
        },
        $unset: { "subscription.pendingUpgrade": "" },
        $push: { "subscription.paymentHistory": paymentRecord },
      });

      console.log(
        "Subscription activated:",
        effectiveTier,
        "for",
        months,
        "months",
      );

      return createSuccessResponse({
        success: true,
        status: "completed",
        tier: effectiveTier,
        currentPeriodEnd: periodEnd,
        prepaidMonths: months,
        message: "Subscription activated successfully",
      });
    }

    // Payment not confirmed as completed (or not bound) yet.
    return createSuccessResponse({
      success: true,
      status: "pending",
      message: "Payment is being processed. Please wait...",
      debug: verification
        ? {
            status: verification.status,
            paymentStatus: verification.paymentStatus,
          }
        : undefined,
    });
  } catch (error: any) {
    console.error("Error verifying subscription payment:", error);
    return createErrorResponse(
      error.message || "Failed to verify subscription payment",
      500,
    );
  }
}
