import mongoose, { Schema, Document } from 'mongoose';
import { UserRole } from '@topupsend/types';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  roles: UserRole[];
  orgId: mongoose.Types.ObjectId;
  isActive: boolean;
  /** Sign in with PG link: the PG OIDC subject (authId). Set only by the PG SSO callback. */
  pgAuthId?: string;
  /** Sign in with PG link: the PG User._id. Set only by the PG SSO callback. */
  pgUserId?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  twoFactorEnabled: boolean;
  /** SHA-256 hash of the current 2FA code (never the plaintext code). */
  twoFactorCode?: string;
  twoFactorCodeExpires?: Date;
  /** Failed verify attempts against the current code; reset on send/success. */
  twoFactorAttempts?: number;
  /** Server-side pending-auth state: set only after the password step passes. */
  twoFactorPendingId?: string;
  twoFactorPendingExpires?: Date;
  /** Session revalidation version; embedded in session JWTs as `tv`. */
  tokenVersion?: number;
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
    twoFactorAttempts: {
      type: Number,
      default: 0,
      select: false, // Don't include by default
    },
    twoFactorPendingId: {
      type: String,
      select: false, // Don't include by default
    },
    twoFactorPendingExpires: {
      type: Date,
      select: false, // Don't include by default
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    pgAuthId: {
      type: String,
      index: true,
      sparse: true,
    },
    pgUserId: {
      type: String,
      index: true,
      sparse: true,
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
