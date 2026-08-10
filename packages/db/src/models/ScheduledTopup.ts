import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Recurrence configuration for scheduled top-ups
 */
export interface RecurrenceConfig {
  enabled: boolean;
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  interval?: number;
  daysOfWeek?: number[]; // 0-6, 0=Sunday
  dayOfMonth?: number; // 1-31
  endDate?: Date;
  maxOccurrences?: number;
}

/**
 * Notification preferences for scheduled top-ups
 */
export interface NotificationConfig {
  enabled: boolean;
  notifyBeforeMinutes: number;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  channels: ('email' | 'sms')[];
}

/**
 * Product snapshot at time of schedule creation
 */
export interface ProductSnapshot {
  skuCode: string;
  name: string;
  providerCode: string;
  benefitType: string;
}

/**
 * ScheduledTopup document interface
 */
export interface IScheduledTopup extends Document {
  // Ownership & Context
  organizationId: Types.ObjectId;
  customerId?: Types.ObjectId;
  createdBy: Types.ObjectId;

  // Recipient Information
  phoneNumber: string;
  customerEmail?: string;

  // Product & Pricing
  productId: Types.ObjectId;
  productSnapshot: ProductSnapshot;
  amount: number;
  estimatedCost: number;

  // Schedule Configuration
  scheduledDate: Date;
  timezone: string;

  // Recurrence Settings
  recurrence: RecurrenceConfig;

  // Status & Execution
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  executionCount: number;
  lastExecutedAt?: Date;
  nextExecutionAt?: Date;

  // Transaction History
  transactions: Types.ObjectId[];

  // Failure Handling
  failureCount: number;
  lastFailureReason?: string;
  maxRetries: number;

  // Notifications
  notifications: NotificationConfig;

  // Metadata
  notes?: string;
  metadata?: Record<string, any>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const RecurrenceSchema = new Schema<RecurrenceConfig>(
  {
    enabled: { type: Boolean, required: true, default: false },
    type: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'custom'],
      required: function (this: RecurrenceConfig) {
        return this.enabled;
      },
    },
    interval: { type: Number, min: 1 },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    dayOfMonth: { type: Number, min: 1, max: 31 },
    endDate: { type: Date },
    maxOccurrences: { type: Number, min: 1 },
  },
  { _id: false }
);

const NotificationSchema = new Schema<NotificationConfig>(
  {
    enabled: { type: Boolean, required: true, default: true },
    notifyBeforeMinutes: { type: Number, default: 60, min: 0 },
    notifyOnSuccess: { type: Boolean, default: true },
    notifyOnFailure: { type: Boolean, default: true },
    channels: [{ type: String, enum: ['email', 'sms'] }],
  },
  { _id: false }
);

const ProductSnapshotSchema = new Schema<ProductSnapshot>(
  {
    skuCode: { type: String, required: true },
    name: { type: String, required: true },
    providerCode: { type: String, required: true },
    benefitType: { type: String, required: true },
  },
  { _id: false }
);

const ScheduledTopupSchema = new Schema<IScheduledTopup>(
  {
    // Ownership & Context
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Recipient Information
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },

    // Product & Pricing
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    productSnapshot: {
      type: ProductSnapshotSchema,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    estimatedCost: {
      type: Number,
      required: true,
      min: 0,
    },

    // Schedule Configuration
    scheduledDate: {
      type: Date,
      required: true,
    },
    timezone: {
      type: String,
      required: true,
      default: 'UTC',
    },

    // Recurrence Settings
    recurrence: {
      type: RecurrenceSchema,
      required: true,
      default: () => ({ enabled: false }),
    },

    // Status & Execution
    status: {
      type: String,
      enum: ['active', 'paused', 'completed', 'cancelled', 'failed'],
      default: 'active',
      index: true,
    },
    executionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastExecutedAt: {
      type: Date,
    },
    nextExecutionAt: {
      type: Date,
      index: true,
    },

    // Transaction History
    transactions: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Transaction',
      },
    ],

    // Failure Handling
    failureCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastFailureReason: {
      type: String,
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 0,
    },

    // Notifications
    notifications: {
      type: NotificationSchema,
      required: true,
      default: () => ({
        enabled: true,
        notifyBeforeMinutes: 60,
        notifyOnSuccess: true,
        notifyOnFailure: true,
        channels: ['email'],
      }),
    },

    // Metadata
    notes: {
      type: String,
      maxlength: 1000,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
ScheduledTopupSchema.index({ organizationId: 1, status: 1, nextExecutionAt: 1 });
ScheduledTopupSchema.index({ organizationId: 1, customerId: 1 });
ScheduledTopupSchema.index({ status: 1, nextExecutionAt: 1 });

// Prevent duplicate executions - ensure lastExecutedAt is unique per schedule when not null
ScheduledTopupSchema.index(
  { _id: 1, lastExecutedAt: 1 },
  { unique: true, sparse: true }
);

export const ScheduledTopup =
  mongoose.models.ScheduledTopup ||
  mongoose.model<IScheduledTopup>('ScheduledTopup', ScheduledTopupSchema);
