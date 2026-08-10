import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { PaymentProvider, Org, Organization } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/storefront/payment-methods?orgSlug=xxx
 * Get active payment methods for an organization's storefront
 * Public endpoint - no auth required
 */
export async function GET(request: NextRequest) {
  try {
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const orgSlug = searchParams.get('orgSlug');

    logger.info('Payment methods request', { orgSlug });

    if (!orgSlug) {
      return createErrorResponse('Organization slug is required', 400);
    }

    // Look up organization by slug
    const org = await Org.findOne({ slug: orgSlug });
    const organization = await Organization.findOne({ slug: orgSlug });
    const orgId = org?._id?.toString() || organization?._id?.toString();

    if (!orgId) {
      logger.error('Organization not found', { orgSlug });
      return createErrorResponse('Organization not found', 404);
    }

    // Get payment providers for this organization (active and inactive)
    // We include inactive providers that are configured so merchants know they need to test them
    const paymentProviders = await PaymentProvider.find({
      orgId,
      status: { $in: ['active', 'inactive'] }, // Exclude only 'error' status
    }).select('provider environment status settings.acceptedCurrencies settings.minAmount settings.maxAmount settings.feePercentage settings.fixedFee');

    logger.info('Payment providers found', {
      orgId,
      count: paymentProviders.length,
      providers: paymentProviders.map(p => ({
        provider: p.provider,
        status: p.status,
        feePercentage: p.settings?.feePercentage,
        fixedFee: p.settings?.fixedFee,
        settings: p.settings,
      })),
    });

    // Filter to only active providers for customer-facing
    const activeProviders = paymentProviders.filter(p => p.status === 'active');

    // Map to public-facing format (don't expose credentials)
    const availableMethods = activeProviders.map(p => ({
      provider: p.provider,
      environment: p.environment,
      acceptedCurrencies: p.settings.acceptedCurrencies,
      minAmount: p.settings.minAmount,
      maxAmount: p.settings.maxAmount,
      feePercentage: p.settings.feePercentage || 0,
      fixedFee: p.settings.fixedFee || 0,
    }));

    // Check if there are any configured but not active providers
    const inactiveProviders = paymentProviders.filter(p => p.status === 'inactive');

    return createSuccessResponse({
      available: availableMethods.length > 0,
      methods: availableMethods,
      inactiveCount: inactiveProviders.length,
      message: inactiveProviders.length > 0
        ? `${inactiveProviders.length} payment method(s) configured but not yet tested. Test them in dashboard to activate.`
        : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Error fetching payment methods', {
      error: errorMessage,
      stack: errorStack,
    });
    return handleApiError(error);
  }
}
