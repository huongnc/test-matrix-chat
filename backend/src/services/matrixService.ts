import { createHmac, randomUUID } from "crypto";

import {
  CreateRoomInput,
  DirectRoomInput,
  InviteToRoomInput,
  JoinRoomInput,
  LoginInput,
  MatrixMessage,
  MatrixRoom,
  MatrixSession,
  RegisterInput
} from "../types/chat";

interface MatrixLoginResponse {
  access_token: string;
  user_id: string;
  device_id?: string;
}

interface MatrixLoginFlowsResponse {
  flows?: Array<{ type?: string }>;
}

interface MatrixJoinedRoomsResponse {
  joined_rooms: string[];
}

interface MatrixMessagesResponse {
  chunk?: Array<{
    event_id?: string;
    sender?: string;
    origin_server_ts?: number;
    type?: string;
    content?: {
      body?: string;
      msgtype?: string;
    };
  }>;
}

interface MatrixCreateRoomResponse {
  room_id: string;
}

interface SynapseRegisterNonceResponse {
  nonce: string;
}

type MatrixDirectMap = Record<string, string[]>;

export interface MatrixService {
  register(input: RegisterInput, sharedSecret: string): Promise<void>;
  login(input: LoginInput): Promise<Omit<MatrixSession, "sessionId">>;
  listJoinedRooms(session: MatrixSession): Promise<MatrixRoom[]>;
  findOrCreateDirectRoom(
    session: MatrixSession,
    input: DirectRoomInput
  ): Promise<{ room: MatrixRoom; created: boolean }>;
  createRoom(session: MatrixSession, input: CreateRoomInput): Promise<MatrixRoom>;
  inviteToRoom(session: MatrixSession, input: InviteToRoomInput): Promise<void>;
  joinRoom(session: MatrixSession, input: JoinRoomInput): Promise<MatrixRoom>;
  getRoomMessages(
    session: MatrixSession,
    roomId: string,
    limit: number
  ): Promise<MatrixMessage[]>;
  sendMessage(session: MatrixSession, roomId: string, body: string): Promise<void>;
}

const normalizeBaseUrl = (homeserverUrl: string): string =>
  homeserverUrl.endsWith("/") ? homeserverUrl.slice(0, -1) : homeserverUrl;

const requestMatrix = async (url: string, init?: RequestInit): Promise<Response> => {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(`Cannot reach Matrix homeserver at ${url}`);
  }
};

const toErrorMessage = async (response: Response): Promise<string> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string; errcode?: string };
    return payload.error ?? payload.errcode ?? "Matrix request failed";
  }

  return (await response.text()) || "Matrix request failed";
};

