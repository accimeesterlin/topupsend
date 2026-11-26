/**
 * @jest-environment node
 *
 * Route-level tests for the organization business logo:
 * validation at the settings API, permission gating, and —
 * critically — tenancy: the public portal branding endpoint
 * resolves the org by slug (the same way portal login does), so
 * one org's logo can never surface on another org's portal, and an
 * org with no logo falls back to the default branding (logo null).
 *
 * Real handlers + real models on in-memory MongoDB; only
 * next/headers and next/server are faked (same harness as the
 * customer-portal password suite). Run jest with --forceExit:
 * imported services start a module-level cleanup interval.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockCookieJar = new Map<string, string>();

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

jest.mock("next/server", () => {
  class NextResponse {
    status: number;
    __body: any;
    headers = {
      append: jest.fn(),
      set: jest.fn(),
      get: jest.fn(() => null),
    };
    cookies = { set: jest.fn(), get: jest.fn(), delete: jest.fn() };
    constructor(body?: any, init?: { status?: number }) {
      this.__body = body ?? null;
      this.status = init?.status ?? 200;
    }
    static json(body: any, init?: { status?: number }) {
      return new NextResponse(body, init);
    }
    async json() {
      return this.__body;
    }
  }
  return { NextResponse, NextRequest: class {} };
});

import { Org, User, dbConnection } from "@topupsend/db";
import { UserRole } from "@topupsend/types";
import { createToken } from "@/lib/auth";
import {
  GET as organizationGET,
  PUT as organizationPUT,
} from "../../app/api/v1/organization/route";
import { GET as brandingGET } from "../../app/api/v1/customer-portal/branding/route";

jest.setTimeout(120000);

let mongod: MongoMemoryServer;
let orgA: any;
let orgB: any;

const LOGO_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function jsonRequest(body: Record<string, unknown>): any {
  return {
    cookies: {
      get: (name: string) => {
        const value = mockCookieJar.get(name);
        return value ? { name, value } : undefined;
      },
    },
    headers: { get: () => null },
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
  };
}

function brandingRequest(orgSlug: string): any {
  return {
    cookies: { get: () => undefined },
    headers: { get: () => null },
    nextUrl: {
      searchParams: new URLSearchParams({ orgSlug }),
    },
  };
}

async function signInAs(user: any, orgId: string, roles: UserRole[]) {
  const token = await createToken({
    userId: String(user._id),
    email: user.email,
    roles,
    orgId,
    tv: 0,
  } as any);
  mockCookieJar.set("session", token);
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = "test-staff-secret";
  process.env.CUSTOMER_JWT_SECRET = "test-customer-secret";
  await dbConnection.connect();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  mockCookieJar.clear();
  await Org.deleteMany({});
  await User.deleteMany({});

  orgA = await Org.create({
    name: "Org A",
    slug: "org-a",
    email: "a@orgs.test",
    settings: {},
    paymentProviders: [],
  });
  orgB = await Org.create({
    name: "Org B",
    slug: "org-b",
    email: "b@orgs.test",
    settings: {},
    paymentProviders: [],
  });

  const adminA = await User.create({
    email: "admin-a@orgs.test",
    passwordHash: "irrelevant",
    roles: [UserRole.ADMIN],
    orgId: orgA._id,
    isActive: true,
    tokenVersion: 0,
  });
  await signInAs(adminA, String(orgA._id), [UserRole.ADMIN]);
});

test("an org admin sets a logo; the portal branding for that org's slug serves it", async () => {
  const putRes: any = await organizationPUT(jsonRequest({ logo: LOGO_A }));
  expect(putRes.status).toBe(200);
  expect(putRes.__body.organization.logo).toBe(LOGO_A);

  const brandingRes: any = await brandingGET(brandingRequest("org-a"));
  expect(brandingRes.status).toBe(200);
  expect(brandingRes.__body).toEqual({
    name: "Org A",
    slug: "org-a",
    logo: LOGO_A,
  });
});

test("tenancy: another org's portal never serves org A's logo (fallback is null)", async () => {
  await organizationPUT(jsonRequest({ logo: LOGO_A }));

  const brandingB: any = await brandingGET(brandingRequest("org-b"));
  expect(brandingB.status).toBe(200);
  expect(brandingB.__body.name).toBe("Org B");
  expect(brandingB.__body.logo).toBeNull();
});

test("an https logo URL is accepted and served", async () => {
  const putRes: any = await organizationPUT(
    jsonRequest({ logo: "https://cdn.example.com/a-logo.png" }),
  );
  expect(putRes.status).toBe(200);

  const brandingRes: any = await brandingGET(brandingRequest("org-a"));
  expect(brandingRes.__body.logo).toBe("https://cdn.example.com/a-logo.png");
});

test("invalid logos are rejected with a clear 400 and nothing is stored", async () => {
  for (const bad of [
    "http://example.com/logo.png",
    "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    "not-a-url",
  ]) {
    const putRes: any = await organizationPUT(jsonRequest({ logo: bad }));
    expect(putRes.status).toBe(400);
    expect(typeof putRes.__body.error).toBe("string");
    expect(putRes.__body.error.length).toBeGreaterThan(0);
  }

  const brandingRes: any = await brandingGET(brandingRequest("org-a"));
  expect(brandingRes.__body.logo).toBeNull();
});

test("an oversized uploaded logo is rejected", async () => {
  const big = `data:image/png;base64,${"A".repeat(Math.ceil((210 * 1024) / 3) * 4)}`;
  const putRes: any = await organizationPUT(jsonRequest({ logo: big }));
  expect(putRes.status).toBe(400);
  expect(putRes.__body.error).toMatch(/too large/i);
});

test("removing the logo restores the default branding", async () => {
  await organizationPUT(jsonRequest({ logo: LOGO_A }));
  const removeRes: any = await organizationPUT(jsonRequest({ logo: null }));
  expect(removeRes.status).toBe(200);
  expect(removeRes.__body.organization.logo).toBeNull();

  const brandingRes: any = await brandingGET(brandingRequest("org-a"));
  expect(brandingRes.__body.logo).toBeNull();
});

test("the dashboard organization payload carries the session org's own logo only", async () => {
  await organizationPUT(jsonRequest({ logo: LOGO_A }));

  const getRes: any = await organizationGET(jsonRequest({}));
  expect(getRes.status).toBe(200);
  expect(getRes.__body.logo).toBe(LOGO_A);
  expect(String(getRes.__body.id)).toBe(String(orgA._id));
});

test("a staff member without EDIT_ORG_SETTINGS cannot set a logo", async () => {
  const viewer = await User.create({
    email: "viewer-a@orgs.test",
    passwordHash: "irrelevant",
    roles: [UserRole.VIEWER],
    orgId: orgA._id,
    isActive: true,
    tokenVersion: 0,
  });
  await signInAs(viewer, String(orgA._id), [UserRole.VIEWER]);

  const putRes: any = await organizationPUT(jsonRequest({ logo: LOGO_A }));
  expect(putRes.status).toBe(403);

  const brandingRes: any = await brandingGET(brandingRequest("org-a"));
  expect(brandingRes.__body.logo).toBeNull();
});

test("branding for an unknown slug is a 404, never another org's branding", async () => {
  await organizationPUT(jsonRequest({ logo: LOGO_A }));
  const res: any = await brandingGET(brandingRequest("no-such-org"));
  expect(res.status).toBe(404);
});
