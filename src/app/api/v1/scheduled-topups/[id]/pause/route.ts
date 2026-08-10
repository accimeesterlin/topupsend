/**
 * API Route for Pausing a Scheduled Top-up
 * POST /api/v1/scheduled-topups/[id]/pause
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { toggleSchedulePause } from '@/lib/services/scheduled-topups.service';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/v1/scheduled-topups/[id]/pause
 * Pause a scheduled top-up
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;

    const schedule = await toggleSchedulePause(id, session.orgId, true);

    logger.info('Scheduled top-up paused via API', {
      scheduleId: id,
      orgId: session.orgId,
    });

    return createSuccessResponse({
      message: 'Scheduled top-up paused successfully',
      status: schedule.status,
    });
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to pause scheduled top-up', { error: errorMessage });
    return createErrorResponse(errorMessage, 500);
  }
}
