/**
 * @jest-environment node
 *
 * Developer apps pins (seller dashboard self-serve apps + API keys):
 * - Apps CRUD is org-isolated: another org's app id reads as 404 and
 *   never leaks existence; org always comes from the session.
 * - Only org admins (CREATE_API_KEYS / MANAGE_API_KEYS) may create
 *   apps/keys or deactivate apps; operators cannot.
 * - Caps: 10 active apps per org, 5 active keys per app.
 * - Key creation validates scopes against the self-serve set,
 *   returns the plaintext secret exactly once, and stores only its
 *   SHA-256 hash (ApiKey.generateKey semantics).
 * - Deleting an app deactivates it AND revokes its keys.
 * - Response-shape contract: the routes return { apps } / { app } /
 *   { keys } / { key, apiKey } at the top level — NOT wrapped in a
 *   `data` envelope (the old settings page's data.data[] expectation
 *   was the drift that made it a dead end). The dashboard pages in
 *   src/app/dashboard/developers consume exactly these shapes.
 */
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { UserRole } from "@topupsend/types";

// ---------------------------------------------------------------------------
// In-memory model stores (mock-prefixed for jest.mock factories)
// ---------------------------------------------------------------------------

const mockApps: any[] = [];
const mockKeys: any[] = [];
let mockIdSeq = 0;
const mockNextId = () => `id-${++mockIdSeq}`;

function mockMatches(doc: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([field, cond]) => {
    if (cond && typeof cond === "object" && "$in" in cond) {
      return (cond as any).$in.includes(doc[field]);
    }
    return doc[field] === cond;
  });
}

const mockRequireAuth = jest.fn();

jest.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  requireCustomerAuth: jest.fn(),
}));

