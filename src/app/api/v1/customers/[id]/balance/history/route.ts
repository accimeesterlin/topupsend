import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { Customer, CustomerBalanceHistory } from "@topupsend/db";
import { ApiErrors } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";

/**
 * GET /api/v1/customers/[id]/balance/history
 *
 * F-H3: the session used to be discarded and the history queried by
 * bare customerId — any authenticated account (even a read-only
 * VIEWER) could read any customer's balance history in any org.
 * This now mirrors the sibling balance route: same permission
 * (VIEW_CUSTOMER_BALANCE), the customer must exist, and the customer
 * must belong to the caller's organization; the history query itself
 * is org-scoped as well.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  const { id } = await params;

  // Same permission the sibling balance route requires
  if (!hasPermission(session.roles, Permission.VIEW_CUSTOMER_BALANCE)) {
    throw ApiErrors.Forbidden("Insufficient permissions");
  }

  // Get customer
  const customer = await Customer.findById(id);

  if (!customer) {
    throw ApiErrors.NotFound("Customer not found");
  }

  // Verify customer belongs to user's org
  if (customer.orgId !== session.orgId) {
    throw ApiErrors.Forbidden("Access denied");
  }

  // Get query params
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

  // Get balance history for this customer, scoped to the caller's org
  const history = await CustomerBalanceHistory.find({
    customerId: customer._id,
    orgId: session.orgId,
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return createSuccessResponse({ history });
}
