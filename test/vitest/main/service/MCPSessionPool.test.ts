// test/vitest/main/service/MCPSessionPool.test.ts
//
// Persistent MCP session pool (design §4.2): reuse by exact key, invalidation
// on trust-generation/config change, idle timeout, pinning for Computer Use
// supervisors, and server-wide invalidation. Uses a fake client factory so no
// real process is spawned here (transport behavior is covered by the
// SupervisedStdioTransport suite).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPSessionPool, type McpSessionKey } from "@/service/MCPSessionPool";
import type { MCPClient, MCPClientConfig } from "@/modules/MCPClient";

class FakeMCPClient {
  readonly config: MCPClientConfig;
  connected = false;
  disconnectCalls = 0;
  connectImpl: () => Promise<void> = async () => {
    this.connected = true;
  };

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    await this.connectImpl();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.disconnectCalls++;
  }
}

function factory() {
  const created: FakeMCPClient[] = [];
  return {
    created,
    factory: (config: MCPClientConfig) => {
      const client = new FakeMCPClient(config);
      created.push(client);
      return client as unknown as MCPClient;
    },
  };
}

function key(serverId: string, trustGeneration = 1, command = "node"): McpSessionKey {
  return {
    serverId,
    trustGeneration,
    launchConfig: { transport: "stdio", command, args: [] },
  };
}

describe("MCPSessionPool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses a live session for the same key", async () => {
    const f = factory();
    const pool = new MCPSessionPool({ clientFactory: f.factory });
    const first = await pool.acquire(key("s1"));
    first.release();
    const second = await pool.acquire(key("s1"));
    second.release();
    expect(f.created).toHaveLength(1);
    expect(pool.size).toBe(1);
    await pool.dispose();
  });

  it("never reuses a session whose launch config or trust generation changed", async () => {
    const f = factory();
    const pool = new MCPSessionPool({ clientFactory: f.factory });
    const a = await pool.acquire(key("s1", 1, "node"));
    a.release();
    const b = await pool.acquire(key("s1", 2, "node"));
    b.release();
    const c = await pool.acquire(key("s1", 1, "node2"));
    c.release();
    expect(f.created).toHaveLength(3);
    expect(f.created[1].disconnectCalls).toBe(0); // still pooled until idle
    await pool.dispose();
  });

  it("closes an idle session after the idle timeout", async () => {
    const f = factory();
    const pool = new MCPSessionPool({
      clientFactory: f.factory,
      idleTimeoutMs: 1_000,
    });
    const session = await pool.acquire(key("s1"));
    session.release();
    expect(f.created[0].disconnectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(f.created[0].disconnectCalls).toBe(1);
    expect(pool.size).toBe(0);
    await pool.dispose();
  });

  it("a pinned session never idle-closes until released", async () => {
    const f = factory();
    const pool = new MCPSessionPool({
      clientFactory: f.factory,
      idleTimeoutMs: 1_000,
    });
    const pinned = await pool.pinSession(key("s1"));
    pinned.release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.created[0].disconnectCalls).toBe(0);
    expect(pool.size).toBe(1);

    pool.releasePinned(key("s1"));
    await vi.advanceTimersByTimeAsync(1_100);
    expect(f.created[0].disconnectCalls).toBe(1);
    await pool.dispose();
  });

  it("pinSession rejects double-pinning the same key", async () => {
    const f = factory();
    const pool = new MCPSessionPool({ clientFactory: f.factory });
    const first = await pool.pinSession(key("s1"));
    first.release();
    await expect(pool.pinSession(key("s1"))).rejects.toThrow(/already pinned/);
    pool.releasePinned(key("s1"));
    await pool.dispose();
  });

  it("invalidateServer closes every config for that server", async () => {
    const f = factory();
    const pool = new MCPSessionPool({ clientFactory: f.factory });
    const a = await pool.acquire(key("s1", 1, "node"));
    a.release();
    const b = await pool.acquire(key("s1", 1, "node2"));
    b.release();
    const c = await pool.acquire(key("s2", 1, "node"));
    c.release();
    await pool.invalidateServer("s1");
    expect(pool.size).toBe(1);
    expect(f.created[0].disconnectCalls).toBe(1);
    expect(f.created[1].disconnectCalls).toBe(1);
    expect(f.created[2].disconnectCalls).toBe(0);
    await pool.dispose();
  });

  it("dispose closes everything and refuses further acquires", async () => {
    const f = factory();
    const pool = new MCPSessionPool({ clientFactory: f.factory });
    const a = await pool.acquire(key("s1"));
    a.release();
    await pool.dispose();
    expect(f.created[0].disconnectCalls).toBe(1);
    await expect(pool.acquire(key("s1"))).rejects.toThrow(/disposed/i);
  });

  it("buildKey hashes launch config deterministically", () => {
    const k1 = MCPSessionPool.buildKey(key("s1"));
    const k2 = MCPSessionPool.buildKey(key("s1"));
    const k3 = MCPSessionPool.buildKey(key("s1", 1, "other"));
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1.split("|")[0]).toBe("s1");
  });
});

describe("audit A18 regressions", () => {
  it("concurrent identical acquires share ONE connect", async () => {
    const f = factory();
    let connecting = 0;
    let maxConcurrent = 0;
    f.created.forEach(() => undefined);
    const slowFactory = (config: MCPClientConfig) => {
      const client = f.factory(config);
      const orig = (client as unknown as { connectImpl: () => Promise<void> }).connectImpl;
      (client as unknown as { connectImpl: () => Promise<void> }).connectImpl = async () => {
        connecting += 1;
        maxConcurrent = Math.max(maxConcurrent, connecting);
        await new Promise((resolve) => setTimeout(resolve, 20));
        connecting -= 1;
        return orig();
      };
      return client;
    };
    const pool = new MCPSessionPool({ clientFactory: slowFactory });
    const [a, b, c] = await Promise.all([
      pool.acquire(key("s1")),
      pool.acquire(key("s1")),
      pool.acquire(key("s1")),
    ]);
    expect(f.created).toHaveLength(1);
    expect(maxConcurrent).toBe(1);
    a.release();
    b.release();
    c.release();
    await pool.dispose();
  });

  it("an active borrower prevents idle close; close arms only at zero", async () => {
    vi.useFakeTimers();
    try {
      const f = factory();
      const pool = new MCPSessionPool({
        clientFactory: f.factory,
        idleTimeoutMs: 1_000,
      });
      const held = await pool.acquire(key("s1"));
      // Still borrowed: the idle timer must NOT close it.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(pool.size).toBe(1);
      expect(f.created[0].disconnectCalls).toBe(0);
      held.release();
      await vi.advanceTimersByTimeAsync(1_100);
      expect(f.created[0].disconnectCalls).toBe(1);
      expect(pool.size).toBe(0);
      await pool.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose during connect evicts the late session", async () => {
    const f = factory();
    const gate = { release: null as (() => void) | null };
    const slowFactory = (config: MCPClientConfig) => {
      const client = f.factory(config);
      (client as unknown as { connectImpl: () => Promise<void> }).connectImpl =
        async () => {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
          // connect() returns once the gate opens; no private field writes.
        };
      return client;
    };
    const pool = new MCPSessionPool({ clientFactory: slowFactory });
    const acquirePromise = pool.acquire(key("s1"));
    await vi.waitFor(() => expect(gate.release).not.toBeNull());
    await pool.dispose();
    gate.release?.();
    await expect(acquirePromise).rejects.toThrow(/disposed/);
    expect(pool.size).toBe(0);
  });
});
