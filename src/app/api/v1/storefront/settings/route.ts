import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { StorefrontSettings, Organization } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";

/**
 * GET /api/v1/storefront/settings
 * Get storefront settings for current organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Find or create storefront settings
    let settings = await StorefrontSettings.findOne({ orgId: session.orgId });

    if (!settings) {
      // Get organization name for default branding
      const org = await Organization.findOne({ _id: session.orgId });

      // Create default settings
      settings = await StorefrontSettings.create({
        orgId: session.orgId,
        isActive: false,
        countries: {
          enabled: [],
          disabled: [],
          allEnabled: false,
        },
        pricing: {
          markupType: "percentage",
          markupValue: 10,
          currency: "USD",
        },
        discount: {
          enabled: false,
        },
        branding: {
          businessName: org?.name || "TopUpSend",
          primaryColor: "#3b82f6",
        },
        paymentMethods: {
          stripe: false,
          paypal: false,
          pgpay: false,
        },
        productTypes: {
          plansEnabled: true,
          topupsEnabled: true,
        },
        balanceThreshold: {
          enabled: false,
          minimumBalance: 100,
          currency: "USD",
        },
        topupSettings: {
          validateOnly: true, // Default to test mode for safety
        },
      });
    }

    logger.info("Fetched storefront settings", { orgId: session.orgId });

    return createSuccessResponse({ settings });
  } catch (error) {
    logger.error("Error fetching storefront settings", { error });
    return handleApiError(error);
  }
}

/**
 * PATCH /api/v1/storefront/settings
 * Update storefront settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const body = await request.json();

    const settings = await StorefrontSettings.findOne({ orgId: session.orgId });

    if (!settings) {
      return createErrorResponse("Storefront settings not found", 404);
    }

    // Update fields
    if (body.isActive !== undefined) {
      settings.isActive = body.isActive;
    }

    if (body.countries) {
      if (body.countries.enabled)
        settings.countries.enabled = body.countries.enabled;
      if (body.countries.disabled)
        settings.countries.disabled = body.countries.disabled;
      if (body.countries.allEnabled !== undefined)
        settings.countries.allEnabled = body.countries.allEnabled;
    }

    if (body.pricing) {
      if (body.pricing.markupType)
        settings.pricing.markupType = body.pricing.markupType;
      if (body.pricing.markupValue !== undefined)
        settings.pricing.markupValue = body.pricing.markupValue;
      if (body.pricing.currency)
        settings.pricing.currency = body.pricing.currency;
      if (body.pricing.minTransactionAmount !== undefined)
        settings.pricing.minTransactionAmount =
          body.pricing.minTransactionAmount;
      if (body.pricing.maxTransactionAmount !== undefined)
        settings.pricing.maxTransactionAmount =
          body.pricing.maxTransactionAmount;
    }

    if (body.discount) {
      if (body.discount.enabled !== undefined)
        settings.discount.enabled = body.discount.enabled;
      if (body.discount.type) settings.discount.type = body.discount.type;
      if (body.discount.value !== undefined)
        settings.discount.value = body.discount.value;
      if (body.discount.startDate)
        settings.discount.startDate = new Date(body.discount.startDate);
      if (body.discount.endDate)
        settings.discount.endDate = new Date(body.discount.endDate);
      if (body.discount.minPurchaseAmount !== undefined)
        settings.discount.minPurchaseAmount = body.discount.minPurchaseAmount;
      if (body.discount.applicableCountries)
        settings.discount.applicableCountries =
          body.discount.applicableCountries;
      if (body.discount.description !== undefined)
        settings.discount.description = body.discount.description;
    }

    if (body.branding) {
      if (body.branding.businessName)
        settings.branding.businessName = body.branding.businessName;
      if (body.branding.logo !== undefined)
        settings.branding.logo = body.branding.logo;
      if (body.branding.primaryColor)
        settings.branding.primaryColor = body.branding.primaryColor;
      if (body.branding.description !== undefined)
        settings.branding.description = body.branding.description;
      if (body.branding.supportEmail !== undefined)
        settings.branding.supportEmail = body.branding.supportEmail;
      if (body.branding.supportPhone !== undefined)
        settings.branding.supportPhone = body.branding.supportPhone;
    }

    if (body.paymentMethods) {
      if (body.paymentMethods.stripe !== undefined)
        settings.paymentMethods.stripe = body.paymentMethods.stripe;
      if (body.paymentMethods.paypal !== undefined)
        settings.paymentMethods.paypal = body.paymentMethods.paypal;
      if (body.paymentMethods.pgpay !== undefined)
        settings.paymentMethods.pgpay = body.paymentMethods.pgpay;
    }

    if (body.productTypes) {
      // Validate at least one product type is enabled
      const plansEnabled =
        body.productTypes.plansEnabled ??
        settings.productTypes?.plansEnabled ??
        true;
      const topupsEnabled =
        body.productTypes.topupsEnabled ??
        settings.productTypes?.topupsEnabled ??
        true;

      if (!plansEnabled && !topupsEnabled) {
        return createErrorResponse(
          "At least one product type must be enabled",
          400,
        );
      }

      if (body.productTypes.plansEnabled !== undefined)
        settings.productTypes.plansEnabled = body.productTypes.plansEnabled;
      if (body.productTypes.topupsEnabled !== undefined)
        settings.productTypes.topupsEnabled = body.productTypes.topupsEnabled;
    }

    if (body.balanceThreshold) {
      if (body.balanceThreshold.enabled !== undefined)
        settings.balanceThreshold.enabled = body.balanceThreshold.enabled;
      if (body.balanceThreshold.minimumBalance !== undefined)
        settings.balanceThreshold.minimumBalance =
          body.balanceThreshold.minimumBalance;
      if (body.balanceThreshold.currency)
        settings.balanceThreshold.currency = body.balanceThreshold.currency;
    }

    if (body.topupSettings) {
      if (body.topupSettings.validateOnly !== undefined)
        settings.topupSettings.validateOnly = body.topupSettings.validateOnly;
    }

    if (body.legal) {
      if (body.legal.termsUrl !== undefined)
        settings.legal.termsUrl = body.legal.termsUrl;
      if (body.legal.privacyUrl !== undefined)
        settings.legal.privacyUrl = body.legal.privacyUrl;
      if (body.legal.refundPolicy !== undefined)
        settings.legal.refundPolicy = body.legal.refundPolicy;
    }

    await settings.save();

    logger.info("Updated storefront settings", { orgId: session.orgId });

    return createSuccessResponse({ settings });
  } catch (error) {
    logger.error("Error updating storefront settings", { error });
    return handleApiError(error);
  }
}
