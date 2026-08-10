import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Transaction } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/transactions
 * Get all transactions for the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const excludeTestMode = searchParams.get('excludeTestMode') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const query: any = { orgId: session.orgId };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { orderId: { $regex: escaped, $options: 'i' } },
        { 'recipient.phoneNumber': { $regex: escaped, $options: 'i' } },
        { 'recipient.email': { $regex: escaped, $options: 'i' } },
      ];
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (excludeTestMode) {
      // Exclude test mode transactions (both by metadata flag and TEST- prefix in provider ID)
      query.$and = query.$and || [];
      query.$and.push({
        'metadata.testMode': { $ne: true },
        providerTransactionId: { $not: /^TEST-/ }
      });
    }

    const total = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/transactions?orderId=XXX
 * Update transaction details (currently supports updating customer name)
 */
export async function PATCH(request: NextRequest) {
  try {
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    if (!orderId) {
      return createErrorResponse('Missing orderId', 400);
    }

    const body = await request.json();
    const { customerName } = body;

    if (!customerName || typeof customerName !== 'string' || !customerName.trim()) {
      return createErrorResponse('Invalid customer name', 400);
    }

    logger.info('Updating transaction with customer name', { orderId, customerName });

    // Find transaction
    const transaction = await Transaction.findOne({ orderId });

    if (!transaction) {
      logger.error('Transaction not found', { orderId });
      return createErrorResponse('Transaction not found', 404);
    }

    // Update recipient name
    transaction.recipient.name = customerName.trim();
    await transaction.save();

    logger.info('Transaction updated successfully', { orderId, customerName });

    return createSuccessResponse({
      success: true,
      message: 'Customer name updated successfully',
      transaction: {
        orderId: transaction.orderId,
        recipient: transaction.recipient,
      },
    });
  } catch (error) {
    logger.error('Transaction update error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
