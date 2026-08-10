import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { createSuccessResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { dbConnection } from '@topupsend/db/connection';
import { UserOrganization, User } from '@topupsend/db';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Get user's organization membership to include balance info
    const userOrg = await UserOrganization.findOne({
      userId: session.userId,
      orgId: session.orgId,
      isActive: true,
    });

    // Get user's 2FA status
    const user = await User.findById(session.userId);

    return createSuccessResponse({
      id: session.userId,
      email: session.email,
      roles: session.roles,
      orgId: session.orgId,
      balanceLimit: userOrg?.balanceLimit || null,
      twoFactorEnabled: user?.twoFactorEnabled || false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
