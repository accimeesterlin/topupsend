/**
 * Cluster 1 pins — confirmation binding (F-C2/F-C3/F-C4) and
 * server-side pricing (F-C1/F-C5).
 *
 * These tests FAIL on pristine sandbox (the helpers they exercise did
 * not exist / the client-pricing trust was live) and PASS on the fix
 * branch.
 */
import { PricingRule, StorefrontSettings } from "@topupsend/db";
import {
  amountsEqual,
  checkSubscriptionBinding,
  checkTransactionBinding,
  isVerificationCompleted,
  pgpayEventId,
} from "../services/pgpay-binding";
import { resolveServerSidePricing } from "../services/storefront-pricing.service";

jest.mock("@topupsend/db", () => ({
  PricingRule: { find: jest.fn() },
  StorefrontSettings: { findOne: jest.fn() },
}));

const mockPricingRuleFind = PricingRule.find as jest.Mock;
const mockSettingsFindOne = StorefrontSettings.findOne as jest.Mock;

describe("amountsEqual", () => {
  it("compares at cent precision", () => {
    expect(amountsEqual(10, 10)).toBe(true);
    expect(amountsEqual(10.001, 10.004)).toBe(true);
    expect(amountsEqual(10, 10.01)).toBe(false);
    expect(amountsEqual(0.01, 100)).toBe(false);
    expect(amountsEqual(undefined, 10)).toBe(false);
    expect(amountsEqual(10, undefined)).toBe(false);
  });
});

describe("isVerificationCompleted", () => {
  it("reads status only from the verification response", () => {
    expect(
      isVerificationCompleted({ status: "completed", paymentStatus: "" }),
    ).toBe(true);
    expect(
      isVerificationCompleted({ status: "pending", paymentStatus: "paid" }),
    ).toBe(true);
    expect(
      isVerificationCompleted({ status: "pending", paymentStatus: "pending" }),
    ).toBe(false);
    expect(
      isVerificationCompleted({ status: "failed", paymentStatus: "failed" }),
    ).toBe(false);
  });
});

describe("checkTransactionBinding (F-C4)", () => {
  const transaction = {
    amount: 25,
    metadata: { pgpayToken: "tok-stored" },
  };

  it("accepts the stored token with the exact amount", () => {
    expect(
      checkTransactionBinding({
        transaction,
        pgPayToken: "tok-stored",
        verification: { amount: 25 },
      }).ok,
    ).toBe(true);
  });

  it("rejects a valid-but-foreign token", () => {
    expect(
      checkTransactionBinding({
        transaction,
        pgPayToken: "tok-someone-elses-completed-payment",
        verification: { amount: 25 },
      }).ok,
    ).toBe(false);
  });

  it("rejects the right token with the wrong amount", () => {
    expect(
      checkTransactionBinding({
        transaction,
        pgPayToken: "tok-stored",
        verification: { amount: 0.01 },
      }).ok,
    ).toBe(false);
  });

  it("rejects when no token was stored", () => {
    expect(
      checkTransactionBinding({
        transaction: { amount: 25, metadata: {} },
        pgPayToken: "tok-stored",
        verification: { amount: 25 },
      }).ok,
    ).toBe(false);
  });
});

describe("checkSubscriptionBinding (F-C2)", () => {
  const organization = {
    subscription: {
      pendingUpgrade: {
        orderId: "sub-org-pro-3m-1",
        token: "tok-upgrade",
        amount: 267.3,
      },
    },
  };

  it("accepts the bound token + amount", () => {
    expect(
      checkSubscriptionBinding({
        organization,
        pgPayToken: "tok-upgrade",
        orderId: "sub-org-pro-3m-1",
        verification: { amount: 267.3 },
      }).ok,
    ).toBe(true);
  });

  it("rejects a foreign completed token (the F-C2 forgery)", () => {
    expect(
      checkSubscriptionBinding({
        organization,
        pgPayToken: "tok-cheap-completed-payment",
        orderId: "sub-org-pro-3m-1",
        verification: { amount: 267.3 },
      }).ok,
    ).toBe(false);
  });

  it("rejects a mismatched amount", () => {
    expect(
      checkSubscriptionBinding({
        organization,
        pgPayToken: "tok-upgrade",
        verification: { amount: 1 },
      }).ok,
    ).toBe(false);
  });

  it("fails closed when the pending upgrade stored no amount", () => {
    expect(
      checkSubscriptionBinding({
        organization: {
          subscription: {
            pendingUpgrade: { orderId: "x", token: "tok-upgrade" },
          },
        },
        pgPayToken: "tok-upgrade",
        verification: { amount: 267.3 },
      }).ok,
    ).toBe(false);
  });
});

