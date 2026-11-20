/**
 * Server-side pricing resolution (Cluster 1a — F-C1, F-C5).
 *
 * The price a customer is charged, the cost the organization pays the
 * provider, and the value that gets fulfilled are ALL derived here,
 * server-side, from the provider catalog and the organization's own
 * pricing rules and storefront settings. Client-supplied pricing
 * fields (finalPrice, costPrice, estimatedUsdCost, min/max, ...) are
 * display hints only and are never inputs to this function — the only
 * client inputs honored are the product's SKU (an identifier, which
 * is validated against the catalog) and, for variable-value products,
 * the send value the customer chose (bounded by the catalog range).
 */

import { PricingRule, StorefrontSettings } from "@topupsend/db";
import {
  type DingConnectProduct,
  type DingConnectService,
} from "@/lib/services/dingconnect.service";
import { logger } from "@/lib/logger";

export class PricingResolutionError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PricingResolutionError";
  }
}

export interface ResolvedPricing {
  product: DingConnectProduct;
  providerName: string;
  isVariableValue: boolean;
  /** Value to send via the provider (USD send value). */
  sendValue: number;
  /** What the organization pays the provider (USD). */
  costPrice: number;
  /** Cost + markup, before discount. */
  customerPrice: number;
  markup: number;
  discountAmount: number;
  /** What the customer is actually charged. */
  finalPrice: number;
  pricingRuleName: string;
  benefitAmount: number;
  benefitUnit: string;
}

/**
 * Classify a DingConnect product as variable-value (open range) or
 * fixed-value (plan). Same rule the phone lookup and balance checkout
 * have always used.
 */
export function isVariableValueProduct(product: DingConnectProduct): boolean {
  const hasMinMax = !!(product.Minimum && product.Maximum);
  const hasFixedPrice = !!(product.Price && product.Price.Amount);
  const hasSpecificBenefits = !!(
    product.BenefitTypes &&
    (product.BenefitTypes.Data ||
      product.BenefitTypes.Voice ||
      product.BenefitTypes.SMS)
  );
  const hasValidityPeriod = !!product.ValidityPeriodIso;
  const benefitsLower = (product.Benefits || []).map((b) => b.toLowerCase());
  const benefitsIndicatePlan =
    benefitsLower.includes("data") ||
    benefitsLower.includes("voice") ||
    benefitsLower.includes("sms");
  const isFixedRange =
    hasMinMax && product.Minimum!.SendValue === product.Maximum!.SendValue;

  return (
    hasMinMax &&
    !isFixedRange &&
    !hasFixedPrice &&
    !hasSpecificBenefits &&
    !hasValidityPeriod &&
    !benefitsIndicatePlan
  );
}

