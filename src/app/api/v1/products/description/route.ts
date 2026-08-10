import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { Integration, Org, Organization } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { createDingConnectService } from '@/lib/services/dingconnect.service';

/**
 * GET /api/v1/products/description?skuCode=XXX&orgSlug=YYY&lang=en
 * Fetch localized product description from DingConnect
 * Public endpoint - no auth required (used by storefront)
 */
export async function GET(request: NextRequest) {
  try {
    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const skuCode = searchParams.get('skuCode');
    const orgSlug = searchParams.get('orgSlug');
    const lang = searchParams.get('lang') || 'en';

    if (!skuCode) {
      return createErrorResponse('Product SKU code is required', 400);
    }

    if (!orgSlug) {
      return createErrorResponse('Organization slug is required', 400);
    }

    // Look up organization by slug
    const org = await Org.findOne({ slug: orgSlug });
    const organization = await Organization.findOne({ slug: orgSlug });
    const orgId = org?._id?.toString() || organization?._id?.toString();

    if (!orgId) {
      return createErrorResponse('Organization not found', 404);
    }

    // Get active DingConnect integration
    const integration = await Integration.findOne({
      orgId,
      provider: 'dingconnect',
      status: 'active',
    }).select('+credentials.apiKey');

    if (!integration || !integration.credentials?.apiKey) {
      return createErrorResponse('Service integration not configured', 500);
    }

    const dingService = createDingConnectService(integration.credentials as { apiKey: string });

    const descriptions = await dingService.getProductDescriptions({
      skuCodes: [skuCode],
      languageCodes: [lang],
    });

    if (!descriptions || descriptions.length === 0) {
      return createSuccessResponse({ description: null });
    }

    const desc = descriptions[0];

    return createSuccessResponse({
      description: desc.DescriptionMarkdown || desc.DisplayText || null,
      displayText: desc.DisplayText || null,
      readMore: desc.ReadMoreMarkdown || null,
    });
  } catch (error) {
    logger.error('Error fetching product description', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return handleApiError(error);
  }
}
