import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { ChatSessionModel } from "../models/ChatSession";
import { MongoChatSessionRepository } from "../repositories/chatSessionRepository";

describe("MongoChatSessionRepository", () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await ChatSessionModel.deleteMany({});
  });

  it("creates and fetches a session", async () => {
    const repository = new MongoChatSessionRepository();

    const created = await repository.createOrUpdate({
      homeserverUrl: "http://localhost:8008",
      userId: "@bob:local",
      accessToken: "token",
      deviceId: "device"
    });

    const found = await repository.findBySessionId(created.sessionId);

    expect(found).not.toBeNull();
    expect(found?.userId).toBe("@bob:local");
    expect(found?.accessToken).toBe("token");
  });

  it("reuses the same session for same user", async () => {
    const repository = new MongoChatSessionRepository();

    const first = await repository.createOrUpdate({
      homeserverUrl: "http://localhost:8008",
      userId: "@bob:local",
      accessToken: "token-1",
      deviceId: "device-a"
    });

    const second = await repository.createOrUpdate({
      homeserverUrl: "http://localhost:8008",
      userId: "@bob:local",
      accessToken: "token-2",
      deviceId: "device-b"
    });

    expect(second.sessionId).toBe(first.sessionId);

    const found = await repository.findBySessionId(first.sessionId);
    expect(found?.accessToken).toBe("token-2");
    expect(found?.deviceId).toBe("device-b");
  });
});
