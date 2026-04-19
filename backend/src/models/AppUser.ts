import { Model, Schema, model, models } from "mongoose";

export interface AppUserDocument {
  userId: string;
  username: string;
  homeserverUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const AppUserSchema = new Schema<AppUserDocument>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, index: true },
    homeserverUrl: { type: String, required: true }
  },
  { timestamps: true }
);

export const AppUserModel =
  (models.AppUser as Model<AppUserDocument>) ||
  model<AppUserDocument>("AppUser", AppUserSchema);
