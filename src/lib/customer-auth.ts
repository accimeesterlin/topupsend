/**
 * Customer Authentication Service
 * Handles JWT tokens for customer authentication (separate from staff auth)
 */

import { SignJWT, jwtVerify, JWTPayload } from "jose";
import { cookies } from "next/headers";

/**
 * The customer session secret (F-C9: fail closed).
 *
 * There is deliberately NO fallback literal: if CUSTOMER_JWT_SECRET
 * is unset, signing throws and verification rejects every token,
 * instead of silently trusting a secret printed in the source code.
 * Resolved lazily on each call so importing this module (build,
 * tests) never depends on the deployment's env.
 */
export function getCustomerJwtSecret(): Uint8Array {
  const secret = process.env.CUSTOMER_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "CUSTOMER_JWT_SECRET environment variable is not set; refusing to sign or verify customer session tokens",
    );
  }
  return new TextEncoder().encode(secret);
}

export interface CustomerSessionPayload extends JWTPayload {
  customerId: string;
  orgId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  /**
   * Token version at mint time (F-M1). requireCustomerAuth compares
   * it with the customer record's current tokenVersion; a mismatch
   * means the session has been revoked (password reset/change,
   * logout). Absent on pre-hardening tokens (= 0).
   */
  tv?: number;
}

/**
 * Create a customer session (JWT token)
 */
export async function createCustomerSession(
  payload: CustomerSessionPayload,
): Promise<string> {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d") // 7 days expiry
    .sign(getCustomerJwtSecret());

  // Set cookie
  (await cookies()).set("customer-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });

  return token;
}

/**
 * Get current customer session
 */
export async function getCustomerSession(): Promise<CustomerSessionPayload | null> {
  const token = (await cookies()).get("customer-session")?.value;

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getCustomerJwtSecret());
    return payload as CustomerSessionPayload;
  } catch (_error) {
    return null;
  }
}

/**
 * Delete customer session
 */
export async function deleteCustomerSession(): Promise<void> {
  (await cookies()).delete("customer-session");
}

/**
 * Verify customer JWT token (without setting cookie)
 */
export async function verifyCustomerToken(
  token: string,
): Promise<CustomerSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getCustomerJwtSecret());
    return payload as CustomerSessionPayload;
  } catch (_error) {
    return null;
  }
}
