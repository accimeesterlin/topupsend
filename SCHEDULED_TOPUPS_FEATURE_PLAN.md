# Scheduled Prepaid Minutes Feature Plan

## Overview

This feature allows users (customers) to schedule prepaid mobile top-ups to be sent automatically at a future date/time, with support for one-time and recurring schedules.

---

## Use Cases

1. **Personal Reminders:** Customer schedules a monthly top-up for their own phone
2. **Family Support:** Customer schedules recurring top-ups for family members abroad
3. **Business Automation:** Organizations schedule regular top-ups for employees or contractors
4. **Gift Scheduling:** Schedule a top-up to be sent on a birthday or special occasion
5. **Budget Management:** Pre-schedule top-ups to align with payday or budget cycles

---

## Database Schema

### New Model: `ScheduledTopup`

**Location:** `packages/db/src/models/ScheduledTopup.ts`

```typescript
interface ScheduledTopup {
  // Ownership & Context
  organizationId: ObjectId;          // Organization that created this schedule
  customerId?: ObjectId;             // Optional: Customer who created this (if customer-facing)
  createdBy: ObjectId;               // User who created the schedule

  // Recipient Information
  phoneNumber: string;               // Recipient phone number (international format)
  customerEmail?: string;            // Optional: Recipient email for notifications

  // Product & Pricing
  productId: ObjectId;               // Product to send
  productSnapshot: {                 // Snapshot of product at time of creation
    skuCode: string;
    name: string;
    providerCode: string;
    benefitType: string;
  };
  amount: number;                    // Amount to send (for variable-value products)
  estimatedCost: number;             // Estimated cost at time of creation

  // Schedule Configuration
  scheduledDate: Date;               // Next execution date/time
  timezone: string;                  // Timezone for schedule (e.g., "Pacific/Port_Moresby")

  // Recurrence Settings
  recurrence: {
    enabled: boolean;
    type: 'daily' | 'weekly' | 'monthly' | 'custom';
    interval?: number;               // For custom: every N days/weeks/months
    daysOfWeek?: number[];           // For weekly: [0-6], 0=Sunday
    dayOfMonth?: number;             // For monthly: 1-31
    endDate?: Date;                  // Optional: when to stop recurring
    maxOccurrences?: number;         // Optional: max number of times to run
  };

  // Status & Execution
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  executionCount: number;            // How many times this has been executed
  lastExecutedAt?: Date;             // Last successful execution
  nextExecutionAt?: Date;            // Calculated next execution time

  // Transaction History
  transactions: ObjectId[];          // References to Transaction documents created

  // Failure Handling
  failureCount: number;              // Consecutive failures
  lastFailureReason?: string;        // Last error message
  maxRetries: number;                // Max retries before marking as failed (default: 3)

  // Notifications
  notifications: {
    enabled: boolean;
    notifyBeforeMinutes: number;     // Notify N minutes before execution
    notifyOnSuccess: boolean;
    notifyOnFailure: boolean;
    channels: ('email' | 'sms')[];
  };

  // Metadata
  notes?: string;                    // Optional user notes
  metadata?: Record<string, any>;    // Custom metadata

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

**Indexes:**
```typescript
- { organizationId: 1, status: 1, nextExecutionAt: 1 } // Query due schedules
- { organizationId: 1, customerId: 1 }                  // List customer schedules
- { status: 1, nextExecutionAt: 1 }                     // Background job processing
```

---

## API Endpoints

### 1. Create Scheduled Top-Up

**Endpoint:** `POST /api/v1/scheduled-topups`

**Request Body:**
```typescript
{
  phoneNumber: string;
  productId: string;
  amount?: number;                    // Required for variable-value products
  scheduledDate: string;              // ISO 8601 date string
  timezone: string;                   // IANA timezone
  recurrence?: {
    enabled: boolean;
    type: 'daily' | 'weekly' | 'monthly' | 'custom';
    interval?: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endDate?: string;
    maxOccurrences?: number;
  };
  notifications?: {
    enabled: boolean;
    notifyBeforeMinutes?: number;
    notifyOnSuccess?: boolean;
    notifyOnFailure?: boolean;
    channels?: ('email' | 'sms')[];
  };
  customerEmail?: string;
  notes?: string;
}
```

**Response:**
```typescript
{
  success: true;
  data: {
    id: string;
    phoneNumber: string;
    product: { ... };
    scheduledDate: string;
    nextExecutionAt: string;
    status: 'active';
    recurrence: { ... };
    estimatedCost: number;
  }
}
```

**Validations:**
- `scheduledDate` must be in the future
- Product must be available in recipient's country
- If recurring, validate recurrence configuration
- Optionally check wallet balance (warning, not error)

---

### 2. List Scheduled Top-Ups

**Endpoint:** `GET /api/v1/scheduled-topups`

**Query Parameters:**
```typescript
{
  status?: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  phoneNumber?: string;              // Filter by recipient
  customerId?: string;               // Filter by customer
  fromDate?: string;                 // Scheduled from this date
  toDate?: string;                   // Scheduled until this date
  page?: number;                     // Pagination
  limit?: number;                    // Items per page (max 100)
  sortBy?: 'scheduledDate' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}
