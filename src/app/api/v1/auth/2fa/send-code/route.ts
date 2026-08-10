import { NextRequest } from "next/server";
import { User } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { dbConnection } from "@topupsend/db/connection";
import { EmailService } from "@/lib/services/email.service";
import { Organization } from "@topupsend/db";

/**
 * POST /api/v1/auth/2fa/send-code
 * Generate and send a 2FA code to the user's email
 * Can be called during login (with email in body) or when logged in (uses session)
 */
export async function POST(req: NextRequest) {
  try {
    await dbConnection.connect();

    const { email } = await req.json();

    if (!email) {
      return createErrorResponse("Email is required", 400);
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal if user exists for security
      return createSuccessResponse({
        message: "If an account exists with 2FA enabled, a code has been sent",
      });
    }

    if (!user.twoFactorEnabled) {
      return createSuccessResponse({
        message: "If an account exists with 2FA enabled, a code has been sent",
      });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Set code with 10 minute expiration
    user.twoFactorCode = code;
    user.twoFactorCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    // Get organization for email branding
    const org = await Organization.findById(user.orgId);
    const orgName = org?.name || "Prepaid Minutes Platform";

    // Send email with 2FA code
    const subject = `Your Two-Factor Authentication Code`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2FA Code</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Two-Factor Authentication</h1>
  </div>

  <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Hello,
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      You requested a two-factor authentication code to access your ${orgName} account.
    </p>

    <div style="background: #f9fafb; border-left: 4px solid #667eea; padding: 20px; margin: 24px 0; border-radius: 4px; text-align: center;">
      <p style="margin: 0 0 12px 0; font-weight: 600; color: #374151; font-size: 14px;">Your Verification Code:</p>
      <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 32px; color: #667eea; letter-spacing: 4px; font-weight: bold;">
        ${code}
      </p>
      <p style="margin: 12px 0 0 0; font-size: 14px; color: #6b7280;">
        This code will expire in 10 minutes
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-top: 32px;">
      If you didn't request this code, please ignore this email. Your account remains secure.
    </p>

    <p style="font-size: 14px; color: #6b7280; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
      Best regards,<br>
      The ${orgName} Team
    </p>
  </div>

  <div style="text-align: center; margin-top: 24px; padding: 20px; color: #9ca3af; font-size: 12px;">
    <p style="margin: 0 0 8px 0;">This is an automated email. Please do not reply.</p>
    <p style="margin: 0;">&copy; ${new Date().getFullYear()} ${orgName}. All rights reserved.</p>
  </div>
</body>
</html>
    `;

    const text = `
Your Two-Factor Authentication Code

You requested a two-factor authentication code to access your ${orgName} account.

Your Verification Code: ${code}

This code will expire in 10 minutes.

If you didn't request this code, please ignore this email. Your account remains secure.

Best regards,
The ${orgName} Team
    `.trim();

    try {
      await EmailService.sendEmail(user.orgId.toString(), {
        to: user.email,
        subject,
        html,
        text,
      });
    } catch (emailError: any) {
      console.error("Failed to send 2FA email:", emailError);
      return createErrorResponse("Failed to send verification code", 500);
    }

    return createSuccessResponse({
      message: "Verification code sent to your email",
    });
  } catch (error: any) {
    console.error("2FA send code error:", error);
    return createErrorResponse("Failed to send verification code", 500);
  }
}
