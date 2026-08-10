import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { UserOrganization } from '@topupsend/db';
import { UserRole, Permission } from '@topupsend/types';
import { ApiErrors, handleApiError } from '@/lib/api-error';
import { createSuccessResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

const updateMemberSchema = z.object({
  roles: z
    .array(z.enum([UserRole.ADMIN, UserRole.OPERATOR, UserRole.VIEWER]))
    .min(1, 'At least one role is required')
    .optional(),
  customPermissions: z
    .array(z.nativeEnum(Permission))
    .optional(),
  balanceLimit: z
    .object({
      enabled: z.boolean(),
      maxBalance: z.number().min(0),
    })
    .optional(),
});

/**
 * PATCH /api/v1/organizations/members/[id]
 * Update a team member's roles or balance limit
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const params = await context.params;
    const memberId = params.id;

    // Parse and validate request body
    const body = await request.json();
    const validation = updateMemberSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      throw ApiErrors.UnprocessableEntity('Validation failed', { errors });
    }

    const { roles, customPermissions, balanceLimit } = validation.data;

    // Find the member to update
    const member = await UserOrganization.findById(memberId);
    if (!member) {
      throw ApiErrors.NotFound('Team member not found');
    }

    // Verify the requester has admin role in the organization
    const requesterOrgRecord = await UserOrganization.findOne({
      userId: session.userId,
      orgId: member.orgId,
      isActive: true,
    });

    if (!requesterOrgRecord || !requesterOrgRecord.roles.includes(UserRole.ADMIN)) {
      throw ApiErrors.Forbidden('Only admins can update team members');
    }

    // Prevent self-role modification if removing admin role
    if (
      member.userId.toString() === session.userId &&
      roles &&
      !roles.includes(UserRole.ADMIN)
    ) {
      throw ApiErrors.Forbidden('You cannot remove your own admin role');
    }

    // Update roles if provided
    if (roles) {
      member.roles = roles;
    }

    // Update custom permissions if provided
    if (customPermissions !== undefined) {
      member.customPermissions = customPermissions;
    }

    // Update balance limit if provided
    if (balanceLimit !== undefined) {
      member.balanceLimit = {
        enabled: balanceLimit.enabled,
        maxBalance: balanceLimit.maxBalance,
        currentUsed: member.balanceLimit?.currentUsed || 0,
      };
    }

    await member.save();

    logger.info('Team member updated', {
      memberId,
      orgId: member.orgId.toString(),
      updatedBy: session.userId,
      changes: { roles, customPermissions, balanceLimit },
    });

    return createSuccessResponse({
      message: 'Team member updated successfully',
      member: {
        id: String(member._id),
        roles: member.roles,
        customPermissions: member.customPermissions,
        balanceLimit: member.balanceLimit,
      },
    });
  } catch (error) {
    logger.error('Error updating team member', { error });
    return handleApiError(error);
  }
}

/**
 * DELETE /api/v1/organizations/members/[id]
 * Remove a team member from the organization
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const params = await context.params;
    const memberId = params.id;

    // Find the member to remove
    const member = await UserOrganization.findById(memberId);
    if (!member) {
      throw ApiErrors.NotFound('Team member not found');
    }

    // Verify the requester has admin role in the organization
    const requesterOrgRecord = await UserOrganization.findOne({
      userId: session.userId,
      orgId: member.orgId,
      isActive: true,
    });

    if (!requesterOrgRecord || !requesterOrgRecord.roles.includes(UserRole.ADMIN)) {
      throw ApiErrors.Forbidden('Only admins can remove team members');
    }

    // Prevent self-removal if only admin
    if (member.userId.toString() === session.userId) {
      const adminCount = await UserOrganization.countDocuments({
        orgId: member.orgId,
        isActive: true,
        roles: UserRole.ADMIN,
      });

      if (adminCount === 1) {
        throw ApiErrors.Forbidden('Cannot remove yourself as the only admin');
      }
    }

    // Deactivate the member (soft delete)
    member.isActive = false;
    await member.save();

    logger.info('Team member removed', {
      memberId,
      orgId: member.orgId.toString(),
      removedBy: session.userId,
    });

    return createSuccessResponse({
      message: 'Team member removed successfully',
    });
  } catch (error) {
    logger.error('Error removing team member', { error });
    return handleApiError(error);
  }
}
