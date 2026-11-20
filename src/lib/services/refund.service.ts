/**
 * Refund Service
 *
 * Handles refunding customers when DingConnect top-up fails after payment.
 * Used by customer-transactions, PGPay webhook, and retry routes.
 */

import {
  Customer,
  CustomerBalanceHistory,
  Organization,
  Transaction,
  type ICustomer,
  type ITransaction,
} from "@topupsend/db";
import { logger } from "@/lib/logger";
import { EmailService } from "@/lib/services/email.service";

/** Parameters for processing a refund */
export interface ProcessRefundParams {
  /** The transaction to refund */
  transaction: ITransaction;
  /** The reason the top-up failed */
  failureReason: string;
  /** The amount to refund (defaults to transaction.amount) */
  refundAmount?: number;
  /** Additional metadata to attach to the refund record */
  additionalMetadata?: Record<string, unknown>;
}

/** Result of a refund operation */
export interface ProcessRefundResult {
  success: boolean;
  /** Whether the customer balance was refunded */
  balanceRefunded: boolean;
  /** The customer ID (found or created) */
  customerId?: string;
  /** Error message if refund failed */
  error?: string;
}

/**
 * Process a refund for a failed DingConnect transaction.
 *
 * Handles both payment types:
 * - "balance": Refunds to the customer's existing balance via refundBalance()
 * - "gateway"/"admin_assigned": Credits the payment amount to the customer's balance
 *
 * In all cases:
 * - Creates a CustomerBalanceHistory record with type "refund"
 * - Updates transaction status to "refunded"
 * - Sets timeline.refundedAt
 * - Preserves the failureReason in metadata
 */
