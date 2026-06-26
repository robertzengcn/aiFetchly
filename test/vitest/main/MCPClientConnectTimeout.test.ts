// test/vitest/main/MCPClientConnectTimeout.test.ts
//
// Tests Task 3.4: MCPClient.connect() race timeout.
//
// This file does NOT mock MCPClient — it tests the real connect() method's
// race timeout behavior. We use a transport that stalls (SSE throws
// immediately, but we can use a custom approach):
//   - Test 1: use SSE transport (which throws "not yet implemented"). This
//     tests that a fast-rejecting doConnect() does NOT trigger the timeout.
//   - Test 2: stall doConnect() by stubbing it to return a never-resolving
//     promise, then verify the race timeout fires.

/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Override the config constants for fast tests.
const { configMock } = vi.hoisted(() => ({
  configMock: {
    MCP_CALL_TIMEOUT_MS: 240_000,
    MCP_CONNECT_TIMEOUT_MS: 10_000,
    MCP_HTTP_REQUEST_TIMEOUT_MS: 60_000,
  },
}));

vi.mock("@/config/mcpConfig", () => configMock);

import { MCPClient } from "@/modules/MCPClient";

describe("MCPClient.connect race timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("rejects with 'MCP connection timeout' when doConnect stalls", async () => {
    configMock.MCP_CONNECT_TIMEOUT_MS = 50;

    const client = new MCPClient({
      transport: "stdio",
      authType: "none",
      timeout: 50,
      command: "true",
      args: [],
    });

    // Stub doConnect to stall forever (simulates a dead server).
    // We access the private method via cast.
    (client as unknown as { doConnect: () => Promise<void> }).doConnect = () =>
      new Promise<void>(() => undefined);

    const p = client.connect();
    // Attach a catch handler early to prevent unhandled-rejection noise.
    const assertion = p.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(80);
    const error = await assertion;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/MCP connection timeout/);
  });

  it("clears the timer when connect resolves within timeout", async () => {
    configMock.MCP_CONNECT_TIMEOUT_MS = 5_000;

    const client = new MCPClient({
      transport: "stdio",
      authType: "none",
      timeout: 5000,
      command: "true",
      args: [],
    });

    // Stub doConnect to resolve immediately.
    (client as unknown as { doConnect: () => Promise<void> }).doConnect =
      async () => undefined;

    await expect(client.connect()).resolves.toBeUndefined();

    // Advance past the timeout to ensure no stray rejection fires.
    await vi.advanceTimersByTimeAsync(6_000);
  });

  it("re-throws original error when doConnect rejects fast (not timeout)", async () => {
    configMock.MCP_CONNECT_TIMEOUT_MS = 5_000;

    const client = new MCPClient({
      transport: "stdio",
      authType: "none",
      timeout: 5000,
      command: "true",
      args: [],
    });

    const originalError = new Error("spawn failed");
    (client as unknown as { doConnect: () => Promise<void> }).doConnect =
      async () => {
        throw originalError;
      };

    await expect(client.connect()).rejects.toThrow(/spawn failed/);

    // Advance past the timeout to ensure no stray rejection fires.
    await vi.advanceTimersByTimeAsync(6_000);
  });

  it("skips when already connected (no-op)", async () => {
    configMock.MCP_CONNECT_TIMEOUT_MS = 5_000;

    const client = new MCPClient({
      transport: "stdio",
      authType: "none",
      timeout: 5000,
      command: "true",
      args: [],
    });

    // Mark as connected to test the early return.
    (client as unknown as { connected: boolean }).connected = true;

    await expect(client.connect()).resolves.toBeUndefined();
  });
});
