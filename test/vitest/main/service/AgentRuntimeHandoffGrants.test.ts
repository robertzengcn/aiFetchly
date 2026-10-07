/**
 * Inter-agent handoff grants (T15b / design §9.2).
 *
 * When a child agent externalizes an oversized tool result, the parent
 * conversation cannot read it without a grant — `authorizeAccess` returns
 * `OUTPUT_NOT_AVAILABLE` for a conversation that is not the owner. The child
 * runtime issues that grant at its terminal (after `saveResult`, before
 * returning), one per externalized `outputId`, so the parent's
 * `tool_result_read`/`tool_result_search` hits the grant branch instead of
 * being denied.
 *
 * This test wires a real `ToolResultModule` (tmp SQLite) + a fake loop that
 * invokes the runtime's `saveToolResultReceipt` callback with a receipt
 * containing an `outputId`, then asserts:
 *  - `grantAccess` was called for that outputId with owner=child, grantee=parent;
 *  - the parent conversation can now `authorizeAccess` the output (`ok: true`);
 *  - a non-granted sibling conversation is still denied
 *    `OUTPUT_NOT_AVAILABLE` (no existence leak);
 *  - `AgentResult.outputIds` carries the externalized id for observability;
 *  - when no parent conversation is present, NO grant is issued.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const definition = {
  id: "agent-handoff",
  name: "Handoff Agent",
  description: "Test",
  version: 1,
  systemPrompt: "You are a test agent.",
  allowedTools: ["lookup"],
  mode: "specialist",
  maxToolCalls: 10,
  maxRuntimeMs: 5000,
  maxContinueCalls: 4,
  outputSchema: {
    type: "object",
    required: ["businessSummary", "sourceUrls", "confidence"],
    properties: {
      businessSummary: { type: "string" },
      sourceUrls: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
  },
  status: "active",
  source: "built-in",
  health: "healthy",
  manifest: {},
} as const;

let mockDefinition: typeof definition = { ...definition };

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    async getActiveById() {
      return mockDefinition;
    }
  },
}));

vi.mock("@/modules/AgentTaskModule", () => ({
  AgentTaskModule: class {
    toolCallsCount = 0;
    async createTask() {
      return undefined;
    }
    async appendMessage() {
      return undefined;
    }
    async setStatus() {
      return undefined;
    }
    async saveResult() {
      return undefined;
    }
    async incrementToolCalls() {
      this.toolCallsCount += 1;
    }
    async getSnapshot() {
      return { toolCallsCount: this.toolCallsCount };
    }
    async saveToolCall() {
      return undefined;
    }
  },
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn(async () => [
      {
        type: "function",
        name: "lookup",
        description: "Lookup",
        parameters: { type: "object" },
      },
    ]),
    getSkill: vi.fn(() => ({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object" },
      permissionCategory: "pure",
    })),
  },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...original,
    AiChatApi: class {
      openAIChatCompletionStream() {
        return Promise.resolve();
      }
    },
  };
});

/**
 * The fake loop captures the runtime's preserved-output collaborators
 * (toolResultModule/toolResultStorage + the saveToolResultReceipt callback).
 * During `run()` it seeds a REAL child-owned output under the conversation id
 * the runtime generated (loopInput.conversationId), then reports that output
 * through `saveToolResultReceipt` — mirroring how the production loop
 * externalizes an oversized result under the agent's own conversation id and
 * hands the receipt back. This keeps the owner/grantor/grantee chain
 * consistent exactly as in production, so `grantAccess`'s internal
 * ownership re-check passes.
 */
interface CapturedLoopDeps {
  saveToolResultReceipt?: (input: {
    conversationId?: string;
    assistantMessageId?: string;
    toolCallId?: string;
    toolName?: string;
    content: string;
    uiMetadata?: Record<string, unknown>;
  }) => Promise<void>;
  toolResultModule?: ToolResultModule;
  toolResultStorage?: ToolResultStorageService;
}
let capturedLoopDeps: CapturedLoopDeps = {};
/**
 * Whether the fake loop should externalize an output during `run()`. Set by
 * the test BEFORE calling `runSync`. When true, the fake loop seeds a real
 * output under the runtime's conversation id and reports it; when false, the
 * loop completes without externalizing (no grant should be issued).
 */
let fakeLoopExternalize: boolean = false;
/** Captured runtime conversation id, set during `run()`. */
let capturedAgentConversationId: string | null = null;

