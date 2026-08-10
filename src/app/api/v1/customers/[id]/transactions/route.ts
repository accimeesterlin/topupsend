import { NextRequest } from "next/server";
import { Transaction } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { requireCustomerAuthOrApiKey } from "@/lib/auth-middleware";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await dbConnection.connect();

    const { id } = await params;
    const session = await requireCustomerAuthOrApiKey(request);

    // Ensure customer can only access their own transactions
    if (session.customerId !== id) {
      return createErrorResponse(
        "You can only access your own transactions",
        403,
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "10", 10),
      100,
    );
    const skip = (page - 1) * limit;
    const search = searchParams.get("search") || "";
    const testModeFilter = searchParams.get("testMode"); // "true", "false", or null (all)

    // Build query filter
    const query: any = { customerId: session.customerId };

    // Add test mode filter if provided
    if (testModeFilter !== null && testModeFilter !== "") {
      query.isTestMode = testModeFilter === "true";
    }

    // Add search filter if provided
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { "recipient.phoneNumber": { $regex: escaped, $options: "i" } },
        { orderId: { $regex: escaped, $options: "i" } },
        { status: { $regex: escaped, $options: "i" } },
      ];
    }

    // Get transactions for this customer
    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(query),
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
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
