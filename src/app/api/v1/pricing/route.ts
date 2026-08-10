import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { PricingRule } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/v1/pricing
 * Get all pricing rules for the organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);

    await dbConnection.connect();

    const pricingRules = await PricingRule.find({ orgId: session.orgId }).sort({ priority: -1, createdAt: -1 });

    logger.info('Fetched pricing rules', {
      orgId: session.orgId,
      count: pricingRules.length,
    });

    return createSuccessResponse({ pricingRules });
  } catch (error) {
    logger.error('Error fetching pricing rules', { error });
    return handleApiError(error);
  }
}

/**
 * POST /api/v1/pricing
 * Create a new pricing rule
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);

    await dbConnection.connect();

    const body = await request.json();
    const {
      name,
      description,
      percentageMarkup,
      fixedMarkup,
      // Legacy fields
      type,
      value,
      priority,
      isActive,
      applicableCountries,
      applicableRegions,
      excludedCountries,
      minTransactionAmount,
      maxTransactionAmount,
    } = body;

    // Validation
    if (!name || !name.trim()) {
      return createErrorResponse('Pricing rule name is required', 400);
    }

    // Parse and validate pricing values
    const percentageValue = percentageMarkup !== undefined && percentageMarkup !== null && percentageMarkup !== ''
      ? parseFloat(percentageMarkup.toString())
      : 0;
    const fixedValue = fixedMarkup !== undefined && fixedMarkup !== null && fixedMarkup !== ''
      ? parseFloat(fixedMarkup.toString())
      : 0;

    // Check if using new format (percentageMarkup/fixedMarkup) or legacy format (type/value)
    const hasNewFormat = percentageValue > 0 || fixedValue > 0;
    const hasLegacyFormat = type !== undefined && value !== undefined;

    if (!hasNewFormat && !hasLegacyFormat) {
      return createErrorResponse('At least one pricing value (percentage or fixed markup) must be provided and greater than 0', 400);
    }

    // Validate new format
    if (hasNewFormat) {
      if (percentageValue < 0 || fixedValue < 0) {
        return createErrorResponse('Pricing values must be positive numbers', 400);
      }
    }

    // Validate legacy format
    if (hasLegacyFormat && !hasNewFormat) {
      if (!type || !['percentage', 'fixed'].includes(type)) {
        return createErrorResponse('Invalid pricing type. Must be percentage or fixed', 400);
      }

      if (value === undefined || value === null || value < 0) {
        return createErrorResponse('Pricing value must be a positive number', 400);
      }
    }

    // Build pricing rule data
    const pricingRuleData: any = {
      orgId: session.orgId,
      name: name.trim(),
      description: description?.trim() || '',
      priority: priority !== undefined ? priority : 0,
      isActive: isActive !== undefined ? isActive : true,
      applicableCountries: applicableCountries || [],
      applicableRegions: applicableRegions || [],
      excludedCountries: excludedCountries || [],
      minTransactionAmount: minTransactionAmount || null,
      maxTransactionAmount: maxTransactionAmount || null,
    };

    // Add new format fields if provided
    if (hasNewFormat) {
      if (percentageValue > 0) {
        pricingRuleData.percentageMarkup = percentageValue;
      }
      if (fixedValue > 0) {
        pricingRuleData.fixedMarkup = fixedValue;
      }
    } else if (hasLegacyFormat) {
      // Use legacy format
      pricingRuleData.type = type;
      pricingRuleData.value = value;
    }

    // Create pricing rule
    const pricingRule = await PricingRule.create(pricingRuleData);

    logger.info('Created pricing rule', {
      orgId: session.orgId,
      pricingRuleId: pricingRule._id,
      name: pricingRule.name,
    });

    return createSuccessResponse({ pricingRule }, 201);
  } catch (error) {
    logger.error('Error creating pricing rule', { error });
    return handleApiError(error);
  }
}
