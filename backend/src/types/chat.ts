export interface MatrixSession {
  sessionId: string;
  homeserverUrl: string;
  userId: string;
  accessToken: string;
  deviceId: string;
}

export interface MatrixRoom {
  roomId: string;
  name: string;
}

export interface MatrixMessage {
  eventId: string;
  sender: string;
  body: string;
  msgtype: string;
  originServerTs: number;
}

export interface LoginInput {
  homeserverUrl: string;
  username: string;
  password: string;
  deviceId?: string;
}

export interface RegisterInput {
  homeserverUrl: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface CreateRoomInput {
  name: string;
  isPublic?: boolean;
}

export interface JoinRoomInput {
  roomIdOrAlias: string;
}

export interface InviteToRoomInput {
  roomId: string;
  userId: string;
}

export interface DirectRoomInput {
  userId: string;
  displayName?: string;
}
