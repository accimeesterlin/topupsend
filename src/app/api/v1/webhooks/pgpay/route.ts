import { NextRequest } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import {
  dbConnection,
  Transaction,
  Integration,
  StorefrontSettings,
  PaymentProvider,
  Customer,
} from "@topupsend/db";
import { createDingConnectService } from "@/lib/services/dingconnect.service";
import { createPGPayService } from "@/lib/services/pgpay.service";
import { logger } from "@/lib/logger";
import { trackTransactionCompletion } from "@/lib/services/usage-tracking.service";
import { processRefund } from "@/lib/services/refund.service";

/**
 * Find or create/update a customer record from a transaction.
 * Looks up by phone OR email to avoid duplicates.
 */
async function findOrUpdateCustomer(
  transaction: { orgId: string; amount: number; currency: string; recipient: { phoneNumber: string; email?: string; name?: string } },
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
 * POST /api/v1/webhooks/pgpay
 * Handle PGPay payment webhook callbacks
 * Public endpoint - no auth required (PGPay calls this)
 */
export async function POST(request: NextRequest) {
  let webhookData: unknown;

  try {
    await dbConnection.connect();

    const data = await request.json();
    webhookData = data;

    logger.info("PGPay webhook received", {
      data: webhookData,
    });

    const { pgPayToken, orderId } = data as {
      pgPayToken?: string;
      orderId?: string;
    };

    if (!pgPayToken) {
      logger.error("PGPay webhook missing token", { webhookData });
      return createErrorResponse("Missing pgPayToken", 400);
    }

    // Find transaction by PGPay token or by orderId as fallback
    let transaction = await Transaction.findOne({
      "metadata.pgpayToken": pgPayToken,
    });

    // If not found by token, try by orderId (from PGPay or our system)
    if (!transaction && orderId) {
      logger.info("Transaction not found by token, trying orderId", {
        orderId,
        pgPayToken: pgPayToken.substring(0, 10) + "...",
      });

      // Try finding by our orderId or by PGPay's orderId in metadata
      transaction = await Transaction.findOne({
        $or: [{ orderId }, { "metadata.pgpayOrderId": orderId }],
      });
    }

    if (!transaction) {
      logger.error("Transaction not found for PGPay token or orderId", {
        pgPayToken: pgPayToken.substring(0, 10) + "...",
        orderId,
      });
      return createErrorResponse("Transaction not found", 404);
    }

    logger.info("Transaction found for webhook", {
      orderId: transaction.orderId,
      transactionId: transaction._id?.toString(),
      currentStatus: transaction.status,
    });

    // If already completed, skip processing (but allow retrying failed transactions)
    if (transaction.status === "completed") {
      logger.info("Transaction already completed", {
        orderId: transaction.orderId,
        status: transaction.status,
      });
      return createSuccessResponse({
        success: true,
        message: "Transaction already completed",
      });
    }

    // If failed, log that we're retrying
    if (transaction.status === "failed") {
      logger.info("Retrying failed transaction", {
        orderId: transaction.orderId,
        previousStatus: transaction.status,
      });
    }

    // Get payment provider to verify payment
    const paymentProvider = await PaymentProvider.findOne({
      orgId: transaction.orgId,
      provider: "pgpay",
      status: "active",
    }).select("+credentials.userId");

    if (!paymentProvider) {
      logger.error("PGPay payment provider not found", {
        orgId: transaction.orgId,
      });
      return createErrorResponse("Payment provider not configured", 500);
    }

    // Initialize PGPay service to verify payment
    const pgpay = createPGPayService({
      userId: paymentProvider.credentials.userId as string,
      environment: paymentProvider.environment,
    });

    logger.info("Verifying PGPay payment", {
      orderId: transaction.orderId,
      pgPayToken: pgPayToken.substring(0, 10) + "...",
    });

    // Verify payment with PGPay
    let verificationResult;
    try {
      verificationResult = await pgpay.verifyPayment({ pgPayToken });

      logger.info("PGPay verification result", {
        orderId: transaction.orderId,
        status: verificationResult.status,
        paymentStatus: verificationResult.paymentStatus,
        amount: verificationResult.amount,
        fullResponse: JSON.stringify(verificationResult), // Log full response to see all fields
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to verify PGPay payment", {
        error: errorMessage,
        orderId: transaction.orderId,
      });

      transaction.status = "failed";
      transaction.timeline.failedAt = new Date();
      transaction.metadata.failureReason =
        "Payment verification failed: " + errorMessage;
      await transaction.save();

      return createErrorResponse("Payment verification failed", 500);
    }

    // Check payment status
    // Log what we're checking against
    logger.info("Checking payment status", {
      orderId: transaction.orderId,
      expectedStatus: "completed",
      actualStatus: verificationResult.status,
      expectedPaymentStatus: "paid",
      actualPaymentStatus: verificationResult.paymentStatus,
      allKeys: Object.keys(verificationResult),
    });

    // Check if payment is completed (be flexible with status values)
    const isStatusCompleted =
      verificationResult.status?.toLowerCase() === "completed" ||
      verificationResult.status?.toLowerCase() === "success" ||
      verificationResult.status?.toLowerCase() === "succeeded";

    const isPaymentPaid =
      verificationResult.paymentStatus?.toLowerCase() === "paid" ||
      verificationResult.paymentStatus?.toLowerCase() === "success" ||
      verificationResult.paymentStatus?.toLowerCase() === "succeeded" ||
      verificationResult.paymentStatus?.toLowerCase() === "completed";

    if (!isStatusCompleted && !isPaymentPaid) {
      logger.warn("Payment not completed", {
        orderId: transaction.orderId,
        status: verificationResult.status,
        paymentStatus: verificationResult.paymentStatus,
        isStatusCompleted,
        isPaymentPaid,
      });

      // Update transaction but don't fail yet - payment might still be processing
      transaction.status = "pending";
      (transaction.metadata as Record<string, unknown>).lastWebhookCheck =
        new Date();
      await transaction.save();

      return createSuccessResponse({
        success: true,
        message: "Payment not yet completed",
      });
    }

    // Payment verified successfully - update transaction
    transaction.status = "paid";
    transaction.timeline.paidAt = new Date();
    (transaction.metadata as Record<string, unknown>).pgpayVerification =
      verificationResult;
    await transaction.save();

    logger.info("Payment verified successfully", {
      orderId: transaction.orderId,
      amount: verificationResult.amount,
    });

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

      return createErrorResponse("DingConnect integration not configured", 500);
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

      return createErrorResponse("Storefront settings not found", 500);
    }

    // Initialize DingConnect service
    const dingConnect = createDingConnectService({
      apiKey: integration.credentials.apiKey as string,
    });

    // Send top-up via DingConnect
    transaction.status = "processing";
    transaction.timeline.processingAt = new Date();
    await transaction.save();

    try {
      const validateOnly =
        storefrontSettings.topupSettings?.validateOnly || false;

      // Get product details from PGPay verification metadata first, then fall back to transaction metadata
      const pgpayMetadata = verificationResult.metadata as Record<string, unknown> | undefined;
      const transactionMetadata = transaction.metadata as Record<string, unknown>;

      let productSkuCode = (pgpayMetadata?.productSkuCode || transactionMetadata.productSkuCode) as string | undefined;

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
      let sendValue = (pgpayMetadata?.sendValue || transactionMetadata.sendValue) as number | undefined;
      let isVariableValue = (pgpayMetadata?.isVariableValue ?? transactionMetadata.isVariableValue) as boolean | undefined;

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
              isVariableValue = product.denomination?.type === 'range';
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
        logger.info("Using transaction amount as sendValue (not found in metadata)", {
          orderId: transaction.orderId,
          amount: transaction.amount,
        });
      }

      // Safety net: if sendValue exists but isVariableValue wasn't determined,
      // still include it — DingConnect will ignore it for fixed-value products
      if (!isVariableValue && sendValue) {
        isVariableValue = true;
        logger.warn("SendValue exists but isVariableValue was false — forcing to true", {
          orderId: transaction.orderId,
          productSkuCode,
          sendValue,
        });
      }

      // Last resort: if isVariableValue is still unknown, check the DingConnect product
      // This handles transactions created before the metadata schema fix
      if (isVariableValue === undefined && productSkuCode) {
        try {
          const products = await dingConnect.getProducts();
          const dingProduct = products.find(
            (p) => p.SkuCode === productSkuCode,
          );
          if (dingProduct) {
            // Use the same classification logic as phone lookup:
            // Variable-value: Has min/max range, no fixed price, no specific benefits, no validity period
            const hasMinMax = dingProduct.Minimum?.SendValue != null && dingProduct.Maximum?.SendValue != null;
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

      const transferRequest: Record<string, unknown> = {
        SkuCode: productSkuCode,
        AccountNumber: phoneNumber,
        ValidateOnly: validateOnly,
        DistributorRef: transaction.orderId,
        SendValue: typeof resolvedSendValue === "string" ? parseFloat(resolvedSendValue) : resolvedSendValue,
        SendCurrencyIso: "USD",
      };

      logger.info("Sending DingConnect transfer", {
        orderId: transaction.orderId,
        orgId: transaction.orgId,
        skuCode: productSkuCode,
        phoneNumber: phoneNumber.substring(0, 5) + "***",
        validateOnly,
        isVariableValue,
        sendValue: isVariableValue ? sendValue : undefined,
        exactRequestBody: transferRequest, // Log exact request for debugging
      });

      // In test mode, skip DingConnect API call entirely and mark as completed
      if (validateOnly) {
        logger.info("Test mode (validateOnly=true): Skipping DingConnect API call", {
          orderId: transaction.orderId,
          message: "Transaction will be marked as completed without real top-up"
        });

        transaction.status = "completed";
        transaction.timeline.completedAt = new Date();
        transaction.providerTransactionId = `TEST-${transaction.orderId}`;
        (transaction.metadata as Record<string, unknown>).testMode = true;

        logger.info("Transaction completed successfully (TEST MODE)", {
          orderId: transaction.orderId,
          transferId: `TEST-${transaction.orderId}`,
          validateOnly: true,
        });

        // Track plan usage
        void trackTransactionCompletion({
          orgId: transaction.orgId,
          transactionAmount: transaction.amount,
        });

        // Create or update customer record
        try {
          const customerId = await findOrUpdateCustomer(
            transaction,
            phoneNumber.substring(0, 5) + "***",
          );
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
      } else {
        // Production mode - call actual DingConnect API
        const transferResult = await dingConnect.sendTransfer(
          transferRequest as any
        );

        logger.info("DingConnect transfer result", {
          orderId: transaction.orderId,
          transferId: transferResult.TransferId,
          status: transferResult.Status,
        });

        // Update transaction with provider details
        transaction.providerTransactionId = transferResult.TransferId?.toString();

        if (transferResult.Status === "Completed") {
          transaction.status = "completed";
          transaction.timeline.completedAt = new Date();

          logger.info("Transaction completed successfully", {
            orderId: transaction.orderId,
            transferId: transferResult.TransferId,
            validateOnly: false,
          });

          // Track plan usage
          void trackTransactionCompletion({
            orgId: transaction.orgId,
            transactionAmount: transaction.amount,
          });

          // Create or update customer record
          try {
            const customerId = await findOrUpdateCustomer(
              transaction,
              phoneNumber.substring(0, 5) + "***",
            );
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
        } else if (transferResult.Status === "Failed") {
          const failureReason =
            transferResult.ErrorMessage || "Unknown DingConnect error";

          logger.error(
            "Transaction failed at DingConnect - processing refund",
            {
              orderId: transaction.orderId,
              errorMessage: transferResult.ErrorMessage,
              errorCode: transferResult.ErrorCode,
            },
          );

          await processRefund({
            transaction,
            failureReason,
            additionalMetadata: {
              dingconnectErrorCode: transferResult.ErrorCode,
              refundSource: "pgpay_webhook",
            },
          });
        } else if (transferResult.Status === "Processing") {
          // DingConnect is still processing - mark as completed anyway
          // DingConnect is reliable and will complete the top-up
          transaction.status = "completed";
          transaction.timeline.completedAt = new Date();
          (transaction.metadata as Record<string, unknown>).dingconnectStatus = transferResult.Status;
          (transaction.metadata as Record<string, unknown>).processingNote = "Marked as completed while DingConnect processes the transfer";

          // Track plan usage
          void trackTransactionCompletion({
            orgId: transaction.orgId,
            transactionAmount: transaction.amount,
          });

          logger.info("Transaction marked as completed (DingConnect still processing)", {
            orderId: transaction.orderId,
            transferId: transferResult.TransferId,
            status: transferResult.Status,
            message: "DingConnect will complete the transfer - marking transaction as completed for customer",
          });

          // Create or update customer record
          try {
            const customerId = await findOrUpdateCustomer(
              transaction,
              phoneNumber.substring(0, 5) + "***",
            );
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
        } else {
          // Unknown status - mark as completed to avoid blocking customer
          // Log the unknown status for monitoring
          transaction.status = "completed";
          transaction.timeline.completedAt = new Date();
          (transaction.metadata as Record<string, unknown>).dingconnectStatus = transferResult.Status;
          (transaction.metadata as Record<string, unknown>).unknownStatusNote = "Completed despite unknown DingConnect status - requires manual verification";

          // Track plan usage
          void trackTransactionCompletion({
            orgId: transaction.orgId,
            transactionAmount: transaction.amount,
          });

          logger.warn("Unknown DingConnect status - marking as completed", {
            orderId: transaction.orderId,
            transferId: transferResult.TransferId,
            status: transferResult.Status,
            message: "Unexpected status from DingConnect API - marking as completed for customer, but requires manual verification",
          });

          // Create or update customer record
          try {
            const customerId = await findOrUpdateCustomer(
              transaction,
              phoneNumber.substring(0, 5) + "***",
            );
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
      }

      await transaction.save();

      logger.info("Webhook processing completed successfully", {
        orderId: transaction.orderId,
        status: transaction.status,
      });

      return createSuccessResponse({
        success: true,
        message: "Payment confirmed and top-up sent",
        data: {
          orderId: transaction.orderId,
          status: transaction.status,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Check if it's an insufficient balance error
      const isInsufficientBalance =
        errorMessage.includes("InsufficientBalance");

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
          refundSource: "pgpay_webhook",
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

      return createErrorResponse(userMessage, 503);
    }
  } catch (error) {
    logger.error("Webhook processing error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      webhookData,
    });

    return createErrorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
}
