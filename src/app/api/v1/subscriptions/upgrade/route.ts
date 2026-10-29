import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { Organization, dbConnection } from "@topupsend/db";
import { getTierInfo, SubscriptionTier } from "@/lib/pricing";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { PGPayService } from "@/lib/services/pgpay.service";

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    // Ensure database connection is established
    await dbConnection.connect();

    const user = await requireAuth(req);
    const body = await req.json();
    const { tier, months = 1 } = body as {
      tier: SubscriptionTier;
      months?: number;
    };

    // Validate tier
    if (!tier || !Object.values(SubscriptionTier).includes(tier)) {
      return createErrorResponse("Invalid subscription tier", 400);
    }

    // Validate months (1, 3, 6, 12)
    const validMonths = [1, 3, 6, 12];
    if (!validMonths.includes(months)) {
      return createErrorResponse(
        "Invalid number of months. Choose 1, 3, 6, or 12",
        400,
      );
    }

    // Get organization - bypass Mongoose cache to ensure fresh data
    const organization = await Organization.findById(user.orgId).lean();
    if (!organization) {
      return createErrorResponse("Organization not found", 404);
    }

    // Check if subscription is expired
    const currentPeriodEnd = organization.subscription?.currentPeriodEnd || new Date();
    const isExpired = currentPeriodEnd < new Date();
    const isSameTier = organization.subscriptionTier === tier;

    // Get tier info
    const tierInfo = getTierInfo(tier);

    // Define tier order for upgrade/downgrade checking
    const currentTierOrder = {
      starter: 0,
      growth: 1,
      scale: 2,
      enterprise: 3,
    };
    const currentOrder =
      currentTierOrder[organization.subscriptionTier || "starter"];
    const newOrder = currentTierOrder[tier];

    // Allow renewals (same tier) ONLY if subscription is expired
    // Otherwise, prevent same-tier purchases and downgrades
    if (isSameTier && !isExpired) {
      return createErrorResponse(
        "You are already subscribed to this tier. Your subscription is active until " +
          new Date(currentPeriodEnd).toLocaleDateString(),
        400
      );
    }

    // Prevent downgrades (only allow same tier if expired, or upgrades)
    if (newOrder < currentOrder) {
      return createErrorResponse(
        "Downgrades are not supported. Please contact support for assistance.",
        400
      );
    }

    // Calculate total amount based on months
    const monthlyFee = tierInfo.features.monthlyFee;
    const totalAmount = monthlyFee * months;

    // Apply discount for longer commitments
    let discount = 0;
    if (months === 3) discount = 0.05; // 5% off
    if (months === 6) discount = 0.1; // 10% off
    if (months === 12) discount = 0.15; // 15% off

    const finalAmount = totalAmount * (1 - discount);
    const discountAmount = totalAmount - finalAmount;

    // Initialize PGPay service
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

    // Create payment request
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://prepaid.pgecom.com";
    const orderId = `sub-${organization._id}-${tier}-${months}m-${Date.now()}`;

    const paymentRequest = {
      amount: finalAmount,
      currency: "usd" as const,
      orderId,
      customerEmail: user.email,
      customerFirstName: organization.name.split(" ")[0] || "Customer",
      customerLastName:
        organization.name.split(" ").slice(1).join(" ") || "User",
      successUrl: `${baseUrl}/payment/success`,
      errorUrl: `${baseUrl}/payment/cancel`,
      description: `${tierInfo.name} Plan - ${months} Month${months > 1 ? "s" : ""} Prepaid${discount > 0 ? ` (${(discount * 100).toFixed(0)}% discount)` : ""}`,
      metadata: {
        organizationId: String(organization._id),
        userId: user.userId,
        tier,
        months,
        monthlyFee,
        discount: discountAmount,
        type: "subscription",
      },
      webhookUrl: `${baseUrl}/api/v1/webhooks/pgpay/subscription`,
    };

    // Create payment
    const paymentResponse = await pgPayService.createPayment(paymentRequest);

    // Store pending subscription upgrade in organization
    await Organization.findByIdAndUpdate(organization._id, {
      "subscription.pendingUpgrade": {
        tier,
        months,
        orderId,
        token: paymentResponse.token,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      },
    });

    return createSuccessResponse({
      orderId,
      token: paymentResponse.token,
      redirectUrl: paymentResponse.redirectUrl,
      amount: finalAmount,
      monthlyFee,
      months,
      discount: discountAmount,
      tier: tierInfo.name,
    });
  } catch (error: any) {
    console.error("Error creating subscription upgrade:", error);
    return createErrorResponse(
      error.message || "Failed to create upgrade payment",
      500,
    );
  }
}
