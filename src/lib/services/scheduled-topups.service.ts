/**
 * Scheduled Top-ups Service
 * Handles business logic for creating, executing, and managing scheduled top-ups
 */

import { addDays, addWeeks, addMonths, setDate, getDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import {
  ScheduledTopup,
  type IScheduledTopup,
  Product,
  type IProduct,
  Wallet,
  Transaction,
  dbConnection,
  type RecurrenceConfig,
  type NotificationConfig,
} from '@topupsend/db';
import type {
  CreateScheduledTopupRequest,
  UpdateScheduledTopupRequest,
  ScheduleExecutionResult,
} from '@/types/scheduled-topups';
import { logger } from '@/lib/logger';
import type { Types } from 'mongoose';

/**
 * Create a new scheduled top-up
 */
export async function createScheduledTopup(
  params: CreateScheduledTopupRequest,
  userId: string,
  orgId: string
): Promise<IScheduledTopup> {
  await dbConnection.connect();

  // Validate scheduled date is in the future
  const scheduledDate = new Date(params.scheduledDate);
  if (scheduledDate <= new Date()) {
    throw new Error('Scheduled date must be in the future');
  }

  // Load and validate product
  const product = await Product.findOne({
    _id: params.productId,
    organizationId: orgId,
    isActive: true,
  });

  if (!product) {
    throw new Error('Product not found or inactive');
  }

  // Validate amount for variable-value products
  if (product.isVariableValue) {
    if (!params.amount) {
      throw new Error('Amount is required for variable-value products');
    }
    const min = product.minAmount || 0;
    const max = product.maxAmount || Infinity;
    if (params.amount < min || params.amount > max) {
      throw new Error(
        `Amount must be between ${min} and ${max}`
      );
    }
  }

  // Calculate estimated cost
  const estimatedCost = product.getEffectivePrice();

  // Create product snapshot
  const productSnapshot = {
    skuCode: product.skuCode,
    name: product.name,
    providerCode: product.providerCode,
    benefitType: product.benefitType,
  };

  // Calculate next execution time
  const nextExecutionAt = calculateNextExecution(
    scheduledDate,
    params.timezone,
    params.recurrence
  );

  // Create scheduled topup
  const scheduledTopup = new ScheduledTopup({
    organizationId: orgId,
    createdBy: userId,
    phoneNumber: params.phoneNumber,
    customerEmail: params.customerEmail,
    productId: params.productId,
    productSnapshot,
    amount: params.amount || estimatedCost,
    estimatedCost,
    scheduledDate,
    timezone: params.timezone,
    recurrence: params.recurrence || { enabled: false },
    notifications: {
      ...{
        enabled: true,
        notifyBeforeMinutes: 60,
        notifyOnSuccess: true,
        notifyOnFailure: true,
        channels: ['email'],
      },
      ...params.notifications,
    },
    notes: params.notes,
    nextExecutionAt,
    status: 'active',
  });

  await scheduledTopup.save();

  logger.info('Scheduled top-up created', {
    scheduleId: scheduledTopup._id,
    phoneNumber: params.phoneNumber,
    nextExecutionAt,
  });

  return scheduledTopup;
}

/**
 * Update an existing scheduled top-up
 */
export async function updateScheduledTopup(
  scheduleId: string,
  params: UpdateScheduledTopupRequest,
  orgId: string
): Promise<IScheduledTopup> {
  await dbConnection.connect();

  const schedule = await ScheduledTopup.findOne({
    _id: scheduleId,
    organizationId: orgId,
  });

  if (!schedule) {
    throw new Error('Scheduled top-up not found');
  }

  // Cannot update completed or cancelled schedules
  if (schedule.status === 'completed' || schedule.status === 'cancelled') {
    throw new Error('Cannot update completed or cancelled schedules');
  }

  // Update fields
  if (params.scheduledDate) {
    schedule.scheduledDate = new Date(params.scheduledDate);
  }
  if (params.amount !== undefined) {
    schedule.amount = params.amount;
  }
  if (params.recurrence) {
    schedule.recurrence = params.recurrence;
  }
  if (params.notifications) {
    schedule.notifications = {
      ...schedule.notifications,
      ...params.notifications,
    };
  }
  if (params.notes !== undefined) {
    schedule.notes = params.notes;
  }
  if (params.status) {
    schedule.status = params.status;
  }

  // Recalculate next execution if schedule changed
  if (params.scheduledDate || params.recurrence) {
    schedule.nextExecutionAt = calculateNextExecution(
      schedule.scheduledDate,
      schedule.timezone,
      schedule.recurrence
    );
  }

  await schedule.save();

  logger.info('Scheduled top-up updated', {
    scheduleId: schedule._id,
    nextExecutionAt: schedule.nextExecutionAt,
  });

  return schedule;
}

/**
 * Cancel a scheduled top-up
 */
export async function cancelScheduledTopup(
  scheduleId: string,
  orgId: string
): Promise<void> {
  await dbConnection.connect();

  const schedule = await ScheduledTopup.findOne({
    _id: scheduleId,
    organizationId: orgId,
  });

  if (!schedule) {
    throw new Error('Scheduled top-up not found');
  }

  schedule.status = 'cancelled';
  await schedule.save();

  logger.info('Scheduled top-up cancelled', { scheduleId: schedule._id });
}

/**
 * Pause or resume a scheduled top-up
 */
export async function toggleSchedulePause(
  scheduleId: string,
  orgId: string,
  pause: boolean
): Promise<IScheduledTopup> {
  await dbConnection.connect();

  const schedule = await ScheduledTopup.findOne({
    _id: scheduleId,
    organizationId: orgId,
  });

  if (!schedule) {
    throw new Error('Scheduled top-up not found');
  }

  if (pause) {
    schedule.status = 'paused';
  } else {
    schedule.status = 'active';
    // Recalculate next execution when resuming
    schedule.nextExecutionAt = calculateNextExecution(
      schedule.scheduledDate,
      schedule.timezone,
      schedule.recurrence
    );
  }

  await schedule.save();

  logger.info(`Scheduled top-up ${pause ? 'paused' : 'resumed'}`, {
    scheduleId: schedule._id,
  });

  return schedule;
}

/**
 * Process all due scheduled top-ups
 * Called by the cron job
 */
export async function processScheduledTopups(): Promise<ScheduleExecutionResult[]> {
  await dbConnection.connect();

  const now = new Date();

  // Find all active schedules that are due
  const dueSchedules = await ScheduledTopup.find({
    status: 'active',
    nextExecutionAt: { $lte: now },
  }).limit(100); // Process max 100 at a time

  logger.info(`Processing ${dueSchedules.length} due scheduled top-ups`);

  const results: ScheduleExecutionResult[] = [];

  // Process each schedule
  for (const schedule of dueSchedules) {
    try {
      const result = await executeScheduledTopup(schedule._id.toString());
      results.push(result);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to execute scheduled top-up', {
        scheduleId: schedule._id,
        error: errorMessage,
      });

      results.push({
        scheduleId: schedule._id.toString(),
        success: false,
        error: errorMessage,
        status: schedule.status,
      });
    }
  }

  return results;
}