```

**Response:**
```typescript
{
  success: true;
  data: {
    schedules: ScheduledTopup[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }
  }
}
```

---

### 3. Get Scheduled Top-Up Details

**Endpoint:** `GET /api/v1/scheduled-topups/[id]`

**Response:**
```typescript
{
  success: true;
  data: {
    ...ScheduledTopup,
    transactions: Transaction[];      // Populated transaction history
    upcomingExecutions: Date[];       // Next 5 scheduled executions
  }
}
```

---

### 4. Update Scheduled Top-Up

**Endpoint:** `PATCH /api/v1/scheduled-topups/[id]`

**Request Body:**
```typescript
{
  scheduledDate?: string;
  amount?: number;
  recurrence?: { ... };
  notifications?: { ... };
  notes?: string;
  status?: 'active' | 'paused';      // Can pause/resume
}
```

**Constraints:**
- Cannot update if status is 'completed' or 'cancelled'
- Cannot change product or phoneNumber (must cancel and create new)
- Recalculates `nextExecutionAt` if schedule changes

---

### 5. Cancel Scheduled Top-Up

**Endpoint:** `DELETE /api/v1/scheduled-topups/[id]`

**Response:**
```typescript
{
  success: true;
  message: 'Scheduled top-up cancelled successfully'
}
```

**Effect:**
- Sets `status` to 'cancelled'
- Does not delete the record (for audit trail)

---

### 6. Pause/Resume Scheduled Top-Up

**Endpoint:** `POST /api/v1/scheduled-topups/[id]/pause`
**Endpoint:** `POST /api/v1/scheduled-topups/[id]/resume`

**Effect:**
- Pause: Sets `status` to 'paused', stops execution
- Resume: Sets `status` to 'active', recalculates `nextExecutionAt`

---

## Background Job System

### Option 1: Simple Node-Cron (Recommended for MVP)

**Library:** `node-cron`

**Implementation:**

**Location:** `src/lib/jobs/scheduled-topups.job.ts`

```typescript
import cron from 'node-cron';
import { processScheduledTopups } from '@/lib/services/scheduled-topups.service';

// Run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('Running scheduled top-ups job...');
  await processScheduledTopups();
});
```

**Process Flow:**
1. Query all schedules where `status = 'active'` AND `nextExecutionAt <= NOW`
2. For each schedule:
   - Validate wallet balance
   - Execute top-up (reuse existing transaction flow)
   - Create Transaction record
   - Update schedule status and counters
   - Calculate next execution time (if recurring)
   - Send notifications
3. Handle failures with retry logic

---

### Option 2: BullMQ (Recommended for Production)

**Library:** `bullmq` (requires Redis)

**Benefits:**
- Distributed job processing
- Automatic retries
- Job persistence
- Scheduling precision
- Web UI for monitoring

**Implementation:**

**Location:** `src/lib/jobs/scheduled-topups.queue.ts`

```typescript
import { Queue, Worker } from 'bullmq';

const scheduledTopupsQueue = new Queue('scheduled-topups', {
  connection: redisConnection
});

// Add jobs to queue
async function scheduleTopup(scheduleId: string, executeAt: Date) {
  await scheduledTopupsQueue.add(
    'execute-topup',
    { scheduleId },
    { delay: executeAt.getTime() - Date.now() }
  );
}

