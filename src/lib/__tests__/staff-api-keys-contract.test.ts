/**
 * @jest-environment node
 *
 * Staff API keys — response-shape contract for GET/POST /api/v1/api-keys
 * (the routes behind src/app/staff-portal/my-api-keys/page.tsx):
 * - POST returns the created key FLAT at the top level:
 *   { message, key, apiKey: {...} } — the one-time plaintext secret is
 *   `key`. There is NO `data` envelope and NO `fullKey` field anywhere.
 *   The old staff page read data.data.fullKey, so the secret was never
 *   displayed even though the key had already been saved server-side.
 * - GET returns { keys: [...] } at the top level — NOT data.data — and
 *   each entry's identity field is `id`, not `_id` (the other drift
 *   that left the staff list permanently at "No API keys found").
 * - Only the SHA-256 hash is stored; the plaintext never appears in
 *   the list response.
 * The customer portal page consumes the same shapes correctly; this
 * contract keeps the staff page and the routes from drifting apart
 * again (same pattern as the developer-apps contract in PR #29).
 *
 * RBAC H1 re-pin: this suite previously blessed an OPERATOR minting
 * a topup:send key through this legacy endpoint. That WAS the hole —
 * MANAGE_OWN_API_KEYS is held by OPERATOR and the read-only VIEWER,
 * and a key must not outrank its creator. Self-service creators
 * without MANAGE_API_KEYS are now capped at read scopes; the shape
 * contract below therefore creates read-scoped keys as the operator,
 * and the ceiling itself is pinned in its own describe block.
 */
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { UserRole } from "@topupsend/types";

// ---------------------------------------------------------------------------
// In-memory model store (mock-prefixed for jest.mock factories)
// ---------------------------------------------------------------------------

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
  requireVerifiedCustomer: jest.fn(),
}));

