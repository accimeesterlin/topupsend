import mongoose, { Schema, Document } from 'mongoose';
import { UserRole } from '@topupsend/types';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  roles: UserRole[];
  orgId: mongoose.Types.ObjectId;
  isActive: boolean;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  twoFactorEnabled: boolean;
  twoFactorCode?: string;
  twoFactorCodeExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: true, // Include by default for authentication
    },
    roles: {
      type: [String],
      enum: Object.values(UserRole),
      default: [UserRole.VIEWER],
      required: true,
    },
    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    resetPasswordToken: {
      type: String,
      select: false, // Don't include by default
    },
    resetPasswordExpires: {
      type: Date,
      select: false, // Don't include by default
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
      required: true,
    },
    twoFactorCode: {
      type: String,
      select: false, // Don't include by default
    },
    twoFactorCodeExpires: {
      type: Date,
      select: false, // Don't include by default
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Compound index for org queries
userSchema.index({ orgId: 1, email: 1 });
userSchema.index({ orgId: 1, isActive: 1 });

export const User = mongoose.models.User || mongoose.model<IUser>('User', userSchema);
