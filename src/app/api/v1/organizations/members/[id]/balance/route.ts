import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { UserOrganization } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth-middleware';
import { UserRole } from '@topupsend/types';

/**
 * PATCH /api/v1/organizations/members/[id]/balance
 * Update team member's balance limit (admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: memberId } = await params;
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Only admins can update balance limits
    if (!session.roles.includes(UserRole.ADMIN)) {
      return createErrorResponse('Only administrators can manage team member balances', 403);
    }

    const body = await request.json();
    const { enabled, maxBalance } = body;

    if (typeof enabled !== 'boolean') {
      return createErrorResponse('enabled must be a boolean', 400);
    }

    if (enabled && (typeof maxBalance !== 'number' || maxBalance < 0)) {
      return createErrorResponse('maxBalance must be a positive number when enabled', 400);
    }

    // Find the user organization record
    const userOrg = await UserOrganization.findOne({
      _id: memberId,
      orgId: session.orgId,
    });

    if (!userOrg) {
      return createErrorResponse('Team member not found', 404);
    }

    // Don't allow setting limits on admin users
    if (userOrg.roles.includes(UserRole.ADMIN)) {
      return createErrorResponse('Cannot set balance limits on administrators', 400);
    }

    // Update balance limit
    userOrg.balanceLimit = {
      enabled,
      maxBalance: enabled ? maxBalance : 0,
      currentUsed: userOrg.balanceLimit?.currentUsed || 0,
    };

    await userOrg.save();

    return createSuccessResponse({
      message: 'Balance limit updated successfully',
      balanceLimit: userOrg.balanceLimit,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/v1/organizations/members/[id]/balance/reset
 * Reset team member's used balance to zero (admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: memberId } = await params;
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Only admins can reset balances
    if (!session.roles.includes(UserRole.ADMIN)) {
      return createErrorResponse('Only administrators can reset team member balances', 403);
    }

    // Find the user organization record
    const userOrg = await UserOrganization.findOne({
      _id: memberId,
      orgId: session.orgId,
    });

    if (!userOrg) {
      return createErrorResponse('Team member not found', 404);
    }

    await userOrg.resetBalance(new (await import('mongoose')).Types.ObjectId(session.userId));

    return createSuccessResponse({
      message: 'Balance reset successfully',
      balanceLimit: userOrg.balanceLimit,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
