/**
 * Scheduled Top-ups Service
 * Handles business logic for creating, executing, and managing scheduled top-ups
 *
 * Execution design (2026-11-22 fix pass — see the scheduling analysis,
 * findings C1/C2/H1–H4/M1/M4):
 *
 * - REAL SENDS: a fired schedule creates a real Transaction and sends
 *   through the same DingConnect machinery as partner/manual sends
 *   (createDingConnectService + the fulfillment helpers for outcome
 *   classification and polling). There is no placeholder completion.
 * - PERSISTED MONEY: the org wallet reservation is saved BEFORE the
 *   send, converted to a persisted deduction on success, and released
 *   (persisted) on failure — reserve/deduct/release are in-memory
 *   Mongoose methods, so every step is followed by wallet.save().
 * - NO DOUBLE-FIRE: schedules are claimed atomically
 *   (active -> processing via findOneAndUpdate on the exact
 *   nextExecutionAt that was read), the executor re-checks the claim,
 *   and a unique index on Transaction.metadata.scheduledOccurrenceKey
 *   makes a second send transaction for the same occurrence
 *   impossible at the database level.
 * - TEST MODE: the org storefront's validateOnly setting is honored
 *   exactly as the partner API resolves it (absent settings default
 *   to validate-only), and the mode is recorded on the transaction.
 * - FAILURE POLICY: transient failures retry with exponential
 *   backoff over days (not 3 ticks / ~15 minutes); insufficient
 *   wallet funds retry on a 24h horizon without consuming the
 *   failure budget. A send whose provider outcome is unknown stays
 *   "processing" — schedule and transaction both — until the
 *   settlement pass resolves it; the reservation is held meanwhile.
 */

import {
  addDays,
  addWeeks,
  addMonths,
  setDate,
  getDay,
  getDaysInMonth,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import {
  ScheduledTopup,
  type IScheduledTopup,
  Product,
  Wallet,
  type IWallet,
  WalletTransaction,
  Transaction,
  type ITransaction,
  Integration,
  StorefrontSettings,
  dbConnection,
  type RecurrenceConfig,
  type NotificationConfig,
} from '@topupsend/db';
import type {
  CreateScheduledTopupRequest,
  UpdateScheduledTopupRequest,
  ScheduleExecutionResult,
} from '@/types/scheduled-topups';
import { createDingConnectService } from '@/lib/services/dingconnect.service';
import {
  isDefiniteProviderRejection,
  pollTransferStatus,
  settleStuckTransfer,
} from '@/lib/services/fulfillment.service';
import { trackTransactionCompletion } from '@/lib/services/usage-tracking.service';
import { EmailService } from '@/lib/services/email.service';
import { logger } from '@/lib/logger';

/** Consecutive-failure budget floor: maxRetries below this is raised
 *  to it, so with backoff a schedule survives days of transient errors
 *  instead of dying after 3 ticks (~15 minutes). */
export const SCHEDULE_MIN_MAX_ATTEMPTS = 10;

/** Backoff ladder in minutes, indexed by consecutive failure count. */
const RETRY_BACKOFF_MINUTES = [5, 15, 60, 240, 720, 1440];

/** Insufficient-funds retries: check back in 24h, without consuming
 *  the failure budget — a low-balance window must not kill a schedule. */
const INSUFFICIENT_FUNDS_RETRY_MS = 24 * 60 * 60 * 1000;

/** A claim older than this with no unsettled transaction is treated
 *  as an interrupted execution and recovered. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/** How long a send may stay "processing" before the settlement pass
 *  starts polling the provider for its final state. */
const SETTLE_AFTER_MS = 60 * 1000;

const MAX_DUE_PER_RUN = 1000;
const DUE_BATCH_SIZE = 100;

/**
 * A failure caused by the org wallet (missing or underfunded). These
 * are funding states, not execution errors: they retry on a long
 * horizon and never consume the failure budget.
 */
export class InsufficientWalletFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientWalletFundsError';
  }
}

/** Minutes to wait before retry attempt N (1-based consecutive failures). */
export function retryBackoffMinutes(consecutiveFailures: number): number {
  const index = Math.min(
    Math.max(consecutiveFailures, 1) - 1,
    RETRY_BACKOFF_MINUTES.length - 1
  );
  return RETRY_BACKOFF_MINUTES[index];
}

/** Whether a string is a real IANA timezone name. */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const EXPLICIT_OFFSET_SUFFIX = /(z|[+-]\d{2}:?\d{2})$/i;

/**
 * Interpret a submitted date/time as an instant (H4).
 *
 * The dashboard form sends a naive `datetime-local` string plus the
 * user's IANA timezone: the wall-clock time must be read IN THAT
 * TIMEZONE, not the server's. Strings carrying an explicit offset or
 * `Z` are already instants and are parsed as-is. The naive string is
 * handed to fromZonedTime AS A STRING — its string form reads the
 * components directly, independent of the server timezone (the Date
 * form is not; it reads system-local components).
 */
