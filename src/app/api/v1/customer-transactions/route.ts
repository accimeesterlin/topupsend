/**
 * Customer Transaction Endpoint
 * POST /api/v1/customer-transactions
 *
 * Allows authenticated customers to send top-ups using their balance
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  dbConnection,
  Transaction,
  Customer,
  Integration,
  PricingRule,
  StorefrontSettings,
} from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requireVerifiedCustomer } from "@/lib/auth-middleware";
import { createDingConnectService } from "@/lib/services/dingconnect.service";
import {
  PricingResolutionError,
  resolveServerSidePricing,
} from "@/lib/services/storefront-pricing.service";
import {
  isDefiniteProviderRejection,
  pollTransferStatus,
} from "@/lib/services/fulfillment.service";
import { logger } from "@/lib/logger";
import { trackTransactionCompletion, checkTransactionLimit } from "@/lib/services/usage-tracking.service";
import { processRefund } from "@/lib/services/refund.service";
import { parseUserAgent } from "@/lib/parse-user-agent";
import { parsePhoneNumber } from "awesome-phonenumber";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";

countries.registerLocale(en);

function getCountryName(countryCode: string): string {
  return countries.getName(countryCode, "en") || countryCode;
}

const sendTopupSchema = z.object({
  phoneNumber: z.string().min(10, "Phone number is required"),
  skuCode: z.string().min(1, "Product SKU is required"),
  amount: z.number().optional(), // For variable-value products
  sendValue: z.number().optional(), // For variable-value products
  // NOTE: no client-supplied cost/price field is accepted (F-C5). The
  // cost basis is always derived server-side from the provider's
  // EstimatePrices endpoint — a client "estimatedUsdCost" used to be
  // trusted as the cost basis, letting callers name their own price.
  browserMetadata: z.record(z.unknown()).optional(), // Client-side browser info
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    // Require verified customer authentication
    const session = await requireVerifiedCustomer(request);

    // Parse and validate request body
    const body = await request.json();
    const data = sendTopupSchema.parse(body);

    // Get customer details
    const customer = await Customer.findById(session.customerId);

    if (!customer) {
      throw ApiErrors.NotFound("Customer not found");
    }

    // Check transaction limit for organization's plan
    const limitCheck = await checkTransactionLimit(session.orgId);
    if (!limitCheck.allowed) {
      throw ApiErrors.BadRequest(
        `Monthly transaction limit reached (${limitCheck.limit}). Please upgrade your plan to continue.`,
      );
    }

    // Get DingConnect integration for this organization
    const integration = await Integration.findOne({
      orgId: session.orgId,
      provider: "dingconnect",
      status: "active",
    }).select("+credentials.apiKey");

    if (!integration || !integration.credentials?.apiKey) {
      throw ApiErrors.BadRequest("Service provider not configured");
    }

    // Initialize DingConnect service
    const dingConnect = createDingConnectService({
      apiKey: integration.credentials.apiKey,
    });

    // Lookup product details from DingConnect
    logger.info("Looking up product from DingConnect", {
      skuCode: data.skuCode,
      customerId: session.customerId,
    });

    // Detect country from phone number for pricing rules
    const parsedPhone = parsePhoneNumber(data.phoneNumber);
    const detectedCountry = parsedPhone.regionCode || "";

    if (!detectedCountry) {
      throw ApiErrors.BadRequest("Unable to detect country from phone number");
    }

    const countryName = getCountryName(detectedCountry);

    // Get organization's storefront settings (test-mode flag below;
    // pricing discounts are resolved inside the pricing service)
    const storefrontSettings = await StorefrontSettings.findOne({
      orgId: session.orgId,
    });

    // Server-side pricing (F-C1/F-C5): the cost basis, the markup, the
    // discount and the fulfilled send-value are ALL derived from the
    // provider catalog and the organization's own rules — the request
    // body contributes only the SKU and the chosen send value.
    let resolved;
    try {
      resolved = await resolveServerSidePricing({
        orgId: session.orgId,
        skuCode: data.skuCode,
        countryIso: detectedCountry,
        requestedSendValue: data.sendValue ?? data.amount,
        dingConnect,
      });
    } catch (error) {
      if (error instanceof PricingResolutionError) {
        if (error.statusCode === 404) {
          throw ApiErrors.NotFound(error.message);
        }
        throw ApiErrors.BadRequest(error.message);
      }
      throw error;
    }

    const productDetails = resolved.product;
    const providerName = resolved.providerName;
    const isVariableValue = resolved.isVariableValue;
    const sendValue = resolved.sendValue;
    const dingConnectCost = resolved.costPrice;
    const customerPrice = resolved.customerPrice;
    const discountAmount = resolved.discountAmount;
    const finalPrice = resolved.finalPrice;

    logger.info("Transaction pricing calculated (server-side)", {
      dingConnectCost,
      customerPrice,
      discountAmount,
      finalPrice,
      markup: resolved.markup,
      pricingRuleName: resolved.pricingRuleName,
    });

    // Check customer balance (against final price after markup & discount)
    if (customer.currentBalance < finalPrice) {
      throw ApiErrors.BadRequest(
        `Insufficient balance. Required: ${customer.balanceCurrency} ${finalPrice.toFixed(2)}, Available: ${customer.balanceCurrency} ${customer.currentBalance.toFixed(2)}`,
      );
    }

    // Create transaction record
    const transaction = new Transaction({
      orgId: session.orgId,
      customerId: session.customerId,
      productId: `ding-${data.skuCode}`,
      amount: finalPrice, // Customer pays the final price (with markup & discount)
      currency: customer.balanceCurrency || "USD",
      status: "pending",
      paymentGateway: "balance",
      paymentType: "balance",
      provider: "dingconnect",
      isTestMode: storefrontSettings?.topupSettings?.validateOnly ?? true, // Store test mode flag
      recipient: {
        phoneNumber: data.phoneNumber,
        email: session.email,
      },
      operator: {
        id: productDetails.ProviderCode || "UNKNOWN",
        name: providerName,
        country: detectedCountry,
      },
      metadata: {
        productSkuCode: data.skuCode,
        productName: productDetails.DefaultDisplayText || "Top-up",
        providerName,
        isVariableValue,
        sendValue,
        benefitAmount: productDetails.BenefitTypes?.Airtime?.Amount || 0,
        benefitUnit: productDetails.BenefitTypes?.Airtime?.Unit || "",
        // Country info
        countryCode: detectedCountry,
        countryName,
        // Pricing breakdown
        costPrice: dingConnectCost, // What we pay to DingConnect
        customerPrice, // Price with markup
        discountAmount, // Discount applied
        finalPrice, // What customer actually pays
        markup: customerPrice - dingConnectCost,
        pricingRuleName: resolved.pricingRuleName,
        // Client & request info
        ipAddress:
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown",
        userAgent: request.headers.get("user-agent") || "unknown",
        ...parseUserAgent(request.headers.get("user-agent")),
        acceptLanguage: request.headers.get("accept-language") || undefined,
        referer: request.headers.get("referer") || undefined,
        origin: request.headers.get("origin") || undefined,
        secChUa: request.headers.get("sec-ch-ua") || undefined,
        secChUaPlatform: request.headers.get("sec-ch-ua-platform") || undefined,
        secChUaMobile: request.headers.get("sec-ch-ua-mobile") || undefined,
        ...(data.browserMetadata ? { browser: data.browserMetadata } : {}),
      },
      timeline: {
        createdAt: new Date(),
      },
    });

    await transaction.save();

    logger.info("Customer transaction created", {
      orderId: transaction.orderId,
      customerId: session.customerId,
      amount: finalPrice,
      dingConnectCost,
      markup: customerPrice - dingConnectCost,
      discountAmount,
      phoneNumber: data.phoneNumber.substring(0, 5) + "***",
    });

    // Deduct from customer balance immediately (optimistic) - using final price
    customer.currentBalance -= finalPrice;
    customer.totalUsed += finalPrice;
    await customer.save();

    logger.info("Customer balance deducted", {
      customerId: session.customerId,
      deducted: finalPrice,
      newBalance: customer.currentBalance,
    });

    // Send top-up via DingConnect
    try {
      // Clean phone number - remove spaces, dashes, parentheses, but keep the + sign for parsing
      const cleanPhoneForParsing = data.phoneNumber.replace(/[\s\-\(\)]/g, "");

      // Parse to get E.164 format
      const parsedPhoneForTransfer = parsePhoneNumber(cleanPhoneForParsing);

      // DingConnect expects phone WITHOUT the + sign
      const accountNumber =
        parsedPhoneForTransfer.number?.e164?.replace(/^\+/, "") ||
        cleanPhoneForParsing.replace(/^\+/, "");

      // Get test mode setting from storefront settings
      const validateOnly =
        storefrontSettings?.topupSettings?.validateOnly ?? true; // Default to test mode for safety

      logger.info("Sending top-up via DingConnect", {
        orderId: transaction.orderId,
        skuCode: data.skuCode,
        phoneNumber: accountNumber.substring(0, 5) + "***",
        isVariableValue,
        sendValue: isVariableValue ? sendValue : undefined,
        validateOnly,
        testMode: validateOnly ? "ON" : "OFF",
      });

      let transferResult;
      try {
        transferResult = await dingConnect.sendTransfer({
          SkuCode: data.skuCode,
          AccountNumber: accountNumber,
          SendValue: sendValue,
          SendCurrencyIso:
            productDetails.Minimum?.SendCurrencyIso ||
            productDetails.Price?.CurrencyCode ||
            "USD",
          DistributorRef: transaction.orderId, // Use our order ID as the unique reference
          ValidateOnly: validateOnly, // Use organization's test mode setting
        });
      } catch (sendError) {
        if (!isDefiniteProviderRejection(sendError)) {
          // Unknown outcome (timeout / network / 5xx): the provider may
          // have accepted the transfer. Never refund, never complete —
          // the order stays "processing" (balance deduction held) for
          // the reconciliation sweep to settle (F-H7).
          transaction.status = "processing";
          transaction.timeline.processingAt = new Date();
          (transaction.metadata as any).transferOutcome = "unknown";
          transaction.metadata.failureReason =
            "DingConnect request outcome unknown (possible timeout); awaiting status verification";
          await transaction.save();

          return createSuccessResponse({
            success: true,
            message:
              "Top-up is being processed. Its final status will be confirmed automatically.",
            transaction: {
              id: String(transaction._id),
              orderId: transaction.orderId,
              amount: finalPrice,
              status: transaction.status,
              recipientPhone: data.phoneNumber,
            },
            balance: {
              current: customer.currentBalance,
              currency: customer.balanceCurrency,
            },
          });
        }
        // Definite rejection (HTTP 4xx): nothing was sent — refund path.
        throw sendError;
      }

      logger.info("DingConnect transfer result", {
        orderId: transaction.orderId,
        transferId: transferResult.TransferId,
        status: transferResult.Status,
      });

      transaction.providerTransactionId = String(transferResult.TransferId);
      (transaction.metadata as any).dingTransferId = transferResult.TransferId;

      // Honest outcomes (F-C5/F-H6): branch on the provider's ACTUAL
      // result status. Only "Completed" completes the order; "Failed"
      // refunds; "Processing"/unknown is polled, and if still not
      // final the order stays "processing" — previously every HTTP 200
      // response was recorded "completed", including failures.
      let finalResult = transferResult;
      if (
        transferResult.Status !== "Completed" &&
        transferResult.Status !== "Failed"
      ) {
        finalResult = await pollTransferStatus(
          dingConnect,
          Number(transferResult.TransferId),
        ).catch(() => transferResult);
      }
      (transaction.metadata as any).dingStatus = finalResult.Status;

      if (finalResult.Status === "Failed") {
        const failureReason =
          finalResult.ErrorMessage || "DingConnect transfer failed";

        logger.error("DingConnect transfer failed - processing refund", {
          orderId: transaction.orderId,
          errorMessage: finalResult.ErrorMessage,
          errorCode: finalResult.ErrorCode,
        });

        await processRefund({
          transaction,
          failureReason,
          refundAmount: finalPrice,
        });

        throw ApiErrors.InternalServerError(
          `Failed to send top-up: ${failureReason}`,
        );
      }

      if (finalResult.Status !== "Completed") {
        transaction.status = "processing";
        transaction.timeline.processingAt = new Date();
        (transaction.metadata as any).transferOutcome = "unknown";
        await transaction.save();

        return createSuccessResponse({
          success: true,
          message:
            "Top-up is being processed. Its final status will be confirmed automatically.",
          transaction: {
            id: String(transaction._id),
            orderId: transaction.orderId,
            amount: finalPrice,
            status: transaction.status,
            recipientPhone: data.phoneNumber,
            transferId: transferResult.TransferId,
          },
          balance: {
            current: customer.currentBalance,
            currency: customer.balanceCurrency,
          },
        });
      }

      // Update transaction with success
      transaction.status = "completed";
      transaction.timeline.completedAt = new Date();

      await transaction.save();

      // Track plan usage
      void trackTransactionCompletion({
        orgId: session.orgId,
        transactionAmount: finalPrice,
      });

      // Update customer purchase metadata
      customer.metadata = customer.metadata || {};
      customer.metadata.totalPurchases =
        (customer.metadata.totalPurchases || 0) + 1;
      customer.metadata.totalSpent =
        (customer.metadata.totalSpent || 0) + finalPrice;
      customer.metadata.lastPurchaseAt = new Date();
      customer.metadata.currency = customer.balanceCurrency || "USD";
      await customer.save();

      return createSuccessResponse({
        success: true,
        message: "Top-up sent successfully",
        transaction: {
          id: String(transaction._id),
          orderId: transaction.orderId,
          amount: finalPrice, // Customer paid amount
          status: transaction.status,
          recipientPhone: data.phoneNumber,
          transferId: transferResult.TransferId,
        },
        balance: {
          current: customer.currentBalance,
          currency: customer.balanceCurrency,
        },
      });
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : "Unknown error";

      // A transfer already recorded as completed must never be routed
      // into the refund path by a later bookkeeping error (F-H7).
      if (transaction.status === "completed") {
        logger.error(
          "Post-completion error in balance checkout (transfer delivered; not refunding)",
          { error: failureReason, orderId: transaction.orderId },
        );
        throw ApiErrors.InternalServerError(
          "Top-up was sent, but recording it failed. Please contact support with your order ID.",
        );
      }

      logger.error("DingConnect transfer failed - processing refund", {
        error: failureReason,
        orderId: transaction.orderId,
        customerId: session.customerId,
        refundAmount: finalPrice,
      });

      // Process refund: restores customer balance, creates history record, marks transaction as "refunded"
      await processRefund({
        transaction,
        failureReason,
        refundAmount: finalPrice,
      });

      throw ApiErrors.InternalServerError(
        `Failed to send top-up: ${failureReason}`,
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
