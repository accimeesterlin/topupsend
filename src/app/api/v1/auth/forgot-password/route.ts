import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { User, Organization } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';
import { ApiErrors, handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { EmailService } from '@/lib/services/email.service';
import { forgotPasswordSchema } from '@/types/auth-validation';
import crypto from 'crypto';

/**
 * POST /api/v1/auth/forgot-password
 * Request password reset email
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body with Zod
    const validationResult = forgotPasswordSchema.safeParse(body);

    if (!validationResult.success) {
      const errorMessage = validationResult.error.errors[0]?.message || 'Invalid request data';
      throw ApiErrors.BadRequest(errorMessage, {
        validationErrors: validationResult.error.errors,
      });
    }

    const { email } = validationResult.data;

    await dbConnection.connect();

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always return success even if user not found (security best practice)
    // This prevents email enumeration attacks
    if (!user) {
      logger.info('Password reset requested for non-existent email', { email });
      return createSuccessResponse({
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    }

    // Check if user is active
    if (!user.isActive) {
      logger.warn('Password reset requested for inactive user', { email });
      return createSuccessResponse({
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    }

    // Generate reset token (cryptographically secure random string)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Set token expiration (1 hour from now)
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000);

    // Save hashed token to user record
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = tokenExpires;
    await user.save();

    // Get organization name for email
    const organization = await Organization.findById(user.orgId);
    const orgName = organization?.name || 'Prepaid Minutes Platform';

    // Send password reset email
    try {
      await EmailService.sendPasswordResetEmail(
        user.orgId.toString(),
        user.email,
        resetToken, // Send unhashed token in email
        orgName
      );

      logger.info('Password reset email sent', {
        userId: user._id,
        email: user.email,
        orgId: user.orgId,
      });
    } catch (emailError) {
      const errorMessage = emailError instanceof Error ? emailError.message : 'Unknown error';
      logger.error('Failed to send password reset email', {
        error: errorMessage,
        userId: user._id,
        email: user.email,
      });

      // Clear the reset token since we couldn't send the email
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      throw ApiErrors.InternalServerError('Failed to send password reset email. Please try again later.');
    }

    return createSuccessResponse({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    logger.error('Forgot password error', { error });
    return handleApiError(error);
  }
}
