import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { Integration, Product } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { createDingConnectService } from '@/lib/services/dingconnect.service';

/**
 * POST /api/v1/products/sync
 * Sync products from DingConnect or Reloadly
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const body = await request.json();
    const { provider, filters } = body;

    if (!provider || !['dingconnect', 'reloadly'].includes(provider)) {
      return createErrorResponse('Invalid provider. Must be "dingconnect" or "reloadly"', 400);
    }

    // Get integration for this provider
    const integration = await Integration.findOne({
      orgId: session.orgId,
      provider,
      status: 'active',
    });

    if (!integration) {
      return createErrorResponse(
        `${provider} integration not configured or not active`,
        400
      );
    }

    let syncedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    if (provider === 'dingconnect') {
      try {
        const dingService = createDingConnectService(integration.credentials as any);

        // Get products from DingConnect
        const products = await dingService.getProducts(filters);
        logger.info(`Fetched ${products.length} products from DingConnect`, {
          orgId: session.orgId,
        });

        // Get providers/operators for additional info
        const providers = await dingService.getProviders(filters);
        const providerMap = new Map(
          providers.map((p) => [p.ProviderCode, p])
        );

        // Process each product
        for (const dingProduct of products) {
          try {
            const providerInfo = providerMap.get(dingProduct.ProviderCode);

            // Determine product details
            const isMobileData = !!dingProduct.BenefitTypes?.Data;
            const isAirtime = !!dingProduct.BenefitTypes?.Airtime;

            const denominationType: 'fixed' | 'range' = 'fixed';
            let denominationAmount = 0;
            let denominationUnit = '';

            if (isAirtime && dingProduct.BenefitTypes?.Airtime) {
              denominationAmount = dingProduct.BenefitTypes.Airtime.Amount || 0;
              denominationUnit = dingProduct.BenefitTypes.Airtime.CurrencyCode || '';
            } else if (isMobileData && dingProduct.BenefitTypes?.Data) {
              denominationAmount = dingProduct.BenefitTypes.Data.Amount || 0;
              denominationUnit = dingProduct.BenefitTypes.Data.Unit || '';
            }

            const costPrice = dingProduct.Price?.Amount || 0;
            const suggestedSellPrice = costPrice * 1.1; // 10% markup by default

            // Check if product already exists
            const existingProduct = await Product.findOne({
              orgId: session.orgId,
              provider: 'dingconnect',
              providerProductId: dingProduct.SkuCode,
            });

            if (existingProduct) {
              // Update existing product
              existingProduct.pricing.costPrice = costPrice;
              existingProduct.operatorName = providerInfo?.ProviderName || dingProduct.ProviderCode;
              existingProduct.operatorCountry = dingProduct.CountryIso;
              existingProduct.denomination = {
                type: denominationType,
                fixedAmount: denominationAmount,
                unit: denominationUnit,
              };
              existingProduct.sync.lastSyncAt = new Date();
              existingProduct.sync.lastSyncStatus = 'success';

              await existingProduct.save();
              updatedCount++;
            } else {
              // Create new product
              await Product.create({
                orgId: session.orgId,
                name: dingProduct.DefaultDisplayText || `${providerInfo?.ProviderName || dingProduct.ProviderCode} ${denominationAmount}${denominationUnit}`,
                description: `${isAirtime ? 'Airtime' : 'Data'} top-up for ${providerInfo?.ProviderName || dingProduct.ProviderCode}`,
                provider: 'dingconnect',
                providerProductId: dingProduct.SkuCode,
                operatorId: dingProduct.ProviderCode,
                operatorName: providerInfo?.ProviderName || dingProduct.ProviderCode,
                operatorCountry: dingProduct.CountryIso,
                operatorLogo: providerInfo?.LogoUrl,
                pricing: {
                  costPrice,
                  sellPrice: suggestedSellPrice,
                  currency: dingProduct.Price?.CurrencyCode || 'USD',
                  profitMargin: 10,
                },
                denomination: {
                  type: denominationType,
                  fixedAmount: denominationAmount,
                  unit: denominationUnit,
                },
                resaleSettings: {
                  allowedCountries: [],
                  blockedCountries: [],
                  customPricing: {
                    enabled: false,
                  },
                  discount: {
                    enabled: false,
                  },
                  limits: {},
                },
                sync: {
                  autoSync: true,
                  lastSyncAt: new Date(),
                  syncFrequency: 1440, // Daily
                  lastSyncStatus: 'success',
                },
                status: 'active',
                metadata: {
                  category: isAirtime ? 'airtime' : 'data',
                  tags: [isMobileData ? 'data' : 'voice', dingProduct.CountryIso],
                },
              });
              syncedCount++;
            }
          } catch (error: any) {
            logger.error('Error processing product', { error, sku: dingProduct.SkuCode });
            errors.push(`${dingProduct.SkuCode}: ${error.message}`);
          }
        }
      } catch (error: any) {
        logger.error('Error syncing from DingConnect', { error });
        return createErrorResponse(`Failed to sync products: ${error.message}`, 500);
      }
    } else if (provider === 'reloadly') {
      // TODO: Implement Reloadly sync
      return createErrorResponse('Reloadly sync not yet implemented', 501);
    }

    logger.info('Product sync completed', {
      orgId: session.orgId,
      provider,
      syncedCount,
      updatedCount,
      errorCount: errors.length,
    });

    return createSuccessResponse({
      synced: syncedCount,
      updated: updatedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully synced ${syncedCount} new products and updated ${updatedCount} existing products`,
    });
  } catch (error) {
    logger.error('Error in product sync', { error });
    return handleApiError(error);
  }
}
