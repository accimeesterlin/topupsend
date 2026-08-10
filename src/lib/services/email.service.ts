import { dbConnection } from "@topupsend/db/connection";
import { Integration } from "@topupsend/db";
import sgMail from "@sendgrid/mail";
import Mailgun from "mailgun.js";
import formData from "form-data";
import mailchimp from "@mailchimp/mailchimp_transactional";
// @ts-expect-error - zeptomail package has types but doesn't export them properly
import { SendMailClient } from "zeptomail";
import { logger } from "@/lib/logger";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  /**
   * Get the primary email provider for an organization
   * Falls back to ZeptoMail using environment variables if no primary provider is configured
   */
  private static async getPrimaryEmailProvider(orgId: string) {
    await dbConnection.connect();

    const primaryProvider = await Integration.findOne({
      orgId,
      isPrimaryEmail: true,
      status: "active",
    }).select(
      "+credentials.apiKey +credentials.domain +credentials.fromEmail +credentials.fromName",
    );

    if (!primaryProvider) {
      // Fallback to ZeptoMail using environment variables
      const zeptoApiKey = process.env.ZEPTOMAIL_API_KEY;
      const zeptoFromEmail = process.env.ZEPTOMAIL_FROM_EMAIL;
      const zeptoFromName =
        process.env.ZEPTOMAIL_FROM_NAME || "Prepaid Minutes Platform";

      if (!zeptoApiKey || !zeptoFromEmail) {
        throw new Error(
          "No primary email provider configured and ZeptoMail environment variables (ZEPTOMAIL_API_KEY, ZEPTOMAIL_FROM_EMAIL) are not set",
        );
      }

      logger.info("Using ZeptoMail fallback from environment variables", {
        orgId,
      });

      // Return a mock integration object for ZeptoMail
      return {
        provider: "zeptomail",
        credentials: {
          apiKey: zeptoApiKey,
          fromEmail: zeptoFromEmail,
          fromName: zeptoFromName,
        },
      } as any;
    }

    return primaryProvider;
  }

  /**
   * Send email using ZeptoMail
   */
  private static async sendWithZeptoMail(
    credentials: any,
    options: EmailOptions,
  ): Promise<void> {
    try {
      // Initialize ZeptoMail client with API token
      const client = new SendMailClient({
        url: "api.zeptomail.com/",
        token: credentials.apiKey.trim(),
      });

      // Send email using the official SDK
      const response = await client.sendMail({
        from: {
          address: credentials.fromEmail,
          name: credentials.fromName || "No Reply",
        },
        to: [
          {
            email_address: {
              address: options.to,
            },
          },
        ],
        subject: options.subject,
        htmlbody: options.html,
        textbody: options.text || "",
      });

      logger.info("Email sent via ZeptoMail", {
        to: options.to,
        subject: options.subject,
        response,
      });
    } catch (error: any) {
      logger.error("ZeptoMail API Error Details", {
        error: error.message,
        to: options.to,
        from: credentials.fromEmail,
        subject: options.subject,
      });
      throw new Error(`ZeptoMail error: ${error.message}`);
    }
  }

  /**
   * Send email using Mailgun
   */
  private static async sendWithMailgun(
    credentials: any,
    options: EmailOptions,
  ): Promise<void> {
    const mailgun = new Mailgun(formData);
    const mg = mailgun.client({
      username: "api",
      key: credentials.apiKey,
    });

    await mg.messages.create(credentials.domain, {
      from: `${credentials.fromName || "No Reply"} <${credentials.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      text: options.text || "",
      html: options.html,
    });

    logger.info("Email sent via Mailgun", {
      to: options.to,
      subject: options.subject,
    });
  }

  /**
   * Send email using SendGrid
   */
  private static async sendWithSendGrid(
    credentials: any,
    options: EmailOptions,
  ): Promise<void> {
    sgMail.setApiKey(credentials.apiKey);

    await sgMail.send({
      to: options.to,
      from: {
        email: credentials.fromEmail,
        name: credentials.fromName || "No Reply",
      },
      subject: options.subject,
      text: options.text || "",
      html: options.html,
    });

    logger.info("Email sent via SendGrid", {
      to: options.to,
      subject: options.subject,
    });
  }

  /**
   * Send email using Mailchimp Transactional
   */
  private static async sendWithMailchimp(
    credentials: any,
    options: EmailOptions,
  ): Promise<void> {
    const mailchimpClient = mailchimp(credentials.apiKey);

    await mailchimpClient.messages.send({
      message: {
        from_email: credentials.fromEmail,
        from_name: credentials.fromName || "No Reply",
        to: [{ email: options.to }],
        subject: options.subject,
        text: options.text || "",
        html: options.html,
      },
    });

    logger.info("Email sent via Mailchimp", {
      to: options.to,
      subject: options.subject,
    });
  }

  /**
   * Send email using the primary email provider
   */
  static async sendEmail(orgId: string, options: EmailOptions): Promise<void> {
    try {
      const provider = await this.getPrimaryEmailProvider(orgId);

      logger.info("Sending email", {
        orgId,
        provider: provider.provider,
        to: options.to,
        subject: options.subject,
      });

      switch (provider.provider) {
        case "zeptomail":
          await this.sendWithZeptoMail(provider.credentials, options);
          break;

        case "mailgun":
          await this.sendWithMailgun(provider.credentials, options);
          break;

        case "sendgrid":
          await this.sendWithSendGrid(provider.credentials, options);
          break;

        case "mailchimp":
          await this.sendWithMailchimp(provider.credentials, options);
          break;

        default:
          throw new Error(`Unsupported email provider: ${provider.provider}`);
      }
    } catch (error: any) {
      logger.error("Failed to send email", {
        error: error.message,
        orgId,
        options,
      });
      throw error;
    }
  }

  /**
   * Send team invitation email
   */
  static async sendTeamInvitationEmail(
    orgId: string,
    recipientEmail: string,
    inviterName: string,
    orgName: string,
    tempPassword?: string,
  ): Promise<void> {
    const subject = `You've been invited to join ${orgName}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Team Invitation</h1>
  </div>

  <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Hello!
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      <strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on our prepaid minutes platform.
    </p>

    ${
      tempPassword
        ? `
    <div style="background: #f9fafb; border-left: 4px solid #667eea; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="margin: 0 0 12px 0; font-weight: 600; color: #374151;">Your Temporary Password:</p>
      <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 18px; color: #667eea; letter-spacing: 1px;">
        <strong>${tempPassword}</strong>
      </p>
      <p style="margin: 12px 0 0 0; font-size: 14px; color: #6b7280;">
        Please change this password after your first login for security.
      </p>
    </div>
    `
        : ""
    }

    <div style="text-align: center; margin: 32px 0;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://prepaid.pgecom.com"}/login"
         style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Log In Now
      </a>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
      If you have any questions, please don't hesitate to reach out to your team administrator.
    </p>

    <p style="font-size: 14px; color: #6b7280; margin-top: 16px;">
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
You've been invited to join ${orgName}

${inviterName} has invited you to join ${orgName} on our prepaid minutes platform.

${tempPassword ? `Your temporary password: ${tempPassword}\n\nPlease change this password after your first login for security.\n` : ""}

Log in at: ${process.env.NEXT_PUBLIC_APP_URL || "https://prepaid.pgecom.com"}/login

If you have any questions, please reach out to your team administrator.

Best regards,
The ${orgName} Team
    `.trim();

    await this.sendEmail(orgId, {
      to: recipientEmail,
      subject,
      html,
      text,
    });
  }

  /**
   * Send password reset email
   */
  static async sendPasswordResetEmail(
    orgId: string,
    recipientEmail: string,
    resetToken: string,
    orgName: string,
  ): Promise<void> {
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://prepaid.pgecom.com"}/reset-password?token=${resetToken}`;
    const subject = "Reset Your Password";

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Password Reset</h1>
  </div>

  <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      Hello,
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      We received a request to reset your password for your ${orgName} account.
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${resetUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Reset Password
      </a>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-top: 32px;">
      If you didn't request this password reset, you can safely ignore this email. Your password will not be changed.
    </p>

    <p style="font-size: 14px; color: #6b7280; margin-top: 16px;">
      This link will expire in 1 hour for security reasons.
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
Password Reset

We received a request to reset your password for your ${orgName} account.

Reset your password at: ${resetUrl}

If you didn't request this password reset, you can safely ignore this email. Your password will not be changed.

This link will expire in 1 hour for security reasons.

Best regards,
The ${orgName} Team
    `.trim();

    await this.sendEmail(orgId, {
      to: recipientEmail,
      subject,
      html,
      text,
    });
  }

  /**
   * Send refund notification email to customer
   */
  static async sendRefundNotificationEmail(params: {
    orgId: string;
    recipientEmail: string;
    customerName?: string;
    orgName: string;
    orderId: string;
    refundAmount: number;
    currency: string;
    newBalance: number;
    loginUrl: string;
  }): Promise<void> {
    const {
      orgId,
      recipientEmail,
      customerName,
      orgName,
      orderId,
      refundAmount,
      currency,
      newBalance,
      loginUrl,
    } = params;

    const greeting = customerName ? `Hello ${customerName},` : "Hello,";
    const subject = `Your top-up order ${orderId} has been refunded`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refund Notification</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Refund Processed</h1>
  </div>

  <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-bottom: 20px;">
      ${greeting}
    </p>

    <p style="font-size: 16px; margin-bottom: 20px;">
      We were unable to complete your top-up order <strong>${orderId}</strong>. A refund of <strong>${currency} ${refundAmount.toFixed(2)}</strong> has been credited to your account balance.
    </p>

    <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="margin: 0 0 8px 0; font-weight: 600; color: #374151;">Refund Summary</p>
      <table style="width: 100%; font-size: 14px; color: #374151;">
        <tr>
          <td style="padding: 4px 0;">Order ID:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600;">${orderId}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">Refund Amount:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #22c55e;">${currency} ${refundAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">New Account Balance:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600;">${currency} ${newBalance.toFixed(2)}</td>
        </tr>
      </table>
    </div>

    <p style="font-size: 16px; margin-bottom: 20px;">
      You can log in to your account to use your balance and try your top-up again.
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${loginUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Log In to Your Account
      </a>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
      If you have any questions about this refund, please don't hesitate to contact our support team.
    </p>

    <p style="font-size: 14px; color: #6b7280; margin-top: 16px;">
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
Refund Processed

${greeting}

We were unable to complete your top-up order ${orderId}. A refund of ${currency} ${refundAmount.toFixed(2)} has been credited to your account balance.

Refund Summary:
- Order ID: ${orderId}
- Refund Amount: ${currency} ${refundAmount.toFixed(2)}
- New Account Balance: ${currency} ${newBalance.toFixed(2)}

You can log in to your account to use your balance and try your top-up again:
${loginUrl}

If you have any questions about this refund, please contact our support team.

Best regards,
The ${orgName} Team
    `.trim();

    await this.sendEmail(orgId, {
      to: recipientEmail,
      subject,
      html,
      text,
    });
  }
}

// Export wrapper function for compatibility
export async function sendEmail(
  orgId: string,
  options: EmailOptions,
): Promise<void> {
  return EmailService.sendEmail(orgId, options);
}
