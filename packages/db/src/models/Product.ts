import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IProduct extends Document {
  orgId: string;
  name: string;
  description?: string;
  provider: 'dingconnect' | 'reloadly';
  providerProductId: string; // External product ID from provider
  operatorId: string; // External operator ID
  operatorName: string;
  operatorCountry: string;
  operatorLogo?: string;
  pricing: {
    costPrice: number; // What we pay to the provider
    sellPrice: number; // What we charge the customer
    currency: string;
    profitMargin: number; // Percentage
  };
  denomination: {
    type: 'fixed' | 'range';
    fixedAmount?: number;
    minAmount?: number;
    maxAmount?: number;
    unit: string; // 'USD', 'minutes', 'data'
  };
  // Resale settings
  resaleSettings: {
    allowedCountries: string[]; // ISO country codes, empty = all countries
    blockedCountries: string[]; // ISO country codes to block
    customPricing: {
      enabled: boolean;
      priceByCountry?: Map<string, number>; // Country-specific pricing
    };
    discount: {
      enabled: boolean;
      type?: 'percentage' | 'fixed';
      value?: number;
      startDate?: Date;
      endDate?: Date;
      minPurchaseAmount?: number;
    };
    limits: {
      minQuantity?: number;
      maxQuantity?: number;
      maxPerCustomer?: number; // Per customer per day
    };
  };
  // Sync settings
  sync: {
    autoSync: boolean; // Auto-sync with provider
    lastSyncAt?: Date;
    syncFrequency?: number; // In minutes
    lastSyncStatus?: 'success' | 'failed';
    lastSyncError?: string;
  };
  status: 'active' | 'inactive' | 'out_of_stock';
  metadata: {
    category?: string;
    tags?: string[];
    popularity?: number;
    totalSales?: number;
    revenue?: number;
  };
  createdAt: Date;
  updatedAt: Date;

  // Computed properties for backward compatibility
  readonly isVariableValue: boolean;
  readonly minAmount: number | undefined;
  readonly maxAmount: number | undefined;
  readonly skuCode: string;
  readonly providerCode: string;
  readonly benefitType: string;
  readonly isActive: boolean;

  // Methods
  getEffectivePrice(countryCode?: string): number;
  isAvailableInCountry(countryCode: string): boolean;
  validateQuantity(quantity: number): { valid: boolean; error?: string };
}

