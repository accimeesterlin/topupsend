import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Transaction, Customer } from '@topupsend/db';

// Dashboard metrics endpoint - returns real-time data from database
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d'; // today, 7d, 30d, 90d, 1y, all

    // Calculate date range
    const now = new Date();
    const startDate = new Date();

    switch (period) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
        // Set to very old date for all-time data
        startDate.setFullYear(2000, 0, 1);
        break;
      default:
        startDate.setDate(now.getDate() - 30);
    }

    // Calculate previous period for trend comparison
    const periodLength = now.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - periodLength);

    // Aggregate in the database (F-H13): this endpoint used to load the
    // org's entire transaction history into memory twice per dashboard
    // load and total it in JS. The pipelines below follow the sibling
    // dashboard/analytics pattern and compute the same figures.
    const summaryPipeline = (match: Record<string, unknown>) => [
      { $match: match },
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
    ];

    const [currentAgg, prevAgg, customers, newCustomers, prevNewCustomers] =
      await Promise.all([
        Transaction.aggregate(
          summaryPipeline({
            orgId: session.orgId,
            createdAt: { $gte: startDate },
          }),
        ),
        Transaction.aggregate(
          summaryPipeline({
            orgId: session.orgId,
            createdAt: { $gte: prevStartDate, $lt: startDate },
          }),
        ),
        Customer.countDocuments({ orgId: session.orgId }),
        Customer.countDocuments({
          orgId: session.orgId,
          createdAt: { $gte: startDate },
        }),
        Customer.countDocuments({
          orgId: session.orgId,
          createdAt: { $gte: prevStartDate, $lt: startDate },
        }),
      ]);

    const current = currentAgg[0] || {
      totalTransactions: 0,
      totalRevenue: 0,
      completed: 0,
    };
    const prev = prevAgg[0] || {
      totalTransactions: 0,
      totalRevenue: 0,
      completed: 0,
    };

    // Calculate revenue
    const revenue = current.totalRevenue;
    const prevRevenue = prev.totalRevenue;

    const revenueTrend = prevRevenue > 0
      ? ((revenue - prevRevenue) / prevRevenue) * 100
      : revenue > 0 ? 100 : 0;

    // Calculate transaction counts
    const transactionCount = current.totalTransactions;
    const prevTransactionCount = prev.totalTransactions;
    const transactionTrend = prevTransactionCount > 0
      ? ((transactionCount - prevTransactionCount) / prevTransactionCount) * 100
      : transactionCount > 0 ? 100 : 0;

    // Calculate customer trend
    const customerTrend = prevNewCustomers > 0
      ? ((newCustomers - prevNewCustomers) / prevNewCustomers) * 100
      : newCustomers > 0 ? 100 : 0;

    // Calculate success rate
    const completedCount = current.completed;
    const successRate = transactionCount > 0 ? (completedCount / transactionCount) * 100 : 0;

    const prevCompletedCount = prev.completed;
    const prevSuccessRate = prevTransactionCount > 0 ? (prevCompletedCount / prevTransactionCount) * 100 : 0;
    const successRateTrend = prevSuccessRate > 0
      ? successRate - prevSuccessRate
      : successRate > 0 ? successRate : 0;

    // Calculate average transaction value (only for completed transactions)
    const averageTransactionValue = completedCount > 0 ? revenue / completedCount : 0;

    const metrics = {
      revenue: {
        total: Math.round(revenue * 100) / 100,
        trend: Math.round(revenueTrend * 10) / 10,
      },
      transactions: {
        total: transactionCount,
        completed: completedCount,
        trend: Math.round(transactionTrend * 10) / 10,
      },
      customers: {
        total: customers,
        newCustomers,
        trend: Math.round(customerTrend * 10) / 10,
      },
      successRate: {
        rate: Math.round(successRate * 10) / 10,
        trend: Math.round(successRateTrend * 10) / 10,
      },
      averageTransactionValue: Math.round(averageTransactionValue * 100) / 100,
    };

    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard metrics' },
      { status: 500 }
    );
  }
}
