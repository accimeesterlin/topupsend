import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { Wallet, WalletTransaction } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/wallet/deposit
 * Add funds to wallet (manual deposit for now)
 * TODO: Integrate with payment providers
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const body = await request.json();
    const { amount, paymentMethod, reference, notes } = body;

    if (!amount || amount <= 0) {
      return createErrorResponse('Invalid amount', 400);
    }

    // Find wallet
    const wallet = await Wallet.findOne({ orgId: session.orgId });
    if (!wallet) {
      return createErrorResponse('Wallet not found', 404);
    }

    if (wallet.status !== 'active') {
      return createErrorResponse('Wallet is not active', 400);
    }

    const balanceBefore = wallet.balance;

    // Create wallet transaction record
    const walletTransaction = await WalletTransaction.create({
      orgId: session.orgId,
      walletId: wallet._id?.toString(),
      type: 'deposit',
      amount,
      currency: wallet.currency,
      balanceBefore,
      balanceAfter: balanceBefore + amount,
      status: 'completed',
      reference: {
        type: reference?.type || 'manual',
        id: reference?.id,
        description: reference?.description || 'Manual deposit',
      },
      paymentMethod: paymentMethod
        ? {
            provider: paymentMethod.provider,
            transactionId: paymentMethod.transactionId,
            last4: paymentMethod.last4,
            brand: paymentMethod.brand,
          }
        : undefined,
      metadata: {
        processedBy: session.userId,
        notes,
      },
    });

    // Update wallet balance
    wallet.deposit(amount);
    await wallet.save();

    logger.info('Wallet deposit completed', {
      orgId: session.orgId,
      amount,
      balanceBefore,
      balanceAfter: wallet.balance,
      transactionId: walletTransaction._id?.toString(),
    });

    return createSuccessResponse({
      transaction: {
        id: walletTransaction._id?.toString(),
        type: walletTransaction.type,
        amount: walletTransaction.amount,
        currency: walletTransaction.currency,
        balanceBefore: walletTransaction.balanceBefore,
        balanceAfter: walletTransaction.balanceAfter,
        status: walletTransaction.status,
        createdAt: walletTransaction.createdAt,
      },
      wallet: {
        balance: wallet.balance,
        availableBalance: wallet.availableBalance,
        currency: wallet.currency,
      },
    });
  } catch (error) {
    logger.error('Error processing wallet deposit', { error });
    return handleApiError(error);
  }
}
