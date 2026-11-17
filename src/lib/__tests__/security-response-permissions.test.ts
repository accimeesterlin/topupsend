/**
 * Security sweep 2026-11-16 pins — secrets in responses + permission
 * wiring (TopUpSend).
 *
 * Fix #1: provider GET / transactions list / webhook-log detail must
 * not return stored secret material (gateway credentials,
 * metadata.pgpayToken, payload pgPayToken) to ANY role, while
 * non-secret fields stay intact and stored data is untouched.
 *
 * Fix #2: org-write mutations that only checked the session now
 * enforce the defined permissions (DEPOSIT_WALLET,
 * EDIT_PAYMENT_SETTINGS, EDIT_CUSTOMERS). Refusals must be 403 with
 * no state change; permitted roles keep working (positive controls).
 */
import { NextRequest } from "next/server";
import { UserRole } from "@topupsend/types";

// ---------------------------------------------------------------------------
// Mocks (defined before the jest.mock registrations that use them)
// ---------------------------------------------------------------------------

const mockRequireAuth = jest.fn();
const mockGetSession = jest.fn();
const mockGetLogById = jest.fn();

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
  // Handles both call shapes used in the codebase: (message, status)
  // and the ApiException objects handleApiError passes through.
  createErrorResponse: (errOrMessage: unknown, status?: number) => {
    if (
      errOrMessage &&
      typeof errOrMessage === "object" &&
      "status" in (errOrMessage as Record<string, unknown>)
    ) {
      const e = errOrMessage as { status: number; message?: string };
      return { __ok: false, status: e.status, message: e.message };
    }
    return { __ok: false, status: status ?? 500, message: errOrMessage };
  },
}));

jest.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
}));

jest.mock("@/lib/auth", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  // Migrated routes call the revalidating helper; in this suite the
  // fabricated session stands in for an already-revalidated one.
  getRevalidatedSession: (...args: any[]) => mockGetSession(...args),
}));

