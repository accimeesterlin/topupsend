/**
 * @jest-environment node
 *
 * (Node environment so `jose` resolves to its Node build — under
 * jsdom it resolves to the untransformed ESM browser build. Same
 * pattern as auth-hardening.test.ts.)
 *
 * N3 — session revalidation convergence for the formerly
 * bare-`getSession()` routes.
 *
 * `requireAuth` has revalidated the JWT against the user record
 * since F-M1 (user must still exist and be active, and the token's
 * version must match the record's tokenVersion). 21 route files
 * instead authorized with bare `getSession()` — signature + expiry
 * only — so a deactivated or password-reset staff account kept
 * working on them until the 7-day token expired. Those routes now
 * call `getRevalidatedSession()`, which performs the same
 * revalidation in getSession's null-on-refusal shape so each route
 * keeps its own error responses.
 *
 * This suite pins, against the REAL auth helpers and REAL route
 * handlers (only the DB, cookie jar, and response builders are
 * faked):
 *   - a deactivated user is refused on one route per migrated
 *     family;
 *   - a stale-tokenVersion session is refused on the same routes;
 *   - an active user with a current tokenVersion passes on the
 *     same routes;
 *   - the helper itself returns null for a missing user record,
 *     and bare `getSession()` still returns claims for a revoked
 *     token (the documented reason routes must not use it).
 */

// ---------------------------------------------------------------------------
// Shared mock state (mock-prefixed so jest.mock factories may use it)
// ---------------------------------------------------------------------------

const mockCookieJar = new Map<string, string>();
const mockUserStore = new Map<string, any>();

// A minimal thenable query chain: find().sort().skip().limit() etc.
// resolve to the given value when awaited.
const mockQueryChain = (value: any): any => {
  const chain: any = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    select: () => chain,
    lean: () => chain,
    then: (resolve: any) => resolve(value),
  };
  return chain;
};

const mockOrg = {
  _id: "org-1",
  name: "Test Org",
  slug: "test-org",
  settings: {},
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      __body: body,
    }),
  },
}));

jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookieJar.get(name);
      return value ? { name, value } : undefined;
    },
  }),
}));

