import mongoose, { Document, Schema } from 'mongoose';
import { randomInt } from 'crypto';

export interface IDiscount extends Document {
  orgId: string;
  name: string;
  description: string;
  code?: string; // Optional discount code (e.g., "SAVE20", "WELCOME10") - if empty, it's an automatic discount
  type: 'percentage' | 'fixed';
  value: number;
  isActive: boolean;
  startDate?: Date;
  endDate?: Date;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  applicableCountries?: string[];
  applicableProducts?: string[]; // Product SKU codes
  usageLimit?: number;
  usageCount: number;
  maxUsesPerCustomer?: number; // Max uses per customer email
  createdAt: Date;
  updatedAt: Date;

  // Methods
  isValid(): boolean;
  canBeUsed(): boolean;
  calculateDiscount(amount: number): number;
}

// Static method to generate a random code
export interface IDiscountModel extends mongoose.Model<IDiscount> {
  generateCode(length?: number): string;
}

const DiscountSchema = new Schema<IDiscount>(
  {
    orgId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true, // Allows multiple null values but unique non-null values
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['percentage', 'fixed'],
      default: 'percentage',
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    minPurchaseAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    maxDiscountAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    applicableCountries: {
      type: [String],
      default: [],
    },
    applicableProducts: {
      type: [String],
      default: [],
    },
    usageLimit: {
      type: Number,
      min: 0,
      default: null,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxUsesPerCustomer: {
      type: Number,
      min: 1,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
DiscountSchema.index({ orgId: 1, isActive: 1 });
DiscountSchema.index({ orgId: 1, startDate: 1, endDate: 1 });
DiscountSchema.index({ orgId: 1, code: 1 }, { unique: true, partialFilterExpression: { code: { $exists: true, $ne: null } } });

// Check if discount is currently valid (date range and usage limit)
DiscountSchema.methods.isValid = function (): boolean {
  const now = new Date();

  // Check if discount is active
  if (!this.isActive) {
    return false;
  }

  // Check start date
  if (this.startDate && now < this.startDate) {
    return false;
  }

  // Check end date
  if (this.endDate && now > this.endDate) {
    return false;
  }

  // Check usage limit
  if (this.usageLimit !== null && this.usageLimit !== undefined) {
    if (this.usageCount >= this.usageLimit) {
      return false;
    }
  }

  return true;
};

// Check if discount can be used
DiscountSchema.methods.canBeUsed = function (): boolean {
  return this.isValid();
};

// Calculate discount amount for a given purchase amount
DiscountSchema.methods.calculateDiscount = function (amount: number): number {
  if (!this.isValid()) {
    return 0;
  }

  // Check minimum purchase amount
  if (this.minPurchaseAmount && amount < this.minPurchaseAmount) {
    return 0;
  }

  let discount = 0;

  if (this.type === 'percentage') {
    discount = amount * (this.value / 100);
  } else {
    discount = this.value;
  }

  // Apply maximum discount cap if set
  if (this.maxDiscountAmount && discount > this.maxDiscountAmount) {
    discount = this.maxDiscountAmount;
  }

  // Ensure discount doesn't exceed purchase amount
  if (discount > amount) {
    discount = amount;
  }

  return Math.round(discount * 100) / 100; // Round to 2 decimal places
};

// Static method to generate a random discount code.
// Discount codes are bearer values (whoever holds one gets the discount),
// so they are drawn from a CSPRNG, not Math.random (F-M5).
DiscountSchema.statics.generateCode = function (length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar-looking characters (I, O, 0, 1, L)
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(randomInt(0, chars.length));
  }
  return code;
};

export const Discount = mongoose.models.Discount || (mongoose.model<IDiscount, IDiscountModel>('Discount', DiscountSchema));
