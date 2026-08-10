/**
 * Single API Key Management Endpoints
 * GET /api/v1/api-keys/[id] - Get API key details
 * PUT /api/v1/api-keys/[id] - Update API key (name, rate limit)
 * DELETE /api/v1/api-keys/[id] - Revoke API key
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiKey } from "@topupsend/db";
import { ApiErrors } from "@/lib/api-error";
import {
  createSuccessResponse,
} from "@/lib/api-response";
import { requireAuth, requireCustomerAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";

/**
 * GET - Get API key details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const isCustomer = searchParams.get("customer") === "true";

  const apiKey = await ApiKey.findById(id);

  if (!apiKey) {
    throw ApiErrors.NotFound("API key not found");
  }

  // Check ownership
  if (isCustomer) {
    const customer = await requireCustomerAuth(request);

    if (
      apiKey.ownerId !== customer.customerId ||
      apiKey.ownerType !== "customer"
    ) {
      throw ApiErrors.Forbidden("Access denied");
    }
  } else {
    const session = await requireAuth(request);

    const canViewAll = hasPermission(session.roles, Permission.VIEW_API_KEYS);
    const isOwner = apiKey.ownerId === session.userId;

    if (!canViewAll && !isOwner) {
      throw ApiErrors.Forbidden("Access denied");
    }
  }

  return createSuccessResponse({
    apiKey: {
      id: String(apiKey._id),
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      ownerId: apiKey.ownerId,
      ownerType: apiKey.ownerType,
      scopes: apiKey.scopes,
      rateLimit: apiKey.getRateLimit(),
      lastUsedAt: apiKey.lastUsedAt,
      usageCount: apiKey.usageCount,
      expiresAt: apiKey.expiresAt,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
    },
  });
}

const updateKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  customRateLimit: z
    .object({
      requests: z.number().min(100).max(50000),
      window: z.number().min(1),
    })
    .optional(),
});

/**
 * PUT - Update API key
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const isCustomer = searchParams.get("customer") === "true";

  const body = await request.json();
  const data = updateKeySchema.parse(body);

  const apiKey = await ApiKey.findById(id);

  if (!apiKey) {
    throw ApiErrors.NotFound("API key not found");
  }

  // Check ownership and permissions
  if (isCustomer) {
    const customer = await requireCustomerAuth(request);

    if (
      apiKey.ownerId !== customer.customerId ||
      apiKey.ownerType !== "customer"
    ) {
      throw ApiErrors.Forbidden("Access denied");
    }

    // Customers cannot adjust rate limits
    if (data.customRateLimit) {
      throw ApiErrors.Forbidden("Customers cannot adjust rate limits");
    }
  } else {
    const session = await requireAuth(request);

    const canManageAll = hasPermission(
      session.roles,
      Permission.MANAGE_API_KEYS,
    );
    const isOwner = apiKey.ownerId === session.userId;

    if (!canManageAll && !isOwner) {
      throw ApiErrors.Forbidden("Access denied");
    }

    // Only admins can adjust rate limits
    if (
      data.customRateLimit &&
      !hasPermission(session.roles, Permission.ADJUST_RATE_LIMITS)
    ) {
      throw ApiErrors.Forbidden(
        "Insufficient permissions to adjust rate limits",
      );
    }
  }

  // Update fields
  if (data.name) {
    apiKey.name = data.name;
  }

  if (data.customRateLimit) {
    apiKey.customRateLimit = data.customRateLimit;
  }

  await apiKey.save();

  return createSuccessResponse({
    message: "API key updated successfully",
    apiKey: {
      id: String(apiKey._id),
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      rateLimit: apiKey.getRateLimit(),
      updatedAt: apiKey.updatedAt,
    },
  });
}

/**
 * DELETE - Revoke API key
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const isCustomer = searchParams.get("customer") === "true";

  const apiKey = await ApiKey.findById(id);

  if (!apiKey) {
    throw ApiErrors.NotFound("API key not found");
  }

  // Check ownership and permissions
  if (isCustomer) {
    const customer = await requireCustomerAuth(request);

    if (
      apiKey.ownerId !== customer.customerId ||
      apiKey.ownerType !== "customer"
    ) {
      throw ApiErrors.Forbidden("Access denied");
    }
  } else {
    const session = await requireAuth(request);

    const canRevokeAll = hasPermission(
      session.roles,
      Permission.REVOKE_API_KEYS,
    );
    const isOwner = apiKey.ownerId === session.userId;

    if (!canRevokeAll && !isOwner) {
      throw ApiErrors.Forbidden("Access denied");
    }
  }

  // Revoke the key
  apiKey.isActive = false;
  await apiKey.save();

  return createSuccessResponse({
    message: "API key revoked successfully",
  });
}