/**
 * Execute a single scheduled top-up
 */
export async function executeScheduledTopup(
  scheduleId: string
): Promise<ScheduleExecutionResult> {
  await dbConnection.connect();

  const schedule = await ScheduledTopup.findById(scheduleId);

  if (!schedule) {
    throw new Error('Scheduled top-up not found');
  }

  logger.info('Executing scheduled top-up', {
    scheduleId: schedule._id,
    phoneNumber: schedule.phoneNumber,
  });

  try {
    // Load product
    const product = await Product.findById(schedule.productId);
    if (!product || !product.isActive) {
      throw new Error('Product no longer available');
    }

    // Check wallet balance
    const wallet = await Wallet.findOne({
      organizationId: schedule.organizationId,
      isActive: true,
    });

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const actualCost = product.getEffectivePrice();
    if (!wallet.hasAvailableBalance(actualCost)) {
      throw new Error('Insufficient wallet balance');
    }

    // Reserve balance
    await wallet.reserve(actualCost);

    // Create transaction
    const transaction = new Transaction({
      organizationId: schedule.organizationId,
      phoneNumber: schedule.phoneNumber,
      productId: product._id,
      skuCode: product.skuCode,
      amount: schedule.amount,
      cost: actualCost,
      status: 'created',
      metadata: {
        scheduledTopupId: schedule._id,
        isScheduled: true,
      },
    });

    await transaction.save();

    // TODO: In a real implementation, this would call DingConnect/Reloadly API
    // For now, we'll just mark it as completed
    transaction.status = 'completed';
    await transaction.save();

    // Deduct from wallet
    await wallet.deduct(actualCost, true);

    // Update schedule
    schedule.executionCount += 1;
    schedule.lastExecutedAt = new Date();
    schedule.failureCount = 0; // Reset failure count on success
    schedule.transactions.push(transaction._id as any);

    // Calculate next execution or mark as completed
    if (schedule.recurrence.enabled) {
      const nextExecution = calculateNextExecution(
        new Date(),
        schedule.timezone,
        schedule.recurrence
      );

      if (shouldContinueRecurrence(schedule, nextExecution)) {
        schedule.nextExecutionAt = nextExecution;
      } else {
        schedule.status = 'completed';
        schedule.nextExecutionAt = undefined;
      }
    } else {
      // One-time schedule - mark as completed
      schedule.status = 'completed';
      schedule.nextExecutionAt = undefined;
    }

    await schedule.save();

    logger.info('Scheduled top-up executed successfully', {
      scheduleId: schedule._id,
      transactionId: transaction._id,
      nextExecutionAt: schedule.nextExecutionAt,
    });

    // TODO: Send success notification
    if (schedule.notifications.enabled && schedule.notifications.notifyOnSuccess) {
      // sendNotification(schedule, 'success', transaction);
    }

    return {
      scheduleId: schedule._id.toString(),
      success: true,
      transactionId: String(transaction._id),
      nextExecutionAt: schedule.nextExecutionAt?.toISOString(),
      status: schedule.status,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle failure
    schedule.failureCount += 1;
    schedule.lastFailureReason = errorMessage;

    // Auto-pause after max retries
    if (schedule.failureCount >= schedule.maxRetries) {
      schedule.status = 'failed';
      logger.error('Scheduled top-up failed after max retries', {
        scheduleId: schedule._id,
        failureCount: schedule.failureCount,
      });
    } else {
      // Retry later
      logger.warn('Scheduled top-up failed, will retry', {
        scheduleId: schedule._id,
        failureCount: schedule.failureCount,
        error: errorMessage,
      });
    }

    await schedule.save();

    // TODO: Send failure notification
    if (schedule.notifications.enabled && schedule.notifications.notifyOnFailure) {
      // sendNotification(schedule, 'failure', null);
    }

    throw error;
  }
}

/**
 * Calculate the next execution time based on recurrence settings
 */
export function calculateNextExecution(
  baseDate: Date,
  timezone: string,
  recurrence?: RecurrenceConfig
): Date {
  // Convert to the specified timezone
  const zonedDate = toZonedTime(baseDate, timezone);

  if (!recurrence || !recurrence.enabled) {
    // No recurrence - return the base date
    return fromZonedTime(zonedDate, timezone);
  }

  let nextDate: Date;

  switch (recurrence.type) {
    case 'daily':
      nextDate = addDays(zonedDate, recurrence.interval || 1);
      break;

    case 'weekly':
      if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
        // Find next matching day of week
        nextDate = getNextDayOfWeek(zonedDate, recurrence.daysOfWeek);
      } else {
        nextDate = addWeeks(zonedDate, recurrence.interval || 1);
      }
      break;

    case 'monthly':
      nextDate = addMonths(zonedDate, recurrence.interval || 1);
      if (recurrence.dayOfMonth) {
        nextDate = setDate(nextDate, recurrence.dayOfMonth);
      }
      break;

    case 'custom':
      // Custom interval in days
      nextDate = addDays(zonedDate, recurrence.interval || 1);
      break;

    default:
      nextDate = zonedDate;
  }

  // Convert back to UTC
  return fromZonedTime(nextDate, timezone);
}

