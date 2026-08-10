import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { Integration } from "@topupsend/db";
import { createSuccessResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { DingConnectService } from "@/lib/services/dingconnect.service";

/**
 * GET /api/v1/debug/dingconnect-creds
 * Debug endpoint to check DingConnect integration credentials and test API connection
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const integration = await Integration.findOne({
      orgId: session.orgId,
      provider: "dingconnect",
      status: "active",
    }).select("+credentials.apiKey +credentials.baseUrl");

    if (!integration) {
      return createSuccessResponse({
        found: false,
        message:
          "No active DingConnect integration found for this organization",
      });
    }

    const hasApiKey = !!integration.credentials?.apiKey;
    const apiKeyLength = integration.credentials?.apiKey?.length || 0;
    const apiKeyPreview = integration.credentials?.apiKey
      ? `${integration.credentials.apiKey.substring(0, 8)}...${integration.credentials.apiKey.substring(integration.credentials.apiKey.length - 4)}`
      : "N/A";

    let connectionTest: any = {
      attempted: false,
    };

    // Only test connection if API key exists
    if (hasApiKey && integration.credentials.apiKey) {
      try {
        const dingService = new DingConnectService({
          apiKey: integration.credentials.apiKey,
          baseUrl:
            integration.credentials.baseUrl || "https://api.dingconnect.com",
        });

        const balance = await dingService.getBalance();
        connectionTest = {
          attempted: true,
          success: true,
          balance: balance.AccountBalance,
          currency: balance.CurrencyCode,
        };
      } catch (error: any) {
        connectionTest = {
          attempted: true,
          success: false,
          error: error.message,
        };
      }
    }

    return createSuccessResponse({
      found: true,
      integration: {
        id: String(integration._id),
        provider: integration.provider,
        status: integration.status,
        environment: integration.environment,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
      },
      credentials: {
        hasApiKey,
        apiKeyLength,
        apiKeyPreview,
        baseUrl:
          integration.credentials.baseUrl || "https://api.dingconnect.com",
      },
      metadata: {
        lastSync: integration.metadata.lastSync,
        lastTestSuccess: integration.metadata.lastTestSuccess,
        lastTestError: integration.metadata.lastTestError,
        accountBalance: integration.metadata.accountBalance,
        accountCurrency: integration.metadata.accountCurrency,
      },
      connectionTest,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
