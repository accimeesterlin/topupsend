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
  // The login identifier is the customer's email OR phone number.
  // TopUpSend customers are phone-first: staff create requires only
  // a phone number (email is optional) and fulfillment auto-creates
  // customer records keyed by phone, so an email-only login left
  // every phone-only customer unable to use a password at all —
  // including one staff had just set for them in the dashboard.
  // `identifier` is the current field; `email` is still accepted
  // for older clients.
  identifier: z.string().min(1, "Email or phone number is required").optional(),
  email: z.string().min(1, "Email or phone number is required").optional(),
  password: z.string().min(1, "Password is required"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

/**
 * Phone lookup candidates for an identifier typed by a customer:
 * the value as typed, with spaces/dashes removed, digits only, and
 * "+" + digits — matched against the org's stored phone numbers
 * (primary and additional). Org-scoped, like every other lookup in
 * this route.
 */
function phoneCandidates(identifier: string): string[] {
  const trimmed = identifier.trim();
  const compact = trimmed.replace(/[\s()-]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  return Array.from(
    new Set([trimmed, compact, digits, digits ? `+${digits}` : ""]),
  ).filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = loginSchema.parse(body);

    const identifier = (data.identifier ?? data.email ?? "").trim();
    if (!identifier) {
      throw ApiErrors.BadRequest("Email or phone number is required");
    }
    const isEmailIdentifier = identifier.includes("@");

    // Rate limit credential attempts per account + IP (F-M6)
    const rateLimit = await checkAuthRateLimit(
      "login",
      `${data.orgSlug.toLowerCase()}:${identifier.toLowerCase()}`,
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

    // Find customer with password hash — by email when the
    // identifier is an email address, otherwise by phone number
    // within this org (the same identifier semantics as the
    // Customer model's findByOrgAndIdentifier).
    const customer = isEmailIdentifier
      ? await Customer.findOne({
          email: identifier.toLowerCase(),
          orgId: org._id.toString(),
        }).select("+passwordHash")
      : await Customer.findOne({
          orgId: org._id.toString(),
          $or: [
            { phoneNumber: { $in: phoneCandidates(identifier) } },
            { additionalPhoneNumbers: { $in: phoneCandidates(identifier) } },
          ],
        }).select("+passwordHash");

    if (!customer) {
      logger.warn("Customer login failed: customer not found", {
        identifier: identifier.toLowerCase(),
        orgId: org._id.toString(),
        orgSlug: data.orgSlug,
      });
      throw ApiErrors.Unauthorized("Invalid credentials");
    }

    if (!customer.passwordHash) {
      logger.warn("Customer login failed: no password set", {
        customerId: String(customer._id),
        identifier: identifier.toLowerCase(),
      });
      throw ApiErrors.Unauthorized("Invalid credentials");
    }

    // Verify password
    const isValid = await customer.comparePassword(data.password);

    if (!isValid) {
      logger.warn("Customer login failed: invalid password", {
        customerId: String(customer._id),
        identifier: identifier.toLowerCase(),
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
      // Phone-only customers have no email on the record; the
      // session carries an empty email claim and the portal falls
      // back to the phone number for display.
      email: customer.email ?? "",
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
