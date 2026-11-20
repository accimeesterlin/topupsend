/**
 * Cluster 4 pins — input-type sweep (F-H5, F-M15).
 *
 * Public routes fed raw JSON values into Mongo queries. An object
 * value such as {"$ne": null} acts as a query operator and matches
 * an arbitrary record. Every pin posts an object where a string is
 * required: on pristine the value reaches a `findOne` (or beyond);
 * on the fix branch the route answers 400 before any lookup.
 *
 * Controls (ordinary string inputs) PASS on both branches.
 */
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockVerifyPayment = jest.fn();
const mockDing = {
  getProducts: jest.fn(),
  getProviders: jest.fn(),
  getBalance: jest.fn(),
  estimatePrices: jest.fn(),
};

jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      __body: body,
    }),
  },
}));

jest.mock("@/lib/api-response", () => ({
  createSuccessResponse: (data: unknown) => ({
    __ok: true,
    ...(data as object),
  }),
  createCreatedResponse: (data: unknown) => ({
    __ok: true,
    ...(data as object),
  }),
  createErrorResponse: (message: string, status: number) => ({
    __ok: false,
    message,
    status,
  }),
}));

jest.mock(
  "@topupsend/db/connection",
  () => ({
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  }),
  { virtual: true },
);
jest.mock("../../../packages/db/src/connection", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  Transaction: Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      _id: "tx-new",
      save: jest.fn().mockResolvedValue(undefined),
    })),
    { findOne: jest.fn() },
  ),
  Organization: {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  },
  Org: { findOne: jest.fn() },
  Discount: { findOne: jest.fn() },
  Integration: { findOne: jest.fn() },
  StorefrontSettings: { findOne: jest.fn() },
  PaymentProvider: { findOne: jest.fn() },
  PricingRule: { find: jest.fn() },
  WebhookLog: { findOne: jest.fn() },
}));

jest.mock("@/lib/services/pgpay.service", () => ({
  PGPayService: jest.fn().mockImplementation(() => ({
    verifyPayment: mockVerifyPayment,
  })),
  createPGPayService: jest.fn(() => ({
    verifyPayment: mockVerifyPayment,
    createPayment: jest.fn(),
    getCheckoutUrl: (token: string) => `https://pay.example/${token}`,
  })),
}));

jest.mock("@/lib/services/dingconnect.service", () => ({
  createDingConnectService: jest.fn(() => mockDing),
}));

jest.mock("@/lib/services/webhook-logging.service", () => ({
  webhookLoggingService: {
    logIncoming: jest.fn().mockResolvedValue({ _id: "log1" }),
    markSuccess: jest.fn(),
    markFailed: jest.fn(),
  },
}));

jest.mock("@/lib/services/fulfillment.service", () => ({
  fulfillPaidTransaction: jest.fn(),
}));

jest.mock("@/lib/services/manual-payment.service", () => ({
  isManuallyPaidTransaction: jest.fn(() => false),
}));

jest.mock("@/lib/services/usage-tracking.service", () => ({
  checkTransactionLimit: jest.fn().mockResolvedValue({ allowed: true }),
  trackTransactionCompletion: jest.fn(),
}));

jest.mock("awesome-phonenumber", () => ({
  parsePhoneNumber: jest.fn(() => ({ valid: false })),
}));

jest.mock("i18n-iso-countries", () => ({
  __esModule: true,
  default: {
    registerLocale: jest.fn(),
    getName: jest.fn(() => undefined),
  },
}));

