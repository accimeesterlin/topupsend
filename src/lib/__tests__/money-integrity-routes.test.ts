/**
 * Cluster 1 pins — route level.
 *
 * - Public checkout with a tampered body price still charges the
 *   server-derived amount (F-C1).
 * - Subscription verify with a valid-but-foreign token, or a token
 *   whose amount differs, does NOT activate (F-C2).
 * - Subscription webhook with a forged body status does not activate
 *   (F-C3).
 * - Scheduled-topups job does not start unless the env flag is
 *   exactly 'true' (scheduling kill-switch).
 *
 * All FAIL on pristine sandbox, PASS on the fix branch.
 */
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockVerifyPayment = jest.fn();
const mockCreatePayment = jest.fn();
const mockGetCheckoutUrl = jest.fn((token: string) => `https://pay.example/${token}`);

jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: class {},
}));

jest.mock("@/lib/api-response", () => ({
  createSuccessResponse: (data: unknown) => ({ __ok: true, ...(data as object) }),
  createErrorResponse: (message: string, status: number) => ({
    __ok: false,
    message,
    status,
  }),
}));

jest.mock("@/lib/services/pgpay.service", () => ({
  PGPayService: jest.fn().mockImplementation(() => ({
    verifyPayment: mockVerifyPayment,
  })),
  createPGPayService: jest.fn(() => ({
    createPayment: mockCreatePayment,
    verifyPayment: mockVerifyPayment,
    getCheckoutUrl: mockGetCheckoutUrl,
  })),
}));

const mockDing = {
  getProducts: jest.fn(),
  getProviders: jest.fn(),
  getBalance: jest.fn(),
  estimatePrices: jest.fn(),
};

jest.mock("@/lib/services/dingconnect.service", () => ({
  createDingConnectService: jest.fn(() => mockDing),
}));

jest.mock("@/lib/services/usage-tracking.service", () => ({
  checkTransactionLimit: jest.fn().mockResolvedValue({ allowed: true }),
  trackTransactionCompletion: jest.fn(),
}));

jest.mock("@/lib/services/webhook-logging.service", () => ({
  webhookLoggingService: {
    logIncoming: jest.fn().mockResolvedValue({ _id: "log1" }),
    markSuccess: jest.fn(),
    markFailed: jest.fn(),
  },
}));

jest.mock("node-cron", () => ({
  __esModule: true,
  default: { schedule: jest.fn() },
}));
jest.mock("@/lib/services/scheduled-topups.service", () => ({
  processScheduledTopups: jest.fn(),
}));

