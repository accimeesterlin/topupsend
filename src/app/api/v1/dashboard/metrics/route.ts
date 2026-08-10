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

    // Fetch transactions for current period
    const transactions = await Transaction.find({
      orgId: session.orgId,
      createdAt: { $gte: startDate },
    });

    // Fetch transactions for previous period
    const prevTransactions = await Transaction.find({
      orgId: session.orgId,
      createdAt: { $gte: prevStartDate, $lt: startDate },
    });

    // Calculate revenue
    const revenue = transactions
      .filter(t => t.status === 'completed')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const prevRevenue = prevTransactions
      .filter(t => t.status === 'completed')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const revenueTrend = prevRevenue > 0
      ? ((revenue - prevRevenue) / prevRevenue) * 100
      : revenue > 0 ? 100 : 0;

    // Calculate transaction counts
    const transactionCount = transactions.length;
    const prevTransactionCount = prevTransactions.length;
    const transactionTrend = prevTransactionCount > 0
      ? ((transactionCount - prevTransactionCount) / prevTransactionCount) * 100
      : transactionCount > 0 ? 100 : 0;

    // Calculate customer counts
    const customers = await Customer.countDocuments({ orgId: session.orgId });
    const newCustomers = await Customer.countDocuments({
      orgId: session.orgId,
      createdAt: { $gte: startDate },
    });
    const prevNewCustomers = await Customer.countDocuments({
      orgId: session.orgId,
      createdAt: { $gte: prevStartDate, $lt: startDate },
    });
    const customerTrend = prevNewCustomers > 0
      ? ((newCustomers - prevNewCustomers) / prevNewCustomers) * 100
      : newCustomers > 0 ? 100 : 0;

    // Calculate success rate
    const completedCount = transactions.filter(t => t.status === 'completed').length;
    const successRate = transactionCount > 0 ? (completedCount / transactionCount) * 100 : 0;

    const prevCompletedCount = prevTransactions.filter(t => t.status === 'completed').length;
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
