import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A developer "app" registered by an organization.
 *
 * Apps are the grouping unit for self-serve API keys in the seller
 * dashboard's Developers section: an org admin creates an app, then
 * creates one or more API keys under it (see ApiKey.appId). Keys that
 * predate apps (staff-portal and customer keys) have no app and keep
 * behaving exactly as before.
 */
export interface IApp extends Document {
  orgId: string;
  name: string;
  description?: string;
  createdBy: string; // Staff userId of the org admin who created the app
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AppSchema = new Schema<IApp>(
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
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    createdBy: {
      type: String,
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

AppSchema.index({ orgId: 1, isActive: 1 });
AppSchema.index({ orgId: 1, name: 1 });

export const App: Model<IApp> =
  mongoose.models.App || mongoose.model<IApp>("App", AppSchema);
