import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { User } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';
import { ApiErrors, handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { hashPassword } from '@/lib/auth';
import { resetPasswordSchema, verifyResetTokenSchema } from '@/types/auth-validation';
import crypto from 'crypto';

/**
 * POST /api/v1/auth/reset-password
 * Reset password using token
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body with Zod
    const validationResult = resetPasswordSchema.safeParse(body);

    if (!validationResult.success) {
      const errorMessage = validationResult.error.errors[0]?.message || 'Invalid request data';
      throw ApiErrors.BadRequest(errorMessage, {
        validationErrors: validationResult.error.errors,
      });
    }

    const { token, password } = validationResult.data;

    await dbConnection.connect();

    // Hash the token to match stored value
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() }, // Token not expired
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw ApiErrors.BadRequest('Invalid or expired reset token');
    }

    // Check if user is active
    if (!user.isActive) {
      throw ApiErrors.Forbidden('Account is not active');
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update user password and clear reset token
    user.passwordHash = passwordHash;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    logger.info('Password reset successful', {
      userId: user._id,
      email: user.email,
    });

    return createSuccessResponse({
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    logger.error('Reset password error', { error });
    return handleApiError(error);
  }
}

/**
 * GET /api/v1/auth/reset-password?token=xyz
 * Verify reset token validity
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    // Validate query parameters with Zod
    const validationResult = verifyResetTokenSchema.safeParse({ token });

    if (!validationResult.success) {
      const errorMessage = validationResult.error.errors[0]?.message || 'Invalid request data';
      throw ApiErrors.BadRequest(errorMessage, {
        validationErrors: validationResult.error.errors,
      });
    }

    const { token: validatedToken } = validationResult.data;

    await dbConnection.connect();

    // Hash the token to match stored value
    const hashedToken = crypto.createHash('sha256').update(validatedToken).digest('hex');

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw ApiErrors.BadRequest('Invalid or expired reset token');
    }

    if (!user.isActive) {
      throw ApiErrors.Forbidden('Account is not active');
    }

    return createSuccessResponse({
      valid: true,
      email: user.email,
    });
  } catch (error) {
    logger.error('Verify reset token error', { error });
    return handleApiError(error);
  }
}
