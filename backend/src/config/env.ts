import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/matrix-chat"),
  MATRIX_HOMESERVER_URL: z.string().url().default("http://localhost:8008"),
  MATRIX_SHARED_SECRET: z.string().min(1).default("SUPER_SECRET_KEY")
});

export const env = EnvSchema.parse(process.env);
