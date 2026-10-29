import { NextRequest } from "next/server";
import { dbConnection, Organization } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { PGPayService } from "@/lib/services/pgpay.service";

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Verify subscription payment status
 * Called by the frontend after payment redirect
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

    console.log("Verifying subscription payment:", {
      orderId,
      token: pgPayToken?.substring(0, 10) + "...",
    });

    if (!orderId && !pgPayToken) {
      return createErrorResponse("Order ID or pgPayToken is required", 400);
    }

    // Build flexible lookup: try orderId first, then token as fallback
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

    let organization = orConditions.length
      ? await Organization.findOne({ $or: orConditions })
      : null;

    let verification: any | null = null;

    // If we have a PGPay token, verify with PGPay to get
    // authoritative status + metadata (including organizationId).
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

      // If we still don't have an organization, but PGPay metadata
      // contains organizationId, use that as a fallback lookup.
      if (!organization && verification?.metadata?.organizationId) {
        try {
          organization = await Organization.findById(
            verification.metadata.organizationId,
          );
        } catch (err) {
          console.error("Failed to load organization by metadata orgId", err);
        }
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

    // Check pending upgrade info (if any)
    const pendingUpgrade = organization.subscription?.pendingUpgrade;

    // If we have a verification result, determine if payment is completed
    // and activate the subscription immediately. This should take precedence
    // over local pending state to avoid being stuck in "pending" when
    // PGPay already marked the payment as completed.
    if (verification) {
      const status = String(verification.status || "").toLowerCase();
      const paymentStatus = String(
        verification.paymentStatus || "",
      ).toLowerCase();

      const isStatusCompleted =
        status === "completed" ||
        status === "success" ||
        status === "succeeded" ||
        status === "paid";

      const isPaymentPaid =
        paymentStatus === "paid" ||
        paymentStatus === "success" ||
        paymentStatus === "succeeded" ||
        paymentStatus === "completed";

      if (isStatusCompleted || isPaymentPaid) {
        const months =
          (pendingUpgrade?.months as number | undefined) ||
          (verification.metadata?.months as number | undefined) ||
          1;
        const daysToAdd = months * 30;

        const effectiveTier =
          pendingUpgrade?.tier ||
          verification.metadata?.tier ||
          organization.subscriptionTier;

        const paymentRecord = {
          orderId: orderId || verification.orderId,
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
            "subscription.currentPeriodEnd": new Date(
              Date.now() + daysToAdd * 24 * 60 * 60 * 1000,
            ),
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
          currentPeriodEnd: new Date(
            Date.now() + daysToAdd * 24 * 60 * 60 * 1000,
          ),
          prepaidMonths: months,
          message: "Subscription activated successfully",
        });
      }
    }

    // If we reach here, payment is not confirmed as completed yet.
    // Check whether we still have a matching pending upgrade; if not,
    // treat as pending so the frontend keeps polling.
    const matchesPendingUpgrade = pendingUpgrade
      ? pendingUpgrade.orderId === orderId ||
        (!!pgPayToken && pendingUpgrade.token === pgPayToken)
      : false;

    if (!pendingUpgrade || !matchesPendingUpgrade) {
      console.log(
        "No matching pending upgrade found yet; treating as pending",
        {
          orderId,
          hasPendingUpgrade: !!pendingUpgrade,
          matchesPendingUpgrade,
        },
      );

      return createSuccessResponse({
        success: true,
        status: "pending",
        message:
          "Payment is being processed. Please wait a moment and refresh.",
        debug: verification
          ? {
              status: verification.status,
              paymentStatus: verification.paymentStatus,
            }
          : undefined,
      });
    }

    // Still pending
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
