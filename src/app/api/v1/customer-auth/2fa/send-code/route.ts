/**
 * Send Two-Factor Authentication Code
 * POST /api/v1/customer-auth/2fa/send-code
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer, Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { EmailService } from "@/lib/services/email.service";
import crypto from "crypto";

const sendCodeSchema = z.object({
  email: z.string().email("Invalid email address"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

/**
 * Generate a 6-digit verification code
 */
function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = sendCodeSchema.parse(body);

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      throw ApiErrors.NotFound("Organization not found");
    }

    // Find customer
    const customer = await Customer.findOne({
      email: data.email.toLowerCase(),
      orgId: org._id.toString(),
    });

    if (!customer) {
      throw ApiErrors.NotFound("Customer not found");
    }

    // Check if 2FA is enabled
    if (!customer.twoFactorEnabled) {
      throw ApiErrors.BadRequest("Two-factor authentication is not enabled");
    }

    // Generate verification code
    const code = generateVerificationCode();

    // Set code and expiry (10 minutes)
    customer.twoFactorCode = code;
    customer.twoFactorCodeExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
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
      Hello${customer.name ? ` ${customer.name}` : ""},
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
      The ${org.name} Team
    </p>
  </div>

  <div style="text-align: center; margin-top: 24px; padding: 20px; color: #9ca3af; font-size: 12px;">
    <p style="margin: 0 0 8px 0;">This is an automated email. Please do not reply.</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} ${org.name}. All rights reserved.</p>
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
