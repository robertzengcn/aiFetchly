// test/vitest/main/MCPToolServiceTimeout.test.ts
//
// Tests for Tasks 3.3 and 3.4 of the AI Tool Cancellation & Timeout Hardening plan.
//
// Strategy:
//   - Mock @/config/mcpConfig with controllable constants via vi.hoisted.
//   - Mock @/modules/MCPClient so we never spawn a real child process.
//   - Mock @/modules/MCPToolModule so we avoid DB access entirely.

/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted state: allows tests to override config values per-test ---
const { configMock, mcpClientMock } = vi.hoisted(() => {
  const configMock = {
    MCP_CALL_TIMEOUT_MS: 240_000,
    MCP_CONNECT_TIMEOUT_MS: 10_000,
    MCP_HTTP_REQUEST_TIMEOUT_MS: 60_000,
  };
  // The MCPClient mock implementation. Tests can swap the impl by
  // reassigning properties on this object.
  const mcpClientMock: {
    connectImpl: () => Promise<void>;
    callToolImpl: (
      name: string,
      params: Record<string, unknown>
    ) => Promise<Record<string, unknown>>;
    disconnectImpl: () => Promise<void>;
  } = {
    connectImpl: async () => undefined,
    callToolImpl: async () => ({}),
    disconnectImpl: async () => undefined,
  };
  return { configMock, mcpClientMock };
});

// --- Module mocks (hoisted) ---

vi.mock("@/config/mcpConfig", () => configMock);

vi.mock("@/modules/MCPClient", () => ({
  MCPClient: class {
    constructor(public cfg: unknown) {}
    async connect(): Promise<void> {
      await mcpClientMock.connectImpl();
    }
    async callTool(
      name: string,
      params: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      return mcpClientMock.callToolImpl(name, params);
    }
    async disconnect(): Promise<void> {
      await mcpClientMock.disconnectImpl();
    }
  },
}));

// Mock MCPToolModule to avoid DB; service constructor calls `new MCPToolModule()`.
vi.mock("@/modules/MCPToolModule", () => ({
  MCPToolModule: class {
    async getMCPToolById(): Promise<unknown> {
      return null;
    }
  },
}));

import { MCPToolService } from "@/service/MCPToolService";
import { MCPTimeoutError } from "@/service/MCPTimeoutError";

// ---------------------------------------------------------------------------
// Task 3.3: executeMCPTool race timeout
// ---------------------------------------------------------------------------

