/**
 * Customer Login Endpoint
 * POST /api/v1/customer-auth/login
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer } from "@topupsend/db";
import { Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import {
  createCustomerSession,
  getCustomerJwtSecret,
} from "@/lib/customer-auth";
import { logger } from "@/lib/logger";
import { checkAuthRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import {
  CUSTOMER_PENDING_AUTH_COOKIE,
  TWO_FACTOR_PENDING_TTL_MS,
  createPendingAuthCookie,
  newPendingAuthId,
  signPendingAuthCookie,
} from "@/lib/two-factor";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = loginSchema.parse(body);

    // Rate limit credential attempts per account + IP (F-M6)
    const rateLimit = await checkAuthRateLimit(
      "login",
      `${data.orgSlug.toLowerCase()}:${data.email.toLowerCase()}`,
      getClientIp(request),
    );
    if (!rateLimit.allowed) {
      throw ApiErrors.TooManyRequests(
        "Too many login attempts. Please try again later.",
      );
    }

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      logger.warn("Customer login failed: organization not found", {
        orgSlug: data.orgSlug,
      });
      throw ApiErrors.Unauthorized("Invalid credentials");
    }

    // Find customer with password hash
    const customer = await Customer.findOne({
      email: data.email.toLowerCase(),
      orgId: org._id.toString(),
    }).select("+passwordHash");

    if (!customer) {
      logger.warn("Customer login failed: customer not found", {
        email: data.email.toLowerCase(),
        orgId: org._id.toString(),
        orgSlug: data.orgSlug,
      });
      throw ApiErrors.Unauthorized("Invalid credentials");
    }

    if (!customer.passwordHash) {
      logger.warn("Customer login failed: no password set", {
        customerId: String(customer._id),
        email: data.email.toLowerCase(),
      });
      throw ApiErrors.Unauthorized("Invalid credentials");
    }

    // Verify password
    const isValid = await customer.comparePassword(data.password);

    if (!isValid) {
      logger.warn("Customer login failed: invalid password", {
        customerId: String(customer._id),
        email: data.email.toLowerCase(),
      });
      throw ApiErrors.Unauthorized("Invalid credentials");
    }

    // Check if 2FA is enabled
    if (customer.twoFactorEnabled) {
      // Don't create session yet - require 2FA verification first.
      // The password step passed: create the server-side pending-auth
      // state the 2FA send/verify endpoints will require (F-H1). The
      // browser carries only an HMAC-signed cookie naming this state.
      const pendingId = newPendingAuthId();
      const pendingExpires = new Date(
        Date.now() + TWO_FACTOR_PENDING_TTL_MS,
      );
      customer.twoFactorPendingId = pendingId;
      customer.twoFactorPendingExpires = pendingExpires;
      customer.twoFactorAttempts = 0;
      await customer.save();

      const response = createSuccessResponse({
        message: "Password verified. Two-factor authentication required.",
        requires2FA: true,
        email: customer.email,
        orgSlug: data.orgSlug,
      });

      response.headers.append(
        "Set-Cookie",
        createPendingAuthCookie(
          CUSTOMER_PENDING_AUTH_COOKIE,
          signPendingAuthCookie(
            {
              sub: String(customer._id),
              jti: pendingId,
              exp: pendingExpires.getTime(),
            },
            getCustomerJwtSecret(),
          ),
        ),
      );

      return response;
    }

    // Create session (only if 2FA is not enabled)
    logger.info("Customer login successful", {
      customerId: String(customer._id),
      email: customer.email,
      orgSlug: data.orgSlug,
    });

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
      message: "Login successful",
      requires2FA: false,
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

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
