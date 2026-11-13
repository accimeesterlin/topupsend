import mongoose, { Schema, Document, Model } from "mongoose";

export type WebhookStatus = "pending" | "success" | "failed" | "retrying";
export type WebhookSource =
  | "pgpay"
  | "stripe"
  | "paypal"
  | "dingconnect"
  | "reloadly"
  | "other";

export interface IWebhookLog extends Document {
  orgId: string;
  event: string; // Event type (e.g., 'payment.completed', 'topup.delivered')
  source: WebhookSource;
  // Provider-assigned (or deterministically derived) id of this specific
  // event delivery (F-H12). Lets duplicate deliveries be deduplicated at
  // the data layer instead of by application-level status checks alone.
  eventId?: string;

  // Request data
  payload: any; // Full webhook payload
  headers?: Record<string, string>;
  signature?: string;
  ipAddress?: string;

  // Response data
  status: WebhookStatus;
  responseCode?: number;
  responseBody?: any;
  errorMessage?: string;

  // Retry mechanism
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  retrySchedule: number[]; // Array of delay in minutes [1, 5, 15, 60, 360]
  lastAttemptAt?: Date;

  // Processing
  processedAt?: Date;
  processingDuration?: number; // In milliseconds

  // Related entities
  transactionId?: string;
  customerId?: string;

  createdAt: Date;
  updatedAt: Date;

  // Methods
  scheduleRetry(): void;
  markSuccess(
    responseCode: number,
    responseBody?: any,
    duration?: number,
  ): Promise<void>;
  markFailed(errorMessage: string, responseCode?: number): Promise<void>;
  canRetry(): boolean;
}

const WebhookLogSchema = new Schema<IWebhookLog>(
  {
    orgId: {
      type: String,
      required: true,
      index: true,
    },
    event: {
      type: String,
      required: true,
      index: true,
    },
    eventId: {
      type: String,
      index: true,
    },
    source: {
      type: String,
      required: true,
      enum: ["pgpay", "stripe", "paypal", "dingconnect", "reloadly", "other"],
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    headers: {
      type: Map,
      of: String,
    },
    signature: String,
    ipAddress: String,
    status: {
      type: String,
      required: true,
      enum: ["pending", "success", "failed", "retrying"],
      default: "pending",
      index: true,
    },
    responseCode: Number,
    responseBody: Schema.Types.Mixed,
    errorMessage: String,
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 6,
      min: 1,
    },
    nextRetryAt: {
      type: Date,
      index: true,
    },
    retrySchedule: {
      type: [Number],
      default: [1, 5, 15, 60, 360], // 1min, 5min, 15min, 1hr, 6hr
    },
    lastAttemptAt: Date,
    processedAt: Date,
    processingDuration: Number,
    transactionId: {
      type: String,
      index: true,
    },
    customerId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
WebhookLogSchema.index(
  { source: 1, eventId: 1 },
  {
    unique: true,
    partialFilterExpression: { eventId: { $type: "string" } },
  },
);
WebhookLogSchema.index({ orgId: 1, status: 1, createdAt: -1 });
WebhookLogSchema.index({ source: 1, event: 1, createdAt: -1 });
WebhookLogSchema.index({ status: 1, nextRetryAt: 1 });
WebhookLogSchema.index({ createdAt: -1 });

// Schedule next retry
WebhookLogSchema.methods.scheduleRetry = function (): void {
  if (this.attempts >= this.maxAttempts) {
    this.status = "failed";
    this.nextRetryAt = undefined;
    return;
  }

  // Get delay for current attempt (use last value if beyond schedule)
  const delayMinutes =
    this.retrySchedule[this.attempts] ||
    this.retrySchedule[this.retrySchedule.length - 1];

  this.status = "retrying";
  this.nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  this.attempts += 1;
  this.lastAttemptAt = new Date();
};

// Mark webhook as successfully processed
WebhookLogSchema.methods.markSuccess = async function (
  responseCode: number,
  responseBody?: any,
  duration?: number,
): Promise<void> {
  this.status = "success";
  this.responseCode = responseCode;
  this.responseBody = responseBody;
  this.processedAt = new Date();
  this.processingDuration = duration;
  this.nextRetryAt = undefined;
  await this.save();
};

// Mark webhook as failed
WebhookLogSchema.methods.markFailed = async function (
  errorMessage: string,
  responseCode?: number,
): Promise<void> {
  this.errorMessage = errorMessage;
  this.responseCode = responseCode;

  if (this.canRetry()) {
    this.scheduleRetry();
  } else {
    this.status = "failed";
    this.nextRetryAt = undefined;
  }

  await this.save();
};

// Check if webhook can be retried
WebhookLogSchema.methods.canRetry = function (): boolean {
  return this.attempts < this.maxAttempts;
};

export const WebhookLog: Model<IWebhookLog> =
  mongoose.models.WebhookLog ||
  mongoose.model<IWebhookLog>("WebhookLog", WebhookLogSchema);
