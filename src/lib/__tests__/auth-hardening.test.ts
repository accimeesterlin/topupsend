/**
 * @jest-environment node
 *
 * (Node environment so `jose` resolves to its Node build — under
 * jsdom it resolves to the untransformed ESM browser build, the
 * pre-existing failure that keeps auth.test.ts from running.)
 *
 * Cluster 3 pins — auth hardening.
 *
 * - Missing JWT secrets fail closed (F-C9): no token is issued and
 *   none is accepted, including one signed with the former published
 *   fallback literals.
 * - 2FA verify is a second factor, not a standalone login (F-H1):
 *   without the post-password pending-auth state it mints nothing,
 *   codes are stored hashed, and wrong guesses lock the flow out.
 * - Credential endpoints are rate limited (F-M6).
 * - Sessions are revalidated (F-M1): a password reset revokes
 *   outstanding tokens; a fresh login works.
 * - The unauthenticated debug routes and the sentry example route
 *   are gone (F-H2 / F-L4).
 *
 * The security assertions FAIL on pristine sandbox and PASS on the
 * fix branch; the legitimate-flow controls pass on both.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Shared mock state (mock-prefixed so jest.mock factories may use it)
// ---------------------------------------------------------------------------

const mockCookieJar = new Map<string, string>();
const mockSendEmail = jest.fn().mockResolvedValue(true);

const mockState = {
  users: [] as any[],
  customers: [] as any[],
  orgs: [] as any[],
};

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
    if (value && typeof value === "object" && "$gt" in value) {
      return doc[key] != null && new Date(doc[key]) > new Date(value.$gt);
    }
    if (value && typeof value === "object") return false;
    return String(doc[key]) === String(value);
  });
}

function mockFindOne(collection: any[], query: Record<string, any>) {
  return mockQuery(
    collection.find((doc) => mockMatches(doc, query)) ?? null,
  );
}

function mockUpdateOne(collection: any[], filter: any, update: any) {
  const doc = collection.find((d) => String(d._id) === String(filter._id));
  if (doc && update?.$inc?.tokenVersion) {
    doc.tokenVersion = (doc.tokenVersion ?? 0) + update.$inc.tokenVersion;
  }
  return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
}

// The builders are function declarations on purpose: jest.mock
// factories execute while the file's imports are being required,
// before any const initializer runs. A builder only creates jest.fn
// arrows that close over mockState — the state itself is read when
// the fakes are invoked during a test, never at factory time.
function mockBuildUserModel() {
  return {
    findOne: jest.fn((query: any) => mockFindOne(mockState.users, query)),
    findById: jest.fn((id: any) =>
      mockQuery(
        mockState.users.find((u) => String(u._id) === String(id)) ?? null,
      ),
    ),
    updateOne: jest.fn((filter: any, update: any) =>
      mockUpdateOne(mockState.users, filter, update),
    ),
  };
}

function mockBuildCustomerModel() {
  return {
    findOne: jest.fn((query: any) =>
      mockFindOne(mockState.customers, query),
    ),
    findById: jest.fn((id: any) =>
      mockQuery(
        mockState.customers.find((c) => String(c._id) === String(id)) ??
          null,
      ),
    ),
    updateOne: jest.fn((filter: any, update: any) =>
      mockUpdateOne(mockState.customers, filter, update),
    ),
  };
}

function mockBuildOrgModel() {
  return {
    findOne: jest.fn((query: any) => mockFindOne(mockState.orgs, query)),
    findById: jest.fn((id: any) =>
      mockQuery(
        mockState.orgs.find((o) => String(o._id) === String(id)) ?? {
          _id: id,
          name: "Test Org",
        },
      ),
    ),
  };
}

function mockBuildDbConnection() {
  return { connect: jest.fn().mockResolvedValue(undefined) };
}

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

jest.mock("@/lib/services/email.service", () => ({
  EmailService: {
    sendEmail: (...args: any[]) => (mockSendEmail as any)(...args),
  },
}));

jest.mock("@topupsend/db", () => ({
  dbConnection: mockBuildDbConnection(),
  User: mockBuildUserModel(),
  Customer: mockBuildCustomerModel(),
  Org: mockBuildOrgModel(),
  Organization: mockBuildOrgModel(),
  UserOrganization: {
    findOne: jest.fn(() => mockQuery(null)),
  },
  ApiKey: { findOne: jest.fn(() => mockQuery(null)) },
}));

jest.mock(
  "@topupsend/db/connection",
  () => ({
    dbConnection: mockBuildDbConnection(),
  }),
  { virtual: true },
);

jest.mock(
  "@topupsend/db/models/user.model",
  () => ({
    User: mockBuildUserModel(),
  }),
  { virtual: true },
);

// The virtual mocks above do NOT intercept the routes' requires:
// jest's moduleNameMapper maps only the exact "@topupsend/db"
// specifier, so "@topupsend/db/connection" and
// "@topupsend/db/models/user.model" resolve through node_modules to
// the real files — and the real dbConnection then tries to reach
// mongodb://localhost:27017, hanging every route test. Registering
// the same factories against the resolved file paths is what
// actually intercepts them.
jest.mock("../../../packages/db/src/connection", () => ({
  dbConnection: mockBuildDbConnection(),
}));

jest.mock("../../../packages/db/src/models/user.model", () => ({
  User: mockBuildUserModel(),
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { POST as staffLoginPOST } from "../../app/api/v1/auth/login/route";
import { POST as staffSendCodePOST } from "../../app/api/v1/auth/2fa/send-code/route";
import { POST as staffVerifyPOST } from "../../app/api/v1/auth/2fa/verify/route";
import { POST as staffResetPasswordPOST } from "../../app/api/v1/auth/reset-password/route";
import { POST as customerLoginPOST } from "../../app/api/v1/customer-auth/login/route";
import { POST as customerSendCodePOST } from "../../app/api/v1/customer-auth/2fa/send-code/route";
import { POST as customerVerifyCodePOST } from "../../app/api/v1/customer-auth/2fa/verify-code/route";
import { requireAuth, requireCustomerAuth } from "@/lib/auth-middleware";
import { verifyToken } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASSWORD = "correct-horse-battery";
let passwordHash = "";

function fakeRequest(
  body: unknown,
  opts: { cookies?: Record<string, string>; ip?: string } = {},
) {
  const cookieMap = new Map(Object.entries(opts.cookies ?? {}));
  return {
    json: jest.fn().mockResolvedValue(body),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-forwarded-for"
          ? (opts.ip ?? "203.0.113.10")
          : null,
    },
    cookies: {
      get: (name: string) =>
        cookieMap.has(name)
          ? { name, value: cookieMap.get(name) }
          : undefined,
    },
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

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
  mockState.users.push(user);
  return user;
}

function seedCustomer(overrides: Record<string, any> = {}) {
  const customer = mockMakeDoc({
    _id: "cust-1",
    email: "customer@example.com",
    orgId: "org1",
    passwordHash,
    twoFactorEnabled: false,
    emailVerified: true,
    name: "Test Customer",
    currentBalance: 0,
    balanceCurrency: "USD",
    tokenVersion: 0,
    ...overrides,
  });
  customer.comparePassword = (pw: string) =>
    bcrypt.compare(pw, customer.passwordHash);
  mockState.customers.push(customer);
  return customer;
}

function seedOrg() {
  const org = mockMakeDoc({ _id: "org1", slug: "acme", name: "Acme" });
  mockState.orgs.push(org);
  return org;
}

/** Pull the plaintext code out of the last email the service "sent". */
function lastEmailedCode(): string {
  const calls = mockSendEmail.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const options = calls[calls.length - 1][1];
  const match = /(\d{6})/.exec(options.text || options.html || "");
  expect(match).not.toBeNull();
  return match![1];
}

