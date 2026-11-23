/**
 * API Key Management Endpoints
 * GET /api/v1/api-keys - List API keys for current user/org
 * POST /api/v1/api-keys - Create new API key
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiKey, type ApiKeyScope } from "@topupsend/db";
import { ApiErrors } from "@/lib/api-error";
import {
  createSuccessResponse,
  createCreatedResponse,
} from "@/lib/api-response";
import {
  requireAuth,
  requireCustomerAuth,
  requireVerifiedCustomer,
} from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";

/**
 * RBAC C2 — scopes a storefront customer may never mint. Customer
 * keys authenticate the customer's OWN account surfaces; the scopes
 * below act on the organization (topup:send spends the ORG's
 * DingConnect funds through the partner API) or on other customers.
 * What remains for customers is the read set: balance:read,
 * transactions:read, customer:read, webhooks:read.
 */
const CUSTOMER_FORBIDDEN_SCOPES: ApiKeyScope[] = [
  "admin:*",
  "balance:write",
  "topup:send",
  "transactions:create",
  "customer:update",
];

/**
 * RBAC H1 — the self-service ceiling for staff keys on this legacy
 * endpoint. MANAGE_OWN_API_KEYS is held by OPERATOR and by the
 * read-only VIEWER, and a key's authority must never exceed its
 * creator's: without a ceiling, a viewer could mint a topup:send or
 * balance:write key and move money their dashboard role forbids.
 * Holders of MANAGE_API_KEYS (org admins) keep the full scope list —
 * the same split the developer-apps path enforces (admin-gated
 * creation, admin:* / balance:write never self-serve).
 */
const STAFF_SELF_SERVICE_SCOPES: ApiKeyScope[] = [
  "balance:read",
  "transactions:read",
  "customer:read",
  "webhooks:read",
];

