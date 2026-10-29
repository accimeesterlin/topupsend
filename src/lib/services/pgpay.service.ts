import { logger } from "@/lib/logger";

/**
 * PGPay API Service
 * Handles payment creation and verification with PGPay
 * Documentation: https://docs.pgecom.com
 */

export interface PGPayCredentials {
  userId?: string; // UUID format (v1 credential)
  merchantId?: string; // PG organization id (v2) — learned from the connection test
  apiKey?: string; // Org API secret, sk_... (v2) — its presence selects v2
  environment: "sandbox" | "production";
}

export interface PGPayPaymentRequest {
  amount: number;
  currency?: "htg" | "usd"; // Default: 'usd'
  orderId?: string; // Optional internal reference
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  successUrl: string;
  errorUrl: string;
  phone?: string;
  description?: string;
  metadata?: Record<string, any>;
  paymentMethods?: string[];
  webhookUrl?: string;
}

export interface PGPayPaymentResponse {
  token: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  redirectUrl: string; // PGPay returns the checkout URL
  merchantId?: string; // v2: the merchant organization PG resolved the key to
  merchantName?: string;
  // Additional fields returned by PGPay
  [key: string]: any;
}

export interface PGPayVerificationRequest {
  pgPayToken: string;
}

export interface PGPayVerificationResponse {
  orderId: string;
  status: "completed" | "pending" | "failed";
  amount: number;
  paymentStatus: string;
  // Additional transaction details
  [key: string]: any;
}

export class PGPayService {
  private userId?: string;
  private merchantId?: string;
  private apiKey?: string;
  private baseUrl: string;
  /** v2 (org contract) when an org API key is configured, else v1. */
  readonly isV2: boolean;

  constructor(credentials: PGPayCredentials) {
    this.userId = credentials.userId;
    this.merchantId = credentials.merchantId;
    this.apiKey = credentials.apiKey;
    this.isV2 = Boolean(credentials.apiKey);
    const base =
      credentials.environment === "sandbox"
        ? "https://sandbox.pgecom.com/api/pgpay"
        : "https://app.pgecom.com/api/pgpay";
    this.baseUrl = this.isV2 ? `${base}/v2` : base;

    logger.info("PGPay service initialized", {
      environment: credentials.environment,
      baseUrl: this.baseUrl,
      apiVersion: this.isV2 ? "v2" : "v1",
    });
  }

  private authHeaders(): Record<string, string> {
    return this.isV2 ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  /**
   * Create a new payment
   * POST /api/pgpay/token
   */
  async createPayment(
    request: PGPayPaymentRequest,
  ): Promise<PGPayPaymentResponse> {
    const url = `${this.baseUrl}/token`;

    if (!this.isV2 && !this.userId) {
      throw new Error(
        "PGPay User ID is required for the v1 contract (or configure an org API key for v2)",
      );
    }

    const payload = {
      // v1 authenticates by the userID in the payload. v2
      // authenticates by the org key header and REJECTS a payload
      // that still carries a userID — so it is v1-only, by design.
      ...(this.isV2 ? {} : { userID: this.userId }),
      amount: request.amount,
      currency: request.currency || "usd",
      orderId: request.orderId,
      customerEmail: request.customerEmail,
      customerFirstName: request.customerFirstName,
      customerLastName: request.customerLastName,
      successUrl: request.successUrl,
      errorUrl: request.errorUrl,
      phone: request.phone,
      description: request.description,
      metadata: request.metadata,
      paymentMethods: request.paymentMethods,
      webhookUrl: request.webhookUrl,
    };

    logger.info("Creating PGPay payment", {
      amount: request.amount,
      currency: request.currency || "usd",
      orderId: request.orderId,
      customerEmail: request.customerEmail,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error("PGPay payment creation failed", {
          status: response.status,
          error: data.message || data,
        });
        throw new Error(data.message || "Failed to create PGPay payment");
      }

      logger.info("PGPay payment created successfully", {
        token: data.token?.substring(0, 10) + "...",
        orderId: data.orderId,
      });

      return data;
    } catch (error: any) {
      logger.error("Error creating PGPay payment", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Verify a payment using token
   * POST /api/pgpay/order
   */
  async verifyPayment(
    request: PGPayVerificationRequest,
  ): Promise<PGPayVerificationResponse> {
    const url = `${this.baseUrl}/order`;

    const payload = {
      pgPayToken: request.pgPayToken,
    };

    logger.info("Verifying PGPay payment", {
      token: request.pgPayToken.substring(0, 10) + "...",
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error("PGPay payment verification failed", {
          status: response.status,
          error: data.message || data,
        });
        throw new Error(data.message || "Failed to verify PGPay payment");
      }

      logger.info("PGPay payment verified successfully", {
        orderId: data.orderId,
        status: data.status,
        paymentStatus: data.paymentStatus,
        amount: data.amount,
      });

      return data;
    } catch (error: any) {
      logger.error("Error verifying PGPay payment", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Test connection to PGPay API
   *
   * Under v2 the test doubles as the migration step: PG's token
   * response names the merchant organization, and the returned
   * `merchantId` is what the caller stores on the provider record.
   */
  async testConnection(): Promise<{
    success: boolean;
    message: string;
    merchantId?: string;
  }> {
    try {
      const testPayload: PGPayPaymentRequest = {
        amount: 1, // PGPay minimum is 1
        currency: "usd",
        orderId: `test-${Date.now()}`,
        customerEmail: "test@example.com",
        customerFirstName: "Test",
        customerLastName: "Connection",
        successUrl: "/payment/success",
        errorUrl: "/payment/cancel",
        description: "Connection test - do not complete",
      };

      const result = await this.createPayment(testPayload);

      return {
        success: true,
        message: "PGPay connection test successful",
        merchantId: result.merchantId,
      };
    } catch (error: any) {
      logger.error("PGPay connection test failed", {
        error: error.message,
        stack: error.stack,
      });

      // If we get an "already exists" error, it means the API is working
      if (error.message && error.message.includes("already exist")) {
        return {
          success: true,
          message: "PGPay connection verified",
        };
      }

      // v2: a rejected org key means the credential itself is wrong
      if (
        error.message &&
        (error.message.includes("Invalid API key") ||
          error.message.includes("Unauthorized"))
      ) {
        return {
          success: false,
          message: `PGPay API key not recognized. Please verify your organization API key is correct. Error: ${error.message}`,
        };
      }

      // If we get a "not found" error for the merchant, it means API is working
      // but the User ID doesn't exist in their system
      if (error.message && error.message.includes("not found")) {
        return {
          success: false,
          message: `PGPay User ID not recognized. Please verify your User ID is correct. Error: ${error.message}`,
        };
      }

      return {
        success: false,
        message: error.message || "Connection test failed",
      };
    }
  }

  /**
   * Get payment checkout URL
   * This would redirect the customer to PGPay's hosted payment page
   */
  getCheckoutUrl(token: string): string {
    const checkoutBase = this.baseUrl.includes("sandbox")
      ? "https://sandbox.pgecom.com/checkout"
      : "https://checkout.pgecom.com";

    return `${checkoutBase}/${token}`;
  }
}

/**
 * Factory function to create PGPay service instance
 */
export function createPGPayService(
  credentials: PGPayCredentials,
): PGPayService {
  return new PGPayService(credentials);
}

/**
 * Helper to validate PGPay User ID format
 */
export function isValidPGPayUserId(userId: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(userId);
}
