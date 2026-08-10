import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { PaymentProvider } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/payment-providers/[id]
 * Get a specific payment provider
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);
    await dbConnection.connect();

    const provider = await PaymentProvider.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!provider) {
      return createErrorResponse('Payment provider not found', 404);
    }

    // Return with credentials for editing (only for owner)
    return createSuccessResponse({ provider });
  } catch (error) {
    logger.error('Error fetching payment provider', { error });
    return handleApiError(error);
  }
}

/**
 * PATCH /api/v1/payment-providers/[id]
 * Update a payment provider
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);
    await dbConnection.connect();

    const provider = await PaymentProvider.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!provider) {
      return createErrorResponse('Payment provider not found', 404);
    }

    const body = await request.json();

    // Update fields
    if (body.environment && ['sandbox', 'production'].includes(body.environment)) {
      provider.environment = body.environment;
    }

    if (body.credentials && typeof body.credentials === 'object') {
      provider.credentials = { ...provider.credentials, ...body.credentials };
      // Reset status when credentials change
      provider.status = 'inactive';
    }

    if (body.settings && typeof body.settings === 'object') {
      provider.settings = { ...provider.settings, ...body.settings };
    }

    if (body.status && ['active', 'inactive', 'error'].includes(body.status)) {
      provider.status = body.status;
    }

    await provider.save();

    logger.info('Updated payment provider', {
      orgId: session.orgId,
      providerId: id,
      provider: provider.provider,
    });

    // Return sanitized response
    return createSuccessResponse({
      provider: {
        _id: provider._id,
        provider: provider.provider,
        status: provider.status,
        environment: provider.environment,
        settings: provider.settings,
        metadata: provider.metadata,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Error updating payment provider', { error });
    return handleApiError(error);
  }
}

/**
 * DELETE /api/v1/payment-providers/[id]
 * Delete a payment provider
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);
    await dbConnection.connect();

    const provider = await PaymentProvider.findOneAndDelete({
      _id: id,
      orgId: session.orgId,
    });

    if (!provider) {
      return createErrorResponse('Payment provider not found', 404);
    }

    logger.info('Deleted payment provider', {
      orgId: session.orgId,
      providerId: id,
      provider: provider.provider,
    });

    return createSuccessResponse({ message: 'Payment provider deleted successfully' });
  } catch (error) {
    logger.error('Error deleting payment provider', { error });
    return handleApiError(error);
  }
}
