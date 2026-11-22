import mongoose, { Schema, Document, Model } from "mongoose";
import crypto from "crypto";

export type ApiKeyScope =
  | "balance:read"
  | "balance:write"
  | "transactions:read"
  | "transactions:create"
  | "topup:send"
  | "customer:read"
  | "customer:update"
  | "webhooks:read"
  | "admin:*";

export type ApiKeyOwnerType = "staff" | "customer";

export interface IApiKey extends Document {
  key: string; // Hashed API key
  keyPrefix: string; // First 8 chars for display (e.g., "pk_live_...")
  orgId: string;
  ownerId: string; // UserOrganization ID or Customer ID
  ownerType: ApiKeyOwnerType;
  // Developer-app linkage (self-serve dashboard keys only). Legacy
  // staff-portal / customer keys have appId unset and behave as before.
  appId?: string;
  createdBy?: string; // Staff userId that created the key, when recorded
  name: string;
  scopes: ApiKeyScope[];

  // Rate limiting
  rateLimit: {
    requests: number; // Number of requests
    window: number; // Time window in seconds (e.g., 3600 for 1 hour)
  };
  customRateLimit?: {
    requests: number;
    window: number;
  };

  // Usage tracking
  lastUsedAt?: Date;
  usageCount: number;

  // Lifecycle
  isActive: boolean;
  expiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;

  // Methods
  validateScope(requiredScope: ApiKeyScope | ApiKeyScope[]): boolean;
  getRateLimit(): { requests: number; window: number };
  incrementUsage(): Promise<void>;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      select: false, // Never return the actual key
    },
    keyPrefix: {
      type: String,
      required: true,
      index: true,
    },
    orgId: {
      type: String,
      required: true,
      index: true,
    },
    ownerId: {
      type: String,
      required: true,
      index: true,
    },
    ownerType: {
      type: String,
      required: true,
      enum: ["staff", "customer"],
      index: true,
    },
    appId: {
      type: String,
      index: true,
      sparse: true,
    },
    createdBy: {
      type: String,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    scopes: {
      type: [String],
      required: true,
      validate: {
        validator: function (scopes: string[]) {
          const validScopes: ApiKeyScope[] = [
            "balance:read",
            "balance:write",
            "transactions:read",
            "transactions:create",
            "topup:send",
            "customer:read",
            "customer:update",
            "webhooks:read",
            "admin:*",
          ];
          return scopes.every((scope) =>
            validScopes.includes(scope as ApiKeyScope),
          );
        },
        message: "Invalid scope provided",
      },
    },
    rateLimit: {
      requests: {
        type: Number,
        required: true,
        default: 1000,
        min: 1,
      },
      window: {
        type: Number,
        required: true,
        default: 3600, // 1 hour in seconds
        min: 1,
      },
    },
    customRateLimit: {
      requests: {
        type: Number,
        min: 100,
        max: 50000,
      },
      window: {
        type: Number,
        min: 1,
      },
    },
    lastUsedAt: {
      type: Date,
      index: true,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
ApiKeySchema.index({ orgId: 1, isActive: 1 });
ApiKeySchema.index({ ownerId: 1, ownerType: 1, isActive: 1 });
ApiKeySchema.index({ appId: 1, isActive: 1 });
ApiKeySchema.index({ expiresAt: 1 }, { sparse: true });

// Validate scope method
ApiKeySchema.methods.validateScope = function (
  requiredScope: ApiKeyScope | ApiKeyScope[],
): boolean {
  // Admin wildcard has all permissions
  if (this.scopes.includes("admin:*")) {
    return true;
  }

  const required = Array.isArray(requiredScope)
    ? requiredScope
    : [requiredScope];

  // Check if all required scopes are present
  return required.every((scope) => this.scopes.includes(scope));
};

// Get effective rate limit (custom overrides default)
ApiKeySchema.methods.getRateLimit = function (): {
  requests: number;
  window: number;
} {
  if (this.customRateLimit && this.customRateLimit.requests) {
    return this.customRateLimit;
  }
  return this.rateLimit;
};

// Increment usage count
ApiKeySchema.methods.incrementUsage = async function (): Promise<void> {
  this.lastUsedAt = new Date();
  this.usageCount += 1;
  await this.save();
};

// Static method to generate a new API key
ApiKeySchema.statics.generateKey = function (ownerType: ApiKeyOwnerType): {
  key: string;
  hash: string;
  prefix: string;
} {
  // Generate random key (32 bytes = 64 hex chars)
  const randomKey = crypto.randomBytes(32).toString("hex");

  // Create key with prefix based on owner type
  const prefix = ownerType === "staff" ? "sk_live" : "ck_live";
  const key = `${prefix}_${randomKey}`;

  // Hash the key for storage
  const hash = crypto.createHash("sha256").update(key).digest("hex");

  // Get display prefix (first 12 chars)
  const keyPrefix = key.substring(0, 12);

  return { key, hash, prefix: keyPrefix };
};

// Static method to hash an API key for lookup
ApiKeySchema.statics.hashKey = function (key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
};

export const ApiKey: Model<IApiKey> =
  mongoose.models.ApiKey || mongoose.model<IApiKey>("ApiKey", ApiKeySchema);
