/**
 * Refund Service
 *
 * Handles refunding customers when DingConnect top-up fails after payment.
 * Used by customer-transactions, PGPay webhook, and retry routes.
 */

import {
  Customer,
  Organization,
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

  logger.info("Processing refund for failed transaction", {
    orderId,
    transactionId: transaction._id?.toString(),
    paymentType: transaction.paymentType,
    refundAmount,
    failureReason,
  });

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
    transaction.status = "refunded";
    transaction.timeline.refundedAt = new Date();
    transaction.timeline.failedAt = transaction.timeline.failedAt || new Date();
    transaction.metadata.failureReason = failureReason;

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

    // Even if refund fails, mark the transaction failure
    try {
      transaction.status = "failed";
      transaction.timeline.failedAt = new Date();
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
