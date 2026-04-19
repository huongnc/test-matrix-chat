import cors from "cors";
import express, { Express } from "express";

import { env } from "./config/env";
import { AppUserRepository, MongoAppUserRepository } from "./repositories/appUserRepository";
import {
  ChatSessionRepository,
  MongoChatSessionRepository
} from "./repositories/chatSessionRepository";
import { createChatRouter } from "./routes/chatRoutes";
import { HttpMatrixService, MatrixService } from "./services/matrixService";

interface AppDeps {
  matrixService?: MatrixService;
  sessionRepository?: ChatSessionRepository;
  userRepository?: AppUserRepository;
}

export const createApp = (deps: AppDeps = {}): Express => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(
    "/api",
    createChatRouter({
      matrixService: deps.matrixService ?? new HttpMatrixService(),
      sessionRepository: deps.sessionRepository ?? new MongoChatSessionRepository(),
      userRepository: deps.userRepository ?? new MongoAppUserRepository(),
      defaultHomeserverUrl: env.MATRIX_HOMESERVER_URL
    })
  );

  return app;
};