jest.mock("@/lib/api-response", () => ({
  createSuccessResponse: (data: unknown) => ({
    __ok: true,
    status: 200,
    ...(data as object),
  }),
  createCreatedResponse: (data: unknown) => ({
    __ok: true,
    status: 201,
    ...(data as object),
  }),
  createErrorResponse: (message: string, status: number) => ({
    __ok: false,
    message,
    status,
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

jest.mock("@/lib/services/dingconnect.service", () => ({
  DingConnectService: class {},
  createDingConnectService: () => ({
    getProviders: async () => [],
    getBalance: async () => ({ AccountBalance: 0, CurrencyCode: "USD" }),
  }),
}));

jest.mock("@/lib/services/reloadly.service", () => ({
  ReloadlyService: class {},
}));

jest.mock(
  "@topupsend/db/connection",
  () => ({
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  }),
  { virtual: true },
);

jest.mock(
  "../../../packages/db/src/connection",
  () => ({
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  }),
);

jest.mock(
  "@topupsend/db/models/org.model",
  () => ({
    Org: {
      findById: async () => mockOrg,
    },
  }),
  { virtual: true },
);

// Same mock via the resolved path (the organization route's
// subpath import resolves here, as with the connection module in
// idor-c4.test.ts).
jest.mock("../../../packages/db/src/models/org.model", () => ({
  Org: {
    findById: async () => mockOrg,
  },
}));

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  User: {
    findById: (id: string) => ({
      select: () => Promise.resolve(mockUserStore.get(id) ?? null),
    }),
  },
  Customer: {
    countDocuments: async () => 0,
    find: () => mockQueryChain([]),
  },
  CustomerGroup: {
    find: () => mockQueryChain([]),
  },
  Integration: {
    findOne: () => ({ select: () => Promise.resolve(null) }),
  },
  Transaction: {
    countDocuments: async () => 0,
    find: () => mockQueryChain([]),
  },
  Product: {
    find: () => mockQueryChain([]),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  createToken,
  getRevalidatedSession,
  getSession,
} from "@/lib/auth";
import { GET as customerGroupsGET } from "../../app/api/v1/customer-groups/route";
import { GET as customersGET } from "../../app/api/v1/customers/route";
import { GET as dashboardBalanceGET } from "../../app/api/v1/dashboard/balance/route";
import { GET as providersGET } from "../../app/api/v1/integrations/providers/route";
import { GET as organizationGET } from "../../app/api/v1/organization/route";
import { GET as productsGET } from "../../app/api/v1/products/route";
import { GET as transactionsGET } from "../../app/api/v1/transactions/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const ORG_ID = "org-1";

function seedUser(overrides: Record<string, unknown> = {}) {
  const user = {
    _id: USER_ID,
    email: "staff@example.com",
    isActive: true,
    tokenVersion: 0,
    ...overrides,
  };
  mockUserStore.set(USER_ID, user);
  return user;
}

async function mintSession(tv = 0): Promise<string> {
  const token = await createToken({
    userId: USER_ID,
    email: "staff@example.com",
    roles: ["ADMIN"] as any,
    orgId: ORG_ID,
    tv,
  });
  mockCookieJar.set("session", token);
  return token;
}

function fakeRequest(url: string): any {
  return {
    url,
    cookies: { get: () => undefined },
    headers: { get: () => null },
  };
}

// One representative GET route per migrated family. `pastAuthStatus`
// is the status the handler returns once authentication has passed
// (the providers route answers 404 when no integration exists —
// reaching that answer at all proves the session was accepted).
const FAMILY_ROUTES: Array<{
  family: string;
  run: () => Promise<any>;
  pastAuthStatus: number;
}> = [
  {
    family: "customer-groups",
    run: () => customerGroupsGET(fakeRequest("http://localhost/api/v1/customer-groups")),
    pastAuthStatus: 200,
  },
  {
    family: "customers",
    run: () => customersGET(fakeRequest("http://localhost/api/v1/customers")),
    pastAuthStatus: 200,
  },
  {
    family: "dashboard",
    run: () => dashboardBalanceGET(),
    pastAuthStatus: 200,
  },
  {
    family: "integrations",
    run: () => providersGET(fakeRequest("http://localhost/api/v1/integrations/providers")),
    pastAuthStatus: 404,
  },
  {
    family: "organization",
    run: () => organizationGET(fakeRequest("http://localhost/api/v1/organization")),
    pastAuthStatus: 200,
  },
  {
    family: "products",
    run: () => productsGET(fakeRequest("http://localhost/api/v1/products")),
    pastAuthStatus: 200,
  },
  {
    family: "transactions",
    run: () => transactionsGET(fakeRequest("http://localhost/api/v1/transactions")),
    pastAuthStatus: 200,
  },
];

beforeEach(() => {
  mockCookieJar.clear();
  mockUserStore.clear();
});

// ---------------------------------------------------------------------------
// The helper itself
// ---------------------------------------------------------------------------

describe("getRevalidatedSession — F-M1 revalidation in getSession shape", () => {
  it("returns the session for an active user with a current tokenVersion", async () => {
    seedUser();
    await mintSession(0);

    await expect(getRevalidatedSession()).resolves.toMatchObject({
      userId: USER_ID,
      orgId: ORG_ID,
    });
  });

  it("returns null for a deactivated user", async () => {
    seedUser({ isActive: false });
    await mintSession(0);

    await expect(getRevalidatedSession()).resolves.toBeNull();
  });

  it("returns null when the tokenVersion has moved past the token (password reset / logout)", async () => {
    seedUser({ tokenVersion: 1 });
    await mintSession(0);

    await expect(getRevalidatedSession()).resolves.toBeNull();
  });

  it("returns null when the user record no longer exists", async () => {
    await mintSession(0);

    await expect(getRevalidatedSession()).resolves.toBeNull();
  });

  it("returns null with no session cookie", async () => {
    seedUser();

    await expect(getRevalidatedSession()).resolves.toBeNull();
  });

  it("bare getSession() still returns claims for a revoked token — the gap this closes", async () => {
    seedUser({ isActive: false, tokenVersion: 9 });
    await mintSession(0);

    // Claims-only: signature + expiry pass, so the payload comes
    // back even though the session is revoked. This is exactly why
    // the migrated routes no longer authorize with getSession().
    await expect(getSession()).resolves.toMatchObject({ userId: USER_ID });
    await expect(getRevalidatedSession()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Representative migrated routes, one per family
// ---------------------------------------------------------------------------

describe("migrated routes refuse revoked sessions", () => {
  for (const { family, run, pastAuthStatus } of FAMILY_ROUTES) {
    describe(family, () => {
      it("refuses a deactivated user with the route's own 401", async () => {
        seedUser({ isActive: false });
        await mintSession(0);

        const res = await run();
        expect(res.status).toBe(401);
      });

      it("refuses a stale-tokenVersion session with the route's own 401", async () => {
        seedUser({ tokenVersion: 1 });
        await mintSession(0);

        const res = await run();
        expect(res.status).toBe(401);
      });

      it("accepts an active user with a current tokenVersion", async () => {
        seedUser();
        await mintSession(0);

        const res = await run();
        expect(res.status).toBe(pastAuthStatus);
      });
    });
  }
});