// DB mock — self-contained factory (jest factories cannot reference
// outer consts); test references are pulled from the mocked module.
let mockLastTransactionCtorArgs: Record<string, unknown> | null = null;

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  Org: { findOne: jest.fn() },
  Organization: {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
  Transaction: Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => {
      mockLastTransactionCtorArgs = data;
      return {
        ...data,
        _id: "tx-new",
        orderId: "ORD-NEW",
        save: jest.fn().mockResolvedValue(undefined),
      };
    }),
    { findOne: jest.fn() },
  ),
  Integration: { findOne: jest.fn() },
  PaymentProvider: { findOne: jest.fn() },
  StorefrontSettings: { findOne: jest.fn() },
  PricingRule: { find: jest.fn() },
  WebhookLog: { findOne: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------
import {
  Integration,
  Org,
  Organization,
  PaymentProvider,
  PricingRule,
  StorefrontSettings,
  Transaction,
  WebhookLog,
} from "@topupsend/db";
import cron from "node-cron";
import { POST as paymentsProcessPOST } from "../../app/api/v1/payments/process/route";
import { POST as subscriptionVerifyPOST } from "../../app/api/v1/subscriptions/verify/route";
import { POST as subscriptionWebhookPOST } from "../../app/api/v1/webhooks/pgpay/subscription/route";
import { initScheduledTopupsJob } from "../jobs/scheduled-topups.job";

const mockOrgFindOne = Org.findOne as jest.Mock;
const mockOrganizationFindOne = Organization.findOne as jest.Mock;
const mockOrganizationFindByIdAndUpdate =
  Organization.findByIdAndUpdate as jest.Mock;
const mockTransactionFindOne = Transaction.findOne as jest.Mock;
const mockIntegrationFindOne = Integration.findOne as jest.Mock;
const mockPaymentProviderFindOne = PaymentProvider.findOne as jest.Mock;
const mockSettingsFindOne = StorefrontSettings.findOne as jest.Mock;
const mockPricingRuleFind = PricingRule.find as jest.Mock;
const mockWebhookLogFindOne = WebhookLog.findOne as jest.Mock;
const mockCronSchedule = cron.schedule as jest.Mock;

function fakeRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: jest.fn().mockResolvedValue(body),
    headers: {
      get: (name: string) =>
        headers[name.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLastTransactionCtorArgs = null;
  process.env.PGPAY_USER_ID = "user-1";
  process.env.PGPAY_API_KEY = "key-1";
});

// ---------------------------------------------------------------------------
// F-C1: tampered public-checkout price
// ---------------------------------------------------------------------------
describe("payments/process — tampered body price (F-C1)", () => {
  it("charges the server-derived amount, not the client's $0.01", async () => {
    mockOrgFindOne.mockResolvedValue(null);
    mockOrganizationFindOne.mockResolvedValue({ _id: "org1" });
    mockSettingsFindOne.mockResolvedValue({ isActive: true, discount: { enabled: false } });
    mockIntegrationFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ credentials: { apiKey: "ding" } }),
    });
    mockTransactionFindOne.mockResolvedValue(null);
    mockPaymentProviderFindOne.mockResolvedValue({
      credentials: { userId: "u", merchantId: "m", apiKey: "k" },
      environment: "sandbox",
    });
    // 20% markup rule
    mockPricingRuleFind.mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        {
          name: "Std",
          isApplicableToCountry: () => true,
          calculateMarkup: (cost: number) => cost * 0.2,
        },
      ]),
    });
    // Catalog: fixed product, real price $10
    mockDing.getProducts.mockResolvedValue([
      {
        SkuCode: "SKU-FIXED",
        ProviderCode: "OP1",
        Price: { Amount: 10, CurrencyCode: "USD" },
        Minimum: { SendValue: 10, ReceiveValue: 10, SendCurrencyIso: "USD" },
        Maximum: { SendValue: 10, ReceiveValue: 10, SendCurrencyIso: "USD" },
        Benefits: [],
      },
    ]);
    mockDing.getProviders.mockResolvedValue([
      { ProviderCode: "OP1", ProviderName: "Op One" },
    ]);
    mockDing.getBalance.mockResolvedValue({
      AccountBalance: 1000,
      CurrencyCode: "USD",
    });
    mockCreatePayment.mockResolvedValue({
      token: "tok-new",
      orderId: "pg-ord-1",
      redirectUrl: "https://pay.example/tok-new",
    });

    const response = (await paymentsProcessPOST(
      fakeRequest(
        {
          orgSlug: "store",
          phoneNumber: "+50937000000",
          customerEmail: "buyer@example.com",
          paymentMethod: "pgpay",
          // TAMPERED product payload: attacker names a $0.01 price
          product: {
            skuCode: "SKU-FIXED",
            isVariableValue: false,
            pricing: { finalPrice: 0.01, costPrice: 0.01 },
          },
        },
        { origin: "https://store.example" },
      ),
    )) as unknown as Record<string, unknown>;

    expect(response.__ok).toBe(true);
    // The transaction was created at the SERVER-DERIVED price: $10 + 20%
    expect(mockLastTransactionCtorArgs?.amount).toBeCloseTo(12);
    // And PGPay was asked to collect $12 — not $0.01
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment.mock.calls[0][0].amount).toBeCloseTo(12);
  });
});

