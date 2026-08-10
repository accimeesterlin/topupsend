import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { Integration, Org, Organization } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { createDingConnectService } from '@/lib/services/dingconnect.service';

interface EstimateRequest {
  orgSlug: string;
  skuCode: string;
  sendValue: number;
  sendCurrencyIso?: string;
}

/**
 * POST /api/v1/estimate
 * Estimate prices for a product with custom amount
 * Public endpoint - no auth required
 */
export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body: EstimateRequest = await request.json();
    const { orgSlug, skuCode, sendValue, sendCurrencyIso = 'USD' } = body;

    logger.info('Price estimate request', { orgSlug, skuCode, sendValue });

    if (!orgSlug) {
      return createErrorResponse('Organization slug is required', 400);
    }

    if (!skuCode) {
      return createErrorResponse('Product SKU code is required', 400);
    }

    if (!sendValue || sendValue <= 0) {
      return createErrorResponse('Send value must be greater than 0', 400);
    }

    // Look up organization by slug
    const org = await Org.findOne({ slug: orgSlug });
    const organization = await Organization.findOne({ slug: orgSlug });
    const orgId = org?._id?.toString() || organization?._id?.toString();

    if (!orgId) {
      logger.error('Organization not found', { orgSlug });
      return createErrorResponse('Organization not found', 404);
    }

    // Get active DingConnect integration
    const integration = await Integration.findOne({
      orgId,
      provider: 'dingconnect',
      status: 'active',
    }).select('+credentials.apiKey');

    if (!integration || !integration.credentials?.apiKey) {
      logger.error('DingConnect integration not found', { orgId });
      return createErrorResponse('Service integration not configured', 500);
    }

    // Use DingConnect API to estimate prices
    const dingService = createDingConnectService(integration.credentials as any);

    try {
      logger.info('Calling DingConnect estimatePrices', {
        skuCode,
        sendValue,
        sendCurrencyIso,
      });

      const estimates = await dingService.estimatePrices([
        {
          SkuCode: skuCode,
          SendValue: sendValue,
          SendCurrencyIso: sendCurrencyIso,
          ReceiveValue: 0,
          BatchItemRef: skuCode,
        },
      ]);

      logger.info('DingConnect raw response', { estimates: JSON.stringify(estimates) });

      if (!estimates || estimates.length === 0) {
        logger.error('No estimate returned from DingConnect', { skuCode, sendValue });
        return createErrorResponse('Failed to estimate price', 500);
      }

      const estimate = estimates[0];

      // DingConnect returns estimate data inside a Price object
      const priceData = estimate.Price || estimate;

      // Check if DingConnect returned zeros (invalid SKU or parameters)
      if (priceData.ReceiveValue === 0 && priceData.SendValue === 0) {
        logger.error('DingConnect returned zero values', {
          skuCode,
          sendValue,
          estimate: JSON.stringify(estimate),
        });
        return createErrorResponse(
          'Unable to estimate price for this product. The product may not support custom amounts.',
          400
        );
      }

      logger.info('Price estimate successful', {
        orgSlug,
        skuCode,
        sendValue: priceData.SendValue,
        receiveValue: priceData.ReceiveValue,
        receiveCurrency: priceData.ReceiveCurrencyIso,
        rawEstimate: JSON.stringify(estimate),
      });

      // Ensure numeric values are properly formatted
      const responseData = {
        skuCode: estimate.SkuCode,
        sendValue: Number(priceData.SendValue) || 0,
        sendCurrency: priceData.SendCurrencyIso || 'USD',
        receiveValue: Number(priceData.ReceiveValue) || 0,
        receiveCurrency: priceData.ReceiveCurrencyIso || '',
        fee: Number((priceData as any).CustomerFee || (priceData as any).DistributorFee || (priceData as any).Fee) || 0,
        taxRate: Number((priceData as any).TaxRate) || 0,
      };

      logger.info('Sending estimate response', { responseData: JSON.stringify(responseData) });

      return createSuccessResponse(responseData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('DingConnect estimate failed', {
        error: errorMessage,
        skuCode,
        sendValue,
      });
      return createErrorResponse(`Failed to estimate price: ${errorMessage}`, 500);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Error in price estimate', {
      error: errorMessage,
      stack: errorStack,
    });
    return handleApiError(error);
  }
}
