import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { Discount } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/discounts/validate
 * Validate a discount code for a specific purchase
 */
export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const {
      code,
      orgSlug,
      amount,
      countryCode,
      productSkuCode,
    } = body;

    // Validation
    if (!code || !code.trim()) {
      return createErrorResponse('Discount code is required', 400);
    }

    if (!orgSlug) {
      return createErrorResponse('Organization slug is required', 400);
    }

    if (amount === undefined || amount === null || amount <= 0) {
      return createErrorResponse('Purchase amount must be greater than 0', 400);
    }

    // Find the organization (check both legacy Org and new Organization models)
    const { Organization, Org } = await import('@topupsend/db');

    logger.info('Looking up organization', { orgSlug });

    const legacyOrg = await Org.findOne({ slug: orgSlug });
    const modernOrg = await Organization.findOne({ slug: orgSlug });
    const org = legacyOrg || modernOrg;

    if (!org) {
      logger.error('Organization not found', {
        orgSlug,
        checkedLegacy: !!legacyOrg,
        checkedModern: !!modernOrg,
        message: 'No organization found with this slug in either Org or Organization collection.'
      });
      return createErrorResponse('Organization not found. Please contact support.', 404);
    }

    logger.info('Organization found', {
      orgId: String(org._id),
      orgName: org.name,
      source: legacyOrg ? 'legacy Org' : 'modern Organization'
    });

    const orgId = String(org._id);

    // Find the discount by code (case-insensitive)
    const discount = await Discount.findOne({
      orgId,
      code: code.trim().toUpperCase(),
    });

    if (!discount) {
      return createErrorResponse('Invalid discount code', 404);
    }

    // Check if discount is valid
    if (!discount.isValid()) {
      const now = new Date();
      if (!discount.isActive) {
        return createErrorResponse('This discount code is no longer active', 400);
      }
      if (discount.startDate && now < discount.startDate) {
        return createErrorResponse('This discount code is not yet active', 400);
      }
      if (discount.endDate && now > discount.endDate) {
        return createErrorResponse('This discount code has expired', 400);
      }
      if (discount.usageLimit && discount.usageCount >= discount.usageLimit) {
        return createErrorResponse('This discount code has reached its usage limit', 400);
      }
      return createErrorResponse('Invalid discount code', 400);
    }

    // Check country restriction
    if (countryCode && discount.applicableCountries && discount.applicableCountries.length > 0) {
      if (!discount.applicableCountries.includes(countryCode)) {
        return createErrorResponse('This discount is not available in your country', 400);
      }
    }

    // Check product restriction
    if (productSkuCode && discount.applicableProducts && discount.applicableProducts.length > 0) {
      if (!discount.applicableProducts.includes(productSkuCode)) {
        return createErrorResponse('This discount is not applicable to the selected product', 400);
      }
    }

    // Check minimum purchase amount
    if (discount.minPurchaseAmount && amount < discount.minPurchaseAmount) {
      return createErrorResponse(
        `Minimum purchase amount of $${discount.minPurchaseAmount.toFixed(2)} required for this discount`,
        400
      );
    }

    // Calculate discount amount
    const discountAmount = discount.calculateDiscount(amount);

    if (discountAmount <= 0) {
      return createErrorResponse('This discount cannot be applied to your purchase', 400);
    }

    logger.info('Validated discount code', {
      orgId,
      code: discount.code,
      amount,
      discountAmount,
    });

    return createSuccessResponse({
      valid: true,
      discount: {
        id: discount._id,
        name: discount.name,
        description: discount.description,
        code: discount.code,
        type: discount.type,
        value: discount.value,
        discountAmount,
        finalAmount: Math.max(0, amount - discountAmount),
      },
    });
  } catch (error) {
    logger.error('Error validating discount code', { error });
    return handleApiError(error);
  }
}