describe("pgpayEventId (F-H12)", () => {
  it("is deterministic per token and never contains the token", () => {
    expect(pgpayEventId("tok-abc")).toBe(pgpayEventId("tok-abc"));
    expect(pgpayEventId("tok-abc")).not.toContain("tok-abc");
    expect(pgpayEventId("tok-abc")).not.toBe(pgpayEventId("tok-def"));
  });
});

describe("resolveServerSidePricing (F-C1)", () => {
  const fixedProduct = {
    SkuCode: "SKU-FIXED",
    ProviderCode: "OP1",
    Price: { Amount: 10, CurrencyCode: "USD" },
    Minimum: { SendValue: 10, ReceiveValue: 10, SendCurrencyIso: "USD" },
    Maximum: { SendValue: 10, ReceiveValue: 10, SendCurrencyIso: "USD" },
    Benefits: [],
  };

  const variableProduct = {
    SkuCode: "SKU-VAR",
    ProviderCode: "OP1",
    Minimum: { SendValue: 1, ReceiveValue: 1, SendCurrencyIso: "USD" },
    Maximum: { SendValue: 100, ReceiveValue: 100, SendCurrencyIso: "USD" },
    Benefits: [],
  };

  function fakeDingConnect(products: unknown[]) {
    return {
      getProducts: jest.fn().mockResolvedValue(products),
      getProviders: jest
        .fn()
        .mockResolvedValue([{ ProviderCode: "OP1", ProviderName: "Op One" }]),
      estimatePrices: jest
        .fn()
        .mockResolvedValue([{ Price: { DistributorFee: 8 } }]),
    } as never;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // 20% markup rule applicable everywhere; no storefront discount.
    mockPricingRuleFind.mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        {
          name: "Standard 20%",
          isApplicableToCountry: () => true,
          calculateMarkup: (cost: number) => cost * 0.2,
        },
      ]),
    });
    mockSettingsFindOne.mockResolvedValue({ discount: { enabled: false } });
  });

  it("derives the fixed price from the catalog + markup, ignoring any client price", async () => {
    const resolved = await resolveServerSidePricing({
      orgId: "org1",
      skuCode: "SKU-FIXED",
      countryIso: "HT",
      dingConnect: fakeDingConnect([fixedProduct]),
    });

    expect(resolved.costPrice).toBe(10);
    expect(resolved.finalPrice).toBe(12); // 10 + 20% — never a client $0.01
    expect(resolved.sendValue).toBe(10);
    expect(resolved.isVariableValue).toBe(false);
  });

  it("prices a variable product from EstimatePrices DistributorFee", async () => {
    const resolved = await resolveServerSidePricing({
      orgId: "org1",
      skuCode: "SKU-VAR",
      countryIso: "HT",
      requestedSendValue: 10,
      dingConnect: fakeDingConnect([variableProduct]),
    });

    expect(resolved.isVariableValue).toBe(true);
    expect(resolved.costPrice).toBe(8); // DistributorFee, not the send value
    expect(resolved.finalPrice).toBeCloseTo(9.6);
    expect(resolved.sendValue).toBe(10);
  });

  it("rejects a variable send value outside the catalog range", async () => {
    await expect(
      resolveServerSidePricing({
        orgId: "org1",
        skuCode: "SKU-VAR",
        countryIso: "HT",
        requestedSendValue: 500,
        dingConnect: fakeDingConnect([variableProduct]),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404s an unknown SKU instead of trusting client product data", async () => {
    await expect(
      resolveServerSidePricing({
        orgId: "org1",
        skuCode: "SKU-DOES-NOT-EXIST",
        countryIso: "HT",
        dingConnect: fakeDingConnect([fixedProduct]),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
