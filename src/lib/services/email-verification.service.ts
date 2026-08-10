/**
 * Email Verification Service
 * Handles customer email verification with token generation and validation
 */

import crypto from "crypto";
import { Customer, type ICustomer } from "@topupsend/db";
import { sendEmail } from "./email.service";

export interface VerificationTokenData {
  token: string;
  expiry: Date;
}

export class EmailVerificationService {
  // Token valid for 24 hours
  private readonly TOKEN_EXPIRY_HOURS = 24;

  // Resend cooldown: 5 minutes
  private readonly RESEND_COOLDOWN_MS = 5 * 60 * 1000;

  private lastSentMap: Map<string, number> = new Map();

  /**
   * Generate a verification token
   */
  generateToken(): VerificationTokenData {
    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + this.TOKEN_EXPIRY_HOURS);

    return { token, expiry };
  }

  /**
   * Send verification email to customer
   */
  async sendVerificationEmail(
    customer: ICustomer,
    orgSlug: string,
    baseUrl: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!customer.email) {
      return { success: false, error: "Customer email not found" };
    }

    // Check cooldown
    const customerId = String(customer._id);
    const lastSent = this.lastSentMap.get(customerId);
    if (lastSent && Date.now() - lastSent < this.RESEND_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil(
        (this.RESEND_COOLDOWN_MS - (Date.now() - lastSent)) / 1000,
      );
      return {
        success: false,
        error: `Please wait ${remainingSeconds} seconds before resending`,
      };
    }

    // Generate token
    const { token, expiry } = this.generateToken();

    // Save token to customer
    customer.verificationToken = token;
    customer.verificationTokenExpiry = expiry;
    await customer.save();

    // Build verification URL
    const verificationUrl = `${baseUrl}/customer-portal/${orgSlug}/verify-email?token=${token}&email=${encodeURIComponent(customer.email)}`;

    // Send email
    try {
      await sendEmail(customer.orgId, {
        to: customer.email,
        subject: "Verify Your Email Address",
        html: this.buildVerificationEmailHtml(
          customer.name || "Customer",
          verificationUrl,
          this.TOKEN_EXPIRY_HOURS,
        ),
        text: this.buildVerificationEmailText(
          customer.name || "Customer",
          verificationUrl,
          this.TOKEN_EXPIRY_HOURS,
        ),
      });

      // Update cooldown
      this.lastSentMap.set(String(customer._id), Date.now());

      return { success: true };
    } catch (error) {
      console.error("Failed to send verification email:", error);
      return { success: false, error: "Failed to send verification email" };
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(
    email: string,
    token: string,
    orgId: string,
  ): Promise<{ success: boolean; error?: string; customer?: ICustomer }> {
    // Find customer with matching email, token, and org
    const customer = await Customer.findOne({
      email: email.toLowerCase(),
      orgId,
      verificationToken: token,
      emailVerified: false,
    }).select("+verificationToken +verificationTokenExpiry");

    if (!customer) {
      return { success: false, error: "Invalid verification link" };
    }

    // Check if token is expired
    if (
      customer.verificationTokenExpiry &&
      customer.verificationTokenExpiry < new Date()
    ) {
      return {
        success: false,
        error: "Verification link has expired. Please request a new one.",
      };
    }

    // Mark as verified
    customer.emailVerified = true;
    customer.verificationToken = undefined;
    customer.verificationTokenExpiry = undefined;
    await customer.save();

    // Remove from cooldown map
    this.lastSentMap.delete(String(customer._id));

    return { success: true, customer };
  }

  /**
   * Check if customer needs verification
   */
  async needsVerification(customerId: string): Promise<boolean> {
    const customer =
      await Customer.findById(customerId).select("emailVerified");
    return customer ? !customer.emailVerified : true;
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(
    customerId: string,
    orgSlug: string,
    baseUrl: string,
  ): Promise<{ success: boolean; error?: string }> {
    const customer = await Customer.findById(customerId);

    if (!customer) {
      return { success: false, error: "Customer not found" };
    }

    if (customer.emailVerified) {
      return { success: false, error: "Email already verified" };
    }

    return this.sendVerificationEmail(customer, orgSlug, baseUrl);
  }

  /**
   * Build HTML email template
   */
  private buildVerificationEmailHtml(
    name: string,
    verificationUrl: string,
    expiryHours: number,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Verify Your Email</h1>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <p style="font-size: 16px;">Hi ${name},</p>
            
            <p style="font-size: 16px;">
              Thank you for creating an account! Please verify your email address to get started.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background: #667eea; color: white; padding: 14px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Verify Email Address
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              This link will expire in ${expiryHours} hours. If you didn't create an account, you can safely ignore this email.
            </p>
            
            <p style="font-size: 14px; color: #666;">
              If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p style="font-size: 12px; color: #667eea; word-break: break-all;">
              ${verificationUrl}
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; padding: 20px; color: #999; font-size: 12px;">
            <p>© ${new Date().getFullYear()} Prepaid Minutes. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Build plain text email template
   */
  private buildVerificationEmailText(
    name: string,
    verificationUrl: string,
    expiryHours: number,
  ): string {
    return `
Hi ${name},

Thank you for creating an account! Please verify your email address to get started.

Click the link below to verify your email:
${verificationUrl}

This link will expire in ${expiryHours} hours. If you didn't create an account, you can safely ignore this email.

© ${new Date().getFullYear()} Prepaid Minutes. All rights reserved.
    `.trim();
  }
}

// Singleton instance
export const emailVerificationService = new EmailVerificationService();
