import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { Discount } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/v1/discounts
 * Get all discounts for the organization with search and filters
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all'; // all, active, inactive, expired
    const type = searchParams.get('type') || 'all'; // all, percentage, fixed
    const codeType = searchParams.get('codeType') || 'all'; // all, coded, automatic

    // Build query
    const query: any = { orgId: session.orgId };

    // Search by name, description, or code
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { code: { $regex: escaped, $options: 'i' } },
      ];
    }

    // Filter by status
    const now = new Date();
    if (status === 'active') {
      query.isActive = true;
      query.$and = [
        { $or: [{ startDate: { $exists: false } }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: { $exists: false } }, { endDate: { $gte: now } }] },
      ];
    } else if (status === 'inactive') {
      query.isActive = false;
    } else if (status === 'expired') {
      query.endDate = { $lt: now };
    }

    // Filter by type
    if (type !== 'all') {
      query.type = type;
    }

    // Filter by code type (coded vs automatic)
    if (codeType === 'coded') {
      query.code = { $exists: true, $ne: null };
    } else if (codeType === 'automatic') {
      query.$or = [
        { code: { $exists: false } },
        { code: null },
        { code: '' },
      ];
    }

    const discounts = await Discount.find(query).sort({ createdAt: -1 });

    logger.info('Fetched discounts', {
      orgId: session.orgId,
      count: discounts.length,
      filters: { search, status, type, codeType },
    });

    return createSuccessResponse({ discounts });
  } catch (error) {
    logger.error('Error fetching discounts', { error });
    return handleApiError(error);
  }
}

/**
 * POST /api/v1/discounts
 * Create a new discount (with optional code generation)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const body = await request.json();
    const {
      name,
      description,
      code,
      autoGenerateCode,
      type,
      value,
      isActive,
      startDate,
      endDate,
      minPurchaseAmount,
      maxDiscountAmount,
      applicableCountries,
      applicableProducts,
      usageLimit,
      maxUsesPerCustomer,
    } = body;

    // Validation
    if (!name || !name.trim()) {
      return createErrorResponse('Discount name is required', 400);
    }

    if (!description || !description.trim()) {
      return createErrorResponse('Discount description is required', 400);
    }

    if (!type || !['percentage', 'fixed'].includes(type)) {
      return createErrorResponse('Invalid discount type. Must be percentage or fixed', 400);
    }

    if (value === undefined || value === null || value < 0) {
      return createErrorResponse('Discount value must be a positive number', 400);
    }

    if (type === 'percentage' && value > 100) {
      return createErrorResponse('Percentage discount cannot exceed 100%', 400);
    }

    // Generate code if requested
    let discountCode = code?.trim().toUpperCase() || null;
    if (autoGenerateCode && !discountCode) {
      // Generate a unique code
      let attempts = 0;
      do {
        discountCode = (Discount as any).generateCode(8);
        const existing = await Discount.findOne({ orgId: session.orgId, code: discountCode });
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      if (attempts >= 10) {
        return createErrorResponse('Failed to generate unique discount code. Please try again.', 500);
      }
    }

    // If a code is provided, check uniqueness
    if (discountCode) {
      const existingCode = await Discount.findOne({ orgId: session.orgId, code: discountCode });
      if (existingCode) {
        return createErrorResponse('A discount with this code already exists', 400);
      }
    }

    // Create discount
    const discount = await Discount.create({
      orgId: session.orgId,
      name: name.trim(),
      description: description.trim(),
      code: discountCode,
      type,
      value,
      isActive: isActive !== undefined ? isActive : true,
      startDate: startDate || null,
      endDate: endDate || null,
      minPurchaseAmount: minPurchaseAmount || null,
      maxDiscountAmount: maxDiscountAmount || null,
      applicableCountries: applicableCountries || [],
      applicableProducts: applicableProducts || [],
      usageLimit: usageLimit || null,
      maxUsesPerCustomer: maxUsesPerCustomer || null,
      usageCount: 0,
    });

    logger.info('Created discount', {
      orgId: session.orgId,
      discountId: discount._id,
      name: discount.name,
      code: discount.code,
    });

    return createSuccessResponse({ discount }, 201);
  } catch (error) {
    logger.error('Error creating discount', { error });
    return handleApiError(error);
  }
}
