import mongoose, { Schema, Document, Model } from "mongoose";
import { UserRole, Permission } from "@topupsend/types";

export interface IUserOrganization extends Document {
  userId: mongoose.Types.ObjectId;
  orgId: mongoose.Types.ObjectId;
  roles: UserRole[];
  customPermissions?: Permission[];
  isActive: boolean;
  invitedBy?: mongoose.Types.ObjectId;
  invitedAt?: Date;
  joinedAt: Date;
  balanceLimit?: {
    enabled: boolean;
    maxBalance: number;
    currentUsed: number;
  };
  createdAt: Date;
  updatedAt: Date;

  // Methods
  hasAvailableBalance(amount: number): boolean;
  useBalance(
    amount: number,
    metadata?: { phoneNumber?: string; productName?: string; orderId?: string },
  ): Promise<void>;
  resetBalance(adminId?: mongoose.Types.ObjectId): Promise<void>;
  hasPermission(permission: Permission): boolean;
  getEffectivePermissions(): Permission[];
}

const UserOrganizationSchema = new Schema<IUserOrganization>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    orgId: {
      type: Schema.Types.ObjectId,
      ref: "Org",
      required: true,
      index: true,
    },
    roles: {
      type: [String],
      enum: Object.values(UserRole),
      default: [UserRole.VIEWER],
      required: true,
    },
    customPermissions: {
      type: [String],
      enum: Object.values(Permission),
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    invitedAt: {
      type: Date,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    balanceLimit: {
      enabled: {
        type: Boolean,
        default: false,
      },
      maxBalance: {
        type: Number,
        default: 0,
      },
      currentUsed: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes
UserOrganizationSchema.index({ userId: 1, orgId: 1 }, { unique: true });
UserOrganizationSchema.index({ userId: 1, isActive: 1 });
UserOrganizationSchema.index({ orgId: 1, isActive: 1 });

// Instance Methods
UserOrganizationSchema.methods.hasAvailableBalance = function (
  amount: number,
): boolean {
  // If balance limit is not enabled, allow unlimited access
  if (!this.balanceLimit || !this.balanceLimit.enabled) {
    return true;
  }

  const available =
    this.balanceLimit.maxBalance - this.balanceLimit.currentUsed;
  return available >= amount;
};

UserOrganizationSchema.methods.useBalance = async function (
  amount: number,
  metadata?: { phoneNumber?: string; productName?: string; orderId?: string },
): Promise<void> {
  if (!this.balanceLimit || !this.balanceLimit.enabled) {
    return; // No limit, allow transaction
  }

  if (!this.hasAvailableBalance(amount)) {
    throw new Error(
      "Insufficient balance limit. Please contact your administrator.",
    );
  }

  const previousBalance = this.balanceLimit.currentUsed;
  this.balanceLimit.currentUsed += amount;
  await this.save();

  // Create history record
  try {
    const { BalanceHistory } = await import("./BalanceHistory");
    await BalanceHistory.create({
      userOrgId: this._id,
      orgId: this.orgId,
      userId: this.userId,
      amount,
      type: "usage",
      previousBalance,
      newBalance: this.balanceLimit.currentUsed,
      description: `Used $${amount.toFixed(2)} for ${metadata?.productName || "transaction"}`,
      metadata,
    });
  } catch (error) {
    console.error("Failed to create balance history:", error);
    // Don't fail the transaction if history creation fails
  }
};

UserOrganizationSchema.methods.resetBalance = async function (
  adminId?: mongoose.Types.ObjectId,
): Promise<void> {
  const previousBalance = this.balanceLimit?.currentUsed || 0;

  if (!this.balanceLimit) {
    this.balanceLimit = {
      enabled: false,
      maxBalance: 0,
      currentUsed: 0,
    };
  } else {
    this.balanceLimit.currentUsed = 0;
  }
  await this.save();

  // Create history record
  if (previousBalance > 0) {
    try {
      const { BalanceHistory } = await import("./BalanceHistory");
      await BalanceHistory.create({
        userOrgId: this._id,
        orgId: this.orgId,
        userId: this.userId,
        amount: -previousBalance,
        type: "reset",
        previousBalance,
        newBalance: 0,
        description: `Balance reset by administrator`,
        metadata: {
          adminId,
        },
      });
    } catch (error) {
      console.error("Failed to create balance history:", error);
    }
  }
};

// Role-based default permissions
const rolePermissions: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: Object.values(Permission), // Admins have all permissions
  [UserRole.OPERATOR]: [
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_STOREFRONT_SETTINGS,
    Permission.VIEW_PRODUCTS,
    Permission.VIEW_PRICING,
    Permission.VIEW_DISCOUNTS,
    Permission.VIEW_COUNTRIES,
    Permission.VIEW_TRANSACTIONS,
    Permission.PROCESS_TRANSACTIONS,
    Permission.VIEW_CUSTOMERS,
    Permission.VIEW_CUSTOMER_BALANCE,
    Permission.VIEW_TEAM,
    Permission.VIEW_INTEGRATIONS,
    Permission.VIEW_PAYMENT_SETTINGS,
    Permission.VIEW_WALLET,
    Permission.VIEW_OWN_TRANSACTIONS,
    Permission.VIEW_OWN_BALANCE,
    Permission.MANAGE_OWN_API_KEYS,
  ],
  [UserRole.VIEWER]: [
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_STOREFRONT_SETTINGS,
    Permission.VIEW_PRODUCTS,
    Permission.VIEW_PRICING,
    Permission.VIEW_DISCOUNTS,
    Permission.VIEW_COUNTRIES,
    Permission.VIEW_TRANSACTIONS,
    Permission.VIEW_CUSTOMERS,
    Permission.VIEW_TEAM,
    Permission.VIEW_INTEGRATIONS,
    Permission.VIEW_PAYMENT_SETTINGS,
    Permission.VIEW_WALLET,
    Permission.VIEW_OWN_TRANSACTIONS,
    Permission.VIEW_OWN_BALANCE,
    Permission.MANAGE_OWN_API_KEYS,
  ],
  [UserRole.CUSTOMER]: [
    // Customers have no admin dashboard permissions
  ],
};

UserOrganizationSchema.methods.getEffectivePermissions =
  function (): Permission[] {
    // If custom permissions are set, use them
    if (this.customPermissions && this.customPermissions.length > 0) {
      return this.customPermissions;
    }

    // Otherwise, use role-based permissions (combine all roles)
    const permissions = new Set<Permission>();
    for (const role of this.roles) {
      const rolePerms = rolePermissions[role as UserRole] || [];
      rolePerms.forEach((perm: Permission) => permissions.add(perm));
    }

    return Array.from(permissions);
  };

UserOrganizationSchema.methods.hasPermission = function (
  permission: Permission,
): boolean {
  const effectivePermissions = this.getEffectivePermissions();
  return effectivePermissions.includes(permission);
};

export const UserOrganization: Model<IUserOrganization> =
  mongoose.models.UserOrganization ||
  mongoose.model<IUserOrganization>("UserOrganization", UserOrganizationSchema);
