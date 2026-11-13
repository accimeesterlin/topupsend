/**
 * @jest-environment node
 *
 * Cluster 5 pins — data & performance (F-H13, F-M12, F-M13) plus the
 * carried-over Wave 3 check on the dedicated customer password route.
 *
 * Every pin FAILS on pristine sandbox and PASSES on the fix branch.
 * Controls (existing behavior that must not change) PASS on both.
 *
 * The password-route verdict was first proven against a REAL in-memory
 * MongoDB (mongodb-memory-server + the byte-identical Customer model):
 * a plain findById returns the document WITHOUT passwordHash (the field
 * is select:false), so comparePassword(correct) === false, while
 * findById().select("+passwordHash") returns true/false correctly.
 * The route pins below reproduce that exact projection contract with a
 * projection-faithful findById fake driving REAL Customer documents and
 * the REAL comparePassword/bcrypt.
 */
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Mocks (defined before the jest.mock registrations that use them)
// ---------------------------------------------------------------------------

const mockGetSession = jest.fn();
const mockRequireAuth = jest.fn();
const mockRequireCustomerAuth = jest.fn();

const mockTxnFind = jest.fn();
const mockTxnAggregate = jest.fn();
const mockTxnCount = jest.fn();
const mockCustomerFind = jest.fn();
const mockCustomerCount = jest.fn();
const mockPwFindById = jest.fn();
const mockProductFind = jest.fn();
const mockDiscountFind = jest.fn();
const mockDiscountCount = jest.fn();
const mockOrgFindById = jest.fn();

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

jest.mock("@/lib/auth", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

jest.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  requireCustomerAuth: (...args: any[]) => mockRequireCustomerAuth(...args),
}));

jest.mock("@/lib/api-error", () => ({
  handleApiError: (error: unknown) => ({
    __ok: false,
    message: error instanceof Error ? error.message : "error",
    status: 500,
  }),
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
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

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  Transaction: {
    find: (...args: any[]) => mockTxnFind(...args),
    aggregate: (...args: any[]) => mockTxnAggregate(...args),
    countDocuments: (...args: any[]) => mockTxnCount(...args),
  },
  Customer: {
    find: (...args: any[]) => mockCustomerFind(...args),
    findById: (...args: any[]) => mockPwFindById(...args),
    countDocuments: (...args: any[]) => mockCustomerCount(...args),
  },
  Product: {
    find: (...args: any[]) => mockProductFind(...args),
  },
  Discount: {
    find: (...args: any[]) => mockDiscountFind(...args),
    countDocuments: (...args: any[]) => mockDiscountCount(...args),
  },
  Organization: {
    findById: (...args: any[]) => mockOrgFindById(...args),
  },
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------
import { GET as metricsGET } from "../../app/api/v1/dashboard/metrics/route";
import { GET as customersGET } from "../../app/api/v1/customers/route";
import { GET as transactionsGET } from "../../app/api/v1/transactions/route";
import { GET as productsGET } from "../../app/api/v1/products/route";
import { GET as discountsGET } from "../../app/api/v1/discounts/route";
import { GET as auditLogsGET } from "../../app/api/v1/audit-logs/route";
import { PUT as passwordPUT } from "../../app/api/v1/customers/[id]/password/route";
import { Customer as RealCustomer } from "../../../packages/db/src/models/Customer";
import { ManualPayment } from "../../../packages/db/src/models/ManualPayment";
import { Product as RealProduct } from "../../../packages/db/src/models/Product";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A chainable, thenable stand-in for a Mongoose list query. */
class FakeQuery<T> {
  skipN = 0;
  limitN: number | null = null;
  constructor(private items: T[]) {}
  sort() {
    return this;
  }
  skip(n: number) {
    this.skipN = n;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  lean() {
    return this;
  }
  then(res: (v: T[]) => unknown, rej?: (e: unknown) => unknown) {
    const out =
      this.limitN == null
        ? this.items.slice(this.skipN)
        : this.items.slice(this.skipN, this.skipN + this.limitN);
    return Promise.resolve(out).then(res, rej);
  }
}

function fakeRequest(url: string, body?: unknown) {
  return {
    url,
    json: jest.fn().mockResolvedValue(body ?? {}),
  } as unknown as NextRequest;
}

const rows = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ _id: `${prefix}${i}` }));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ userId: "u1", orgId: "org1" });
  mockRequireAuth.mockResolvedValue({ userId: "u1", orgId: "org1" });
});