describe("MCPToolService.executeMCPTool timeout", () => {
  let originalCallTimeout: number;

  beforeEach(() => {
    vi.useFakeTimers();
    originalCallTimeout = configMock.MCP_CALL_TIMEOUT_MS;
    // Reset client mocks to no-op
    mcpClientMock.connectImpl = async () => undefined;
    mcpClientMock.callToolImpl = async () => ({});
    mcpClientMock.disconnectImpl = async () => undefined;
  });

  afterEach(() => {
    configMock.MCP_CALL_TIMEOUT_MS = originalCallTimeout;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("throws MCPTimeoutError when callTool exceeds MCP_CALL_TIMEOUT_MS", async () => {
    // Shrink the timeout so the test runs fast.
    configMock.MCP_CALL_TIMEOUT_MS = 100;

    // callTool never resolves → the race timeout should fire.
    mcpClientMock.callToolImpl = () =>
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      new Promise<Record<string, unknown>>(() => undefined);

    const svc = new MCPToolService();

    // Stub the module-layer server lookup to avoid DB.
    (
      svc as unknown as { mcpToolModule: { getMCPToolById: unknown } }
    ).mcpToolModule = {
      getMCPToolById: async () => ({
        id: 1,
        serverName: "acme",
        enabled: true,
        toolConfig: "",
        transport: "sse" as const,
        authType: "none" as const,
        timeout: 30000,
      }),
    };

    const p = (
      svc as unknown as {
        executeMCPTool: (
          id: number,
          name: string,
          params: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
      }
    ).executeMCPTool(1, "fetch", {});

    // Attach a catch handler to prevent unhandled-rejection noise when
    // the fake timer fires before the assertion below runs.
    const assertion = p.catch((e: unknown) => e);

    // Advance past the 100ms timeout.
    await vi.advanceTimersByTimeAsync(150);

    const error = await assertion;
    expect(error).toBeInstanceOf(MCPTimeoutError);
  });

  it("disconnect always runs even on timeout (finally block)", async () => {
    configMock.MCP_CALL_TIMEOUT_MS = 50;

    mcpClientMock.callToolImpl = () =>
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      new Promise<Record<string, unknown>>(() => undefined);

    const disconnectSpy = vi.fn();
    mcpClientMock.disconnectImpl = disconnectSpy;

    const svc = new MCPToolService();
    (
      svc as unknown as { mcpToolModule: { getMCPToolById: unknown } }
    ).mcpToolModule = {
      getMCPToolById: async () => ({
        id: 2,
        serverName: "svc",
        enabled: true,
        toolConfig: "",
        transport: "sse" as const,
        authType: "none" as const,
        timeout: 30000,
      }),
    };

    const p = (
      svc as unknown as {
        executeMCPTool: (
          id: number,
          name: string,
          params: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
      }
    ).executeMCPTool(2, "fetch", {});

    // Attach a catch handler to prevent unhandled-rejection noise.
    const assertion = p.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(80);
    const error = await assertion;
    expect(error).toBeInstanceOf(MCPTimeoutError);

    // disconnect must have been called in the finally block.
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("returns result normally when callTool completes within timeout", async () => {
    configMock.MCP_CALL_TIMEOUT_MS = 10_000;

    mcpClientMock.callToolImpl = async () => ({ answer: 42 });

    const svc = new MCPToolService();
    (
      svc as unknown as { mcpToolModule: { getMCPToolById: unknown } }
    ).mcpToolModule = {
      getMCPToolById: async () => ({
        id: 3,
        serverName: "ok-server",
        enabled: true,
        toolConfig: "",
        transport: "sse" as const,
        authType: "none" as const,
        timeout: 30000,
      }),
    };

    const result = await (
      svc as unknown as {
        executeMCPTool: (
          id: number,
          name: string,
          params: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
      }
    ).executeMCPTool(3, "ping", {});

    expect(result).toEqual({ answer: 42 });
  });

  it("propagates MCPTimeoutError unchanged (not wrapped)", async () => {
    configMock.MCP_CALL_TIMEOUT_MS = 30;

    mcpClientMock.callToolImpl = () =>
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      new Promise<Record<string, unknown>>(() => undefined);

    const svc = new MCPToolService();
    (
      svc as unknown as { mcpToolModule: { getMCPToolById: unknown } }
    ).mcpToolModule = {
      getMCPToolById: async () => ({
        id: 4,
        serverName: "timeout-srv",
        enabled: true,
        toolConfig: "",
        transport: "sse" as const,
        authType: "none" as const,
        timeout: 30000,
      }),
    };

    const p = (
      svc as unknown as {
        executeMCPTool: (
          id: number,
          name: string,
          params: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
      }
    ).executeMCPTool(4, "slow", {});

    // Attach a catch handler to prevent unhandled-rejection noise.
    const assertion = p.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(50);

    const error = await assertion;
    // Must be the exact class, not a wrapped Error.
    expect(error).toBeInstanceOf(MCPTimeoutError);
    if (error instanceof MCPTimeoutError) {
      expect(error.toolName).toBe("slow");
      expect(error.serverName).toBe("timeout-srv");
      expect(error.timeoutMs).toBe(30);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 3.4: MCPClient.connect race timeout
// ---------------------------------------------------------------------------
// NOTE: The real MCPClient.connect() race is tested in a separate file
// (MCPClientConnectTimeout.test.ts) because this file mocks MCPClient.
// The connect timeout test here would only verify the mock, not the real
// implementation.
