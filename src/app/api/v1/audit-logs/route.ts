import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { dbConnection } from "@topupsend/db/connection";
import { Organization } from "@topupsend/db";

// Mock audit logs for now - you can replace this with actual database queries
const generateMockAuditLogs = (_orgId: string) => {
  const actions = [
    "create",
    "update",
    "delete",
    "read",
    "login",
    "logout",
    "payment",
    "invite",
  ];
  const resources = [
    "transaction",
    "customer",
    "product",
    "team member",
    "settings",
    "integration",
    "discount",
  ];
  const statuses: ("success" | "failed")[] = [
    "success",
    "success",
    "success",
    "success",
    "failed",
  ];

  const logs = [];
  const now = new Date();

  for (let i = 0; i < 50; i++) {
    const timestamp = new Date(now.getTime() - i * 1000 * 60 * 15); // 15 min intervals
    logs.push({
      id: `log_${i + 1}`,
      timestamp,
      userId: `user_${Math.floor(Math.random() * 5) + 1}`,
      userEmail: `user${Math.floor(Math.random() * 5) + 1}@example.com`,
      action: actions[Math.floor(Math.random() * actions.length)],
      resource: resources[Math.floor(Math.random() * resources.length)],
      resourceId: `res_${Math.random().toString(36).substr(2, 9)}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      ipAddress: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
  }

  return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    await dbConnection.connect();

    // Get organization and check subscription tier
    const organization = await Organization.findById(user.orgId);
    if (!organization) {
      return createErrorResponse("Organization not found", 404);
    }

    const tier = organization.subscriptionTier || "starter";

    // Only Scale and Enterprise tiers have access to audit logs
    if (tier !== "scale" && tier !== "enterprise") {
      return createErrorResponse(
        "Audit logs are only available on Scale and Enterprise plans",
        403,
      );
    }

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const limit = parseInt(searchParams.get("limit") || "100");

    // TODO: Replace with actual database query
    // For now, return mock data
    let logs = generateMockAuditLogs(String(organization._id));

    // Apply filters
    if (action && action !== "all") {
      logs = logs.filter((log) => log.action === action);
    }
    if (status && status !== "all") {
      logs = logs.filter((log) => log.status === status);
    }
    if (startDate) {
      logs = logs.filter(
        (log) => new Date(log.timestamp) >= new Date(startDate),
      );
    }
    if (endDate) {
      logs = logs.filter((log) => new Date(log.timestamp) <= new Date(endDate));
    }

    // Apply limit
    logs = logs.slice(0, limit);

    return createSuccessResponse({
      logs,
      total: logs.length,
      hasMore: false,
    });
  } catch (error) {
    console.error("Audit logs fetch error:", error);
    return createErrorResponse("Failed to fetch audit logs", 500);
  }
}
