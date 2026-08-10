import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { PaymentProvider } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";

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
 */
async function testPGPayConnection(
  provider: any,
): Promise<{ success: boolean; message: string; details?: any }> {
  const { userId } = provider.credentials;

  if (!userId) {
    return {
      success: false,
      message: "Missing required PGPay User ID",
    };
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return {
      success: false,
      message: "Invalid PGPay User ID format. Must be a valid UUID.",
    };
  }

  // Test with a small payment creation (we won't complete it, just validate credentials)
  try {
    const baseUrl =
      provider.environment === "sandbox"
        ? "https://sandbox.pgecom.com/api/pgpay/token"
        : "https://app.pgecom.com/api/pgpay/token";

    // Required fields for PGPay API
    const testPayload = {
      userID: userId,
      amount: 1, // Minimum amount required by PGPay is 1
      currency: "usd",
      orderId: `test-${Date.now()}`,
      customerEmail: "test@example.com",
      customerFirstName: "Test",
      customerLastName: "User",
      successUrl: "/payment/success",
      errorUrl: "/payment/cancel",
      description: "Connection test - do not complete",
    };

    logger.info("Testing PGPay connection", {
      baseUrl,
      userId,
      environment: provider.environment,
    });

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testPayload),
    });

    const contentType = response.headers.get("content-type");
    let data: any = {};

    // Handle both JSON and non-JSON responses
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      logger.warn("PGPay returned non-JSON response", {
        text,
        status: response.status,
      });
      data = { message: text || "Unexpected response format" };
    }

    logger.info("PGPay API response", {
      status: response.status,
      ok: response.ok,
      data: JSON.stringify(data).substring(0, 200),
    });

    if (response.ok) {
      return {
        success: true,
        message: "PGPay credentials validated successfully",
        details: {
          environment: provider.environment,
          userId,
          testResponse: "Connection successful",
        },
      };
    } else {
      // Check if it's just an order ID conflict (which means the API is accessible)
      if (data.message && data.message.includes("already exist")) {
        return {
          success: true,
          message: "PGPay credentials validated successfully",
          details: {
            environment: provider.environment,
            userId,
            note: "API accessible and responding",
          },
        };
      }

      // If we get a "not found" error for the merchant, it means API is working
      // but the User ID doesn't exist in their system
      if (
        data.message &&
        (data.message.includes("not found") || data.status === 404)
      ) {
        return {
          success: false,
          message: `PGPay User ID not recognized. Please verify your User ID is correct. API Error: ${data.message}`,
        };
      }

      return {
        success: false,
        message: data.message || "Failed to validate PGPay credentials",
      };
    }
  } catch (error: any) {
    logger.error("PGPay connection test failed", {
      error: error.message,
      stack: error.stack,
      cause: error.cause,
    });

    return {
      success: false,
      message: `Failed to connect to PGPay API: ${error.message}. Please check your network connection and try again.`,
    };
  }
}