// Worker to process jobs
const worker = new Worker('scheduled-topups', async (job) => {
  const { scheduleId } = job.data;
  await executeScheduledTopup(scheduleId);
});
```

---

## Business Logic Service

**Location:** `src/lib/services/scheduled-topups.service.ts`

### Key Functions:

#### 1. `createScheduledTopup(params)`
- Validate inputs
- Check product availability
- Estimate cost
- Create ScheduledTopup record
- Calculate first `nextExecutionAt`
- Optionally add to job queue

#### 2. `processScheduledTopups()`
- Query due schedules
- Execute each in parallel (with concurrency limit)
- Handle errors gracefully
- Update execution status

#### 3. `executeScheduledTopup(scheduleId)`
- Load schedule and product
- Validate wallet balance
- Call existing payment processing flow
- Create Transaction record
- Update schedule:
  - Increment `executionCount`
  - Update `lastExecutedAt`
  - Calculate `nextExecutionAt` (if recurring)
  - Set `status` to 'completed' if done
- Send notifications

#### 4. `calculateNextExecution(schedule)`
- Based on recurrence type, calculate next run time
- Account for timezone
- Check if maxOccurrences or endDate reached

#### 5. `sendScheduleNotification(schedule, type)`
- Send email/SMS notification
- Types: 'upcoming', 'success', 'failure'

---

## Wallet & Pricing Considerations

### Balance Handling

**Option A: Check at Execution Time (Recommended)**
- Don't reserve balance when scheduled
- Check balance just before execution
- If insufficient, mark as failed and notify
- Benefits: More flexible, no long-term reservations

**Option B: Reserve When Scheduled**
- Reserve estimated cost when schedule created
- Release on cancellation
- Deduct on execution
- Benefits: Guaranteed execution, no surprises
- Drawbacks: Locks up capital

**Recommendation:** Option A for MVP, with clear warnings to user about balance requirements.

### Price Changes

**Strategy:**
- Store `estimatedCost` at creation time
- Recalculate actual cost at execution time using current pricing
- If price increased significantly (>10%), optionally notify user
- Always use current product pricing for execution

---

## Notification System

### Notification Types:

1. **Upcoming Reminder:**
   - "Your scheduled top-up to +50937654321 will be sent in 1 hour"
   - Sent N minutes before execution

2. **Success Confirmation:**
   - "Successfully sent 500 HTG to +50937654321"
   - Include transaction ID and receipt

3. **Failure Alert:**
   - "Failed to send scheduled top-up: Insufficient balance"
   - Include failure reason and next steps

4. **Schedule Created:**
   - "Your recurring top-up is now active. Next execution: Jan 30, 2026 at 10:00 AM"

### Channels:

- **Email:** Use existing email service
- **SMS:** Future enhancement (requires SMS provider)
- **In-App:** Toast notifications when user is logged in
- **Push Notifications:** Future enhancement

---

## UI Components

### 1. Schedule Top-Up Form

**Location:** `src/components/scheduled-topups/schedule-form.tsx`

**Fields:**
- Recipient phone number (with country detection)
- Product selector (filtered by country)
- Amount (for variable-value products)
- Schedule date & time (with timezone)
- Recurrence toggle
  - Recurrence type selector
  - Recurrence options (days, interval, end date)
- Notification preferences
- Notes (optional)

**Features:**
- Real-time price estimation
- Balance warning if insufficient
- Preview of next 5 execution dates (for recurring)

---

### 2. Scheduled Top-Ups List

**Location:** `src/app/dashboard/scheduled-topups/page.tsx`

**Displays:**
- Table/cards of all scheduled top-ups
- Filters: status, date range, recipient
- Actions: View, Edit, Pause/Resume, Cancel
- Status badges (active, paused, completed, failed)
- Next execution date countdown

---

### 3. Schedule Details Page

**Location:** `src/app/dashboard/scheduled-topups/[id]/page.tsx`

**Sections:**
- Schedule information
- Recurrence details
- Execution history (list of transactions)
- Upcoming executions (next 5 dates)
- Edit/Pause/Cancel buttons

---

### 4. Schedule Top-Up Button

**Locations:**
- Product detail page
- Customer lookup results
- Transaction history (repeat purchase)

**Action:**
- Opens schedule form modal
- Pre-fills phone number and product

---

## Analytics Integration (PostHog)

### Events to Track:

```typescript
// Schedule created
analytics.events.scheduleCreated(scheduleId, {
  productId,
  recurrenceType,
  estimatedCost
});

// Schedule executed
analytics.events.scheduleExecuted(scheduleId, {
  transactionId,
  executionCount,
  success: true
});

// Schedule failed
analytics.events.scheduleFailed(scheduleId, {
  reason: 'insufficient_balance',
  failureCount
});

