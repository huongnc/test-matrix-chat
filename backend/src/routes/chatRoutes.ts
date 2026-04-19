import { Router } from "express";
import { z } from "zod";

import { env } from "../config/env";
import { AppUserRepository } from "../repositories/appUserRepository";
import { ChatSessionRepository } from "../repositories/chatSessionRepository";
import { MatrixService } from "../services/matrixService";
import { LoginInput } from "../types/chat";

const LoginSchema = z.object({
  homeserverUrl: z.string().url().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().min(1).optional()
});

const SendMessageSchema = z.object({
  sessionId: z.string().min(1),
  body: z.string().min(1).max(5000)
});

const CreateRoomSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(100),
  isPublic: z.boolean().optional()
});

const InviteSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1)
});

const JoinRoomSchema = z.object({
  sessionId: z.string().min(1),
  roomIdOrAlias: z.string().min(1)
});

const DirectRoomSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string().min(1).optional()
});

const RoomQuerySchema = z.object({
  sessionId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const SessionOnlyQuerySchema = z.object({
  sessionId: z.string().min(1)
});

const RegisterSchema = z.object({
  homeserverUrl: z.string().url().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  displayName: z.string().min(1).optional()
});

interface ChatRouterDeps {
  matrixService: MatrixService;
  sessionRepository: ChatSessionRepository;
  userRepository: AppUserRepository;
  defaultHomeserverUrl: string;
}

export const createChatRouter = (deps: ChatRouterDeps): Router => {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    try {
      const parsed = LoginSchema.parse(req.body);
      const loginInput: LoginInput = parsed.deviceId
        ? {
            homeserverUrl: parsed.homeserverUrl ?? deps.defaultHomeserverUrl,
            username: parsed.username,
            password: parsed.password,
            deviceId: parsed.deviceId
          }
        : {
            homeserverUrl: parsed.homeserverUrl ?? deps.defaultHomeserverUrl,
            username: parsed.username,
            password: parsed.password
          };

      const loginResult = await deps.matrixService.login(loginInput);
      const session = await deps.sessionRepository.createOrUpdate(loginResult);

      return res.status(200).json({
        sessionId: session.sessionId,
        userId: session.userId,
        homeserverUrl: session.homeserverUrl
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      return res.status(400).json({ error: message });
    }
  });

  router.post("/auth/register", async (req, res) => {
    try {
      const parsed = RegisterSchema.parse(req.body);
      const homeserverUrl = parsed.homeserverUrl ?? deps.defaultHomeserverUrl;

      try {
        await deps.matrixService.register(
          parsed.displayName
            ? {
                homeserverUrl,
                username: parsed.username,
                password: parsed.password,
                displayName: parsed.displayName
              }
            : {
                homeserverUrl,
                username: parsed.username,
                password: parsed.password
              },
          env.MATRIX_SHARED_SECRET
        );
      } catch (registerError) {
        const msg = registerError instanceof Error ? registerError.message : "";
        if (!msg.toLowerCase().includes("already taken") && !msg.toLowerCase().includes("user_in_use")) {
          throw registerError;
        }
      }

      const loginResult = await deps.matrixService.login({
        homeserverUrl,
        username: parsed.username,
        password: parsed.password
      });

      const session = await deps.sessionRepository.createOrUpdate(loginResult);
      await deps.userRepository.upsertUser({
        userId: loginResult.userId,
        username: parsed.username,
        homeserverUrl
      });

      return res.status(201).json({
        sessionId: session.sessionId,
        userId: session.userId,
        homeserverUrl: session.homeserverUrl
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Register failed";
      return res.status(400).json({ error: message });
    }
  });

  router.get("/users", async (_req, res) => {
    try {
      const users = await deps.userRepository.listUsers();
      return res.status(200).json({ users });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load users";
      return res.status(400).json({ error: message });
    }
  });

  router.post("/rooms", async (req, res) => {
    try {
      const parsed = CreateRoomSchema.parse(req.body);
      const session = await deps.sessionRepository.findBySessionId(parsed.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const room = await deps.matrixService.createRoom(
        session,
        parsed.isPublic === undefined
          ? { name: parsed.name }
          : { name: parsed.name, isPublic: parsed.isPublic }
      );

      return res.status(201).json({ room });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create room";
      return res.status(400).json({ error: message });
    }
  });

  router.post("/rooms/direct", async (req, res) => {
    try {
      const parsed = DirectRoomSchema.parse(req.body);
      const session = await deps.sessionRepository.findBySessionId(parsed.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const result = await deps.matrixService.findOrCreateDirectRoom(session, {
        userId: parsed.userId,
        ...(parsed.displayName ? { displayName: parsed.displayName } : {})
      });

      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open direct room";
      return res.status(400).json({ error: message });
    }
  });

  router.post("/rooms/join", async (req, res) => {
    try {
      const parsed = JoinRoomSchema.parse(req.body);
      const session = await deps.sessionRepository.findBySessionId(parsed.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const room = await deps.matrixService.joinRoom(session, {
        roomIdOrAlias: parsed.roomIdOrAlias
      });

      return res.status(201).json({ room });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to join room";
      return res.status(400).json({ error: message });
    }
  });

  router.post("/rooms/:roomId/invite", async (req, res) => {
    try {
      const parsed = InviteSchema.parse(req.body);
      const session = await deps.sessionRepository.findBySessionId(parsed.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      await deps.matrixService.inviteToRoom(session, {
        roomId: req.params.roomId,
        userId: parsed.userId
      });

      return res.status(201).json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to invite user";
      return res.status(400).json({ error: message });
    }
  });

  router.get("/rooms", async (req, res) => {
    try {
      const parsed = SessionOnlyQuerySchema.parse(req.query);
      const session = await deps.sessionRepository.findBySessionId(parsed.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const rooms = await deps.matrixService.listJoinedRooms(session);
      return res.status(200).json({ rooms });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load rooms";
      return res.status(400).json({ error: message });
    }
  });

  router.get("/rooms/:roomId/messages", async (req, res) => {
    try {
      const parsed = RoomQuerySchema.parse(req.query);
      const session = await deps.sessionRepository.findBySessionId(parsed.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const messages = await deps.matrixService.getRoomMessages(
        session,
        req.params.roomId,
        parsed.limit
      );

      return res.status(200).json({ messages });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load messages";
      return res.status(400).json({ error: message });
    }
  });

  router.post("/rooms/:roomId/messages", async (req, res) => {
    try {
      const parsed = SendMessageSchema.parse(req.body);
      const session = await deps.sessionRepository.findBySessionId(parsed.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      await deps.matrixService.sendMessage(session, req.params.roomId, parsed.body);
      return res.status(201).json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send message";
      return res.status(400).json({ error: message });
    }
  });

  return router;
};
