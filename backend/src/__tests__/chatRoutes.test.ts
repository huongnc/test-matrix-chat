import request from "supertest";

import { createApp } from "../app";
import { AppUserRecord, AppUserRepository } from "../repositories/appUserRepository";
import { ChatSessionRepository } from "../repositories/chatSessionRepository";
import { MatrixService } from "../services/matrixService";
import { MatrixMessage, MatrixRoom, MatrixSession } from "../types/chat";

class InMemorySessionRepository implements ChatSessionRepository {
  private readonly sessions = new Map<string, MatrixSession>();

  async createOrUpdate(
    input: Omit<MatrixSession, "sessionId">
  ): Promise<MatrixSession> {
    const existing = Array.from(this.sessions.values()).find(
      (session) =>
        session.homeserverUrl === input.homeserverUrl && session.userId === input.userId
    );

    const session: MatrixSession = {
      sessionId: existing?.sessionId ?? "session-1",
      ...input
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  async findBySessionId(sessionId: string): Promise<MatrixSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }
}

class InMemoryAppUserRepository implements AppUserRepository {
  private readonly users: AppUserRecord[] = [];

  async upsertUser(input: {
    userId: string;
    username: string;
    homeserverUrl: string;
  }): Promise<void> {
    const existing = this.users.find((user) => user.userId === input.userId);
    if (existing) {
      existing.username = input.username;
      existing.homeserverUrl = input.homeserverUrl;
      return;
    }

    this.users.push({
      userId: input.userId,
      username: input.username,
      homeserverUrl: input.homeserverUrl,
      createdAt: new Date().toISOString()
    });
  }

  async listUsers(): Promise<AppUserRecord[]> {
    return this.users;
  }
}

describe("chat routes", () => {
  const sessionRepository = new InMemorySessionRepository();
  const userRepository = new InMemoryAppUserRepository();

  const mockRooms: MatrixRoom[] = [{ roomId: "!room:local", name: "General" }];
  const mockMessages: MatrixMessage[] = [
    {
      eventId: "$1",
      sender: "@alice:local",
      body: "hello",
      msgtype: "m.text",
      originServerTs: Date.now()
    }
  ];

  const matrixService: MatrixService = {
    register: jest.fn(async () => undefined),
    login: jest.fn(async () => ({
      homeserverUrl: "http://localhost:8008",
      userId: "@alice:local",
      accessToken: "token-1",
      deviceId: "device-1"
    })),
    listJoinedRooms: jest.fn(async () => mockRooms),
    findOrCreateDirectRoom: jest.fn(async () => ({
      room: {
        roomId: "!dm:local",
        name: "DM: bob"
      },
      created: true
    })),
    createRoom: jest.fn(async (_session, input) => ({
      roomId: "!newroom:local",
      name: input.name
    })),
    inviteToRoom: jest.fn(async () => undefined),
    joinRoom: jest.fn(async () => ({
      roomId: "!joined:local",
      name: "!joined:local"
    })),
    getRoomMessages: jest.fn(async () => mockMessages),
    sendMessage: jest.fn(async () => undefined)
  };

  const app = createApp({
    matrixService,
    sessionRepository,
    userRepository
  });

  it("logs in and returns a session id", async () => {
    const response = await request(app).post("/api/auth/login").send({
      homeserverUrl: "http://localhost:8008",
      username: "alice",
      password: "pass123"
    });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe("session-1");
  });

  it("rejects invalid login payload", async () => {
    const response = await request(app).post("/api/auth/login").send({
      username: "",
      password: ""
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it("registers and returns a session id", async () => {
    const response = await request(app).post("/api/auth/register").send({
      homeserverUrl: "http://localhost:8008",
      username: "new-user",
      password: "pass123",
      displayName: "New User"
    });

    expect(response.status).toBe(201);
    expect(response.body.sessionId).toBe("session-1");
    expect(matrixService.register).toHaveBeenCalledTimes(1);
  });

  it("lists all users from db", async () => {
    const response = await request(app).get("/api/users");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.users)).toBe(true);
  });

  it("returns joined rooms for valid session", async () => {
    const response = await request(app).get("/api/rooms").query({
      sessionId: "session-1"
    });

    expect(response.status).toBe(200);
    expect(response.body.rooms).toHaveLength(1);
  });

  it("creates a room", async () => {
    const response = await request(app).post("/api/rooms").send({
      sessionId: "session-1",
      name: "Project Alpha",
      isPublic: false
    });

    expect(response.status).toBe(201);
    expect(response.body.room.roomId).toBe("!newroom:local");
  });

  it("finds or creates direct room", async () => {
    const response = await request(app).post("/api/rooms/direct").send({
      sessionId: "session-1",
      userId: "@bob:chat.yourapp.com",
      displayName: "bob"
    });

    expect(response.status).toBe(201);
    expect(response.body.room.roomId).toBe("!dm:local");
  });

  it("invites a user to room", async () => {
    const response = await request(app)
      .post("/api/rooms/%21newroom%3Alocal/invite")
      .send({
        sessionId: "session-1",
        userId: "@bob:chat.yourapp.com"
      });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
  });

  it("joins room by room id or alias", async () => {
    const response = await request(app).post("/api/rooms/join").send({
      sessionId: "session-1",
      roomIdOrAlias: "!joined:local"
    });

    expect(response.status).toBe(201);
    expect(response.body.room.roomId).toBe("!joined:local");
  });

  it("returns messages for selected room", async () => {
    const response = await request(app)
      .get("/api/rooms/%21room%3Alocal/messages")
      .query({ sessionId: "session-1", limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.messages[0].body).toBe("hello");
  });

  it("sends a message", async () => {
    const response = await request(app)
      .post("/api/rooms/%21room%3Alocal/messages")
      .send({ sessionId: "session-1", body: "new message" });

    expect(response.status).toBe(201);
  });

  it("returns 404 if session is missing", async () => {
    const response = await request(app).get("/api/rooms").query({
      sessionId: "missing"
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Session not found");
  });
});
