import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Integration } from '@topupsend/db';
import { createDingConnectService } from '@/lib/services/dingconnect.service';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';

/**
 * GET /api/v1/integrations/providers
 * Fetches all providers from the configured integration (DingConnect/Reloadly)
 * Used to populate the countries page with available countries
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return createErrorResponse('Unauthorized', 401);
    }

    await dbConnection.connect();

    // Get the active integration for DingConnect
    const integration = await Integration.findOne({
      orgId: session.orgId,
      provider: 'dingconnect',
      status: 'active',
    }).select('+credentials.apiKey');

    if (!integration || !integration.credentials?.apiKey) {
      return createErrorResponse(
        'No active DingConnect integration found. Please configure DingConnect first.',
        404
      );
    }

    // Create DingConnect service
    const dingService = createDingConnectService({
      apiKey: integration.credentials.apiKey,
    });

    // Fetch all providers (no filters = all countries)
    const providers = await dingService.getProviders();

    return createSuccessResponse({
      providers,
      count: providers.length,
    });
  } catch (error: any) {
    console.error('Fetch providers error:', error);
    return createErrorResponse(
      `Failed to fetch providers: ${error.message}`,
      500
    );
  }
}