/**
 * Find the next occurrence of a specific day of week
 */
function getNextDayOfWeek(currentDate: Date, daysOfWeek: number[]): Date {
  const currentDay = getDay(currentDate);
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);

  // Find next day in the array
  let nextDay = sortedDays.find((day) => day > currentDay);

  if (!nextDay) {
    // Wrap to next week
    nextDay = sortedDays[0];
  }

  const daysToAdd = nextDay > currentDay ? nextDay - currentDay : 7 - currentDay + nextDay;

  return addDays(currentDate, daysToAdd);
}

/**
 * Check if recurrence should continue
 */
function shouldContinueRecurrence(
  schedule: IScheduledTopup,
  nextExecution: Date
): boolean {
  const recurrence = schedule.recurrence;

  // Check max occurrences
  if (recurrence.maxOccurrences) {
    if (schedule.executionCount >= recurrence.maxOccurrences) {
      return false;
    }
  }

  // Check end date
  if (recurrence.endDate) {
    if (nextExecution > recurrence.endDate) {
      return false;
    }
  }

  return true;
}

/**
 * Get upcoming execution dates for a schedule
 */
export function getUpcomingExecutions(
  schedule: IScheduledTopup,
  count: number = 5
): Date[] {
  const executions: Date[] = [];
  let currentDate = schedule.nextExecutionAt || schedule.scheduledDate;

  if (!currentDate) {
    return executions;
  }

  for (let i = 0; i < count; i++) {
    executions.push(new Date(currentDate));

    if (!schedule.recurrence.enabled) {
      break;
    }

    currentDate = calculateNextExecution(
      currentDate,
      schedule.timezone,
      schedule.recurrence
    );

    if (!shouldContinueRecurrence(schedule, currentDate)) {
      break;
    }
  }

  return executions;
}
