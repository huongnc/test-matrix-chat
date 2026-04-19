import { HttpMatrixService } from "../services/matrixService";

describe("HttpMatrixService.login", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("tries r0 first and falls back to v3", async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ flows: [{ type: "m.login.password" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.includes("/_matrix/client/r0/login")) {
        return new Response(JSON.stringify({ error: "Invalid login type" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(
        JSON.stringify({
          access_token: "token-1",
          user_id: "@alice:chat.yourapp.com",
          device_id: "device-a"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new HttpMatrixService();

    const result = await service.login({
      homeserverUrl: "http://localhost:8008",
      username: "alice",
      password: "pass123"
    });

    expect(result.userId).toBe("@alice:chat.yourapp.com");
    expect(result.accessToken).toBe("token-1");
  });

  it("returns clear error message after all login strategies fail", async () => {
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ flows: [{ type: "m.login.password" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new HttpMatrixService();

    await expect(
      service.login({
        homeserverUrl: "http://localhost:8008",
        username: "@alice:chat.yourapp.com",
        password: "wrong"
      })
    ).rejects.toThrow(/Login failed: .*Forbidden/);
  });
});