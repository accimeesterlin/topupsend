/**
 * @jest-environment node
 *
 * RBAC regression pins for the 2026-11-22 TopUpSend RBAC audit
 * (~/workspace/your_files/topupsend/rbac-audit-2026-11-22.md):
 *
 * C1 — demotion/removal did not stick. Every session mint (password
 * login, PG SSO) read roles from the legacy global `User.roles`,
 * written once at account creation and never updated, while role
 * administration writes only `UserOrganization`. A member demoted
 * ADMIN → VIEWER (or removed entirely) regained their original
 * roles at their next sign-in. These tests drive the REAL login
 * route and the REAL PG SSO session helper against an in-memory
 * store where the membership deliberately diverges from the global
 * field — on the pre-fix code every C1 case fails (token carries
 * the stale global roles, or a removed member gets a session).
 *
 * C2 (issuance layer) — a freshly self-registered, UNVERIFIED
 * storefront customer could mint a `topup:send` API key and spend
 * the organization's DingConnect funds through the partner API.
 * Key creation now requires a verified customer and refuses the
 * org-acting scopes. (The partner-API owner-class rejection is
 * pinned in partner-api.test.ts.)
 */
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Shared mock state (mock-prefixed so jest.mock factories may use it)
// ---------------------------------------------------------------------------

const mockUsers: any[] = [];
const mockUserOrgs: any[] = [];
const mockKeys: any[] = [];
const mockCookieJar = new Map<string, string>();

function mockMakeDoc(fields: Record<string, any>) {
  const doc: any = { ...fields };
  doc.save = jest.fn(async () => doc);
  return doc;
}

/** A thenable query stub with the chain methods the routes use. */
function mockQuery(doc: any) {
  const result = Promise.resolve(doc);
  const q: any = {
    select: () => Promise.resolve(doc),
    sort: () => q,
    populate: () => Promise.resolve(doc),
    then: result.then.bind(result),
    catch: result.catch.bind(result),
    finally: result.finally.bind(result),
  };
  return q;
}

function mockMatches(doc: any, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (value && typeof value === "object") return false;
    return String(doc[key]) === String(value);
  });
}

function mockFindOne(collection: any[], query: Record<string, any>) {
  return mockQuery(
    collection.find((doc) => mockMatches(doc, query)) ?? null,
  );
}

function mockBuildUserModel() {
  return {
    findOne: jest.fn((query: any) => mockFindOne(mockUsers, query)),
    findById: jest.fn((id: any) =>
      mockQuery(
        mockUsers.find((u) => String(u._id) === String(id)) ?? null,
      ),
    ),
  };
}

const mockRequireAuth = jest.fn();
const mockRequireCustomerAuth = jest.fn();

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: class {},
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({
    get: (name: string) =>
      mockCookieJar.has(name)
        ? { name, value: mockCookieJar.get(name) }
        : undefined,
    set: (name: string, value: string) => {
      mockCookieJar.set(name, value);
    },
    delete: (name: string) => {
      mockCookieJar.delete(name);
    },
  })),
}));

function mockResponse(extra: Record<string, any> = {}) {
  const setCookies: string[] = [];
  const headerMap = new Map<string, string>();
  return {
    headers: {
      set: (k: string, v: string) => {
        headerMap.set(k.toLowerCase(), v);
        if (k.toLowerCase() === "set-cookie") setCookies.push(v);
      },
      append: (k: string, v: string) => {
        if (k.toLowerCase() === "set-cookie") setCookies.push(v);
      },
      get: (k: string) => headerMap.get(k.toLowerCase()) ?? null,
    },
    cookies: {
      set: jest.fn((name: string, value: string) => {
        mockCookieJar.set(name, value);
      }),
    },
    __setCookies: setCookies,
    ...extra,
  };
}

jest.mock("@/lib/api-response", () => ({
  createSuccessResponse: (data: unknown) =>
    mockResponse({ __ok: true, status: 200, data }),
  createCreatedResponse: (data: unknown) =>
    mockResponse({ __ok: true, status: 201, data }),
  createErrorResponse: (message: string, status: number) =>
    mockResponse({ __ok: false, status, message }),
  createNoContentResponse: () => mockResponse({ status: 204 }),
}));

jest.mock("@/lib/api-error", () => {
  class ApiException extends Error {
    status: number;
    detail?: string;
    constructor(status: number, detail?: string) {
      super(detail || "ApiException");
      this.status = status;
      this.detail = detail;
    }
  }
  const make =
    (status: number) =>
    (detail?: string, _ext?: Record<string, any>) =>
      new ApiException(status, detail);
  return {
    ApiException,
    ApiErrors: {
      BadRequest: make(400),
      Unauthorized: (detail?: string) =>
        new ApiException(401, detail || "Authentication required"),
      Forbidden: make(403),
      NotFound: make(404),
      Conflict: make(409),
      UnprocessableEntity: make(422),
      TooManyRequests: make(429),
      InternalServerError: make(500),
      ServiceUnavailable: make(503),
    },
    handleApiError: (error: any) =>
      error && typeof error.status === "number"
        ? mockResponse({
            __error: true,
            status: error.status,
            message: error.detail || error.message,
          })
        : mockResponse({ __error: true, status: 500, message: "Internal" }),
  };
});

