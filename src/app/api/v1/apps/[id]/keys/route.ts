/**
 * Developer App API Key Endpoints
 * GET  /api/v1/apps/[id]/keys - List the app's keys (prefix only)
 * POST /api/v1/apps/[id]/keys - Create a key under the app (org admins)
 *
 * The plaintext secret is returned exactly once, in the POST response.
 * Only its SHA-256 hash is stored (ApiKey.generateKey).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiKey, dbConnection } from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import {
  createSuccessResponse,
  createCreatedResponse,
} from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import {
  MAX_ACTIVE_KEYS_PER_APP,
  findOrgApp,
  isAppKeyScope,
} from "@/lib/developer-apps";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();
    const { id } = await params;

    const app = await findOrgApp(session.orgId, id);

    const keys = await ApiKey.find({ appId: String(app._id) }).sort({
      createdAt: -1,
    });

    return createSuccessResponse({
      keys: keys.map((key) => ({
        id: String(key._id),
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        appId: key.appId ?? null,
        createdBy: key.createdBy ?? null,
        rateLimit: key.getRateLimit(),
        lastUsedAt: key.lastUsedAt ?? null,
        usageCount: key.usageCount,
        isActive: key.isActive,
        expiresAt: key.expiresAt ?? null,
        createdAt: key.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  scopes: z.array(z.string()).min(1, "At least one scope is required"),
  expiresAt: z.string().datetime().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();
    const { id } = await params;

    if (!hasPermission(session.roles, Permission.CREATE_API_KEYS)) {
      throw ApiErrors.Forbidden(
        "Insufficient permissions to create API keys",
      );
    }

    const app = await findOrgApp(session.orgId, id);
    if (!app.isActive) {
      throw ApiErrors.BadRequest(
        "Cannot create keys for a deactivated app",
      );
    }

    const body = await request.json();
    const data = createKeySchema.parse(body);

    // App keys may only carry the self-serve scope set — admin:* and
    // balance:write are rejected even for admins here; those stay
    // with the staff-portal flow.
    const invalidScopes = data.scopes.filter((s) => !isAppKeyScope(s));
    if (invalidScopes.length > 0) {
      throw ApiErrors.BadRequest(
        `Invalid scopes for app keys: ${invalidScopes.join(", ")}`,
      );
    }

    const activeCount = await ApiKey.countDocuments({
      appId: String(app._id),
      isActive: true,
    });
    if (activeCount >= MAX_ACTIVE_KEYS_PER_APP) {
      throw ApiErrors.BadRequest(
        `Key limit reached: an app may have at most ${MAX_ACTIVE_KEYS_PER_APP} active keys`,
      );
    }

    const { key, hash, prefix } = (ApiKey as any).generateKey("staff");

    const apiKey = await ApiKey.create({
      key: hash,
      keyPrefix: prefix,
      orgId: session.orgId,
      ownerId: session.userId,
      ownerType: "staff",
      appId: String(app._id),
      createdBy: session.userId,
      name: data.name,
      scopes: data.scopes,
      rateLimit: { requests: 2000, window: 3600 },
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      isActive: true,
      usageCount: 0,
    });

    return createCreatedResponse({
      message:
        "API key created successfully. Store this key securely - you won't be able to see it again.",
      key, // plaintext, returned only once
      apiKey: {
        id: String(apiKey._id),
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        appId: apiKey.appId,
        rateLimit: apiKey.getRateLimit(),
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
