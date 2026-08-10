import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { Integration } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { createDingConnectService } from '@/lib/services/dingconnect.service';

/**
 * GET /api/v1/products/available
 * Fetch available products from DingConnect or Reloadly
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') || 'dingconnect';
    const countryIso = searchParams.get('countryIso');
    const providerCode = searchParams.get('providerCode');

    if (!['dingconnect', 'reloadly'].includes(provider)) {
      return createErrorResponse('Invalid provider. Must be "dingconnect" or "reloadly"', 400);
    }

    // Get integration for this provider
    const integration = await Integration.findOne({
      orgId: session.orgId,
      provider,
      status: 'active',
    }).select('+credentials.apiKey +credentials.clientId +credentials.clientSecret');

    if (!integration) {
      return createErrorResponse(
        `${provider} integration not configured or not active`,
        400
      );
    }

    let products: any[] = [];

    if (provider === 'dingconnect') {
      try {
        const dingService = createDingConnectService(integration.credentials as any);

        // Build filters
        const filters: any = {};
        if (countryIso) filters.countryIso = countryIso;
        if (providerCode) filters.providerCode = providerCode;

        // Fetch products
        const dingProducts = await dingService.getProducts(filters);

        // Also fetch providers for metadata
        const providers = await dingService.getProviders(filters);
        const providerMap = new Map(providers.map((p) => [p.ProviderCode, p]));

        // Transform to simplified format
        products = dingProducts.map((p) => {
          const providerInfo = providerMap.get(p.ProviderCode);
          const isAirtime = !!p.BenefitTypes?.Airtime;
          const isData = !!p.BenefitTypes?.Data;

          let denominationAmount = 0;
          let denominationUnit = '';

          if (isAirtime && p.BenefitTypes?.Airtime) {
            denominationAmount = p.BenefitTypes.Airtime.Amount || 0;
            denominationUnit = p.BenefitTypes.Airtime.CurrencyCode || '';
          } else if (isData && p.BenefitTypes?.Data) {
            denominationAmount = p.BenefitTypes.Data.Amount || 0;
            denominationUnit = p.BenefitTypes.Data.Unit || '';
          }

          return {
            skuCode: p.SkuCode,
            productId: p.ProductId,
            providerCode: p.ProviderCode,
            providerName: providerInfo?.ProviderName || p.ProviderCode,
            countryIso: p.CountryIso,
            regionCode: p.RegionCode,
            name: p.DefaultDisplayText,
            type: isAirtime ? 'airtime' : 'data',
            benefitAmount: denominationAmount,
            benefitUnit: denominationUnit,
            costPrice: p.Price?.Amount || 0,
            costCurrency: p.Price?.CurrencyCode || 'USD',
            receiveValue: p.ReceiveValue?.Amount || 0,
            receiveCurrency: p.ReceiveValue?.CurrencyCode || 'USD',
            validityPeriod: p.ValidityPeriodIso || '',
            logo: providerInfo?.LogoUrl || '',
          };
        });

        logger.info(`Fetched ${products.length} products from DingConnect`, {
          orgId: session.orgId,
          filters,
        });
      } catch (error: any) {
        logger.error('Error fetching DingConnect products', { error });
        return createErrorResponse(`Failed to fetch products: ${error.message}`, 500);
      }
    } else if (provider === 'reloadly') {
      // TODO: Implement Reloadly
      return createErrorResponse('Reloadly not yet implemented', 501);
    }

    return createSuccessResponse({
      products,
      count: products.length,
      provider,
    });
  } catch (error) {
    logger.error('Error fetching available products', { error });
    return handleApiError(error);
  }
}
