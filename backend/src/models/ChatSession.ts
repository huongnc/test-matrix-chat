import { Model, Schema, model, models } from "mongoose";

export interface ChatSessionDocument {
  sessionId: string;
  homeserverUrl: string;
  userId: string;
  accessToken: string;
  deviceId: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChatSessionSchema = new Schema<ChatSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    homeserverUrl: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    accessToken: { type: String, required: true },
    deviceId: { type: String, required: true }
  },
  { timestamps: true }
);

ChatSessionSchema.index({ homeserverUrl: 1, userId: 1 }, { unique: true });

export const ChatSessionModel =
  (models.ChatSession as Model<ChatSessionDocument>) ||
  model<ChatSessionDocument>("ChatSession", ChatSessionSchema);
