import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { PaymentProvider } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { createPGPayService } from "@/lib/services/pgpay.service";

/**
 * POST /api/v1/payment-providers/[id]/test
 * Test payment provider connection
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      return createErrorResponse("Payment provider not found", 404);
    }

    logger.info("Testing payment provider", {
      orgId: session.orgId,
      provider: provider.provider,
      environment: provider.environment,
    });

    let testResult: { success: boolean; message: string; details?: any } = {
      success: false,
      message: "Test not implemented",
    };

    try {
      // Test based on provider type
      if (provider.provider === "stripe") {
        testResult = await testStripeConnection(provider);
      } else if (provider.provider === "paypal") {
        testResult = await testPayPalConnection(provider);
      } else if (provider.provider === "pgpay") {
        testResult = await testPGPayConnection(provider);
      }

      if (testResult.success) {
        // Update provider status
        provider.status = "active";
        provider.metadata.lastTestSuccess = new Date();
        provider.metadata.lastTestError = undefined;
        // v2 flip step: the connection test learns the PG
        // organization (merchant) id — persist it on the credentials.
        if (provider.provider === "pgpay" && testResult.details?.merchantId) {
          provider.credentials = {
            ...provider.credentials,
            merchantId: testResult.details.merchantId,
          };
        }
        await provider.save();

        logger.info("Payment provider test successful", {
          orgId: session.orgId,
          provider: provider.provider,
        });

        return createSuccessResponse({
          success: true,
          message: testResult.message,
          details: testResult.details,
        });
      } else {
        // Update error status
        provider.status = "error";
        provider.metadata.lastTestError = testResult.message;
        await provider.save();

        logger.error("Payment provider test failed", {
          orgId: session.orgId,
          provider: provider.provider,
          error: testResult.message,
        });

        return createErrorResponse(testResult.message, 400);
      }
    } catch (testError: any) {
      provider.status = "error";
      provider.metadata.lastTestError = testError.message;
      await provider.save();

      logger.error("Payment provider test error", {
        orgId: session.orgId,
        provider: provider.provider,
        error: testError.message,
      });

      return createErrorResponse(`Test failed: ${testError.message}`, 500);
    }
  } catch (error) {
    logger.error("Error testing payment provider", { error });
    return handleApiError(error);
  }
}

/**
 * Test Stripe connection
 */
async function testStripeConnection(
  provider: any,
): Promise<{ success: boolean; message: string; details?: any }> {
  // For now, basic validation - full Stripe SDK integration would go here
  const { secretKey, publishableKey } = provider.credentials;

  if (!secretKey || !publishableKey) {
    return {
      success: false,
      message: "Missing required Stripe credentials",
    };
  }

  // Check key format
  const isTest = provider.environment === "sandbox";
  const expectedSecretPrefix = isTest ? "sk_test_" : "sk_live_";
  const expectedPublishPrefix = isTest ? "pk_test_" : "pk_live_";

  if (!secretKey.startsWith(expectedSecretPrefix)) {
    return {
      success: false,
      message: `Secret key should start with ${expectedSecretPrefix} for ${provider.environment} environment`,
    };
  }

  if (!publishableKey.startsWith(expectedPublishPrefix)) {
    return {
      success: false,
      message: `Publishable key should start with ${expectedPublishPrefix} for ${provider.environment} environment`,
    };
  }

  // TODO: Make actual API call to Stripe to verify credentials
  // const stripe = require('stripe')(secretKey);
  // await stripe.balance.retrieve();

  return {
    success: true,
    message: "Stripe credentials validated successfully",
    details: {
      environment: provider.environment,
      keyFormat: "valid",
    },
  };
}

/**
 * Test PayPal connection
 */
async function testPayPalConnection(
  provider: any,
): Promise<{ success: boolean; message: string; details?: any }> {
  const { clientId, clientSecret } = provider.credentials;

  if (!clientId || !clientSecret) {
    return {
      success: false,
      message: "Missing required PayPal credentials",
    };
  }

  // Basic validation
  if (clientId.length < 10 || clientSecret.length < 10) {
    return {
      success: false,
      message: "Invalid PayPal credentials format",
    };
  }

  // TODO: Make actual API call to PayPal to verify credentials
  // const baseUrl = provider.environment === 'sandbox'
  //   ? 'https://api.sandbox.paypal.com'
  //   : 'https://api.paypal.com';
  // await fetch(`${baseUrl}/v1/oauth2/token`, { ... });

  return {
    success: true,
    message: "PayPal credentials validated successfully",
    details: {
      environment: provider.environment,
    },
  };
}

/**
 * Test PGPay connection
 *
 * Runs through PGPayService so the test exercises exactly the
 * contract the payments will use: v1 (user ID in the payload) or v2
 * (org API key header) when the provider carries an API key. Under
 * v2 a successful test also learns the PG organization (merchant)
 * id, returned in details for the caller to persist.
 */
async function testPGPayConnection(
  provider: any,
): Promise<{ success: boolean; message: string; details?: any }> {
  const { userId, apiKey, merchantId } = provider.credentials;

  if (!userId && !apiKey) {
    return {
      success: false,
      message: "Missing required PGPay credentials (User ID or API key)",
    };
  }

  if (userId) {
    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return {
        success: false,
        message: "Invalid PGPay User ID format. Must be a valid UUID.",
      };
    }
  }

  const pgpay = createPGPayService({
    userId,
    merchantId,
    apiKey,
    environment: provider.environment,
  });
  const result = await pgpay.testConnection();

  return {
    success: result.success,
    message: result.message,
    details: {
      environment: provider.environment,
      userId,
      apiVersion: apiKey ? "v2" : "v1",
      ...(result.merchantId ? { merchantId: result.merchantId } : {}),
    },
  };
}
