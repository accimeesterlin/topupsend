import { NextRequest } from "next/server";
import { getSession, SessionPayload } from "./auth";
import { ApiErrors } from "./api-error";
import { UserRole } from "@topupsend/types";
import {
  ApiKey,
  Customer,
  type ApiKeyScope,
  type IApiKey,
} from "@topupsend/db";
import { rateLimitService } from "./services/rate-limit.service";
import { getCustomerSession } from "./customer-auth";
import crypto from "crypto";

/**
 * Extended session payload that includes API key info if authenticated via API key
 */
export interface ExtendedSessionPayload extends SessionPayload {
  apiKey?: {
    id: string;
    scopes: ApiKeyScope[];
    ownerId: string;
    ownerType: "staff" | "customer";
  };
}

export interface CustomerAuthPayload {
  customerId: string;
  orgId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Require authentication for a route
 */
export async function requireAuth(
  request: NextRequest,
): Promise<SessionPayload> {
  // Get session cookie from request
  const sessionCookie = request.cookies.get("session");

  if (!sessionCookie) {
    throw ApiErrors.Unauthorized("Authentication required");
  }

  const session = await getSession();

  if (!session) {
    throw ApiErrors.Unauthorized("Invalid or expired session");
  }

  return session;
}

/**
 * Require specific role(s) for a route
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: UserRole[],
): Promise<SessionPayload> {
  const session = await requireAuth(request);

  const hasRole = session.roles.some((role) => allowedRoles.includes(role));

  if (!hasRole) {
    throw ApiErrors.Forbidden("Insufficient permissions");
  }

  return session;
}

/**
 * Optional authentication - returns session if available, null otherwise
 */
export async function optionalAuth(): Promise<SessionPayload | null> {
  try {
    return await getSession();
  } catch {
    return null;
  }
}

/**
 * Authenticate via API key
 * Checks X-API-Key header and validates the key
 */
export async function requireApiKey(request: NextRequest): Promise<{
  apiKey: IApiKey;
  orgId: string;
}> {
  // Get API key from header
  const apiKeyHeader =
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (!apiKeyHeader) {
    throw ApiErrors.Unauthorized(
      "API key required. Provide via X-API-Key header or Authorization Bearer token.",
    );
  }

  // Hash the provided key
  const keyHash = crypto
    .createHash("sha256")
    .update(apiKeyHeader)
    .digest("hex");

  // Find the API key in database
  const apiKey = await ApiKey.findOne({
    key: keyHash,
    isActive: true,
  }).select("+key");

  if (!apiKey) {
    throw ApiErrors.Unauthorized("Invalid API key");
  }

  // Check if key is expired
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw ApiErrors.Unauthorized("API key has expired");
  }

  // Get effective rate limit
  const rateLimit = apiKey.getRateLimit();

  // Check rate limits
  const limitCheck = await rateLimitService.checkBothLimits(
    String(apiKey._id),
    apiKey.orgId,
    rateLimit,
  );

  if (!limitCheck.allowed) {
    // Add rate limit headers
    const response = new Response(
      JSON.stringify({
        type: "rate_limit_exceeded",
        title: "Rate Limit Exceeded",
        status: 429,
        detail: `Rate limit exceeded for ${limitCheck.limitType}. Limit: ${limitCheck.limit} requests per hour.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Limit": limitCheck.limit.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": new Date(limitCheck.resetAt).toISOString(),
          "Retry-After": Math.ceil(
            (limitCheck.resetAt - Date.now()) / 1000,
          ).toString(),
        },
      },
    );
    throw response;
  }

  // Record the request
  await rateLimitService.recordBothRequests(String(apiKey._id), apiKey.orgId);

  // Update usage stats (async, don't wait)
  apiKey.incrementUsage().catch(console.error);

  return {
    apiKey,
    orgId: apiKey.orgId,
  };
}

/**
 * Require API key with specific scope(s)
 */
export async function requireApiKeyWithScope(
  request: NextRequest,
  requiredScopes: ApiKeyScope | ApiKeyScope[],
): Promise<{
  apiKey: IApiKey;
  orgId: string;
}> {
  const { apiKey, orgId } = await requireApiKey(request);

  // Validate scope
  if (!apiKey.validateScope(requiredScopes)) {
    const scopes = Array.isArray(requiredScopes)
      ? requiredScopes.join(", ")
      : requiredScopes;
    throw ApiErrors.Forbidden(
      `Insufficient API key scope. Required: ${scopes}`,
    );
  }

  return { apiKey, orgId };
}

/**
 * Require customer authentication (separate from staff auth)
 * This validates customer JWT tokens
 */
export async function requireCustomerAuth(_request: NextRequest): Promise<{
  customerId: string;
  orgId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}> {
  const session = await getCustomerSession();

  if (!session) {
    throw ApiErrors.Unauthorized("Customer authentication required");
  }

  return session;
}

/**
 * Require verified customer (email must be verified)
 */
export async function requireVerifiedCustomer(_request: NextRequest): Promise<{
  customerId: string;
  orgId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}> {
  const customer = await requireCustomerAuth(_request);

  if (!customer.emailVerified) {
    throw ApiErrors.Forbidden(
      "Email verification required. Please verify your email to continue.",
    );
  }

  return customer;
}

/**
 * Require customer via either session cookie or customer API key
 *
 * - First tries JWT customer session (customer-portal login)
 * - If no session, falls back to API key with "customer:read" scope
 */
export async function requireCustomerAuthOrApiKey(
  request: NextRequest,
): Promise<CustomerAuthPayload & { apiKey?: IApiKey }> {
  const session = await getCustomerSession();

  if (session) {
    return session;
  }

  const { apiKey } = await requireApiKeyWithScope(request, "customer:read");

  if (apiKey.ownerType !== "customer") {
    throw ApiErrors.Forbidden("API key must belong to a customer account");
  }

  const customer = await Customer.findById(apiKey.ownerId);

  if (!customer) {
    throw ApiErrors.Unauthorized("Customer not found for provided API key");
  }

  return {
    customerId: String(customer._id),
    orgId: customer.orgId,
    email: customer.email!,
    emailVerified: customer.emailVerified,
    name: customer.name,
    apiKey,
  };
}