// ---------------------------------------------------------------------------
// F-C2: subscription verify binding
// ---------------------------------------------------------------------------
describe("subscriptions/verify — binding (F-C2)", () => {
  const orgWithPending = {
    _id: "org1",
    subscriptionTier: "free",
    subscription: {
      pendingUpgrade: {
        orderId: "sub-org1-pro-3m-1",
        token: "tok-real",
        tier: "pro",
        months: 3,
        amount: 267.3,
      },
      lastPayment: undefined,
    },
  };

  function activationCalls() {
    return mockOrganizationFindByIdAndUpdate.mock.calls.filter(
      ([, update]) =>
        JSON.stringify(update).includes('"subscription.status":"active"') ||
        JSON.stringify(update).includes("subscriptionTier"),
    );
  }

  beforeEach(() => {
    mockOrganizationFindOne.mockResolvedValue(orgWithPending);
    mockOrganizationFindByIdAndUpdate.mockResolvedValue({});
  });

  it("a valid-but-foreign completed token does NOT activate", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "completed",
      paymentStatus: "paid",
      amount: 267.3,
      orderId: "pg-foreign",
      metadata: { organizationId: "org1", tier: "enterprise", months: 12 },
    });

    const response = (await subscriptionVerifyPOST(
      fakeRequest({ orderId: "sub-org1-pro-3m-1", pgPayToken: "tok-foreign" }),
    )) as unknown as Record<string, unknown>;

    expect(response.status).not.toBe("completed");
    expect(activationCalls()).toHaveLength(0);
  });

  it("the right token with the wrong amount does NOT activate", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "completed",
      paymentStatus: "paid",
      amount: 1.0,
      orderId: "pg-1",
    });

    const response = (await subscriptionVerifyPOST(
      fakeRequest({ orderId: "sub-org1-pro-3m-1", pgPayToken: "tok-real" }),
    )) as unknown as Record<string, unknown>;

    expect(response.status).not.toBe("completed");
    expect(activationCalls()).toHaveLength(0);
  });

  it("the bound token + amount DOES activate, with server-side tier/months", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "completed",
      paymentStatus: "paid",
      amount: 267.3,
      orderId: "pg-1",
      metadata: { tier: "enterprise", months: 12 }, // must be ignored
    });

    const response = (await subscriptionVerifyPOST(
      fakeRequest({ orderId: "sub-org1-pro-3m-1", pgPayToken: "tok-real" }),
    )) as unknown as Record<string, unknown>;

    expect(response.status).toBe("completed");
    expect(response.tier).toBe("pro"); // from the pending upgrade, not metadata
    expect(response.prepaidMonths).toBe(3);
    expect(activationCalls().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// F-C3: subscription webhook forged body status
// ---------------------------------------------------------------------------
describe("webhooks/pgpay/subscription — forged body status (F-C3)", () => {
  const orgWithPending = {
    _id: "org1",
    subscription: {
      pendingUpgrade: {
        orderId: "sub-org1-pro-3m-1",
        token: "tok-real",
        tier: "pro",
        months: 3,
        amount: 267.3,
      },
    },
  };

  beforeEach(() => {
    mockOrganizationFindOne.mockResolvedValue(orgWithPending);
    mockOrganizationFindByIdAndUpdate.mockResolvedValue({});
    mockWebhookLogFindOne.mockResolvedValue(null);
  });

  it("body status 'completed' with a pending verification does NOT activate", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "pending",
      paymentStatus: "pending",
      amount: 267.3,
    });

    await subscriptionWebhookPOST(
      fakeRequest({
        pgPayToken: "tok-real",
        orderId: "sub-org1-pro-3m-1",
        status: "completed", // forged
      }),
    );

    const activations = mockOrganizationFindByIdAndUpdate.mock.calls.filter(
      ([, update]) => JSON.stringify(update).includes("subscriptionTier"),
    );
    expect(activations).toHaveLength(0);
  });

  it("verified completed with a mismatched amount does NOT activate", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "completed",
      paymentStatus: "paid",
      amount: 0.5,
    });

    const response = (await subscriptionWebhookPOST(
      fakeRequest({
        pgPayToken: "tok-real",
        orderId: "sub-org1-pro-3m-1",
        status: "completed",
      }),
    )) as unknown as Record<string, unknown>;

    expect(response.__ok).toBe(false);
    expect(response.status).toBe(400);
    const activations = mockOrganizationFindByIdAndUpdate.mock.calls.filter(
      ([, update]) => JSON.stringify(update).includes("subscriptionTier"),
    );
    expect(activations).toHaveLength(0);
  });

  it("verified completed + bound amount DOES activate", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "completed",
      paymentStatus: "paid",
      amount: 267.3,
    });

    await subscriptionWebhookPOST(
      fakeRequest({
        pgPayToken: "tok-real",
        orderId: "sub-org1-pro-3m-1",
        status: "pending", // body lies the other way; verification rules
      }),
    );

    const activations = mockOrganizationFindByIdAndUpdate.mock.calls.filter(
      ([, update]) => JSON.stringify(update).includes("subscriptionTier"),
    );
    expect(activations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scheduling kill-switch
// ---------------------------------------------------------------------------
describe("scheduled-topups job kill-switch", () => {
  const original = process.env.SCHEDULED_TOPUPS_ENABLED;

  afterAll(() => {
    if (original === undefined) {
      delete process.env.SCHEDULED_TOPUPS_ENABLED;
    } else {
      process.env.SCHEDULED_TOPUPS_ENABLED = original;
    }
  });

  it("does not start when the flag is unset", () => {
    delete process.env.SCHEDULED_TOPUPS_ENABLED;
    initScheduledTopupsJob();
    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  it("does not start when the flag is 'false' or any non-'true' value", () => {
    process.env.SCHEDULED_TOPUPS_ENABLED = "false";
    initScheduledTopupsJob();
    process.env.SCHEDULED_TOPUPS_ENABLED = "1";
    initScheduledTopupsJob();
    process.env.SCHEDULED_TOPUPS_ENABLED = "TRUE";
    initScheduledTopupsJob();
    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  it("starts only when the flag is exactly 'true'", () => {
    process.env.SCHEDULED_TOPUPS_ENABLED = "true";
    initScheduledTopupsJob();
    expect(mockCronSchedule).toHaveBeenCalledTimes(1);
  });
});
