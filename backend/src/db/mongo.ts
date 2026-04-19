import mongoose from "mongoose";

let isConnected = false;

export const connectMongo = async (uri: string): Promise<void> => {
  if (isConnected) {
    return;
  }

  await mongoose.connect(uri);
  isConnected = true;
};
