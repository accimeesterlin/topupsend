/**
 * API Routes for Individual Scheduled Top-up
 * GET /api/v1/scheduled-topups/[id] - Get schedule details
 * PATCH /api/v1/scheduled-topups/[id] - Update schedule
 * DELETE /api/v1/scheduled-topups/[id] - Cancel schedule
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { ApiErrors } from '@/lib/api-error';
import { dbConnection, ScheduledTopup, Transaction } from '@topupsend/db';
import {
  updateScheduledTopup,
  cancelScheduledTopup,
  getUpcomingExecutions,
} from '@/lib/services/scheduled-topups.service';
import type {
  UpdateScheduledTopupRequest,
  DetailedScheduledTopupResponse,
} from '@/types/scheduled-topups';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * GET /api/v1/scheduled-topups/[id]
 * Get detailed information about a scheduled top-up
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    const { id } = await params;
    const schedule = await ScheduledTopup.findOne({
      _id: id,
      organizationId: session.orgId,
    });

    if (!schedule) {
      throw ApiErrors.NotFound('Scheduled top-up not found');
    }

      // Fetch transaction details
      const transactions = await Transaction.find({
        _id: { $in: schedule.transactions },
      })
        .select('_id status amount createdAt')
        .sort({ createdAt: -1 })
        .limit(10);

      // Calculate upcoming executions
      const upcomingExecutions = getUpcomingExecutions(schedule, 5);

      const response: DetailedScheduledTopupResponse = {
        id: schedule._id.toString(),
        organizationId: schedule.organizationId.toString(),
        customerId: schedule.customerId?.toString(),
        createdBy: schedule.createdBy.toString(),
        phoneNumber: schedule.phoneNumber,
        customerEmail: schedule.customerEmail,
        product: {
          id: schedule.productId.toString(),
          snapshot: schedule.productSnapshot,
        },
        amount: schedule.amount,
        estimatedCost: schedule.estimatedCost,
        scheduledDate: schedule.scheduledDate.toISOString(),
        timezone: schedule.timezone,
        recurrence: schedule.recurrence,
        status: schedule.status,
        executionCount: schedule.executionCount,
        lastExecutedAt: schedule.lastExecutedAt?.toISOString(),
        nextExecutionAt: schedule.nextExecutionAt?.toISOString(),
        transactions: transactions.map((t) => ({
          id: String(t._id),
          status: t.status,
          amount: t.amount,
          createdAt: t.createdAt.toISOString(),
        })),
        failureCount: schedule.failureCount,
        lastFailureReason: schedule.lastFailureReason,
        maxRetries: schedule.maxRetries,
        notifications: schedule.notifications,
        notes: schedule.notes,
        metadata: schedule.metadata,
        createdAt: schedule.createdAt.toISOString(),
        updatedAt: schedule.updatedAt.toISOString(),
        upcomingExecutions: upcomingExecutions.map((d) => d.toISOString()),
      };

    return createSuccessResponse(response);
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch scheduled top-up', { error: errorMessage });
    return createErrorResponse(errorMessage, 500);
  }
}

/**
 * PATCH /api/v1/scheduled-topups/[id]
 * Update a scheduled top-up
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;
    const body: UpdateScheduledTopupRequest = await request.json();

      const schedule = await updateScheduledTopup(id, body, session.orgId);

      const response = {
        id: String(schedule._id),
        organizationId: schedule.organizationId.toString(),
        customerId: schedule.customerId?.toString(),
        createdBy: schedule.createdBy.toString(),
        phoneNumber: schedule.phoneNumber,
        customerEmail: schedule.customerEmail,
        product: {
          id: schedule.productId.toString(),
          snapshot: schedule.productSnapshot,
        },
        amount: schedule.amount,
        estimatedCost: schedule.estimatedCost,
        scheduledDate: schedule.scheduledDate.toISOString(),
        timezone: schedule.timezone,
        recurrence: schedule.recurrence,
        status: schedule.status,
        executionCount: schedule.executionCount,
        lastExecutedAt: schedule.lastExecutedAt?.toISOString(),
        nextExecutionAt: schedule.nextExecutionAt?.toISOString(),
        transactions: schedule.transactions.map((t) => t.toString()),
        failureCount: schedule.failureCount,
        lastFailureReason: schedule.lastFailureReason,
        maxRetries: schedule.maxRetries,
        notifications: schedule.notifications,
        notes: schedule.notes,
        metadata: schedule.metadata,
        createdAt: schedule.createdAt.toISOString(),
        updatedAt: schedule.updatedAt.toISOString(),
      };

      logger.info('Scheduled top-up updated via API', {
        scheduleId: id,
        orgId: session.orgId,
      });

    return createSuccessResponse(response);
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to update scheduled top-up', { error: errorMessage });
    return createErrorResponse(errorMessage, 500);
  }
}

/**
 * DELETE /api/v1/scheduled-topups/[id]
 * Cancel a scheduled top-up
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;

      await cancelScheduledTopup(id, session.orgId);

      logger.info('Scheduled top-up cancelled via API', {
        scheduleId: id,
        orgId: session.orgId,
      });

    return createSuccessResponse({
      message: 'Scheduled top-up cancelled successfully',
    });
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to cancel scheduled top-up', { error: errorMessage });
    return createErrorResponse(errorMessage, 500);
  }
}
