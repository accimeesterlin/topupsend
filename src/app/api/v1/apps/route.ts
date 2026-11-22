/**
 * Developer Apps Endpoints
 * GET  /api/v1/apps - List the current organization's apps
 * POST /api/v1/apps - Create an app (org admins only)
 *
 * The organization ALWAYS comes from the session — never from the
 * request body or query string.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { App, ApiKey, dbConnection } from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import {
  createSuccessResponse,
  createCreatedResponse,
} from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import {
  MAX_ACTIVE_APPS_PER_ORG,
  serializeApp,
} from "@/lib/developer-apps";

/**
 * GET - List apps for the session's organization, with active key
 * counts per app.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const apps = await App.find({ orgId: session.orgId }).sort({
      createdAt: -1,
    });

    const counts = await ApiKey.aggregate([
      {
        $match: {
          orgId: session.orgId,
          appId: { $in: apps.map((a) => String(a._id)) },
          isActive: true,
        },
      },
      { $group: { _id: "$appId", count: { $sum: 1 } } },
    ]);
    const countByAppId = new Map<string, number>(
      counts.map((c: { _id: string; count: number }) => [c._id, c.count]),
    );

    return createSuccessResponse({
      apps: apps.map((app) => ({
        ...serializeApp(app),
        activeKeyCount: countByAppId.get(String(app._id)) ?? 0,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createAppSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
});

/**
 * POST - Create an app. Org admins only (CREATE_API_KEYS); operators
 * and viewers keep their personal staff-portal keys and cannot mint
 * org app keys.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    if (!hasPermission(session.roles, Permission.CREATE_API_KEYS)) {
      throw ApiErrors.Forbidden(
        "Insufficient permissions to create developer apps",
      );
    }

    const body = await request.json();
    const data = createAppSchema.parse(body);

    const activeCount = await App.countDocuments({
      orgId: session.orgId,
      isActive: true,
    });
    if (activeCount >= MAX_ACTIVE_APPS_PER_ORG) {
      throw ApiErrors.BadRequest(
        `App limit reached: an organization may have at most ${MAX_ACTIVE_APPS_PER_ORG} active apps`,
      );
    }

    const app = await App.create({
      orgId: session.orgId,
      name: data.name,
      description: data.description,
      createdBy: session.userId,
      isActive: true,
    });

    return createCreatedResponse({
      app: { ...serializeApp(app), activeKeyCount: 0 },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
