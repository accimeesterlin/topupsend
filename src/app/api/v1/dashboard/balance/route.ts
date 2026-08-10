import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { Integration } from "@topupsend/db";
import { DingConnectService } from "@/lib/services/dingconnect.service";
import { ReloadlyService } from "@/lib/services/reloadly.service";
import { logger } from "@/lib/logger";

// Parse provider errors into user-friendly messages
function getUserFriendlyError(error: any, provider: string): string {
  const errorStr = error?.message || String(error);

  // Check for authentication errors
  if (
    errorStr.includes("401") ||
    errorStr.includes("Unauthorized") ||
    errorStr.includes("AuthenticationFailed")
  ) {
    return `Your ${provider === "dingconnect" ? "DingConnect" : "Reloadly"} API credentials need to be updated. Please check your integration settings.`;
  }

  // Check for network/timeout errors
  if (
    errorStr.includes("timeout") ||
    errorStr.includes("ECONNREFUSED") ||
    errorStr.includes("ETIMEDOUT")
  ) {
    return "Unable to connect to the provider. Please try again in a moment.";
  }

  // Check for rate limiting
  if (errorStr.includes("429") || errorStr.includes("rate limit")) {
    return "Too many requests. Please wait a moment and try again.";
  }

  // Check for insufficient balance/permissions
  if (errorStr.includes("403") || errorStr.includes("Forbidden")) {
    return "Access denied. Please verify your API key permissions.";
  }

  // Generic error
  return "Unable to fetch balance at the moment. Using cached data.";
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnection.connect();

    // Find active provider integration (DingConnect or Reloadly)
    const integration = await Integration.findOne({
      orgId: session.orgId,
      provider: { $in: ["dingconnect", "reloadly"] },
      status: "active",
    }).select(
      "+credentials.apiKey +credentials.apiSecret +credentials.clientId +credentials.clientSecret",
    );

    if (!integration) {
      return NextResponse.json({
        provider: null,
        balance: null,
        currency: null,
        message: "No active provider integration found",
      });
    }

    let balance = null;
    let currency = null;
    let error = null;

    try {
      if (integration.provider === "dingconnect") {
        const dingService = new DingConnectService({
          apiKey: integration.credentials.apiKey!,
          baseUrl:
            integration.credentials.baseUrl || "https://api.dingconnect.com",
        });

        const balanceData = await dingService.getBalance();
        balance = balanceData.AccountBalance;
        currency = balanceData.CurrencyCode;

        // Update integration metadata with latest balance
        integration.metadata.accountBalance = balance;
        integration.metadata.accountCurrency = currency;
        integration.metadata.lastSync = new Date();
        await integration.save();

        logger.info("DingConnect balance fetched", {
          orgId: session.orgId,
          balance,
          currency,
        });
      } else if (integration.provider === "reloadly") {
        if (
          !integration.credentials.clientId ||
          !integration.credentials.clientSecret
        ) {
          throw new Error(
            "Reloadly integration is missing clientId or clientSecret",
          );
        }

        const reloadlyService = new ReloadlyService({
          clientId: integration.credentials.clientId,
          clientSecret: integration.credentials.clientSecret,
          environment: integration.environment || "production",
        });

        const balanceData = await reloadlyService.getBalance();
        balance = balanceData.AccountBalance;
        currency = balanceData.CurrencyCode;

        // Update integration metadata with latest balance
        integration.metadata.accountBalance = balance;
        integration.metadata.accountCurrency = currency;
        integration.metadata.lastSync = new Date();
        await integration.save();

        logger.info("Reloadly balance fetched", {
          orgId: session.orgId,
          balance,
          currency,
        });
      }
    } catch (err: any) {
      // Get user-friendly error message
      error = getUserFriendlyError(err, integration.provider);

      logger.error("Failed to fetch provider balance", {
        orgId: session.orgId,
        provider: integration.provider,
        error: err.message,
        userFriendlyError: error,
      });

      // Return cached balance if available
      balance = integration.metadata.accountBalance || null;
      currency = integration.metadata.accountCurrency || null;
    }

    return NextResponse.json({
      provider: integration.provider,
      balance,
      currency,
      environment: integration.environment,
      lastSync: integration.metadata.lastSync,
      error,
    });
  } catch (error: any) {
    logger.error("Dashboard balance error:", error);
    return NextResponse.json(
      { error: "Failed to fetch balance", details: error.message },
      { status: 500 },
    );
  }
}
