/**
 * Cluster 4 pins — IDOR + customer password (F-H3, F-H4, F-H10, F-M3).
 *
 * Every pin FAILS on pristine sandbox and PASSES on the fix branch.
 * Controls (legitimate flows) PASS on both.
 */
import { NextRequest } from "next/server";
import { UserRole } from "@topupsend/types";

// ---------------------------------------------------------------------------
// Mocks (defined before the jest.mock registrations that use them)
// ---------------------------------------------------------------------------

const mockRequireAuth = jest.fn();
const mockRequireCustomerAuth = jest.fn();
const mockGetSession = jest.fn();
const mockGetCustomerSession = jest.fn();

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

jest.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  requireCustomerAuth: (...args: any[]) => mockRequireCustomerAuth(...args),
}));

jest.mock("@/lib/auth", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

jest.mock("@/lib/customer-auth", () => ({
  getCustomerSession: (...args: any[]) => mockGetCustomerSession(...args),
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
}));

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  Customer: {
    findById: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
    checkDuplicates: jest.fn(),
  },
  CustomerBalanceHistory: { find: jest.fn() },
  ApiKey: { findById: jest.fn() },
  Transaction: {
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    find: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------
import { ApiKey, Customer, CustomerBalanceHistory, Transaction } from "@topupsend/db";
import { GET as historyGET } from "../../app/api/v1/customers/[id]/balance/history/route";
import {
  GET as apiKeyGET,
  PUT as apiKeyPUT,
  DELETE as apiKeyDELETE,
} from "../../app/api/v1/api-keys/[id]/route";
import { PATCH as transactionsPATCH } from "../../app/api/v1/transactions/route";
import { PUT as customerPUT } from "../../app/api/v1/customers/[id]/route";

const mockCustomerFindById = Customer.findById as jest.Mock;
const mockCustomerUpdateOne = Customer.updateOne as jest.Mock;
const mockCustomerCheckDuplicates = Customer.checkDuplicates as jest.Mock;
const mockHistoryFind = CustomerBalanceHistory.find as jest.Mock;
const mockApiKeyFindById = ApiKey.findById as jest.Mock;
const mockTransactionFindOne = Transaction.findOne as jest.Mock;

function fakeRequest(opts: {
  url?: string;
  body?: unknown;
  customerCookie?: boolean;
} = {}) {
  return {
    url: opts.url ?? "http://localhost/api/v1/test",
    cookies: {
      get: (name: string) =>
        name === "customer-session" && opts.customerCookie
          ? { name, value: "token" }
          : undefined,
    },
    json: jest.fn().mockResolvedValue(opts.body ?? {}),
  } as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// F-H3: customer balance history
// ---------------------------------------------------------------------------
describe("customers/[id]/balance/history — org + permission (F-H3)", () => {
  const historyRow = { _id: "h1", amount: 25, type: "credit" };

  function wireHistory() {
    mockHistoryFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest
          .fn()
          .mockReturnValue({ lean: jest.fn().mockResolvedValue([historyRow]) }),
      }),
    });
  }

  it("pin: a VIEWER (no VIEW_CUSTOMER_BALANCE) is refused", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "u-viewer",
      orgId: "orgA",
      roles: [UserRole.VIEWER],
    });
    mockCustomerFindById.mockResolvedValue({ _id: "cust1", orgId: "orgA" });
    wireHistory();

    await expect(
      historyGET(fakeRequest(), params("cust1")),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockHistoryFind).not.toHaveBeenCalled();
  });

  it("pin: another org's customer history is refused even for ADMIN", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "u-admin",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    mockCustomerFindById.mockResolvedValue({ _id: "cust9", orgId: "orgB" });
    wireHistory();

    await expect(
      historyGET(fakeRequest(), params("cust9")),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockHistoryFind).not.toHaveBeenCalled();
  });

  it("pin: a nonexistent customer is 404, not an empty cross-org read", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "u-admin",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    mockCustomerFindById.mockResolvedValue(null);
    wireHistory();

    await expect(
      historyGET(fakeRequest(), params("missing")),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockHistoryFind).not.toHaveBeenCalled();
  });

  it("control: same-org ADMIN reads the history", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "u-admin",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    mockCustomerFindById.mockResolvedValue({ _id: "cust1", orgId: "orgA" });
    wireHistory();

    const res = (await historyGET(
      fakeRequest(),
      params("cust1"),
    )) as unknown as Record<string, unknown>;

    expect(res.__ok).toBe(true);
    expect(res.history).toEqual([historyRow]);
  });
});

