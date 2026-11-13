import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENNAME } from "@/config/usersetting";

const tokenStore = new Map<string, string>();

vi.mock("@/modules/token", () => ({
  Token: class MockToken {
    public getValue(key: string): string {
      return tokenStore.get(key) ?? "";
    }
  },
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/service/AuthSessionExpiryGuard", () => ({
  triggerSignoutOnAuthShapedFailure: vi.fn(),
}));

import { HttpClient } from "@/modules/lib/httpclient";

interface CapturedFetchCall {
  url: string;
  headers: Record<string, string>;
}

function installOkFetchSpy(): {
  calls: CapturedFetchCall[];
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const calls: CapturedFetchCall[] = [];
  const fetchMock = vi.fn(
    async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, headers: { ...rawHeaders } });
      return new Response(
        JSON.stringify({ status: true, code: 0, msg: "ok", data: {} }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("HttpClient same-tick token initialization", () => {
  const originalWorkerType = process.env.WORKER_TYPE;
  const originalWorkerToken = process.env.WORKER_AUTH_TOKEN;

  beforeEach(() => {
    tokenStore.clear();
    tokenStore.set(TOKENNAME, "stored-access-jwt");
    delete process.env.WORKER_TYPE;
    delete process.env.WORKER_AUTH_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWorkerType === undefined) {
      delete process.env.WORKER_TYPE;
    } else {
      process.env.WORKER_TYPE = originalWorkerType;
    }
    if (originalWorkerToken === undefined) {
      delete process.env.WORKER_AUTH_TOKEN;
    } else {
      process.env.WORKER_AUTH_TOKEN = originalWorkerToken;
    }
  });

  it("attaches Authorization header on same-tick get('/api/user/info') after construction", async () => {
    const { calls } = installOkFetchSpy();
    const client = new HttpClient();

    await client.get("/api/user/info");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/apis/api/user/info");
    expect(calls[0].headers.Authorization).toBe("Bearer stored-access-jwt");
  });

  it("attaches Authorization header on same-tick get('/api/user/signout') after construction", async () => {
    const { calls } = installOkFetchSpy();
    const client = new HttpClient();

    await client.get("/api/user/signout");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/apis/api/user/signout");
    expect(calls[0].headers.Authorization).toBe("Bearer stored-access-jwt");
  });

  it("attaches Authorization header on same-tick postStream() after construction", async () => {
    const { calls } = installOkFetchSpy();
    const client = new HttpClient();

    await client.postStream("/api/ai/chat", { prompt: "hello" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/apis/api/ai/chat");
    expect(calls[0].headers.Authorization).toBe("Bearer stored-access-jwt");
    expect(calls[0].headers.Accept).toBe("text/event-stream");
  });

  it("does not overwrite synchronous setBearerAuth() when constructor token init settles", async () => {
    const { calls } = installOkFetchSpy();
    const client = new HttpClient();
    client.setBearerAuth("explicit-bearer-token");

    await client.get("/api/user/info");

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe("Bearer explicit-bearer-token");
  });

  it("does not overwrite synchronous setBasicAuth() when constructor token init settles", async () => {
    const { calls } = installOkFetchSpy();
    const client = new HttpClient();
    client.setBasicAuth("user", "pass");

    await client.get("/api/user/info");

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${btoa("user:pass")}`
    );
  });

  it("does not add duplicate Authorization header after synchronous lowercase setHeader('authorization', ...)", async () => {
    const { calls } = installOkFetchSpy();
    const client = new HttpClient();
    client.setHeader("authorization", "Custom custom-token");

    await client.get("/api/user/info");

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe("Custom custom-token");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("uses WORKER_AUTH_TOKEN without waiting on Token dynamic import when WORKER_TYPE is set", async () => {
    process.env.WORKER_TYPE = "scraper";
    process.env.WORKER_AUTH_TOKEN = "worker-jwt-123";
    const { calls } = installOkFetchSpy();
    const client = new HttpClient();

    await client.get("/api/user/info");
    await client.postStream("/api/ai/chat", { prompt: "worker" });

    expect(calls).toHaveLength(2);
    expect(calls[0].headers.Authorization).toBe("Bearer worker-jwt-123");
    expect(calls[1].headers.Authorization).toBe("Bearer worker-jwt-123");
  });
});
