/**
 * @jest-environment node
 *
 * (Node environment so `jose`/`next/server` resolve to their Node
 * builds — under jsdom they resolve to untransformed ESM browser
 * builds and suites importing them fail to load.)
 *
 * Partner API pins (POST/GET /api/v1/partner/*):
 * - Requests without an API key are rejected (401); a key missing
 *   the required scope is rejected (403). The REAL
 *   requireApiKeyWithScope middleware runs — only persistence and
 *   the provider are mocked.
 * - The key's orgId binds every query; no org id comes from the body.
 * - POST /partner/topups requires Idempotency-Key and replays the
 *   existing transaction for a repeated key instead of re-sending.
 * - Pricing is resolved server-side; a partner send creates NO
 *   customer and is attributed to the API key (paymentGateway
 *   "partner", createdBy = key id).
 * - testMode: true forces DingConnect ValidateOnly even when the
 *   storefront flag is off.
 * - GET /partner/topups/[orderId] reads only the key's org (404
 *   otherwise) and live-settles a "processing" transaction first.
 */
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Shared mock state (mock-prefixed so jest.mock factories may use it)
// ---------------------------------------------------------------------------

const mockDing = {
  getProducts: jest.fn(),
  getProviders: jest.fn(),
  getBalance: jest.fn(),
  estimatePrices: jest.fn(),
  sendTransfer: jest.fn(),
  getTransferStatus: jest.fn(),
};

const mockLookupPOST = jest.fn();
const mockPollTransferStatus = jest.fn();
const mockSettleStuckTransfer = jest.fn();

let mockKeyScopes: string[] = ["topup:send", "transactions:read"];
let mockKeyOwnerType = "staff";
let mockKeyFound = true;
let mockLastTransactionCtorArgs: Record<string, unknown> | null = null;

jest.mock("@/lib/services/dingconnect.service", () => ({
  createDingConnectService: jest.fn(() => mockDing),
}));

jest.mock("../../app/api/v1/lookup/phone/route", () => ({
  // Closure so the mock fn is only dereferenced at call time
  // (jest.mock factories run before the consts above initialize).
  POST: (...args: unknown[]) => mockLookupPOST(...args),
}));

jest.mock("@/lib/services/fulfillment.service", () => ({
  pollTransferStatus: (...args: unknown[]) => mockPollTransferStatus(...args),
  settleStuckTransfer: (...args: unknown[]) =>
    mockSettleStuckTransfer(...args),
  // Same rule as the real implementation: only an HTTP 4xx from
  // DingConnect itself is a definite rejection.
  isDefiniteProviderRejection: (error: unknown) =>
    /DingConnect API Error: 4\d{2}\b/.test(
      error instanceof Error ? error.message : String(error),
    ),
}));

jest.mock("@/lib/services/usage-tracking.service", () => ({
  checkTransactionLimit: jest
    .fn()
    .mockResolvedValue({ allowed: true, limit: 200 }),
  trackTransactionCompletion: jest.fn(),
}));

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  ApiKey: {
    findOne: jest.fn(() => ({
      select: jest.fn().mockImplementation(async () => {
        if (!mockKeyFound) return null;
        return {
          _id: "key1",
          orgId: "org1",
          ownerId: "owner1",
          ownerType: mockKeyOwnerType,
          scopes: mockKeyScopes,
          expiresAt: undefined,
          isActive: true,
          getRateLimit: () => ({ requests: 1000, window: 3600 }),
          validateScope: (required: string | string[]) => {
            if (mockKeyScopes.includes("admin:*")) return true;
            const req = Array.isArray(required) ? required : [required];
            return req.every((s) => mockKeyScopes.includes(s));
          },
          incrementUsage: jest.fn().mockResolvedValue(undefined),
        };
      }),
    })),
  },
  User: { findById: jest.fn() },
  Customer: { findById: jest.fn() },
  Org: { findById: jest.fn(), findOne: jest.fn() },
  Organization: { findById: jest.fn(), findOne: jest.fn() },
  Integration: { findOne: jest.fn() },
  StorefrontSettings: { findOne: jest.fn() },
  PricingRule: { find: jest.fn() },
  Discount: { find: jest.fn() },
  Transaction: Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => {
      mockLastTransactionCtorArgs = data;
      return {
        ...data,
        _id: "tx-new",
        orderId: "ORD-NEW",
        timeline: (data.timeline as Record<string, unknown>) || {},
        metadata: (data.metadata as Record<string, unknown>) || {},
        save: jest.fn().mockResolvedValue(undefined),
      };
    }),
    { findOne: jest.fn() },
  ),
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------
import {
  Integration,
  Org,
  PricingRule,
  StorefrontSettings,
  Transaction,
} from "@topupsend/db";
import { POST as lookupPOST } from "../../app/api/v1/partner/lookup/route";
import { GET as providersGET } from "../../app/api/v1/partner/providers/route";
import { POST as topupsPOST } from "../../app/api/v1/partner/topups/route";
import { GET as topupStatusGET } from "../../app/api/v1/partner/topups/[orderId]/route";

