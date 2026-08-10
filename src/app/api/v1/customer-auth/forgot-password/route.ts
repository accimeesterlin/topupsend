/**
 * Request Password Reset Endpoint
 * POST /api/v1/customer-auth/forgot-password
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { Customer } from "@topupsend/db";
import { Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { sendEmail } from "@/lib/services/email.service";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = forgotPasswordSchema.parse(body);

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      // Don't reveal if org exists
      return createSuccessResponse({
        message:
          "If an account exists with this email, a password reset link has been sent.",
      });
    }

    // Find customer
    const customer = await Customer.findOne({
      email: data.email.toLowerCase(),
      orgId: org._id.toString(),
    }).select("+resetPasswordToken +resetPasswordTokenExpiry");

    if (!customer) {
      // Don't reveal if customer exists
      return createSuccessResponse({
        message:
          "If an account exists with this email, a password reset link has been sent.",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiry = new Date();
    resetExpiry.setHours(resetExpiry.getHours() + 1); // 1 hour expiry

    customer.resetPasswordToken = resetToken;
    customer.resetPasswordTokenExpiry = resetExpiry;
    await customer.save();

    // Build reset URL
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const resetUrl = `${baseUrl}/customer-portal/${data.orgSlug}/reset-password?token=${resetToken}&email=${encodeURIComponent(customer.email!)}`;

    // Send email
    await sendEmail(org._id.toString(), {
      to: customer.email!,
      subject: "Reset Your Password",
      html: buildResetEmailHtml(customer.name || "Customer", resetUrl),
      text: buildResetEmailText(customer.name || "Customer", resetUrl),
    });

    return createSuccessResponse({
      message:
        "If an account exists with this email, a password reset link has been sent.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}

function buildResetEmailHtml(name: string, resetUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Reset Your Password</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Reset Your Password</h1>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px;">Hi ${name},</p>
          
          <p style="font-size: 16px;">
            We received a request to reset your password. Click the button below to create a new password:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background: #667eea; color: white; padding: 14px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Reset Password
            </a>
          </div>
          
          <p style="font-size: 14px; color: #666;">
            This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
          
          <p style="font-size: 14px; color: #666;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="font-size: 12px; color: #667eea; word-break: break-all;">
            ${resetUrl}
          </p>
        </div>
      </body>
    </html>
  `;
}

function buildResetEmailText(name: string, resetUrl: string): string {
  return `
Hi ${name},

We received a request to reset your password. Click the link below to create a new password:

${resetUrl}

This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
  `.trim();
}
