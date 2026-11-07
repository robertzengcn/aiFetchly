// test/vitest/main/service/MCPToolServiceDeadline.test.ts
//
// B07: ONE deadline across connect / tools/call / cleanup.
//   - a delayed handshake (connect) cannot extend the plan;
//   - the tools/call budget is recomputed AFTER connect and subtracts the
//     cleanup reserve;
//   - continuous progress notifications cannot extend the budget;
//   - an unresponsive shutdown cannot be reported as confirmed cleanup
//     (MCPTimeoutError gets cleanupPending).
//
// The cleanup reserve constant is shrunk for test speed via module mock;
// everything else re-exports the real module values.

vi.mock("@/entityTypes/pluginExecutionTypes", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/entityTypes/pluginExecutionTypes")
  >();
  return { ...actual, HOST_CLEANUP_RESERVE_MS: 40 };
});

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
    disconnectImpl: () => Promise<boolean>;
    instances: unknown[];
    observedOptions:
      | { timeoutMs?: number; maxTotalTimeoutMs?: number }
      | undefined;
  } = {
    connectImpl: async () => undefined,
    callToolContentImpl: async () => ({ content: [], isError: false }),
    disconnectImpl: async () => true,
    instances: [],
    observedOptions: undefined,
  };
  return { mcpClientMock };
});