export function parseScheduleDateTime(
  value: string | Date,
  timezone: string
): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Invalid scheduled date');
    }
    return value;
  }

  const str = String(value).trim();

  if (EXPLICIT_OFFSET_SUFFIX.test(str)) {
    const parsed = new Date(str);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid scheduled date');
    }
    return parsed;
  }

  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  const parsed = fromZonedTime(str, timezone);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid scheduled date');
  }
  return parsed;
}

/**
 * Create a new scheduled top-up
 */
export async function createScheduledTopup(
  params: CreateScheduledTopupRequest,
  userId: string,
  orgId: string
): Promise<IScheduledTopup> {
  await dbConnection.connect();

  if (!isValidTimezone(params.timezone)) {
    throw new Error(`Invalid timezone: ${params.timezone}`);
  }

  // H4: interpret the submitted wall-clock time in the submitted
  // timezone, then validate the resulting instant.
  const scheduledDate = parseScheduleDateTime(params.scheduledDate, params.timezone);
  if (scheduledDate <= new Date()) {
    throw new Error('Scheduled date must be in the future');
  }

  // Load and validate product (real schema fields: orgId + status)
  const product = await Product.findOne({
    _id: params.productId,
    orgId,
    status: 'active',
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

  // The first execution fires AT the chosen instant; recurrence only
  // advances from there. (Previously create stored the chosen date
  // plus one interval, silently skipping the first occurrence.)
  const nextExecutionAt = scheduledDate;

  // Create scheduled topup
  const scheduledTopup = new ScheduledTopup({
    organizationId: orgId,
    createdBy: userId,
    phoneNumber: params.phoneNumber,
    customerEmail: params.customerEmail,
    productId: params.productId,
    productSnapshot,
    // L3: for fixed-price products the amount is the product's price;
    // a client-supplied amount is only meaningful for variable-value
    // products (validated above) and is otherwise ignored.
    amount: product.isVariableValue ? params.amount : estimatedCost,
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

  // M1: status transitions go through the guarded paths only, and a
  // schedule being executed cannot be edited underneath the executor.
  if (schedule.status === 'completed' || schedule.status === 'cancelled') {
    throw new Error('Cannot update completed or cancelled schedules');
  }
  if (schedule.status === 'processing') {
    throw new Error('Cannot update a schedule while it is being executed');
  }

  // Status changes requested through PATCH obey the same guards as
  // the pause/resume endpoints.
  if (params.status === 'paused') {
    return toggleSchedulePause(scheduleId, orgId, true);
  }
  if (params.status === 'active' && schedule.status !== 'active') {
    return toggleSchedulePause(scheduleId, orgId, false);
  }

  // A new date is parsed in the schedule's timezone and must be in
  // the future (create-time validation, re-run on update — M1).
  let newScheduledDate: Date | undefined;
  if (params.scheduledDate) {
    newScheduledDate = parseScheduleDateTime(params.scheduledDate, schedule.timezone);
    if (newScheduledDate <= new Date()) {
      throw new Error('Scheduled date must be in the future');
    }
    schedule.scheduledDate = newScheduledDate;
  }

  // Amount changes are revalidated against the product (M1/L3).
  if (params.amount !== undefined) {
    const product = await Product.findOne({
      _id: schedule.productId,
      orgId,
      status: 'active',
    });
    if (!product) {
      throw new Error('Product not found or inactive');
    }
    if (product.isVariableValue) {
      const min = product.minAmount || 0;
      const max = product.maxAmount || Infinity;
      if (params.amount < min || params.amount > max) {
        throw new Error(`Amount must be between ${min} and ${max}`);
      }
      schedule.amount = params.amount;
    } else {
      schedule.amount = product.getEffectivePrice();
    }
    schedule.estimatedCost = product.getEffectivePrice();
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

  // Recalculate next execution if schedule changed. The new date is
  // the next fire time; recurrence advances from it.
  if (newScheduledDate || params.recurrence) {
    schedule.currentOccurrenceAt = undefined;
    if (schedule.status === 'active') {
      schedule.nextExecutionAt = schedule.scheduledDate;
    }
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

  // M1: terminal and in-flight schedules cannot be cancelled.
  if (schedule.status === 'completed') {
    throw new Error('Cannot cancel a completed schedule');
  }
  if (schedule.status === 'processing') {
    throw new Error('Cannot cancel a schedule while it is being executed');
  }
  if (schedule.status === 'cancelled') {
    return; // Idempotent: already cancelled
  }

  schedule.status = 'cancelled';
  schedule.nextExecutionAt = undefined;
  await schedule.save();

  logger.info('Scheduled top-up cancelled', { scheduleId: schedule._id });
}

/**
 * Pause or resume a scheduled top-up (M1: transitions are guarded by
 * current status — cancelled/completed schedules cannot be
 * resurrected, and resuming recomputes the next FUTURE occurrence).
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
    if (schedule.status !== 'active') {
      throw new Error(
        `Cannot pause a schedule with status "${schedule.status}"`
      );
    }
    schedule.status = 'paused';
  } else {
    if (schedule.status !== 'paused' && schedule.status !== 'failed') {
      throw new Error(
        `Cannot resume a schedule with status "${schedule.status}"`
      );
    }
    // Resuming a failed schedule starts a fresh failure budget.
    schedule.failureCount = 0;
    schedule.lastFailureReason = undefined;
    schedule.status = 'active';
    // The resume recomputes the fire time from the schedule's own
    // cadence; any occurrence stamped by a previous claim is stale.
    schedule.currentOccurrenceAt = undefined;
    schedule.nextExecutionAt = computeResumeExecutionAt(schedule);
    if (!schedule.nextExecutionAt) {
      // Recurrence is exhausted (end date / max occurrences passed
      // while paused) — the schedule is done.
      schedule.status = 'completed';
    }
  }

  await schedule.save();

  logger.info(`Scheduled top-up ${pause ? 'paused' : 'resumed'}`, {
    scheduleId: schedule._id,
  });

  return schedule;
}

/**
 * The next fire time when a schedule resumes: for one-time schedules
 * the chosen date (a past date fires on the next run — it was due);
 * for recurring schedules the first occurrence after now, stepping
 * from the original date so the cadence and time-of-day survive.
 * Returns undefined when the recurrence is already exhausted.
 */
export function computeResumeExecutionAt(
  schedule: IScheduledTopup,
  now: Date = new Date()
): Date | undefined {
  if (!schedule.recurrence?.enabled) {
    return schedule.scheduledDate;
  }

  let candidate = schedule.scheduledDate;
  let guard = 0;
  while (candidate <= now && guard < 10000) {
    const next = calculateNextExecution(
      candidate,
      schedule.timezone,
      schedule.recurrence
    );
    if (next <= candidate) break; // No forward progress — bail out
    candidate = next;
    guard += 1;
    if (!shouldContinueRecurrence(schedule, candidate)) {
      return undefined;
    }
  }
  return candidate;
}

/**
 * The idempotency key for one send attempt of one occurrence:
 * "<scheduleId>:<occurrence ISO>:a<attempt>". The attempt number is
 * the schedule's transaction count + 1, so two executors racing the
 * same claim compute the SAME key (and the unique index rejects the
 * second create), while a later retry — after the failed attempt's
 * transaction has been recorded on the schedule — computes a fresh
 * key for its new transaction.
 */
export function occurrenceKeyFor(
  schedule: IScheduledTopup,
  occurrenceAt: Date
): string {
  return `${String(schedule._id)}:${occurrenceAt.toISOString()}:a${
    schedule.transactions.length + 1
  }`;
}

/** Find the transaction created for the schedule's in-flight attempt. */
async function findOccurrenceTransaction(
  schedule: IScheduledTopup
): Promise<ITransaction | null> {
  if (!schedule.currentOccurrenceAt) return null;
  return Transaction.findOne({
    'metadata.scheduledOccurrenceKey': occurrenceKeyFor(
      schedule,
      schedule.currentOccurrenceAt
    ),
  });
}

/**
 * Process all due scheduled top-ups.
 * Called by the Vercel Cron route (the single trigger path).
 *
 * Order matters: settle in-flight sends first, recover stale claims,
 * then claim and execute newly due schedules.
 */
export async function processScheduledTopups(): Promise<ScheduleExecutionResult[]> {
  await dbConnection.connect();

  const results: ScheduleExecutionResult[] = [];

  // 1. Settle schedules whose send outcome was left unknown.
  results.push(...(await settleProcessingSchedules()));

  // 2. Recover claims whose executor died mid-flight.
  await recoverStaleClaims();

  // 3. Claim and execute due schedules, paging past the old hard cap
  //    of 100 per run (M3) up to a bounded total per run.
  let processed = 0;
  while (processed < MAX_DUE_PER_RUN) {
    const dueSchedules = await ScheduledTopup.find({
      status: 'active',
      nextExecutionAt: { $lte: new Date() },
    }).limit(Math.min(DUE_BATCH_SIZE, MAX_DUE_PER_RUN - processed));

    if (dueSchedules.length === 0) break;

    for (const due of dueSchedules) {
      const result = await executeScheduledTopup(due._id.toString());
      results.push(result);
      processed += 1;
    }
  }

  return results;
}

/**
 * Atomically claim a due schedule for execution (H1).
 *
 * The update only matches if the schedule is still `active` with the
 * exact nextExecutionAt the caller read — a concurrent run, a pause,
 * or a cancel makes the claim fail instead of double-firing. The
 * claim stamps the occurrence being executed so recurrence advances
 * from the occurrence, not from whenever the executor happened to
 * run; a claim that is a RETRY of a failed occurrence keeps the
 * occurrence stamped by the first attempt.
 */
async function claimSchedule(
  schedule: IScheduledTopup
): Promise<IScheduledTopup | null> {
  const occurrenceAt =
    schedule.currentOccurrenceAt ??
    schedule.nextExecutionAt ??
    schedule.scheduledDate;

  const claimed = await ScheduledTopup.findOneAndUpdate(
    {
      _id: schedule._id,
      status: 'active',
      nextExecutionAt: schedule.nextExecutionAt,
    },
    {
      $set: {
        status: 'processing',
        processingStartedAt: new Date(),
        currentOccurrenceAt: occurrenceAt,
      },
    },
    { new: true }
  );
  return claimed;
}

/**
 * Execute a single scheduled top-up: claim it, then run the send.
 * Execution failures are finalized onto the schedule (retry policy)
 * and returned as results rather than thrown.
 */
export async function executeScheduledTopup(
  scheduleId: string
): Promise<ScheduleExecutionResult> {
  await dbConnection.connect();

  const schedule = await ScheduledTopup.findById(scheduleId);

  if (!schedule) {
    throw new Error('Scheduled top-up not found');
  }

  if (schedule.status !== 'active') {
    return {
      scheduleId,
      success: false,
      error: `Schedule is not active (status: ${schedule.status})`,
      status: schedule.status,
    };
  }

  const claimed = await claimSchedule(schedule);
  if (!claimed) {
    // Lost the race: another run claimed it, or it was paused /
    // cancelled / rescheduled after the due-scan read it.
    return {
      scheduleId,
      success: false,
      error: 'Schedule was already claimed or is no longer due',
      status: 'processing',
    };
  }

  return executeClaimedSchedule(claimed);
}

/**
 * Run the send for a claimed schedule and finalize the outcome.
 *
 * Step order is deliberate:
 *  1. Validate everything (product, integration, test mode, funds).
 *  2. Create the Transaction — the unique occurrence key rejects a
 *     duplicate create BEFORE any money moves.
 *  3. Link the transaction to the schedule.
 *  4. Reserve the wallet funds AND PERSIST (C2), flagging the held
 *     reservation on the schedule so settlement knows it exists.
 *  5. Send through DingConnect, mirroring the partner send's outcome
 *     handling (definite rejection = failed; unknown = processing).
 *  6. On success, convert the reservation to a persisted deduction.
 * Any throw before completion lands in the catch: the transaction is
 * marked failed (M4) and this run's reservation is released.
 */
async function executeClaimedSchedule(
  schedule: IScheduledTopup
): Promise<ScheduleExecutionResult> {
  const orgId = schedule.organizationId.toString();
  const occurrenceAt = schedule.currentOccurrenceAt ?? schedule.scheduledDate;
  const occurrenceKey = occurrenceKeyFor(schedule, occurrenceAt);

  logger.info('Executing scheduled top-up', {
    scheduleId: schedule._id,
    phoneNumber: schedule.phoneNumber,
    occurrenceAt,
  });

  let wallet: IWallet | null = null;
  let transaction: ITransaction | null = null;
  let reservedHere = false;

  try {
    // Load product (org-scoped, real schema fields)
    const product = await Product.findOne({
      _id: schedule.productId,
      orgId,
      status: 'active',
    });
    if (!product) {
      throw new Error('Product no longer available');
    }
    if (product.provider !== 'dingconnect') {
      throw new Error(
        `Scheduled top-ups support DingConnect products only (product provider: ${product.provider})`
      );
    }

    // H2: resolve the org's test-mode setting exactly as the partner
    // API does — an absent storefront defaults to validate-only.
    const storefrontSettings = await StorefrontSettings.findOne({ orgId });
    const validateOnly =
      storefrontSettings?.topupSettings?.validateOnly ?? true;

    const integration = await Integration.findOne({
      orgId,
      provider: 'dingconnect',
      status: 'active',
    }).select('+credentials.apiKey');
    if (!integration?.credentials?.apiKey) {
      throw new Error('DingConnect integration not configured');
    }

    // Wallet (real schema fields: orgId + status)
    wallet = await Wallet.findOne({ orgId, status: 'active' });
    if (!wallet) {
      throw new InsufficientWalletFundsError('Wallet not found');
    }

    const actualCost = product.getEffectivePrice();
    if (!wallet.hasAvailableBalance(actualCost)) {
      throw new InsufficientWalletFundsError('Insufficient wallet balance');
    }

    const sendValue = product.isVariableValue
      ? schedule.amount
      : product.denomination.fixedAmount ?? schedule.amount;

    // Step 2: create the transaction in the real Transaction shape.
    transaction = new Transaction({
      orgId,
      productId: `ding-${product.skuCode}`,
      amount: schedule.amount,
      currency: 'USD',
      status: 'pending',
      paymentGateway: 'balance',
      paymentType: 'balance',
      provider: 'dingconnect',
      isTestMode: validateOnly,
      createdBy: schedule.createdBy.toString(),
      recipient: {
        phoneNumber: schedule.phoneNumber,
        email: schedule.customerEmail,
      },
      operator: {
        id: product.operatorId,
        name: product.operatorName,
        country: product.operatorCountry,
      },
      metadata: {
        scheduledTopupId: String(schedule._id),
        scheduledOccurrenceKey: occurrenceKey,
        productSkuCode: product.skuCode,
        productName: product.name,
        providerName: product.providerCode,
        isVariableValue: product.isVariableValue,
        sendValue,
        costPrice: product.pricing.costPrice,
        customerPrice: actualCost,
        finalPrice: actualCost,
        testMode: validateOnly,
      },
      timeline: {
        createdAt: new Date(),
      },
    });

    try {
      await transaction.save();
    } catch (saveError: unknown) {
      if ((saveError as { code?: number })?.code !== 11000) throw saveError;
      // A transaction for this exact attempt already exists — a
      // concurrent executor created it. Link it and let the
      // settlement pass finalize it; this run moves no money.
      const existing = await Transaction.findOne({
        'metadata.scheduledOccurrenceKey': occurrenceKey,
      });
      if (!existing) throw saveError;
      schedule.pendingTransactionId =
        existing._id as typeof schedule.pendingTransactionId;
      await schedule.save();
      return {
        scheduleId: String(schedule._id),
        success: false,
        transactionId: String(existing._id),
        error: 'Send already in progress for this occurrence',
        status: 'processing',
      };
    }

    // Step 3: link the transaction to the schedule before any money
    // moves, so a crash from here on is recoverable by id.
    schedule.pendingTransactionId =
      transaction._id as typeof schedule.pendingTransactionId;
    await schedule.save();

    // Step 4 (C2): reserve AND PERSIST. reserve()/deduct() only
    // mutate the in-memory document — without save() no debit exists.
    if (!wallet.reserve(actualCost)) {
      throw new InsufficientWalletFundsError('Insufficient wallet balance');
    }
    await wallet.save();
    reservedHere = true;
    schedule.pendingReservationHeld = true;
    await schedule.save();

    // Step 5: send.
    const dingConnect = createDingConnectService({
      apiKey: integration.credentials.apiKey as string,
    });
    const accountNumber = schedule.phoneNumber.replace(/[\s\-()+]/g, '');

    if (validateOnly) {
      // Test mode: no provider call, exactly as fulfillment behaves —
      // the transaction completes as a validation, marked as such.
      transaction.status = 'completed';
      transaction.timeline.completedAt = new Date();
      transaction.providerTransactionId = `TEST-${transaction.orderId}`;
      (transaction.metadata as Record<string, unknown>).testMode = true;
      await transaction.save();
    } else {
      let transferResult;
      try {
        transferResult = await dingConnect.sendTransfer({
          SkuCode: product.skuCode,
          AccountNumber: accountNumber,
          SendValue: sendValue,
          SendCurrencyIso: 'USD',
          DistributorRef: transaction.orderId,
          ValidateOnly: false,
        });
      } catch (sendError) {
        if (!isDefiniteProviderRejection(sendError)) {
          // Unknown outcome: the provider may have accepted it.
          // Never guess — leave both records "processing" for the
          // settlement pass, reservation held.
          transaction.status = 'processing';
          transaction.timeline.processingAt = new Date();
          (transaction.metadata as Record<string, unknown>).transferOutcome =
            'unknown';
          transaction.metadata.failureReason =
            'DingConnect request outcome unknown (possible timeout); awaiting status verification';
          await transaction.save();

          logger.warn('Scheduled send outcome unknown — left for settlement', {
            scheduleId: schedule._id,
            transactionId: transaction._id,
          });

          return {
            scheduleId: String(schedule._id),
            success: false,
            transactionId: String(transaction._id),
            error: 'Send outcome unknown; awaiting provider settlement',
            status: 'processing',
          };
        }
        // Definite rejection (HTTP 4xx): nothing was sent.
        throw sendError;
      }

      transaction.providerTransactionId = String(transferResult.TransferId);
      (transaction.metadata as Record<string, unknown>).dingTransferId =
        transferResult.TransferId;

      let finalResult = transferResult;
      if (
        transferResult.Status !== 'Completed' &&
        transferResult.Status !== 'Failed'
      ) {
        finalResult = await pollTransferStatus(
          dingConnect,
          Number(transferResult.TransferId)
        ).catch(() => transferResult);
      }
      (transaction.metadata as Record<string, unknown>).dingStatus =
        finalResult.Status;

      if (finalResult.Status === 'Failed') {
        throw new Error(
          finalResult.ErrorMessage || 'DingConnect transfer failed'
        );
      }

      if (finalResult.Status !== 'Completed') {
        // Still in flight at the provider — settle later.
        transaction.status = 'processing';
        transaction.timeline.processingAt = new Date();
        (transaction.metadata as Record<string, unknown>).transferOutcome =
          'unknown';
        await transaction.save();

        return {
          scheduleId: String(schedule._id),
          success: false,
          transactionId: String(transaction._id),
          error: 'Send outcome unknown; awaiting provider settlement',
          status: 'processing',
        };
      }

      transaction.status = 'completed';
      transaction.timeline.completedAt = new Date();
      await transaction.save();
    }

    // Step 6: convert the reservation into a persisted deduction.
    const balanceBefore = wallet.balance;
    wallet.deduct(actualCost, true);
    await wallet.save();
    reservedHere = false;

    await WalletTransaction.create({
      orgId,
      walletId: String(wallet._id),
      type: 'purchase',
      amount: -actualCost,
      currency: wallet.currency,
      balanceBefore,
      balanceAfter: wallet.balance,
      status: 'completed',
      reference: {
        type: 'order',
        id: transaction.orderId,
        description: `Scheduled top-up for ${schedule.phoneNumber}`,
      },
      metadata: {
        processedBy: schedule.createdBy.toString(),
      },
    });

    void trackTransactionCompletion({
      orgId,
      transactionAmount: actualCost,
    });

    await finalizeScheduleSuccess(schedule, transaction);
    await sendScheduleNotification(schedule, 'success', transaction);

    logger.info('Scheduled top-up executed successfully', {
      scheduleId: schedule._id,
      transactionId: transaction._id,
      validateOnly,
    });

    return {
      scheduleId: String(schedule._id),
      success: true,
      transactionId: String(transaction._id),
      nextExecutionAt: schedule.nextExecutionAt?.toISOString(),
      status: schedule.status,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // M4: never orphan state — a transaction that did not complete is
    // marked failed, and this run's persisted reservation is released.
    if (transaction && transaction.status !== 'completed') {
      transaction.status = 'failed';
      transaction.timeline.failedAt = new Date();
      transaction.metadata.failureReason = errorMessage;
      await transaction.save().catch(() => undefined);
      // Record the attempt on the schedule: its history shows it, and
      // the attempt counter advances the next attempt's unique key.
      const failedTransactionId = transaction._id;
      if (
        failedTransactionId &&
        !schedule.transactions.some(
          (t) => t.toString() === String(failedTransactionId)
        )
      ) {
        schedule.transactions.push(failedTransactionId as never);
      }
    }
    if (wallet && reservedHere) {
      const cost =
        (transaction?.metadata as Record<string, unknown>)?.finalPrice;
      if (typeof cost === 'number') {
        wallet.releaseReservation(cost);
        await wallet.save().catch(() => undefined);
      }
    }

    const status = await finalizeScheduleFailure(schedule, error);
    await sendScheduleNotification(schedule, 'failure', transaction);

    logger.error('Scheduled top-up execution failed', {
      scheduleId: schedule._id,
      error: errorMessage,
      resultingStatus: status,
    });

    return {
      scheduleId: String(schedule._id),
      success: false,
      transactionId: transaction ? String(transaction._id) : undefined,
      error: errorMessage,
      status,
    };
  }
}

/**
 * Advance a schedule after a successful occurrence: count it, reset
 * the failure budget, and compute the next occurrence FROM THE
 * OCCURRENCE THAT JUST FIRED (H4 — never from execution wall-clock,
 * so late runs do not drift the cadence).
 */
async function finalizeScheduleSuccess(
  schedule: IScheduledTopup,
  transaction: ITransaction
): Promise<void> {
  const occurrenceAt = schedule.currentOccurrenceAt ?? schedule.scheduledDate;

  schedule.executionCount += 1;
  schedule.lastExecutedAt = new Date();
  schedule.failureCount = 0;
  schedule.lastFailureReason = undefined;
  if (
    !schedule.transactions.some(
      (t) => t.toString() === String(transaction._id)
    )
  ) {
    schedule.transactions.push(transaction._id as never);
  }
  schedule.pendingTransactionId = undefined;
  schedule.pendingReservationHeld = false;
  schedule.processingStartedAt = undefined;
  schedule.currentOccurrenceAt = undefined;

  if (schedule.recurrence?.enabled) {
    const nextExecution = calculateNextExecution(
      occurrenceAt,
      schedule.timezone,
      schedule.recurrence
    );
    if (shouldContinueRecurrence(schedule, nextExecution)) {
      schedule.status = 'active';
      schedule.nextExecutionAt = nextExecution;
    } else {
      schedule.status = 'completed';
      schedule.nextExecutionAt = undefined;
    }
  } else {
    schedule.status = 'completed';
    schedule.nextExecutionAt = undefined;
  }

  await schedule.save();
}

/**
 * Apply the failure policy after an unsuccessful occurrence (H3):
 * - Insufficient wallet funds: retry in 24h, failure budget untouched.
 * - Anything else: failureCount + 1, exponential backoff, and the
 *   schedule is marked failed only after the (floored) attempt budget
 *   is exhausted — with backoff that spans days, not ~15 minutes.
 * The failed occurrence stays stamped (currentOccurrenceAt) so a
 * retry executes the SAME occurrence, not a drifted one.
 * Returns the schedule's resulting status.
 */
async function finalizeScheduleFailure(
  schedule: IScheduledTopup,
  error: unknown
): Promise<IScheduledTopup['status']> {
  const errorMessage =
    error instanceof Error ? error.message : 'Unknown error';

  schedule.lastFailureReason = errorMessage;
  schedule.pendingTransactionId = undefined;
  schedule.pendingReservationHeld = false;
  schedule.processingStartedAt = undefined;

  if (error instanceof InsufficientWalletFundsError) {
    schedule.status = 'active';
    schedule.nextExecutionAt = new Date(Date.now() + INSUFFICIENT_FUNDS_RETRY_MS);
    await schedule.save();
    return schedule.status;
  }

  schedule.failureCount += 1;
  const maxAttempts = Math.max(
    schedule.maxRetries ?? 0,
    SCHEDULE_MIN_MAX_ATTEMPTS
  );

  if (schedule.failureCount >= maxAttempts) {
    schedule.status = 'failed';
    schedule.nextExecutionAt = undefined;
    schedule.currentOccurrenceAt = undefined;
    logger.error('Scheduled top-up failed after max attempts', {
      scheduleId: schedule._id,
      failureCount: schedule.failureCount,
    });
  } else {
    const backoffMinutes = retryBackoffMinutes(schedule.failureCount);
    schedule.status = 'active';
    schedule.nextExecutionAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
    logger.warn('Scheduled top-up failed, retry scheduled with backoff', {
      scheduleId: schedule._id,
      failureCount: schedule.failureCount,
      backoffMinutes,
      error: errorMessage,
    });
  }

  await schedule.save();
  return schedule.status;
}

/**
 * Settlement pass: schedules stuck in "processing" because the
 * provider outcome was unknown (or the executor died mid-flight).
 * Polls via the fulfillment service's settleStuckTransfer — which
 * never refunds a scheduled send; the wallet leg is settled here, by
 * the schedule that owns the reservation.
 */
async function settleProcessingSchedules(): Promise<ScheduleExecutionResult[]> {
  const results: ScheduleExecutionResult[] = [];
  const settleCutoff = new Date(Date.now() - SETTLE_AFTER_MS);
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

  const processing = await ScheduledTopup.find({
    status: 'processing',
    processingStartedAt: { $lte: settleCutoff },
  }).limit(DUE_BATCH_SIZE);

  for (const schedule of processing) {
    const orgId = schedule.organizationId.toString();

    let transaction: ITransaction | null = schedule.pendingTransactionId
      ? await Transaction.findById(schedule.pendingTransactionId)
      : await findOccurrenceTransaction(schedule);

    if (!transaction) {
      if (schedule.processingStartedAt && schedule.processingStartedAt <= staleBefore) {
        const status = await finalizeScheduleFailure(
          schedule,
          new Error('Execution interrupted before the send was recorded')
        );
        results.push({
          scheduleId: String(schedule._id),
          success: false,
          error: 'Execution interrupted before the send was recorded',
          status,
        });
      }
      continue;
    }

    if (transaction.status === 'processing') {
      const outcome = await settleStuckTransfer(transaction);
      if (outcome === 'unknown' || outcome === 'skipped') {
        continue; // Still unsettled — try again next run
      }
      // settleStuckTransfer mutated the in-memory document; re-read
      // is unnecessary, its status now reflects the outcome.
    }

    if (transaction.status === 'completed') {
      // Settle the wallet leg: the held reservation becomes a debit.
      if (schedule.pendingReservationHeld) {
        const cost = transaction.metadata?.finalPrice ?? transaction.amount;
        const wallet = await Wallet.findOne({ orgId, status: 'active' });
        if (wallet && typeof cost === 'number') {
          wallet.deduct(cost, true);
          await wallet.save();
        }
      }
      await finalizeScheduleSuccess(schedule, transaction);
      await sendScheduleNotification(schedule, 'success', transaction);
      results.push({
        scheduleId: String(schedule._id),
        success: true,
        transactionId: String(transaction._id),
        status: schedule.status,
      });
    } else if (
      transaction.status === 'failed' ||
      transaction.status === 'refunded'
    ) {
      // Definitive failure: release the held reservation (persisted)
      // and run the failure policy.
      if (schedule.pendingReservationHeld) {
        const cost = transaction.metadata?.finalPrice ?? transaction.amount;
        const wallet = await Wallet.findOne({ orgId, status: 'active' });
        if (wallet && typeof cost === 'number') {
          wallet.releaseReservation(cost);
          await wallet.save();
        }
      }
      const status = await finalizeScheduleFailure(
        schedule,
        new Error(
          transaction.metadata?.failureReason || 'DingConnect transfer failed'
        )
      );
      await sendScheduleNotification(schedule, 'failure', transaction);
      results.push({
        scheduleId: String(schedule._id),
        success: false,
        transactionId: String(transaction._id),
        error:
          transaction.metadata?.failureReason || 'DingConnect transfer failed',
        status,
      });
    } else if (transaction.status === 'pending') {
      // Created but never sent, and the claim is stale: the executor
      // died before the provider call. Close it out as an interrupted
      // attempt (releasing any reservation it managed to persist).
      if (schedule.processingStartedAt && schedule.processingStartedAt <= staleBefore) {
        transaction.status = 'failed';
        transaction.timeline.failedAt = new Date();
        transaction.metadata.failureReason =
          'Execution interrupted before the send was attempted';
        await transaction.save();
        schedule.transactions.push(transaction._id as never);

        if (schedule.pendingReservationHeld) {
          const cost = transaction.metadata?.finalPrice ?? transaction.amount;
          const wallet = await Wallet.findOne({ orgId, status: 'active' });
          if (wallet && typeof cost === 'number') {
            wallet.releaseReservation(cost);
            await wallet.save();
          }
        }

        const status = await finalizeScheduleFailure(
          schedule,
          new Error('Execution interrupted before the send was attempted')
        );
        results.push({
          scheduleId: String(schedule._id),
          success: false,
          transactionId: String(transaction._id),
          error: 'Execution interrupted before the send was attempted',
          status,
        });
      }
    }
    // Any other state: leave the schedule processing for the next
    // pass rather than guessing at money state.
  }

  return results;
}

/**
 * Recover claims whose executor died before linking a transaction:
 * link an orphaned occurrence transaction if one exists (the
 * settlement pass then owns it); otherwise close the claim out as an
 * interrupted attempt. Claims with a linked transaction are the
 * settlement pass's business and are never touched here.
 */
async function recoverStaleClaims(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

  const stale = await ScheduledTopup.find({
    status: 'processing',
    processingStartedAt: { $lte: staleBefore },
    $or: [
      { pendingTransactionId: { $exists: false } },
      { pendingTransactionId: null },
    ],
  }).limit(DUE_BATCH_SIZE);

  for (const schedule of stale) {
    const orphan = await findOccurrenceTransaction(schedule);
    if (orphan) {
      schedule.pendingTransactionId =
        orphan._id as typeof schedule.pendingTransactionId;
      await schedule.save();
      continue;
    }

    logger.warn('Recovering stale schedule claim', {
      scheduleId: schedule._id,
      processingStartedAt: schedule.processingStartedAt,
    });
    await finalizeScheduleFailure(
      schedule,
      new Error('Execution interrupted before the send was recorded')
    );
  }
}

/**
 * Schedule notifications (L2): the config has always been stored;
 * now success/failure emails actually send when the schedule enables
 * them, via the org's configured email provider. Fire-and-forget —
 * a mail failure must never change money state. (notifyBefore has
 * no pre-fire trigger in a polling executor and remains unimplemented.)
 */
async function sendScheduleNotification(
  schedule: IScheduledTopup,
  kind: 'success' | 'failure',
  transaction: ITransaction | null
): Promise<void> {
  try {
    const config: NotificationConfig | undefined = schedule.notifications;
    if (!config?.enabled) return;
    if (kind === 'success' && !config.notifyOnSuccess) return;
    if (kind === 'failure' && !config.notifyOnFailure) return;
    if (!config.channels?.includes('email')) return;
    if (!schedule.customerEmail) return;

    const orgId = schedule.organizationId.toString();
    const productName = schedule.productSnapshot?.name || 'top-up';

    if (kind === 'success') {
      await EmailService.sendEmail(orgId, {
        to: schedule.customerEmail,
        subject: `Your scheduled top-up was sent`,
        text: `Your scheduled ${productName} top-up to ${schedule.phoneNumber} has been sent successfully.`,
        html: `<p>Your scheduled <strong>${productName}</strong> top-up to ${schedule.phoneNumber} has been sent successfully.</p>`,
      });
    } else {
      await EmailService.sendEmail(orgId, {
        to: schedule.customerEmail,
        subject: `Your scheduled top-up could not be sent`,
        text: `We could not send your scheduled ${productName} top-up to ${schedule.phoneNumber}. Reason: ${schedule.lastFailureReason || 'unknown error'}. The schedule will be retried automatically where possible.`,
        html: `<p>We could not send your scheduled <strong>${productName}</strong> top-up to ${schedule.phoneNumber}.</p><p>Reason: ${schedule.lastFailureReason || 'unknown error'}. The schedule will be retried automatically where possible.</p>`,
      });
    }
  } catch (error) {
    logger.error('Failed to send schedule notification', {
      scheduleId: schedule._id,
      kind,
      transactionId: transaction?._id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Calculate the next execution time based on recurrence settings.
 *
 * `baseDate` is an INSTANT (for non-recurring schedules it is returned
 * unchanged — the caller already interpreted the wall-clock time in
 * the schedule's timezone at creation). For recurring schedules the
 * step is taken in the schedule's timezone so the local time-of-day
 * survives DST transitions, and it is taken FROM the given base
 * (the previous occurrence), never from execution wall-clock.
 */
export function calculateNextExecution(
  baseDate: Date,
  timezone: string,
  recurrence?: RecurrenceConfig
): Date {
  if (!recurrence || !recurrence.enabled) {
    return baseDate;
  }

  // Convert to the specified timezone
  const zonedDate = toZonedTime(baseDate, timezone);

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

    case 'monthly': {
      nextDate = addMonths(zonedDate, recurrence.interval || 1);
      if (recurrence.dayOfMonth) {
        // Clamp to the target month's length: setDate(31) in a
        // 30-day month would roll over into the next month.
        const day = Math.min(
          recurrence.dayOfMonth,
          getDaysInMonth(nextDate)
        );
        nextDate = setDate(nextDate, day);
      }
      break;
    }

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

  // Find next day in the array (note: 0 is Sunday — a valid find
  // result, so compare against undefined, not truthiness)
  const nextDay = sortedDays.find((day) => day > currentDay);

  if (nextDay === undefined) {
    // Wrap to next week
    const firstDay = sortedDays[0];
    return addDays(currentDate, 7 - currentDay + firstDay);
  }

  return addDays(currentDate, nextDay - currentDay);
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