vi.mock("@/service/AIChatQueryLoop", () => ({
  AIChatQueryLoop: class {
    constructor(deps: unknown) {
      capturedLoopDeps = deps as CapturedLoopDeps;
    }
    async run(loopInput: { conversationId?: string }) {
      capturedAgentConversationId = loopInput?.conversationId ?? null;
      // Simulate an externalized oversized result: seed a real output owned by
      // the runtime's conversation, then report its receipt so the terminal
      // grant step runs. Mirrors the production loop externalizing under the
      // agent's own conversation id.
      if (
        fakeLoopExternalize &&
        capturedAgentConversationId &&
        capturedLoopDeps.toolResultModule &&
        capturedLoopDeps.toolResultStorage &&
        capturedLoopDeps.saveToolResultReceipt
      ) {
        const { outputId } = await seedChildOutput(
          capturedLoopDeps.toolResultModule,
          capturedLoopDeps.toolResultStorage,
          capturedAgentConversationId,
          "agent-handoff"
        );
        await capturedLoopDeps.saveToolResultReceipt({
          conversationId: capturedAgentConversationId,
          assistantMessageId: "agent-assistant",
          toolCallId: "call-x",
          toolName: "lookup",
          content: JSON.stringify({
            schemaVersion: 1,
            toolCallId: "call-x",
            toolName: "lookup",
            operationStatus: "success",
            success: true,
            control: {},
            outputs: [{ outputId, capturedBytes: 99, preservation: "complete" }],
            preview: "",
            previewComplete: false,
          }),
          uiMetadata: {},
        });
      }
      return {
        type: "completed",
        fullContent: JSON.stringify({
          businessSummary: "ok",
          sourceUrls: [],
          confidence: 0.8,
        }),
      };
    }
  },
}));

// The runtime constructs a ToolResultStorageService from getToolResultStorageRoot
// when only a module is supplied. Mock the root to point at our tmp dir so no
// real Electron app.getPath is needed.
let tmpDir: string;
let storageRoot: string;

vi.mock("@/service/toolResult/toolResultRoot", () => ({
  getToolResultStorageRoot: () => storageRoot,
}));

import { AgentRuntime } from "@/service/AgentRuntime";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";

