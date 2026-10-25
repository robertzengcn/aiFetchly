import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * G04 integration layer: run the loop's REAL artifact promotion machinery
 * (PluginFileArtifactService over a real temp filesystem — staging,
 * candidates manifest, validation, digesting, registration, journal) behind
 * a fake executor/transport memory, so B03's chain — success claim →
 * promotion → outer verdict → ledger → salvage — is exercised end-to-end
 * instead of against per-layer mocks.
 */

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
  ): { ok: boolean; args?: Record<string, unknown>; reason?: string } => ({
    ok: true,
    args,
  }),
}));

vi.mock("@/config/usersetting", async (importOriginal) => {
  // Partial mock: the rollout keys (AI_CHAT_MESSAGE_QUEUE_ENABLED etc.)
  // used by AIChatWorkspaceRollout through the IPC import chain stay
  // defined; the real module is pure constants.
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    Token: class {
      getValue() {
        return "true";
      }
    },
    USER_AI_ENABLED: "true",
    TOKENNAME: "user-social-market-token",
  };
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "true";
    }
  },
}));

// One REAL service over a real temp root — `getPluginFileArtifactService`
// is swapped for it so the loop's promotion/journal/quota calls hit files.
vi.mock("@/service/PluginFileArtifactService", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@/service/PluginFileArtifactService");
  // Created inside the factory: vi.mock is hoisted above top-level consts.
  const root = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "yp-loop-integr-")),
    "store"
  );
  const realService = new actual.PluginFileArtifactService(
    { root, scopeId: "integration" },
    () => 1_770_000_000_000
  );
  (globalThis as Record<string, unknown>).__integrationFsRoot = root;
  (globalThis as Record<string, unknown>).__artifactService = realService;
  return { ...actual, getPluginFileArtifactService: () => realService };
});

import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  PluginToolPolicyRegistry,
  setPluginToolPolicyRegistryForTest,
  getPluginToolPolicyRegistry,
} from "@/service/PluginToolPolicyRegistry";
import {
  PluginFileArtifactService,
} from "@/service/PluginFileArtifactService";

function realService(): PluginFileArtifactService {
  return (globalThis as Record<string, unknown>)["__artifactService"] as PluginFileArtifactService;
}

function realFsRoot(): string {
  return (globalThis as Record<string, unknown>)["__integrationFsRoot"] as string;
}

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

/**
 * Stand-in for the executor/transport layer: it performs the plugin side of
 * the contract against the REAL store — stage files, write the candidates
 * manifest — and returns the tool envelope it would have produced.
 */
function makeLoop(
  behavior:
    | { mode: "staged" }
    | { mode: "empty-success" }
    | { mode: "crash-after-staging" }
): AIChatQueryLoop {
  const executeTool = vi.fn(
    async (
      _name: string,
      _args: unknown,
      options: { executionId?: string }
    ): Promise<Record<string, unknown>> => {
      const executionId = options.executionId ?? "exec-fallback";
      const service = realService();
      if (behavior.mode === "empty-success") {
        return {
          success: true,
          result: { success: true, summary: "executed but staged nothing" },
          execution_time_ms: 1,
        };
      }
      const staging = service.provisionStaging(executionId);
      fs.writeFileSync(
        path.join(staging, "records.json"),
        JSON.stringify({
          schemaVersion: 1,
          records: [
            { businessName: "A Co", phone: "555-1" },
            { businessName: "B Co", phone: "555-2" },
          ],
        })
      );
      fs.writeFileSync(
        path.join(staging, "candidates.json"),
        JSON.stringify({
          version: 1,
          candidates: [
            {
              version: 1,
              relativePath: "records.json",
              format: "json",
              recordCount: 2,
              complete: true,
            },
          ],
        })
      );
      if (behavior.mode === "crash-after-staging") {
        throw new Error("transport crashed after staging files");
      }
      return {
        success: true,
        result: { summary: "scraped 2 records" },
        execution_time_ms: 1,
      };
    }
  );
  return new AIChatQueryLoop({
    streamChatCompletion: vi.fn(),
    getSkillDefinition: vi.fn(() => undefined),
    executeTool: executeTool as unknown as ConstructorParameters<
      typeof AIChatQueryLoop
    >[0]["executeTool"],
  } as unknown as ConstructorParameters<typeof AIChatQueryLoop>[0]);
}

