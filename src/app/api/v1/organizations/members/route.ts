import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { UserOrganization } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/organizations/members
 * List all members of the current organization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Get organization ID from query params or use current session org
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId') || session.orgId;

    // Verify user has access to this organization
    const userOrg = await UserOrganization.findOne({
      userId: session.userId,
      orgId: orgId,
      isActive: true,
    });

    if (!userOrg) {
      throw new Error('You do not have access to this organization');
    }

    // Find all members of the organization
    const members = await UserOrganization.find({
      orgId: orgId,
      isActive: true,
    })
      .populate('userId', 'email isActive')
      .populate('invitedBy', 'email')
      .sort({ joinedAt: 1 });

    const membersList = members.map((member) => {
      const user = member.userId as any;
      const inviter = member.invitedBy as any;

      return {
        id: member._id?.toString(),
        user: {
          id: user._id.toString(),
          email: user.email,
          isActive: user.isActive,
        },
        roles: member.roles,
        joinedAt: member.joinedAt,
        invitedBy: inviter
          ? {
              id: inviter._id.toString(),
              email: inviter.email,
            }
          : null,
        invitedAt: member.invitedAt,
        balanceLimit: member.balanceLimit || undefined,
      };
    });

    logger.info('Listed organization members', {
      orgId: orgId,
      count: membersList.length,
      requestedBy: session.userId,
    });

    return createSuccessResponse({ members: membersList });
  } catch (error) {
    logger.error('Error listing organization members', { error });
    return handleApiError(error);
  }
}
