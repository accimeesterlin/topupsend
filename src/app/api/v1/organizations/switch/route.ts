import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { UserOrganization, User } from '@topupsend/db';
import { createToken, createSessionCookie } from '@/lib/auth';
import { ApiErrors, handleApiError } from '@/lib/api-error';
import { createSuccessResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

const switchOrgSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
});

/**
 * POST /api/v1/organizations/switch
 * Switch the user's active organization context
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Parse and validate request body
    const body = await request.json();
    const validation = switchOrgSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      throw ApiErrors.UnprocessableEntity('Validation failed', { errors });
    }

    const { orgId } = validation.data;

    // Verify user has access to this organization
    const userOrg = await UserOrganization.findOne({
      userId: session.userId,
      orgId: orgId,
      isActive: true,
    });

    if (!userOrg) {
      throw ApiErrors.Forbidden('You do not have access to this organization');
    }

    // Get user data for new token
    const user = await User.findById(session.userId);
    if (!user) {
      throw ApiErrors.NotFound('User not found');
    }

    // Create new session token with updated orgId and roles
    const token = await createToken({
      userId: session.userId,
      email: session.email,
      roles: userOrg.roles, // Use roles from the specific organization
      orgId: orgId,
    });

    logger.info('User switched organization', {
      userId: session.userId,
      fromOrgId: session.orgId,
      toOrgId: orgId,
    });

    // Create response with new session cookie
    const response = createSuccessResponse({
      message: 'Organization switched successfully',
      user: {
        id: user._id.toString(),
        email: user.email,
        roles: userOrg.roles,
        orgId: orgId,
      },
    });

    response.headers.set('Set-Cookie', createSessionCookie(token));

    return response;
  } catch (error) {
    logger.error('Error switching organization', { error });
    return handleApiError(error);
  }
}