const mockOrgFindById = Org.findById as jest.Mock;
const mockIntegrationFindOne = Integration.findOne as jest.Mock;
const mockSettingsFindOne = StorefrontSettings.findOne as jest.Mock;
const mockPricingRuleFind = PricingRule.find as jest.Mock;
const mockTransactionFindOne = Transaction.findOne as jest.Mock;
const MockTransaction = Transaction as unknown as jest.Mock;

const API_KEY_HEADERS = { "x-api-key": "sk_live_testkey" };

function postRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "GET", headers });
}

function integrationOk() {
  mockIntegrationFindOne.mockReturnValue({
    select: jest
      .fn()
      .mockResolvedValue({ credentials: { apiKey: "ding-key" } }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockKeyScopes = ["topup:send", "transactions:read"];
  mockKeyOwnerType = "staff";
  mockKeyFound = true;
  mockLastTransactionCtorArgs = null;
});

// ---------------------------------------------------------------------------
// Auth rejection
// ---------------------------------------------------------------------------
describe("partner API — auth", () => {
  it("rejects a topup send with no API key (401)", async () => {
    const response = await topupsPOST(
      postRequest("http://localhost/api/v1/partner/topups", {
        phoneNumber: "+50934748112",
        skuCode: "SKU1",
      }),
    );

    expect(response.status).toBe(401);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key (401)", async () => {
    mockKeyFound = false;

    const response = await topupsPOST(
      postRequest(
        "http://localhost/api/v1/partner/topups",
        { phoneNumber: "+50934748112", skuCode: "SKU1" },
        { ...API_KEY_HEADERS, "idempotency-key": "idem-x" },
      ),
    );

    expect(response.status).toBe(401);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
  });

  it("rejects a key without the topup:send scope (403)", async () => {
    mockKeyScopes = ["transactions:read"];

    const response = await topupsPOST(
      postRequest(
        "http://localhost/api/v1/partner/topups",
        { phoneNumber: "+50934748112", skuCode: "SKU1" },
        { ...API_KEY_HEADERS, "idempotency-key": "idem-x" },
      ),
    );

    expect(response.status).toBe(403);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
  });

  it("rejects a status read with a send-only key (403)", async () => {
    mockKeyScopes = ["topup:send"];

    const response = await topupStatusGET(
      getRequest("http://localhost/api/v1/partner/topups/ORD-1", {
        ...API_KEY_HEADERS,
      }),
      { params: Promise.resolve({ orderId: "ORD-1" }) },
    );

    expect(response.status).toBe(403);
    expect(mockTransactionFindOne).not.toHaveBeenCalled();
  });

  it("rejects a lookup with no API key (401) and never delegates", async () => {
    const response = await lookupPOST(
      postRequest("http://localhost/api/v1/partner/lookup", {
        phoneNumber: "+50934748112",
      }),
    );

    expect(response.status).toBe(401);
    expect(mockLookupPOST).not.toHaveBeenCalled();
  });

  // RBAC C2: the partner API is funded by the key's ORGANIZATION, so
  // a customer-owned key must be rejected on owner class alone —
  // even one carrying the right scopes. (Pre-fix, this key sent real
  // top-ups charged to the org's DingConnect account.)
  it("rejects a customer-owned key on the send endpoint (403)", async () => {
    mockKeyOwnerType = "customer";

    const response = await topupsPOST(
      postRequest(
        "http://localhost/api/v1/partner/topups",
        { phoneNumber: "+50934748112", skuCode: "SKU1" },
        { ...API_KEY_HEADERS, "idempotency-key": "idem-customer" },
      ),
    );

    expect(response.status).toBe(403);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
    expect(MockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a customer-owned key on lookup and status reads (403)", async () => {
    mockKeyOwnerType = "customer";

    const lookupResponse = await lookupPOST(
      postRequest(
        "http://localhost/api/v1/partner/lookup",
        { phoneNumber: "+50934748112" },
        { ...API_KEY_HEADERS },
      ),
    );
    expect(lookupResponse.status).toBe(403);
    expect(mockLookupPOST).not.toHaveBeenCalled();

    const statusResponse = await topupStatusGET(
      getRequest("http://localhost/api/v1/partner/topups/ORD-1", {
        ...API_KEY_HEADERS,
      }),
      { params: Promise.resolve({ orderId: "ORD-1" }) },
    );
    expect(statusResponse.status).toBe(403);
    expect(mockTransactionFindOne).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lookup + providers
// ---------------------------------------------------------------------------
describe("partner lookup", () => {
  it("delegates to the public lookup with the slug from the key's org", async () => {
    mockOrgFindById.mockResolvedValue({ _id: "org1", slug: "my-org" });
    const sentinel = { __lookupPayload: true };
    mockLookupPOST.mockResolvedValue(sentinel);

    const response = await lookupPOST(
      postRequest(
        "http://localhost/api/v1/partner/lookup",
        { phoneNumber: "+50934748112" },
        { ...API_KEY_HEADERS },
      ),
    );

    expect(response).toBe(sentinel);
    expect(mockOrgFindById).toHaveBeenCalledWith("org1");
    expect(mockLookupPOST).toHaveBeenCalledTimes(1);
    const innerRequest = mockLookupPOST.mock.calls[0][0] as NextRequest;
    await expect(innerRequest.json()).resolves.toEqual({
      phoneNumber: "+50934748112",
      orgSlug: "my-org",
    });
  });
});

describe("partner providers", () => {
  it("returns the key org's DingConnect providers in the dashboard shape", async () => {
    integrationOk();
    const providers = [
      { ProviderCode: "DIGHT", ProviderName: "Digicel", CountryIso: "HT" },
      { ProviderCode: "NATHT", ProviderName: "Natcom", CountryIso: "HT" },
    ];
    mockDing.getProviders.mockResolvedValue(providers);

    const response = await providersGET(
      getRequest("http://localhost/api/v1/partner/providers", {
        ...API_KEY_HEADERS,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers,
      count: 2,
    });
    expect(mockIntegrationFindOne).toHaveBeenCalledWith({
      orgId: "org1",
      provider: "dingconnect",
      status: "active",
    });
  });
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
describe("partner topups — send", () => {
  function setupHappyPath() {
    mockTransactionFindOne.mockResolvedValue(null);
    integrationOk();
    // Storefront validateOnly OFF — a body testMode must override it.
    mockSettingsFindOne.mockResolvedValue({
      topupSettings: { validateOnly: false },
      discount: { enabled: false },
    });
    mockPricingRuleFind.mockReturnValue({
      sort: jest.fn().mockResolvedValue([]),
    });
    mockDing.getProducts.mockResolvedValue([
      {
        SkuCode: "SKU1",
        ProviderCode: "OP1",
        DefaultDisplayText: "Digicel 10",
        Price: { Amount: 10, CurrencyCode: "USD" },
        Minimum: { SendValue: 10, ReceiveValue: 10, SendCurrencyIso: "USD" },
        Maximum: { SendValue: 10, ReceiveValue: 10, SendCurrencyIso: "USD" },
        Benefits: [],
      },
    ]);
    mockDing.getProviders.mockResolvedValue([
      { ProviderCode: "OP1", ProviderName: "Op One" },
    ]);
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 999,
      Status: "Completed",
    });
  }

  it("requires the Idempotency-Key header (400 when missing)", async () => {
    const response = await topupsPOST(
      postRequest(
        "http://localhost/api/v1/partner/topups",
        { phoneNumber: "+50934748112", skuCode: "SKU1" },
        { ...API_KEY_HEADERS },
      ),
    );

    expect(response.status).toBe(400);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
  });

  it("sends in testMode: ValidateOnly forced, partner-attributed, no customer", async () => {
    setupHappyPath();

    const response = await topupsPOST(
      postRequest(
        "http://localhost/api/v1/partner/topups",
        { phoneNumber: "+50934748112", skuCode: "SKU1", testMode: true },
        { ...API_KEY_HEADERS, "idempotency-key": "idem-send-1" },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      message: "Top-up sent successfully",
      transaction: {
        id: "tx-new",
        orderId: "ORD-NEW",
        amount: 10, // server-derived: catalog $10, no markup rule
        currency: "USD",
        status: "completed",
        recipientPhone: "+50934748112",
        transferId: 999,
        isTestMode: true,
      },
    });

    // Fulfillment went through DingConnect with the order id as ref
    // and ValidateOnly forced by the per-request testMode.
    expect(mockDing.sendTransfer).toHaveBeenCalledTimes(1);
    expect(mockDing.sendTransfer.mock.calls[0][0]).toMatchObject({
      SkuCode: "SKU1",
      DistributorRef: "ORD-NEW",
      ValidateOnly: true,
    });

    // Attribution: org-bound, key-created, no customer anywhere.
    expect(mockLastTransactionCtorArgs).toMatchObject({
      orgId: "org1",
      paymentGateway: "partner",
      createdBy: "key1",
      isTestMode: true,
    });
    expect(mockLastTransactionCtorArgs?.customerId).toBeUndefined();
    expect(
      (mockLastTransactionCtorArgs?.metadata as Record<string, unknown>)
        ?.idempotencyKey,
    ).toBe("idem-send-1");
  });

  it("replays the existing transaction for a repeated Idempotency-Key", async () => {
    mockTransactionFindOne.mockResolvedValue({
      _id: "tx-existing",
      orderId: "ORD-EXISTING",
      amount: 12,
      currency: "USD",
      status: "completed",
      recipient: { phoneNumber: "+50934748112" },
      providerTransactionId: "555",
      metadata: { dingTransferId: 555, idempotencyKey: "idem-send-1" },
      isTestMode: false,
    });

    const response = await topupsPOST(
      postRequest(
        "http://localhost/api/v1/partner/topups",
        { phoneNumber: "+50934748112", skuCode: "SKU1" },
        { ...API_KEY_HEADERS, "idempotency-key": "idem-send-1" },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transaction).toEqual({
      id: "tx-existing",
      orderId: "ORD-EXISTING",
      amount: 12,
      currency: "USD",
      status: "completed",
      recipientPhone: "+50934748112",
      transferId: 555,
      isTestMode: false,
    });
    expect(mockTransactionFindOne).toHaveBeenCalledWith({
      orgId: "org1",
      "metadata.idempotencyKey": "idem-send-1",
    });
    // Nothing was created or sent again.
    expect(MockTransaction).not.toHaveBeenCalled();
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Status read
// ---------------------------------------------------------------------------
describe("partner topups — status", () => {
  const baseTx = {
    _id: "tx-1",
    orderId: "ORD-1",
    orgId: "org1",
    amount: 10,
    currency: "USD",
    recipient: { phoneNumber: "+50934748112" },
    providerTransactionId: "999",
    metadata: { dingTransferId: 999 },
    isTestMode: false,
  };

  it("returns the flat status shape for the key's own transaction", async () => {
    mockTransactionFindOne.mockResolvedValue({
      ...baseTx,
      status: "completed",
      metadata: { dingTransferId: 999, failureReason: undefined },
    });

    const response = await topupStatusGET(
      getRequest("http://localhost/api/v1/partner/topups/ORD-1", {
        ...API_KEY_HEADERS,
      }),
      { params: Promise.resolve({ orderId: "ORD-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orderId: "ORD-1",
      status: "completed",
      transferId: 999,
      amount: 10,
      currency: "USD",
      recipientPhone: "+50934748112",
      failureReason: null,
      isTestMode: false,
    });
    expect(mockSettleStuckTransfer).not.toHaveBeenCalled();
  });

  it("live-settles a processing transaction before answering", async () => {
    const tx = { ...baseTx, status: "processing", metadata: { dingTransferId: 999 } };
    mockTransactionFindOne.mockResolvedValue(tx);
    mockSettleStuckTransfer.mockImplementation(async (t: typeof tx) => {
      t.status = "completed";
      return "completed";
    });

    const response = await topupStatusGET(
      getRequest("http://localhost/api/v1/partner/topups/ORD-1", {
        ...API_KEY_HEADERS,
      }),
      { params: Promise.resolve({ orderId: "ORD-1" }) },
    );

    expect(mockSettleStuckTransfer).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.status).toBe("completed");
  });

  it("404s for a transaction outside the key's org", async () => {
    mockTransactionFindOne.mockResolvedValue(null);

    const response = await topupStatusGET(
      getRequest("http://localhost/api/v1/partner/topups/ORD-OTHER", {
        ...API_KEY_HEADERS,
      }),
      { params: Promise.resolve({ orderId: "ORD-OTHER" }) },
    );

    expect(response.status).toBe(404);
    // The lookup was scoped to the key's org — no cross-org read.
    expect(mockTransactionFindOne).toHaveBeenCalledWith({
      orgId: "org1",
      orderId: "ORD-OTHER",
    });
  });
});