export async function processRefund(
  params: ProcessRefundParams,
): Promise<ProcessRefundResult> {
  const { transaction, failureReason, additionalMetadata } = params;
  const refundAmount = params.refundAmount ?? transaction.amount;
  const orderId = transaction.orderId;

  // Guard: if transaction is already refunded, skip balance refund
  if (transaction.status === "refunded" && transaction.timeline.refundedAt) {
    logger.info("Transaction already refunded - skipping balance refund", {
      orderId,
      refundedAt: transaction.timeline.refundedAt,
    });

    // Still update failure reason if changed
    transaction.metadata.failureReason = failureReason;
    if (additionalMetadata) {
      Object.assign(transaction.metadata, additionalMetadata);
    }
    await transaction.save();

    return {
      success: true,
      balanceRefunded: false,
      customerId: transaction.customerId || undefined,
    };
  }

  // Atomic claim (Cluster 1f): exactly one caller may move a transaction
  // into "refunded". A concurrent or repeated refund attempt loses the
  // claim and is treated as already-refunded, so the balance credit can
  // never be issued twice for the same order.
  const claimed = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: { $ne: "refunded" } },
    {
      $set: {
        status: "refunded",
        "timeline.refundedAt": new Date(),
      },
    },
    { new: true },
  );

  if (!claimed) {
    logger.info(
      "Transaction already refunded (atomic claim lost) - skipping balance refund",
      { orderId },
    );
    transaction.status = "refunded";
    return {
      success: true,
      balanceRefunded: false,
      customerId: transaction.customerId || undefined,
    };
  }

  // Keep the caller's in-memory document in sync with the claim.
  transaction.status = "refunded";
  transaction.timeline.refundedAt = claimed.timeline.refundedAt;

  logger.info("Processing refund for failed transaction", {
    orderId,
    transactionId: transaction._id?.toString(),
    paymentType: transaction.paymentType,
    refundAmount,
    failureReason,
  });

  // Tracks whether the balance credit landed, so a late failure cannot
  // downgrade the transaction out of "refunded" and open a second
  // refund (Cluster 1f).
  let creditLanded = false;

  try {
    // Step 1: Find or create the customer record
    let customer: ICustomer | null = null;

    if (transaction.customerId) {
      customer = await Customer.findById(transaction.customerId);
    }

    // If no customerId on transaction, look up by phone/email
    if (!customer && transaction.recipient?.phoneNumber) {
      customer = await Customer.findByOrgAndIdentifier(transaction.orgId, {
        phoneNumber: transaction.recipient.phoneNumber,
        email: transaction.recipient.email,
      });
    }

    // For gateway payments, create customer if not found
    // (balance payments always have a customer already)
    if (!customer && transaction.paymentType === "gateway") {
      try {
        customer = await Customer.create({
          orgId: transaction.orgId,
          phoneNumber: transaction.recipient.phoneNumber,
          email: transaction.recipient.email,
          name: transaction.recipient.name,
          metadata: {
            totalPurchases: 0,
            totalSpent: 0,
            currency: transaction.currency,
          },
        });

        logger.info("Created customer record for gateway refund", {
          orderId,
          customerId: customer._id?.toString(),
        });
      } catch (createError) {
        logger.error("Failed to create customer for refund", {
          orderId,
          error:
            createError instanceof Error
              ? createError.message
              : "Unknown error",
        });
      }
    }

    // Step 2: Refund the customer balance
    let balanceRefunded = false;

    if (customer) {
      try {
        await customer.refundBalance(
          refundAmount,
          `Refund for failed top-up (Order: ${orderId})`,
          {
            transactionId: transaction._id?.toString(),
            orderId,
            phoneNumber: transaction.recipient?.phoneNumber,
            productName: (transaction.metadata as Record<string, unknown>)
              ?.productName as string | undefined,
            notes: failureReason,
            ...additionalMetadata,
          },
        );

        balanceRefunded = true;
        creditLanded = true;

        logger.info("Customer balance refunded", {
          orderId,
          customerId: customer._id?.toString(),
          refundAmount,
          newBalance: customer.currentBalance,
        });
      } catch (refundError) {
        logger.error("Failed to refund customer balance", {
          orderId,
          customerId: customer._id?.toString(),
          error:
            refundError instanceof Error
              ? refundError.message
              : "Unknown error",
        });
      }
    } else {
      logger.warn(
        "No customer record found for refund - manual intervention required",
        {
          orderId,
          phoneNumber: transaction.recipient?.phoneNumber,
        },
      );
    }

    // Step 3: Update transaction status to "refunded"
    // (already claimed atomically above; restated here for the caller's
    // in-memory document and the remaining timeline/metadata fields)
    transaction.status = "refunded";
    transaction.timeline.refundedAt =
      transaction.timeline.refundedAt || new Date();
    transaction.timeline.failedAt = transaction.timeline.failedAt || new Date();
    transaction.metadata.failureReason = failureReason;
    // Record exactly what was credited and to whom, so a later retry of
    // this order can reverse precisely this credit first (Cluster 1f).
    // Only stamped when a credit actually landed.
    if (balanceRefunded) {
      const meta = transaction.metadata as Record<string, unknown>;
      meta.refundedAmount = refundAmount;
      // A fresh refund supersedes any earlier reversal bookkeeping, so
      // a future retry reverses THIS credit (exactly once).
      delete meta.refundReversedAt;
      delete meta.refundReversedAmount;
      delete meta.refundReversalShortfall;
      if (customer) {
        meta.refundCustomerId = customer._id?.toString();
      }
    }

    if (additionalMetadata) {
      Object.assign(transaction.metadata, additionalMetadata);
    }

    if (customer) {
      transaction.customerId = customer._id?.toString();
    }

    await transaction.save();

    logger.info("Transaction marked as refunded", {
      orderId,
      status: transaction.status,
      balanceRefunded,
      customerId: customer?._id?.toString(),
    });

    // Step 4: Send refund notification email (fire-and-forget)
    if (balanceRefunded && customer) {
      const recipientEmail =
        customer.email || transaction.recipient?.email;

      if (recipientEmail) {
        void sendRefundNotificationEmail({
          orgId: transaction.orgId,
          customer,
          recipientEmail,
          orderId,
          refundAmount,
          currency: transaction.currency,
        });
      }
    }

    return {
      success: true,
      balanceRefunded,
      customerId: customer?._id?.toString(),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("Refund processing failed", {
      orderId,
      error: errorMessage,
    });

    // Even if refund fails, mark the transaction failure — unless the
    // credit already landed, in which case the refund stands and only
    // the error is recorded (downgrading would enable a second refund).
    try {
      if (!creditLanded) {
        transaction.status = "failed";
        transaction.timeline.failedAt = new Date();
      }
      transaction.metadata.failureReason = failureReason;
      (transaction.metadata as Record<string, unknown>).refundError =
        errorMessage;
      await transaction.save();
    } catch {
      logger.error(
        "Failed to update transaction status after refund failure",
        { orderId },
      );
    }

    return {
      success: false,
      balanceRefunded: false,
      error: errorMessage,
    };
  }
}

/** Result of a refund-credit reversal */
export interface ReverseRefundCreditResult {
  /** Whether this transaction had a refund credit to reverse */
  reversed: boolean;
  /** Amount actually taken back (may be less than credited if spent) */
  reversedAmount: number;
  /** Credited amount that could not be recovered (already spent) */
  shortfall: number;
  customerId?: string;
}

