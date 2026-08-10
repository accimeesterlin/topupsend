import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { Discount } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/v1/discounts/[id]
 * Get a specific discount
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    await dbConnection.connect();

    const discount = await Discount.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!discount) {
      return createErrorResponse('Discount not found', 404);
    }

    return createSuccessResponse({ discount });
  } catch (error) {
    logger.error('Error fetching discount', { error });
    return handleApiError(error);
  }
}

/**
 * PATCH /api/v1/discounts/[id]
 * Update a discount
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    await dbConnection.connect();

    const discount = await Discount.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!discount) {
      return createErrorResponse('Discount not found', 404);
    }

    const body = await request.json();

    // Update fields if provided
    if (body.name !== undefined) {
      if (!body.name.trim()) {
        return createErrorResponse('Discount name cannot be empty', 400);
      }
      discount.name = body.name.trim();
    }

    if (body.description !== undefined) {
      if (!body.description.trim()) {
        return createErrorResponse('Discount description cannot be empty', 400);
      }
      discount.description = body.description.trim();
    }

    if (body.type !== undefined) {
      if (!['percentage', 'fixed'].includes(body.type)) {
        return createErrorResponse('Invalid discount type', 400);
      }
      discount.type = body.type;
    }

    if (body.value !== undefined) {
      if (body.value < 0) {
        return createErrorResponse('Discount value must be positive', 400);
      }
      if (body.type === 'percentage' && body.value > 100) {
        return createErrorResponse('Percentage discount cannot exceed 100%', 400);
      }
      discount.value = body.value;
    }

    if (body.isActive !== undefined) {
      discount.isActive = body.isActive;
    }

    if (body.startDate !== undefined) {
      discount.startDate = body.startDate || null;
    }

    if (body.endDate !== undefined) {
      discount.endDate = body.endDate || null;
    }

    if (body.minPurchaseAmount !== undefined) {
      discount.minPurchaseAmount = body.minPurchaseAmount || null;
    }

    if (body.maxDiscountAmount !== undefined) {
      discount.maxDiscountAmount = body.maxDiscountAmount || null;
    }

    if (body.applicableCountries !== undefined) {
      discount.applicableCountries = body.applicableCountries || [];
    }

    if (body.usageLimit !== undefined) {
      discount.usageLimit = body.usageLimit || null;
    }

    await discount.save();

    logger.info('Updated discount', {
      orgId: session.orgId,
      discountId: discount._id,
    });

    return createSuccessResponse({ discount });
  } catch (error) {
    logger.error('Error updating discount', { error });
    return handleApiError(error);
  }
}

/**
 * DELETE /api/v1/discounts/[id]
 * Delete a discount
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);

    await dbConnection.connect();

    const discount = await Discount.findOneAndDelete({
      _id: id,
      orgId: session.orgId,
    });

    if (!discount) {
      return createErrorResponse('Discount not found', 404);
    }

    logger.info('Deleted discount', {
      orgId: session.orgId,
      discountId: id,
    });

    return createSuccessResponse({ message: 'Discount deleted successfully' });
  } catch (error) {
    logger.error('Error deleting discount', { error });
    return handleApiError(error);
  }
}
