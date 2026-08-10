import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { CustomerBalanceHistory } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(request);
    const { id } = await params;

    // Get query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10),
      100,
    );

    // Get balance history for this customer
    const history = await CustomerBalanceHistory.find({ customerId: id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return createSuccessResponse({ history });
  } catch (error: any) {
    return createErrorResponse(
      error.message || "Failed to fetch balance history",
      500,
    );
  }
}
