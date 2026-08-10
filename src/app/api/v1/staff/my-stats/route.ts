import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { Transaction } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);

    // Calculate date for "this month"
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get stats for user
    const [
      totalTransactions,
      totalAmount,
      completedTransactions,
      pendingTransactions,
      thisMonthStats,
    ] = await Promise.all([
      Transaction.countDocuments({ createdBy: session.userId }),
      Transaction.aggregate<{ _id: null; total: number }>([
        { $match: { createdBy: session.userId } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]).then((res) => res[0]?.total || 0),
      Transaction.countDocuments({
        createdBy: session.userId,
        status: "completed",
      }),
      Transaction.countDocuments({
        createdBy: session.userId,
        status: "pending",
      }),
      Transaction.aggregate<{ _id: null; count: number; amount: number }>([
        {
          $match: {
            createdBy: session.userId,
            createdAt: { $gte: firstDayOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
      ]).then((res) => res[0] || { count: 0, amount: 0 }),
    ]);

    return createSuccessResponse({
      totalTransactions,
      totalAmount,
      completedTransactions,
      pendingTransactions,
      thisMonthTransactions: thisMonthStats.count,
      thisMonthAmount: thisMonthStats.amount,
    });
  } catch (error: any) {
    return createErrorResponse(error);
  }
}
