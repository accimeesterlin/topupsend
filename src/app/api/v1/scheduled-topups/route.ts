/**
 * API Routes for Scheduled Top-ups
 * POST /api/v1/scheduled-topups - Create a new scheduled top-up
 * GET /api/v1/scheduled-topups - List scheduled top-ups
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response';
import { ApiErrors } from '@/lib/api-error';
import { dbConnection, ScheduledTopup, type IScheduledTopup } from '@topupsend/db';
import {
  createScheduledTopup,
  getUpcomingExecutions,
} from '@/lib/services/scheduled-topups.service';
import type {
  CreateScheduledTopupRequest,
  ListScheduledTopupsQuery,
  ScheduledTopupResponse,
  ScheduledTopupsListResponse,
} from '@/types/scheduled-topups';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/scheduled-topups
 * Create a new scheduled top-up
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body: CreateScheduledTopupRequest = await request.json();

    // Validate required fields
    if (!body.phoneNumber || !body.productId || !body.scheduledDate || !body.timezone) {
      throw ApiErrors.BadRequest('Missing required fields');
    }

    const schedule = await createScheduledTopup(
      body,
      session.userId,
      session.orgId
    );

    const response = formatScheduleResponse(schedule);

    logger.info('Scheduled top-up created via API', {
      scheduleId: schedule._id,
      phoneNumber: body.phoneNumber,
      orgId: session.orgId,
    });

    return createSuccessResponse(response, 201);
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to create scheduled top-up', { error: errorMessage });
    return createErrorResponse(errorMessage, 500);
  }
}

/**
 * GET /api/v1/scheduled-topups
 * List scheduled top-ups with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

      const { searchParams } = new URL(request.url);

      // Parse query parameters
      const query: ListScheduledTopupsQuery = {
        status: searchParams.get('status') as any,
        phoneNumber: searchParams.get('phoneNumber') || undefined,
        customerId: searchParams.get('customerId') || undefined,
        fromDate: searchParams.get('fromDate') || undefined,
        toDate: searchParams.get('toDate') || undefined,
        page: parseInt(searchParams.get('page') || '1'),
        limit: Math.min(parseInt(searchParams.get('limit') || '20'), 100),
        sortBy: (searchParams.get('sortBy') as any) || 'nextExecutionAt',
        sortOrder: (searchParams.get('sortOrder') as any) || 'asc',
      };

      // Build filter
      const filter: any = { organizationId: session.orgId };

      if (query.status) {
        filter.status = query.status;
      }
      if (query.phoneNumber) {
        filter.phoneNumber = query.phoneNumber;
      }
      if (query.customerId) {
        filter.customerId = query.customerId;
      }
      if (query.fromDate || query.toDate) {
        filter.scheduledDate = {};
        if (query.fromDate) {
          filter.scheduledDate.$gte = new Date(query.fromDate);
        }
        if (query.toDate) {
          filter.scheduledDate.$lte = new Date(query.toDate);
        }
      }

      // Count total
      const total = await ScheduledTopup.countDocuments(filter);

      // Fetch paginated results
      const skip = (query.page! - 1) * query.limit!;
      const sortOrder = query.sortOrder === 'desc' ? -1 : 1;

      const schedules = await ScheduledTopup.find(filter)
        .sort({ [query.sortBy!]: sortOrder })
        .skip(skip)
        .limit(query.limit!)
        .exec();

      const response: ScheduledTopupsListResponse = {
        schedules: schedules.map(formatScheduleResponse),
        pagination: {
          page: query.page!,
          limit: query.limit!,
          total,
          totalPages: Math.ceil(total / query.limit!),
        },
      };

    return createSuccessResponse(response);
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to list scheduled top-ups', { error: errorMessage });
    return createErrorResponse(errorMessage, 500);
  }
}

/**
 * Format schedule document to API response
 */
function formatScheduleResponse(schedule: IScheduledTopup): ScheduledTopupResponse {
  return {
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
}
