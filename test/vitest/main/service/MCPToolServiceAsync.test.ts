// test/vitest/main/service/MCPToolServiceAsync.test.ts
//
// Managed-async execution tests (yellow-pages plugin plan TD-04/TD-07):
//   - the async path derives its budget from the deadline, NOT the fixed
//     240 s foreground race (HOST-07);
//   - an expired deadline rejects BEFORE spawning/connecting;
//   - SDK call options carry resetTimeoutOnProgress:false, the remaining
//     budget as both timeout and maxTotalTimeout, and the abort signal;
//   - progress notifications are mapped/bounded and forwarded to onProgress;
//   - disconnect always runs.

/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mcpClientMock } = vi.hoisted(() => {
  const mcpClientMock: {
    connectImpl: () => Promise<void>;
    callToolContentImpl: (
      name: string,
      params: Record<string, unknown>,
      options?: {
        timeoutMs?: number;
        maxTotalTimeoutMs?: number;
        signal?: AbortSignal;
        resetTimeoutOnProgress?: boolean;
        onprogress?: (n: {
          progress: number;
          total?: number;
          message?: string;
        }) => void;
      }
    ) => Promise<{
      content: readonly { type: "text"; text: string }[];
      structuredContent?: Record<string, unknown>;
      isError: boolean;
    }>;
    disconnectImpl: () => Promise<void>;
  } = {
    connectImpl: async () => undefined,
    callToolContentImpl: async () => ({ content: [], isError: false }),
    disconnectImpl: async () => undefined,
  };
  return { mcpClientMock };
});

vi.mock("@/modules/MCPClient", () => ({
  MCPClient: class {
    constructor(public cfg: unknown) {}
    async connect(): Promise<void> {
      await mcpClientMock.connectImpl();
    }
    async callToolContent(
      name: string,
      params: Record<string, unknown>,
      options?: Parameters<typeof mcpClientMock.callToolContentImpl>[2]
    ) {
      return mcpClientMock.callToolContentImpl(name, params, options);
    }
    async disconnect(): Promise<void> {
      await mcpClientMock.disconnectImpl();
    }
  },
}));

vi.mock("@/modules/MCPToolModule", () => ({
  MCPToolModule: class {
    async getMCPToolById(): Promise<unknown> {
      return null;
    }
  },
}));

import { MCPToolService } from "@/service/MCPToolService";
import { MCPTimeoutError } from "@/service/MCPTimeoutError";

function makeService(): MCPToolService {
  const svc = new MCPToolService();
  (
    svc as unknown as { mcpToolModule: { getMCPToolById: unknown } }
  ).mcpToolModule = {
    getMCPToolById: async () => ({
      id: 1,
      serverName: "scraper",
      enabled: true,
      toolConfig: "",
      transport: "sse" as const,
      authType: "none" as const,
      timeout: 30_000,
    }),
  };
  return svc;
}

describe("MCPToolService.executeMCPToolContent (managed async)", () => {
  beforeEach(() => {
    mcpClientMock.connectImpl = async () => undefined;
    mcpClientMock.callToolContentImpl = async () => ({
      content: [],
      isError: false,
    });
    mcpClientMock.disconnectImpl = async () => undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an expired deadline before connecting", async () => {
    const connectSpy = vi.fn();
    mcpClientMock.connectImpl = connectSpy;

    const svc = makeService();
    const promise = svc.executeMCPToolContent(1, "scrape", {}, {
      deadlineEpochMs: Date.now() - 1_000,
    });
    await expect(promise).rejects.toBeInstanceOf(MCPTimeoutError);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("rejects when only the cleanup reserve remains", async () => {
    const connectSpy = vi.fn();
    mcpClientMock.connectImpl = connectSpy;

    const svc = makeService();
    await expect(
      svc.executeMCPToolContent(1, "scrape", {}, {
        deadlineEpochMs: Date.now() + 1_000,
      })
    ).rejects.toBeInstanceOf(MCPTimeoutError);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("derives SDK timeouts from the remaining budget, not the 240s race", async () => {
    let observed: Parameters<typeof mcpClientMock.callToolContentImpl>[2];
    mcpClientMock.callToolContentImpl = async (_n, _p, options) => {
      observed = options;
      return {
        content: [{ type: "text", text: "{}" }],
        isError: false,
      };
    };

    const svc = makeService();
    const deadline = Date.now() + 10 * 60_000; // 10 minutes out
    const result = await svc.executeMCPToolContent(1, "scrape", {}, {
      deadlineEpochMs: deadline,
    });
    expect(result.isError).toBe(false);

    const budget = observed!.timeoutMs!;
    // Remaining budget — definitively NOT the 240 s foreground ceiling.
    expect(budget).toBeGreaterThan(9 * 60_000);
    expect(budget).toBeLessThanOrEqual(10 * 60_000);
    expect(observed!.maxTotalTimeoutMs).toBe(budget);
    expect(observed!.resetTimeoutOnProgress).toBe(false);
  });

  it("forwards the abort signal to the SDK call", async () => {
    let observedSignal: AbortSignal | undefined;
    mcpClientMock.callToolContentImpl = async (_n, _p, options) => {
      observedSignal = options?.signal;
      return { content: [], isError: false };
    };

    const controller = new AbortController();
    const svc = makeService();
    await svc.executeMCPToolContent(1, "scrape", {}, {
      deadlineEpochMs: Date.now() + 60_000,
      signal: controller.signal,
    });
    expect(observedSignal).toBe(controller.signal);
  });

  it("rejects immediately when the signal already fired", async () => {
    const connectSpy = vi.fn();
    mcpClientMock.connectImpl = connectSpy;
    const controller = new AbortController();
    controller.abort();

    const svc = makeService();
    await expect(
      svc.executeMCPToolContent(1, "scrape", {}, {
        deadlineEpochMs: Date.now() + 60_000,
        signal: controller.signal,
      })
    ).rejects.toThrow(/cancelled before execution/i);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("maps and bounds progress notifications to onProgress", async () => {
    let emit: ((n: { progress: number; total?: number; message?: string }) => void) | undefined;
    mcpClientMock.callToolContentImpl = async (_n, _p, options) => {
      emit = options?.onprogress;
      return { content: [], isError: false };
    };

    const events: Array<Record<string, unknown>> = [];
    const svc = makeService();
    await svc.executeMCPToolContent(1, "scrape", {}, {
      deadlineEpochMs: Date.now() + 60_000,
      onProgress: (p) => events.push({ ...p }),
    });

    emit!({ progress: 38, total: 100 });
    emit!({ progress: 41 }); // total unknown
    emit!({ progress: 5, message: "x".repeat(500) }); // bounded to 200 chars

    expect(events[0]).toMatchObject({
      phase: "extracting",
      partialCount: 38,
      expectedCount: 100,
      progress: 0.38,
    });
    expect(events[1]).toMatchObject({
      partialCount: 41,
      expectedCount: null,
      progress: null,
    });
    const longMessage = events[2]?.message;
    expect(typeof longMessage === "string" ? longMessage.length : 0).toBe(200);
  });

  it("always disconnects in the finally block", async () => {
    const disconnectSpy = vi.fn();
    mcpClientMock.disconnectImpl = disconnectSpy;
    mcpClientMock.callToolContentImpl = async () => {
      throw new Error("transport died");
    };

    const svc = makeService();
    await expect(
      svc.executeMCPToolContent(1, "scrape", {}, {
        deadlineEpochMs: Date.now() + 60_000,
      })
    ).rejects.toThrow(/transport died/);
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