jest.mock("@topupsend/db", () => {
  const crypto = jest.requireActual("crypto");
  return {
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
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
      find: jest.fn((filter: any) => ({
        sort: () =>
          Promise.resolve(mockKeys.filter((k) => mockMatches(k, filter))),
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { GET, POST } from "../../app/api/v1/api-keys/route";

// OPERATOR holds MANAGE_OWN_API_KEYS (may create/list own keys) but not
// VIEW_API_KEYS, so GET takes the own-keys branch — the staff portal's
// "My API Keys" path. ADMIN holds VIEW_API_KEYS (org-wide list branch).
const OPERATOR = {
  userId: "op-1",
  orgId: "org-1",
  roles: [UserRole.OPERATOR],
};
const VIEWER = {
  userId: "viewer-1",
  orgId: "org-1",
  roles: [UserRole.VIEWER],
};
const ADMIN = { userId: "admin-1", orgId: "org-1", roles: [UserRole.ADMIN] };

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

beforeEach(() => {
  mockKeys.length = 0;
  jest.clearAllMocks();
  mockRequireAuth.mockResolvedValue(OPERATOR);
});

async function createKey(
  name = "PG integration",
  scopes = ["transactions:read", "balance:read"],
) {
  const res = await POST(
    post("http://localhost/api/v1/api-keys", { name, scopes }),
  );
  expect(res.status).toBe(201);
  return res.json();
}

// ---------------------------------------------------------------------------
// Create contract (what the staff page's create flow consumes)
// ---------------------------------------------------------------------------

describe("staff api keys — create response-shape contract", () => {
  it("returns { message, key, apiKey } flat at the top level, secret in `key`", async () => {
    const body = await createKey();

    // No envelope, no nested fullKey — the two reads that broke the page.
    expect(body.data).toBeUndefined();
    expect(body.fullKey).toBeUndefined();
    expect(body.apiKey.fullKey).toBeUndefined();

    // The one-time secret the page displays is the top-level `key`.
    expect(typeof body.key).toBe("string");
    expect(body.key.startsWith("sk_live_")).toBe(true);
    expect(typeof body.message).toBe("string");

    // apiKey metadata fields the page/routes contract on.
    expect(body.apiKey).toMatchObject({
      name: "PG integration",
      scopes: ["transactions:read", "balance:read"],
      keyPrefix: body.key.substring(0, 12),
    });
    for (const field of ["id", "rateLimit", "createdAt"]) {
      expect(body.apiKey).toHaveProperty(field);
    }
    expect(body.apiKey.id).toBe(String(mockKeys[0]._id));
  });

  it("stores only the SHA-256 hash, never the plaintext", async () => {
    const body = await createKey();
    expect(mockKeys).toHaveLength(1);
    const stored = mockKeys[0];
    expect(stored.key).not.toBe(body.key);
    expect(stored.key).toBe(
      createHash("sha256").update(body.key).digest("hex"),
    );
    expect(stored.keyPrefix).toBe(body.key.substring(0, 12));
  });
});

// ---------------------------------------------------------------------------
// List contract (what the staff page's table consumes)
// ---------------------------------------------------------------------------

describe("staff api keys — list response-shape contract", () => {
  it("own-keys list is { keys: [...] } at top level with `id`, not `_id`", async () => {
    await createKey("First key");
    await createKey("Second key", ["balance:read"]);

    const res = await GET(get("http://localhost/api/v1/api-keys"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toBeUndefined();
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys).toHaveLength(2);

    const entry = body.keys[0];
    // Fields consumed by src/app/staff-portal/my-api-keys/page.tsx
    for (const field of [
      "id",
      "name",
      "keyPrefix",
      "scopes",
      "lastUsedAt",
      "usageCount",
      "createdAt",
    ]) {
      expect(entry).toHaveProperty(field);
    }
    expect(typeof entry.id).toBe("string");
    expect(entry._id).toBeUndefined();
    // No secret material in the list: neither plaintext nor hash.
    expect(entry.key).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(mockKeys[0].key);
  });

  it("own-keys list excludes other staff members' keys; admin list includes them", async () => {
    await createKey("Operator key");

    // Another staff member in the same org creates a key.
    mockRequireAuth.mockResolvedValue({
      userId: "op-2",
      orgId: "org-1",
      roles: [UserRole.OPERATOR],
    });
    await createKey("Other member key");

    // Back as the first operator: only their own key is listed.
    mockRequireAuth.mockResolvedValue(OPERATOR);
    const ownRes = await GET(get("http://localhost/api/v1/api-keys"));
    const ownBody = await ownRes.json();
    expect(ownBody.keys.map((k: any) => k.name)).toEqual(["Operator key"]);

    // An admin (VIEW_API_KEYS) sees the whole org's keys, same envelope.
    mockRequireAuth.mockResolvedValue(ADMIN);
    const allRes = await GET(get("http://localhost/api/v1/api-keys"));
    const allBody = await allRes.json();
    expect(allBody.data).toBeUndefined();
    expect(allBody.keys.map((k: any) => k.name).sort()).toEqual([
      "Operator key",
      "Other member key",
    ]);
  });
});

// ---------------------------------------------------------------------------
// RBAC H1 — self-service scope ceiling
// ---------------------------------------------------------------------------

describe("staff api keys — RBAC H1 self-service scope ceiling", () => {
  async function postExpectingForbidden(scopes: string[]) {
    await expect(
      POST(
        post("http://localhost/api/v1/api-keys", {
          name: "Ceiling probe",
          scopes,
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    // A refused mint must not persist a key.
    expect(mockKeys).toHaveLength(0);
  }

  it("OPERATOR cannot mint topup:send (the pre-fix pin, now reversed)", async () => {
    await postExpectingForbidden(["topup:send"]);
  });

  it("OPERATOR cannot mint balance:write", async () => {
    await postExpectingForbidden(["balance:write"]);
  });

  it("OPERATOR cannot smuggle a write scope in with read scopes", async () => {
    await postExpectingForbidden(["transactions:read", "customer:update"]);
  });

  it("VIEWER cannot mint topup:send or balance:write", async () => {
    mockRequireAuth.mockResolvedValue(VIEWER);
    await postExpectingForbidden(["topup:send"]);
    await postExpectingForbidden(["balance:write"]);
  });

  it("VIEWER keeps read-scoped own keys (MANAGE_OWN_API_KEYS retained)", async () => {
    mockRequireAuth.mockResolvedValue(VIEWER);
    const body = await createKey("Viewer read key", [
      "balance:read",
      "webhooks:read",
    ]);
    expect(body.apiKey.scopes).toEqual(["balance:read", "webhooks:read"]);
    expect(mockKeys).toHaveLength(1);
    expect(mockKeys[0].ownerId).toBe("viewer-1");
  });

  it("ADMIN (MANAGE_API_KEYS) can still mint topup:send and admin:*", async () => {
    mockRequireAuth.mockResolvedValue(ADMIN);
    const send = await createKey("Admin send key", ["topup:send"]);
    expect(send.apiKey.scopes).toEqual(["topup:send"]);

    const admin = await createKey("Admin wildcard key", ["admin:*"]);
    expect(admin.apiKey.scopes).toEqual(["admin:*"]);
    expect(mockKeys).toHaveLength(2);
  });
});
