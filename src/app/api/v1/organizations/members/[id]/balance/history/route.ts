import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { BalanceHistory, UserOrganization } from '@topupsend/db';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth-middleware';
import { UserRole } from '@topupsend/types';

/**
 * GET /api/v1/organizations/members/[id]/balance/history
 * Get balance usage history for a team member (admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: memberId } = await params;
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Only admins can view balance history
    if (!session.roles.includes(UserRole.ADMIN)) {
      return createErrorResponse('Only administrators can view team member balance history', 403);
    }

    // Verify the member belongs to this organization
    const userOrg = await UserOrganization.findOne({
      _id: memberId,
      orgId: session.orgId,
    });

    if (!userOrg) {
      return createErrorResponse('Team member not found', 404);
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Fetch balance history
    const history = await BalanceHistory.find({
      userOrgId: memberId,
      orgId: session.orgId,
    })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(Math.min(limit, 100)) // Max 100 records per page
      .populate('metadata.adminId', 'email')
      .lean();

    // Get total count
    const total = await BalanceHistory.countDocuments({
      userOrgId: memberId,
      orgId: session.orgId,
    });

    const formattedHistory = history.map((record: any) => ({
      id: record._id.toString(),
      amount: record.amount,
      type: record.type,
      previousBalance: record.previousBalance,
      newBalance: record.newBalance,
      description: record.description,
      metadata: {
        phoneNumber: record.metadata?.phoneNumber,
        productName: record.metadata?.productName,
        orderId: record.metadata?.orderId,
        adminEmail: record.metadata?.adminId?.email,
      },
      createdAt: record.createdAt,
    }));

    return createSuccessResponse({
      history: formattedHistory,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