// ---------------------------------------------------------------------------
// Carried-over check: dedicated customer password route (select:false)
// ---------------------------------------------------------------------------
describe("customers/[id]/password — current-password verification", () => {
  const CORRECT = "correct-horse-9";
  const HASH = bcrypt.hashSync(CORRECT, 4);

  let fullDoc: any;
  let projectedDoc: any;
  let customerId: string;

  function buildDocs() {
    fullDoc = new RealCustomer({
      orgId: "org1",
      phoneNumber: "+15095550101",
      email: "c@example.com",
      name: "Cust",
      country: "US",
      passwordHash: HASH,
      tokenVersion: 0,
    });
    projectedDoc = new RealCustomer({
      orgId: "org1",
      phoneNumber: "+15095550101",
      email: "c@example.com",
      name: "Cust",
      country: "US",
      tokenVersion: 0,
    });
    // Same record, two loads: findById hands the route whichever document
    // the projection produces. _id must match for the ownership check.
    projectedDoc._id = fullDoc._id;
    customerId = String(fullDoc._id);
    for (const doc of [fullDoc, projectedDoc]) {
      doc.save = jest.fn().mockResolvedValue(doc);
    }
  }

  /**
   * Reproduces Mongoose's select:false contract, proven against a real
   * in-memory MongoDB: without .select("+passwordHash") the resolved
   * document has NO passwordHash; with it, the hash is present.
   */
  function wireFindById() {
    mockPwFindById.mockImplementation(() => {
      let selectArg = "";
      const q: any = {
        select: jest.fn((s: string) => {
          selectArg = s;
          return q;
        }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(
            selectArg.includes("+passwordHash") ? fullDoc : projectedDoc,
          ).then(res, rej),
      };
      return q;
    });
    mockRequireCustomerAuth.mockResolvedValue({ customerId });
  }

  const callRoute = (id: string, currentPassword: string) =>
    passwordPUT(
      fakeRequest("http://localhost/api/v1/customers/x/password", {
        currentPassword,
        newPassword: "brand-new-pw-9",
      }),
      { params: Promise.resolve({ id }) },
    ) as Promise<any>;

  it("pin: the CORRECT current password is accepted", async () => {
    buildDocs();
    wireFindById();
    const res = await callRoute(customerId, CORRECT);
    expect(res.__ok).toBe(true);
    expect(fullDoc.save).toHaveBeenCalled();
    expect(fullDoc.tokenVersion).toBe(1);
  });

  it("control: a WRONG current password is still rejected with 401", async () => {
    buildDocs();
    wireFindById();
    const res = await callRoute(customerId, "wrong-password-9");
    expect(res.__ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it("control: another customer's id is refused with 403", async () => {
    buildDocs();
    wireFindById();
    const res = await callRoute("someone-else", CORRECT);
    expect(res.__ok).toBe(false);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// F-M12: unique indexes
// ---------------------------------------------------------------------------
describe("unique indexes (F-M12)", () => {
  const indexOptions = (model: any, key: Record<string, number>) => {
    const found = (model.schema.indexes() as any[]).find(
      ([k]) => JSON.stringify(k) === JSON.stringify(key),
    );
    return found?.[1];
  };

  it("pin: ManualPayment {orgId, method, reference} is unique", () => {
    const opts = indexOptions(ManualPayment, {
      orgId: 1,
      method: 1,
      reference: 1,
    });
    expect(opts?.unique).toBe(true);
  });

  it("pin: Product {orgId, provider, providerProductId} is unique and the old non-org-scoped index is gone", () => {
    const opts = indexOptions(RealProduct, {
      orgId: 1,
      provider: 1,
      providerProductId: 1,
    });
    expect(opts?.unique).toBe(true);
    expect(
      indexOptions(RealProduct, { provider: 1, providerProductId: 1 }),
    ).toBeUndefined();
  });

  it("control: ManualPayment's plain query indexes stay non-unique", () => {
    const opts = indexOptions(ManualPayment, { orgId: 1, createdAt: -1 });
    expect(opts).toBeDefined();
    expect(opts?.unique).not.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-H13: dashboard metrics aggregation
// ---------------------------------------------------------------------------
describe("dashboard/metrics — aggregation rewrite (F-H13)", () => {
  function wireMetrics() {
    mockTxnFind.mockResolvedValue([]);
    mockTxnAggregate.mockImplementation((pipeline: any[]) => {
      const match = pipeline[0].$match;
      const isPrev = Boolean(match.createdAt?.$lt);
      return Promise.resolve([
        isPrev
          ? { totalTransactions: 2, totalRevenue: 150, completed: 1 }
          : { totalTransactions: 4, totalRevenue: 300, completed: 3 },
      ]);
    });
    mockCustomerCount.mockImplementation((filter: any) => {
      if (filter?.createdAt?.$lt) return Promise.resolve(1);
      if (filter?.createdAt) return Promise.resolve(2);
      return Promise.resolve(10);
    });
  }

  it("pin: metrics are computed by aggregation (no find) with identical figures", async () => {
    wireMetrics();
    const res: any = await metricsGET(
      fakeRequest("http://localhost/api/v1/dashboard/metrics?period=30d"),
    );
    expect(mockTxnAggregate).toHaveBeenCalledTimes(2);
    expect(mockTxnFind).not.toHaveBeenCalled();
    expect(res.__body).toEqual({
      revenue: { total: 300, trend: 100 },
      transactions: { total: 4, completed: 3, trend: 100 },
      customers: { total: 10, newCustomers: 2, trend: 100 },
      successRate: { rate: 75, trend: 25 },
      averageTransactionValue: 100,
    });
  });

  it("control: an empty org still returns the zeroed metrics shape", async () => {
    mockTxnFind.mockResolvedValue([]);
    mockTxnAggregate.mockResolvedValue([]);
    mockCustomerCount.mockResolvedValue(0);
    const res: any = await metricsGET(
      fakeRequest("http://localhost/api/v1/dashboard/metrics"),
    );
    expect(res.__body).toEqual({
      revenue: { total: 0, trend: 0 },
      transactions: { total: 0, completed: 0, trend: 0 },
      customers: { total: 0, newCustomers: 0, trend: 0 },
      successRate: { rate: 0, trend: 0 },
      averageTransactionValue: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// F-M13: limit clamps
// ---------------------------------------------------------------------------
describe("list limit clamps (F-M13)", () => {
  it("pin: customers list clamps limit=1000000 to 100", async () => {
    let query: FakeQuery<any>;
    mockCustomerFind.mockImplementation(() => {
      query = new FakeQuery(rows(150, "c"));
      return query;
    });
    mockCustomerCount.mockResolvedValue(150);
    const res: any = await customersGET(
      fakeRequest("http://localhost/api/v1/customers?limit=1000000"),
    );
    expect(query!.limitN).toBe(100);
    expect(res.__body.pagination.limit).toBe(100);
    expect(res.__body.customers).toHaveLength(100);
    expect(res.__body.pagination.total).toBe(150);
  });

  it("control: customers list honors a normal limit", async () => {
    mockCustomerFind.mockImplementation(() => new FakeQuery(rows(150, "c")));
    mockCustomerCount.mockResolvedValue(150);
    const res: any = await customersGET(
      fakeRequest("http://localhost/api/v1/customers?limit=10"),
    );
    expect(res.__body.customers).toHaveLength(10);
    expect(res.__body.pagination.limit).toBe(10);
  });

  it("pin: transactions list clamps limit=1000000 to 100", async () => {
    let query: FakeQuery<any>;
    mockTxnFind.mockImplementation(() => {
      query = new FakeQuery(rows(150, "t"));
      return query;
    });
    mockTxnCount.mockResolvedValue(150);
    const res: any = await transactionsGET(
      fakeRequest("http://localhost/api/v1/transactions?limit=1000000"),
    );
    expect(query!.limitN).toBe(100);
    expect(res.__body.pagination.limit).toBe(100);
    expect(res.__body.transactions).toHaveLength(100);
  });

  it("control: transactions list honors a normal limit", async () => {
    mockTxnFind.mockImplementation(() => new FakeQuery(rows(150, "t")));
    mockTxnCount.mockResolvedValue(150);
    const res: any = await transactionsGET(
      fakeRequest("http://localhost/api/v1/transactions?limit=10"),
    );
    expect(res.__body.transactions).toHaveLength(10);
    expect(res.__body.pagination.limit).toBe(10);
  });

  it("control: audit-logs honors a small limit", async () => {
    mockOrgFindById.mockResolvedValue({
      _id: "org1",
      subscriptionTier: "enterprise",
    });
    const res: any = await auditLogsGET(
      fakeRequest("http://localhost/api/v1/audit-logs?limit=5"),
    );
    expect(res.__ok).toBe(true);
    expect(res.logs).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// F-M13: products + discounts pagination
// ---------------------------------------------------------------------------
describe("products pagination (F-M13)", () => {
  const items = rows(150, "p");

  it("pin: default request returns the first page of at most 100", async () => {
    let query: FakeQuery<any>;
    mockProductFind.mockImplementation(() => {
      query = new FakeQuery(items);
      return query;
    });
    const res: any = await productsGET(
      fakeRequest("http://localhost/api/v1/products"),
    );
    expect(query!.limitN).toBe(100);
    expect(res.__body).toHaveLength(100);
    expect(res.__body[0]._id).toBe("p0");
  });

  it("pin: page=2 returns the remaining items and limit is clamped", async () => {
    let query: FakeQuery<any>;
    mockProductFind.mockImplementation(() => {
      query = new FakeQuery(items);
      return query;
    });
    const res: any = await productsGET(
      fakeRequest("http://localhost/api/v1/products?page=2&limit=1000000"),
    );
    expect(query!.limitN).toBe(100);
    expect(query!.skipN).toBe(100);
    expect(res.__body).toHaveLength(50);
    expect(res.__body[0]._id).toBe("p100");
  });

  it("control: filters still reach the query and the response is a bare array", async () => {
    mockProductFind.mockImplementation(() => new FakeQuery(items));
    const res: any = await productsGET(
      fakeRequest("http://localhost/api/v1/products?status=active"),
    );
    expect(mockProductFind).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1", status: "active" }),
    );
    expect(Array.isArray(res.__body)).toBe(true);
  });
});

describe("discounts pagination (F-M13)", () => {
  const items = rows(150, "d");

  function wire() {
    mockDiscountFind.mockImplementation(() => new FakeQuery(items));
    mockDiscountCount.mockResolvedValue(150);
  }

  it("pin: default request is paginated and reports pagination metadata", async () => {
    wire();
    const res: any = await discountsGET(
      fakeRequest("http://localhost/api/v1/discounts"),
    );
    expect(res.__ok).toBe(true);
    expect(res.discounts).toHaveLength(100);
    expect(res.pagination).toEqual({
      page: 1,
      limit: 100,
      total: 150,
      totalPages: 2,
    });
  });

  it("pin: page=2&limit=1000000 clamps the limit and returns the rest", async () => {
    let query: FakeQuery<any>;
    mockDiscountFind.mockImplementation(() => {
      query = new FakeQuery(items);
      return query;
    });
    mockDiscountCount.mockResolvedValue(150);
    const res: any = await discountsGET(
      fakeRequest("http://localhost/api/v1/discounts?page=2&limit=1000000"),
    );
    expect(query!.limitN).toBe(100);
    expect(res.discounts).toHaveLength(50);
    expect(res.discounts[0]._id).toBe("d100");
    expect(res.pagination.limit).toBe(100);
  });

  it("control: discounts stay an array led by the newest record", async () => {
    wire();
    const res: any = await discountsGET(
      fakeRequest("http://localhost/api/v1/discounts"),
    );
    expect(Array.isArray(res.discounts)).toBe(true);
    expect(res.discounts[0]._id).toBe("d0");
  });
});
