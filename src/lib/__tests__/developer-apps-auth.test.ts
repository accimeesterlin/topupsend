/**
 * @jest-environment node
 *
 * Staff-key regression pin for the developer-apps change: a LEGACY
 * API key (created via the staff portal before apps existed — no
 * appId, no createdBy) must keep authenticating the partner API
 * surface exactly as before. The REAL requireApiKey /
 * requireApiKeyWithScope middleware runs; only persistence and the
 * rate limiter are mocked, mirroring partner-api.test.ts.
 */
import { NextRequest } from "next/server";

// A legacy staff key document: deliberately NO appId / createdBy.
const mockLegacyKey = {
  _id: "legacy-key-1",
  orgId: "org-1",
  ownerId: "staff-user-1",
  ownerType: "staff",
  scopes: ["topup:send", "transactions:read"],
  expiresAt: undefined,
  isActive: true,
  getRateLimit: () => ({ requests: 2000, window: 3600 }),
  validateScope: (required: string | string[]) => {
    const req = Array.isArray(required) ? required : [required];
    return req.every((s) => mockLegacyKey.scopes.includes(s));
  },
  incrementUsage: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@topupsend/db", () => ({
  dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
  ApiKey: {
    findOne: jest.fn(() => ({
      select: jest.fn().mockResolvedValue(mockLegacyKey),
    })),
  },
  Customer: { findById: jest.fn() },
  User: { findById: jest.fn() },
}));

jest.mock("@/lib/auth", () => ({
  getSession: jest.fn(),
}));

jest.mock("@/lib/customer-auth", () => ({
  getCustomerSession: jest.fn(),
}));

jest.mock("@/lib/services/rate-limit.service", () => ({
  rateLimitService: {
    checkBothLimits: jest.fn().mockResolvedValue({ allowed: true }),
    recordBothRequests: jest.fn().mockResolvedValue(undefined),
  },
}));

import {
  requireApiKey,
  requireApiKeyWithScope,
} from "@/lib/auth-middleware";

function keyedRequest() {
  return new NextRequest("http://localhost/api/v1/partner/topups", {
    method: "POST",
    headers: { "x-api-key": "sk_live_legacysecret" },
  });
}

describe("legacy staff keys (no appId) after developer-apps", () => {
  it("still authenticate and resolve the key's org", async () => {
    const { apiKey, orgId } = await requireApiKey(keyedRequest());
    expect(orgId).toBe("org-1");
    expect(String(apiKey._id)).toBe("legacy-key-1");
    // The whole point: appId stays absent and nothing breaks.
    expect((apiKey as any).appId).toBeUndefined();
    expect((apiKey as any).createdBy).toBeUndefined();
  });

  it("still pass scope checks for topup:send and transactions:read", async () => {
    await expect(
      requireApiKeyWithScope(keyedRequest(), "topup:send"),
    ).resolves.toMatchObject({ orgId: "org-1" });
    await expect(
      requireApiKeyWithScope(keyedRequest(), "transactions:read"),
    ).resolves.toMatchObject({ orgId: "org-1" });
  });

  it("still reject scopes the legacy key does not hold (403)", async () => {
    await expect(
      requireApiKeyWithScope(keyedRequest(), "customer:read"),
    ).rejects.toMatchObject({ status: 403 });
  });
});
