import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { Organization, dbConnection } from "@topupsend/db";
import { getTierInfo, checkLimit, SubscriptionTier } from "@/lib/pricing";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    // Ensure database connection is established
    await dbConnection.connect();

    const user = await requireAuth(req);

    console.log("User session:", {
      userId: user.userId,
      email: user.email,
      orgId: user.orgId,
    });

    // Get organization - use lean() to bypass Mongoose caching and get fresh data
    const organization = await Organization.findById(user.orgId).lean();

    if (!organization) {
      console.error("Organization not found for orgId:", user.orgId);

      // Check if any organizations exist
      const orgCount = await Organization.countDocuments();
      console.log("Total organizations in database:", orgCount);

      return createErrorResponse(
        `Organization not found. User orgId: ${user.orgId}. Please contact support.`,
        404,
      );
    }

    // Determine effective tier
    const validTiers = Object.values(SubscriptionTier);

    let tier =
      (organization.subscriptionTier as SubscriptionTier) ||
      SubscriptionTier.STARTER;

    // If there's completed payment history with a valid tier, prefer the
    // most recent completed tier. This helps auto-heal cases where
    // subscriptionTier wasn't updated correctly but paymentHistory was.
    const history = organization.subscription?.paymentHistory || [];
    const lastCompleted = [...history]
      .reverse()
      .find(
        (entry) =>
          entry.status === "completed" &&
          validTiers.includes(entry.tier as SubscriptionTier),
      );

    if (lastCompleted) {
      const historyTier = lastCompleted.tier as SubscriptionTier;
      if (tier !== historyTier) {
        tier = historyTier;
        // Best-effort sync back to the database; ignore errors so
        // they don't break the response.
        try {
          await Organization.findByIdAndUpdate(organization._id, {
            subscriptionTier: historyTier,
          });
        } catch (syncError) {
          console.error(
            "Failed to sync subscriptionTier from payment history",
            syncError,
          );
        }
      }
    }
    const tierInfo = getTierInfo(tier);

    // Check if subscription is expired and auto-update status
    const currentPeriodEnd = organization.subscription?.currentPeriodEnd || new Date();
    const isExpired = currentPeriodEnd < new Date();

    if (isExpired && organization.subscription?.status === "active") {
      // Auto-update status to past_due when subscription expires
      try {
        await Organization.findByIdAndUpdate(organization._id, {
          "subscription.status": "past_due",
        });
        // Update local object for response
        if (organization.subscription) {
          organization.subscription.status = "past_due";
        }
      } catch (updateError) {
        console.error("Failed to update expired subscription status", updateError);
      }
    }

    // Calculate usage limits
    const transactionLimit = checkLimit(
      tier,
      "maxTransactionsPerMonth",
      organization.usage?.transactionsThisMonth || 0,
    );

    const teamMemberLimit = checkLimit(
      tier,
      "maxTeamMembers",
      organization.usage?.teamMembersUsed || 0,
    );

    const organizationLimit = checkLimit(
      tier,
      "maxOrganizations",
      organization.usage?.organizationsUsed || 0,
    );

    // Prepare response
    const subscriptionData = {
      tier,
      tierName: tierInfo.name,
      status: organization.subscription?.status || "active",
      monthlyFee: tierInfo.features.monthlyFee,
      transactionFeePercentage:
        organization.transactionFeePercentage ||
        tierInfo.features.transactionFeePercentage,
      currentPeriodStart:
        organization.subscription?.currentPeriodStart || new Date(),
      currentPeriodEnd:
        organization.subscription?.currentPeriodEnd ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      usage: {
        transactions: organization.usage?.transactionsThisMonth || 0,
        transactionLimit: transactionLimit.limit,
        transactionRemaining: transactionLimit.remaining,
        teamMembers: organization.usage?.teamMembersUsed || 1,
        teamMemberLimit: teamMemberLimit.limit,
        teamMemberRemaining: teamMemberLimit.remaining,
        organizations: organization.usage?.organizationsUsed || 1,
        organizationLimit: organizationLimit.limit,
        organizationRemaining: organizationLimit.remaining,
      },
      features: tierInfo.features,
      // Debug fields to help diagnose tier mismatches
      debug: {
        rawSubscriptionTier: organization.subscriptionTier,
        lastCompletedPaymentTier:
          (lastCompleted?.tier as SubscriptionTier) || null,
        paymentHistoryCount: history.length,
      },
    };

    const response = createSuccessResponse(subscriptionData);

    // Add cache control headers to prevent stale subscription data
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");

    return response;
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return createErrorResponse("Internal server error", 500);
  }
}
