import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { Wallet } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/wallet
 * Get wallet details for current organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Find or create wallet for organization
    let wallet = await Wallet.findOne({ orgId: session.orgId });

    if (!wallet) {
      // Create wallet if it doesn't exist
      wallet = await Wallet.create({
        orgId: session.orgId,
        balance: 0,
        currency: 'USD',
        reservedBalance: 0,
        availableBalance: 0,
        status: 'active',
      });
    }

    logger.info('Fetched wallet', {
      orgId: session.orgId,
      balance: wallet.balance,
      availableBalance: wallet.availableBalance,
    });

    return createSuccessResponse({
      wallet: {
        id: wallet._id?.toString(),
        balance: wallet.balance,
        currency: wallet.currency,
        reservedBalance: wallet.reservedBalance,
        availableBalance: wallet.availableBalance,
        lowBalanceThreshold: wallet.lowBalanceThreshold,
        status: wallet.status,
        metadata: wallet.metadata,
      },
    });
  } catch (error) {
    logger.error('Error fetching wallet', { error });
    return handleApiError(error);
  }
}

/**
 * PATCH /api/v1/wallet
 * Update wallet settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const body = await request.json();
    const { lowBalanceThreshold, autoReloadEnabled, autoReloadAmount } = body;

    const wallet = await Wallet.findOne({ orgId: session.orgId });
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Update settings
    if (lowBalanceThreshold !== undefined) {
      wallet.lowBalanceThreshold = lowBalanceThreshold;
    }
    if (autoReloadEnabled !== undefined) {
      wallet.autoReloadEnabled = autoReloadEnabled;
    }
    if (autoReloadAmount !== undefined) {
      wallet.autoReloadAmount = autoReloadAmount;
    }

    await wallet.save();

    logger.info('Updated wallet settings', {
      orgId: session.orgId,
      updates: { lowBalanceThreshold, autoReloadEnabled, autoReloadAmount },
    });

    return createSuccessResponse({
      wallet: {
        id: wallet._id?.toString(),
        balance: wallet.balance,
        currency: wallet.currency,
        reservedBalance: wallet.reservedBalance,
        availableBalance: wallet.availableBalance,
        lowBalanceThreshold: wallet.lowBalanceThreshold,
        autoReloadEnabled: wallet.autoReloadEnabled,
        autoReloadAmount: wallet.autoReloadAmount,
        status: wallet.status,
      },
    });
  } catch (error) {
    logger.error('Error updating wallet', { error });
    return handleApiError(error);
  }
}