// Schedule cancelled
analytics.events.scheduleCancelled(scheduleId, {
  reason: 'user_requested',
  executionsCompleted
});
```

---

## Error Handling & Edge Cases

### 1. Insufficient Balance
- **Detection:** Check wallet before execution
- **Action:** Mark execution as failed, increment `failureCount`
- **Notification:** Alert user about insufficient funds
- **Retry:** Retry up to `maxRetries` times (with backoff)
- **Recovery:** Auto-pause schedule after max retries

### 2. Product No Longer Available
- **Detection:** Product inactive or deleted
- **Action:** Auto-pause schedule
- **Notification:** Alert user to update product selection

### 3. DingConnect API Failure
- **Detection:** API error response
- **Action:** Retry with exponential backoff
- **Notification:** Alert user after max retries

### 4. Timezone Changes
- **Handling:** Store timezone with schedule
- **Calculation:** Always calculate next execution in specified timezone
- **DST:** Handle daylight saving time transitions

### 5. Concurrent Execution Prevention
- **Problem:** Same schedule executed multiple times
- **Solution:** Use database locks or unique constraints
- **Implementation:** Check `lastExecutedAt` before execution

### 6. Server Restart During Execution
- **Problem:** Job interrupted mid-execution
- **Solution:** Use idempotency keys for transactions
- **Recovery:** Job queue persistence (BullMQ) or re-query on startup

---

## Security & Permissions

### Authorization:

- Users can only view/edit schedules in their active organization
- Admin role: Manage all schedules in organization
- Operator role: Create and view own schedules
- Viewer role: View-only access

### Validation:

- Scheduled date cannot be in the past
- Phone number must be valid (use existing validation)
- Product must exist and be available
- Recurrence configuration must be valid

### Rate Limiting:

- Limit schedule creation: 50 schedules per organization
- Limit execution frequency: No more than 1 execution per minute per schedule

---

## Migration Plan

### Phase 1: Database & Models (Week 1)
1. Create `ScheduledTopup` model
2. Add indexes
3. Create database migration script

### Phase 2: API Endpoints (Week 1-2)
1. Implement CRUD endpoints
2. Add validation middleware
3. Add unit tests

### Phase 3: Background Job System (Week 2)
1. Choose and integrate job scheduler (node-cron for MVP)
2. Implement `processScheduledTopups()` service
3. Add error handling and retries
4. Add job monitoring/logging

### Phase 4: UI Components (Week 2-3)
1. Schedule form component
2. Scheduled top-ups list page
3. Schedule details page
4. Integration with existing pages

### Phase 5: Notifications (Week 3)
1. Email templates
2. Notification service integration
3. Test notification delivery

### Phase 6: Testing & Polish (Week 4)
1. End-to-end testing
2. Load testing (simulate 1000+ schedules)
3. UI/UX refinements
4. Documentation

### Phase 7: Production Deployment
1. Deploy with feature flag
2. Monitor execution logs
3. Gradual rollout
4. Collect user feedback

---

## Technical Dependencies

### New Packages to Install:

```bash
# Job Scheduling (choose one)
yarn add node-cron @types/node-cron          # Simple, no dependencies
# OR
yarn add bullmq ioredis                       # Production-grade, requires Redis

# Date/Time Handling
yarn add date-fns-tz                          # Timezone support

# Additional type safety
yarn add zod                                  # Already installed
```

### Environment Variables:

```bash
# Optional: BullMQ Redis connection
REDIS_URL=redis://localhost:6379

