// test/vitest/main/modules/mcp/MCPClientConnectTimeoutCleanup.test.ts
//
// Regression: a connect() TIMEOUT during the SDK stdio handshake must close
// the in-flight SDK client (and through the transport kill the spawned
// server child). Before the fix, `this.sdk` was assigned only after the
// handshake completed, so the timeout cleanup skipped the close and the
// child process leaked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";

const { configMock } = vi.hoisted(() => ({
  configMock: {
    MCP_CALL_TIMEOUT_MS: 240_000,
    MCP_CONNECT_TIMEOUT_MS: 10_000,
    MCP_HTTP_REQUEST_TIMEOUT_MS: 60_000,
  },
}));

vi.mock("@/config/mcpConfig", () => configMock);

import { MCPClient } from "@/modules/MCPClient";
import { getOwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";

const FIXTURE = join(__dirname, "..", "..", "fixtures", "fakeMcpStdioServer.mjs");

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

describe("MCPClient.connect timeout cleanup (stdio)", () => {
  beforeEach(() => {
    configMock.MCP_CONNECT_TIMEOUT_MS = 400;
  });

  it("kills the spawned server child when the handshake times out", async () => {
    const before = new Set(
      getOwnedProcessRegistry()
        .list()
        .filter((r) => r.ownerId === "mcp-server")
        .map((r) => r.pid)
    );

    const client = new MCPClient({
      transport: "stdio",
      command: process.execPath,
      args: [FIXTURE, "--never-initialize"],
      timeout: 8_000,
    });

    await expect(client.connect()).rejects.toThrow(/timeout/i);

    // The cleanup closes the SDK client -> transport doClose (stdin end,
    // SIGTERM, SIGKILL). A NEW mcp-server pid appeared for this attempt;
    // it must be gone shortly after the timeout.
    const spawned = getOwnedProcessRegistry()
      .list()
      .filter((r) => r.ownerId === "mcp-server" && r.pid && !before.has(r.pid))
      .map((r) => r.pid as number);

    expect(spawned.length).toBeGreaterThan(0);
    const exited = await waitFor(
      () => spawned.every((pid) => !processExists(pid)),
      5_000
    );
    expect(exited).toBe(true);
  });
});

function processExists(pid: number): boolean {
  try {
    // Signal 0 probes existence without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
