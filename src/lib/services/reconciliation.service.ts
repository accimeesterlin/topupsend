/**
 * Reconciliation sweep (Cluster 1d — F-C6).
 *
 * Fulfillment must not depend on the buyer's browser reaching a
 * success page or on a single webhook delivery. This sweep, driven by
 * Vercel Cron, closes the loop for every order state that can strand:
 *
 *  1. `pending` PGPay orders are re-verified server-to-server with the
 *     organization's own PGPay credentials. A verified, bound,
 *     completed payment moves the order to `paid` and fulfills it.
 *     Orders whose payment failed at PGPay — or that sit unverified
 *     for over 24 hours — expire as `failed` (abandoned checkout).
 *  2. `paid` orders that were never fulfilled (crashed webhook,
 *     browser closed mid-flow) are resumed into fulfillment. The
 *     atomic claim inside fulfillment makes this safe to race.
 *  3. `processing` orders stuck with an unknown transfer outcome are
 *     settled by polling DingConnect for the transfer's real status.
 *
 * Every step is idempotent, so overlapping or repeated runs are safe.
 */

import { PaymentProvider, Transaction } from "@topupsend/db";
import { createPGPayService } from "@/lib/services/pgpay.service";
import {
  checkTransactionBinding,
  isVerificationCompleted,
} from "@/lib/services/pgpay-binding";
import {
  fulfillPaidTransaction,
  settleStuckTransfer,
} from "@/lib/services/fulfillment.service";
import { logger } from "@/lib/logger";

const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
const STUCK_PROCESSING_AFTER_MS = 10 * 60 * 1000;
const BATCH_SIZE = 50;

export interface ReconciliationSummary {
  pendingChecked: number;
  newlyPaid: number;
  expired: number;
  paidResumed: number;
  settledCompleted: number;
  settledRefunded: number;
  stillProcessing: number;
  skipped: number;
  errors: number;
}

export async function runReconciliationSweep(
  now: Date = new Date(),
): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    pendingChecked: 0,
    newlyPaid: 0,
    expired: 0,
    paidResumed: 0,
    settledCompleted: 0,
    settledRefunded: 0,
    stillProcessing: 0,
    skipped: 0,
    errors: 0,
  };

  // --- 1. Re-verify pending PGPay orders -----------------------------
  const pendingOrders = await Transaction.find({
    status: "pending",
    paymentGateway: "pgpay",
    "metadata.pgpayToken": { $type: "string" },
  })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE);

  for (const transaction of pendingOrders) {
    summary.pendingChecked++;
    try {
      const paymentProvider = await PaymentProvider.findOne({
        orgId: transaction.orgId,
        provider: "pgpay",
        status: "active",
      }).select("+credentials.userId +credentials.apiKey +credentials.merchantId");

      if (!paymentProvider) {
        summary.skipped++;
        continue;
      }

      const pgpay = createPGPayService({
        userId: paymentProvider.credentials.userId as string,
        merchantId: paymentProvider.credentials.merchantId as string,
        apiKey: paymentProvider.credentials.apiKey as string,
        environment: paymentProvider.environment,
      });

      const pgPayToken = transaction.metadata.pgpayToken as string;

      let verification;
      try {
        verification = await pgpay.verifyPayment({ pgPayToken });
      } catch (error) {
        // Transport failure proves nothing; leave for the next sweep.
        summary.errors++;
        logger.warn("Reconciliation: PGPay verification failed", {
          orderId: transaction.orderId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        continue;
      }

      if (isVerificationCompleted(verification)) {
        const binding = checkTransactionBinding({
          transaction,
          pgPayToken,
          verification,
        });
        if (!binding.ok) {
          logger.error("Reconciliation: binding failed for pending order", {
            orderId: transaction.orderId,
            reason: binding.reason,
          });
          (transaction.metadata as Record<string, unknown>).bindingFailure =
            binding.reason;
          await transaction.save();
          summary.skipped++;
          continue;
        }

        transaction.status = "paid";
        transaction.timeline.paidAt = new Date();
        (transaction.metadata as Record<string, unknown>).pgpayVerification =
          verification;
        if (!transaction.paymentId && verification.orderId) {
          transaction.paymentId = verification.orderId;
        }
        await transaction.save();
        summary.newlyPaid++;

        const result = await fulfillPaidTransaction({
          transaction,
          pgpayMetadata: verification.metadata as
            | Record<string, unknown>
            | undefined,
          refundSource: "reconciliation_sweep",
        });
        if (result.outcome === "fulfilled") {
          summary.paidResumed++;
        }
        continue;
      }

      // Not completed: expire orders PGPay reports dead, and checkouts
      // abandoned for more than 24 hours.
      const verifiedStatus = String(verification.status || "").toLowerCase();
      const providerDead = [
        "failed",
        "cancelled",
        "canceled",
        "expired",
        "refunded",
      ].includes(verifiedStatus);
      const createdAt =
        transaction.timeline?.createdAt || transaction.createdAt;
      const ageMs = createdAt
        ? now.getTime() - new Date(createdAt).getTime()
        : 0;

      if (providerDead || ageMs > ABANDON_AFTER_MS) {
        transaction.status = "failed";
        transaction.timeline.failedAt = new Date();
        transaction.metadata.failureReason = providerDead
          ? `Payment ${verifiedStatus} at PGPay (confirmed by reconciliation)`
          : "Abandoned checkout - no completed payment within 24 hours";
        await transaction.save();
        summary.expired++;
      }
    } catch (error) {
      summary.errors++;
      logger.error("Reconciliation: error processing pending order", {
        orderId: transaction.orderId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // --- 2. Resume paid-but-unfulfilled orders --------------------------
  const paidOrders = await Transaction.find({ status: "paid" })
    .sort({ "timeline.paidAt": 1 })
    .limit(BATCH_SIZE);

  for (const transaction of paidOrders) {
    try {
      const result = await fulfillPaidTransaction({
        transaction,
        refundSource: "reconciliation_sweep",
      });
      if (result.outcome === "fulfilled") {
        summary.paidResumed++;
      } else if (result.outcome === "pending-verification") {
        summary.stillProcessing++;
      } else if (result.outcome === "skipped") {
        summary.skipped++;
      }
    } catch (error) {
      summary.errors++;
      logger.error("Reconciliation: error resuming paid order", {
        orderId: transaction.orderId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // --- 3. Settle stuck processing transfers ---------------------------
  const stuckTransfers = await Transaction.find({
    status: "processing",
    providerTransactionId: { $type: "string" },
    "timeline.processingAt": {
      $lt: new Date(now.getTime() - STUCK_PROCESSING_AFTER_MS),
    },
  })
    .sort({ "timeline.processingAt": 1 })
    .limit(BATCH_SIZE);

  for (const transaction of stuckTransfers) {
    try {
      const result = await settleStuckTransfer(transaction);
      if (result === "completed") summary.settledCompleted++;
      else if (result === "refunded") summary.settledRefunded++;
      else if (result === "unknown") summary.stillProcessing++;
      else summary.skipped++;
    } catch (error) {
      summary.errors++;
      logger.error("Reconciliation: error settling stuck transfer", {
        orderId: transaction.orderId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  logger.info("Reconciliation sweep finished", { ...summary });
  return summary;
}
