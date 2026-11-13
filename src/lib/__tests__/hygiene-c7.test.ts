/**
 * Cluster 7 pins — hygiene (F-H11 covered by git evidence; F-M5, F-M8, F-M14).
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
const mockSendEmail = jest.fn().mockResolvedValue(undefined);
const mockSendTeamInvitationEmail = jest.fn().mockResolvedValue(undefined);

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
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@/lib/services/email.service", () => ({
  EmailService: {
    sendEmail: (...args: any[]) => mockSendEmail(...args),
    sendTeamInvitationEmail: (...args: any[]) =>
      mockSendTeamInvitationEmail(...args),
  },
}));

const mockUserFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockUserCreate = jest.fn();
const mockUserOrgFindOne = jest.fn();
const mockUserOrgCreate = jest.fn();
const mockOrgFindById = jest.fn();

jest.mock("@topupsend/db", () => ({
  Integration: { findOne: jest.fn() },
  User: {
    findOne: (...args: any[]) => mockUserFindOne(...args),
    findById: (...args: any[]) => mockUserFindById(...args),
    create: (...args: any[]) => mockUserCreate(...args),
  },
  UserOrganization: {
    findOne: (...args: any[]) => mockUserOrgFindOne(...args),
    create: (...args: any[]) => mockUserOrgCreate(...args),
  },
  Org: {
    findById: (...args: any[]) => mockOrgFindById(...args),
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

jest.mock("bcryptjs", () => ({
  hash: jest.fn(async (pw: string) => `hashed:${pw}`),
}));

// Minimal mongoose stub so the real Discount model file can load (its
// generateCode static is under test) without pulling in the DB driver.
jest.mock("mongoose", () => {
  class FakeSchema {
    methods: Record<string, unknown> = {};
    statics: Record<string, unknown> = {};
    index() {
      return this;
    }
    pre() {
      return this;
    }
  }
  const model = (_name: string, schema: any) => ({ ...schema.statics });
  return {
    __esModule: true,
    default: { Schema: FakeSchema, models: {}, model },
    Schema: FakeSchema,
    models: {},
    model,
  };
});

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import bcrypt from "bcryptjs";
import { escapeHtml } from "@/lib/escape-html";
import { generateTemporaryPassword } from "@/lib/temp-password";
import {
  DingConnectService,
  resolveDingConnectBaseUrl,
} from "@/lib/services/dingconnect.service";
import { POST as testEmailPOST } from "../../app/api/v1/test-email/route";
import { POST as invitePOST } from "../../app/api/v1/organizations/invite/route";
import { Discount } from "../../../packages/db/src/models/Discount";

function fakeRequest(body: unknown = {}) {
  return {
    url: "http://localhost/api/v1/test",
    json: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// F-M14: escapeHtml helper
// ---------------------------------------------------------------------------

describe("escapeHtml (F-M14)", () => {
  it("pin: escapes markup, quotes and ampersands", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("Fish & Chips 'special'")).toBe(
      "Fish &amp; Chips &#39;special&#39;",
    );
  });

  it("control: leaves plain text untouched", () => {
    expect(escapeHtml("Acme TopUps LLC")).toBe("Acme TopUps LLC");
  });
});

// ---------------------------------------------------------------------------
// F-M5 + F-M14: test-email permission gate and message escaping
// ---------------------------------------------------------------------------

describe("POST /api/v1/test-email (F-M5, F-M14)", () => {
  const payload = {
    to: "someone@example.com",
    subject: "Hi",
    message: '<script>alert("pwned")</script>',
  };

  it("pin: a VIEWER is refused with 403 and nothing is sent", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "u-viewer",
      orgId: "orgA",
      roles: [UserRole.VIEWER],
    });

    const res: any = await testEmailPOST(fakeRequest(payload));

    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("pin: an OPERATOR (view-only integrations) is also refused", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "u-operator",
      orgId: "orgA",
      roles: [UserRole.OPERATOR],
    });

    const res: any = await testEmailPOST(fakeRequest(payload));

    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("pin: the message is HTML-escaped in the html body (raw in text)", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "u-admin",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });

    const res: any = await testEmailPOST(fakeRequest(payload));

    expect(res.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [, options] = mockSendEmail.mock.calls[0];
    expect(options.html).not.toContain('<script>alert("pwned")</script>');
    expect(options.html).toContain(
      "&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;",
    );
    expect(options.text).toContain('<script>alert("pwned")</script>');
  });
});

// ---------------------------------------------------------------------------
// F-M8: DingConnect baseUrl allowlist
// ---------------------------------------------------------------------------

describe("DingConnect baseUrl allowlist (F-M8)", () => {
  it("control: unset/blank baseUrl resolves to the real DingConnect host", () => {
    expect(resolveDingConnectBaseUrl(undefined)).toBe(
      "https://api.dingconnect.com",
    );
    expect(resolveDingConnectBaseUrl("")).toBe("https://api.dingconnect.com");
    expect(resolveDingConnectBaseUrl("https://api.dingconnect.com")).toBe(
      "https://api.dingconnect.com",
    );
    expect(resolveDingConnectBaseUrl("https://api.dingconnect.com/")).toBe(
      "https://api.dingconnect.com",
    );
  });

  it.each([
    "http://api.dingconnect.com", // not https
    "https://evil.example.com", // arbitrary host would receive the API key
    "https://api.dingconnect.com.evil.example.com", // look-alike suffix host
    "https://api.dingconnect.com@evil.example.com", // userinfo trick
    "https://127.0.0.1:8080", // loopback / SSRF
    "https://169.254.169.254", // cloud metadata / SSRF
    "not a url",
  ])("pin: rejects %s", (bad) => {
    expect(() => resolveDingConnectBaseUrl(bad)).toThrow(
      /Invalid DingConnect base URL/,
    );
    expect(
      () => new DingConnectService({ apiKey: "secret", baseUrl: bad }),
    ).toThrow(/Invalid DingConnect base URL/);
  });

  it("control: the constructor accepts the allowlisted host", () => {
    expect(
      () =>
        new DingConnectService({
          apiKey: "secret",
          baseUrl: "https://api.dingconnect.com",
        }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F-M5: CSPRNG temporary passwords + discount codes
// ---------------------------------------------------------------------------

describe("generateTemporaryPassword (F-M5)", () => {
  it("pin: 16 alphanumeric characters, unique across calls", () => {
    const samples = new Set(
      Array.from({ length: 50 }, () => generateTemporaryPassword()),
    );
    expect(samples.size).toBe(50);
    for (const pw of samples) {
      expect(pw).toMatch(/^[A-Za-z0-9]{16}$/);
    }
  });

  it("pin: does not use Math.random", () => {
    const spy = jest.spyOn(Math, "random");
    try {
      generateTemporaryPassword();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("control: honors a custom length", () => {
    expect(generateTemporaryPassword(24)).toMatch(/^[A-Za-z0-9]{24}$/);
  });
});

describe("org invite temporary password (F-M5)", () => {
  it("pin: the invited user's password is a 16-char CSPRNG password", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "admin-1",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
    });
    mockUserOrgFindOne.mockResolvedValue({
      userId: "admin-1",
      orgId: "orgA",
      roles: [UserRole.ADMIN],
      isActive: true,
    });
    mockOrgFindById.mockResolvedValue({ _id: "orgA", name: "Acme" });
    mockUserFindById.mockResolvedValue({ _id: "admin-1", email: "a@x.com" });
    mockUserFindOne.mockResolvedValue(null); // brand-new user path
    mockUserCreate.mockImplementation(async (data: any) => ({
      _id: "new-user",
      ...data,
    }));
    mockUserOrgCreate.mockResolvedValue({ roles: [UserRole.VIEWER] });

    const randomSpy = jest.spyOn(Math, "random");
    try {
      const res: any = await invitePOST(
        fakeRequest({ email: "new@example.com", roles: [UserRole.VIEWER] }),
      );

      expect(res.__ok).toBe(true);
      // bcrypt.hash received the generated temporary password
      const hashMock = bcrypt.hash as unknown as jest.Mock;
      expect(hashMock).toHaveBeenCalledTimes(1);
      const tempPassword = hashMock.mock.calls[0][0] as string;
      expect(tempPassword).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(randomSpy).not.toHaveBeenCalled();
      // ... and that password is what was emailed to the invitee
      expect(mockSendTeamInvitationEmail).toHaveBeenCalledWith(
        "orgA",
        "new@example.com",
        expect.any(String),
        "Acme",
        tempPassword,
      );
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe("Discount.generateCode (F-M5)", () => {
  it("pin: codes come from a CSPRNG, not Math.random", () => {
    const generateCode = (Discount as any).generateCode as (
      length?: number,
    ) => string;
    const spy = jest.spyOn(Math, "random");
    try {
      const code = generateCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