export class HttpMatrixService implements MatrixService {
  async register(input: RegisterInput, sharedSecret: string): Promise<void> {
    const baseUrl = normalizeBaseUrl(input.homeserverUrl);
    const registerPath = `${baseUrl}/_synapse/admin/v1/register`;

    const nonceResponse = await requestMatrix(registerPath, { method: "GET" });
    if (!nonceResponse.ok) {
      throw new Error(await toErrorMessage(nonceResponse));
    }

    const noncePayload = (await nonceResponse.json()) as SynapseRegisterNonceResponse;
    const username = input.username.trim().replace(/^@/, "").split(":")[0] ?? "";
    const mac = createHmac("sha1", sharedSecret)
      .update(noncePayload.nonce)
      .update("\x00")
      .update(username)
      .update("\x00")
      .update(input.password)
      .update("\x00")
      .update("notadmin")
      .digest("hex");

    const registerResponse = await requestMatrix(registerPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nonce: noncePayload.nonce,
        username,
        password: input.password,
        admin: false,
        displayname: input.displayName,
        mac
      })
    });

    if (!registerResponse.ok) {
      throw new Error(await toErrorMessage(registerResponse));
    }
  }

  async login(input: LoginInput): Promise<Omit<MatrixSession, "sessionId">> {
    const baseUrl = normalizeBaseUrl(input.homeserverUrl);
    const loginEndpoints = [
      `${baseUrl}/_matrix/client/r0/login`,
      `${baseUrl}/_matrix/client/v3/login`
    ];

    const rawUsername = input.username.trim();
    const maybeLocalpart = rawUsername.startsWith("@")
      ? (rawUsername.split(":")[0] ?? "").slice(1)
      : rawUsername;

    const payloads = [
      {
        type: "m.login.password",
        identifier: {
          type: "m.id.user",
          user: rawUsername
        },
        password: input.password,
        initial_device_display_name: "matrix-chat-app"
      },
      {
        type: "m.login.password",
        identifier: {
          type: "m.id.user",
          user: maybeLocalpart
        },
        password: input.password,
        initial_device_display_name: "matrix-chat-app"
      },
      {
        type: "m.login.password",
        user: rawUsername,
        password: input.password
      },
      {
        type: "m.login.password",
        user: maybeLocalpart,
        password: input.password
      }
    ];

    const errorMessages: string[] = [];
    let payload: MatrixLoginResponse | null = null;
    let availableFlowsText = "";

    for (const loginPath of loginEndpoints) {
      try {
        const flowResponse = await requestMatrix(loginPath, { method: "GET" });
        if (flowResponse.ok) {
          const flowPayload = (await flowResponse.json()) as MatrixLoginFlowsResponse;
          const flowTypes = (flowPayload.flows ?? [])
            .map((flow) => flow.type)
            .filter((value): value is string => Boolean(value));

          if (flowTypes.length > 0) {
            availableFlowsText = ` Available login flows: ${flowTypes.join(", ")}.`;
          }
        }
      } catch {
        // Ignore flow check failures.
      }

      for (const body of payloads) {
        const response = await requestMatrix(loginPath, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          payload = (await response.json()) as MatrixLoginResponse;
          break;
        }

        const message = await toErrorMessage(response);
        errorMessages.push(`${loginPath}: ${message}`);
      }

      if (payload) {
        break;
      }
    }

    if (!payload) {
      const uniqueErrors = Array.from(new Set(errorMessages)).join(" | ");
      throw new Error(`Login failed: ${uniqueErrors}.${availableFlowsText}`);
    }

    return {
      homeserverUrl: baseUrl,
      userId: payload.user_id,
      accessToken: payload.access_token,
      deviceId: payload.device_id ?? input.deviceId ?? "unknown-device"
    };
  }

  async listJoinedRooms(session: MatrixSession): Promise<MatrixRoom[]> {
    const response = await requestMatrix(
      `${session.homeserverUrl}/_matrix/client/r0/joined_rooms`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(await toErrorMessage(response));
    }

    const payload = (await response.json()) as MatrixJoinedRoomsResponse;
    return payload.joined_rooms.map((roomId) => ({
      roomId,
      name: roomId
    }));
  }

  async findOrCreateDirectRoom(
    session: MatrixSession,
    input: DirectRoomInput
  ): Promise<{ room: MatrixRoom; created: boolean }> {
    const directDataUrl = `${session.homeserverUrl}/_matrix/client/r0/user/${encodeURIComponent(session.userId)}/account_data/m.direct`;
    let directMap: MatrixDirectMap = {};

    const directDataResponse = await requestMatrix(directDataUrl, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`
      }
    });

    if (directDataResponse.ok) {
      directMap = (await directDataResponse.json()) as MatrixDirectMap;
      const existingRoomId = (directMap[input.userId] ?? [])[0];
      if (existingRoomId) {
        return {
          room: {
            roomId: existingRoomId,
            name: input.displayName ? `DM: ${input.displayName}` : existingRoomId
          },
          created: false
        };
      }
    } else if (directDataResponse.status !== 404) {
      throw new Error(await toErrorMessage(directDataResponse));
    }

    const roomName = input.displayName ? `DM: ${input.displayName}` : `DM: ${input.userId}`;
    const createResponse = await requestMatrix(
      `${session.homeserverUrl}/_matrix/client/r0/createRoom`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: roomName,
          preset: "trusted_private_chat",
          is_direct: true,
          invite: [input.userId]
        })
      }
    );

    if (!createResponse.ok) {
      throw new Error(await toErrorMessage(createResponse));
    }

    const createdPayload = (await createResponse.json()) as MatrixCreateRoomResponse;
    const nextDirectMap: MatrixDirectMap = {
      ...directMap,
      [input.userId]: Array.from(
        new Set([...(directMap[input.userId] ?? []), createdPayload.room_id])
      )
    };

    const updateDirectResponse = await requestMatrix(directDataUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(nextDirectMap)
    });

    if (!updateDirectResponse.ok) {
      throw new Error(await toErrorMessage(updateDirectResponse));
    }

    return {
      room: {
        roomId: createdPayload.room_id,
        name: roomName
      },
      created: true
    };
  }

  async getRoomMessages(
    session: MatrixSession,
    roomId: string,
    limit: number
  ): Promise<MatrixMessage[]> {
    const response = await requestMatrix(
      `${session.homeserverUrl}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(await toErrorMessage(response));
    }

    const payload = (await response.json()) as MatrixMessagesResponse;
    return (payload.chunk ?? [])
      .filter((event) => event.type === "m.room.message" && event.content?.body)
      .map((event) => ({
        eventId: event.event_id ?? randomUUID(),
        sender: event.sender ?? "unknown",
        body: event.content?.body ?? "",
        msgtype: event.content?.msgtype ?? "m.text",
        originServerTs: event.origin_server_ts ?? Date.now()
      }))
      .reverse();
  }

  async createRoom(session: MatrixSession, input: CreateRoomInput): Promise<MatrixRoom> {
    const response = await requestMatrix(
      `${session.homeserverUrl}/_matrix/client/r0/createRoom`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: input.name,
          preset: input.isPublic ? "public_chat" : "private_chat",
          visibility: input.isPublic ? "public" : "private"
        })
      }
    );

    if (!response.ok) {
      throw new Error(await toErrorMessage(response));
    }

    const payload = (await response.json()) as MatrixCreateRoomResponse;
    return {
      roomId: payload.room_id,
      name: input.name
    };
  }

  async sendMessage(session: MatrixSession, roomId: string, body: string): Promise<void> {
    const txnId = randomUUID();
    const response = await requestMatrix(
      `${session.homeserverUrl}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          msgtype: "m.text",
          body
        })
      }
    );

    if (!response.ok) {
      throw new Error(await toErrorMessage(response));
    }
  }

  async inviteToRoom(session: MatrixSession, input: InviteToRoomInput): Promise<void> {
    const response = await requestMatrix(
      `${session.homeserverUrl}/_matrix/client/r0/rooms/${encodeURIComponent(input.roomId)}/invite`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_id: input.userId
        })
      }
    );

    if (!response.ok) {
      throw new Error(await toErrorMessage(response));
    }
  }

  async joinRoom(session: MatrixSession, input: JoinRoomInput): Promise<MatrixRoom> {
    const response = await requestMatrix(
      `${session.homeserverUrl}/_matrix/client/r0/join/${encodeURIComponent(input.roomIdOrAlias)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );

    if (!response.ok) {
      throw new Error(await toErrorMessage(response));
    }

    const payload = (await response.json()) as MatrixCreateRoomResponse;
    return {
      roomId: payload.room_id,
      name: payload.room_id
    };
  }
}