jest.mock("@/lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@/lib/sentry-utils", () => ({
  setSentryUser: jest.fn(),
  clearSentryUser: jest.fn(),
}));

jest.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  requireCustomerAuth: (...args: any[]) => mockRequireCustomerAuth(...args),
  // Faithful stand-in for the real requireVerifiedCustomer: same
  // session, plus the emailVerified gate.
  requireVerifiedCustomer: async (...args: any[]) => {
    const customer = await mockRequireCustomerAuth(...args);
    if (!customer.emailVerified) {
      const err: any = new Error(
        "Email verification required. Please verify your email to continue.",
      );
      err.status = 403;
      throw err;
    }
    return customer;
  },
}));

jest.mock("@topupsend/db", () => {
  const crypto = jest.requireActual("crypto");
  return {
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
    User: mockBuildUserModel(),
    UserOrganization: {
      findOne: jest.fn((query: any) => mockFindOne(mockUserOrgs, query)),
    },
    Org: {
      findOne: jest.fn(async () => null),
      findById: jest.fn((id: any) => mockQuery({ _id: id, slug: "acme" })),
    },
    ApiKey: {
      generateKey: (ownerType: string) => {
        const random = crypto.randomBytes(32).toString("hex");
        const key = `${ownerType === "staff" ? "sk_live" : "ck_live"}_${random}`;
        return {
          key,
          hash: crypto.createHash("sha256").update(key).digest("hex"),
          prefix: key.substring(0, 12),
        };
      },
      create: jest.fn(async (data: any) => {
        const doc = {
          _id: `key-${mockKeys.length + 1}`,
          lastUsedAt: null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          getRateLimit() {
            return this.customRateLimit ?? this.rateLimit;
          },
        };
        mockKeys.push(doc);
        return doc;
      }),
      find: jest.fn(() => ({ sort: () => Promise.resolve([]) })),
    },
  };
});

// The login route imports the db connection and the User model by
// subpath; jest's mapper only rewrites the exact "@topupsend/db"
// specifier, so register the same fakes against the resolved paths
// (same pattern as auth-hardening.test.ts).
jest.mock("../../../packages/db/src/connection", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../../packages/db/src/models/user.model", () => ({
  User: mockBuildUserModel(),
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { POST as loginPOST } from "../../app/api/v1/auth/login/route";
import { POST as apiKeysPOST } from "../../app/api/v1/api-keys/route";
import { createPgUserSessionToken } from "@/lib/pg-sso/session";
import { verifyToken } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASSWORD = "correct-horse-battery";
let passwordHash = "";

function fakeRequest(
  body: unknown,
  opts: { ip?: string } = {},
) {
  return {
    json: jest.fn().mockResolvedValue(body),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-forwarded-for"
          ? (opts.ip ?? "203.0.113.10")
          : null,
    },
    cookies: { get: () => undefined },
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

/** The seeded staffer's GLOBAL record always says ADMIN — the stale
 *  field. Scenarios diverge the membership from it on purpose. */
function seedStaffUser(overrides: Record<string, any> = {}) {
  const user = mockMakeDoc({
    _id: "user-1",
    email: "staff@example.com",
    passwordHash,
    roles: ["ADMIN"],
    orgId: "org1",
    isActive: true,
    twoFactorEnabled: false,
    tokenVersion: 0,
    ...overrides,
  });
  mockUsers.push(user);
  return user;
}

function seedMembership(overrides: Record<string, any> = {}) {
  const membership = mockMakeDoc({
    _id: "uo-1",
    userId: "user-1",
    orgId: "org1",
    roles: ["ADMIN"],
    isActive: true,
    joinedAt: new Date(),
    ...overrides,
  });
  mockUserOrgs.push(membership);
  return membership;
}

async function sessionPayloadFromLogin(res: any) {
  const entry = (res.__setCookies as string[]).find((c) =>
    c.startsWith("session="),
  );
  if (!entry) return null;
  const token = entry.slice("session=".length).split(";")[0];
  return verifyToken(token);
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 10);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUsers.length = 0;
  mockUserOrgs.length = 0;
  mockKeys.length = 0;
  mockCookieJar.clear();
});

// ---------------------------------------------------------------------------
// C1 — session mints read the membership record
// ---------------------------------------------------------------------------

