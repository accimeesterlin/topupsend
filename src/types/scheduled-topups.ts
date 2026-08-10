/**
 * TypeScript types for Scheduled Top-ups API
 * These types define the request/response shapes for the scheduled topups endpoints
 */

import type { RecurrenceConfig, NotificationConfig, ProductSnapshot } from '@topupsend/db';

/**
 * Request body for creating a new scheduled top-up
 */
export interface CreateScheduledTopupRequest {
  phoneNumber: string;
  productId: string;
  amount?: number; // Required for variable-value products
  scheduledDate: string; // ISO 8601 date string
  timezone: string; // IANA timezone (e.g., "America/Port-au-Prince")
  recurrence?: RecurrenceConfig;
  notifications?: Partial<NotificationConfig>;
  customerEmail?: string;
  notes?: string;
}

/**
 * Request body for updating an existing scheduled top-up
 */
export interface UpdateScheduledTopupRequest {
  scheduledDate?: string;
  amount?: number;
  recurrence?: RecurrenceConfig;
  notifications?: Partial<NotificationConfig>;
  notes?: string;
  status?: 'active' | 'paused';
}

/**
 * Query parameters for listing scheduled top-ups
 */
export interface ListScheduledTopupsQuery {
  status?: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  phoneNumber?: string;
  customerId?: string;
  fromDate?: string; // ISO 8601
  toDate?: string; // ISO 8601
  page?: number;
  limit?: number;
  sortBy?: 'scheduledDate' | 'createdAt' | 'nextExecutionAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Scheduled top-up response object
 */
export interface ScheduledTopupResponse {
  id: string;
  organizationId: string;
  customerId?: string;
  createdBy: string;
  phoneNumber: string;
  customerEmail?: string;
  product: {
    id: string;
    snapshot: ProductSnapshot;
  };
  amount: number;
  estimatedCost: number;
  scheduledDate: string;
  timezone: string;
  recurrence: RecurrenceConfig;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  executionCount: number;
  lastExecutedAt?: string;
  nextExecutionAt?: string;
  transactions: string[]; // Transaction IDs
  failureCount: number;
  lastFailureReason?: string;
  maxRetries: number;
  notifications: NotificationConfig;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Detailed scheduled top-up response with populated data
 */
export interface DetailedScheduledTopupResponse {
  id: string;
  organizationId: string;
  customerId?: string;
  createdBy: string;
  phoneNumber: string;
  customerEmail?: string;
  product: {
    id: string;
    snapshot: ProductSnapshot;
  };
  amount: number;
  estimatedCost: number;
  scheduledDate: string;
  timezone: string;
  recurrence: RecurrenceConfig;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  executionCount: number;
  lastExecutedAt?: string;
  nextExecutionAt?: string;
  transactions: {
    id: string;
    status: string;
    amount: number;
    createdAt: string;
  }[];
  failureCount: number;
  lastFailureReason?: string;
  maxRetries: number;
  notifications: NotificationConfig;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  upcomingExecutions: string[]; // Next 5 execution dates
}

/**
 * Paginated list response
 */
export interface ScheduledTopupsListResponse {
  schedules: ScheduledTopupResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Schedule execution result
 */
export interface ScheduleExecutionResult {
  scheduleId: string;
  success: boolean;
  transactionId?: string;
  error?: string;
  nextExecutionAt?: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
}

/**
 * Upcoming execution preview
 */
export interface UpcomingExecution {
  date: string;
  estimatedCost: number;
}
