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
import { requireAuth, requireCustomerAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";

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
    const customer = await requireCustomerAuth(request);

    // Customers cannot create admin keys
    if (data.scopes.includes("admin:*")) {
      throw ApiErrors.Forbidden("Customers cannot create admin API keys");
    }

    // Customers cannot write balance (only admins can assign)
    if (data.scopes.includes("balance:write")) {
      throw ApiErrors.Forbidden(
        "Customers cannot create keys with balance:write scope",
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
