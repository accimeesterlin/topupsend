import { NextRequest } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import {
  dbConnection,
  Org,
  Organization,
  Transaction,
  Integration,
  StorefrontSettings,
  PaymentProvider,
} from "@topupsend/db";
import { createDingConnectService } from "@/lib/services/dingconnect.service";
import { createPGPayService } from "@/lib/services/pgpay.service";
import {
  PricingResolutionError,
  resolveServerSidePricing,
} from "@/lib/services/storefront-pricing.service";
import { logger } from "@/lib/logger";
import { checkTransactionLimit } from "@/lib/services/usage-tracking.service";
import { parseUserAgent } from "@/lib/parse-user-agent";
import { parsePhoneNumber } from "awesome-phonenumber";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";

countries.registerLocale(en);

function getCountryName(countryCode: string): string {
  return countries.getName(countryCode, "en") || countryCode;
}

class PaymentError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

/**
 * POST /api/v1/payments/process
 * Process a payment and send top-up
 * Public endpoint (no auth required) - used by storefront
 */
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    await dbConnection.connect();

    body = await request.json();
    const {
      orgSlug,
      phoneNumber,
      product, // Product data from lookup
      customerEmail,
      paymentMethod,
      amount, // For variable-value products
      sendValue, // For variable-value products (amount in USD to send)
      browserMetadata, // Client-side browser info
      country, // Country detected from phone lookup
    } = body as {
      orgSlug?: string;
      phoneNumber?: string;
      product?: Record<string, unknown>;
      customerEmail?: string;
      paymentMethod?: string;
      amount?: number;
      sendValue?: number;
      browserMetadata?: Record<string, unknown>;
      country?: { code: string; name: string };
    };

    // Validate required fields
    if (
      !orgSlug ||
      !phoneNumber ||
      !product ||
      !customerEmail ||
      !paymentMethod
    ) {
      throw new PaymentError(400, "Missing required fields");
    }

    // Find organization by slug (check both legacy Org and new Organization models)
    logger.info("Looking up organization by slug", { orgSlug });
    const legacyOrg = await Org.findOne({ slug: orgSlug, isActive: true });
    const modernOrg = await Organization.findOne({ slug: orgSlug });

    const org = legacyOrg || modernOrg;
    const orgId = org?._id?.toString();

    if (!org || !orgId) {
      logger.error("Organization not found", { orgSlug });
      throw new PaymentError(404, "Organization not found");
    }

    logger.info("Organization found", {
      orgId,
      orgSlug,
      model: legacyOrg ? "Org" : "Organization",
    });

    // Check transaction limit for organization's plan
    const limitCheck = await checkTransactionLimit(orgId);
    if (!limitCheck.allowed) {
      throw new PaymentError(
        403,
        "Monthly transaction limit reached. Please contact the store owner to upgrade their plan.",
      );
    }

    // Get storefront settings
    const storefrontSettings = await StorefrontSettings.findOne({ orgId });
    if (!storefrontSettings || !storefrontSettings.isActive) {
      throw new PaymentError(400, "Storefront is not active");
    }

    logger.info("Storefront settings found", {
      orgId,
      isActive: storefrontSettings.isActive,
    });

    // Validate product has required fields. The SKU is the ONLY
    // product field trusted from the client: it is an identifier that
    // is validated against the provider catalog server-side. Every
    // pricing field in the body is a display hint and is ignored (F-C1).
    const productData = product as Record<string, unknown>;
    if (!productData.skuCode) {
      throw new PaymentError(400, "Invalid product data: missing SKU code");
    }
    const skuCode = productData.skuCode as string;

    // Idempotency (F-M7): a retried checkout request carrying the same
    // Idempotency-Key returns the existing order's checkout instead of
    // minting a second PGPay order for the same purchase.
    const idempotencyKey = request.headers.get("idempotency-key");
    if (idempotencyKey && paymentMethod === "pgpay") {
      const existing = await Transaction.findOne({
        orgId,
        "metadata.idempotencyKey": idempotencyKey,
      });
      const existingToken = existing?.metadata?.pgpayToken as
        | string
        | undefined;
      if (existing && existingToken) {
        const existingProvider = await PaymentProvider.findOne({
          orgId,
          provider: "pgpay",
          status: "active",
        });
        if (existingProvider) {
          const existingPgpay = createPGPayService({
            userId: existingProvider.credentials.userId as string,
            merchantId: existingProvider.credentials.merchantId as string,
            apiKey: existingProvider.credentials.apiKey as string,
            environment: existingProvider.environment,
          });
          logger.info("Idempotent checkout retry - returning existing order", {
            orderId: existing.orderId,
            orgId,
          });
          return createSuccessResponse({
            success: true,
            requiresRedirect: true,
            data: {
              orderId: existing.orderId,
              checkoutUrl: existingPgpay.getCheckoutUrl(existingToken),
              pgpayToken: existingToken,
              message: "Redirecting to payment gateway...",
            },
          });
        }
      }
    }

    // Get DingConnect integration
    const integration = await Integration.findOne({
      orgId,
      provider: "dingconnect",
      status: "active",
    }).select("+credentials.apiKey");

    if (!integration) {
      logger.error("DingConnect integration not found", { orgId });
      throw new PaymentError(400, "DingConnect integration not configured");
    }

    if (!integration.credentials?.apiKey) {
      logger.error("DingConnect API key not found", { orgId });
      throw new PaymentError(400, "DingConnect API key not configured");
    }

    logger.info("Integration found", { orgId, provider: integration.provider });

    // Initialize DingConnect service
    const dingConnect = createDingConnectService({
      apiKey: integration.credentials.apiKey,
    });

    // Country: prefer the region parsed from the phone number itself;
    // the client-supplied country is only a fallback hint.
    const parsedPhone = parsePhoneNumber(phoneNumber!);
    const detectedCountry = parsedPhone.regionCode || country?.code || "";
    const countryName = detectedCountry
      ? getCountryName(detectedCountry)
      : country?.name || "Unknown";

    // ===================================================================
    // Server-side pricing (F-C1): the charged amount, the provider cost
    // and the fulfilled send-value are re-derived here from the
    // provider catalog and the organization's pricing rules. Nothing
    // the client sent about price influences them.
    // ===================================================================
    let resolved;
    try {
      resolved = await resolveServerSidePricing({
        orgId,
        skuCode,
        countryIso: detectedCountry,
        requestedSendValue: sendValue ?? amount,
        dingConnect,
      });
    } catch (error) {
      if (error instanceof PricingResolutionError) {
        throw new PaymentError(error.statusCode, error.message);
      }
      throw error;
    }

    const finalAmount = resolved.finalPrice;
    const actualSendValue = resolved.sendValue;
    const costPrice = resolved.costPrice;
    const markup = resolved.markup;
    const discount = resolved.discountAmount;
    const operatorName = resolved.providerName;
    const operatorId = resolved.product.ProviderCode;

    // ===================================================================
    // CRITICAL: Check DingConnect balance BEFORE allowing payment
    // This prevents users from paying when we can't fulfill the top-up.
    // The solvency check is priced off the SERVER-DERIVED cost, never
    // off client-supplied amounts.
    // ===================================================================
    try {
      const balance = await dingConnect.getBalance();
      logger.info("DingConnect balance check - BEFORE payment creation", {
        orgId,
        balance: balance.AccountBalance,
        currency: balance.CurrencyCode,
        requestedAmount: finalAmount,
      });

      const estimatedCost = costPrice;

      if (balance.AccountBalance < estimatedCost) {
        logger.error(
          "CRITICAL: Insufficient DingConnect balance - BLOCKING PAYMENT CREATION",
          {
            orgId,
            currentBalance: balance.AccountBalance,
            estimatedCost,
            requiredAmount: finalAmount,
            currency: balance.CurrencyCode,
            isVariableValue: resolved.isVariableValue,
            deficit: estimatedCost - balance.AccountBalance,
            alert:
              "PROVIDER ACCOUNT NEEDS IMMEDIATE FUNDING - USER BLOCKED FROM PAYING",
            action:
              "Payment creation blocked - user will NOT be redirected to pay",
          },
        );
        // Customer-facing generic error - don't expose internal balance issues
        // This throws BEFORE creating transaction or payment session
        throw new PaymentError(
          503,
          "Service temporarily unavailable. Please try again later or contact support if the issue persists.",
        );
      }

      logger.info(
        "DingConnect balance sufficient - ALLOWING payment creation",
        {
          orgId,
          balance: balance.AccountBalance,
          estimatedCost,
          remaining: balance.AccountBalance - estimatedCost,
          action: "Proceeding with payment creation",
        },
      );
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error; // Re-throw PaymentError as-is (already has user message)
      }
      logger.error(
        "Failed to check DingConnect balance - BLOCKING payment as precaution",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          orgId,
          action: "Payment creation blocked due to balance check failure",
        },
      );
      throw new PaymentError(
        500,
        "Unable to verify service availability. Please try again later.",
      );
    }

    logger.info("Transaction metadata preparation", {
      isVariableValue: resolved.isVariableValue,
      sendValue,
      finalAmount,
      actualSendValue,
      skuCode,
      detectedCountry,
      countryName,
      operatorName,
    });

    // Create transaction record
    const transaction = new Transaction({
      orgId,
      productId:
        (productData._id as string | undefined)?.toString() ||
        `ding-${skuCode}`,
      amount: finalAmount,
      currency: "USD",
      status: "pending",
      paymentGateway: paymentMethod,
      provider: "dingconnect",
      recipient: {
        phoneNumber,
        email: customerEmail,
      },
      operator: {
        id: operatorId,
        name: operatorName,
        country: detectedCountry || "unknown",
      },
      metadata: {
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
        ...(browserMetadata ? { browser: browserMetadata } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        retryCount: 0,
        // Store product details for webhook processing — all resolved
        // server-side above, never from client pricing fields.
        productSkuCode: skuCode,
        productName: (productData.name as string) || operatorName,
        providerName: operatorName,
        isVariableValue: resolved.isVariableValue,
        sendValue: actualSendValue,
        benefitAmount:
          resolved.benefitAmount ||
          (productData.benefitAmount as number | undefined),
        benefitUnit:
          resolved.benefitUnit || (productData.benefitUnit as string | undefined),
        // Country info
        countryCode: detectedCountry,
        countryName,
        // Pricing breakdown (server-derived)
        costPrice,
        markup,
        discount,
        finalPrice: finalAmount,
        pgpayToken: undefined,
        pgpayOrderId: undefined,
      },
      timeline: {
        createdAt: new Date(),
      },
    });

    await transaction.save();

    logger.info("Transaction created", {
      orderId: transaction.orderId,
      orgId,
      amount: finalAmount,
      phoneNumber: phoneNumber.substring(0, 5) + "***",
      productSku: productData.skuCode,
    });

    // Process payment with selected payment provider
    if (paymentMethod === "pgpay") {
      // Get PGPay payment provider configuration
      const paymentProvider = await PaymentProvider.findOne({
        orgId,
        provider: "pgpay",
        status: "active",
      });

      if (!paymentProvider) {
        logger.error("PGPay payment provider not configured", { orgId });
        throw new PaymentError(400, "PGPay payment method not configured");
      }

      logger.info("PGPay payment provider found", {
        orgId,
        environment: paymentProvider.environment,
      });

      // Initialize PGPay service (v2 when the provider carries an
      // org API key, else the v1 user-ID contract)
      const pgpay = createPGPayService({
        userId: paymentProvider.credentials.userId as string,
        merchantId: paymentProvider.credentials.merchantId as string,
        apiKey: paymentProvider.credentials.apiKey as string,
        environment: paymentProvider.environment,
      });

      // Build success and error callback URLs
      // Don't add orderId to URL - PGPay will add it along with token and status
      const baseUrl =
        request.headers.get("origin") ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        "https://prepaid.pgecom.com";
      const successUrl = `${baseUrl}/payment/success`;
      const errorUrl = `${baseUrl}/payment/cancel`;
      const webhookUrl = `${baseUrl}/api/v1/webhooks/pgpay`;

      logger.info("Creating PGPay payment session", {
        orderId: transaction.orderId,
        amount: finalAmount,
        successUrl,
        errorUrl,
        webhookUrl,
      });

      try {
        // Create PGPay payment
        const pgpayResponse = await pgpay.createPayment({
          amount: finalAmount,
          currency: "usd",
          orderId: transaction.orderId,
          customerEmail,
          customerFirstName: customerEmail.split("@")[0],
          customerLastName: "Customer",
          successUrl,
          errorUrl,
          webhookUrl,
          phone: phoneNumber,
          description: `Top-up for ${phoneNumber} - ${productData.name}`,
          metadata: {
            transactionId: transaction._id?.toString(),
            productSkuCode: skuCode,
            phoneNumber,
            // Pass critical fields for webhook processing (server-derived)
            isVariableValue: resolved.isVariableValue,
            sendValue: actualSendValue,
            benefitAmount:
              resolved.benefitAmount ||
              (productData.benefitAmount as number | undefined),
            benefitUnit:
              resolved.benefitUnit ||
              (productData.benefitUnit as string | undefined),
            // Country and pricing for enrichment
            countryCode: detectedCountry,
            countryName,
            providerName: operatorName,
            costPrice,
            markup,
            discount,
          },
        });

        logger.info("PGPay payment session created", {
          orderId: transaction.orderId,
          pgpayToken: pgpayResponse.token?.substring(0, 10) + "...",
          redirectUrl: pgpayResponse.redirectUrl,
        });

        // Store PGPay token in transaction metadata, and the gateway
        // order id in the indexed paymentId field (F-H12) so webhook
        // deliveries can be matched and deduplicated on it.
        transaction.metadata.pgpayToken = pgpayResponse.token;
        transaction.metadata.pgpayOrderId = pgpayResponse.orderId;
        transaction.paymentId = pgpayResponse.orderId;
        transaction.status = "pending" as typeof transaction.status;
        await transaction.save();

        logger.info("Returning PGPay checkout URL", {
          orderId: transaction.orderId,
          redirectUrl: pgpayResponse.redirectUrl,
        });

        // Return checkout URL for redirect (use redirectUrl from PGPay response)
        return createSuccessResponse({
          success: true,
          requiresRedirect: true,
          data: {
            orderId: transaction.orderId,
            checkoutUrl: pgpayResponse.redirectUrl, // Use PGPay's redirectUrl
            pgpayToken: pgpayResponse.token,
            message: "Redirecting to payment gateway...",
          },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        logger.error("Failed to create PGPay payment", {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          orderId: transaction.orderId,
          orgId,
        });

        transaction.status = "failed";
        transaction.timeline.failedAt = new Date();
        transaction.metadata.failureReason = errorMessage;
        await transaction.save();

        throw new PaymentError(
          500,
          `Failed to create payment: ${errorMessage}`,
        );
      }
    } else if (paymentMethod === "stripe" || paymentMethod === "paypal") {
      // TODO: Implement Stripe/PayPal integrations
      throw new PaymentError(
        400,
        `${paymentMethod} payment integration not yet implemented`,
      );
    }

    // NOTE: Top-up will be sent after payment is confirmed via webhook
    // This ensures we only send top-ups for successful payments
    logger.error("Invalid payment method", { paymentMethod });
    throw new PaymentError(400, "Invalid payment method");
  } catch (error) {
    logger.error("Payment processing error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      body: body,
    });

    if (error instanceof PaymentError) {
      return createErrorResponse(error.message, error.statusCode);
    }

    // Return more detailed error message
    return createErrorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500,
    );
  }
}