vi.mock("@/modules/MCPClient", () => ({
  MCPClient: class {
    constructor(public cfg: unknown) {
      mcpClientMock.instances.push(cfg);
    }
    setPluginPartialSink(): void {
      /* not exercised here */
    }
    async connect(): Promise<void> {
      await mcpClientMock.connectImpl();
    }
    async callToolContent(
      name: string,
      params: Record<string, unknown>,
      options?: Parameters<typeof mcpClientMock.callToolContentImpl>[2]
    ) {
      mcpClientMock.observedOptions = options;
      return mcpClientMock.callToolContentImpl(name, params, options);
    }
    async disconnect(): Promise<boolean> {
      return await mcpClientMock.disconnectImpl();
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPToolService } from "@/service/MCPToolService";
import { MCPTimeoutError } from "@/service/MCPTimeoutError";

const CALL_OPTIONS = { executionId: "b07-dead" } as const;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MCPToolService B07 single deadline", () => {
  beforeEach(() => {
    mcpClientMock.connectImpl = async () => undefined;
    mcpClientMock.callToolContentImpl = async () => ({
      content: [],
      isError: false,
    });
    mcpClientMock.disconnectImpl = async () => true;
    mcpClientMock.instances.length = 0;
    mcpClientMock.observedOptions = undefined;
  });

  it("a delayed handshake cannot extend the budget (connect is raced)", async () => {
    const anchor = performance.now() + 150;
    mcpClientMock.connectImpl = () => sleep(1_000);
    const svc = makeService();
    await expect(
      svc.executeMCPToolContent(1, "scrape", {}, {
        ...CALL_OPTIONS,
        deadlinePerfMs: anchor,
      })
    ).rejects.toBeInstanceOf(MCPTimeoutError);

    // The call never started; the deadline error carries no cleanup claim.
    expect(mcpClientMock.observedOptions).toBeUndefined();
    const err = await svc
      .executeMCPToolContent(1, "scrape", {}, {
        ...CALL_OPTIONS,
        deadlinePerfMs: anchor,
        signal: undefined,
      })
      .catch((e: MCPTimeoutError) => e);
    expect((err as MCPTimeoutError).cleanupPending).toBeUndefined();
  });

  it("tools/call budget is recomputed after connect and subtracts the reserve", async () => {
    const anchor = performance.now() + 210;
    mcpClientMock.callToolContentImpl = async () => {
      await sleep(10);
      return { content: [], isError: false };
    };
    const svc = makeService();
    await svc.executeMCPToolContent(1, "scrape", {}, {
      ...CALL_OPTIONS,
      deadlinePerfMs: anchor,
    });
    const timeoutMs = mcpClientMock.observedOptions?.timeoutMs ?? -1;
    const maxTotal = mcpClientMock.observedOptions?.maxTotalTimeoutMs ?? -1;
    // connect ate a few ms; budget = remaining(≈205) − reserve(40) ≈ 165.
    expect(timeoutMs).toBeGreaterThan(100);
    expect(timeoutMs).toBeLessThanOrEqual(170);
    expect(maxTotal).toBe(timeoutMs);
    expect(
      (mcpClientMock.observedOptions as { resetTimeoutOnProgress?: boolean })
        ?.resetTimeoutOnProgress
    ).toBe(false);
  });

  it("an expired-after-connect step rejects before the call completes", async () => {
    const anchor = performance.now() + 220;
    mcpClientMock.connectImpl = () => sleep(60);
    mcpClientMock.callToolContentImpl = async (): Promise<{
      content: readonly { type: "text"; text: string }[];
      isError: boolean;
    }> => {
      await sleep(5_000);
      return { content: [], isError: false };
    };
    const svc = makeService();
    await expect(
      svc.executeMCPToolContent(1, "scrape", {}, {
        ...CALL_OPTIONS,
        deadlinePerfMs: anchor,
      })
    ).rejects.toBeInstanceOf(MCPTimeoutError);
  });

  it("continuous progress notifications cannot extend the budget", async () => {
    const anchor = performance.now() + 180;
    let progressSignals = 0;
    mcpClientMock.callToolContentImpl = async (
      _n: string,
      _p: Record<string, unknown>,
      options?: Parameters<typeof mcpClientMock.callToolContentImpl>[2]
    ): Promise<{
      content: readonly { type: "text"; text: string }[];
      isError: boolean;
    }> => {
      const interval = setInterval(() => {
        progressSignals += 1;
        options?.onprogress?.({ progress: progressSignals, total: 100 });
      }, 10);
      // Fool the SDK-level race with a promise way beyond the budget —
      // progress must NEVER extend the plan.
      await sleep(5_000);
      clearInterval(interval);
      return { content: [], isError: false };
    };
    const svc = makeService();
    await expect(
      svc.executeMCPToolContent(1, "scrape", {}, {
        ...CALL_OPTIONS,
        deadlinePerfMs: anchor,
      })
    ).rejects.toBeInstanceOf(MCPTimeoutError);
    expect(progressSignals).toBeGreaterThan(2);
  });

  it("an unresponsive shutdown cannot claim confirmed cleanup", async () => {
    const anchor = performance.now() + 300;
    mcpClientMock.callToolContentImpl = async (): Promise<{
      content: readonly { type: "text"; text: string }[];
      isError: boolean;
    }> => {
      await sleep(5_000);
      return { content: [], isError: false };
    };
    mcpClientMock.disconnectImpl = () => new Promise<boolean>(() => undefined);
    const svc = makeService();
    const err = (await svc
      .executeMCPToolContent(1, "scrape", {}, {
        ...CALL_OPTIONS,
        deadlinePerfMs: anchor,
      })
      .catch((e: MCPTimeoutError) => e)) as MCPTimeoutError;
    expect(err).toBeInstanceOf(MCPTimeoutError);
    expect(err.cleanupPending).toBe(true);
  });

  it("confirmed cleanup keeps the old (no pending) semantics on success", async () => {
    const anchor = performance.now() + 400;
    const order: string[] = [];
    mcpClientMock.callToolContentImpl = async () => {
      order.push("call");
      return {
        content: [{ type: "text" as const, text: "{}" }],
        isError: false,
      };
    };
    mcpClientMock.disconnectImpl = async () => {
      order.push("disconnect");
      return true;
    };
    const svc = makeService();
    const result = await svc.executeMCPToolContent(1, "scrape", {}, {
      ...CALL_OPTIONS,
      deadlinePerfMs: anchor,
    });
    expect(result.isError).toBe(false);
    // Cleanup completes BEFORE the call resolves to the executor.
    expect(order.slice(0, 2)).toEqual(["call", "disconnect"]);
  });
});
