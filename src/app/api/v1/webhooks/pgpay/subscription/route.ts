import { NextRequest } from "next/server";
import { dbConnection, Organization } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { PGPayService } from "@/lib/services/pgpay.service";
import { SubscriptionTier } from "@/lib/pricing";

/**
 * PGPay Webhook Handler for Subscription Payments
 * Called by PGPay when a payment status changes
 */
export async function POST(req: NextRequest) {
  try {
    // Ensure database connection is established for webhook processing
    await dbConnection.connect();

    const body = await req.json();
    const { pgPayToken, status, orderId } = body;

    console.log("PGPay subscription webhook received:", {
      orderId,
      status,
      token: pgPayToken?.substring(0, 10) + "...",
    });

    // Verify payment with PGPay
    const pgPayUserId = process.env.PGPAY_USER_ID;
    const pgPayEnvironment =
      (process.env.PGPAY_ENVIRONMENT as "sandbox" | "production") || "sandbox";

    if (!pgPayUserId) {
      console.error("PGPAY_USER_ID not configured");
      return createErrorResponse("Payment service not configured", 500);
    }

    const pgPayService = new PGPayService({
      userId: pgPayUserId,
      environment: pgPayEnvironment,
    });

    const verification = await pgPayService.verifyPayment({ pgPayToken });

    // Find organization with pending upgrade
    const organization = await Organization.findOne({
      "subscription.pendingUpgrade.orderId": orderId,
    });

    if (!organization) {
      console.error("Organization not found for orderId:", orderId);
      return createErrorResponse("Organization not found", 404);
    }

    const pendingUpgrade = organization.subscription?.pendingUpgrade;

    if (!pendingUpgrade) {
      return createErrorResponse("No pending upgrade found", 404);
    }

    // Check if payment is successful (be flexible with status values)
    const statusValue = String(verification.status || "").toLowerCase();
    const paymentStatusValue = String(
      verification.paymentStatus || "",
    ).toLowerCase();

    const isStatusCompleted =
      statusValue === "completed" ||
      statusValue === "success" ||
      statusValue === "succeeded" ||
      statusValue === "paid";

    const isPaymentPaid =
      paymentStatusValue === "paid" ||
      paymentStatusValue === "success" ||
      paymentStatusValue === "succeeded" ||
      paymentStatusValue === "completed";

    if (isStatusCompleted || isPaymentPaid || status === "completed") {
      const newTier = pendingUpgrade.tier as SubscriptionTier;
      const months = pendingUpgrade.months || 1;

      // Calculate subscription end date based on months paid
      const daysToAdd = months * 30;

      // Update organization subscription
      const paymentRecord = {
        orderId,
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
          "subscription.currentPeriodEnd": new Date(
            Date.now() + daysToAdd * 24 * 60 * 60 * 1000,
          ),
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

      return createSuccessResponse({
        message: "Subscription upgraded successfully",
        tier: newTier,
      });
    } else {
      // Payment failed or pending
      await Organization.findByIdAndUpdate(organization._id, {
        "subscription.pendingUpgrade.status": verification.status,
        "subscription.pendingUpgrade.lastChecked": new Date(),
      });

      return createSuccessResponse({
        message: "Payment status updated",
        status: verification.status,
      });
    }
  } catch (error: any) {
    console.error("Error processing PGPay subscription webhook:", error);
    return createErrorResponse(
      error.message || "Failed to process webhook",
      500,
    );
  }
}