// ---------------------------------------------------------------------------
// F-H4: API keys cross-org
// ---------------------------------------------------------------------------
describe("api-keys/[id] — cross-org (F-H4)", () => {
  function makeKey(overrides: Record<string, unknown> = {}) {
    return {
      _id: "key1",
      orgId: "orgA",
      ownerId: "user-other",
      ownerType: "staff",
      name: "Key One",
      keyPrefix: "pk_live_ab",
      scopes: ["transactions:read"],
      getRateLimit: () => ({ requests: 1000, window: 3600 }),
      lastUsedAt: undefined,
      usageCount: 0,
      expiresAt: undefined,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("pin: staff ADMIN of org A cannot GET org B's key (404)", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "admin-a",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    mockApiKeyFindById.mockResolvedValue(makeKey({ orgId: "orgB" }));

    await expect(
      apiKeyGET(fakeRequest(), params("key1")),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("pin: staff ADMIN of org A cannot PUT org B's key (404, no save)", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "admin-a",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    const key = makeKey({ orgId: "orgB" });
    mockApiKeyFindById.mockResolvedValue(key);

    await expect(
      apiKeyPUT(fakeRequest({ body: { name: "Renamed" } }), params("key1")),
    ).rejects.toMatchObject({ status: 404 });
    expect(key.save).not.toHaveBeenCalled();
    expect(key.name).toBe("Key One");
  });

  it("pin: staff ADMIN of org A cannot DELETE org B's key (404, no save)", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "admin-a",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    const key = makeKey({ orgId: "orgB" });
    mockApiKeyFindById.mockResolvedValue(key);

    await expect(
      apiKeyDELETE(fakeRequest(), params("key1")),
    ).rejects.toMatchObject({ status: 404 });
    expect(key.save).not.toHaveBeenCalled();
    expect(key.isActive).toBe(true);
  });

  it("pin: a customer cannot GET their own key record from another org (404)", async () => {
    mockRequireCustomerAuth.mockResolvedValue({
      customerId: "cust1",
      orgId: "orgA",
      email: "c@example.com",
      emailVerified: true,
    });
    mockApiKeyFindById.mockResolvedValue(
      makeKey({ orgId: "orgB", ownerId: "cust1", ownerType: "customer" }),
    );

    await expect(
      apiKeyGET(
        fakeRequest({ url: "http://localhost/api/v1/api-keys/key1?customer=true" }),
        params("key1"),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("control: staff ADMIN reads a key in their own org", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "admin-a",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    mockApiKeyFindById.mockResolvedValue(makeKey({ orgId: "orgA" }));

    const res = (await apiKeyGET(
      fakeRequest(),
      params("key1"),
    )) as unknown as { __ok: boolean; apiKey: { name: string } };

    expect(res.__ok).toBe(true);
    expect(res.apiKey.name).toBe("Key One");
  });

  it("control: a customer reads their own key in their own org", async () => {
    mockRequireCustomerAuth.mockResolvedValue({
      customerId: "cust1",
      orgId: "orgA",
      email: "c@example.com",
      emailVerified: true,
    });
    mockApiKeyFindById.mockResolvedValue(
      makeKey({ orgId: "orgA", ownerId: "cust1", ownerType: "customer" }),
    );

    const res = (await apiKeyGET(
      fakeRequest({ url: "http://localhost/api/v1/api-keys/key1?customer=true" }),
      params("key1"),
    )) as unknown as { __ok: boolean };

    expect(res.__ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-H10: transactions PATCH authentication + org scope
// ---------------------------------------------------------------------------
describe("transactions PATCH — auth + org scope (F-H10)", () => {
  function makeTx(orgId: string) {
    return {
      orderId: "ORD-1",
      orgId,
      recipient: { name: "Old Name" },
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  function wireTxFind(tx: ReturnType<typeof makeTx>) {
    mockTransactionFindOne.mockImplementation(async (query: any) =>
      query?.orgId && query.orgId !== tx.orgId ? null : tx,
    );
  }

  const patchReq = () =>
    fakeRequest({
      url: "http://localhost/api/v1/transactions?orderId=ORD-1",
      body: { customerName: "New Name" },
    });

  it("pin: unauthenticated PATCH is 401 and mutates nothing", async () => {
    mockGetSession.mockResolvedValue(null);
    const tx = makeTx("orgA");
    wireTxFind(tx);

    const res = (await transactionsPATCH(patchReq())) as unknown as {
      status?: number;
    };

    expect(res.status).toBe(401);
    expect(tx.save).not.toHaveBeenCalled();
    expect(tx.recipient.name).toBe("Old Name");
  });

  it("pin: a session from org A cannot PATCH org B's transaction (404)", async () => {
    mockGetSession.mockResolvedValue({
      userId: "u1",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    const tx = makeTx("orgB");
    wireTxFind(tx);

    const res = (await transactionsPATCH(patchReq())) as unknown as {
      status?: number;
    };

    expect(res.status).toBe(404);
    expect(tx.save).not.toHaveBeenCalled();
    expect(tx.recipient.name).toBe("Old Name");
  });

  it("control: the owning org's session updates the recipient name", async () => {
    mockGetSession.mockResolvedValue({
      userId: "u1",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    const tx = makeTx("orgA");
    wireTxFind(tx);

    const res = (await transactionsPATCH(patchReq())) as unknown as {
      __ok?: boolean;
    };

    expect(res.__ok).toBe(true);
    expect(tx.recipient.name).toBe("New Name");
    expect(tx.save).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F-M3: customer profile PUT password changes
// ---------------------------------------------------------------------------
describe("customers/[id] PUT — password changes (F-M3)", () => {
  const plainCustomer = () => ({
    _id: "cust1",
    orgId: "orgA",
    phoneNumber: "+50937000000",
    email: "c@example.com",
    name: "Old Name",
    save: jest.fn().mockResolvedValue(undefined),
  });

  function wireCustomer() {
    const plain = plainCustomer();
    const withHash = {
      comparePassword: jest.fn(
        async (pw: string) => pw === "correct-current",
      ),
    };
    mockCustomerFindById.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue(withHash),
      then: (resolve: (v: unknown) => void) => resolve(plain),
    }));
    mockCustomerCheckDuplicates.mockResolvedValue(null);
    mockCustomerUpdateOne.mockResolvedValue({ acknowledged: true });
    return plain;
  }

  function asCustomer() {
    mockGetSession.mockResolvedValue(null);
    mockGetCustomerSession.mockResolvedValue({
      customerId: "cust1",
      orgId: "orgA",
      email: "c@example.com",
    });
  }

  function asStaff() {
    mockGetSession.mockResolvedValue({
      userId: "staff1",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
  }

  it("pin: customer password change without the current password is refused", async () => {
    asCustomer();
    wireCustomer();

    const res = (await customerPUT(
      fakeRequest({
        body: { password: "newpass123" },
        customerCookie: true,
      }),
      params("cust1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(400);
    expect(mockCustomerUpdateOne).not.toHaveBeenCalled();
  });

  it("pin: customer password change with a WRONG current password is refused", async () => {
    asCustomer();
    wireCustomer();

    const res = (await customerPUT(
      fakeRequest({
        body: { password: "newpass123", currentPassword: "wrong-current" },
        customerCookie: true,
      }),
      params("cust1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(401);
    expect(mockCustomerUpdateOne).not.toHaveBeenCalled();
  });

  it("control: customer password change with the correct current password succeeds", async () => {
    asCustomer();
    wireCustomer();

    const res = (await customerPUT(
      fakeRequest({
        body: { password: "newpass123", currentPassword: "correct-current" },
        customerCookie: true,
      }),
      params("cust1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(mockCustomerUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockCustomerUpdateOne.mock.calls[0][1]).toEqual({
      $set: { passwordHash: "hashed:newpass123" },
    });
  });

  it("control: customer profile update without a password succeeds", async () => {
    asCustomer();
    const plain = wireCustomer();

    const res = (await customerPUT(
      fakeRequest({
        body: { name: "New Name" },
        customerCookie: true,
      }),
      params("cust1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(plain.name).toBe("New Name");
    expect(mockCustomerUpdateOne).not.toHaveBeenCalled();
  });

  it("control: staff admin set-password for an in-org customer still works", async () => {
    asStaff();
    wireCustomer();

    const res = (await customerPUT(
      fakeRequest({ body: { password: "adminset123" } }),
      params("cust1"),
    )) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(mockCustomerUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockCustomerUpdateOne.mock.calls[0][1]).toEqual({
      $set: { passwordHash: "hashed:adminset123" },
    });
  });
});