const ProductSchema = new Schema<IProduct>(
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
      trim: true,
    },
    provider: {
      type: String,
      required: true,
      enum: ['dingconnect', 'reloadly'],
    },
    providerProductId: {
      type: String,
      required: true,
    },
    operatorId: {
      type: String,
      required: true,
    },
    operatorName: {
      type: String,
      required: true,
    },
    operatorCountry: {
      type: String,
      required: true,
    },
    operatorLogo: String,
    pricing: {
      costPrice: {
        type: Number,
        required: true,
        min: 0,
      },
      sellPrice: {
        type: Number,
        required: true,
        min: 0,
      },
      currency: {
        type: String,
        required: true,
        default: 'USD',
      },
      profitMargin: {
        type: Number,
        required: true,
        min: 0,
      },
    },
    denomination: {
      type: {
        type: String,
        enum: ['fixed', 'range'],
        required: true,
      },
      fixedAmount: Number,
      minAmount: Number,
      maxAmount: Number,
      unit: {
        type: String,
        required: true,
      },
    },
    // Resale settings
    resaleSettings: {
      allowedCountries: {
        type: [String],
        default: [],
      },
      blockedCountries: {
        type: [String],
        default: [],
      },
      customPricing: {
        enabled: {
          type: Boolean,
          default: false,
        },
        priceByCountry: {
          type: Map,
          of: Number,
        },
      },
      discount: {
        enabled: {
          type: Boolean,
          default: false,
        },
        type: {
          type: String,
          enum: ['percentage', 'fixed'],
        },
        value: Number,
        startDate: Date,
        endDate: Date,
        minPurchaseAmount: Number,
      },
      limits: {
        minQuantity: Number,
        maxQuantity: Number,
        maxPerCustomer: Number,
      },
    },
    // Sync settings
    sync: {
      autoSync: {
        type: Boolean,
        default: false,
      },
      lastSyncAt: Date,
      syncFrequency: Number,
      lastSyncStatus: {
        type: String,
        enum: ['success', 'failed'],
      },
      lastSyncError: String,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'out_of_stock'],
      default: 'active',
    },
    metadata: {
      category: String,
      tags: [String],
      popularity: {
        type: Number,
        default: 0,
      },
      totalSales: {
        type: Number,
        default: 0,
      },
      revenue: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ProductSchema.index({ orgId: 1, status: 1 });
ProductSchema.index({ operatorCountry: 1 });
ProductSchema.index({ provider: 1, providerProductId: 1 });
ProductSchema.index({ 'metadata.category': 1 });

// Validate sell price >= cost price
ProductSchema.pre('save', function (next) {
  if (this.pricing.sellPrice < this.pricing.costPrice) {
    next(new Error('Sell price must be greater than or equal to cost price'));
  }
  // Calculate profit margin
  this.pricing.profitMargin = ((this.pricing.sellPrice - this.pricing.costPrice) / this.pricing.costPrice) * 100;
  next();
});

// Virtual properties for backward compatibility
ProductSchema.virtual('isVariableValue').get(function () {
  return this.denomination.type === 'range';
});

ProductSchema.virtual('minAmount').get(function () {
  return this.denomination.minAmount;
});

ProductSchema.virtual('maxAmount').get(function () {
  return this.denomination.maxAmount;
});

ProductSchema.virtual('skuCode').get(function () {
  return this.providerProductId;
});

ProductSchema.virtual('providerCode').get(function () {
  return this.provider;
});

ProductSchema.virtual('benefitType').get(function () {
  return this.denomination.unit.toLowerCase();
});

ProductSchema.virtual('isActive').get(function () {
  return this.status === 'active';
});

// Methods
ProductSchema.methods.getEffectivePrice = function (countryCode?: string): number {
  let price = this.pricing.sellPrice;

  // Apply country-specific pricing if enabled
  if (countryCode && this.resaleSettings.customPricing.enabled) {
    const countryPrice = this.resaleSettings.customPricing.priceByCountry?.get(countryCode);
    if (countryPrice) {
      price = countryPrice;
    }
  }

  // Apply discount if active
  if (this.resaleSettings.discount.enabled) {
    const now = new Date();
    const discountActive =
      (!this.resaleSettings.discount.startDate || this.resaleSettings.discount.startDate <= now) &&
      (!this.resaleSettings.discount.endDate || this.resaleSettings.discount.endDate >= now);

    if (discountActive && this.resaleSettings.discount.value) {
      if (this.resaleSettings.discount.type === 'percentage') {
        price = price - (price * this.resaleSettings.discount.value) / 100;
      } else if (this.resaleSettings.discount.type === 'fixed') {
        price = Math.max(0, price - this.resaleSettings.discount.value);
      }
    }
  }

  return Math.round(price * 100) / 100; // Round to 2 decimal places
};

ProductSchema.methods.isAvailableInCountry = function (countryCode: string): boolean {
  // Check if country is blocked
  if (this.resaleSettings.blockedCountries.includes(countryCode)) {
    return false;
  }

  // If allowedCountries is empty, product is available everywhere
  if (this.resaleSettings.allowedCountries.length === 0) {
    return true;
  }

  // Check if country is in allowed list
  return this.resaleSettings.allowedCountries.includes(countryCode);
};

ProductSchema.methods.validateQuantity = function (quantity: number): { valid: boolean; error?: string } {
  if (this.resaleSettings.limits.minQuantity && quantity < this.resaleSettings.limits.minQuantity) {
    return {
      valid: false,
      error: `Minimum quantity is ${this.resaleSettings.limits.minQuantity}`,
    };
  }

  if (this.resaleSettings.limits.maxQuantity && quantity > this.resaleSettings.limits.maxQuantity) {
    return {
      valid: false,
      error: `Maximum quantity is ${this.resaleSettings.limits.maxQuantity}`,
    };
  }

  return { valid: true };
};

export const Product: Model<IProduct> =
  mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);
