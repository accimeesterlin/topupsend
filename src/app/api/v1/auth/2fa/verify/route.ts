import { NextRequest } from "next/server";
import { User } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { dbConnection } from "@topupsend/db/connection";
import { createToken, createSessionCookie, getJwtSecret } from "@/lib/auth";
import { UserRole } from "@topupsend/types";
import { checkAuthRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import {
  STAFF_PENDING_AUTH_COOKIE,
  TWO_FACTOR_MAX_ATTEMPTS,
  clearPendingAuthCookie,
  pendingAuthStateMatches,
  twoFactorCodeMatches,
  verifyPendingAuthCookie,
} from "@/lib/two-factor";

/**
 * POST /api/v1/auth/2fa/verify
 * Verify the 2FA code and complete login
 *
 * F-H1: this is a second factor, not a standalone login. A session
 * is minted only when the request carries the pending-auth state
 * the login route created after the password step (HMAC-signed
 * cookie + matching server-side record), the presented code matches
 * the stored SHA-256 hash, and the attempt budget has not run out.
 * A successful verify consumes the code and the pending state.
 */
export async function POST(req: NextRequest) {
  try {
    await dbConnection.connect();

    const { email, code } = await req.json();

    if (!email || !code) {
      return createErrorResponse("Email and code are required", 400);
    }

    // Rate limit verification attempts per account + IP (F-M6), on
    // top of the per-code attempt counter below.
    const rateLimit = await checkAuthRateLimit(
      "twoFactorVerify",
      email,
      getClientIp(req),
    );
    if (!rateLimit.allowed) {
      const response = createErrorResponse(
        "Too many verification attempts. Please try again later.",
        429,
      );
      response.headers.set(
        "Retry-After",
        rateLimit.retryAfterSeconds.toString(),
      );
      return response;
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+twoFactorCode +twoFactorCodeExpires +twoFactorAttempts +twoFactorPendingId +twoFactorPendingExpires"
    );

    if (!user) {
      return createErrorResponse("Invalid verification code", 400);
    }

    if (!user.twoFactorEnabled) {
      return createErrorResponse("Two-factor authentication is not enabled", 400);
    }

    // The pending-auth binding: no password step, no session.
    const pending = verifyPendingAuthCookie(
      req.cookies.get(STAFF_PENDING_AUTH_COOKIE)?.value,
      getJwtSecret(),
    );
    if (
      !pending ||
      pending.sub !== user._id.toString() ||
      !pendingAuthStateMatches(user, pending)
    ) {
      return createErrorResponse(
        "Your sign-in session has expired. Please log in again",
        400,
      );
    }

    if (!user.twoFactorCode || !user.twoFactorCodeExpires) {
      return createErrorResponse("No verification code found. Please request a new code", 400);
    }

    // Check if code is expired
    if (new Date() > user.twoFactorCodeExpires) {
      return createErrorResponse("Verification code has expired. Please request a new code", 400);
    }

    // Verify code (constant-time comparison over hashes)
    if (!twoFactorCodeMatches(user._id.toString(), String(code), user.twoFactorCode)) {
      user.twoFactorAttempts = (user.twoFactorAttempts ?? 0) + 1;

      if (user.twoFactorAttempts >= TWO_FACTOR_MAX_ATTEMPTS) {
        // Lockout: destroy the code and the pending state. The
        // password step must be repeated to try again.
        user.twoFactorCode = undefined;
        user.twoFactorCodeExpires = undefined;
        user.twoFactorAttempts = 0;
        user.twoFactorPendingId = undefined;
        user.twoFactorPendingExpires = undefined;
        await user.save();

        const response = createErrorResponse(
          "Too many incorrect verification codes. Please log in again",
          400,
        );
        response.headers.append(
          "Set-Cookie",
          clearPendingAuthCookie(STAFF_PENDING_AUTH_COOKIE),
        );
        return response;
      }

      await user.save();
      return createErrorResponse("Invalid verification code", 400);
    }

    // Clear the code and the pending state after successful
    // verification — both are single-use.
    user.twoFactorCode = undefined;
    user.twoFactorCodeExpires = undefined;
    user.twoFactorAttempts = 0;
    user.twoFactorPendingId = undefined;
    user.twoFactorPendingExpires = undefined;
    await user.save();

    // Generate session token
    const token = await createToken({
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles as UserRole[],
      orgId: user.orgId.toString(),
      tv: user.tokenVersion ?? 0,
    });

    const response = createSuccessResponse({
      message: "Two-factor authentication successful",
      user: {
        id: user._id,
        email: user.email,
        roles: user.roles,
        orgId: user.orgId,
      },
    });

    // Set session cookie; clear the pending-auth cookie
    response.headers.set("Set-Cookie", createSessionCookie(token));
    response.headers.append(
      "Set-Cookie",
      clearPendingAuthCookie(STAFF_PENDING_AUTH_COOKIE),
    );

    return response;
  } catch (error: any) {
    console.error("2FA verify error:", error);
    return createErrorResponse("Failed to verify code", 500);
  }
}
