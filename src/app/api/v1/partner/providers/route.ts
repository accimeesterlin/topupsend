/**
 * Partner API — DingConnect providers
 * GET /api/v1/partner/providers
 *
 * Server-to-server equivalent of GET /api/v1/integrations/providers
 * (which requires a staff session). Authenticated with an API key
 * (scope `topup:send`); providers are fetched through the key's
 * organization's DingConnect integration, in the same response shape.
 */

import { NextRequest } from "next/server";
import { dbConnection, Integration } from "@topupsend/db";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-response";
import { ApiException, handleApiError } from "@/lib/api-error";
import { requirePartnerApiKey } from "@/lib/auth-middleware";
import { createDingConnectService } from "@/lib/services/dingconnect.service";

export async function GET(request: NextRequest) {
  try {
    await dbConnection.connect();

    const { orgId } = await requirePartnerApiKey(request, "topup:send");

    // Get the active DingConnect integration for the key's org
    const integration = await Integration.findOne({
      orgId,
      provider: "dingconnect",
      status: "active",
    }).select("+credentials.apiKey");

    if (!integration || !integration.credentials?.apiKey) {
      return createErrorResponse(
        "No active DingConnect integration found. Please configure DingConnect first.",
        404,
      );
    }

    const dingService = createDingConnectService({
      apiKey: integration.credentials.apiKey,
    });

    // Fetch all providers (no filters = all countries)
    const providers = await dingService.getProviders();

    return createSuccessResponse({
      providers,
      count: providers.length,
    });
  } catch (error) {
    // requireApiKey throws a raw Response for rate-limit breaches.
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof Error && !(error instanceof ApiException)) {
      return createErrorResponse(
        `Failed to fetch providers: ${error.message}`,
        500,
      );
    }
    return handleApiError(error);
  }
}