describe("RBAC C1 — password login mints membership roles", () => {
  it("demotion sticks: membership VIEWER wins over global ADMIN", async () => {
    seedStaffUser();
    seedMembership({ roles: ["VIEWER"] });

    const res: any = await loginPOST(
      fakeRequest(
        { email: "staff@example.com", password: PASSWORD },
        { ip: "203.0.113.21" },
      ),
    );

    expect(res.status).toBe(200);
    const payload = await sessionPayloadFromLogin(res);
    expect(payload?.roles).toEqual(["VIEWER"]);
    expect(payload?.orgId).toBe("org1");
    expect(res.data.user.roles).toEqual(["VIEWER"]);
  });

  it("removal sticks: no active membership → login refused, no session", async () => {
    seedStaffUser();
    seedMembership({ isActive: false });

    const res: any = await loginPOST(
      fakeRequest(
        { email: "staff@example.com", password: PASSWORD },
        { ip: "203.0.113.22" },
      ),
    );

    expect(res.status).toBe(403);
    expect(await sessionPayloadFromLogin(res)).toBeNull();
  });

  it("home-org removal falls back to another ACTIVE membership with ITS roles", async () => {
    const user = seedStaffUser();
    seedMembership({ isActive: false });
    seedMembership({
      _id: "uo-2",
      orgId: "org2",
      roles: ["OPERATOR"],
      joinedAt: new Date(Date.now() + 1000),
    });

    const res: any = await loginPOST(
      fakeRequest(
        { email: "staff@example.com", password: PASSWORD },
        { ip: "203.0.113.23" },
      ),
    );

    expect(res.status).toBe(200);
    const payload = await sessionPayloadFromLogin(res);
    expect(payload?.orgId).toBe("org2");
    expect(payload?.roles).toEqual(["OPERATOR"]);
    // The fallback org becomes the recorded default, as before.
    expect(String(user.orgId)).toBe("org2");
  });

  it("control: membership ADMIN still mints ADMIN", async () => {
    seedStaffUser();
    seedMembership({ roles: ["ADMIN"] });

    const res: any = await loginPOST(
      fakeRequest(
        { email: "staff@example.com", password: PASSWORD },
        { ip: "203.0.113.24" },
      ),
    );

    expect(res.status).toBe(200);
    const payload = await sessionPayloadFromLogin(res);
    expect(payload?.roles).toEqual(["ADMIN"]);
  });
});

describe("RBAC C1 — PG SSO mints membership roles", () => {
  it("demotion sticks on the SSO path too", async () => {
    seedStaffUser();
    seedMembership({ roles: ["VIEWER"] });

    const token = await createPgUserSessionToken("user-1");
    expect(token).not.toBeNull();
    const payload = await verifyToken(token!);
    expect(payload?.roles).toEqual(["VIEWER"]);
    expect(payload?.orgId).toBe("org1");
  });

  it("removed member gets no SSO session", async () => {
    seedStaffUser();
    seedMembership({ isActive: false });

    await expect(createPgUserSessionToken("user-1")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C2 — customer key issuance
// ---------------------------------------------------------------------------

describe("RBAC C2 — customer API-key issuance", () => {
  const VERIFIED = {
    customerId: "cust-1",
    orgId: "org1",
    email: "customer@example.com",
    emailVerified: true,
  };
  const UNVERIFIED = { ...VERIFIED, emailVerified: false };

  function customerPost(body: unknown) {
    return {
      url: "http://localhost/api/v1/api-keys?customer=true",
      json: jest.fn().mockResolvedValue(body),
      headers: { get: () => null },
    } as unknown as NextRequest;
  }

  it("unverified customer cannot mint ANY key (verification gate)", async () => {
    mockRequireCustomerAuth.mockResolvedValue(UNVERIFIED);

    await expect(
      apiKeysPOST(customerPost({ name: "k", scopes: ["customer:read"] })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockKeys).toHaveLength(0);
  });

  it("verified customer cannot mint topup:send", async () => {
    mockRequireCustomerAuth.mockResolvedValue(VERIFIED);

    await expect(
      apiKeysPOST(customerPost({ name: "k", scopes: ["topup:send"] })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockKeys).toHaveLength(0);
  });

  it("verified customer cannot mint transactions:create or customer:update", async () => {
    mockRequireCustomerAuth.mockResolvedValue(VERIFIED);

    await expect(
      apiKeysPOST(
        customerPost({ name: "k", scopes: ["transactions:create"] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      apiKeysPOST(customerPost({ name: "k", scopes: ["customer:update"] })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockKeys).toHaveLength(0);
  });

  it("verified customer cannot smuggle a forbidden scope in with read scopes", async () => {
    mockRequireCustomerAuth.mockResolvedValue(VERIFIED);

    await expect(
      apiKeysPOST(
        customerPost({
          name: "k",
          scopes: ["customer:read", "topup:send"],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockKeys).toHaveLength(0);
  });

  it("verified customer can still mint read scopes for their own account", async () => {
    mockRequireCustomerAuth.mockResolvedValue(VERIFIED);

    const res: any = await apiKeysPOST(
      customerPost({
        name: "Portal key",
        scopes: ["customer:read", "balance:read"],
      }),
    );

    expect(res.status).toBe(201);
    expect(res.data.key.startsWith("ck_live_")).toBe(true);
    expect(mockKeys).toHaveLength(1);
    expect(mockKeys[0].ownerType).toBe("customer");
    expect(mockKeys[0].ownerId).toBe("cust-1");
    expect(mockKeys[0].scopes).toEqual(["customer:read", "balance:read"]);
  });
});
