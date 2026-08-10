/**
 * Usage Tracking Service
 *
 * Tracks transaction completions against organization plan limits.
 * Updates both Organization.usage and Subscription.usageThisMonth counters.
 */

import { Organization, Subscription } from "@topupsend/db";
import {
  checkLimit,
  SubscriptionTier,
} from "@/lib/pricing";
import { logger } from "@/lib/logger";

export interface TrackTransactionCompletionParams {
  orgId: string;
  transactionAmount: number;
  transactionFeePercentage?: number;
}

export interface TransactionLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number | "unlimited";
  remaining: number | "unlimited";
}

/**
 * Atomically increment transaction usage counters on both Organization and Subscription.
 * This is fire-and-forget safe — failures are logged but never thrown.
 */
export async function trackTransactionCompletion(
  params: TrackTransactionCompletionParams,
): Promise<void> {
  const { orgId, transactionAmount } = params;

  try {
    const org = await Organization.findById(orgId).select(
      "usage.lastTransactionReset usage.transactionsThisMonth subscriptionTier transactionFeePercentage",
    );

    if (!org) {
      logger.warn("Usage tracking: Organization not found", { orgId });
      return;
    }

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastReset = org.usage?.lastTransactionReset;
    const needsReset = !lastReset || lastReset < currentMonthStart;

    // Atomic update on Organization
    if (needsReset) {
      await Organization.findByIdAndUpdate(orgId, {
        $set: {
          "usage.transactionsThisMonth": 1,
          "usage.lastTransactionReset": currentMonthStart,
        },
      });
    } else {
      await Organization.findByIdAndUpdate(orgId, {
        $inc: { "usage.transactionsThisMonth": 1 },
      });
    }

    logger.info("Usage tracking: Organization counter updated", {
      orgId,
      needsReset,
      newCount: needsReset ? 1 : (org.usage?.transactionsThisMonth || 0) + 1,
    });

    // Update Subscription model if it exists
    const feePercentage =
      params.transactionFeePercentage ?? org.transactionFeePercentage ?? 4.0;
    const transactionFee = (transactionAmount * feePercentage) / 100;

    const subscription = await Subscription.findOne({
      organizationId: orgId,
      status: "active",
    });

    if (subscription) {
      const subPeriodExpired =
        subscription.currentPeriodEnd && now >= subscription.currentPeriodEnd;

      if (subPeriodExpired) {
        await Subscription.findByIdAndUpdate(subscription._id, {
          $set: {
            "usageThisMonth.transactions": 1,
            "usageThisMonth.transactionFees": transactionFee,
            "usageThisMonth.totalRevenue": transactionAmount,
            "usageThisMonth.lastUpdated": now,
          },
        });
      } else {
        await Subscription.findByIdAndUpdate(subscription._id, {
          $inc: {
            "usageThisMonth.transactions": 1,
            "usageThisMonth.transactionFees": transactionFee,
            "usageThisMonth.totalRevenue": transactionAmount,
          },
          $set: {
            "usageThisMonth.lastUpdated": now,
          },
        });
      }

      logger.info("Usage tracking: Subscription usage updated", {
        orgId,
        subscriptionId: subscription._id?.toString(),
        transactionFee,
        transactionAmount,
      });
    }
  } catch (error) {
    // Never throw — usage tracking failure must not break the transaction
    logger.error("Usage tracking failed (non-blocking)", {
      orgId,
      transactionAmount,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Check if the organization has reached its monthly transaction limit.
 * Returns the limit status without modifying any data.
 */
export async function checkTransactionLimit(
  orgId: string,
): Promise<TransactionLimitCheckResult> {
  const org = await Organization.findById(orgId).select(
    "subscriptionTier usage.transactionsThisMonth usage.lastTransactionReset",
  );

  if (!org) {
    return { allowed: false, currentCount: 0, limit: 0, remaining: 0 };
  }

  const tier =
    (org.subscriptionTier as SubscriptionTier) || SubscriptionTier.STARTER;

  // Check if counter needs a monthly reset
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastReset = org.usage?.lastTransactionReset;
  const needsReset = !lastReset || lastReset < currentMonthStart;

  const currentCount = needsReset
    ? 0
    : org.usage?.transactionsThisMonth || 0;

  const result = checkLimit(tier, "maxTransactionsPerMonth", currentCount);

  return {
    allowed: result.allowed,
    currentCount,
    limit: result.limit,
    remaining: result.remaining,
  };
}
