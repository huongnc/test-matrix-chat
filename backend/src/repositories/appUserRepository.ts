import { AppUserModel } from "../models/AppUser";

export interface AppUserRecord {
  userId: string;
  username: string;
  homeserverUrl: string;
  createdAt: string;
}

export interface AppUserRepository {
  upsertUser(input: {
    userId: string;
    username: string;
    homeserverUrl: string;
  }): Promise<void>;
  listUsers(): Promise<AppUserRecord[]>;
}

export class MongoAppUserRepository implements AppUserRepository {
  async upsertUser(input: {
    userId: string;
    username: string;
    homeserverUrl: string;
  }): Promise<void> {
    await AppUserModel.findOneAndUpdate(
      { userId: input.userId },
      {
        $set: {
          username: input.username,
          homeserverUrl: input.homeserverUrl
        }
      },
      {
        upsert: true,
        returnDocument: "after"
      }
    );
  }

  async listUsers(): Promise<AppUserRecord[]> {
    const users = await AppUserModel.find().sort({ createdAt: -1 }).lean();

    return users.map((user) => ({
      userId: user.userId,
      username: user.username,
      homeserverUrl: user.homeserverUrl,
      createdAt: user.createdAt.toISOString()
    }));
  }
}
