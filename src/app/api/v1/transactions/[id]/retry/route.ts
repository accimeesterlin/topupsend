import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { Transaction, Integration, Customer, StorefrontSettings } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { retryTransactionSchema } from "@/lib/validations/retry-transaction";
import { createDingConnectService } from "@/lib/services/dingconnect.service";
import { trackTransactionCompletion } from "@/lib/services/usage-tracking.service";
import { processRefund } from "@/lib/services/refund.service";
import { ZodError } from "zod";

/**
 * POST /api/v1/transactions/[id]/retry
 * Retry a failed DingConnect transaction with optional payload adjustments.
 *
 * Permissions: PROCESS_TRANSACTIONS (Admin, Operator)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    // Check permissions
    if (!hasPermission(session.roles, Permission.PROCESS_TRANSACTIONS)) {
      logger.warn("Permission denied for transaction retry", {
        userId: session.userId,
        roles: session.roles,
        transactionId: id,
      });
      return createErrorResponse(
        "You do not have permission to retry transactions.",
        403,
      );
    }

    await dbConnection.connect();

    const body = await request.json();

    // Validate input with Zod
    let validatedData;
    try {
      validatedData = retryTransactionSchema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`,
        );
        return createErrorResponse(
          `Validation failed: ${errors.join(", ")}`,
          400,
        );
      }
      throw error;
    }

    // Atomically claim the transaction — prevents double-retry race conditions
    // Allow retrying both "failed" and "refunded" transactions
    const transaction = await Transaction.findOneAndUpdate(
      { _id: id, orgId: session.orgId, status: { $in: ["failed", "refunded"] } },
      {
        $set: {
          status: "processing",
          "timeline.processingAt": new Date(),
          processedBy: session.userId,
        },
        $inc: { "metadata.retryCount": 1 },
      },
      { new: true },
    );

    if (!transaction) {
      // Check if the transaction exists but isn't failed
      const existing = await Transaction.findOne({
        _id: id,
        orgId: session.orgId,
      });
      if (!existing) {
        return createErrorResponse("Transaction not found", 404);
      }
      return createErrorResponse(
        `Transaction cannot be retried — current status is "${existing.status}". Only failed or refunded transactions can be retried.`,
        400,
      );
    }

    // Only DingConnect transactions can be retried
    if (transaction.provider !== "dingconnect") {
      // Revert the status change
      transaction.status = "failed";
      await transaction.save();
      return createErrorResponse(
        "Retry is only supported for DingConnect transactions.",
        400,
      );
    }

    // Build transfer request from provided fields, falling back to transaction data
    const phoneNumber =
      validatedData.phoneNumber || transaction.recipient.phoneNumber;

    let skuCode =
      validatedData.skuCode ||
      transaction.metadata.productSkuCode ||
      transaction.productId;
    if (skuCode && skuCode.startsWith("ding-")) {
      skuCode = skuCode.substring(5);
    }

    const isVariableValue = transaction.metadata.isVariableValue;
    const sendValue =
      validatedData.sendValue ?? (transaction.metadata.sendValue as number | undefined);
    const validateOnly = validatedData.validateOnly ?? false;
    const retryCount = (transaction.metadata.retryCount as number) || 1;

    if (!skuCode) {
      transaction.status = "failed";
      await transaction.save();
      return createErrorResponse(
        "Missing SKU code. Please provide a SKU code.",
        400,
      );
    }

    if (isVariableValue && !sendValue) {
      transaction.status = "failed";
      await transaction.save();
      return createErrorResponse(
        "Send value is required for variable-value products.",
        400,
      );
    }

    // Get DingConnect integration
    const integration = await Integration.findOne({
      orgId: session.orgId,
      provider: "dingconnect",
      status: "active",
    }).select("+credentials.apiKey");

    if (!integration || !integration.credentials?.apiKey) {
      transaction.status = "failed";
      await transaction.save();
      return createErrorResponse(
        "DingConnect integration not configured or inactive.",
        400,
      );
    }

    // Build the DingConnect request
    const transferRequest: Record<string, unknown> = {
      SkuCode: skuCode,
      AccountNumber: phoneNumber,
      ValidateOnly: validateOnly,
      DistributorRef: `${transaction.orderId}-R${retryCount}`,
    };

    if (isVariableValue && sendValue) {
      transferRequest.SendValue =
        typeof sendValue === "string" ? parseFloat(sendValue) : sendValue;
      transferRequest.SendCurrencyIso = "USD";
    }

    logger.info("Retrying DingConnect transfer", {
      orderId: transaction.orderId,
      transactionId: id,
      userId: session.userId,
      retryCount,
      validateOnly,
      transferRequest,
    });

    const dingConnect = createDingConnectService({
      apiKey: integration.credentials.apiKey as string,
    });

    try {
      const transferResult = await dingConnect.sendTransfer(
        transferRequest as unknown as Parameters<typeof dingConnect.sendTransfer>[0],
      );

      logger.info("DingConnect retry result", {
        orderId: transaction.orderId,
        transferId: transferResult.TransferId,
        status: transferResult.Status,
      });

      transaction.providerTransactionId =
        transferResult.TransferId?.toString();
      transaction.metadata.retriedBy = session.userId;
      transaction.metadata.retriedAt = new Date().toISOString();

      // If phone number was changed, update the transaction
      if (validatedData.phoneNumber) {
        transaction.recipient.phoneNumber = validatedData.phoneNumber;
      }
      // If SKU was changed, update metadata
      if (validatedData.skuCode) {
        transaction.metadata.productSkuCode = validatedData.skuCode;
      }

      const now = new Date();

      if (
        transferResult.Status === "Completed" ||
        transferResult.Status === "Processing"
      ) {
        transaction.status = "completed";
        transaction.timeline.completedAt = now;
        transaction.metadata.failureReason = undefined as unknown as string;

        if (transferResult.Status === "Processing") {
          transaction.metadata.dingconnectStatus = "Processing";
          transaction.metadata.processingNote =
            "Marked as completed while DingConnect processes the transfer";
        }

        await transaction.save();

        // Track plan usage
        void trackTransactionCompletion({
          orgId: session.orgId,
          transactionAmount: transaction.amount,
        });

        // Create or update customer and assign customerId
        if (transaction.recipient?.phoneNumber) {
          try {
            const existingCustomer = await Customer.findByOrgAndIdentifier(
              session.orgId,
              {
                phoneNumber: transaction.recipient.phoneNumber,
                email: transaction.recipient.email,
              },
            );

            if (!existingCustomer) {
              const newCustomer = await Customer.create({
                orgId: session.orgId,
                phoneNumber: transaction.recipient.phoneNumber,
                email: transaction.recipient.email,
                name: transaction.recipient.name,
                country: transaction.operator?.country,
                metadata: {
                  totalPurchases: 1,
                  totalSpent: transaction.amount,
                  currency: transaction.currency,
                  lastPurchaseAt: now,
                  acquisitionSource: "transaction",
                },
              });
              if (newCustomer._id) {
                transaction.customerId = newCustomer._id.toString();
              }
            } else {
              existingCustomer.metadata.totalPurchases =
                (existingCustomer.metadata.totalPurchases || 0) + 1;
              existingCustomer.metadata.totalSpent =
                (existingCustomer.metadata.totalSpent || 0) +
                transaction.amount;
              existingCustomer.metadata.lastPurchaseAt = now;
              if (
                !existingCustomer.country &&
                transaction.operator?.country
              ) {
                existingCustomer.country = transaction.operator.country;
              }
              await existingCustomer.save();
              if (existingCustomer._id) {
                transaction.customerId = existingCustomer._id.toString();
              }
            }

            // Save the customerId to the transaction
            await transaction.save();
          } catch (customerError) {
            logger.error("Error creating/updating customer on retry", {
              error: customerError,
              transactionId: id,
            });
          }
        }

        // Update storefront metadata (totalOrders, totalRevenue, lastOrderAt)
        try {
          const storefrontSettings = await StorefrontSettings.findOne({
            orgId: session.orgId,
          });
          if (storefrontSettings?.metadata) {
            const previousOrders = storefrontSettings.metadata.totalOrders || 0;
            const previousRevenue = storefrontSettings.metadata.totalRevenue || 0;

            storefrontSettings.metadata.totalOrders = previousOrders + 1;
            storefrontSettings.metadata.totalRevenue =
              previousRevenue + transaction.amount;
            storefrontSettings.metadata.lastOrderAt = now;
            await storefrontSettings.save();

            logger.info("Storefront metadata updated on retry", {
              orgId: session.orgId,
              totalOrders: storefrontSettings.metadata.totalOrders,
              totalRevenue: storefrontSettings.metadata.totalRevenue,
            });
          }
        } catch (storefrontError) {
          logger.error("Error updating storefront metadata on retry", {
            error: storefrontError,
            transactionId: id,
          });
        }

        logger.info("Transaction retry succeeded", {
          orderId: transaction.orderId,
          transferId: transferResult.TransferId,
          dingStatus: transferResult.Status,
          retryCount,
        });

        return createSuccessResponse({
          retrySuccess: true,
          message: validateOnly
            ? "Validation successful"
            : "Transaction retried and completed successfully",
          transaction: {
            _id: transaction._id,
            orderId: transaction.orderId,
            status: transaction.status,
            providerTransactionId: transaction.providerTransactionId,
            timeline: transaction.timeline,
            metadata: {
              retryCount: transaction.metadata.retryCount,
              retriedBy: transaction.metadata.retriedBy,
            },
          },
          transferResult: {
            transferId: transferResult.TransferId,
            status: transferResult.Status,
          },
        });
      } else {
        // DingConnect returned Failed - process refund
        const failureReason =
          transferResult.ErrorMessage || "Unknown DingConnect error";

        logger.error(
          "Transaction retry failed at DingConnect - processing refund",
          {
            orderId: transaction.orderId,
            errorMessage: transferResult.ErrorMessage,
            errorCode: transferResult.ErrorCode,
            retryCount,
          },
        );

        const refundResult = await processRefund({
          transaction,
          failureReason,
          additionalMetadata: {
            dingconnectErrorCode: transferResult.ErrorCode,
            refundSource: "admin_retry",
            retriedBy: session.userId,
          },
        });

        return createSuccessResponse({
          retrySuccess: false,
          message: "DingConnect transfer failed. Customer has been refunded.",
          refundApplied: refundResult.balanceRefunded,
          transaction: {
            _id: transaction._id,
            orderId: transaction.orderId,
            status: transaction.status,
            timeline: transaction.timeline,
            metadata: {
              failureReason: transaction.metadata.failureReason,
              retryCount: transaction.metadata.retryCount,
              retriedBy: transaction.metadata.retriedBy,
            },
          },
          transferResult: {
            transferId: transferResult.TransferId,
            status: transferResult.Status,
            errorMessage: transferResult.ErrorMessage,
            errorCode: transferResult.ErrorCode,
          },
        });
      }
    } catch (dingError) {
      // DingConnect API call itself threw an error
      const errorMessage =
        dingError instanceof Error ? dingError.message : "Unknown error";

      logger.error("DingConnect API error during retry - processing refund", {
        orderId: transaction.orderId,
        error: errorMessage,
        retryCount,
      });

      const refundResult = await processRefund({
        transaction,
        failureReason: errorMessage,
        additionalMetadata: {
          refundSource: "admin_retry",
          retriedBy: session.userId,
          retriedAt: new Date().toISOString(),
        },
      });

      return createSuccessResponse({
        retrySuccess: false,
        message: "DingConnect API error. Customer has been refunded.",
        refundApplied: refundResult.balanceRefunded,
        transaction: {
          _id: transaction._id,
          orderId: transaction.orderId,
          status: transaction.status,
          metadata: {
            failureReason: errorMessage,
            retryCount: transaction.metadata.retryCount,
          },
        },
        transferResult: {
          errorMessage,
        },
      });
    }
  } catch (error) {
    logger.error("Error retrying transaction", { error });
    return handleApiError(error);
  }
}
