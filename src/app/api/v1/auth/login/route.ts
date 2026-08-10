import { NextRequest } from "next/server";
import { z } from "zod";
import { dbConnection } from "@topupsend/db/connection";
import { User } from "@topupsend/db/models/user.model";
import { UserOrganization } from "@topupsend/db";
import { verifyPassword, createToken, createSessionCookie } from "@/lib/auth";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { setSentryUser } from "@/lib/sentry-utils";

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

      return createSuccessResponse({
        requires2FA: true,
        email: user.email,
        message: "Two-factor authentication required. Please check your email for the verification code.",
      });
    }

    logger.info("User logged in", {
      userId: user._id.toString(),
      email: user.email,
    });

    // Ensure we have a default organization for the session.
    // Some users may not have `user.orgId` set (e.g. invited users).
    // Pick the most recent active UserOrganization and persist it on the user record.
    let sessionOrgId = user.orgId ? user.orgId.toString() : undefined;

    if (!sessionOrgId) {
      const userOrg = await UserOrganization.findOne({
        userId: user._id,
        isActive: true,
      })
        .sort({ joinedAt: -1 })
        .populate("orgId");
      if (userOrg && (userOrg as any).orgId) {
        try {
          const orgIdStr =
            (userOrg as any).orgId._id?.toString() ||
            (userOrg as any).orgId.toString();
          sessionOrgId = orgIdStr;
          // Persist the chosen default org on the user so future logins are consistent
          user.orgId = sessionOrgId as any;
          await user.save();
        } catch (err) {
          // Non-fatal: if saving fails, still continue with a session org if found
          logger.warn("Failed to persist default orgId on user", {
            userId: user._id.toString(),
            error: err,
          });
        }
      }
    }

    // Create session token
    const sessionPayload = {
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles,
      orgId: sessionOrgId || "",
    };
    const token = await createToken(sessionPayload);

    // Set Sentry user context with non-PII data
    setSentryUser(sessionPayload);

    // Create response with session cookie
    const response = createSuccessResponse({
      user: {
        id: user._id.toString(),
        email: user.email,
        roles: user.roles,
        orgId: user.orgId.toString(),
      },
    });

    response.headers.set("Set-Cookie", createSessionCookie(token));

    return response;
  } catch (error) {
    logger.error("Login error", { error });
    return handleApiError(error);
  }
}