/**
 * Reverse a previous refund credit for a transaction (Cluster 1f).
 *
 * Retrying a refunded order must not leave the customer with both the
 * refund credit and the re-sent top-up (F-C8). Callers invoke this
 * after claiming a refunded transaction for retry and BEFORE sending
 * again. The reversal is idempotent: it runs at most once per refund,
 * tracked by metadata.refundReversedAt.
 *
 * Legacy refunds (processed before refundedAmount was recorded) fall
 * back to the full transaction amount.
 */
export async function reverseRefundCredit(
  transaction: ITransaction,
): Promise<ReverseRefundCreditResult> {
  const orderId = transaction.orderId;
  const metadata = transaction.metadata as Record<string, unknown>;

  const wasRefunded =
    transaction.timeline?.refundedAt != null ||
    typeof metadata.refundedAmount === "number";

  if (!wasRefunded || metadata.refundReversedAt) {
    return { reversed: false, reversedAmount: 0, shortfall: 0 };
  }

  const creditedAmount =
    typeof metadata.refundedAmount === "number"
      ? (metadata.refundedAmount as number)
      : transaction.amount;

  // Resolve the customer who received the credit
  let customer: ICustomer | null = null;
  const refundCustomerId = metadata.refundCustomerId as string | undefined;

  if (refundCustomerId) {
    customer = await Customer.findById(refundCustomerId);
  }
  if (!customer && transaction.customerId) {
    customer = await Customer.findById(transaction.customerId);
  }
  if (!customer && transaction.recipient?.phoneNumber) {
    customer = await Customer.findByOrgAndIdentifier(transaction.orgId, {
      phoneNumber: transaction.recipient.phoneNumber,
      email: transaction.recipient.email,
    });
  }

  if (!customer) {
    logger.error(
      "Cannot reverse refund credit - customer not found; flagging for manual reconciliation",
      { orderId },
    );
    metadata.refundReversalError = "Customer not found for refund reversal";
    await transaction.save();
    return { reversed: false, reversedAmount: 0, shortfall: creditedAmount };
  }

  // Take back what is still in the balance; any already-spent remainder
  // is recorded as a shortfall for manual reconciliation rather than
  // driving the balance negative.
  const reversedAmount = Math.min(creditedAmount, customer.currentBalance);
  const shortfall = creditedAmount - reversedAmount;
  const previousBalance = customer.currentBalance;

  customer.currentBalance -= reversedAmount;
  customer.totalUsed += reversedAmount;
  await customer.save();

  await CustomerBalanceHistory.create({
    customerId: customer._id,
    orgId: transaction.orgId,
    amount: -reversedAmount,
    type: "adjustment",
    previousBalance,
    newBalance: customer.currentBalance,
    description: `Refund reversal for retried order (Order: ${orderId})`,
    metadata: {
      transactionId: transaction._id?.toString(),
      orderId,
      refundReversal: true,
      shortfall,
    },
  });

  metadata.refundReversedAt = new Date().toISOString();
  metadata.refundReversedAmount = reversedAmount;
  if (shortfall > 0) {
    metadata.refundReversalShortfall = shortfall;
  }
  // The refund stamp is consumed by the reversal; the transaction is
  // being retried and must be refundable again if the retry fails.
  transaction.timeline.refundedAt = undefined;
  await transaction.save();

  logger.info("Refund credit reversed for retry", {
    orderId,
    customerId: customer._id?.toString(),
    reversedAmount,
    shortfall,
  });

  return {
    reversed: true,
    reversedAmount,
    shortfall,
    customerId: customer._id?.toString(),
  };
}

/**
 * Send refund notification email to the customer.
 * Runs as fire-and-forget so it doesn't block the refund flow.
 */
async function sendRefundNotificationEmail(params: {
  orgId: string;
  customer: ICustomer;
  recipientEmail: string;
  orderId: string;
  refundAmount: number;
  currency: string;
}): Promise<void> {
  const { orgId, customer, recipientEmail, orderId, refundAmount, currency } =
    params;

  try {
    const org = await Organization.findOne({ _id: orgId });
    const orgName = org?.name || "Prepaid Minutes";
    const orgSlug = org?.slug || "";

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://prepaid.pgecom.com";
    const loginUrl = orgSlug
      ? `${baseUrl}/customer-portal/${orgSlug}/login`
      : `${baseUrl}/login`;

    await EmailService.sendRefundNotificationEmail({
      orgId,
      recipientEmail,
      customerName: customer.name,
      orgName,
      orderId,
      refundAmount,
      currency,
      newBalance: customer.currentBalance,
      loginUrl,
    });

    logger.info("Refund notification email sent", {
      orderId,
      recipientEmail,
    });
  } catch (emailError) {
    // Email failure should not affect the refund result
    logger.error("Failed to send refund notification email", {
      orderId,
      recipientEmail,
      error:
        emailError instanceof Error ? emailError.message : "Unknown error",
    });
  }
}
