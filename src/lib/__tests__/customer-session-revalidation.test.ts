/**
 * @jest-environment node
 *
 * (Node environment so `jose` resolves to its Node build — under
 * jsdom it resolves to the untransformed ESM browser build. Same
 * pattern as auth-hardening.test.ts / session-revalidation.test.ts.)
 *
 * Customer-token follow-up to N3 (PR #22).
 *
 * PR #22 migrated the STAFF side of the customers/[id] PUT to
 * `getRevalidatedSession()`, but flagged its customer path: it
 * authorized with bare `getCustomerSession()` — signature + expiry
 * only — while every other customer-auth consumer goes through
 * `requireCustomerAuth`, which revalidates against the customer
 * record (F-M1: the record must still exist and the token's `tv`
 * must match its current tokenVersion; password reset/change and
 * logout bump it). A revoked customer token therefore kept working
 * on this route — profile edits, and password changes with the
 * current password — until its 7-day expiry. The route now calls
 * `getRevalidatedCustomerSession()`, the same revalidation in
 * getCustomerSession's null-on-refusal shape, so a refusal falls
 * through to the handler's existing 401.
 *
 * This suite pins, against the REAL auth helpers and the REAL
 * route handler (only the DB, cookie jar, and response builders
 * are faked):
 *   - a customer token whose tokenVersion has moved on (logout /
 *     password reset) is refused on the PUT, with no mutation;
 *   - a customer token for a deleted record is refused;
 *   - a valid customer token still updates the customer's own
 *     profile, and still cannot touch another customer's record;
 *   - the staff path through the same handler is unchanged
 *     (valid staff passes; deactivated staff is refused).
 */

// ---------------------------------------------------------------------------
// Shared mock state (mock-prefixed so jest.mock factories may use it)
// ---------------------------------------------------------------------------

const mockCookieJar = new Map<string, string>();
const mockCustomerStore = new Map<string, any>();
const mockUserStore = new Map<string, any>();