jest.mock("@/lib/customer-auth", () => ({
  getCustomerSession: jest.fn().mockResolvedValue(null),
  getRevalidatedCustomerSession: jest.fn().mockResolvedValue(null),
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

jest.mock("bcryptjs", () => ({
  hash: jest.fn(async (pw: string) => `hashed:${pw}`),
  compare: jest.fn(async () => false),
}));

jest.mock("@/lib/services/webhook-logging.service", () => ({
  webhookLoggingService: {
    getLogById: (...args: any[]) => mockGetLogById(...args),
  },
}));

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  PaymentProvider: {
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
  },
  Wallet: { findOne: jest.fn() },
  WalletTransaction: { create: jest.fn() },
  Transaction: {
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
  },
  Customer: {
    findById: jest.fn(),
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
    updateOne: jest.fn(),
    checkDuplicates: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------
import {
  Customer,
  PaymentProvider,
  Transaction,
  Wallet,
  WalletTransaction,
} from "@topupsend/db";
import {
  GET as providerGET,
  PATCH as providerPATCH,
  DELETE as providerDELETE,
} from "../../app/api/v1/payment-providers/[id]/route";
import { POST as depositPOST } from "../../app/api/v1/wallet/deposit/route";
import { GET as transactionsGET } from "../../app/api/v1/transactions/route";
import { DELETE as customerDELETE } from "../../app/api/v1/customers/[id]/route";
import { GET as webhookLogGET } from "../../app/api/v1/webhooks/logs/[id]/route";

const mockProviderFindOne = PaymentProvider.findOne as jest.Mock;
const mockProviderFindOneAndDelete = PaymentProvider.findOneAndDelete as jest.Mock;
const mockWalletFindOne = Wallet.findOne as jest.Mock;
const mockWalletTxCreate = WalletTransaction.create as jest.Mock;
const mockTxFind = Transaction.find as jest.Mock;
const mockTxCount = Transaction.countDocuments as jest.Mock;
const mockCustomerFindOneAndDelete = Customer.findOneAndDelete as jest.Mock;

function fakeRequest(opts: { url?: string; body?: unknown } = {}) {
  return {
    url: opts.url ?? "http://localhost/api/v1/test",
    cookies: { get: () => undefined },
    json: jest.fn().mockResolvedValue(opts.body ?? {}),
  } as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const session = (roles: UserRole[]) => ({
  userId: "u1",
  orgId: "orgA",
  roles,
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fix #1a: GET /payment-providers/[id] must not leak credentials
// ---------------------------------------------------------------------------
describe("payment-providers/[id] GET — credential leak (Fix #1)", () => {
  const SECRETS = [
    "STRIPE-SECRET-FIXTURE-VALUE",
    "paypal-client-secret-value",
    "pgpay-api-key-value",
    "whsec_webhook_secret_value",
  ];

  function providerDoc() {
    return {
      _id: "prov1",
      orgId: "orgA",
      provider: "stripe",
      status: "active",
      environment: "production",
      settings: { statementDescriptor: "TOPUPSEND" },
      metadata: { note: "primary" },
      credentials: {
        secretKey: SECRETS[0],
        clientSecret: SECRETS[1],
        apiKey: SECRETS[2],
        webhookSecret: SECRETS[3],
      },
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    };
  }

  it.each([
    ["VIEWER", UserRole.VIEWER],
    ["OPERATOR (member)", UserRole.OPERATOR],
    ["ADMIN", UserRole.ADMIN],
  ])(
    "pin: %s receives no credential material, non-secret fields intact",
    async (_label, role) => {
      mockRequireAuth.mockResolvedValue(session([role]));
      mockProviderFindOne.mockResolvedValue(providerDoc());

      const res = (await providerGET(
        fakeRequest(),
        params("prov1"),
      )) as unknown as {
        __ok: boolean;
        provider: Record<string, unknown>;
      };

      expect(res.__ok).toBe(true);
      expect(res.provider).not.toHaveProperty("credentials");
      expect(res.provider.hasCredentials).toBe(true);
      const serialized = JSON.stringify(res);
      for (const secret of SECRETS) {
        expect(serialized).not.toContain(secret);
      }
      // Non-secret fields remain for the settings UI.
      expect(res.provider.provider).toBe("stripe");
      expect(res.provider.status).toBe("active");
      expect(res.provider.environment).toBe("production");
      expect(res.provider.settings).toEqual({
        statementDescriptor: "TOPUPSEND",
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Fix #1b: GET /transactions must not return metadata.pgpayToken
// ---------------------------------------------------------------------------
describe("transactions GET — pgpayToken strip (Fix #1)", () => {
  it("pin: list rows carry no pgpayToken; the stored row is unmutated", async () => {
    mockGetSession.mockResolvedValue(session([UserRole.VIEWER]));
    const stored = {
      _id: "t1",
      orderId: "ORD-1",
      status: "completed",
      metadata: { pgpayToken: "tok_live_secret", channel: "web" },
    };
    mockTxCount.mockResolvedValue(1);
    mockTxFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest
          .fn()
          .mockReturnValue({ limit: jest.fn().mockResolvedValue([stored]) }),
      }),
    });

    const res = (await transactionsGET(
      fakeRequest({ url: "http://localhost/api/v1/transactions" }),
    )) as unknown as {
      status: number;
      __body: { transactions: Array<Record<string, any>> };
    };

    expect(res.status).toBe(200);
    const row = res.__body.transactions[0];
    expect(row.metadata.pgpayToken).toBeUndefined();
    expect(row.metadata.channel).toBe("web");
    expect(row.orderId).toBe("ORD-1");
    expect(JSON.stringify(res)).not.toContain("tok_live_secret");
    // Response-layer only: what is stored keeps the token.
    expect(stored.metadata.pgpayToken).toBe("tok_live_secret");
  });
});

// ---------------------------------------------------------------------------
// Fix #1c: GET /webhooks/logs/[id] must not return the stored pgPayToken
// ---------------------------------------------------------------------------
describe("webhooks/logs/[id] GET — payload redaction (Fix #1)", () => {
  function logWith(payload: unknown) {
    return {
      _id: "log1",
      orgId: "orgA",
      event: "payment.completed",
      source: "pgpay",
      status: "processed",
      payload,
      headers: {},
      attempts: 1,
      maxAttempts: 3,
    };
  }

  it("pin: object payload is deep-redacted, other fields intact, stored payload unmutated", async () => {
    mockRequireAuth.mockResolvedValue(session([UserRole.ADMIN]));
    const payload = {
      pgPayToken: "tok_top_secret",
      data: { pgPayToken: "tok_nested_secret", amount: 50, currency: "USD" },
    };
    mockGetLogById.mockResolvedValue(logWith(payload));

    const res = (await webhookLogGET(
      fakeRequest(),
      params("log1"),
    )) as unknown as { __ok: boolean; log: { payload: any; event: string } };

    expect(res.__ok).toBe(true);
    expect(res.log.event).toBe("payment.completed");
    expect(res.log.payload.pgPayToken).toBe("[REDACTED]");
    expect(res.log.payload.data.pgPayToken).toBe("[REDACTED]");
    expect(res.log.payload.data.amount).toBe(50);
    expect(JSON.stringify(res)).not.toContain("tok_top_secret");
    expect(JSON.stringify(res)).not.toContain("tok_nested_secret");
    expect(payload.pgPayToken).toBe("tok_top_secret");
    expect(payload.data.pgPayToken).toBe("tok_nested_secret");
  });

  it("pin: JSON-string payloads are redacted too", async () => {
    mockRequireAuth.mockResolvedValue(session([UserRole.ADMIN]));
    mockGetLogById.mockResolvedValue(
      logWith('{"pgPayToken":"tok_string_secret","amount":5}'),
    );

    const res = (await webhookLogGET(
      fakeRequest(),
      params("log1"),
    )) as unknown as { __ok: boolean; log: { payload: string } };

    expect(res.__ok).toBe(true);
    expect(res.log.payload).not.toContain("tok_string_secret");
    expect(res.log.payload).toContain("[REDACTED]");
    expect(res.log.payload).toContain('"amount":5');
  });
});

// ---------------------------------------------------------------------------
// Fix #2a: POST /wallet/deposit requires DEPOSIT_WALLET
// ---------------------------------------------------------------------------
describe("wallet/deposit POST — DEPOSIT_WALLET gate (Fix #2)", () => {
  it.each([
    ["VIEWER", UserRole.VIEWER],
    ["OPERATOR", UserRole.OPERATOR],
  ])(
    "pin: %s is refused 403 and no wallet is touched",
    async (_label, role) => {
      mockRequireAuth.mockResolvedValue(session([role]));

      const res = (await depositPOST(
        fakeRequest({ body: { amount: 100 } }),
      )) as unknown as { status: number };

      // The thrown ApiErrors.Forbidden surfaces through the real
      // handleApiError as a 403 problem response.
      expect(res.status).toBe(403);
      expect(mockWalletFindOne).not.toHaveBeenCalled();
      expect(mockWalletTxCreate).not.toHaveBeenCalled();
    },
  );

  it("control: ADMIN deposits successfully", async () => {
    mockRequireAuth.mockResolvedValue(session([UserRole.ADMIN]));
    const wallet = {
      _id: "w1",
      orgId: "orgA",
      status: "active",
      balance: 500,
      availableBalance: 500,
      currency: "USD",
      deposit: jest.fn(function (this: { balance: number }, amount: number) {
        this.balance += amount;
      }),
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockWalletFindOne.mockResolvedValue(wallet);
    mockWalletTxCreate.mockResolvedValue({
      _id: "wt1",
      type: "deposit",
      amount: 100,
      currency: "USD",
      balanceBefore: 500,
      balanceAfter: 600,
      status: "completed",
      createdAt: new Date(),
    });

    const res = (await depositPOST(
      fakeRequest({ body: { amount: 100 } }),
    )) as unknown as { __ok: boolean };

    expect(res.__ok).toBe(true);
    expect(wallet.deposit).toHaveBeenCalledWith(100);
    expect(mockWalletTxCreate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Fix #2b: provider PATCH/DELETE require EDIT_PAYMENT_SETTINGS
// ---------------------------------------------------------------------------
describe("payment-providers/[id] mutations — EDIT_PAYMENT_SETTINGS gate (Fix #2)", () => {
  it("pin: OPERATOR cannot DELETE a provider (403, no delete)", async () => {
    mockRequireAuth.mockResolvedValue(session([UserRole.OPERATOR]));

    const res = (await providerDELETE(
      fakeRequest(),
      params("prov1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(403);
    expect(mockProviderFindOneAndDelete).not.toHaveBeenCalled();
  });

  it("pin: OPERATOR cannot PATCH provider credentials (403, no lookup)", async () => {
    mockRequireAuth.mockResolvedValue(session([UserRole.OPERATOR]));

    const res = (await providerPATCH(
      fakeRequest({ body: { credentials: { secretKey: "sk_new" } } }),
      params("prov1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(403);
    expect(mockProviderFindOne).not.toHaveBeenCalled();
  });

  it("control: ADMIN deletes a provider", async () => {
    mockRequireAuth.mockResolvedValue(session([UserRole.ADMIN]));
    mockProviderFindOneAndDelete.mockResolvedValue({
      _id: "prov1",
      provider: "stripe",
    });

    const res = (await providerDELETE(
      fakeRequest(),
      params("prov1"),
    )) as unknown as { __ok: boolean; message: string };

    expect(res.__ok).toBe(true);
    expect(mockProviderFindOneAndDelete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Fix #2c: DELETE /customers/[id] requires EDIT_CUSTOMERS
// ---------------------------------------------------------------------------
describe("customers/[id] DELETE — EDIT_CUSTOMERS gate (Fix #2)", () => {
  it("pin: VIEWER is refused 403 and nothing is deleted", async () => {
    mockGetSession.mockResolvedValue(session([UserRole.VIEWER]));

    const res = (await customerDELETE(
      fakeRequest(),
      params("cust1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(403);
    expect(mockCustomerFindOneAndDelete).not.toHaveBeenCalled();
  });

  it("control: OPERATOR (holds EDIT_CUSTOMERS) deletes an in-org customer", async () => {
    mockGetSession.mockResolvedValue(session([UserRole.OPERATOR]));
    mockCustomerFindOneAndDelete.mockResolvedValue({ _id: "cust1" });

    const res = (await customerDELETE(
      fakeRequest(),
      params("cust1"),
    )) as unknown as { status: number; __body: { success: boolean } };

    expect(res.status).toBe(200);
    expect(res.__body.success).toBe(true);
    expect(mockCustomerFindOneAndDelete).toHaveBeenCalledWith({
      _id: "cust1",
      orgId: "orgA",
    });
  });
});