function makeFakeHandle(jobId: string) {
  const hooks: Array<() => void> = [];
  const state: {
    resolved: ToolExecutionResultLike | undefined;
    rejected: unknown;
  } = { resolved: undefined, rejected: undefined };
  return {
    state,
    handle: {
      jobId,
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
  spec: {
    conversationId: string;
    call: { id: string; name: string };
    meta: { pluginName: string; identity: string };
    jobId: string;
  }
): Promise<ReturnType<typeof makeFakeHandle>["state"]> {
  const { state, handle } = makeFakeHandle(spec.jobId);
  await (
    loop as unknown as LoopInternals
  ).spawnPluginAsyncTool.call(
    loop,
    {
      conversationId: spec.conversationId,
      assistantMessageId: "m-g04",
      sourceUserMessageId: "u-g04",
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
  ledgerState.completeAttempts = [];
  setPluginToolPolicyRegistryForTest(registryWithArtifacts());
});

afterEach(() => {
  setPluginToolPolicyRegistryForTest(undefined);
});

describe("AIChatQueryLoop real-artifact integration (G04)", () => {
  it(
    "registers real staged files and lists them in the store for the conversation",
    async () => {
      const loop = makeLoop({ mode: "staged" });
      const state = await runSpawn(loop, {
        conversationId: "conv-integr-ok",
        call: { id: "call_g04a", name: "mcp__demo-plugin__scraper__scrape" },
        meta: { pluginName: "demo-plugin", identity: "ident-g04a" },
        jobId: "exec-g04a",
      });
      const settled = state.resolved as ToolExecutionResultLike;
      expect(settled.success).toBe(true);

      // The REAL store now holds exactly one validated artifact.
      const listed = realService().listForConversation("conv-integr-ok");
      expect(listed).toHaveLength(1);
      expect(listed[0].format).toBe("json");
      expect(listed[0].recordCount).toBe(2);
      expect(typeof listed[0].digest).toBe("string");
      // The payload carried the produced artifact ref (id + linked metadata).
      const artifacts = settled.result.artifacts as Array<{
        id: string;
        format: string;
        recordCount: number;
      }>;
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].id).toBe(listed[0].id);
      // The real content file with the real digest exists on disk.
      const contentPath = path.join(
        realFsRoot(),
        "artifacts",
        listed[0].id,
        "content.json"
      );
      expect(fs.existsSync(contentPath)).toBe(true);
      expect(
        fs.readFileSync(contentPath, "utf8").includes("businessName")
      ).toBe(true);
      // Ledger agrees this attempt succeeded (the unconditional onSettled
      // hook fires "failed" first; the success path then records the real
      // outcome — the idempotent ledger collapses duplicates in production).
      expect(ledgerState.completeAttempts).toContainEqual(
        ["conv-integr-ok", "demo-plugin", "ident-g04a", "succeeded"]
      );
    },
    25_000
  );

  it(
    "degrades a success claim with no real staging to an outer failure (B03 end-to-end)",
    async () => {
      const loop = makeLoop({ mode: "empty-success" });
      const state = await runSpawn(loop, {
        conversationId: "conv-integr-empty",
        call: { id: "call_g04b", name: "mcp__demo-plugin__scraper__scrape" },
        meta: { pluginName: "demo-plugin", identity: "ident-g04b" },
        jobId: "exec-g04b",
      });
      const settled = state.resolved as ToolExecutionResultLike;
      expect(settled.success).toBe(false);
      expect(
        (settled.result.error as Record<string, unknown>).code
      ).toBe("ARTIFACT_REGISTRATION_FAILED");
      expect(realService().listForConversation("conv-integr-empty")).toHaveLength(0);
      expect(
        ledgerState.completeAttempts.filter(
          (a) =>
            a[0] === "conv-integr-empty" && a[3] === "succeeded"
        )
      ).toHaveLength(0);
    },
    25_000
  );

  it(
    "salvages REAL staged files when the executor crashes mid-flight (B03 crash path)",
    async () => {
      const loop = makeLoop({ mode: "crash-after-staging" });
      const state = await runSpawn(loop, {
        conversationId: "conv-integr-crash",
        call: { id: "call_g04c", name: "mcp__demo-plugin__scraper__scrape" },
        meta: { pluginName: "demo-plugin", identity: "ident-g04c" },
        jobId: "exec-g04c",
      });

      const resolved = state.resolved as ToolExecutionResultLike;
      expect(resolved.success).toBe(false);
      expect(
        (resolved.result.error as Record<string, unknown>).code
      ).toBe("TRANSPORT_CRASHED");

      // The leftover REAL staging was still promoted despite the crash.
      const listed = realService().listForConversation("conv-integr-crash");
      expect(listed).toHaveLength(1);
      expect(listed[0].recordCount).toBe(2);
      const artifacts = resolved.result.artifacts as Array<{ id: string }>;
      expect(artifacts.map((a) => a.id)).toContain(listed[0].id);
      expect(
        ledgerState.completeAttempts.filter(
          (a) => a[0] === "conv-integr-crash" && a[3] === "succeeded"
        )
      ).toHaveLength(0);
    },
    25_000
  );

  it("opens a spawn journal for artifact-capable plugins through the real store", async () => {
    const loop = makeLoop({ mode: "staged" });
    await runSpawn(loop, {
      conversationId: "conv-integr-journal",
      call: { id: "call_g04d", name: "mcp__demo-plugin__scraper__scrape" },
      meta: { pluginName: "demo-plugin", identity: "ident-g04d" },
      jobId: "exec-g04d",
    });
    const journals = realService().listJournalStatesForConversation(
      "conv-integr-journal"
    );
    expect(journals.some((j) => j.executionId === "exec-g04d")).toBe(true);
    // A promotion completed at settle: registry upgrade + registered count.
    const journal = journals.find((j) => j.executionId === "exec-g04d")!;
    expect(journal.registeredCount).toBe(1);
    expect(journal.status === "complete").toBe(true);
    // Quota preflight API stays plugged into the real service.
    expect(getPluginToolPolicyRegistry().getPluginArtifactFormats("demo-plugin")).toContain(
      "json"
    );
  }, 25_000);
});
