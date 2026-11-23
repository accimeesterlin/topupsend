/**
 * Partner API — send a top-up
 * POST /api/v1/partner/topups
 *
 * Server-to-server send for partners (e.g. PGecom) holding ONE staff
 * API key for an organization. Authenticated via the existing API-key
 * system (scope `topup:send`); the key's orgId binds the send — no
 * org identifier is accepted from the request.
 *
 * Differences from the customer send (POST /api/v1/customer-transactions),
 * whose flow this mirrors:
 * - NO Customer record is created or touched and NO customer balance
 *   is debited or refunded. The send is attributed to the organization
 *   (`createdBy` = the API key's id, `paymentGateway: "partner"`) and
 *   is funded by the org's DingConnect account, like every other send.
 * - A failed send simply records `status: "failed"` (there is no
 *   customer balance to refund); an unknown provider outcome stays
 *   "processing" for the reconciliation sweep, exactly as elsewhere.
 * - `Idempotency-Key` header is REQUIRED: a retry with the same key
 *   returns the original transaction instead of sending again.
 * - `testMode: true` in the body forces DingConnect ValidateOnly for
 *   this request only; otherwise the org storefront's validateOnly
 *   setting applies, as in the customer send.
 *
 * Pricing is resolved server-side (resolveServerSidePricing) — no
 * client-supplied price is ever trusted.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  dbConnection,
  Transaction,
  Integration,
  StorefrontSettings,
} from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requirePartnerApiKey } from "@/lib/auth-middleware";
import { createDingConnectService } from "@/lib/services/dingconnect.service";
import {
  PricingResolutionError,
  resolveServerSidePricing,
} from "@/lib/services/storefront-pricing.service";
import {
  isDefiniteProviderRejection,
  pollTransferStatus,
} from "@/lib/services/fulfillment.service";
import {
  checkTransactionLimit,
  trackTransactionCompletion,
} from "@/lib/services/usage-tracking.service";
import { partnerSendTransactionView } from "@/lib/partner-transaction";
import { logger } from "@/lib/logger";
import { parsePhoneNumber } from "awesome-phonenumber";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";

countries.registerLocale(en);

function getCountryName(countryCode: string): string {
  return countries.getName(countryCode, "en") || countryCode;
}

const partnerSendSchema = z.object({
  phoneNumber: z.string().min(10, "Phone number is required"),
  skuCode: z.string().min(1, "Product SKU is required"),
  sendValue: z.number().optional(), // For variable-value products
  testMode: z.boolean().optional(), // Force ValidateOnly for this request
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const { apiKey, orgId } = await requirePartnerApiKey(
      request,
      "topup:send",
    );

    // Idempotency-Key is required for partner sends: without it a
    // retried request cannot be told apart from a new purchase.
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw ApiErrors.BadRequest(
        "Idempotency-Key header is required for partner top-up requests",
      );
    }

    const body = await request.json();
    const data = partnerSendSchema.parse(body);

    // Idempotent replay: a transaction already exists for this org
    // with this key — return it instead of sending again (the
    // payments/process pattern, keyed on metadata.idempotencyKey).
    const existing = await Transaction.findOne({
      orgId,
      "metadata.idempotencyKey": idempotencyKey,
    });
    if (existing) {
      logger.info("Partner top-up idempotent replay", {
        orderId: existing.orderId,
        orgId,
      });
      return createSuccessResponse({
        success: true,
        message: "Existing transaction returned for this Idempotency-Key",
        transaction: partnerSendTransactionView(existing),
      });
    }

    // Check transaction limit for organization's plan
    const limitCheck = await checkTransactionLimit(orgId);
    if (!limitCheck.allowed) {
      throw ApiErrors.BadRequest(
        `Monthly transaction limit reached (${limitCheck.limit}). Please upgrade your plan to continue.`,
      );
    }

    // Get DingConnect integration for this organization
    const integration = await Integration.findOne({
      orgId,
      provider: "dingconnect",
      status: "active",
    }).select("+credentials.apiKey");

    if (!integration || !integration.credentials?.apiKey) {
      throw ApiErrors.BadRequest("Service provider not configured");
    }

    const dingConnect = createDingConnectService({
      apiKey: integration.credentials.apiKey,
    });

    // Detect country from phone number for pricing rules
    const parsedPhone = parsePhoneNumber(data.phoneNumber);
    const detectedCountry = parsedPhone.regionCode || "";

    if (!detectedCountry) {
      throw ApiErrors.BadRequest(
        "Unable to detect country from phone number",
      );
    }

    const countryName = getCountryName(detectedCountry);

    // Storefront settings carry the org-wide test-mode flag; a
    // per-request testMode: true overrides it for this send only.
    const storefrontSettings = await StorefrontSettings.findOne({ orgId });
    const validateOnly =
      data.testMode === true ||
      (storefrontSettings?.topupSettings?.validateOnly ?? true);

    // Server-side pricing: cost, markup, discount and send value are
    // all derived from the provider catalog and the org's rules.
    let resolved;
    try {
      resolved = await resolveServerSidePricing({
        orgId,
        skuCode: data.skuCode,
        countryIso: detectedCountry,
        requestedSendValue: data.sendValue,
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
    const finalPrice = resolved.finalPrice;

    // Create the transaction, attributed to the org via the API key.
    // No customerId: this is a partner send, not a customer purchase.
    const transaction = new Transaction({
      orgId,
      productId: `ding-${data.skuCode}`,
      amount: finalPrice,
      currency: "USD",
      status: "pending",
      paymentGateway: "partner",
      paymentType: "gateway",
      provider: "dingconnect",
      isTestMode: validateOnly,
      createdBy: String(apiKey._id),
      recipient: {
        phoneNumber: data.phoneNumber,
      },
      operator: {
        id: productDetails.ProviderCode || "UNKNOWN",
        name: providerName,
        country: detectedCountry,
      },
      metadata: {
        idempotencyKey,
        productSkuCode: data.skuCode,
        productName: productDetails.DefaultDisplayText || "Top-up",
        providerName,
        isVariableValue: resolved.isVariableValue,
        sendValue: resolved.sendValue,
        benefitAmount: resolved.benefitAmount,
        benefitUnit: resolved.benefitUnit,
        countryCode: detectedCountry,
        countryName,
        costPrice: resolved.costPrice,
        customerPrice: resolved.customerPrice,
        discountAmount: resolved.discountAmount,
        finalPrice,
        markup: resolved.markup,
        pricingRuleName: resolved.pricingRuleName,
        testMode: validateOnly,
      },
      timeline: {
        createdAt: new Date(),
      },
    });

    await transaction.save();

    logger.info("Partner transaction created", {
      orderId: transaction.orderId,
      orgId,
      apiKeyId: String(apiKey._id),
      amount: finalPrice,
      validateOnly,
    });

    // Send via DingConnect, mirroring the customer send: DistributorRef
    // is the transaction's orderId, then poll until terminal.
    const cleanPhoneForParsing = data.phoneNumber.replace(/[\s\-\(\)]/g, "");
    const parsedPhoneForTransfer = parsePhoneNumber(cleanPhoneForParsing);
    const accountNumber =
      parsedPhoneForTransfer.number?.e164?.replace(/^\+/, "") ||
      cleanPhoneForParsing.replace(/^\+/, "");

    let transferResult;
    try {
      transferResult = await dingConnect.sendTransfer({
        SkuCode: data.skuCode,
        AccountNumber: accountNumber,
        SendValue: resolved.sendValue,
        SendCurrencyIso:
          productDetails.Minimum?.SendCurrencyIso ||
          productDetails.Price?.CurrencyCode ||
          "USD",
        DistributorRef: transaction.orderId,
        ValidateOnly: validateOnly,
      });
    } catch (sendError) {
      if (!isDefiniteProviderRejection(sendError)) {
        // Unknown outcome (timeout / network / 5xx): the provider may
        // have accepted the transfer. Stay "processing" for the
        // reconciliation sweep — never mark failed on a guess.
        transaction.status = "processing";
        transaction.timeline.processingAt = new Date();
        (transaction.metadata as Record<string, unknown>).transferOutcome =
          "unknown";
        transaction.metadata.failureReason =
          "DingConnect request outcome unknown (possible timeout); awaiting status verification";
        await transaction.save();

        return createSuccessResponse({
          success: true,
          message:
            "Top-up is being processed. Its final status will be confirmed automatically.",
          transaction: partnerSendTransactionView(transaction),
        });
      }

      // Definite rejection (HTTP 4xx): nothing was sent. There is no
      // customer balance to refund — the send simply records failure.
      const failureReason =
        sendError instanceof Error ? sendError.message : "Unknown error";
      transaction.status = "failed";
      transaction.timeline.failedAt = new Date();
      transaction.metadata.failureReason = failureReason;
      await transaction.save();

      throw ApiErrors.InternalServerError(
        `Failed to send top-up: ${failureReason}`,
      );
    }

    transaction.providerTransactionId = String(transferResult.TransferId);
    (transaction.metadata as Record<string, unknown>).dingTransferId =
      transferResult.TransferId;

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
    (transaction.metadata as Record<string, unknown>).dingStatus =
      finalResult.Status;

    if (finalResult.Status === "Failed") {
      const failureReason =
        finalResult.ErrorMessage || "DingConnect transfer failed";
      transaction.status = "failed";
      transaction.timeline.failedAt = new Date();
      transaction.metadata.failureReason = failureReason;
      await transaction.save();

      throw ApiErrors.InternalServerError(
        `Failed to send top-up: ${failureReason}`,
      );
    }

    if (finalResult.Status !== "Completed") {
      transaction.status = "processing";
      transaction.timeline.processingAt = new Date();
      (transaction.metadata as Record<string, unknown>).transferOutcome =
        "unknown";
      await transaction.save();

      return createSuccessResponse({
        success: true,
        message:
          "Top-up is being processed. Its final status will be confirmed automatically.",
        transaction: partnerSendTransactionView(transaction),
      });
    }

    transaction.status = "completed";
    transaction.timeline.completedAt = new Date();
    await transaction.save();

    void trackTransactionCompletion({
      orgId,
      transactionAmount: finalPrice,
    });

    return createSuccessResponse({
      success: true,
      message: "Top-up sent successfully",
      transaction: partnerSendTransactionView(transaction),
    });
  } catch (error) {
    // requireApiKey throws a raw Response for rate-limit breaches.
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
