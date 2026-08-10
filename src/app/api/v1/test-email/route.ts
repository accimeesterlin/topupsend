import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { EmailService } from '@/lib/services/email.service';
import { createSuccessResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/test-email
 * Test email sending with detailed error reporting
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);

    const body = await request.json();
    const { to, subject, message } = body;

    if (!to || !subject || !message) {
      return createSuccessResponse(
        {
          success: false,
          error: 'Missing required fields: to, subject, message',
        },
        400
      );
    }

    logger.info('Testing email send', {
      orgId: session.orgId,
      to,
      subject,
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test Email</title>
</head>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <h2>Test Email</h2>
  <p>${message}</p>
  <p style="color: #666; font-size: 12px; margin-top: 30px;">
    This is a test email sent from TopUpSend platform.
  </p>
</body>
</html>
    `;

    const text = `Test Email\n\n${message}\n\nThis is a test email sent from TopUpSend platform.`;

    try {
      await EmailService.sendEmail(session.orgId, {
        to,
        subject,
        html,
        text,
      });

      logger.info('Test email sent successfully', { to, subject });

      return createSuccessResponse({
        success: true,
        message: 'Test email sent successfully',
        details: {
          to,
          subject,
          orgId: session.orgId,
        },
      });
    } catch (emailError: any) {
      logger.error('Test email failed', {
        error: emailError.message,
        stack: emailError.stack,
        to,
        subject,
        orgId: session.orgId,
      });

      return createSuccessResponse(
        {
          success: false,
          error: 'Email sending failed',
          details: {
            message: emailError.message,
            stack: emailError.stack,
            to,
            subject,
            orgId: session.orgId,
          },
        },
        500
      );
    }
  } catch (error) {
    logger.error('Test email endpoint error', { error });
    return handleApiError(error);
  }
}