/** Extract one cookie value from a mocked response's Set-Cookie list. */
function responseCookie(res: any, name: string): string | null {
  const entry = (res.__setCookies as string[]).find((c) =>
    c.startsWith(`${name}=`),
  );
  if (!entry) return null;
  return entry.slice(name.length + 1).split(";")[0];
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 10);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSendEmail.mockResolvedValue(true);
  mockState.users.length = 0;
  mockState.customers.length = 0;
  mockState.orgs.length = 0;
  mockCookieJar.clear();
});

// ---------------------------------------------------------------------------
// F-C9: missing secrets fail closed
// ---------------------------------------------------------------------------

describe("F-C9 — secrets fail closed", () => {
  it("staff auth issues and accepts nothing when JWT_SECRET is unset", async () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    jest.resetModules();
    try {
      const freshAuth = await import("@/lib/auth");

      await expect(
        freshAuth.createToken({
          userId: "user-1",
          email: "staff@example.com",
          roles: ["ADMIN"] as any,
          orgId: "org1",
        }),
      ).rejects.toThrow(/JWT_SECRET/);

      // A token signed with the former published fallback literal
      // must not verify either.
      const forged = await new SignJWT({
        userId: "attacker",
        email: "attacker@example.com",
        roles: ["ADMIN"],
        orgId: "org1",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(
          new TextEncoder().encode(
            "your-secret-key-change-in-production",
          ),
        );
      await expect(freshAuth.verifyToken(forged)).resolves.toBeNull();
    } finally {
      if (saved !== undefined) process.env.JWT_SECRET = saved;
      jest.resetModules();
    }
  });

  it("customer auth issues nothing when CUSTOMER_JWT_SECRET is unset", async () => {
    const saved = process.env.CUSTOMER_JWT_SECRET;
    delete process.env.CUSTOMER_JWT_SECRET;
    jest.resetModules();
    try {
      const freshCustomerAuth = await import("@/lib/customer-auth");
      await expect(
        freshCustomerAuth.createCustomerSession({
          customerId: "cust-1",
          orgId: "org1",
          email: "customer@example.com",
          emailVerified: true,
        }),
      ).rejects.toThrow(/CUSTOMER_JWT_SECRET/);
    } finally {
      if (saved !== undefined) process.env.CUSTOMER_JWT_SECRET = saved;
      jest.resetModules();
    }
  });

  it("PG SSO state is not signed with a fallback when JWT_SECRET is unset", async () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    jest.resetModules();
    try {
      const freshState = await import("@/lib/pg-sso/state");
      const payload = freshState.newPgSsoStatePayload({});
      expect(() => freshState.signPgSsoState(payload)).toThrow(
        /JWT_SECRET/,
      );

      // A state value HMAC'd with the former fallback literal must
      // not verify.
      const data = Buffer.from(JSON.stringify(payload)).toString(
        "base64url",
      );
      const sig = crypto
        .createHmac(
          "sha256",
          "your-secret-key-change-in-production",
        )
        .update(data)
        .digest("base64url");
      expect(freshState.verifyPgSsoState(`${data}.${sig}`)).toBeNull();
    } finally {
      if (saved !== undefined) process.env.JWT_SECRET = saved;
      jest.resetModules();
    }
  });

  it("control: with the env secret set, tokens issue and verify", async () => {
    const { createToken } = await import("@/lib/auth");
    const token = await createToken({
      userId: "user-1",
      email: "staff@example.com",
      roles: ["ADMIN"] as any,
      orgId: "org1",
      tv: 0,
    });
    const payload = await verifyToken(token);
    expect(payload?.userId).toBe("user-1");
  });
});