jest.mock("@topupsend/db", () => {
  const crypto = jest.requireActual("crypto");
  return {
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
    App: {
      create: jest.fn(async (data: any) => {
        const doc = {
          _id: mockNextId(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          save: jest.fn(async function (this: any) {
            return this;
          }),
        };
        mockApps.push(doc);
        return doc;
      }),
      find: jest.fn((filter: any) => ({
        sort: () =>
          Promise.resolve(mockApps.filter((a) => mockMatches(a, filter))),
      })),
      findById: jest.fn(
        async (id: string) => mockApps.find((a) => a._id === id) ?? null,
      ),
      countDocuments: jest.fn(async (filter: any) =>
        mockApps.filter((a) => mockMatches(a, filter)).length,
      ),
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
          _id: mockNextId(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          getRateLimit() {
            return this.customRateLimit ?? this.rateLimit;
          },
          save: jest.fn(async function (this: any) {
            return this;
          }),
        };
        mockKeys.push(doc);
        return doc;
      }),
      find: jest.fn((filter: any) => ({
        sort: () =>
          Promise.resolve(mockKeys.filter((k) => mockMatches(k, filter))),
      })),
      findById: jest.fn(
        async (id: string) => mockKeys.find((k) => k._id === id) ?? null,
      ),
      countDocuments: jest.fn(async (filter: any) =>
        mockKeys.filter((k) => mockMatches(k, filter)).length,
      ),
      aggregate: jest.fn(async (pipeline: any[]) => {
        const match = pipeline[0].$match;
        const groups = new Map<string, number>();
        for (const key of mockKeys.filter((k) => mockMatches(k, match))) {
          groups.set(key.appId, (groups.get(key.appId) ?? 0) + 1);
        }
        return [...groups.entries()].map(([_id, count]) => ({ _id, count }));
      }),
      updateMany: jest.fn(async (filter: any, update: any) => {
        let modified = 0;
        for (const key of mockKeys.filter((k) => mockMatches(k, filter))) {
          Object.assign(key, update.$set);
          modified++;
        }
        return { modifiedCount: modified };
      }),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { GET as appsGET, POST as appsPOST } from "../../app/api/v1/apps/route";
import {
  GET as appGET,
  PATCH as appPATCH,
  DELETE as appDELETE,
} from "../../app/api/v1/apps/[id]/route";
import {
  GET as keysGET,
  POST as keysPOST,
} from "../../app/api/v1/apps/[id]/keys/route";
import { DELETE as keyDELETE } from "../../app/api/v1/api-keys/[id]/route";

const ADMIN = { userId: "admin-1", orgId: "org-1", roles: [UserRole.ADMIN] };
const ADMIN_ORG2 = { userId: "admin-2", orgId: "org-2", roles: [UserRole.ADMIN] };
const OPERATOR = {
  userId: "op-1",
  orgId: "org-1",
  roles: [UserRole.OPERATOR],
};

function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function get(url: string) {
  return new NextRequest(url, { method: "GET" });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockApps.length = 0;
  mockKeys.length = 0;
  jest.clearAllMocks();
  mockRequireAuth.mockResolvedValue(ADMIN);
});

async function createApp(name = "PGecom integration") {
  const res = await appsPOST(post("http://localhost/api/v1/apps", { name }));
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.app as { id: string; name: string };
}

// ---------------------------------------------------------------------------
// Apps CRUD + org isolation
// ---------------------------------------------------------------------------

describe("developer apps — CRUD and org isolation", () => {
  it("creates an app bound to the session org (never the body)", async () => {
    const res = await appsPOST(
      post("http://localhost/api/v1/apps", {
        name: "My app",
        orgId: "org-attacker",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.app.name).toBe("My app");
    expect(mockApps).toHaveLength(1);
    expect(mockApps[0].orgId).toBe("org-1");
    expect(mockApps[0].createdBy).toBe("admin-1");
  });

  it("lists only the session org's apps, with active key counts", async () => {
    const mine = await createApp("Mine");
    await appsPOST(post("http://localhost/api/v1/apps", { name: "Second" }));
    mockRequireAuth.mockResolvedValue(ADMIN_ORG2);
    await appsPOST(post("http://localhost/api/v1/apps", { name: "Theirs" }));

    mockRequireAuth.mockResolvedValue(ADMIN);
    const res = await appsGET(get("http://localhost/api/v1/apps"));
    const body = await res.json();
    expect(body.apps).toHaveLength(2);
    expect(body.apps.map((a: any) => a.name).sort()).toEqual([
      "Mine",
      "Second",
    ]);
    const listed = body.apps.find((a: any) => a.id === mine.id);
    expect(listed.activeKeyCount).toBe(0);
  });

  it("returns 404 for another org's app id (no existence leak)", async () => {
    const app = await createApp();
    mockRequireAuth.mockResolvedValue(ADMIN_ORG2);
    const res = await appGET(
      get(`http://localhost/api/v1/apps/${app.id}`),
      params(app.id),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH renames within the org; cross-org PATCH is 404", async () => {
    const app = await createApp();
    const ok = await appPATCH(
      new NextRequest(`http://localhost/api/v1/apps/${app.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      params(app.id),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).app.name).toBe("Renamed");

    mockRequireAuth.mockResolvedValue(ADMIN_ORG2);
    const denied = await appPATCH(
      new NextRequest(`http://localhost/api/v1/apps/${app.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hijacked" }),
      }),
      params(app.id),
    );
    expect(denied.status).toBe(404);
    expect(mockApps[0].name).toBe("Renamed");
  });

  it("operators cannot create apps (403)", async () => {
    mockRequireAuth.mockResolvedValue(OPERATOR);
    const res = await appsPOST(
      post("http://localhost/api/v1/apps", { name: "Nope" }),
    );
    expect(res.status).toBe(403);
    expect(mockApps).toHaveLength(0);
  });

  it("enforces the 10 active apps per org cap", async () => {
    for (let i = 0; i < 10; i++) {
      await createApp(`App ${i}`);
    }
    const res = await appsPOST(
      post("http://localhost/api/v1/apps", { name: "One too many" }),
    );
    expect(res.status).toBe(400);
    expect(mockApps.filter((a) => a.isActive)).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// App keys
// ---------------------------------------------------------------------------

describe("developer apps — keys", () => {
  it("creates a key: secret once, only the SHA-256 hash stored", async () => {
    const app = await createApp();
    const res = await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "Production",
        scopes: ["topup:send", "transactions:read"],
      }),
      params(app.id),
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.key).toMatch(/^sk_live_[0-9a-f]{64}$/);
    expect(body.apiKey.keyPrefix).toBe(body.key.substring(0, 12));
    expect(body.apiKey.appId).toBe(app.id);

    expect(mockKeys).toHaveLength(1);
    const stored = mockKeys[0];
    expect(stored.key).toBe(
      createHash("sha256").update(body.key).digest("hex"),
    );
    expect(stored.key).not.toBe(body.key);
    expect(stored.orgId).toBe("org-1");
    expect(stored.appId).toBe(app.id);
    expect(stored.createdBy).toBe("admin-1");
    expect(stored.ownerType).toBe("staff");
  });

  it("rejects scopes outside the self-serve set (admin:*, balance:write)", async () => {
    const app = await createApp();
    for (const scopes of [["admin:*"], ["balance:write"], ["bogus:scope"]]) {
      const res = await keysPOST(
        post(`http://localhost/api/v1/apps/${app.id}/keys`, {
          name: "Bad",
          scopes,
        }),
        params(app.id),
      );
      expect(res.status).toBe(400);
    }
    expect(mockKeys).toHaveLength(0);
  });

  it("enforces the 5 active keys per app cap", async () => {
    const app = await createApp();
    for (let i = 0; i < 5; i++) {
      const res = await keysPOST(
        post(`http://localhost/api/v1/apps/${app.id}/keys`, {
          name: `Key ${i}`,
          scopes: ["balance:read"],
        }),
        params(app.id),
      );
      expect(res.status).toBe(201);
    }
    const sixth = await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "One too many",
        scopes: ["balance:read"],
      }),
      params(app.id),
    );
    expect(sixth.status).toBe(400);
  });

  it("lists keys with prefix/scopes/usage and no secret material", async () => {
    const app = await createApp();
    await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "Production",
        scopes: ["topup:send"],
      }),
      params(app.id),
    );
    const res = await keysGET(
      get(`http://localhost/api/v1/apps/${app.id}/keys`),
      params(app.id),
    );
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    const listed = body.keys[0];
    expect(listed.keyPrefix).toMatch(/^sk_live_/);
    expect(listed.scopes).toEqual(["topup:send"]);
    expect(listed.usageCount).toBe(0);
    expect(listed).not.toHaveProperty("key");
  });

  it("cross-org key creation under another org's app is 404", async () => {
    const app = await createApp();
    mockRequireAuth.mockResolvedValue(ADMIN_ORG2);
    const res = await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "Hijack",
        scopes: ["topup:send"],
      }),
      params(app.id),
    );
    expect(res.status).toBe(404);
    expect(mockKeys).toHaveLength(0);
  });

  it("operators cannot create app keys (403)", async () => {
    const app = await createApp();
    mockRequireAuth.mockResolvedValue(OPERATOR);
    const res = await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "Nope",
        scopes: ["topup:send"],
      }),
      params(app.id),
    );
    expect(res.status).toBe(403);
  });

  it("deleting an app deactivates it and revokes all its keys", async () => {
    const app = await createApp();
    await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "K1",
        scopes: ["topup:send"],
      }),
      params(app.id),
    );
    await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "K2",
        scopes: ["balance:read"],
      }),
      params(app.id),
    );

    const res = await appDELETE(
      new NextRequest(`http://localhost/api/v1/apps/${app.id}`, {
        method: "DELETE",
      }),
      params(app.id),
    );
    expect(res.status).toBe(200);
    expect(mockApps[0].isActive).toBe(false);
    expect(mockKeys.every((k) => k.isActive === false)).toBe(true);

    // And no new keys can be minted under a deactivated app.
    const after = await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "Zombie",
        scopes: ["topup:send"],
      }),
      params(app.id),
    );
    expect(after.status).toBe(400);
  });

  it("an org admin can revoke an app key created by a different admin via /api-keys/[id]", async () => {
    const app = await createApp();
    await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "Shared",
        scopes: ["topup:send"],
      }),
      params(app.id),
    );
    const keyId = mockKeys[0]._id;

    mockRequireAuth.mockResolvedValue({
      userId: "admin-other",
      orgId: "org-1",
      roles: [UserRole.ADMIN],
    });
    const res = await keyDELETE(
      new NextRequest(`http://localhost/api/v1/api-keys/${keyId}`, {
        method: "DELETE",
      }),
      params(keyId),
    );
    expect(res.status).toBe(200);
    expect(mockKeys[0].isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Response-shape contract (what the dashboard pages consume)
// ---------------------------------------------------------------------------

describe("developer apps — response-shape contract", () => {
  it("apps list is { apps: [...] } at top level, not wrapped in data", async () => {
    await createApp();
    const res = await appsGET(get("http://localhost/api/v1/apps"));
    const body = await res.json();
    expect(body.data).toBeUndefined();
    expect(Array.isArray(body.apps)).toBe(true);
    const entry = body.apps[0];
    // Fields consumed by src/app/dashboard/developers/page.tsx
    for (const field of [
      "id",
      "name",
      "description",
      "isActive",
      "activeKeyCount",
      "createdAt",
    ]) {
      expect(entry).toHaveProperty(field);
    }
  });

  it("key creation is { key, apiKey } at top level", async () => {
    const app = await createApp();
    const res = await keysPOST(
      post(`http://localhost/api/v1/apps/${app.id}/keys`, {
        name: "Contract",
        scopes: ["customer:read"],
      }),
      params(app.id),
    );
    const body = await res.json();
    expect(body.data).toBeUndefined();
    expect(typeof body.key).toBe("string");
    expect(body.apiKey).toMatchObject({
      name: "Contract",
      scopes: ["customer:read"],
      appId: app.id,
    });
  });
});