jest.mock("i18n-iso-countries/langs/en.json", () => ({}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------
import {
  Discount,
  Integration,
  Org,
  Organization,
  StorefrontSettings,
  Transaction,
} from "@topupsend/db";
import { POST as paymentsVerifyPOST } from "../../app/api/v1/payments/verify/route";
import { POST as subscriptionsVerifyPOST } from "../../app/api/v1/subscriptions/verify/route";
import { POST as pgpayWebhookPOST } from "../../app/api/v1/webhooks/pgpay/route";
import { POST as pgpaySubWebhookPOST } from "../../app/api/v1/webhooks/pgpay/subscription/route";
import { POST as discountsValidatePOST } from "../../app/api/v1/discounts/validate/route";
import { POST as estimatePOST } from "../../app/api/v1/estimate/route";
import { POST as lookupPhonePOST } from "../../app/api/v1/lookup/phone/route";
import { POST as paymentsProcessPOST } from "../../app/api/v1/payments/process/route";

const mockTransactionFindOne = Transaction.findOne as jest.Mock;
const mockOrganizationFindOne = Organization.findOne as jest.Mock;
const mockOrgFindOne = Org.findOne as jest.Mock;
const mockDiscountFindOne = Discount.findOne as jest.Mock;
const mockIntegrationFindOne = Integration.findOne as jest.Mock;
const mockSettingsFindOne = StorefrontSettings.findOne as jest.Mock;

const OPERATOR = { $ne: null };

function fakeRequest(body: unknown) {
  return {
    url: "http://localhost/api/v1/test",
    nextUrl: { origin: "http://localhost" },
    json: jest.fn().mockResolvedValue(body),
    headers: { get: () => null },
  } as unknown as NextRequest;
}

type Res = { __ok?: boolean; status?: number | string; message?: string };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PGPAY_USER_ID = "user-1";
  process.env.PGPAY_API_KEY = "key-1";
});

