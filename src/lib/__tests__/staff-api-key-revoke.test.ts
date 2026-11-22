/**
 * @jest-environment node
 *
 * Staff API key REVOKE — cold-instance regression for
 * DELETE /api/v1/api-keys/[id] (the route behind the staff portal's
 * Revoke button and the customer portal's revoke flow).
 *
 * Root cause pinned here: the [id] route handlers used to run
 * `ApiKey.findById(id)` BEFORE anything established the MongoDB
 * connection (the connection is opened lazily by dbConnection.connect(),
 * which the sibling routes call first — directly or via requireAuth).
 * On a warm instance a previous request has already connected, so the
 * query runs; on a COLD instance (a fresh serverless process — the
 * [id] route is a separate function from the list route that warmed
 * the page) Mongoose buffers the query and, with no connect() ever
 * initiated, throws after the 10s buffer timeout:
 *   "Operation `apikeys.findOne()` buffering timed out after 10000ms"
 * The handler threw uncaught, the platform returned 500, and the staff
 * page showed its generic "Failed to revoke API key" — after a ~10s
 * hang with no loading indicator. Esterling hit exactly this revoking
 * a staff key by hand on sandbox (2026-11-21).
 *
 * The mock below reproduces that environment faithfully: findById
 * throws the buffer-timeout error unless dbConnection.connect() has
 * been called first. The fix is that the route connects before its
 * first query; these tests fail on the old ordering and pass on the
 * new one. Auth/ownership semantics are unchanged (the F-H4 pins in
 * idor-c4.test.ts still cover the cross-org cases).
 */
import { NextRequest } from "next/server";
import { UserRole } from "@topupsend/types";

// ---------------------------------------------------------------------------
// In-memory model store + connection state (mock-prefixed for factories)
// ---------------------------------------------------------------------------

const mockKeys = new Map<string, any>();
let mockConnected = false;
const mockCallOrder: string[] = [];

const mockRequireAuth = jest.fn();
const mockRequireCustomerAuth = jest.fn();

jest.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  requireCustomerAuth: (...args: any[]) => mockRequireCustomerAuth(...args),
}));

jest.mock("@topupsend/db", () => ({
  dbConnection: {
    connect: jest.fn(async () => {
      mockCallOrder.push("connect");
      mockConnected = true;
    }),
  },
  ApiKey: {
    findById: jest.fn(async (id: string) => {
      mockCallOrder.push("findById");
      if (!mockConnected) {
        // What real Mongoose does on an instance where connect() was
        // never initiated: buffer, then time out.
        throw new Error(
          "Operation `apikeys.findOne()` buffering timed out after 10000ms",
        );
      }
      return mockKeys.get(id) ?? null;
    }),
  },
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { DELETE, GET, PUT } from "../../app/api/v1/api-keys/[id]/route";

const ADMIN = { userId: "admin-1", orgId: "org-1", roles: [UserRole.ADMIN] };

function makeKey(overrides: Record<string, any> = {}) {
  return {
    _id: "key-1",
    orgId: "org-1",
    ownerId: "admin-1",
    ownerType: "staff",
    name: "PGecom Top Up",
    keyPrefix: "sk_live_a0be",
    scopes: ["topup:send", "transactions:read"],
    isActive: true,
    getRateLimit: () => ({ requests: 2000, window: 3600 }),
    save: jest.fn(async function (this: any) {
      mockKeys.set(String(this._id), this);
    }),
    ...overrides,
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function del(id: string) {
  return new NextRequest(`http://localhost/api/v1/api-keys/${id}`, {
    method: "DELETE",
  });
}

beforeEach(() => {
  mockKeys.clear();
  mockCallOrder.length = 0;
  mockConnected = false;
  jest.clearAllMocks();
  mockRequireAuth.mockResolvedValue(ADMIN);
});

// ---------------------------------------------------------------------------
// The cold-instance revoke (Esterling's failure)
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/api-keys/[id] — cold instance", () => {
  it("revokes the key instead of dying on the unconnected first query", async () => {
    const key = makeKey();
    mockKeys.set("key-1", key);

    const res = await DELETE(del("key-1"), params("key-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("API key revoked successfully");
    expect(key.isActive).toBe(false);
    expect(key.save).toHaveBeenCalled();
  });

  it("establishes the DB connection before the first query", async () => {
    mockKeys.set("key-1", makeKey());

    await DELETE(del("key-1"), params("key-1"));

    expect(mockCallOrder[0]).toBe("connect");
    expect(mockCallOrder.indexOf("connect")).toBeLessThan(
      mockCallOrder.indexOf("findById"),
    );
  });

  it("GET and PUT also connect before their first query", async () => {
    mockKeys.set("key-1", makeKey());

    const getRes = await GET(del("key-1"), params("key-1"));
    expect(getRes.status).toBe(200);
    expect(mockCallOrder.indexOf("connect")).toBeLessThan(
      mockCallOrder.indexOf("findById"),
    );

    mockCallOrder.length = 0;
    mockConnected = false;
    mockKeys.set("key-1", makeKey());

    const putRes = await PUT(
      new NextRequest("http://localhost/api/v1/api-keys/key-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      params("key-1"),
    );
    expect(putRes.status).toBe(200);
    expect(mockCallOrder.indexOf("connect")).toBeLessThan(
      mockCallOrder.indexOf("findById"),
    );
  });

  it("still 404s (throws) for a missing key once connected", async () => {
    await expect(DELETE(del("nope"), params("nope"))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("still refuses a cross-org key (404, no save) once connected", async () => {
    const key = makeKey({ orgId: "org-2" });
    mockKeys.set("key-1", key);

    await expect(DELETE(del("key-1"), params("key-1"))).rejects.toMatchObject({
      status: 404,
    });
    expect(key.save).not.toHaveBeenCalled();
    expect(key.isActive).toBe(true);
  });
});
