import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection, Transaction, Customer } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";

countries.registerLocale(en);

function getCountryName(code: string): string {
  return countries.getName(code, "en") || code;
}

function getDateRange(period: string): { startDate: Date; prevStartDate: Date } {
  const now = new Date();
  const startDate = new Date();

  switch (period) {
    case "today":
      startDate.setHours(0, 0, 0, 0);
      break;
    case "7d":
      startDate.setDate(now.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(now.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(now.getDate() - 90);
      break;
    case "1y":
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    case "all":
      startDate.setFullYear(2000, 0, 1);
      break;
    default:
      startDate.setDate(now.getDate() - 30);
  }

  const periodLength = now.getTime() - startDate.getTime();
  const prevStartDate = new Date(startDate.getTime() - periodLength);

  return { startDate, prevStartDate };
}

/**
 * GET /api/v1/dashboard/analytics
 * Comprehensive analytics data using MongoDB aggregation pipelines
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "30d";
    const { startDate, prevStartDate } = getDateRange(period);

    const orgId = session.orgId;
    const baseMatch = { orgId, createdAt: { $gte: startDate } };
    const prevMatch = { orgId, createdAt: { $gte: prevStartDate, $lt: startDate } };

    // Use daily buckets for <=30d, weekly for >30d
    const periodMs = new Date().getTime() - startDate.getTime();
    const daysInPeriod = periodMs / (1000 * 60 * 60 * 24);
    const dateFormat = daysInPeriod <= 30 ? "%Y-%m-%d" : "%Y-W%V";

    // Run all aggregation pipelines in parallel
    const [
      summaryResult,
      prevSummaryResult,
      revenueOverTime,
      statusBreakdown,
      topCustomersAgg,
      topCountries,
      topOperators,
      paymentMethods,
      topProducts,
      recentFailures,
      deviceBreakdown,
      browserBreakdown,
      languageBreakdown,
      totalCustomers,
      newCustomers,
      prevNewCustomers,
    ] = await Promise.all([
      // 1. Summary aggregation (current period)
      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalRevenue: {
              $sum: {
                $cond: [{ $eq: ["$status", "completed"] }, "$amount", 0],
              },
            },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
            },
            refunded: {
              $sum: { $cond: [{ $eq: ["$status", "refunded"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
          },
        },
      ]),

      // 2. Summary aggregation (previous period for trends)
      Transaction.aggregate([
        { $match: prevMatch },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalRevenue: {
              $sum: {
                $cond: [{ $eq: ["$status", "completed"] }, "$amount", 0],
              },
            },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
          },
        },
      ]),

      // 3. Revenue over time
      Transaction.aggregate([
        { $match: { ...baseMatch, status: "completed" } },
        {
          $group: {
            _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
            revenue: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", revenue: { $round: ["$revenue", 2] }, count: 1 } },
      ]),

      // 4. Status breakdown
      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
        { $project: { _id: 0, status: "$_id", count: 1, amount: { $round: ["$amount", 2] } } },
        { $sort: { count: -1 } },
      ]),

      // 5. Top customers by spend (lookup current name from Customer collection)
      Transaction.aggregate([
        { $match: { ...baseMatch, status: "completed" } },
        {
          $group: {
            _id: "$recipient.phoneNumber",
            totalSpent: { $sum: "$amount" },
            transactionCount: { $sum: 1 },
            email: { $first: "$recipient.email" },
            txName: { $first: "$recipient.name" },
            country: { $first: "$operator.country" },
            lastPurchase: { $max: "$createdAt" },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "customers",
            let: { phone: "$_id" },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ["$orgId", orgId] }, { $eq: ["$phoneNumber", "$$phone"] }] } } },
              { $project: { name: 1 } },
              { $limit: 1 },
            ],
            as: "customerDoc",
          },
        },
        {
          $project: {
            _id: 0,
            phoneNumber: "$_id",
            totalSpent: { $round: ["$totalSpent", 2] },
            transactionCount: 1,
            email: 1,
            name: {
              $ifNull: [
                { $arrayElemAt: ["$customerDoc.name", 0] },
                "$txName",
              ],
            },
            country: 1,
            lastPurchase: 1,
          },
        },
      ]),

      // 6. Top countries by revenue
      Transaction.aggregate([
        { $match: { ...baseMatch, status: "completed" } },
        {
          $group: {
            _id: "$operator.country",
            revenue: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, country: "$_id", revenue: { $round: ["$revenue", 2] }, count: 1 } },
      ]),

      // 7. Top operators by revenue (prefer friendly providerName over raw operator code)
      Transaction.aggregate([
        { $match: { ...baseMatch, status: "completed" } },
        {
          $group: {
            _id: { $ifNull: ["$metadata.providerName", "$operator.name", "Unknown"] },
            revenue: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, operator: "$_id", revenue: { $round: ["$revenue", 2] }, count: 1 } },
      ]),

      // 8. Payment method breakdown
      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: "$paymentGateway",
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
        { $project: { _id: 0, method: { $ifNull: ["$_id", "unknown"] }, count: 1, amount: { $round: ["$amount", 2] } } },
        { $sort: { count: -1 } },
      ]),

      // 9. Top products by purchase count
      Transaction.aggregate([
        { $match: { ...baseMatch, status: "completed" } },
        {
          $group: {
            _id: "$metadata.productSkuCode",
            productName: { $first: "$metadata.productName" },
            providerName: { $first: "$metadata.providerName" },
            count: { $sum: 1 },
            revenue: { $sum: "$amount" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            skuCode: { $ifNull: ["$_id", "unknown"] },
            productName: { $ifNull: ["$productName", "Unknown Product"] },
            providerName: { $ifNull: ["$providerName", "Unknown"] },
            count: 1,
            revenue: { $round: ["$revenue", 2] },
          },
        },
      ]),

      // 10. Recent failures
      Transaction.aggregate([
        { $match: { ...baseMatch, status: "failed" } },
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 0,
            orderId: 1,
            phoneNumber: "$recipient.phoneNumber",
            amount: 1,
            currency: 1,
            failureReason: "$metadata.failureReason",
            providerName: { $ifNull: ["$metadata.providerName", "$operator.name"] },
            createdAt: 1,
          },
        },
      ]),

      // 11. Device type breakdown
      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: { $ifNull: ["$metadata.deviceType", "Unknown"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $project: { _id: 0, device: "$_id", count: 1 } },
      ]),

      // 12. Browser breakdown
      Transaction.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: { $ifNull: ["$metadata.browserName", "Unknown"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $project: { _id: 0, browser: "$_id", count: 1 } },
      ]),

      // 13. Language breakdown (extract primary language from Accept-Language header)
      Transaction.aggregate([
        { $match: baseMatch },
        {
          $addFields: {
            primaryLang: {
              $cond: {
                if: { $and: [{ $ne: ["$metadata.acceptLanguage", null] }, { $ne: ["$metadata.acceptLanguage", ""] }] },
                then: {
                  $toUpper: {
                    $arrayElemAt: [
                      { $split: [{ $arrayElemAt: [{ $split: [{ $arrayElemAt: [{ $split: ["$metadata.acceptLanguage", ","] }, 0] }, ";"] }, 0] }, "-"] },
                      0,
                    ],
                  },
                },
                else: "Unknown",
              },
            },
          },
        },
        {
          $group: {
            _id: "$primaryLang",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, language: "$_id", count: 1 } },
      ]),

      // 14. Total customers
      Customer.countDocuments({ orgId }),

      // 15. New customers in period
      Customer.countDocuments({ orgId, createdAt: { $gte: startDate } }),

      // 16. Previous period new customers
      Customer.countDocuments({
        orgId,
        createdAt: { $gte: prevStartDate, $lt: startDate },
      }),
    ]);

    // Process summary
    const current = summaryResult[0] || {
      totalTransactions: 0,
      totalRevenue: 0,
      completed: 0,
      failed: 0,
      refunded: 0,
      pending: 0,
    };
    const prev = prevSummaryResult[0] || {
      totalTransactions: 0,
      totalRevenue: 0,
      completed: 0,
    };

    const calcTrend = (curr: number, previous: number): number => {
      if (previous === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - previous) / previous) * 1000) / 10;
    };

    const successRate =
      current.totalTransactions > 0
        ? (current.completed / current.totalTransactions) * 100
        : 0;
    const prevSuccessRate =
      prev.totalTransactions > 0
        ? (prev.completed / prev.totalTransactions) * 100
        : 0;

    const avgTxValue =
      current.completed > 0 ? current.totalRevenue / current.completed : 0;

    const customerTrend = calcTrend(newCustomers, prevNewCustomers);

    // Enrich top countries with full names
    const topCountriesEnriched = topCountries.map(
      (c: { country: string; revenue: number; count: number }) => ({
        ...c,
        countryName: getCountryName(c.country),
      }),
    );

    const analytics = {
      summary: {
        revenue: Math.round(current.totalRevenue * 100) / 100,
        revenueTrend: calcTrend(current.totalRevenue, prev.totalRevenue),
        transactions: current.totalTransactions,
        transactionsTrend: calcTrend(
          current.totalTransactions,
          prev.totalTransactions,
        ),
        completed: current.completed,
        failed: current.failed,
        refunded: current.refunded,
        pending: current.pending,
        customers: totalCustomers,
        newCustomers,
        customersTrend: customerTrend,
        successRate: Math.round(successRate * 10) / 10,
        successRateTrend:
          Math.round((successRate - prevSuccessRate) * 10) / 10,
        avgTransactionValue: Math.round(avgTxValue * 100) / 100,
      },
      revenueOverTime,
      statusBreakdown,
      topCustomers: topCustomersAgg,
      topCountries: topCountriesEnriched,
      topOperators,
      paymentMethods,
      topProducts,
      recentFailures,
      deviceBreakdown,
      browserBreakdown,
      languageBreakdown,
    };

    return createSuccessResponse(analytics);
  } catch (error) {
    logger.error("Analytics API error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return createErrorResponse("Failed to fetch analytics", 500);
  }
}
