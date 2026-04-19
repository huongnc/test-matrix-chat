import { randomUUID } from "crypto";

import { ChatSessionModel } from "../models/ChatSession";
import { MatrixSession } from "../types/chat";

export interface ChatSessionRepository {
  createOrUpdate(input: Omit<MatrixSession, "sessionId">): Promise<MatrixSession>;
  findBySessionId(sessionId: string): Promise<MatrixSession | null>;
}

export class MongoChatSessionRepository implements ChatSessionRepository {
  async createOrUpdate(
    input: Omit<MatrixSession, "sessionId">
  ): Promise<MatrixSession> {
    const found = await ChatSessionModel.findOneAndUpdate(
      {
        homeserverUrl: input.homeserverUrl,
        userId: input.userId
      },
      {
        $set: {
          accessToken: input.accessToken,
          deviceId: input.deviceId
        },
        $setOnInsert: {
          sessionId: randomUUID(),
          homeserverUrl: input.homeserverUrl,
          userId: input.userId
        }
      },
      {
        upsert: true,
        returnDocument: "after"
      }
    ).lean();

    if (!found) {
      throw new Error("Failed to create or update session");
    }

    return {
      sessionId: found.sessionId,
      ...input
    };
  }

  async findBySessionId(sessionId: string): Promise<MatrixSession | null> {
    const found = await ChatSessionModel.findOne({ sessionId }).lean();
    if (!found) {
      return null;
    }

    return {
      sessionId: found.sessionId,
      homeserverUrl: found.homeserverUrl,
      userId: found.userId,
      accessToken: found.accessToken,
      deviceId: found.deviceId
    };
  }
}
