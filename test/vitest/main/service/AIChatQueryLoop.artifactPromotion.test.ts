import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Module-level mocks -------------------------------------------------

vi.mock("@/service/ToolTimeoutPolicy", () => ({
  inferTimeoutClassByName: () => "browser" as const,
  resolveTimeoutMs: () => 240_000,
  TOOL_TIMEOUT_POLICY: { fast: 50, network: 90_000, browser: 240_000 },
}));

vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: class {
    static partialSnapshots = new Map();
    static updatePartialSnapshot(): void {
      /* no-op for test */
    }
    static async requestPartialSnapshot() {
      return null;
    }
    static unregisterPartialSnapshot(): void {
      /* no-op for test */
    }
  },
}));

const ledgerState = {
  completeAttempts: [] as Array<[string, string, string, "failed" | "succeeded"]>,
};

vi.mock("@/service/PluginRecoveryLedger", () => ({
  getPluginRecoveryLedger: () => ({
    completeAttempt: (
      conversationId: string,
      pluginName: string,
      identity: string,
      outcome: "failed" | "succeeded"
    ) => {
      ledgerState.completeAttempts.push([
        conversationId,
        pluginName,
        identity,
        outcome,
      ]);
    },
    recordTransportFailure: (input: Record<string, unknown>) =>
      `ref_${JSON.stringify(input)}`,
    validateAndReserve: () => ({ ok: true, context: {} }),
    bindPluginErrorId: () => ({ hostCode: "bound" }),
    recordFailure: () => "ref",
  }),
  jobFingerprintFromArgs: (_t: string, args: Record<string, unknown>) =>
    JSON.stringify(args ?? {}),
  searchIdentityFromArgs: (_t: string, args: Record<string, unknown>) =>
    "ident-" + JSON.stringify(args ?? {}),
  validatePublicSearchInput: (
    _tool: string,
    args: Record<string, unknown>
  ): {
    ok: boolean;
    args?: Record<string, unknown>;
    reason?: string;
  } => ({ ok: true, args }),
}));

const artifactService = {
  stagingExistsResult: false,
  candidatesResult: [] as unknown[],
  promotionResult: { artifacts: [] as unknown[], errors: [] as string[] },
  stagingExists(executionId: string): boolean {
    void executionId;
    return artifactService.stagingExistsResult;
  },
  readCandidates(executionId: string): unknown[] {
    void executionId;
    return artifactService.candidatesResult;
  },
  promoteCandidates(input: {
    executionId: string;
    conversationId: string;
    pluginName: string;
    candidates: readonly unknown[];
  }): { artifacts: unknown[]; errors: string[] } {
    void input;
    return {
      artifacts: artifactService.promotionResult.artifacts,
      errors: [...artifactService.promotionResult.errors],
    };
  },
};

vi.mock("@/service/PluginFileArtifactService", () => ({
  getPluginFileArtifactService: () => artifactService,
}));

vi.mock("@/config/usersetting", () => ({
  Token: class {
    getValue() {
      return "";
    }
  },
  USER_AI_ENABLED: "true",
  TOKENNAME: "user-social-market-token",
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "";
    }
  },
}));

// After mocks are in place, import the module under test.
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  PluginToolPolicyRegistry,
  setPluginToolPolicyRegistryForTest,
} from "@/service/PluginToolPolicyRegistry";

interface LoopInternals {
  spawnPluginAsyncTool: (
    input: {
      conversationId: string;
      assistantMessageId: string;
      sourceUserMessageId: string;
      abortController: AbortController;
    },
    call: { id: string; name: string; arguments?: Record<string, unknown> },
    handle: {
      jobId: string;
      onSettled: (h: () => void) => void;
      resolve: (result: unknown) => void;
      reject: (err: unknown) => void;
      signal: AbortSignal;
    },
    meta: {
      deadlineEpochMs: number;
      deadlinePerfMs: number;
      outboundAuthorization: undefined;
      pluginName: string;
      identity: string;
    }
  ) => Promise<void>;
  promotePluginArtifactsToPayload: (input: {
    conversationId: string;
    executionId: string;
    pluginName: string;
    payload?: Record<string, unknown>;
  }) => {
    stagingExists: boolean;
    candidateCount: number;
    registeredCount: number;
    errors: readonly string[];
    degradedToFailure: boolean;
  };
}

interface ToolExecutionResultLike {
  success: boolean;
  result: Record<string, unknown>;
  execution_time_ms: number;
}

function registryWithArtifacts(): PluginToolPolicyRegistry {
  const reg = new PluginToolPolicyRegistry();
  reg.registerFromManifest("demo-plugin", {
    name: "demo-plugin",
    version: "1.0.0",
    capabilities: { fileArtifacts: ["json", "csv"] },
  });
  return reg;
}

