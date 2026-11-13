/**
 * Verify Two-Factor Authentication Code
 * POST /api/v1/customer-auth/2fa/verify-code
 *
 * F-H1: this is a second factor, not a standalone login. A session
 * is minted only when the request carries the pending-auth state
 * the login route created after the password step (HMAC-signed
 * cookie + matching server-side record), the presented code matches
 * the stored SHA-256 hash, and the attempt budget has not run out.
 * A successful verify consumes the code and the pending state.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer, Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import {
  createCustomerSession,
  getCustomerJwtSecret,
} from "@/lib/customer-auth";
import { checkAuthRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import {
  CUSTOMER_PENDING_AUTH_COOKIE,
  TWO_FACTOR_MAX_ATTEMPTS,
  clearPendingAuthCookie,
  pendingAuthStateMatches,
  twoFactorCodeMatches,
  verifyPendingAuthCookie,
} from "@/lib/two-factor";

const verifyCodeSchema = z.object({
  email: z.string().email("Invalid email address"),
  orgSlug: z.string().min(1, "Organization slug is required"),
  code: z.string().length(6, "Code must be 6 digits"),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = verifyCodeSchema.parse(body);

    // Rate limit verification attempts per account + IP (F-M6), on
    // top of the per-code attempt counter below.
    const rateLimit = await checkAuthRateLimit(
      "twoFactorVerify",
      `${data.orgSlug.toLowerCase()}:${data.email.toLowerCase()}`,
      getClientIp(request),
    );
    if (!rateLimit.allowed) {
      throw ApiErrors.TooManyRequests(
        "Too many verification attempts. Please try again later.",
      );
    }

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      throw ApiErrors.NotFound("Organization not found");
    }

    // Find customer with 2FA code
    const customer = await Customer.findOne({
      email: data.email.toLowerCase(),
      orgId: org._id.toString(),
    }).select(
      "+twoFactorCode +twoFactorCodeExpiry +twoFactorVerified +twoFactorAttempts +twoFactorPendingId +twoFactorPendingExpires",
    );

    if (!customer) {
      throw ApiErrors.NotFound("Customer not found");
    }

    // Check if 2FA is enabled
    if (!customer.twoFactorEnabled) {
      throw ApiErrors.BadRequest("Two-factor authentication is not enabled");
    }

    // The pending-auth binding: no password step, no session.
    const pending = verifyPendingAuthCookie(
      request.cookies.get(CUSTOMER_PENDING_AUTH_COOKIE)?.value,
      getCustomerJwtSecret(),
    );
    if (
      !pending ||
      pending.sub !== String(customer._id) ||
      !pendingAuthStateMatches(customer, pending)
    ) {
      throw ApiErrors.BadRequest(
        "Your sign-in session has expired. Please log in again.",
      );
    }

    // Check if code exists
    if (!customer.twoFactorCode || !customer.twoFactorCodeExpiry) {
      throw ApiErrors.BadRequest(
        "No verification code found. Please request a new code.",
      );
    }

    // Check if code has expired
    if (new Date() > customer.twoFactorCodeExpiry) {
      throw ApiErrors.BadRequest(
        "Verification code has expired. Please request a new code.",
      );
    }

    // Verify code (constant-time comparison over hashes)
    if (
      !twoFactorCodeMatches(
        String(customer._id),
        data.code,
        customer.twoFactorCode,
      )
    ) {
      customer.twoFactorAttempts = (customer.twoFactorAttempts ?? 0) + 1;

      if (customer.twoFactorAttempts >= TWO_FACTOR_MAX_ATTEMPTS) {
        // Lockout: destroy the code and the pending state. The
        // password step must be repeated to try again.
        customer.twoFactorCode = undefined;
        customer.twoFactorCodeExpiry = undefined;
        customer.twoFactorAttempts = 0;
        customer.twoFactorPendingId = undefined;
        customer.twoFactorPendingExpires = undefined;
        await customer.save();

        const response = handleApiError(
          ApiErrors.BadRequest(
            "Too many incorrect verification codes. Please log in again.",
          ),
        );
        response.headers.append(
          "Set-Cookie",
          clearPendingAuthCookie(CUSTOMER_PENDING_AUTH_COOKIE),
        );
        return response;
      }

      await customer.save();
      throw ApiErrors.BadRequest("Invalid verification code");
    }

    // Mark 2FA as verified; consume the code and the pending state —
    // both are single-use.
    customer.twoFactorVerified = true;
    customer.twoFactorCode = undefined;
    customer.twoFactorCodeExpiry = undefined;
    customer.twoFactorAttempts = 0;
    customer.twoFactorPendingId = undefined;
    customer.twoFactorPendingExpires = undefined;
    await customer.save();

    // Create session
    const token = await createCustomerSession({
      customerId: String(customer._id),
      orgId: String(org._id),
      email: customer.email!,
      emailVerified: customer.emailVerified,
      name: customer.name,
      tv: customer.tokenVersion ?? 0,
    });

    // Explicitly set cookie on the response to ensure it's included
    const response = createSuccessResponse({
      message: "Verification successful",
      customer: {
        id: String(customer._id),
        email: customer.email,
        name: customer.name,
        emailVerified: customer.emailVerified,
        twoFactorEnabled: customer.twoFactorEnabled,
        currentBalance: customer.currentBalance,
        balanceCurrency: customer.balanceCurrency,
      },
    });

    response.cookies.set("customer-session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    response.headers.append(
      "Set-Cookie",
      clearPendingAuthCookie(CUSTOMER_PENDING_AUTH_COOKIE),
    );

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
