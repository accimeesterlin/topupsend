import mongoose, { Schema, Document } from 'mongoose';
import { PaymentProvider } from '@topupsend/types';

export interface IOrg extends Document {
  name: string;
  slug: string;
  settings: {
    allowedDomains?: string[];
    defaultMarkup?: number;
    [key: string]: any;
  };
  paymentProviders: PaymentProvider[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const orgSchema = new Schema<IOrg>(
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
    settings: {
      type: Schema.Types.Mixed,
      default: {},
    },
    paymentProviders: {
      type: [String],
      enum: Object.values(PaymentProvider),
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'orgs',
  }
);

export const Org = mongoose.models.Org || mongoose.model<IOrg>('Org', orgSchema);
