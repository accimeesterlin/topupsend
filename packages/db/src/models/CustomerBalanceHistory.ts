import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICustomerBalanceHistory extends Document {
  customerId: mongoose.Types.ObjectId;
  orgId: string;
  amount: number;
  type: "assignment" | "usage" | "reset" | "adjustment" | "refund" | "payment";
  previousBalance: number;
  newBalance: number;
  description: string;
  metadata?: {
    phoneNumber?: string;
    productName?: string;
    orderId?: string;
    adminId?: string;
    transactionId?: string;
    manualPaymentId?: string;
    method?: string;
    reference?: string;
    expiresAt?: Date;
    notes?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const CustomerBalanceHistorySchema = new Schema<ICustomerBalanceHistory>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    orgId: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["assignment", "usage", "reset", "adjustment", "refund", "payment"],
      index: true,
    },
    previousBalance: {
      type: Number,
      required: true,
      min: 0,
    },
    newBalance: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      required: true,
    },
    metadata: {
      phoneNumber: String,
      productName: String,
      orderId: String,
      adminId: String,
      transactionId: String,
      manualPaymentId: String,
      method: String,
      reference: String,
      expiresAt: Date,
      notes: String,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
CustomerBalanceHistorySchema.index({ customerId: 1, createdAt: -1 });
CustomerBalanceHistorySchema.index({ orgId: 1, createdAt: -1 });
CustomerBalanceHistorySchema.index({ orgId: 1, type: 1, createdAt: -1 });
CustomerBalanceHistorySchema.index({ createdAt: -1 });

export const CustomerBalanceHistory: Model<ICustomerBalanceHistory> =
  mongoose.models.CustomerBalanceHistory ||
  mongoose.model<ICustomerBalanceHistory>(
    "CustomerBalanceHistory",
    CustomerBalanceHistorySchema,
  );