function registryWithoutArtifacts(): PluginToolPolicyRegistry {
  const reg = new PluginToolPolicyRegistry();
  reg.registerFromManifest("demo-plugin", {
    name: "demo-plugin",
    version: "1.0.0",
  });
  return reg;
}

function makeLoop(executeToolResult: Record<string, unknown>): AIChatQueryLoop {
  const executeTool = vi.fn(async () => executeToolResult);
  return new AIChatQueryLoop({
    streamChatCompletion: vi.fn(),
    getSkillDefinition: vi.fn(() => undefined),
    executeTool: executeTool as unknown as ConstructorParameters<
      typeof AIChatQueryLoop
    >[0]["executeTool"],
  } as unknown as ConstructorParameters<typeof AIChatQueryLoop>[0]);
}

interface SpawnCall {
  call: { id: string; name: string };
  meta: { pluginName: string; identity: string };
  conversationId: string;
  jobId: string;
}

function makeFakeHandle() {
  const hooks: Array<() => void> = [];
  const state: {
    resolved: ToolExecutionResultLike | undefined;
    rejected: unknown;
  } = { resolved: undefined, rejected: undefined };
  return {
    state,
    handle: {
      jobId: "exec-b03-1",
      onSettled: (h: () => void) => {
        hooks.push(h);
      },
      resolve: (r: ToolExecutionResultLike) => {
        state.resolved = r;
        for (const h of hooks) h();
      },
      reject: (e: unknown) => {
        state.rejected = e;
        for (const h of hooks) h();
      },
      signal: new AbortController().signal,
    },
  };
}

async function runSpawn(
  loop: AIChatQueryLoop,
  spec: SpawnCall
): Promise<ReturnType<typeof makeFakeHandle>["state"]> {
  const { state, handle } = makeFakeHandle();
  await (
    loop as unknown as LoopInternals
  ).spawnPluginAsyncTool.call(
    loop,
    {
      conversationId: spec.conversationId,
      assistantMessageId: "m-b03",
      sourceUserMessageId: "u-b03",
      request: { model: "test-model" },
      abortController: new AbortController(),
    } as never,
    spec.call,
    handle as never,
    {
      deadlineEpochMs: Date.now() + 60_000,
      deadlinePerfMs: performance.now() + 60_000,
      outboundAuthorization: undefined,
      pluginName: spec.meta.pluginName,
      identity: spec.meta.identity,
    }
  );
  return state;
}

beforeEach(() => {
  artifactService.stagingExistsResult = false;
  artifactService.candidatesResult = [];
  artifactService.promotionResult = { artifacts: [], errors: [] };
  ledgerState.completeAttempts = [];
});

afterEach(() => {
  setPluginToolPolicyRegistryForTest(undefined);
});