/** A thenable query stub with the chain methods the routes use. */
function mockQuery(doc: any) {
  const result = Promise.resolve(doc);
  const q: any = {
    select: () => Promise.resolve(doc),
    then: result.then.bind(result),
    catch: result.catch.bind(result),
    finally: result.finally.bind(result),
  };
  return q;
}

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
    set: (name: string, value: string) => {
      mockCookieJar.set(name, value);
    },
    delete: (name: string) => {
      mockCookieJar.delete(name);
    },
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

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  User: {
    findById: (id: string) => ({
      select: () => Promise.resolve(mockUserStore.get(id) ?? null),
    }),
  },
  Customer: {
    findById: (id: string) =>
      mockQuery(mockCustomerStore.get(String(id)) ?? null),
    checkDuplicates: async () => null,
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { UserRole } from "@topupsend/types";
import { createToken } from "@/lib/auth";
import {
  createCustomerSession,
  getCustomerSession,
  getRevalidatedCustomerSession,
} from "@/lib/customer-auth";
import { PUT as customerPUT } from "../../app/api/v1/customers/[id]/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CUSTOMER_ID = "cust-1";
const STAFF_ID = "user-1";
const ORG_ID = "org-1";

function seedCustomer(overrides: Record<string, unknown> = {}) {
  const customer: any = {
    _id: CUSTOMER_ID,
    orgId: ORG_ID,
    email: "customer@example.com",
    name: "Original Name",
    phoneNumber: "+15550001111",
    tokenVersion: 0,
    ...overrides,
  };
  customer.save = jest.fn(async () => customer);
  mockCustomerStore.set(CUSTOMER_ID, customer);
  return customer;
}

function seedStaffUser(overrides: Record<string, unknown> = {}) {
  const user = {
    _id: STAFF_ID,
    email: "staff@example.com",
    isActive: true,
    tokenVersion: 0,
    ...overrides,
  };
  mockUserStore.set(STAFF_ID, user);
  return user;
}

/** Mint a real customer session token into the cookie jar. */
async function mintCustomerSession(tv = 0): Promise<void> {
  await createCustomerSession({
    customerId: CUSTOMER_ID,
    orgId: ORG_ID,
    email: "customer@example.com",
    emailVerified: true,
    name: "Original Name",
    tv,
  });
}

/** Mint a real staff session token into the cookie jar. */
async function mintStaffSession(tv = 0): Promise<void> {
  const token = await createToken({
    userId: STAFF_ID,
    email: "staff@example.com",
    roles: [UserRole.ADMIN],
    orgId: ORG_ID,
    tv,
  });
  mockCookieJar.set("session", token);
}

function fakePutRequest(body: Record<string, unknown>): any {
  return {
    cookies: {
      get: (name: string) => {
        const value = mockCookieJar.get(name);
        return value ? { name, value } : undefined;
      },
    },
    json: async () => body,
    headers: { get: () => null },
  };
}

function runPut(body: Record<string, unknown>, id = CUSTOMER_ID): Promise<any> {
  return customerPUT(fakePutRequest(body), {
    params: Promise.resolve({ id }),
  });
}

beforeAll(() => {
  // The handler logs verbosely; keep the suite output readable.
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  mockCookieJar.clear();
  mockCustomerStore.clear();
  mockUserStore.clear();
});

// ---------------------------------------------------------------------------
// The helper itself
// ---------------------------------------------------------------------------

describe("getRevalidatedCustomerSession — F-M1 revalidation in getCustomerSession shape", () => {
  it("returns the session for a customer with a current tokenVersion", async () => {
    seedCustomer();
    await mintCustomerSession(0);

    await expect(getRevalidatedCustomerSession()).resolves.toMatchObject({
      customerId: CUSTOMER_ID,
      orgId: ORG_ID,
    });
  });

  it("returns null when the tokenVersion has moved past the token (password reset / logout)", async () => {
    seedCustomer({ tokenVersion: 1 });
    await mintCustomerSession(0);

    await expect(getRevalidatedCustomerSession()).resolves.toBeNull();
  });

  it("returns null when the customer record no longer exists", async () => {
    await mintCustomerSession(0);

    await expect(getRevalidatedCustomerSession()).resolves.toBeNull();
  });

  it("returns null with no customer-session cookie", async () => {
    seedCustomer();

    await expect(getRevalidatedCustomerSession()).resolves.toBeNull();
  });

  it("bare getCustomerSession() still returns claims for a revoked token — the gap this closes", async () => {
    seedCustomer({ tokenVersion: 9 });
    await mintCustomerSession(0);

    // Claims-only: signature + expiry pass, so the payload comes
    // back even though the session is revoked. This is exactly why
    // the PUT no longer authorizes its customer path with it.
    await expect(getCustomerSession()).resolves.toMatchObject({
      customerId: CUSTOMER_ID,
    });
    await expect(getRevalidatedCustomerSession()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The customers/[id] PUT handler
// ---------------------------------------------------------------------------

describe("PUT /customers/[id] — customer path revalidation", () => {
  it("refuses a customer token revoked after mint (logout bump) with the handler's 401 and mutates nothing", async () => {
    const customer = seedCustomer();
    await mintCustomerSession(0);

    // Logout / password reset bumps the record's tokenVersion; the
    // already-issued token in the cookie jar is now stale.
    customer.tokenVersion = 1;

    const res = await runPut({ name: "Hijacked Name" });

    expect(res.status).toBe(401);
    expect(res.__body).toEqual({ error: "Unauthorized" });
    expect(customer.name).toBe("Original Name");
    expect(customer.save).not.toHaveBeenCalled();
  });

  it("refuses a customer token whose record was deleted, with the handler's 401", async () => {
    await mintCustomerSession(0);

    const res = await runPut({ name: "Ghost Name" });

    expect(res.status).toBe(401);
    expect(res.__body).toEqual({ error: "Unauthorized" });
  });

  it("accepts a valid customer token updating its own profile", async () => {
    const customer = seedCustomer();
    await mintCustomerSession(0);

    const res = await runPut({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(customer.name).toBe("New Name");
    expect(customer.save).toHaveBeenCalled();
  });

  it("still refuses a valid customer token aimed at another customer's record with 403", async () => {
    seedCustomer();
    await mintCustomerSession(0);

    const res = await runPut({ name: "Not Yours" }, "cust-2");

    expect(res.status).toBe(403);
    expect(res.__body).toEqual({ error: "Forbidden" });
  });
});

describe("PUT /customers/[id] — staff path unchanged", () => {
  it("accepts an active staff session with a current tokenVersion", async () => {
    const customer = seedCustomer();
    seedStaffUser();
    await mintStaffSession(0);

    const res = await runPut({ name: "Staff Rename" });

    expect(res.status).toBe(200);
    expect(customer.name).toBe("Staff Rename");
    expect(customer.save).toHaveBeenCalled();
  });

  it("refuses a deactivated staff session with the handler's 401", async () => {
    const customer = seedCustomer();
    seedStaffUser({ isActive: false });
    await mintStaffSession(0);

    const res = await runPut({ name: "Staff Rename" });

    expect(res.status).toBe(401);
    expect(res.__body).toEqual({ error: "Unauthorized" });
    expect(customer.name).toBe("Original Name");
    expect(customer.save).not.toHaveBeenCalled();
  });
});