# Scheduled jobs configuration
SCHEDULED_TOPUPS_ENABLED=true
SCHEDULED_TOPUPS_CRON=*/5 * * * *           # Every 5 minutes
SCHEDULED_TOPUPS_CONCURRENCY=5               # Max concurrent executions
```

---

## Testing Strategy

### Unit Tests:
- `calculateNextExecution()` with various recurrence types
- Timezone handling
- Price estimation logic
- Validation functions

### Integration Tests:
- Create schedule via API
- Execute scheduled top-up
- Handle insufficient balance
- Cancel/pause schedule
- Recurrence calculation

### End-to-End Tests:
- User creates a schedule
- Schedule executes automatically
- User receives notification
- User views transaction history

### Load Tests:
- 1000+ active schedules
- Concurrent execution handling
- Database query performance

---

## Monitoring & Observability

### Metrics to Track:

1. **Execution Metrics:**
   - Total schedules executed per day
   - Success rate
   - Average execution time
   - Failure rate by reason

2. **Business Metrics:**
   - Active schedules count
   - Recurring vs one-time ratio
   - Most popular recurrence types
   - Revenue from scheduled top-ups

3. **Performance Metrics:**
   - Job processing time
   - Queue depth (if using BullMQ)
   - Database query performance

### Logging:

- Log every schedule creation/update/cancellation
- Log every execution attempt (success/failure)
- Log balance check failures
- Log API errors from DingConnect

### Alerts:

- Alert if job hasn't run in >10 minutes
- Alert if failure rate >10%
- Alert if wallet balance low for multiple schedules
- Alert if DingConnect API is down

---

## Future Enhancements (Post-MVP)

1. **Smart Scheduling:**
   - AI-powered best time suggestions based on recipient usage patterns
   - Automatic adjustment if recipient already has balance

2. **Bulk Scheduling:**
   - Upload CSV to schedule multiple top-ups
   - Template-based scheduling for employee management

3. **Conditional Execution:**
   - Only execute if recipient balance below threshold
   - Skip if recipient recently received top-up from another source

4. **Advanced Notifications:**
   - SMS notifications to recipients
   - WhatsApp notifications
   - Push notifications

5. **Schedule Templates:**
   - Save and reuse common schedule configurations
   - Organization-level templates

6. **Recipient Management:**
   - Save recipient profiles with preferences
   - Group recipients for bulk operations

7. **Budget Controls:**
   - Set monthly spending limits for schedules
   - Approval workflow for large amounts

8. **Analytics Dashboard:**
   - Schedule performance insights
   - Cost savings from scheduled top-ups
   - Recipient satisfaction metrics

---

## Success Criteria

### MVP Launch:
- ✅ Users can create one-time scheduled top-ups
- ✅ Users can create recurring scheduled top-ups (daily, weekly, monthly)
- ✅ Schedules execute automatically at specified time
- ✅ Users receive email notifications
- ✅ Users can view, edit, pause, and cancel schedules
- ✅ Execution history tracked per schedule
- ✅ Graceful failure handling with retries

### Performance Goals:
- ⏱️ 99% execution accuracy (within 5 minutes of scheduled time)
- ⏱️ <1% failure rate (excluding balance issues)
- ⏱️ Support 10,000+ active schedules per organization
- ⏱️ <500ms API response time for schedule CRUD operations

### User Adoption:
- 📈 30% of active users create at least one schedule within first month
- 📈 50% of scheduled top-ups are recurring
- 📈 80% schedule retention after 3 months

---

## Estimated Timeline

- **Week 1:** Database model, API endpoints, basic service logic
- **Week 2:** Background job system, testing, error handling
- **Week 3:** UI components, integration with existing pages
- **Week 4:** Notifications, testing, polish, documentation
- **Total:** 4 weeks for MVP

**Team Required:**
- 1 Backend Engineer (API, jobs, database)
- 1 Frontend Engineer (UI components)
- 1 QA Engineer (testing)

---

## Questions & Decisions Needed

1. **Job Scheduler Choice:**
   - Use simple node-cron for MVP?
   - Or invest in BullMQ + Redis for production-grade solution?

2. **Balance Reservation:**
   - Reserve balance when scheduled?
   - Or check at execution time?

3. **Notification Priorities:**
   - Email only for MVP?
   - SMS notifications required for launch?

4. **Timezone Default:**
   - Use organization timezone?
   - Or allow per-schedule timezone?

5. **Execution Window:**
   - Allow exact time scheduling?
   - Or use time windows (e.g., "morning", "afternoon")?

6. **Pricing:**
   - Charge extra for scheduled top-ups?
   - Or include in standard pricing?

7. **Limits:**
   - Max number of active schedules per organization?
   - Max recurrence duration?

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Job scheduler failure causing missed executions | High | Low | Use BullMQ with persistence, add monitoring alerts |
| Timezone calculation errors | Medium | Medium | Thorough testing with date-fns-tz, add unit tests |
| Wallet balance issues at execution time | Medium | High | Clear user warnings, retry logic, low balance alerts |
| DingConnect API rate limits | High | Low | Implement exponential backoff, queue management |
| Concurrent execution of same schedule | High | Low | Database locks, idempotency checks |
| Server restart during execution | Medium | Low | Job persistence, transaction idempotency |

---

## Conclusion

This scheduled prepaid minutes feature will significantly enhance user convenience and increase recurring revenue. The phased approach allows for iterative development with early user feedback.

**Recommended Next Steps:**
1. Review and approve this plan
2. Choose job scheduler (node-cron vs BullMQ)
3. Create database migration
4. Begin Phase 1 implementation
