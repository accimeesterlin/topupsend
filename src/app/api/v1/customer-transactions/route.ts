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
  estimatedUsdCost: z.number().optional(), // Pre-calculated USD cost from frontend
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

    let productDetails;
    let providerName = "Unknown Operator";
    try {
      // Fetch products and providers in parallel for proper operator name resolution
      const [products, providers] = await Promise.all([
        dingConnect.getProducts(),
        dingConnect.getProviders({ countryIso: detectedCountry }).catch(() => []),
      ]);

      productDetails = products.find((p) => p.SkuCode === data.skuCode);

      if (!productDetails) {
        throw ApiErrors.NotFound("Product not found");
      }

      // Resolve operator name from providers list
      const matchedProvider = providers.find(
        (p) => p.ProviderCode === productDetails!.ProviderCode,
      );
      providerName = matchedProvider?.ProviderName || productDetails.ProviderCode;
    } catch (error) {
      if (error instanceof Error && error.message === "Product not found") {
        throw ApiErrors.NotFound("Product not found");
      }
      logger.error("Failed to fetch product from DingConnect", {
        error: error instanceof Error ? error.message : "Unknown error",
        skuCode: data.skuCode,
      });
      throw ApiErrors.BadRequest("Failed to fetch product details");
    }

    // Get organization's storefront settings for discount
    const storefrontSettings = await StorefrontSettings.findOne({
      orgId: session.orgId,
    });

    // Fetch active pricing rules for this organization
    const pricingRules = await PricingRule.find({
      orgId: session.orgId,
      isActive: true,
    }).sort({ priority: -1 }); // Sort by priority descending (highest first)

    // Find the best applicable pricing rule for this country
    let applicablePricingRule = null;
    for (const rule of pricingRules) {
      if (rule.isApplicableToCountry(detectedCountry)) {
        applicablePricingRule = rule;
        break; // Already sorted by priority, so first match is best
      }
    }

    logger.info("Applicable pricing rule for transaction", {
      ruleName: applicablePricingRule?.name || "None (0% markup)",
      ruleType: applicablePricingRule?.type,
      ruleValue: applicablePricingRule?.value,
      country: detectedCountry,
    });

    // Determine the cost from DingConnect and calculate final price
    let dingConnectCost: number;
    let sendValue: number;
    let customerPrice: number; // What customer pays (with markup & discount)

    // Determine if this is a variable-value product using the same logic as phone lookup
    // Variable-value: Has min/max range, no fixed price, no specific benefits, no validity period
    // Fixed-value (plans): Has fixed price OR specific benefit amounts OR validity period OR same min/max
    const hasMinMax = !!(productDetails.Minimum && productDetails.Maximum);
    const hasFixedPrice = !!(productDetails.Price && productDetails.Price.Amount);
    const hasSpecificBenefits = !!(
      productDetails.BenefitTypes &&
      (productDetails.BenefitTypes.Data ||
        productDetails.BenefitTypes.Voice ||
        productDetails.BenefitTypes.SMS)
    );
    const hasValidityPeriod = !!productDetails.ValidityPeriodIso;

    // Check Benefits array (case-insensitive) for plan indicators
    const benefitsLower = (productDetails.Benefits || []).map((b) =>
      b.toLowerCase(),
    );
    const benefitsIndicatePlan =
      benefitsLower.includes("data") ||
      benefitsLower.includes("voice") ||
      benefitsLower.includes("sms");

    // If Minimum.SendValue === Maximum.SendValue, it's a fixed product (no range)
    const isFixedRange =
      hasMinMax &&
      productDetails.Minimum!.SendValue === productDetails.Maximum!.SendValue;

    const isVariableValue =
      hasMinMax &&
      !isFixedRange &&
      !hasFixedPrice &&
      !hasSpecificBenefits &&
      !hasValidityPeriod &&
      !benefitsIndicatePlan;

    logger.info("Product classification for transaction", {
      skuCode: data.skuCode,
      isVariableValue,
      hasMinMax,
      isFixedRange,
      hasFixedPrice,
      hasSpecificBenefits,
      hasValidityPeriod,
      benefitsIndicatePlan,
      benefits: productDetails.Benefits,
      hasPriceAmount: !!productDetails.Price?.Amount,
      minSendValue: productDetails.Minimum?.SendValue,
      maxSendValue: productDetails.Maximum?.SendValue,
    });

    if (isVariableValue) {
      if (!data.sendValue) {
        throw ApiErrors.BadRequest(
          "sendValue required for variable-value products",
        );
      }

      sendValue = data.sendValue;

      // Validate amount is within range
      const minAmount = productDetails.Minimum?.SendValue || 0;
      const maxAmount = productDetails.Maximum?.SendValue || 999999;

      if (sendValue < minAmount || sendValue > maxAmount) {
        throw ApiErrors.BadRequest(
          `Amount must be between ${minAmount} and ${maxAmount}`,
        );
      }

      // If frontend provided pre-calculated USD cost (from EstimatePrices during lookup), use it
      if (data.estimatedUsdCost && data.estimatedUsdCost > 0) {
        dingConnectCost = data.estimatedUsdCost;

        logger.info("Using pre-calculated USD cost from frontend", {
          sendValue,
          estimatedUsdCost: dingConnectCost,
        });
      } else {
        // Otherwise, try to estimate via API
        try {
          const estimate = await dingConnect.estimatePrices([
            {
              SkuCode: data.skuCode,
              SendValue: sendValue,
              SendCurrencyIso: productDetails.Minimum?.SendCurrencyIso || "USD",
            },
          ]);

          if (!estimate || estimate.length === 0) {
            throw new Error("Empty response from EstimatePrices API");
          }

          // The estimate response contains the actual USD cost (DistributorFee)
          dingConnectCost = estimate[0].Price?.DistributorFee || 0;

          if (dingConnectCost <= 0) {
            throw new Error(
              "Invalid pricing returned from service provider (zero or negative)",
            );
          }

          logger.info("Variable-value product cost from EstimatePrices", {
            sendValue,
            sendCurrency: productDetails.Minimum?.SendCurrencyIso,
            estimatedUsdCost: dingConnectCost,
            distributorFee: estimate[0].Price?.DistributorFee,
            customerFee: estimate[0].Price?.CustomerFee,
            fullEstimate: JSON.stringify(estimate[0]),
          });
        } catch (error) {
          logger.error("Failed to estimate prices from DingConnect", {
            error: error instanceof Error ? error.message : "Unknown error",
            errorStack: error instanceof Error ? error.stack : undefined,
            skuCode: data.skuCode,
            sendValue,
            sendCurrency: productDetails.Minimum?.SendCurrencyIso,
          });

          // Fallback: Calculate based on exchange rate from minimum values
          // This assumes ReceiveValue is in USD (may not be accurate)
          const minSendValue = productDetails.Minimum?.SendValue || 1;
          const minReceiveValue =
            productDetails.Minimum?.ReceiveValue || minSendValue;
          const exchangeRate = minReceiveValue / minSendValue;
          dingConnectCost = sendValue * exchangeRate;

          logger.warn("Using fallback exchange rate calculation", {
            minSendValue,
            minReceiveValue,
            exchangeRate,
            calculatedCost: dingConnectCost,
          });
        }
      }

      // Calculate customer price with markup
      if (applicablePricingRule) {
        const markup = applicablePricingRule.calculateMarkup(dingConnectCost);
        customerPrice = dingConnectCost + markup;
      } else {
        // No pricing rule - use cost price as final price (0% markup)
        customerPrice = dingConnectCost;
      }
    } else {
      // Fixed-value product (plan) - use the price from DingConnect
      // Try Price.Amount first (old format), then fall back to Minimum.SendValue (new format)
      dingConnectCost =
        productDetails.Price?.Amount ||
        productDetails.Minimum?.SendValue ||
        0;
      sendValue = dingConnectCost;

      if (dingConnectCost <= 0) {
        throw ApiErrors.BadRequest("Invalid product pricing");
      }

      // Calculate customer price with markup
      if (applicablePricingRule) {
        const markup = applicablePricingRule.calculateMarkup(dingConnectCost);
        customerPrice = dingConnectCost + markup;
      } else {
        // No pricing rule - use cost price as final price (0% markup)
        customerPrice = dingConnectCost;
      }
    }

    // Apply discount if configured in storefront settings
    let discountAmount = 0;
    let finalPrice = customerPrice;

    if (storefrontSettings?.discount?.enabled) {
      const now = new Date();
      const isDateValid =
        (!storefrontSettings.discount.startDate ||
          storefrontSettings.discount.startDate <= now) &&
        (!storefrontSettings.discount.endDate ||
          storefrontSettings.discount.endDate >= now);

      const isCountryValid =
        !storefrontSettings.discount.applicableCountries ||
        storefrontSettings.discount.applicableCountries.length === 0 ||
        storefrontSettings.discount.applicableCountries.includes(
          detectedCountry,
        );

      const isAmountValid =
        !storefrontSettings.discount.minPurchaseAmount ||
        customerPrice >= storefrontSettings.discount.minPurchaseAmount;

      if (isDateValid && isCountryValid && isAmountValid) {
        if (storefrontSettings.discount.type === "percentage") {
          discountAmount =
            customerPrice * (storefrontSettings.discount.value / 100);
        } else {
          discountAmount = storefrontSettings.discount.value;
        }
        finalPrice = Math.max(0, customerPrice - discountAmount);
        logger.info("Discount applied to customer transaction", {
          originalPrice: customerPrice,
          discountAmount,
          finalPrice,
          discountType: storefrontSettings.discount.type,
        });
      }
    }

    logger.info("Transaction pricing calculated", {
      dingConnectCost,
      customerPrice,
      discountAmount,
      finalPrice,
      markup: customerPrice - dingConnectCost,
      markupPercentage: applicablePricingRule
        ? `${(((customerPrice - dingConnectCost) / dingConnectCost) * 100).toFixed(2)}%`
        : "0%",
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
        pricingRuleName: applicablePricingRule?.name || "None",
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

      const transferResult = await dingConnect.sendTransfer({
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

      logger.info("DingConnect transfer successful", {
        orderId: transaction.orderId,
        transferId: transferResult.TransferId,
        status: transferResult.Status,
      });

      // Update transaction with success
      transaction.status = "completed";
      transaction.providerTransactionId = String(transferResult.TransferId);
      transaction.timeline.completedAt = new Date();
      (transaction.metadata as any).dingTransferId = transferResult.TransferId;
      (transaction.metadata as any).dingStatus = transferResult.Status;

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