describe("AIChatQueryLoop artifact promotion verdict (B03)", () => {
  it("degrades an artifact-capable plugin success with no staged artifacts to an outer failure", async () => {
    setPluginToolPolicyRegistryForTest(registryWithArtifacts());
    const loop = makeLoop({
      success: true,
      result: { success: true, summary: "scraped 3 records" },
      execution_time_ms: 1,
    });
    const state = await runSpawn(loop, {
      call: { id: "call_b03", name: "mcp__demo-plugin__scraper__scrape" },
      meta: { pluginName: "demo-plugin", identity: "ident-b03" },
      conversationId: "conv-b03",
      jobId: "exec-b03-1",
    });
    const resolvedBad = state.resolved as ToolExecutionResultLike;

    expect(resolvedBad.success).toBe(false);
    expect(resolvedBad.result.success).toBe(false);
    expect(
      (resolvedBad.result.error as Record<string, unknown>).code
    ).toBe("ARTIFACT_REGISTRATION_FAILED");
    // Ledger agrees: the degraded run consumes the attempt, not a phantom
    // success.
    expect(
      ledgerState.completeAttempts.some(
        (a) =>
          a[0] === "conv-b03" &&
          a[3] === "failed"
      )
    ).toBe(true);
    expect(
      ledgerState.completeAttempts
    ).not.toContainEqual(
      ["conv-b03", "demo-plugin", "ident-b03", "succeeded"]
    );
  }, 25_000);

  it("settles the ledger as succeeded when artifacts register", async () => {
    setPluginToolPolicyRegistryForTest(registryWithArtifacts());
    artifactService.stagingExistsResult = true;
    artifactService.candidatesResult = [{ path: "data.json", format: "json" }];
    artifactService.promotionResult = {
      artifacts: [
        {
          id: "art_1",
          format: "json",
          recordCount: 30,
          sizeBytes: 1200,
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "art_2",
          format: "json",
          recordCount: 60,
          sizeBytes: 2200,
          createdAt: "2026-01-01T00:01:00Z",
        },
      ],
      errors: [],
    };
    const loop = makeLoop({
      success: true,
      result: { success: true, summary: "scraped" },
      execution_time_ms: 1,
    });
    const state = await runSpawn(loop, {
      call: { id: "call_b03o", name: "mcp__demo-plugin__scraper__scrape" },
      meta: { pluginName: "demo-plugin", identity: "ident-b03o" },
      conversationId: "conv-b03-ok",
      jobId: "exec-b03-2",
    });
    const resolvedOk = state.resolved as ToolExecutionResultLike;

    expect(resolvedOk.success).toBe(true);
    expect(resolvedOk.result.success).toBe(true);
    expect(
      (resolvedOk.result.artifacts as unknown[]).map(
        (a) => (a as Record<string, unknown>).id
      )
    ).toEqual(["art_1", "art_2"]);
    expect(ledgerState.completeAttempts).toContainEqual([
      "conv-b03-ok",
      "demo-plugin",
      "ident-b03o",
      "succeeded",
    ]);
  }, 25_000);

  it("keeps a non-artifact plugin tool's generic success valid", async () => {
    setPluginToolPolicyRegistryForTest(registryWithoutArtifacts());
    const loop = makeLoop({
      success: true,
      result: { success: true, status: "ok", platforms: ["yelp"] },
      execution_time_ms: 1,
    });
    const state = await runSpawn(loop, {
      call: { id: "call_b03g", name: "mcp__demo-plugin__scraper__list_platforms" },
      meta: { pluginName: "demo-plugin", identity: "ident-b03g" },
      conversationId: "conv-b03-generic",
      jobId: "exec-b03-3",
    });
    const resolvedGeneric = state.resolved as ToolExecutionResultLike;

    expect(resolvedGeneric.success).toBe(true);
    expect(resolvedGeneric.result.success).toBe(true);
    // The success path deletes the ledger entry BEFORE handle.resolve fires
    // the onSettled hook — the trailing "failed" settle lands on an already-
    // deleted entry and is a no-op in the real ledger.
    expect(ledgerState.completeAttempts).toEqual([
      ["conv-b03-generic", "demo-plugin", "ident-b03g", "succeeded"],
      ["conv-b03-generic", "demo-plugin", "ident-b03g", "failed"],
    ]);
  }, 25_000);

  it("appends partial-promotion warnings without flipping the verdict", async () => {
    setPluginToolPolicyRegistryForTest(registryWithArtifacts());
    artifactService.stagingExistsResult = true;
    artifactService.candidatesResult = [
      { path: "data.json", format: "json" },
      { path: "broken.csv", format: "csv" },
    ];
    artifactService.promotionResult = {
      artifacts: [
        {
          id: "art_3",
          format: "json",
          recordCount: 5,
          sizeBytes: 40,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      errors: ["broken.csv: registered nothing"],
    };
    const loop = makeLoop({
      success: true,
      result: { success: true, summary: "scraped" },
      execution_time_ms: 1,
    });
    const state = await runSpawn(loop, {
      call: { id: "call_b03p", name: "mcp__demo-plugin__scraper__scrape" },
      meta: { pluginName: "demo-plugin", identity: "ident-b03p" },
      conversationId: "conv-b03-partial",
      jobId: "exec-b03-4",
    });
    const resolvedPartial = state.resolved as ToolExecutionResultLike;

    expect(resolvedPartial.success).toBe(true);
    expect(
      (resolvedPartial.result.artifacts as unknown[]).map(
        (a) => (a as Record<string, unknown>).id
      )
    ).toEqual(["art_3"]);
    expect(
      (resolvedPartial.result.warnings as string[]).some((w) =>
        w.includes("Artifact registration partially failed")
      )
    ).toBe(true);
    expect(ledgerState.completeAttempts).toContainEqual([
      "conv-b03-partial",
      "demo-plugin",
      "ident-b03p",
      "succeeded",
    ]);
  }, 25_000);

  it("promotion outcome reports staging/candidate counts and does not degrade ungraded plugins", () => {
    setPluginToolPolicyRegistryForTest(registryWithArtifacts());
    const loop = makeLoop({ success: true, result: {}, execution_time_ms: 1 });
    artifactService.stagingExistsResult = true;
    artifactService.candidatesResult = [{ path: "a.json", format: "json" }];
    artifactService.promotionResult = { artifacts: [], errors: ["bad"] };
    const outcome = (
      loop as unknown as LoopInternals
    ).promotePluginArtifactsToPayload.call(loop, {
      conversationId: "conv-b03-pu",
      executionId: "exec-b03-pu",
      pluginName: "demo-plugin",
      payload: { success: true },
    });
    expect(outcome).toEqual({
      stagingExists: true,
      candidateCount: 1,
      registeredCount: 0,
      errors: ["bad"],
      degradedToFailure: true,
    });
  }, 25_000);
});
