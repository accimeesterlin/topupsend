import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { UserOrganization } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/organizations
 * List all organizations the current user belongs to
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    logger.info('Fetching organizations for user', {
      userId: session.userId,
      currentOrgId: session.orgId,
    });

    // Find all organizations the user belongs to
    const userOrgs = await UserOrganization.find({
      userId: session.userId,
      isActive: true,
    })
      .populate('orgId')
      .sort({ joinedAt: -1 });

    logger.info('Found UserOrganization records', {
      count: userOrgs.length,
      userOrgs: userOrgs.map(uo => ({
        id: uo._id?.toString(),
        orgId: uo.orgId,
        roles: uo.roles,
      })),
    });

    const organizations = userOrgs
      .filter((userOrg) => userOrg.orgId != null) // Filter out null populates
      .map((userOrg) => {
        const org = userOrg.orgId as any;
        return {
          id: org._id.toString(),
          name: org.name,
          slug: org.slug,
          roles: userOrg.roles,
          isActive: userOrg.isActive,
          joinedAt: userOrg.joinedAt,
          isCurrent: org._id.toString() === session.orgId,
        };
      });

    logger.info('Listed user organizations', {
      userId: session.userId,
      count: organizations.length,
      organizations: organizations.map(o => ({ id: o.id, name: o.name, isCurrent: o.isCurrent })),
    });

    return createSuccessResponse({ organizations });
  } catch (error) {
    logger.error('Error listing organizations', { error });
    return handleApiError(error);
  }
}
