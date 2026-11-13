/**
 * Fulfillment Service
 *
 * Sends the top-up for a transaction that has already been marked "paid".
 * Extracted from the PGPay webhook (src/app/api/v1/webhooks/pgpay/route.ts)
 * so every payment path — the PGPay webhook (and the payments/verify route,
 * which delegates to the webhook) and manual payments — fulfills an order
 * identically: mark processing → send via DingConnect → complete, or refund
 * the customer balance on failure via the refund service.
 */

import {
  Customer,
  Integration,
  StorefrontSettings,
  Transaction,
  type ITransaction,
} from "@topupsend/db";
import {
  createDingConnectService,
  type DingConnectService,
  type SendTransferResponse,
} from "@/lib/services/dingconnect.service";
import { logger } from "@/lib/logger";
import { trackTransactionCompletion } from "@/lib/services/usage-tracking.service";
import { processRefund } from "@/lib/services/refund.service";

/** Parameters for fulfilling a paid transaction */
export interface FulfillPaidTransactionParams {
  /** The transaction to fulfill. Must already be in "paid" status. */
  transaction: ITransaction;
  /**
   * PGPay verification metadata, when the payment was confirmed by PGPay.
   * Preferred source for product SKU / send value; falls back to the
   * transaction's own metadata when absent (e.g. manual payments).
   */
  pgpayMetadata?: Record<string, unknown>;
  /** Value recorded as `refundSource` in refund metadata if fulfillment fails */
  refundSource: string;
}

/** Result of a fulfillment attempt */
export type FulfillmentResult =
  /** Fulfillment ran to a terminal state (completed, or refunded after a failed transfer) */
  | { outcome: "fulfilled"; status: ITransaction["status"] }
  /** Org configuration is missing (integration/storefront); transaction marked "failed" */
  | { outcome: "configuration-error"; errorMessage: string }
  /** The transfer threw; the payment was refunded to the customer's balance */
  | {
      outcome: "refund-error";
      userMessage: string;
      failureReason: string;
      isInsufficientBalance: boolean;
    }
  /**
   * The transaction was not fulfilled because it is not in "paid"
   * status (already claimed by another caller, already completed, or
   * refunded — refunded orders are NEVER fulfilled). No state changed.
   */
  | { outcome: "skipped"; reason: string }
  /**
   * The provider accepted (or may have accepted) the transfer but its
   * final outcome is not yet known. The transaction stays in
   * "processing" for the reconciliation sweep to settle — it is NOT
   * marked completed and NOT refunded (Cluster 1e, F-H6/F-H7).
   */
  | { outcome: "pending-verification"; status: ITransaction["status"] };

/**
 * Find or create/update a customer record from a transaction.
 * Looks up by phone OR email to avoid duplicates.
 */
async function findOrUpdateCustomer(
  transaction: {
    orgId: string;
    amount: number;
    currency: string;
    recipient: { phoneNumber: string; email?: string; name?: string };
  },
  maskedPhone: string,
): Promise<string | undefined> {
  const existingCustomer = await Customer.findByOrgAndIdentifier(
    transaction.orgId,
    {
      phoneNumber: transaction.recipient.phoneNumber,
      email: transaction.recipient.email,
    },
  );

  if (existingCustomer) {
    existingCustomer.metadata = existingCustomer.metadata || {};
    existingCustomer.metadata.totalPurchases =
      (existingCustomer.metadata.totalPurchases || 0) + 1;
    existingCustomer.metadata.totalSpent =
      (existingCustomer.metadata.totalSpent || 0) + transaction.amount;
    existingCustomer.metadata.currency = transaction.currency;
    existingCustomer.metadata.lastPurchaseAt = new Date();

    // Backfill missing fields
    if (!existingCustomer.email && transaction.recipient.email) {
      existingCustomer.email = transaction.recipient.email;
    }
    if (!existingCustomer.name && transaction.recipient.name) {
      existingCustomer.name = transaction.recipient.name;
    }
    if (!existingCustomer.phoneNumber && transaction.recipient.phoneNumber) {
      existingCustomer.phoneNumber = transaction.recipient.phoneNumber;
    }

    await existingCustomer.save();

    logger.info("Customer updated", {
      customerId: existingCustomer._id?.toString(),
      phoneNumber: maskedPhone,
      totalPurchases: existingCustomer.metadata.totalPurchases,
    });

    return existingCustomer._id?.toString();
  }

  const newCustomer = await Customer.create({
    orgId: transaction.orgId,
    phoneNumber: transaction.recipient.phoneNumber,
    email: transaction.recipient.email,
    name: transaction.recipient.name,
    metadata: {
      totalPurchases: 1,
      totalSpent: transaction.amount,
      currency: transaction.currency,
      lastPurchaseAt: new Date(),
    },
  });

  logger.info("New customer created", {
    customerId: newCustomer._id?.toString(),
    phoneNumber: maskedPhone,
  });

  return newCustomer._id?.toString();
}

