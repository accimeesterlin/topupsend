import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { UserOrganization } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth-middleware';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/preview/test-purchase
 * Simulate a product purchase in preview mode (deducts from balance limit if enabled)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const body = await request.json();
    const { phoneNumber, product } = body;

    // Validation
    if (!phoneNumber) {
      return createErrorResponse('Phone number is required', 400);
    }

    if (!product || !product.skuCode || !product.name || product.finalPrice === undefined) {
      return createErrorResponse('Product details are required', 400);
    }

    // Get user's organization membership
    const userOrg = await UserOrganization.findOne({
      userId: session.userId,
      orgId: session.orgId,
      isActive: true,
    });

    if (!userOrg) {
      return createErrorResponse('User organization membership not found', 404);
    }

    // Check if balance limit is enabled
    if (userOrg.balanceLimit && userOrg.balanceLimit.enabled) {
      // Check if user has sufficient balance
      if (!userOrg.hasAvailableBalance(product.finalPrice)) {
        return createErrorResponse(
          `Insufficient balance. You have $${(userOrg.balanceLimit.maxBalance - userOrg.balanceLimit.currentUsed).toFixed(2)} available, but this purchase costs $${product.finalPrice.toFixed(2)}.`,
          400
        );
      }

      // Deduct from balance
      await userOrg.useBalance(product.finalPrice, {
        phoneNumber,
        productName: product.name,
        orderId: `TEST-${Date.now()}`,
      });

      logger.info('Test purchase completed', {
        userId: session.userId,
        orgId: session.orgId,
        phoneNumber,
        productName: product.name,
        amount: product.finalPrice,
        remainingBalance: userOrg.balanceLimit.maxBalance - userOrg.balanceLimit.currentUsed,
      });

      return createSuccessResponse({
        message: 'Test purchase successful',
        balanceUsed: product.finalPrice,
        remainingBalance: userOrg.balanceLimit.maxBalance - userOrg.balanceLimit.currentUsed,
        balanceLimit: userOrg.balanceLimit,
      });
    }

    // No balance limit - just log and return success
    logger.info('Test purchase completed (no balance limit)', {
      userId: session.userId,
      orgId: session.orgId,
      phoneNumber,
      productName: product.name,
      amount: product.finalPrice,
    });

    return createSuccessResponse({
      message: 'Test purchase successful (no balance tracking)',
      balanceUsed: 0,
    });
  } catch (error) {
    logger.error('Test purchase error', { error });
    return handleApiError(error);
  }
}
