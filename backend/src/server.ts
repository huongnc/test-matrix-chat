import { createApp } from "./app";
import { env } from "./config/env";
import { connectMongo } from "./db/mongo";

const start = async (): Promise<void> => {
  await connectMongo(env.MONGODB_URI);
  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });
};

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
