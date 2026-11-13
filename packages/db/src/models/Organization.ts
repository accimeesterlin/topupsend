import mongoose, { Schema, Document, Model } from "mongoose";

export interface IOrganization extends Document {
  name: string;
  slug: string;
  email: string;
  phone?: string;
  website?: string;
  address?: string;
  logo?: string;
  settings: {
    currency: string;
    timezone: string;
    language: string;
  };
  subscription: {
    plan: "free" | "basic" | "pro" | "enterprise";
    status: "active" | "cancelled" | "past_due";
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    prepaidMonths?: number;
    pendingUpgrade?: {
      tier: string;
      months: number;
      orderId: string;
      token: string;
      // Server-derived amount charged for this upgrade. Payment
      // confirmations are bound to it (verified amount must equal it)
      // before any activation — see F-C2/F-C4.
      amount?: number;
      status?: string;
      createdAt: Date;
      expiresAt: Date;
      lastChecked?: Date;
    };
    lastPayment?: {
      orderId: string;
      tier: string;
      amount: number;
      months: number;
      status: string;
      paidAt: Date;
    };
    paymentHistory?: Array<{
      orderId: string;
      tier: string;
      amount: number;
      months: number;
      status: "completed" | "failed" | "pending";
      paidAt: Date;
    }>;
  };
  // New pricing tier fields
  subscriptionTier: "starter" | "growth" | "scale" | "enterprise";
  transactionFeePercentage: number;
  limits: {
    organizations: number | "unlimited";
    teamMembers: number | "unlimited";
    transactionsPerMonth: number | "unlimited";
  };
  usage: {
    organizationsUsed: number;
    teamMembersUsed: number;
    transactionsThisMonth: number;
    lastTransactionReset: Date;
  };
  features: {
    whiteLabel: boolean | "partial";
    customDomain: boolean;
    apiAccess: boolean;
    webhooks: boolean | "advanced";
    zapier: boolean;
    advancedDiscounts: boolean;
    staffPortal: boolean | "limited";
    priorityProcessing: boolean;
    auditLogs: boolean;
    multiLanguage: boolean | "full";
    dedicatedSupport: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    logo: {
      type: String,
    },
    settings: {
      currency: {
        type: String,
        default: "USD",
      },
      timezone: {
        type: String,
        default: "UTC",
      },
      language: {
        type: String,
        default: "en",
      },
    },
    subscription: {
      plan: {
        type: String,
        enum: ["free", "basic", "pro", "enterprise"],
        default: "free",
      },
      status: {
        type: String,
        enum: ["active", "cancelled", "past_due"],
        default: "active",
      },
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
      prepaidMonths: {
        type: Number,
      },
      pendingUpgrade: {
        tier: { type: String },
        months: { type: Number },
        orderId: { type: String, index: true },
        token: { type: String },
        amount: { type: Number },
        status: { type: String },
        createdAt: { type: Date },
        expiresAt: { type: Date },
        lastChecked: { type: Date },
      },
      lastPayment: {
        orderId: { type: String, index: true },
        tier: { type: String },
        amount: { type: Number },
        months: { type: Number },
        status: { type: String },
        paidAt: { type: Date },
      },
      paymentHistory: [
        {
          orderId: { type: String },
          tier: { type: String },
          amount: { type: Number },
          months: { type: Number },
          status: { type: String, enum: ["completed", "failed", "pending"] },
          paidAt: { type: Date },
        },
      ],
    },
    // New pricing tier fields
    subscriptionTier: {
      type: String,
      enum: ["starter", "growth", "scale", "enterprise"],
      default: "starter",
    },
    transactionFeePercentage: {
      type: Number,
      default: 4.0,
    },
    limits: {
      organizations: {
        type: Schema.Types.Mixed,
        default: 1,
      },
      teamMembers: {
        type: Schema.Types.Mixed,
        default: 1,
      },
      transactionsPerMonth: {
        type: Schema.Types.Mixed,
        default: 200,
      },
    },
    usage: {
      organizationsUsed: {
        type: Number,
        default: 0,
      },
      teamMembersUsed: {
        type: Number,
        default: 0,
      },
      transactionsThisMonth: {
        type: Number,
        default: 0,
      },
      lastTransactionReset: {
        type: Date,
        default: Date.now,
      },
    },
    features: {
      whiteLabel: {
        type: Schema.Types.Mixed,
        default: false,
      },
      customDomain: {
        type: Boolean,
        default: false,
      },
      apiAccess: {
        type: Boolean,
        default: false,
      },
      webhooks: {
        type: Schema.Types.Mixed,
        default: false,
      },
      zapier: {
        type: Boolean,
        default: false,
      },
      advancedDiscounts: {
        type: Boolean,
        default: false,
      },
      staffPortal: {
        type: Schema.Types.Mixed,
        default: false,
      },
      priorityProcessing: {
        type: Boolean,
        default: false,
      },
      auditLogs: {
        type: Boolean,
        default: false,
      },
      multiLanguage: {
        type: Schema.Types.Mixed,
        default: false,
      },
      dedicatedSupport: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
OrganizationSchema.index({ email: 1 });
OrganizationSchema.index({ createdAt: -1 });

export const Organization: Model<IOrganization> =
  mongoose.models.Org ||
  mongoose.model<IOrganization>("Org", OrganizationSchema);
