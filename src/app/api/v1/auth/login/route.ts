import { NextRequest } from "next/server";
import { z } from "zod";
import { dbConnection } from "@topupsend/db/connection";
import { User } from "@topupsend/db/models/user.model";
import { resolveMembershipSession } from "@/lib/membership-session";
import {
  verifyPassword,
  createToken,
  createSessionCookie,
  getJwtSecret,
} from "@/lib/auth";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { setSentryUser } from "@/lib/sentry-utils";
import { checkAuthRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import {
  STAFF_PENDING_AUTH_COOKIE,
  TWO_FACTOR_PENDING_TTL_MS,
  createPendingAuthCookie,
  newPendingAuthId,
  signPendingAuthCookie,
} from "@/lib/two-factor";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(request: NextRequest) {
  try {
    // Connect to database
    await dbConnection.connect();

    // Parse and validate request body
    const body = await request.json();
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.errors.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw ApiErrors.UnprocessableEntity("Validation failed", { errors });
    }

    const { email, password } = validation.data;

    // Rate limit credential attempts per account + IP (F-M6)
    const rateLimit = await checkAuthRateLimit(
      "login",
      email,
      getClientIp(request),
    );
    if (!rateLimit.allowed) {
      throw ApiErrors.TooManyRequests(
        "Too many login attempts. Please try again later.",
      );
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw ApiErrors.Unauthorized("Invalid email or password");
    }

    // Check if user is active
    if (!user.isActive) {
      throw ApiErrors.Forbidden("Account is inactive");
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      throw ApiErrors.Unauthorized("Invalid email or password");
    }

    // Check if 2FA is enabled for this user
    if (user.twoFactorEnabled) {
      logger.info("2FA required for user", {
        userId: user._id.toString(),
        email: user.email,
      });

      // The password step passed: create the server-side pending-auth
      // state the 2FA send/verify endpoints will require (F-H1). The
      // browser carries only an HMAC-signed cookie naming this state;
      // without it, no code can be requested or verified into a
      // session.
      const pendingId = newPendingAuthId();
      const pendingExpires = new Date(
        Date.now() + TWO_FACTOR_PENDING_TTL_MS,
      );
      user.twoFactorPendingId = pendingId;
      user.twoFactorPendingExpires = pendingExpires;
      user.twoFactorAttempts = 0;
      await user.save();

      const response = createSuccessResponse({
        requires2FA: true,
        email: user.email,
        message: "Two-factor authentication required. Please check your email for the verification code.",
      });

      response.headers.append(
        "Set-Cookie",
        createPendingAuthCookie(
          STAFF_PENDING_AUTH_COOKIE,
          signPendingAuthCookie(
            {
              sub: user._id.toString(),
              jti: pendingId,
              exp: pendingExpires.getTime(),
            },
            getJwtSecret(),
          ),
        ),
      );

      return response;
    }

    // RBAC C1: mint the session from the live membership record. The
    // legacy global `user.roles` is written once at account creation
    // and never updated, so reading it here resurrected demoted and
    // removed members at their next sign-in. resolveMembershipSession
    // binds the session to an ACTIVE UserOrganization (the recorded
    // default org, else the most recent active membership) and takes
    // the roles from that record; no active membership anywhere
    // means no session.
    const membership = await resolveMembershipSession(user);
    if (!membership) {
      throw ApiErrors.Forbidden(
        "Your account is not an active member of any organization",
      );
    }

    logger.info("User logged in", {
      userId: user._id.toString(),
      email: user.email,
    });

    // Create session token
    const sessionPayload = {
      userId: user._id.toString(),
      email: user.email,
      roles: membership.roles,
      orgId: membership.orgId,
      tv: user.tokenVersion ?? 0,
    };
    const token = await createToken(sessionPayload);

    // Set Sentry user context with non-PII data
    setSentryUser(sessionPayload);

    // Create response with session cookie
    const response = createSuccessResponse({
      user: {
        id: user._id.toString(),
        email: user.email,
        roles: membership.roles,
        orgId: membership.orgId,
      },
    });

    response.headers.set("Set-Cookie", createSessionCookie(token));

    return response;
  } catch (error) {
    logger.error("Login error", { error });
    return handleApiError(error);
  }
}
