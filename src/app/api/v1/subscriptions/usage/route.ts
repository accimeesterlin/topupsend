import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { Organization, Transaction, UserOrganization, dbConnection } from "@topupsend/db";
import {
  checkLimit,
  isApproachingLimit,
  SubscriptionTier,
} from "@/lib/pricing";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    // Ensure database connection is established
    await dbConnection.connect();

    const user = await requireAuth(req);

    // Get organization - bypass Mongoose cache for fresh data
    const organization = await Organization.findById(user.orgId).lean();
    if (!organization) {
      return createErrorResponse("Organization not found", 404);
    }

    const tier =
      (organization.subscriptionTier as SubscriptionTier) ||
      SubscriptionTier.STARTER;

    // Calculate current month's start
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    // Count transactions this month
    const transactionCount = await Transaction.countDocuments({
      orgId: organization._id?.toString(),
      createdAt: { $gte: monthStart, $lte: monthEnd },
    });

    // Count team members
    const teamMemberCount = await UserOrganization.countDocuments({
      orgId: organization._id,
      isActive: true,
    });

    // For organizations count, we'd need a parent-child relationship
    // For now, assume 1 organization per account
    const organizationCount = 1;

    // Check limits
    const transactionLimit = checkLimit(
      tier,
      "maxTransactionsPerMonth",
      transactionCount,
    );
    const teamMemberLimit = checkLimit(tier, "maxTeamMembers", teamMemberCount);
    const organizationLimit = checkLimit(
      tier,
      "maxOrganizations",
      organizationCount,
    );

    // Check if approaching limits (80% threshold)
    const approachingTransactionLimit = isApproachingLimit(
      tier,
      "maxTransactionsPerMonth",
      transactionCount,
    );
    const approachingTeamMemberLimit = isApproachingLimit(
      tier,
      "maxTeamMembers",
      teamMemberCount,
    );
    const approachingOrganizationLimit = isApproachingLimit(
      tier,
      "maxOrganizations",
      organizationCount,
    );

    // Calculate percentages
    const getPercentage = (current: number, limit: number | "unlimited") => {
      if (limit === "unlimited") return 0;
      return Math.min((current / limit) * 100, 100);
    };

    // Prepare warnings
    const warnings: string[] = [];
    if (approachingTransactionLimit) {
      warnings.push(
        "You're approaching your monthly transaction limit. Consider upgrading to avoid service interruption.",
      );
    }
    if (approachingTeamMemberLimit) {
      warnings.push("You're approaching your team member limit.");
    }
    if (approachingOrganizationLimit) {
      warnings.push("You're approaching your organization limit.");
    }

    // Calculate if upgrade is recommended
    const shouldUpgrade =
      approachingTransactionLimit ||
      approachingTeamMemberLimit ||
      approachingOrganizationLimit;

    const usageData = {
      period: {
        start: monthStart,
        end: monthEnd,
        daysRemaining: Math.ceil(
          (monthEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      },
      transactions: {
        current: transactionCount,
        limit: transactionLimit.limit,
        remaining: transactionLimit.remaining,
        percentage: getPercentage(transactionCount, transactionLimit.limit),
        allowed: transactionLimit.allowed,
        approaching: approachingTransactionLimit,
      },
      teamMembers: {
        current: teamMemberCount,
        limit: teamMemberLimit.limit,
        remaining: teamMemberLimit.remaining,
        percentage: getPercentage(teamMemberCount, teamMemberLimit.limit),
        allowed: teamMemberLimit.allowed,
        approaching: approachingTeamMemberLimit,
      },
      organizations: {
        current: organizationCount,
        limit: organizationLimit.limit,
        remaining: organizationLimit.remaining,
        percentage: getPercentage(organizationCount, organizationLimit.limit),
        allowed: organizationLimit.allowed,
        approaching: approachingOrganizationLimit,
      },
      warnings,
      shouldUpgrade,
    };

    // Update organization usage cache
    await Organization.findByIdAndUpdate(organization._id, {
      $set: {
        "usage.transactionsThisMonth": transactionCount,
        "usage.teamMembersUsed": teamMemberCount,
        "usage.organizationsUsed": organizationCount,
        "usage.lastTransactionReset": monthStart,
      },
    });

    return createSuccessResponse(usageData);
  } catch (error) {
    console.error("Error fetching usage:", error);
    return createErrorResponse("Internal server error", 500);
  }
}