export async function resolveServerSidePricing(params: {
  orgId: string;
  skuCode: string;
  countryIso: string;
  /** Customer-chosen send value; honored only for variable-value products. */
  requestedSendValue?: number;
  dingConnect: DingConnectService;
}): Promise<ResolvedPricing> {
  const { orgId, skuCode, countryIso, dingConnect } = params;

  // --- Load the catalog entry from the provider, never from the client
  let product: DingConnectProduct | undefined;
  let providerName = "Unknown Operator";
  try {
    const [products, providers] = await Promise.all([
      dingConnect.getProducts(),
      dingConnect
        .getProviders({ countryIso })
        .catch(() => [] as Awaited<ReturnType<typeof dingConnect.getProviders>>),
    ]);
    product = products.find((p) => p.SkuCode === skuCode);
    if (product) {
      const matchedProvider = providers.find(
        (p) => p.ProviderCode === product!.ProviderCode,
      );
      providerName = matchedProvider?.ProviderName || product.ProviderCode;
    }
  } catch (error) {
    logger.error("Failed to fetch product from DingConnect", {
      error: error instanceof Error ? error.message : "Unknown error",
      skuCode,
      orgId,
    });
    throw new PricingResolutionError(
      502,
      "Failed to fetch product details from provider",
    );
  }

  if (!product) {
    throw new PricingResolutionError(404, "Product not found");
  }

  const isVariableValue = isVariableValueProduct(product);

  // --- Cost basis from the provider catalog / estimate endpoints only
  let costPrice: number;
  let sendValue: number;

  if (isVariableValue) {
    const requested = params.requestedSendValue;
    if (!requested || !(requested > 0)) {
      throw new PricingResolutionError(
        400,
        "sendValue is required for variable-value products",
      );
    }
    sendValue = requested;

    const minAmount = product.Minimum?.SendValue || 0;
    const maxAmount = product.Maximum?.SendValue || 999999;
    if (sendValue < minAmount || sendValue > maxAmount) {
      throw new PricingResolutionError(
        400,
        `Amount must be between ${minAmount} and ${maxAmount}`,
      );
    }

    try {
      const estimate = await dingConnect.estimatePrices([
        {
          SkuCode: skuCode,
          SendValue: sendValue,
          SendCurrencyIso: product.Minimum?.SendCurrencyIso || "USD",
        },
      ]);

      if (!estimate || estimate.length === 0) {
        throw new Error("Empty response from EstimatePrices API");
      }

      costPrice = estimate[0].Price?.DistributorFee || 0;
      if (costPrice <= 0) {
        throw new Error(
          "Invalid pricing returned from service provider (zero or negative)",
        );
      }
    } catch (error) {
      logger.warn("EstimatePrices failed; using catalog exchange-rate fallback", {
        error: error instanceof Error ? error.message : "Unknown error",
        skuCode,
        sendValue,
        orgId,
      });
      const minSendValue = product.Minimum?.SendValue || 1;
      const minReceiveValue = product.Minimum?.ReceiveValue || minSendValue;
      const exchangeRate = minReceiveValue / minSendValue;
      costPrice = sendValue * exchangeRate;
    }
  } else {
    costPrice = product.Price?.Amount || product.Minimum?.SendValue || 0;
    sendValue = costPrice;

    if (costPrice <= 0) {
      throw new PricingResolutionError(400, "Invalid product pricing");
    }
  }

  // --- Markup from the organization's own pricing rules
  const pricingRules = await PricingRule.find({
    orgId,
    isActive: true,
  }).sort({ priority: -1 });

  let applicablePricingRule = null;
  for (const rule of pricingRules) {
    if (rule.isApplicableToCountry(countryIso)) {
      applicablePricingRule = rule;
      break;
    }
  }

  const markup = applicablePricingRule
    ? applicablePricingRule.calculateMarkup(costPrice)
    : 0;
  const customerPrice = costPrice + markup;

  // --- Discount from the organization's storefront settings
  const storefrontSettings = await StorefrontSettings.findOne({ orgId });

  let discountAmount = 0;
  let finalPrice = customerPrice;

  if (storefrontSettings?.discount?.enabled) {
    const now = new Date();
    const discount = storefrontSettings.discount;
    const isDateValid =
      (!discount.startDate || discount.startDate <= now) &&
      (!discount.endDate || discount.endDate >= now);
    const isCountryValid =
      !discount.applicableCountries ||
      discount.applicableCountries.length === 0 ||
      discount.applicableCountries.includes(countryIso);
    const isAmountValid =
      !discount.minPurchaseAmount || customerPrice >= discount.minPurchaseAmount;

    if (isDateValid && isCountryValid && isAmountValid) {
      discountAmount =
        discount.type === "percentage"
          ? customerPrice * (discount.value / 100)
          : discount.value;
      finalPrice = Math.max(0, customerPrice - discountAmount);
    }
  }

  logger.info("Server-side pricing resolved", {
    orgId,
    skuCode,
    isVariableValue,
    sendValue,
    costPrice,
    markup,
    customerPrice,
    discountAmount,
    finalPrice,
    pricingRuleName: applicablePricingRule?.name || "None",
  });

  return {
    product,
    providerName,
    isVariableValue,
    sendValue,
    costPrice,
    customerPrice,
    markup,
    discountAmount,
    finalPrice,
    pricingRuleName: applicablePricingRule?.name || "None",
    benefitAmount: product.BenefitTypes?.Airtime?.Amount || 0,
    benefitUnit: product.BenefitTypes?.Airtime?.Unit || "",
  };
}
