/**
 * Send Two-Factor Authentication Code
 * POST /api/v1/customer-auth/2fa/send-code
 *
 * F-H1: a code is issued only inside a post-password pending-auth
 * state (created by the customer login route) or for an already
 * signed-in customer requesting a code for their own account. The
 * code is generated with a CSPRNG and stored as a SHA-256 hash.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer, Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { EmailService } from "@/lib/services/email.service";
import { escapeHtml } from "@/lib/escape-html";
import {
  getCustomerJwtSecret,
  getCustomerSession,
} from "@/lib/customer-auth";
import { checkAuthRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import {
  CUSTOMER_PENDING_AUTH_COOKIE,
  TWO_FACTOR_CODE_TTL_MS,
  generateTwoFactorCode,
  hashTwoFactorCode,
  pendingAuthStateMatches,
  verifyPendingAuthCookie,
} from "@/lib/two-factor";

const sendCodeSchema = z.object({
  email: z.string().email("Invalid email address"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = sendCodeSchema.parse(body);

    // Rate limit code requests per account + IP (F-M6)
    const rateLimit = await checkAuthRateLimit(
      "twoFactorSend",
      `${data.orgSlug.toLowerCase()}:${data.email.toLowerCase()}`,
      getClientIp(request),
    );
    if (!rateLimit.allowed) {
      throw ApiErrors.TooManyRequests(
        "Too many verification code requests. Please try again later.",
      );
    }

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      throw ApiErrors.NotFound("Organization not found");
    }

    // Find customer
    const customer = await Customer.findOne({
      email: data.email.toLowerCase(),
      orgId: org._id.toString(),
    }).select("+twoFactorPendingId +twoFactorPendingExpires");

    if (!customer) {
      throw ApiErrors.NotFound("Customer not found");
    }

    // Check if 2FA is enabled
    if (!customer.twoFactorEnabled) {
      throw ApiErrors.BadRequest("Two-factor authentication is not enabled");
    }

    // Bind the request to the password step: either the pending-auth
    // cookie the login route issued for THIS customer (with matching
    // server-side state), or an existing full session for this
    // customer.
    const pending = verifyPendingAuthCookie(
      request.cookies.get(CUSTOMER_PENDING_AUTH_COOKIE)?.value,
      getCustomerJwtSecret(),
    );
    const boundByPending =
      pending !== null &&
      pending.sub === String(customer._id) &&
      pendingAuthStateMatches(customer, pending);
    let boundBySession = false;
    if (!boundByPending) {
      const session = await getCustomerSession();
      boundBySession = session?.customerId === String(customer._id);
    }
    if (!boundByPending && !boundBySession) {
      throw ApiErrors.Unauthorized(
        "Please sign in with your password before requesting a verification code",
      );
    }

    // Generate a verification code with a CSPRNG; store only its hash.
    const code = generateTwoFactorCode();

    // Set code hash and expiry (10 minutes)
    customer.twoFactorCode = hashTwoFactorCode(String(customer._id), code);
    customer.twoFactorCodeExpiry = new Date(
      Date.now() + TWO_FACTOR_CODE_TTL_MS,
    ); // 10 minutes
    customer.twoFactorAttempts = 0;
    customer.twoFactorVerified = false;

    await customer.save();

    // Send email with verification code
    try {
      await EmailService.sendEmail(org._id.toString(), {
        to: customer.email!,
        subject: "Your Verification Code",
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Code</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Verification Code</h1>
  </div>

  <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Hello${customer.name ? ` ${escapeHtml(customer.name)}` : ""},
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      Your two-factor authentication code is:
    </p>

    <div style="background: #f9fafb; border-left: 4px solid #667eea; padding: 24px; margin: 24px 0; border-radius: 4px; text-align: center;">
      <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 32px; color: #667eea; letter-spacing: 8px; font-weight: bold;">
        ${code}
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-top: 24px;">
      This code will expire in <strong>10 minutes</strong> for security reasons.
    </p>

    <p style="font-size: 14px; color: #6b7280; margin-top: 16px;">
      If you didn't request this code, please ignore this email and consider changing your password.
    </p>

    <p style="font-size: 14px; color: #6b7280; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
      Best regards,<br>
      The ${escapeHtml(org.name)} Team
    </p>
  </div>

  <div style="text-align: center; margin-top: 24px; padding: 20px; color: #9ca3af; font-size: 12px;">
    <p style="margin: 0 0 8px 0;">This is an automated email. Please do not reply.</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} ${escapeHtml(org.name)}. All rights reserved.</p>
  </div>
</body>
</html>
        `,
        text: `
Your Verification Code

Hello${customer.name ? ` ${customer.name}` : ""},

Your two-factor authentication code is: ${code}

This code will expire in 10 minutes for security reasons.

If you didn't request this code, please ignore this email and consider changing your password.

Best regards,
The ${org.name} Team
        `.trim(),
      });
    } catch (emailError) {
      console.error("Failed to send 2FA code email:", emailError);
      throw ApiErrors.InternalServerError(
        "Failed to send verification code. Please try again later.",
      );
    }

    return createSuccessResponse({
      message: "Verification code sent to your email",
      expiresIn: 600, // 10 minutes in seconds
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
