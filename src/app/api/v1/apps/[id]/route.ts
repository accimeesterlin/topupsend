/**
 * Single Developer App Endpoints
 * GET    /api/v1/apps/[id] - App details (session org only)
 * PATCH  /api/v1/apps/[id] - Rename / edit description (org admins)
 * DELETE /api/v1/apps/[id] - Deactivate the app AND revoke its keys
 *
 * Cross-org ids return 404 — one organization can never see or act
 * on another's apps.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiKey, dbConnection } from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { findOrgApp, serializeApp } from "@/lib/developer-apps";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();
    const { id } = await params;

    const app = await findOrgApp(session.orgId, id);
    const activeKeyCount = await ApiKey.countDocuments({
      appId: String(app._id),
      isActive: true,
    });

    return createSuccessResponse({
      app: { ...serializeApp(app), activeKeyCount },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const updateAppSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();
    const { id } = await params;

    if (!hasPermission(session.roles, Permission.MANAGE_API_KEYS)) {
      throw ApiErrors.Forbidden(
        "Insufficient permissions to manage developer apps",
      );
    }

    const app = await findOrgApp(session.orgId, id);

    const body = await request.json();
    const data = updateAppSchema.parse(body);

    if (data.name !== undefined) app.name = data.name;
    if (data.description !== undefined) {
      app.description = data.description ?? undefined;
    }
    await app.save();

    return createSuccessResponse({
      message: "App updated successfully",
      app: serializeApp(app),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();
    const { id } = await params;

    if (!hasPermission(session.roles, Permission.MANAGE_API_KEYS)) {
      throw ApiErrors.Forbidden(
        "Insufficient permissions to manage developer apps",
      );
    }

    const app = await findOrgApp(session.orgId, id);

    // Deactivating an app revokes every key minted under it, so a
    // deleted app's integrations stop working immediately.
    await ApiKey.updateMany(
      { appId: String(app._id), isActive: true },
      { $set: { isActive: false } },
    );

    app.isActive = false;
    await app.save();

    return createSuccessResponse({
      message: "App deactivated and its API keys revoked",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
