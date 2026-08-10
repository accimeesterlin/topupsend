import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { Transaction } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    // Get query params
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "20", 10),
      100,
    );
    const skip = (page - 1) * limit;

    // Get transactions created by this user
    const [transactions, total] = await Promise.all([
      Transaction.find({ createdBy: user.userId })
        .populate("productId", "name country")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments({ createdBy: user.userId }),
    ]);

    return createSuccessResponse({
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    return createErrorResponse(
      error.message || "Failed to fetch transactions",
      500,
    );
  }
}