// ---------------------------------------------------------------------------
// F-H5: payments/verify
// ---------------------------------------------------------------------------
describe("payments/verify — operator injection (F-H5)", () => {
  const completedTx = {
    orderId: "ORD-1",
    status: "completed",
    amount: 12,
    currency: "USD",
    metadata: {},
    recipient: { name: "Victim", phoneNumber: "+50937000000" },
  };

  it("pin: object orderId is 400 and never reaches the transaction query", async () => {
    mockTransactionFindOne.mockResolvedValue(completedTx);

    const res = (await paymentsVerifyPOST(
      fakeRequest({ orderId: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockTransactionFindOne).not.toHaveBeenCalled();
  });

  it("pin: object pgPayToken is 400 and never reaches the transaction query", async () => {
    mockTransactionFindOne.mockResolvedValue({
      ...completedTx,
      status: "pending",
    });

    const res = (await paymentsVerifyPOST(
      fakeRequest({ orderId: "ORD-1", pgPayToken: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockTransactionFindOne).not.toHaveBeenCalled();
  });

  it("control: string orderId for a completed transaction returns its status", async () => {
    mockTransactionFindOne.mockResolvedValue(completedTx);

    const res = (await paymentsVerifyPOST(
      fakeRequest({ orderId: "ORD-1" }),
    )) as Res;

    expect(res.__ok).toBe(true);
    expect(res.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// F-H5: subscriptions/verify
// ---------------------------------------------------------------------------
describe("subscriptions/verify — operator injection (F-H5)", () => {
  const orgWithPending = {
    _id: "org1",
    subscriptionTier: "free",
    subscription: {
      pendingUpgrade: {
        orderId: "sub-1",
        token: "tok-real",
        tier: "pro",
        months: 3,
        amount: 267.3,
      },
      lastPayment: undefined,
    },
  };

  it("pin: object orderId is 400 and never reaches the organization query", async () => {
    mockOrganizationFindOne.mockResolvedValue(orgWithPending);

    const res = (await subscriptionsVerifyPOST(
      fakeRequest({ orderId: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockOrganizationFindOne).not.toHaveBeenCalled();
  });

  it("pin: object pgPayToken is 400 and never reaches the organization query", async () => {
    mockOrganizationFindOne.mockResolvedValue(orgWithPending);

    const res = (await subscriptionsVerifyPOST(
      fakeRequest({ orderId: "sub-1", pgPayToken: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockOrganizationFindOne).not.toHaveBeenCalled();
  });

  it("control: string orderId with no token reports pending", async () => {
    mockOrganizationFindOne.mockResolvedValue(orgWithPending);

    const res = (await subscriptionsVerifyPOST(
      fakeRequest({ orderId: "sub-1" }),
    )) as Res;

    expect(res.__ok).toBe(true);
    expect(res.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// F-H5: webhooks/pgpay
// ---------------------------------------------------------------------------
describe("webhooks/pgpay — operator injection (F-H5)", () => {
  it("pin: object pgPayToken is 400 and never reaches the transaction query", async () => {
    mockTransactionFindOne.mockResolvedValue(null);

    const res = (await pgpayWebhookPOST(
      fakeRequest({ pgPayToken: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockTransactionFindOne).not.toHaveBeenCalled();
  });

  it("pin: object orderId is 400 and never reaches the transaction query", async () => {
    mockTransactionFindOne.mockResolvedValue(null);

    const res = (await pgpayWebhookPOST(
      fakeRequest({ pgPayToken: "tok-1", orderId: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockTransactionFindOne).not.toHaveBeenCalled();
  });

  it("control: an unknown string token is a plain 404", async () => {
    mockTransactionFindOne.mockResolvedValue(null);

    const res = (await pgpayWebhookPOST(
      fakeRequest({ pgPayToken: "tok-unknown" }),
    )) as Res;

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// F-H5: webhooks/pgpay/subscription
// ---------------------------------------------------------------------------
describe("webhooks/pgpay/subscription — operator injection (F-H5)", () => {
  it("pin: object pgPayToken is 400 before any verification or lookup", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "pending",
      paymentStatus: "pending",
    });
    mockOrganizationFindOne.mockResolvedValue(null);

    const res = (await pgpaySubWebhookPOST(
      fakeRequest({ pgPayToken: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockVerifyPayment).not.toHaveBeenCalled();
    expect(mockOrganizationFindOne).not.toHaveBeenCalled();
  });

  it("control: a string token is verified and looked up as before", async () => {
    mockVerifyPayment.mockResolvedValue({
      status: "pending",
      paymentStatus: "pending",
    });
    mockOrganizationFindOne.mockResolvedValue(null);

    const res = (await pgpaySubWebhookPOST(
      fakeRequest({ pgPayToken: "tok-real" }),
    )) as Res;

    expect(mockVerifyPayment).toHaveBeenCalledTimes(1);
    expect(mockOrganizationFindOne).toHaveBeenCalled();
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// F-M15: discounts/validate orgSlug
// ---------------------------------------------------------------------------
describe("discounts/validate — orgSlug injection (F-M15)", () => {
  it("pin: object orgSlug is 400 and never reaches the org lookup", async () => {
    mockOrgFindOne.mockResolvedValue({ _id: "org1", name: "Acme" });
    mockDiscountFindOne.mockResolvedValue(null);

    const res = (await discountsValidatePOST(
      fakeRequest({ code: "SAVE10", orgSlug: OPERATOR, amount: 50 }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockOrgFindOne).not.toHaveBeenCalled();
  });

  it("control: a valid string slug + code validates the discount", async () => {
    mockOrgFindOne.mockResolvedValue({ _id: "org1", name: "Acme" });
    (Organization.findOne as jest.Mock).mockResolvedValue(null);
    mockDiscountFindOne.mockResolvedValue({
      _id: "disc1",
      code: "SAVE10",
      name: "Sale",
      description: "",
      type: "percentage",
      value: 10,
      isActive: true,
      isValid: () => true,
      calculateDiscount: (amount: number) => amount * 0.1,
      applicableCountries: [],
      applicableProducts: [],
      minPurchaseAmount: 0,
      usageLimit: undefined,
      usageCount: 0,
      startDate: undefined,
      endDate: undefined,
    });

    const res = (await discountsValidatePOST(
      fakeRequest({ code: "SAVE10", orgSlug: "acme", amount: 50 }),
    )) as Res & { valid?: boolean };

    expect(res.__ok).toBe(true);
    expect(res.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-M15: estimate orgSlug
// ---------------------------------------------------------------------------
describe("estimate — orgSlug injection (F-M15)", () => {
  function wireEstimate() {
    mockOrgFindOne.mockResolvedValue({ _id: "org1" });
    (Organization.findOne as jest.Mock).mockResolvedValue(null);
    mockIntegrationFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ credentials: { apiKey: "ding" } }),
    });
    mockDing.estimatePrices.mockResolvedValue([
      {
        SkuCode: "SKU1",
        Price: {
          SendValue: 10,
          ReceiveValue: 9.5,
          SendCurrencyIso: "USD",
          ReceiveCurrencyIso: "HTG",
        },
      },
    ]);
  }

  it("pin: object orgSlug is 400 and never reaches the org lookup", async () => {
    wireEstimate();

    const res = (await estimatePOST(
      fakeRequest({ orgSlug: OPERATOR, skuCode: "SKU1", sendValue: 10 }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockOrgFindOne).not.toHaveBeenCalled();
  });

  it("control: a string slug returns a price estimate", async () => {
    wireEstimate();

    const res = (await estimatePOST(
      fakeRequest({ orgSlug: "acme", skuCode: "SKU1", sendValue: 10 }),
    )) as Res & { sendValue?: number };

    expect(res.__ok).toBe(true);
    expect(res.sendValue).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// F-M15: lookup/phone orgSlug
// ---------------------------------------------------------------------------
describe("lookup/phone — orgSlug injection (F-M15)", () => {
  it("pin: object orgSlug is 400 and never reaches the org lookup", async () => {
    mockOrgFindOne.mockResolvedValue({ _id: "org1" });
    (Organization.findOne as jest.Mock).mockResolvedValue(null);
    mockSettingsFindOne.mockResolvedValue(null);

    const res = (await lookupPhonePOST(
      fakeRequest({ phoneNumber: "+50937000000", orgSlug: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(res.message).toMatch(/slug/i);
    expect(mockOrgFindOne).not.toHaveBeenCalled();
  });

  it("control: an unknown string slug is a plain 404 org lookup", async () => {
    mockOrgFindOne.mockResolvedValue(null);
    (Organization.findOne as jest.Mock).mockResolvedValue(null);

    const res = (await lookupPhonePOST(
      fakeRequest({ phoneNumber: "+50937000000", orgSlug: "acme" }),
    )) as Res;

    expect(res.status).toBe(404);
    expect(mockOrgFindOne).toHaveBeenCalledWith({ slug: "acme" });
  });
});

// ---------------------------------------------------------------------------
// F-M15: payments/process orgSlug
// ---------------------------------------------------------------------------
describe("payments/process — orgSlug injection (F-M15)", () => {
  const checkoutBody = {
    phoneNumber: "+50937000000",
    product: { skuCode: "SKU1" },
    customerEmail: "buyer@example.com",
    paymentMethod: "pgpay",
  };

  it("pin: object orgSlug is 400 and never reaches the org lookup", async () => {
    mockOrgFindOne.mockResolvedValue({ _id: "org1", name: "Acme" });

    const res = (await paymentsProcessPOST(
      fakeRequest({ ...checkoutBody, orgSlug: OPERATOR }),
    )) as Res;

    expect(res.status).toBe(400);
    expect(mockOrgFindOne).not.toHaveBeenCalled();
  });

  it("control: an unknown string slug is a plain 404 org lookup", async () => {
    mockOrgFindOne.mockResolvedValue(null);
    (Organization.findOne as jest.Mock).mockResolvedValue(null);

    const res = (await paymentsProcessPOST(
      fakeRequest({ ...checkoutBody, orgSlug: "acme" }),
    )) as Res;

    expect(res.status).toBe(404);
    expect(mockOrgFindOne).toHaveBeenCalledWith({
      slug: "acme",
      isActive: true,
    });
  });
});
