/**
 * @jest-environment node
 *
 * Regression suite for the customer-portal login defect: a password
 * SET for a customer by staff in the dashboard must work at portal
 * login immediately.
 *
 * TopUpSend customers are phone-first: the staff create route
 * requires only a phone number (email is optional) and fulfillment
 * auto-creates customer records keyed by phone. The portal login,
 * however, only accepted an EMAIL identifier, so a staff-set
 * password on a phone-only customer record could never be used to
 * log in — the dashboard reported success and the customer was
 * locked out. The login now accepts email OR phone within the org.
 *
 * A staff-set password must also take effect immediately: the set
 * bumps the customer's tokenVersion (the same revocation the
 * self-service change and reset routes already perform), so any
 * previously issued portal session stops working.
 *
 * These tests exercise the REAL route handlers (staff PUT
 * /api/v1/customers/[id], portal POST /api/v1/customer-auth/login)
 * against the REAL models on an in-memory MongoDB. Only
 * next/headers and next/server are faked. Note: jest needs
 * --forceExit with this suite because the login route transitively
 * loads the rate-limit service, which starts a module-level
 * cleanup interval.
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

import { Customer, Org, User, dbConnection } from "@topupsend/db";
import { UserRole } from "@topupsend/types";
import { createToken } from "@/lib/auth";
import {
  createCustomerSession,
  getRevalidatedCustomerSession,
} from "@/lib/customer-auth";
import { PUT as customerUpdatePUT } from "../../app/api/v1/customers/[id]/route";
import { POST as customerLoginPOST } from "../../app/api/v1/customer-auth/login/route";

jest.setTimeout(120000);

let mongod: MongoMemoryServer;
let org: any;
let otherOrg: any;
let staff: any;

function fakeRequest(body: Record<string, unknown>): any {
  return {
    cookies: {
      get: (name: string) => {
        const value = mockCookieJar.get(name);
        return value ? { name, value } : undefined;
      },
    },
    headers: { get: () => null },
    json: async () => body,
  };
}

async function staffSetPassword(customerId: string, password: string) {
  const res: any = await customerUpdatePUT(fakeRequest({ password }), {
    params: Promise.resolve({ id: customerId }),
  });
  return res;
}

async function portalLogin(body: Record<string, unknown>) {
  const res: any = await customerLoginPOST(fakeRequest(body));
  return res;
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
  await Customer.deleteMany({});
  await Org.deleteMany({});
  await User.deleteMany({});

  org = await Org.create({
    name: "Portal Org",
    slug: "portal-org",
    email: "org@portal.test",
    settings: {},
    paymentProviders: [],
  });
  otherOrg = await Org.create({
    name: "Other Org",
    slug: "other-org",
    email: "org@other.test",
    settings: {},
    paymentProviders: [],
  });
  staff = await User.create({
    email: "owner@portal.test",
    passwordHash: "irrelevant",
    roles: [UserRole.ADMIN],
    orgId: org._id,
    isActive: true,
    tokenVersion: 0,
  });
  const token = await createToken({
    userId: String(staff._id),
    email: staff.email,
    roles: [UserRole.ADMIN],
    orgId: String(org._id),
    tv: 0,
  } as any);
  mockCookieJar.set("session", token);
});

test("staff sets a password on an email customer; the customer logs in with that email + password", async () => {
  const customer = await Customer.create({
    orgId: String(org._id),
    phoneNumber: "+15095550101",
    email: "portaluser@example.com",
    name: "Portal User",
  });

  const putRes = await staffSetPassword(String(customer._id), "StaffSet123");
  expect(putRes.status).toBe(200);

  const loginRes = await portalLogin({
    email: "portaluser@example.com",
    password: "StaffSet123",
    orgSlug: "portal-org",
  });
  expect(loginRes.status).toBe(200);
  expect(loginRes.__body.customer.email).toBe("portaluser@example.com");
});

test("staff sets a password on a PHONE-ONLY customer; the customer logs in with phone + password", async () => {
  // The staff create route requires only a phone number; fulfillment
  // auto-creates customers the same way. No email on the record.
  const customer = await Customer.create({
    orgId: String(org._id),
    phoneNumber: "+15095550102",
    name: "Phone Only",
  });

  const putRes = await staffSetPassword(String(customer._id), "StaffSet123");
  expect(putRes.status).toBe(200);

  const loginRes = await portalLogin({
    identifier: "+15095550102",
    password: "StaffSet123",
    orgSlug: "portal-org",
  });
  expect(loginRes.status).toBe(200);
  expect(loginRes.__body.customer.id).toBe(String(customer._id));
});

test("phone login matches common number formats (spaces / no leading +)", async () => {
  const customer = await Customer.create({
    orgId: String(org._id),
    phoneNumber: "+15095550103",
    name: "Formats",
  });
  await staffSetPassword(String(customer._id), "StaffSet123");

  for (const identifier of ["15095550103", "+1 509 555 0103"]) {
    const loginRes = await portalLogin({
      identifier,
      password: "StaffSet123",
      orgSlug: "portal-org",
    });
    expect(loginRes.status).toBe(200);
  }
});

test("phone login is org-scoped: the same phone in another org does not authenticate", async () => {
  const mine = await Customer.create({
    orgId: String(org._id),
    phoneNumber: "+15095550104",
    name: "Mine",
  });
  await Customer.create({
    orgId: String(otherOrg._id),
    phoneNumber: "+15095550104",
    name: "Theirs",
  });
  await staffSetPassword(String(mine._id), "StaffSet123");

  const wrongOrg = await portalLogin({
    identifier: "+15095550104",
    password: "StaffSet123",
    orgSlug: "other-org",
  });
  expect(wrongOrg.status).toBe(401);

  const rightOrg = await portalLogin({
    identifier: "+15095550104",
    password: "StaffSet123",
    orgSlug: "portal-org",
  });
  expect(rightOrg.status).toBe(200);
});

test("a staff-set password revokes portal sessions issued before the set", async () => {
  const customer = await Customer.create({
    orgId: String(org._id),
    phoneNumber: "+15095550105",
    email: "revoke@example.com",
    name: "Revoke Me",
    passwordHash: "InitialPass1", // hashed by the pre-save hook
  });

  // A portal session issued before the staff set.
  await createCustomerSession({
    customerId: String(customer._id),
    orgId: String(org._id),
    email: "revoke@example.com",
    emailVerified: false,
    name: "Revoke Me",
    tv: customer.tokenVersion ?? 0,
  });
  expect(await getRevalidatedCustomerSession()).not.toBeNull();

  const putRes = await staffSetPassword(String(customer._id), "StaffSet123");
  expect(putRes.status).toBe(200);

  // The pre-set session must no longer revalidate...
  expect(await getRevalidatedCustomerSession()).toBeNull();

  // ...while the new password logs in immediately.
  const loginRes = await portalLogin({
    email: "revoke@example.com",
    password: "StaffSet123",
    orgSlug: "portal-org",
  });
  expect(loginRes.status).toBe(200);
});

test("wrong password is still rejected after a staff set", async () => {
  const customer = await Customer.create({
    orgId: String(org._id),
    phoneNumber: "+15095550106",
    email: "wrongpass@example.com",
    name: "Wrong Pass",
  });
  await staffSetPassword(String(customer._id), "StaffSet123");

  const loginRes = await portalLogin({
    email: "wrongpass@example.com",
    password: "NotThePassword",
    orgSlug: "portal-org",
  });
  expect(loginRes.status).toBe(401);
});