// ---------------------------------------------------------------------------
// F-H1: staff 2FA is bound to the password step
// ---------------------------------------------------------------------------

describe("F-H1 — staff 2FA binding", () => {
  async function loginWith2FA(email: string) {
    const res: any = await staffLoginPOST(
      fakeRequest({ email, password: PASSWORD }),
    );
    expect(res.__ok).toBe(true);
    expect(res.data.requires2FA).toBe(true);
    return res;
  }

  it("happy path: password → code → session, code stored hashed only", async () => {
    const user = seedStaffUser({ twoFactorEnabled: true });

    const loginRes = await loginWith2FA(user.email);
    const pendingCookie = responseCookie(loginRes, "pending_2fa");
    expect(pendingCookie).toBeTruthy();

    const sendRes: any = await staffSendCodePOST(
      fakeRequest(
        { email: user.email },
        { cookies: { pending_2fa: pendingCookie! } },
      ),
    );
    expect(sendRes.__ok).toBe(true);

    const code = lastEmailedCode();

    // (d) The stored value is the SHA-256 hash bound to the user id,
    // never the plaintext code.
    expect(user.twoFactorCode).not.toBe(code);
    expect(user.twoFactorCode).toBe(
      crypto
        .createHash("sha256")
        .update(`${user._id}:${code}`)
        .digest("hex"),
    );

    const verifyRes: any = await staffVerifyPOST(
      fakeRequest(
        { email: user.email, code },
        { cookies: { pending_2fa: pendingCookie! } },
      ),
    );
    expect(verifyRes.__ok).toBe(true);

    const sessionToken = responseCookie(verifyRes, "session");
    expect(sessionToken).toBeTruthy();

    // The minted session passes requireAuth revalidation.
    mockCookieJar.set("session", sessionToken!);
    const session = await requireAuth(
      fakeRequest(null, { cookies: { session: sessionToken! } }),
    );
    expect(session.userId).toBe("user-1");

    // The code was consumed: replaying it mints nothing.
    const replayRes: any = await staffVerifyPOST(
      fakeRequest(
        { email: user.email, code },
        { cookies: { pending_2fa: pendingCookie! } },
      ),
    );
    expect(replayRes.__ok).toBe(false);
    expect(responseCookie(replayRes, "session")).toBeNull();
  });

  it("(b) verify without the post-password pending state mints no session", async () => {
    const user = seedStaffUser({
      email: "nopending@example.com",
      twoFactorEnabled: true,
    });

    const loginRes = await loginWith2FA(user.email);
    const pendingCookie = responseCookie(loginRes, "pending_2fa");

    const sendRes: any = await staffSendCodePOST(
      fakeRequest(
        { email: user.email },
        pendingCookie
          ? { cookies: { pending_2fa: pendingCookie } }
          : {},
      ),
    );
    expect(sendRes.__ok).toBe(true);
    const code = lastEmailedCode();

    // The attacker path from F-H1: email + correct code, but no
    // password step ever happened in this browser.
    const verifyRes: any = await staffVerifyPOST(
      fakeRequest({ email: user.email, code }),
    );
    expect(verifyRes.__ok).toBe(false);
    expect(responseCookie(verifyRes, "session")).toBeNull();
    expect(mockCookieJar.has("session")).toBe(false);
  });

  it("send-code without the pending state issues no code", async () => {
    const user = seedStaffUser({
      email: "nocode@example.com",
      twoFactorEnabled: true,
    });

    const sendRes: any = await staffSendCodePOST(
      fakeRequest({ email: user.email }),
    );
    expect(sendRes.__ok).toBe(false);
    expect(sendRes.status).toBe(401);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(user.twoFactorCode).toBeUndefined();
  });

  it("(c) five wrong codes lock the flow and destroy the code", async () => {
    const user = seedStaffUser({
      email: "lockout@example.com",
      twoFactorEnabled: true,
    });

    const loginRes = await loginWith2FA(user.email);
    const pendingCookie = responseCookie(loginRes, "pending_2fa");
    await staffSendCodePOST(
      fakeRequest(
        { email: user.email },
        { cookies: { pending_2fa: pendingCookie! } },
      ),
    );
    const code = lastEmailedCode();
    const wrongCode = code === "000000" ? "111111" : "000000";

    let lastRes: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      lastRes = await staffVerifyPOST(
        fakeRequest(
          { email: user.email, code: wrongCode },
          { cookies: { pending_2fa: pendingCookie! } },
        ),
      );
      expect(lastRes.__ok).toBe(false);
    }
    expect(lastRes.message).toMatch(/too many/i);

    // The code and pending state are destroyed...
    expect(user.twoFactorCode).toBeUndefined();
    expect(user.twoFactorPendingId).toBeUndefined();

    // ...so even the correct code can no longer mint a session.
    const verifyRes: any = await staffVerifyPOST(
      fakeRequest(
        { email: user.email, code },
        { cookies: { pending_2fa: pendingCookie! } },
      ),
    );
    expect(verifyRes.__ok).toBe(false);
    expect(responseCookie(verifyRes, "session")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-M6: credential endpoints are rate limited
// ---------------------------------------------------------------------------

describe("F-M6 — login rate limiting", () => {
  it("(e) repeated failed logins trip a 429", async () => {
    seedStaffUser({ email: "ratelimit@example.com" });

    for (let attempt = 0; attempt < 10; attempt++) {
      const res: any = await staffLoginPOST(
        fakeRequest({
          email: "ratelimit@example.com",
          password: "wrong-password",
        }),
      );
      expect(res.status).toBe(401);
    }

    const tripped: any = await staffLoginPOST(
      fakeRequest({
        email: "ratelimit@example.com",
        password: "wrong-password",
      }),
    );
    expect(tripped.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// F-M1: sessions are revalidated against the user record
// ---------------------------------------------------------------------------

describe("F-M1 — token version revalidation", () => {
  it("(f) a password reset revokes outstanding sessions; a fresh login works", async () => {
    const user = seedStaffUser({ email: "reset@example.com" });

    const loginRes: any = await staffLoginPOST(
      fakeRequest({ email: user.email, password: PASSWORD }),
    );
    expect(loginRes.__ok).toBe(true);
    const oldToken = responseCookie(loginRes, "session");
    expect(oldToken).toBeTruthy();

    mockCookieJar.set("session", oldToken!);
    await expect(
      requireAuth(fakeRequest(null, { cookies: { session: oldToken! } })),
    ).resolves.toMatchObject({ userId: "user-1" });

    // Reset the password through the real route.
    const rawToken = "raw-reset-token-for-test";
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    const resetRes: any = await staffResetPasswordPOST(
      fakeRequest({ token: rawToken, password: "brand-new-password-1" }),
    );
    expect(resetRes.__ok).toBe(true);
    expect(user.tokenVersion).toBe(1);

    // The pre-reset token is now revoked.
    await expect(
      requireAuth(fakeRequest(null, { cookies: { session: oldToken! } })),
    ).rejects.toMatchObject({ status: 401 });

    // A fresh login with the new password mints a working session.
    const reloginRes: any = await staffLoginPOST(
      fakeRequest({
        email: user.email,
        password: "brand-new-password-1",
      }),
    );
    expect(reloginRes.__ok).toBe(true);
    const newToken = responseCookie(reloginRes, "session");
    expect(newToken).toBeTruthy();
    mockCookieJar.set("session", newToken!);
    await expect(
      requireAuth(fakeRequest(null, { cookies: { session: newToken! } })),
    ).resolves.toMatchObject({ userId: "user-1" });
  });

  it("deactivation kills an outstanding session immediately", async () => {
    const user = seedStaffUser({ email: "deactivated@example.com" });

    const loginRes: any = await staffLoginPOST(
      fakeRequest({ email: user.email, password: PASSWORD }),
    );
    const token = responseCookie(loginRes, "session");
    mockCookieJar.set("session", token!);
    await expect(
      requireAuth(fakeRequest(null, { cookies: { session: token! } })),
    ).resolves.toMatchObject({ userId: "user-1" });

    user.isActive = false;

    await expect(
      requireAuth(fakeRequest(null, { cookies: { session: token! } })),
    ).rejects.toMatchObject({ status: 401 });
  });
});

// ---------------------------------------------------------------------------
// F-H1: customer 2FA twin
// ---------------------------------------------------------------------------

describe("F-H1 — customer 2FA binding", () => {
  it("happy path works, and verify without the pending state mints nothing", async () => {
    seedOrg();
    const customer = seedCustomer({ twoFactorEnabled: true });

    const loginRes: any = await customerLoginPOST(
      fakeRequest({
        email: customer.email,
        password: PASSWORD,
        orgSlug: "acme",
      }),
    );
    expect(loginRes.__ok).toBe(true);
    expect(loginRes.data.requires2FA).toBe(true);
    const pendingCookie = responseCookie(
      loginRes,
      "customer_pending_2fa",
    );
    expect(pendingCookie).toBeTruthy();

    const sendRes: any = await customerSendCodePOST(
      fakeRequest(
        { email: customer.email, orgSlug: "acme" },
        { cookies: { customer_pending_2fa: pendingCookie! } },
      ),
    );
    expect(sendRes.__ok).toBe(true);

    const code = lastEmailedCode();
    // Stored hashed, never plaintext.
    expect(customer.twoFactorCode).not.toBe(code);
    expect(customer.twoFactorCode).toBe(
      crypto
        .createHash("sha256")
        .update(`${customer._id}:${code}`)
        .digest("hex"),
    );

    // Without the pending state: no session.
    const unboundRes: any = await customerVerifyCodePOST(
      fakeRequest({
        email: customer.email,
        orgSlug: "acme",
        code,
      }),
    );
    expect(unboundRes.__error).toBe(true);
    expect(mockCookieJar.has("customer-session")).toBe(false);

    // With it: session, and it passes customer revalidation.
    const verifyRes: any = await customerVerifyCodePOST(
      fakeRequest(
        { email: customer.email, orgSlug: "acme", code },
        { cookies: { customer_pending_2fa: pendingCookie! } },
      ),
    );
    expect(verifyRes.__ok).toBe(true);
    expect(mockCookieJar.has("customer-session")).toBe(true);

    await expect(
      requireCustomerAuth(fakeRequest(null)),
    ).resolves.toMatchObject({ customerId: "cust-1" });
  });
});

// ---------------------------------------------------------------------------
// F-H2 / F-L4: debug and sentry example routes are deleted
// ---------------------------------------------------------------------------

describe("F-H2/F-L4 — debug routes deleted", () => {
  it("the unauthenticated debug routes and sentry example route do not exist", () => {
    const root = process.cwd();
    for (const rel of [
      "src/app/api/v1/debug/org-check/route.ts",
      "src/app/api/v1/debug/test-lookup/route.ts",
      "src/app/api/sentry-example-api/route.ts",
    ]) {
      expect(fs.existsSync(path.join(root, rel))).toBe(false);
    }
  });
});
