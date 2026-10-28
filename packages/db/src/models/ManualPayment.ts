import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * ManualPayment — a payment an organization received OUTSIDE the platform's
 * online checkout (cash, bank transfer, MonCash/Natcash in person, check),
 * recorded by staff.
 *
 * Records are immutable: they are never edited or deleted. The only state
 * change after creation is voiding (status "voided", with a required reason).
 * Every effect a manual payment causes (an order marked paid, a customer
 * balance history entry) cross-references this record's id.
 */

export type ManualPaymentMethod =
  | "cash"
  | "bank_transfer"
  | "moncash"
  | "natcash"
  | "check"
  | "other";

export type ManualPaymentApplication = "order" | "customer_balance";

export type ManualPaymentStatus = "recorded" | "voided";

export interface IManualPayment extends Document {
  orgId: string;
  /** The customer who paid (required when appliedTo is "customer_balance") */
  customerId?: string;
  /** The transaction/order the payment settles (when appliedTo is "order") */
  transactionId?: string;
  /** Human-facing order id (ORD-…), denormalized for display */
  orderId?: string;
  amount: number;
  currency: string;
  method: ManualPaymentMethod;
  /** External reference (transfer id, MonCash/Natcash txn id, receipt no.) */
  reference?: string;
  /** Optional proof pointer (receipt number, link stored elsewhere) */
  proofReference?: string;
  notes?: string;
  /** When the money actually arrived (staff-settable; defaults to now) */
  receivedAt: Date;
  appliedTo: ManualPaymentApplication;
  status: ManualPaymentStatus;
  /** Staff user id who recorded the payment */
  createdBy: string;
  voidedBy?: string;
  voidedAt?: Date;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ManualPaymentSchema = new Schema<IManualPayment>(
  {
    orgId: {
      type: String,
      required: true,
      index: true,
    },
    customerId: {
      type: String,
      index: true,
    },
    transactionId: {
      type: String,
      index: true,
    },
    orderId: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value: number) =>
          value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        message: "Amount must be greater than 0 with at most 2 decimal places",
      },
    },
    currency: {
      type: String,
      required: true,
    },
    method: {
      type: String,
      required: true,
      enum: ["cash", "bank_transfer", "moncash", "natcash", "check", "other"],
    },
    reference: {
      type: String,
      // A reference is required for every method except cash, so an
      // electronic payment can always be traced back to the provider record.
      required: function (this: IManualPayment) {
        return this.method !== "cash";
      },
    },
    proofReference: {
      type: String,
    },
    notes: {
      type: String,
    },
    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    appliedTo: {
      type: String,
      required: true,
      enum: ["order", "customer_balance"],
    },
    status: {
      type: String,
      required: true,
      enum: ["recorded", "voided"],
      default: "recorded",
      index: true,
    },
    createdBy: {
      type: String,
      required: true,
    },
    voidedBy: {
      type: String,
    },
    voidedAt: {
      type: Date,
    },
    voidReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries
ManualPaymentSchema.index({ orgId: 1, createdAt: -1 });
ManualPaymentSchema.index({ orgId: 1, customerId: 1 });
ManualPaymentSchema.index({ orgId: 1, method: 1, reference: 1 });

export const ManualPayment: Model<IManualPayment> =
  mongoose.models.ManualPayment ||
  mongoose.model<IManualPayment>("ManualPayment", ManualPaymentSchema);
