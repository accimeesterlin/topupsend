/**
 * API Route for Resuming a Scheduled Top-up
 * POST /api/v1/scheduled-topups/[id]/resume
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { ApiErrors, ApiException, handleApiError } from '@/lib/api-error';
import { hasPermission } from '@/lib/permissions';
import { Permission } from '@topupsend/types';
import { toggleSchedulePause } from '@/lib/services/scheduled-topups.service';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/v1/scheduled-topups/[id]/resume
 * Resume a paused scheduled top-up
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    // M2: mutations commit or control org-wallet spend — admin-tier.
    if (!hasPermission(session.roles, Permission.MANAGE_SCHEDULED_TOPUPS)) {
      throw ApiErrors.Forbidden(
        'You do not have permission to manage scheduled top-ups'
      );
    }
    const { id } = await params;

    const schedule = await toggleSchedulePause(id, session.orgId, false);

    logger.info('Scheduled top-up resumed via API', {
      scheduleId: id,
      orgId: session.orgId,
    });

    return createSuccessResponse({
      message: 'Scheduled top-up resumed successfully',
      status: schedule.status,
      nextExecutionAt: schedule.nextExecutionAt?.toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof ApiException) {
      return handleApiError(error);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to resume scheduled top-up', { error: errorMessage });
    return createErrorResponse(errorMessage, 500);
  }
}