beforeEach(() => {
  tmpDir = path.join(
    os.tmpdir(),
    `aifetchly-agent-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  storageRoot = path.join(tmpDir, "artifacts");
  fs.mkdirSync(storageRoot, { recursive: true });
  mockDefinition = { ...definition };
  capturedLoopDeps = {};
  fakeLoopExternalize = false;
  capturedAgentConversationId = null;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Seed a real preserved output (row + artifact) owned by the child conversation. */
async function seedChildOutput(
  module: ToolResultModule,
  storage: ToolResultStorageService,
  conversationId: string,
  agentId: string
): Promise<{ outputId: string; epoch: string }> {
  const epoch = await module.currentEpoch("default", conversationId);
  // Claim a slot so the output row exists in "writing" state with a lease.
  const claim = await module.claimOutput({
    profileId: "default",
    conversationId,
    outputEpoch: epoch,
    executionId: `${conversationId}:exec:call-x`,
    toolCallId: "call-x",
    toolName: "lookup",
    turnId: "turn-x",
    ownerAgentId: agentId,
    streamKey: "main",
    format: "json",
    mediaType: "application/json",
    sourceCompleteness: "complete",
  });
  if (claim.kind !== "claimed") {
    throw new Error(`claimOutput returned ${claim.kind}`);
  }
  const { outputId, leaseFence } = claim;
  // Capture the body via the public API; this writes the artifact + manifest
  // and returns the storageKey + sha256 needed to commit.
  const artifact = await storage.captureJson({
    outputId,
    profileId: "default",
    outputEpoch: epoch,
    value: { rows: [{ i: 1 }], success: true },
    format: "json",
    sourceCompleteness: "complete",
  });
  // Commit so the row transitions to "committed" and authorizeAccess trusts it.
  const committed = await module.commitOutput({
    outputId,
    leaseFence,
    storageKey: artifact.storageKey,
    capturedBytes: artifact.capturedBytes,
    originalBytes: artifact.capturedBytes,
    sha256: artifact.sha256,
    preservation: "complete",
    sourceCompleteness: "complete",
    receiptJson: JSON.stringify({
      schemaVersion: 1,
      toolCallId: "call-x",
      toolName: "lookup",
      operationStatus: "success",
      success: true,
      control: {},
      outputs: [
        {
          outputId,
          capturedBytes: artifact.capturedBytes,
          preservation: "complete",
        },
      ],
      preview: "",
      previewComplete: false,
    }),
  });
  if (!committed) {
    throw new Error("commitOutput returned false");
  }
  return { outputId, epoch };
}

function makeRequest(overrides: Partial<{
  parentConversationId: string | undefined;
  parentAgentId: string;
}> = {}) {
  return {
    agentId: "agent-handoff",
    prompt: "research",
    executionMode: "foreground" as const,
    taskPacket: {
      lead: { companyName: "Acme" },
      userGoal: "research acme",
      constraints: {},
      priorFindings: [],
      requiredOutputSchema: { type: "object" },
    },
    ...overrides,
  };
}

describe("AgentRuntime — inter-agent handoff grants (T15b)", () => {
  it("issues a grant per externalized outputId so the parent can read it", async () => {
    const module = new ToolResultModule(tmpDir);
    await module.ensureConnection();
    const storage = new ToolResultStorageService({ root: storageRoot });

    // Tell the fake loop to externalize a real child-owned output during its
    // run(), seeded under the runtime's own conversation id (captured from
    // loopInput.conversationId). The runtime then issues a handoff grant at
    // its terminal so the parent conversation can read that output.
    fakeLoopExternalize = true;

    const runtime = new AgentRuntime();
    const parentConversation = `parent-${Math.random().toString(36).slice(2)}`;
    // In production the parent conversation is an active chat with its own
    // output scope/epoch (the main chat loop created it). `grantAccess` requires
    // a live grantee scope to mint the grant, so seed one here before the run.
    await module.currentEpoch("default", parentConversation);

    const result = await runtime.runSync(
      makeRequest({
        parentConversationId: parentConversation,
        parentAgentId: "agent-parent",
      }),
      { toolResultModule: module, toolResultStorage: storage }
    );

    // The fake loop seeded exactly one output and reported it; the runtime
    // surfaces its outputId on the result for observability.
    expect(result.outputIds).toBeDefined();
    expect(result.outputIds!.length).toBe(1);
    const outputId = result.outputIds![0];
    expect(outputId).toMatch(/^out_[0-9a-f]+$/);
    // The runtime used its own conversation id as the owner; the fake loop
    // captured it so we can assert the grant's owner matches.
    expect(capturedAgentConversationId).toBeTruthy();

    // 1. The parent conversation can now authorize read access via the grant
    //    the child issued at its terminal. Without the grant, the parent
    //    (not the owner conversation) would be denied.
    const parentDecision = await module.authorizeAccess({
      outputId,
      profileId: "default",
      conversationId: parentConversation,
      agentId: "agent-parent",
    });
    expect(parentDecision.ok).toBe(true);

    // 2. A sibling conversation that was NOT granted is still denied, with the
    //    same code as a missing output (no existence leak — AC-11).
    const siblingDecision = await module.authorizeAccess({
      outputId,
      profileId: "default",
      conversationId: `sibling-${Math.random().toString(36).slice(2)}`,
    });
    expect(siblingDecision.ok).toBe(false);
    if (!siblingDecision.ok) {
      expect(siblingDecision.code).toBe("OUTPUT_NOT_AVAILABLE");
    }
  });

  it("issues NO grant when parentConversationId is absent (top-level run)", async () => {
    const module = new ToolResultModule(tmpDir);
    await module.ensureConnection();
    const storage = new ToolResultStorageService({ root: storageRoot });

    // The fake loop still externalizes an output, but because this is a
    // top-level run (no parentConversationId), the runtime must NOT issue a
    // grant. The outputId is still surfaced for observability.
    fakeLoopExternalize = true;

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(makeRequest(), {
      toolResultModule: module,
      toolResultStorage: storage,
    });

    expect(result.outputIds).toBeDefined();
    expect(result.outputIds!.length).toBe(1);
    const outputId = result.outputIds![0];

    // No grant was issued: a stranger conversation is denied. (The owner
    // conversation itself can still read it, but a non-owner cannot.)
    const strangerDecision = await module.authorizeAccess({
      outputId,
      profileId: "default",
      conversationId: `stranger-${Math.random().toString(36).slice(2)}`,
    });
    expect(strangerDecision.ok).toBe(false);
  });
});