/**
 * Update storefront order/revenue counters after a completed top-up.
 */
async function updateStorefrontMetadata(
  storefrontSettings: {
    metadata?: {
      totalOrders?: number;
      totalRevenue?: number;
      lastOrderAt?: Date;
    };
    save: () => Promise<unknown>;
  },
  transaction: ITransaction,
): Promise<void> {
  if (storefrontSettings.metadata) {
    const previousOrders = storefrontSettings.metadata.totalOrders || 0;
    const previousRevenue = storefrontSettings.metadata.totalRevenue || 0;

    storefrontSettings.metadata.totalOrders = previousOrders + 1;
    storefrontSettings.metadata.totalRevenue =
      previousRevenue + transaction.amount;
    storefrontSettings.metadata.lastOrderAt = new Date();
    await storefrontSettings.save();

    logger.info("Storefront metadata updated", {
      orgId: transaction.orgId,
      totalOrders: storefrontSettings.metadata.totalOrders,
      totalRevenue: storefrontSettings.metadata.totalRevenue,
    });
  }
}

/**
 * Shared post-completion bookkeeping: usage tracking, customer record,
 * and storefront counters. Used by every "completed" branch below.
 */
async function handleCompletionSideEffects(
  transaction: ITransaction,
  storefrontSettings: Parameters<typeof updateStorefrontMetadata>[0],
  maskedPhone: string,
): Promise<void> {
  // Track plan usage
  void trackTransactionCompletion({
    orgId: transaction.orgId,
    transactionAmount: transaction.amount,
  });

  // Create or update customer record
  try {
    const customerId = await findOrUpdateCustomer(transaction, maskedPhone);
    if (customerId) transaction.customerId = customerId;
  } catch (customerError) {
    logger.error("Failed to create/update customer", {
      error:
        customerError instanceof Error
          ? customerError.message
          : "Unknown error",
      orderId: transaction.orderId,
    });
  }

  // Update storefront metadata
  await updateStorefrontMetadata(storefrontSettings, transaction);
}

/**
 * Atomically claim a paid transaction for fulfillment (Cluster 1c).
 * Exactly one caller can move a transaction paid → processing; every
 * other caller gets null. This replaces the check-then-act status
 * reads that allowed duplicate delivery (F-C7).
 */
