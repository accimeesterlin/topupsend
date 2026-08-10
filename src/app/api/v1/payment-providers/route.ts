import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { PaymentProvider } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/payment-providers
 * Get all payment providers for current organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const providers = await PaymentProvider.find({ orgId: session.orgId }).sort({ createdAt: -1 });

    logger.info('Fetched payment providers', {
      orgId: session.orgId,
      count: providers.length,
    });

    // Don't expose sensitive credentials in the list
    const sanitizedProviders = providers.map((p) => ({
      _id: p._id,
      provider: p.provider,
      status: p.status,
      environment: p.environment,
      settings: p.settings,
      metadata: p.metadata,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      // Only indicate if credentials exist, don't send the actual values
      hasCredentials: !!(p.credentials && Object.keys(p.credentials).length > 0),
    }));

    return createSuccessResponse({ providers: sanitizedProviders });
  } catch (error) {
    logger.error('Error fetching payment providers', { error });
    return handleApiError(error);
  }
}

/**
 * POST /api/v1/payment-providers
 * Create or update a payment provider configuration
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const body = await request.json();
    const { provider, environment, credentials, settings } = body;

    // Validation
    if (!provider || !['stripe', 'paypal', 'pgpay'].includes(provider)) {
      return createErrorResponse('Invalid provider. Must be stripe, paypal, or pgpay', 400);
    }

    if (!environment || !['sandbox', 'production'].includes(environment)) {
      return createErrorResponse('Invalid environment. Must be sandbox or production', 400);
    }

    if (!credentials || typeof credentials !== 'object') {
      return createErrorResponse('Credentials are required', 400);
    }

    // Provider-specific validation
    if (provider === 'stripe') {
      if (!credentials.secretKey) {
        return createErrorResponse('Stripe Secret Key is required', 400);
      }
      if (!credentials.publishableKey) {
        return createErrorResponse('Stripe Publishable Key is required', 400);
      }
    } else if (provider === 'paypal') {
      if (!credentials.clientId) {
        return createErrorResponse('PayPal Client ID is required', 400);
      }
      if (!credentials.clientSecret) {
        return createErrorResponse('PayPal Client Secret is required', 400);
      }
    } else if (provider === 'pgpay') {
      if (!credentials.userId) {
        return createErrorResponse('PGPay User ID is required', 400);
      }
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(credentials.userId)) {
        return createErrorResponse('PGPay User ID must be a valid UUID format', 400);
      }
    }

    // Check if provider already exists for this org
    let paymentProvider = await PaymentProvider.findOne({
      orgId: session.orgId,
      provider,
    });

    if (paymentProvider) {
      // Update existing
      paymentProvider.environment = environment;
      paymentProvider.credentials = credentials;
      if (settings) {
        paymentProvider.settings = { ...paymentProvider.settings, ...settings };
      }
      paymentProvider.status = 'inactive'; // Set to inactive until tested
      await paymentProvider.save();

      logger.info('Updated payment provider', {
        orgId: session.orgId,
        provider,
        environment,
      });
    } else {
      // Create new
      paymentProvider = await PaymentProvider.create({
        orgId: session.orgId,
        provider,
        environment,
        credentials,
        status: 'inactive',
        settings: settings || {
          acceptedCurrencies: ['USD'],
          autoCapture: true,
        },
      });

      logger.info('Created payment provider', {
        orgId: session.orgId,
        provider,
        environment,
      });
    }

    // Return sanitized response (without credentials)
    return createSuccessResponse({
      provider: {
        _id: paymentProvider._id,
        provider: paymentProvider.provider,
        status: paymentProvider.status,
        environment: paymentProvider.environment,
        settings: paymentProvider.settings,
        metadata: paymentProvider.metadata,
        createdAt: paymentProvider.createdAt,
        updatedAt: paymentProvider.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Error creating/updating payment provider', { error });
    return handleApiError(error);
  }
}
