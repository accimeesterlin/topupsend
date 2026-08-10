import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { Integration, StorefrontSettings, Org } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';
import { createDingConnectService } from '@/lib/services/dingconnect.service';

/**
 * GET /api/v1/debug/test-lookup?orgSlug=xxx&phone=xxx
 * Test phone lookup step by step with detailed logging
 */
export async function GET(request: NextRequest) {
  const steps: any[] = [];

  try {
    const { searchParams } = new URL(request.url);
    const orgSlug = searchParams.get('orgSlug');
    const phoneNumber = searchParams.get('phone') || '+16787654321';

    steps.push({ step: 1, name: 'Parameters', data: { orgSlug, phoneNumber } });

    // Step 1: Connect to DB
    await dbConnection.connect();
    steps.push({ step: 2, name: 'Database connected', success: true });

    // Step 2: Find organization
    const org = await Org.findOne({ slug: orgSlug });
    steps.push({
      step: 3,
      name: 'Find organization',
      success: !!org,
      orgId: org?._id?.toString(),
      orgName: org?.name,
      hasSlug: !!org?.slug,
    });

    if (!org) {
      return createSuccessResponse({ steps, error: 'Organization not found' });
    }

    const orgId = org._id.toString();

    // Step 3: Find storefront settings
    const storefront = await StorefrontSettings.findOne({ orgId });
    steps.push({
      step: 4,
      name: 'Find storefront settings',
      success: !!storefront,
      isActive: storefront?.isActive,
      hasSettings: !!storefront,
    });

    if (!storefront) {
      return createSuccessResponse({ steps, error: 'Storefront not found' });
    }

    // Step 4: Find integration
    const integration = await Integration.findOne({
      orgId,
      provider: 'dingconnect',
      status: 'active',
    }).select('+credentials.apiKey');

    steps.push({
      step: 5,
      name: 'Find DingConnect integration',
      success: !!integration,
      hasApiKey: !!integration?.credentials?.apiKey,
      apiKeyLength: integration?.credentials?.apiKey?.length || 0,
    });

    if (!integration || !integration.credentials?.apiKey) {
      return createSuccessResponse({ steps, error: 'DingConnect integration not configured' });
    }

    // Step 5: Test DingConnect connection
    const dingService = createDingConnectService(integration.credentials as any);

    try {
      const balance = await dingService.getBalance();
      steps.push({
        step: 6,
        name: 'Test DingConnect connection',
        success: true,
        balance: balance.AccountBalance,
        currency: balance.CurrencyCode,
      });
    } catch (error: any) {
      steps.push({
        step: 6,
        name: 'Test DingConnect connection',
        success: false,
        error: error.message,
      });
      return createSuccessResponse({ steps, error: `DingConnect connection failed: ${error.message}` });
    }

    // Step 6: Detect country from phone
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const countryPatterns: { [key: string]: { code: string; name: string } } = {
      '1': { code: 'US', name: 'United States' },
      '44': { code: 'GB', name: 'United Kingdom' },
      '675': { code: 'PG', name: 'Papua New Guinea' },
      '509': { code: 'HT', name: 'Haiti' },
      '1876': { code: 'JM', name: 'Jamaica' },
    };

    let detectedCountry = '';
    const sortedPatterns = Object.entries(countryPatterns).sort(
      (a, b) => b[0].length - a[0].length
    );

    for (const [code, info] of sortedPatterns) {
      if (cleanPhone.startsWith(code)) {
        detectedCountry = info.code;
        break;
      }
    }

    steps.push({
      step: 7,
      name: 'Detect country from phone',
      success: !!detectedCountry,
      cleanPhone,
      detectedCountry,
    });

    if (!detectedCountry) {
      return createSuccessResponse({ steps, error: 'Could not detect country from phone number' });
    }

    // Step 7: Check if country is enabled
    const isCountryEnabled = storefront.isCountryEnabled(detectedCountry);
    steps.push({
      step: 8,
      name: 'Check if country is enabled',
      success: isCountryEnabled,
      detectedCountry,
      allEnabled: storefront.countries.allEnabled,
      enabledCountries: storefront.countries.enabled,
      disabledCountries: storefront.countries.disabled,
    });

    if (!isCountryEnabled) {
      return createSuccessResponse({ steps, error: 'Country not enabled in storefront' });
    }

    // Step 8: Fetch providers
    try {
      const providers = await dingService.getProviders({ countryIso: detectedCountry });
      steps.push({
        step: 9,
        name: 'Fetch providers from DingConnect',
        success: true,
        providersType: typeof providers,
        providersIsArray: Array.isArray(providers),
        providersValue: providers,
        providersCount: Array.isArray(providers) ? providers.length : 'N/A',
        providerNames: Array.isArray(providers) ? providers.map((p) => p.ProviderName) : 'Not an array',
      });
    } catch (error: any) {
      steps.push({
        step: 9,
        name: 'Fetch providers from DingConnect',
        success: false,
        error: error.message,
      });
      return createSuccessResponse({ steps, error: `Failed to fetch providers: ${error.message}` });
    }

    // Step 9: Fetch products
    try {
      const products = await dingService.getProducts({ countryIso: detectedCountry });
      steps.push({
        step: 10,
        name: 'Fetch products from DingConnect',
        success: true,
        productsType: typeof products,
        productsIsArray: Array.isArray(products),
        productsCount: Array.isArray(products) ? products.length : 'N/A',
        firstProduct: products && Array.isArray(products) && products.length > 0 ? products[0] : null,
        sampleProduct: products && Array.isArray(products) && products[0] ? {
          name: products[0].DefaultDisplayText,
          hasPrice: !!products[0].Price,
          price: products[0].Price?.Amount,
          currency: products[0].Price?.CurrencyCode,
        } : null,
      });
    } catch (error: any) {
      steps.push({
        step: 10,
        name: 'Fetch products from DingConnect',
        success: false,
        error: error.message,
        stack: error.stack,
      });
      return createSuccessResponse({ steps, error: `Failed to fetch products: ${error.message}` });
    }

    return createSuccessResponse({
      message: 'All steps completed successfully!',
      steps,
    });
  } catch (error: any) {
    return createSuccessResponse({
      steps,
      error: error.message,
      stack: error.stack,
    }, 500);
  }
}
