import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { WalletTransaction } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/wallet/transactions
 * Get wallet transaction history
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const type = searchParams.get('type'); // Filter by type
    const status = searchParams.get('status'); // Filter by status

    const skip = (page - 1) * limit;

    // Build query
    const query: any = { orgId: session.orgId };
    if (type) query.type = type;
    if (status) query.status = status;

    // Get transactions
    const [transactions, total] = await Promise.all([
      WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(query),
    ]);

    const formattedTransactions = transactions.map((tx) => ({
      id: tx._id.toString(),
      type: tx.type,
      amount: tx.amount,
      currency: tx.currency,
      balanceBefore: tx.balanceBefore,
      balanceAfter: tx.balanceAfter,
      status: tx.status,
      reference: tx.reference,
      paymentMethod: tx.paymentMethod,
      metadata: tx.metadata,
      createdAt: tx.createdAt,
    }));

    logger.info('Fetched wallet transactions', {
      orgId: session.orgId,
      page,
      limit,
      total,
    });

    return createSuccessResponse({
      transactions: formattedTransactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + transactions.length < total,
      },
    });
  } catch (error) {
    logger.error('Error fetching wallet transactions', { error });
    return handleApiError(error);
  }
}