export async function claimTransactionForFulfillment(
  transactionId: string,
): Promise<ITransaction | null> {
  return Transaction.findOneAndUpdate(
    { _id: transactionId, status: "paid" },
    {
      $set: {
        status: "processing",
        "timeline.processingAt": new Date(),
      },
    },
    { new: true },
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll DingConnect for a transfer's final status (Cluster 1e). Returns
 * the last seen response once it reaches a terminal state, or the last
 * non-terminal response after the attempts run out.
 */
export async function pollTransferStatus(
  dingConnect: DingConnectService,
  transferId: number,
  attempts = 3,
  intervalMs = 2000,
): Promise<SendTransferResponse> {
  let last = await dingConnect.getTransferStatus(transferId);
  for (let i = 1; i < attempts; i++) {
    if (last.Status === "Completed" || last.Status === "Failed") {
      return last;
    }
    await sleep(intervalMs);
    last = await dingConnect.getTransferStatus(transferId);
  }
  return last;
}

/**
 * Whether a sendTransfer error definitively proves the provider did
 * NOT accept the transfer. Only an HTTP 4xx response from DingConnect
 * itself qualifies — timeouts, network errors, 5xx and parse failures
 * can all occur after acceptance and must be treated as "unknown"
 * (F-H7), never as "failed — refund".
 */
export function isDefiniteProviderRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /DingConnect API Error: 4\d{2}\b/.test(message);
}

/**
 * Run post-completion bookkeeping, isolating its failures: once a
 * transfer is known to be delivered, a bookkeeping error must never
 * reroute the order into the refund path (F-H7). The transaction's
 * terminal state is persisted BEFORE this runs.
 */
async function safeCompletionSideEffects(
  transaction: ITransaction,
  storefrontSettings: Parameters<typeof updateStorefrontMetadata>[0],
  maskedPhone: string,
): Promise<void> {
  try {
    await handleCompletionSideEffects(
      transaction,
      storefrontSettings,
      maskedPhone,
    );
  } catch (error) {
    logger.error(
      "Post-completion bookkeeping failed (transfer already delivered; not refunding)",
      {
        orderId: transaction.orderId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    );
  }
}

/**
 * Fulfill a transaction whose payment has been confirmed.
 *
 * The transaction is expected to already be in "paid" status (the caller
 * owns the payment-confirmation step and its timeline stamps). This service
 * moves it through processing to completed/refunded, exactly as the PGPay
 * webhook did before the extraction.
 */
export async function fulfillPaidTransaction(
  params: FulfillPaidTransactionParams,
): Promise<FulfillmentResult> {
  const { transaction, refundSource } = params;
  const pgpayMetadata = params.pgpayMetadata;

  // Cluster 1c: only a "paid" transaction may be fulfilled, and only
  // by the one caller that wins the atomic claim. A refunded order is
  // refused outright — replayed webhooks must never re-deliver it.
  if (transaction.status !== "paid") {
    logger.info("Fulfillment skipped - transaction is not in paid status", {
      orderId: transaction.orderId,
      status: transaction.status,
    });
    return {
      outcome: "skipped",
      reason: `Transaction status is "${transaction.status}", not "paid"`,
    };
  }

  const claimed = await claimTransactionForFulfillment(
    transaction._id?.toString() as string,
  );
  if (!claimed) {
    logger.info(
      "Fulfillment skipped - claim lost to a concurrent fulfillment",
      { orderId: transaction.orderId },
    );
    return {
      outcome: "skipped",
      reason: "Transaction was already claimed for fulfillment",
    };
  }

  // Sync the caller's in-memory document with the claimed state.
  transaction.status = "processing";
  transaction.timeline.processingAt =
    claimed.timeline.processingAt || new Date();

  // Get DingConnect integration to send top-up
  const integration = await Integration.findOne({
    orgId: transaction.orgId,
    provider: "dingconnect",
    status: "active",
  }).select("+credentials.apiKey");

  if (!integration) {
    logger.error("DingConnect integration not found", {
      orgId: transaction.orgId,
    });

    transaction.status = "failed";
    transaction.timeline.failedAt = new Date();
    transaction.metadata.failureReason =
      "DingConnect integration not configured";
    await transaction.save();

    return {
      outcome: "configuration-error",
      errorMessage: "DingConnect integration not configured",
    };
  }

  // Get storefront settings
  const storefrontSettings = await StorefrontSettings.findOne({
    orgId: transaction.orgId,
  });

  if (!storefrontSettings) {
    logger.error("Storefront settings not found", {
      orgId: transaction.orgId,
    });

    transaction.status = "failed";
    transaction.timeline.failedAt = new Date();
    transaction.metadata.failureReason = "Storefront settings not found";
    await transaction.save();

    return {
      outcome: "configuration-error",
      errorMessage: "Storefront settings not found",
    };
  }

  // Initialize DingConnect service
  const dingConnect = createDingConnectService({
    apiKey: integration.credentials.apiKey as string,
  });

  // The transaction was already moved to "processing" by the atomic
  // claim at entry and the in-memory document is in sync with it.

  try {
    const validateOnly =
      storefrontSettings.topupSettings?.validateOnly || false;

    // Get product details from PGPay verification metadata first, then fall back to transaction metadata
    const transactionMetadata = transaction.metadata as Record<
      string,
      unknown
    >;

    let productSkuCode = (pgpayMetadata?.productSkuCode ||
      transactionMetadata.productSkuCode) as string | undefined;

    // If no SKU in metadata, try to extract from productId
    if (!productSkuCode && transaction.productId) {
      productSkuCode = transaction.productId;
    }

    // Always remove 'ding-' prefix if present (from either metadata or productId)
    if (productSkuCode && productSkuCode.startsWith("ding-")) {
      productSkuCode = productSkuCode.substring(5); // Remove 'ding-' prefix
    }

    const phoneNumber = transaction.recipient?.phoneNumber;
    // Prefer PGPay metadata, fall back to transaction metadata
    let sendValue = (pgpayMetadata?.sendValue ||
      transactionMetadata.sendValue) as number | undefined;
    let isVariableValue = (pgpayMetadata?.isVariableValue ??
      transactionMetadata.isVariableValue) as boolean | undefined;

    // If isVariableValue is undefined, try to determine from metadata or database
    if (isVariableValue === undefined && productSkuCode) {
      // If sendValue exists in metadata, treat it as variable-value
      if (sendValue) {
        isVariableValue = true;
        logger.info("Inferred isVariableValue=true from sendValue in metadata", {
          orderId: transaction.orderId,
          productSkuCode,
          sendValue,
        });
      } else {
        // Fall back to Product database lookup
        try {
          const Product = (await import("@topupsend/db")).Product;
          const product = await Product.findOne({
            $or: [
              { skuCode: productSkuCode },
              { "provider.productCode": productSkuCode },
            ],
          });

          if (product) {
            isVariableValue = product.denomination?.type === "range";
            logger.info("Retrieved isVariableValue from product database", {
              orderId: transaction.orderId,
              productSkuCode,
              denominationType: product.denomination?.type,
              isVariableValue,
            });
          }
        } catch (error) {
          logger.warn("Failed to lookup product for isVariableValue", {
            orderId: transaction.orderId,
            productSkuCode,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    // For variable-value products, if sendValue is missing, use transaction amount
    if (isVariableValue && !sendValue && transaction.amount) {
      sendValue = transaction.amount;
      logger.info(
        "Using transaction amount as sendValue (not found in metadata)",
        {
          orderId: transaction.orderId,
          amount: transaction.amount,
        },
      );
    }

    // Safety net: if sendValue exists but isVariableValue wasn't determined,
    // still include it — DingConnect will ignore it for fixed-value products
    if (!isVariableValue && sendValue) {
      isVariableValue = true;
      logger.warn(
        "SendValue exists but isVariableValue was false — forcing to true",
        {
          orderId: transaction.orderId,
          productSkuCode,
          sendValue,
        },
      );
    }

    // Last resort: if isVariableValue is still unknown, check the DingConnect product
    // This handles transactions created before the metadata schema fix
    if (isVariableValue === undefined && productSkuCode) {
      try {
        const products = await dingConnect.getProducts();
        const dingProduct = products.find((p) => p.SkuCode === productSkuCode);
        if (dingProduct) {
          // Use the same classification logic as phone lookup:
          // Variable-value: Has min/max range, no fixed price, no specific benefits, no validity period
          const hasMinMax =
            dingProduct.Minimum?.SendValue != null &&
            dingProduct.Maximum?.SendValue != null;
          const hasFixedPrice = !!(dingProduct.Price && dingProduct.Price.Amount);
          const hasSpecificBenefits = !!(
            dingProduct.BenefitTypes &&
            (dingProduct.BenefitTypes.Data ||
              dingProduct.BenefitTypes.Voice ||
              dingProduct.BenefitTypes.SMS)
          );
          const hasValidityPeriod = !!dingProduct.ValidityPeriodIso;
          const benefitsLower = (dingProduct.Benefits || []).map((b: string) =>
            b.toLowerCase(),
          );
          const benefitsIndicatePlan =
            benefitsLower.includes("data") ||
            benefitsLower.includes("voice") ||
            benefitsLower.includes("sms");
          const isFixedRange =
            hasMinMax &&
            dingProduct.Minimum!.SendValue === dingProduct.Maximum!.SendValue;

          const isVariable =
            hasMinMax &&
            !isFixedRange &&
            !hasFixedPrice &&
            !hasSpecificBenefits &&
            !hasValidityPeriod &&
            !benefitsIndicatePlan;

          if (isVariable) {
            isVariableValue = true;
            if (!sendValue) {
              sendValue = transaction.amount;
            }
            logger.info("Determined variable-value from DingConnect product data", {
              orderId: transaction.orderId,
              productSkuCode,
              min: dingProduct.Minimum?.SendValue,
              max: dingProduct.Maximum?.SendValue,
              sendValue,
            });
          } else {
            isVariableValue = false;
            logger.info("Determined fixed-value from DingConnect product data", {
              orderId: transaction.orderId,
              productSkuCode,
            });
          }
        }
      } catch (error) {
        logger.warn("Failed to lookup product from DingConnect", {
          orderId: transaction.orderId,
          productSkuCode,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    logger.info("Product SKU extraction", {
      orderId: transaction.orderId,
      productSkuCode,
      transactionProductId: transaction.productId,
      fromPgpayMetadata: {
        productSkuCode: pgpayMetadata?.productSkuCode,
        sendValue: pgpayMetadata?.sendValue,
        isVariableValue: pgpayMetadata?.isVariableValue,
      },
      fromTransactionMetadata: {
        productSkuCode: transactionMetadata.productSkuCode,
        sendValue: transactionMetadata.sendValue,
        isVariableValue: transactionMetadata.isVariableValue,
      },
      finalValues: {
        productSkuCode,
        sendValue,
        isVariableValue,
      },
    });

    if (!productSkuCode || !phoneNumber) {
      throw new Error("Missing product SKU or phone number in transaction");
    }

    // DingConnect requires SendValue for ALL products (fixed and variable)
    const resolvedSendValue = sendValue || transaction.amount;
    if (!resolvedSendValue) {
      logger.error("Missing sendValue for transfer", {
        orderId: transaction.orderId,
        productSkuCode,
        isVariableValue,
        sendValue,
        transactionAmount: transaction.amount,
      });
      throw new Error("Missing sendValue for DingConnect transfer");
    }

    const maskedPhone = phoneNumber.substring(0, 5) + "***";

    const transferRequest: Record<string, unknown> = {
      SkuCode: productSkuCode,
      AccountNumber: phoneNumber,
      ValidateOnly: validateOnly,
      DistributorRef: transaction.orderId,
      SendValue:
        typeof resolvedSendValue === "string"
          ? parseFloat(resolvedSendValue)
          : resolvedSendValue,
      SendCurrencyIso: "USD",
    };

    logger.info("Sending DingConnect transfer", {
      orderId: transaction.orderId,
      orgId: transaction.orgId,
      skuCode: productSkuCode,
      phoneNumber: maskedPhone,
      validateOnly,
      isVariableValue,
      sendValue: isVariableValue ? sendValue : undefined,
      exactRequestBody: transferRequest, // Log exact request for debugging
    });

    // In test mode, skip DingConnect API call entirely and mark as completed
    if (validateOnly) {
      logger.info(
        "Test mode (validateOnly=true): Skipping DingConnect API call",
        {
          orderId: transaction.orderId,
          message:
            "Transaction will be marked as completed without real top-up",
        },
      );

      transaction.status = "completed";
      transaction.timeline.completedAt = new Date();
      transaction.providerTransactionId = `TEST-${transaction.orderId}`;
      (transaction.metadata as Record<string, unknown>).testMode = true;

      logger.info("Transaction completed successfully (TEST MODE)", {
        orderId: transaction.orderId,
        transferId: `TEST-${transaction.orderId}`,
        validateOnly: true,
      });

      // Persist the terminal state BEFORE bookkeeping so a bookkeeping
      // failure can never reroute a delivered transfer into a refund.
      await transaction.save();

      await safeCompletionSideEffects(
        transaction,
        storefrontSettings,
        maskedPhone,
      );
    } else {
      // Production mode - call actual DingConnect API
      let transferResult: SendTransferResponse;
      try {
        transferResult = await dingConnect.sendTransfer(
          transferRequest as any,
        );
      } catch (sendError) {
        if (!isDefiniteProviderRejection(sendError)) {
          // Unknown outcome (timeout / network / 5xx): the provider may
          // have accepted the transfer. Never refund and never mark
          // completed — stay in "processing" for the reconciliation
          // sweep to settle (F-H7).
          (transaction.metadata as Record<string, unknown>).transferOutcome =
            "unknown";
          transaction.metadata.failureReason =
            "DingConnect request outcome unknown (possible timeout); awaiting status verification";
          await transaction.save();

          logger.error(
            "DingConnect send outcome unknown - left in processing for reconciliation",
            {
              orderId: transaction.orderId,
              error:
                sendError instanceof Error
                  ? sendError.message
                  : "Unknown error",
            },
          );

          return {
            outcome: "pending-verification",
            status: transaction.status,
          };
        }
        // Definite rejection (HTTP 4xx from DingConnect): nothing was
        // sent — fall through to the refund path in the outer catch.
        throw sendError;
      }

      logger.info("DingConnect transfer result", {
        orderId: transaction.orderId,
        transferId: transferResult.TransferId,
        status: transferResult.Status,
      });

      // Update transaction with provider details
      transaction.providerTransactionId = transferResult.TransferId?.toString();

      // Honest outcomes (Cluster 1e, F-H6): only a provider "Completed"
      // may complete the order. "Processing" and unknown statuses are
      // polled for their final state; if still unresolved, the order
      // stays in "processing" — never completed, never refunded.
      let finalResult = transferResult;
      if (
        transferResult.Status !== "Completed" &&
        transferResult.Status !== "Failed"
      ) {
        finalResult = await pollTransferStatus(
          dingConnect,
          Number(transferResult.TransferId),
        ).catch(() => transferResult);

        if (
          finalResult.Status !== "Completed" &&
          finalResult.Status !== "Failed"
        ) {
          (transaction.metadata as Record<string, unknown>).transferOutcome =
            "unknown";
          (
            transaction.metadata as Record<string, unknown>
          ).dingconnectStatus = finalResult.Status;
          await transaction.save();

          logger.warn(
            "DingConnect transfer not yet final - left in processing for reconciliation",
            {
              orderId: transaction.orderId,
              status: finalResult.Status,
              transferId: transferResult.TransferId,
            },
          );

          return {
            outcome: "pending-verification",
            status: transaction.status,
          };
        }
      }

      if (finalResult.Status === "Completed") {
        transaction.status = "completed";
        transaction.timeline.completedAt = new Date();

        logger.info("Transaction completed successfully", {
          orderId: transaction.orderId,
          transferId: finalResult.TransferId,
          validateOnly: false,
        });

        // Persist the terminal state BEFORE bookkeeping (F-H7).
        await transaction.save();

        await safeCompletionSideEffects(
          transaction,
          storefrontSettings,
          maskedPhone,
        );
      } else {
        // finalResult.Status === "Failed" — the provider definitively
        // rejected the transfer, so the payment is refunded.
        const failureReason =
          finalResult.ErrorMessage || "Unknown DingConnect error";

        logger.error("Transaction failed at DingConnect - processing refund", {
          orderId: transaction.orderId,
          errorMessage: finalResult.ErrorMessage,
          errorCode: finalResult.ErrorCode,
        });

        await processRefund({
          transaction,
          failureReason,
          additionalMetadata: {
            dingconnectErrorCode: finalResult.ErrorCode,
            refundSource,
          },
        });
      }
    }

    await transaction.save();

    return { outcome: "fulfilled", status: transaction.status };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Check if it's an insufficient balance error
    const isInsufficientBalance = errorMessage.includes("InsufficientBalance");

    const failureReason = isInsufficientBalance
      ? "Provider balance insufficient to complete transaction"
      : errorMessage;

    logger.error(
      isInsufficientBalance
        ? "CRITICAL: Insufficient provider balance during top-up - URGENT FUNDING REQUIRED"
        : "Failed to send DingConnect transfer - processing refund",
      {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        orderId: transaction.orderId,
        isInsufficientBalance,
        amount: transaction.amount,
        phoneNumber: transaction.recipient?.phoneNumber,
        alert: isInsufficientBalance
          ? "PROVIDER ACCOUNT DEPLETED - BLOCKING NEW TRANSACTIONS"
          : undefined,
      },
    );

    // Process refund: credits customer balance, creates history record, marks transaction as "refunded"
    await processRefund({
      transaction,
      failureReason,
      additionalMetadata: {
        refundSource,
        ...(isInsufficientBalance
          ? {
              internalNote:
                "URGENT: DingConnect account needs funding immediately",
            }
          : {}),
      },
    });

    // Return generic customer-facing error (don't expose internal issues)
    const userMessage = isInsufficientBalance
      ? "We're unable to process your top-up at this time. Your payment has been received and has been refunded to your account balance. Please contact support for assistance."
      : "Top-up could not be completed. The payment amount has been credited to your account balance. Please contact support with your order ID.";

    return {
      outcome: "refund-error",
      userMessage,
      failureReason,
      isInsufficientBalance,
    };
  }
}

export type SettleStuckTransferResult =
  | "completed"
  | "refunded"
  | "unknown"
  | "skipped";

/**
 * Settle a transaction stuck in "processing" by asking the provider
 * for the transfer's actual final state (Cluster 1d/1e). Used by the
 * reconciliation sweep for orders whose send outcome was unknown.
 *
 * Completed → the terminal state is persisted, then completion
 * bookkeeping runs (isolated). Failed → the payment is refunded.
 * Anything else → the order stays in "processing" for the next sweep.
 */
export async function settleStuckTransfer(
  transaction: ITransaction,
): Promise<SettleStuckTransferResult> {
  if (
    transaction.status !== "processing" ||
    !transaction.providerTransactionId
  ) {
    return "skipped";
  }

  const transferId = Number(transaction.providerTransactionId);
  if (!Number.isFinite(transferId)) {
    // Non-numeric ids (e.g. TEST-...) are not provider transfers.
    return "skipped";
  }

  const integration = await Integration.findOne({
    orgId: transaction.orgId,
    provider: "dingconnect",
    status: "active",
  }).select("+credentials.apiKey");

  if (!integration?.credentials?.apiKey) {
    logger.warn("Cannot settle stuck transfer - no DingConnect integration", {
      orderId: transaction.orderId,
    });
    return "skipped";
  }

  const storefrontSettings = await StorefrontSettings.findOne({
    orgId: transaction.orgId,
  });
  if (!storefrontSettings) {
    return "skipped";
  }

  const dingConnect = createDingConnectService({
    apiKey: integration.credentials.apiKey as string,
  });

  let finalResult: SendTransferResponse;
  try {
    finalResult = await dingConnect.getTransferStatus(transferId);
  } catch (error) {
    logger.warn("Failed to poll stuck transfer status", {
      orderId: transaction.orderId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return "unknown";
  }

  if (finalResult.Status === "Completed") {
    transaction.status = "completed";
    transaction.timeline.completedAt = new Date();
    (transaction.metadata as Record<string, unknown>).transferOutcome =
      "completed";
    await transaction.save();

    const phoneNumber = transaction.recipient.phoneNumber || "";
    const maskedPhone = phoneNumber
      ? `${phoneNumber.slice(0, 4)}****${phoneNumber.slice(-2)}`
      : "****";
    await safeCompletionSideEffects(
      transaction,
      storefrontSettings,
      maskedPhone,
    );
    return "completed";
  }

  if (finalResult.Status === "Failed") {
    await processRefund({
      transaction,
      failureReason:
        finalResult.ErrorMessage ||
        "DingConnect transfer failed (confirmed by status poll)",
      additionalMetadata: {
        dingconnectErrorCode: finalResult.ErrorCode,
        refundSource: "reconciliation_sweep",
      },
    });
    return "refunded";
  }

  (transaction.metadata as Record<string, unknown>).dingconnectStatus =
    finalResult.Status;
  await transaction.save();
  return "unknown";
}