/**
 * GET - List API keys
 * Staff: Can see all org keys if they have permission, or their own keys
 * Customers: Can only see their own keys
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isCustomer = searchParams.get("customer") === "true";

  if (isCustomer) {
    // Customer listing their own keys
    const customer = await requireCustomerAuth(request);

    const keys = await ApiKey.find({
      ownerId: customer.customerId,
      ownerType: "customer",
      isActive: true,
    }).sort({ createdAt: -1 });

    return createSuccessResponse({
      keys: keys.map((key) => ({
        id: String(key._id),
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        rateLimit: key.getRateLimit(),
        lastUsedAt: key.lastUsedAt,
        usageCount: key.usageCount,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      })),
    });
  } else {
    // Staff listing keys
    const session = await requireAuth(request);
    const viewAll = hasPermission(session.roles, Permission.VIEW_API_KEYS);

    let keys;

    if (viewAll) {
      // Admin/staff with VIEW_API_KEYS permission can see all org keys
      keys = await ApiKey.find({
        orgId: session.orgId,
        isActive: true,
      }).sort({ createdAt: -1 });
    } else {
      // Staff can only see their own keys
      keys = await ApiKey.find({
        ownerId: session.userId,
        ownerType: "staff",
        isActive: true,
      }).sort({ createdAt: -1 });
    }

    return createSuccessResponse({
      keys: keys.map((key) => ({
        id: String(key._id),
        name: key.name,
        keyPrefix: key.keyPrefix,
        ownerId: key.ownerId,
        ownerType: key.ownerType,
        scopes: key.scopes,
        rateLimit: key.getRateLimit(),
        lastUsedAt: key.lastUsedAt,
        usageCount: key.usageCount,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      })),
    });
  }
}

const createKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  scopes: z.array(z.string()).min(1, "At least one scope is required"),
  expiresAt: z.string().datetime().optional(),
  customRateLimit: z
    .object({
      requests: z.number().min(100).max(50000),
      window: z.number().min(1),
    })
    .optional(),
});

/**
 * POST - Create new API key
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isCustomer = searchParams.get("customer") === "true";

  const body = await request.json();
  const data = createKeySchema.parse(body);

  // Validate scopes
  const validScopes: ApiKeyScope[] = [
    "balance:read",
    "balance:write",
    "transactions:read",
    "transactions:create",
    "topup:send",
    "customer:read",
    "customer:update",
    "webhooks:read",
    "admin:*",
  ];

  const invalidScopes = data.scopes.filter(
    (s) => !validScopes.includes(s as ApiKeyScope),
  );
  if (invalidScopes.length > 0) {
    throw ApiErrors.BadRequest(`Invalid scopes: ${invalidScopes.join(", ")}`);
  }

  let ownerId: string;
  let ownerType: "staff" | "customer";
  let orgId: string;
  let defaultRateLimit = { requests: 1000, window: 3600 };

  if (isCustomer) {
    // RBAC C2: key creation requires a VERIFIED customer. Registration
    // issues a session immediately with emailVerified:false; letting
    // that session mint keys was the first link in the chain that let
    // anyone on the internet spend an organization's DingConnect
    // funds. (Key CREATION is gated; listing own keys above is not.)
    const customer = await requireVerifiedCustomer(request);

    // Customers cannot mint org-acting or money-moving scopes.
    const forbiddenScopes = data.scopes.filter((s) =>
      CUSTOMER_FORBIDDEN_SCOPES.includes(s as ApiKeyScope),
    );
    if (forbiddenScopes.length > 0) {
      throw ApiErrors.Forbidden(
        `Customers cannot create API keys with these scopes: ${forbiddenScopes.join(", ")}`,
      );
    }

    ownerId = customer.customerId;
    ownerType = "customer";
    orgId = customer.orgId;
    defaultRateLimit = { requests: 1000, window: 3600 };
  } else {
    const session = await requireAuth(request);

    // Check if user can create API keys
    const canCreate =
      hasPermission(session.roles, Permission.CREATE_API_KEYS) ||
      hasPermission(session.roles, Permission.MANAGE_OWN_API_KEYS);

    if (!canCreate) {
      throw ApiErrors.Forbidden("Insufficient permissions to create API keys");
    }

    // Only admins can create admin keys
    if (
      data.scopes.includes("admin:*") &&
      !hasPermission(session.roles, Permission.MANAGE_API_KEYS)
    ) {
      throw ApiErrors.Forbidden(
        "Only administrators can create admin API keys",
      );
    }

    // RBAC H1: self-service creators (no MANAGE_API_KEYS) are capped
    // at read scopes — a key must not outrank its creator. This is
    // what stops a VIEWER or OPERATOR from minting topup:send or the
    // latent balance:write through this legacy endpoint; org admins
    // mint the full list here or via the developer-apps path.
    if (!hasPermission(session.roles, Permission.MANAGE_API_KEYS)) {
      const beyondCeiling = data.scopes.filter(
        (s) => !STAFF_SELF_SERVICE_SCOPES.includes(s as ApiKeyScope),
      );
      if (beyondCeiling.length > 0) {
        throw ApiErrors.Forbidden(
          `Self-service API keys are limited to read scopes (${STAFF_SELF_SERVICE_SCOPES.join(", ")}). An administrator must create keys with: ${beyondCeiling.join(", ")}`,
        );
      }
    }

    ownerId = session.userId;
    ownerType = "staff";
    orgId = session.orgId;
    defaultRateLimit = { requests: 2000, window: 3600 }; // Higher for staff
  }

  // Generate API key
  const { key, hash, prefix } = (ApiKey as any).generateKey(ownerType);

  // Create API key record
  const apiKey = await ApiKey.create({
    key: hash,
    keyPrefix: prefix,
    orgId,
    ownerId,
    ownerType,
    name: data.name,
    scopes: data.scopes,
    rateLimit: defaultRateLimit,
    customRateLimit: data.customRateLimit,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    isActive: true,
    usageCount: 0,
  });

  return createCreatedResponse({
    message:
      "API key created successfully. Store this key securely - you won't be able to see it again.",
    key: key, // Return the actual key only once
    apiKey: {
      id: String(apiKey._id),
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      rateLimit: apiKey.getRateLimit(),
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    },
  });
}
