/**
 * Unit tests for the outbound-email gate plumbing inside AIChatQueryLoop
 * (RC1/RC4, technical design §13.1 + §14.2 + §15.1).
 *
 * Verifies that `evaluateOutboundEmailGate` — the loop's private seam:
 *   1. Returns a blocking draft_required when the turn has no intent.
 *   2. Resolves the trusted authorization triple for a send_now turn whose
 *      latest batch is draft_ready, returning allowed:true with
 *      {batchId, authorizationId, batchHash} for the send tool to claim.
 *   3. Blocks authorization_missing when the turn is send_now but has no
 *      authorizable batch (only terminal batches exist).
 *   4. Threads the allowed triple through prepareToolCall →
 *      executePreparedToolWithTimeout → the SkillExecutionContext passed to
 *      deps.executeTool, so `start_email_send_task` receives
 *      context.outboundAuthorization and can claim via the delivery service.
 *
 * Heavy dependencies (ToolExecutor, IPC modules) are mocked so the module
 * imports cleanly under vitest, matching AIChatQueryLoopCancellation.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";

// --- Module-level mocks (must precede the import of AIChatQueryLoop) ----
vi.mock("@/service/ToolTimeoutPolicy", () => ({
  inferTimeoutClassByName: () => "fast" as const,
  resolveTimeoutMs: () => 5_000,
  TOOL_TIMEOUT_POLICY: { fast: 5_000, network: 90_000, browser: 240_000 },
}));

vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: class {
    static partialSnapshots = new Map();
    static updatePartialSnapshot(): void {
      /* no-op */
    }
    static async requestPartialSnapshot() {
      return null;
    }
    static unregisterPartialSnapshot(): void {
      /* no-op */
    }
  },
}));

vi.mock("@/service/ToolJobRegistry", () => ({
  getDefaultToolJobRegistry: () => ({
    submit: () => "job-1",
    getStatus: () => ({ status: "running" }),
  }),
}));

// The DB path for the outbound models constructed inside the loop's gate:
// OutboundEmailIntentModule (via BaseModule) and OutboundEmailAuthorizationService
// both resolve their dbpath from Token.getValue(USERSDBPATH), where the
// USERSDBPATH constant's value is the token-store key "user_dbpath". The
// mocked Token returns the tmpDir so everything shares one test database.
const tmpDir = path.join(os.tmpdir(), "aifetchly-loop-outbound-gate");

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));

vi.mock("@/config/usersetting", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
  USER_AI_ENABLED: "true",
  TOKENNAME: "user-social-market-token",
  USERSDBPATH: "user_dbpath",
}));

import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { OutboundEmailIntentModel } from "@/model/OutboundEmailIntent.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";

/** Type-erased accessors for the loop's private seams. */
interface LoopWithInternals {
  evaluateOutboundEmailGate: (input: Record<string, unknown>) => Promise<{
    allowed: boolean;
    code?: string;
    batchId?: number | null;
    authorizationId?: number;
    batchHash?: string;
  }>;
}

function resetDb(): void {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}
let f: string;

function makeIntent(
  mode: "send_now" | "draft_only" | "review_first"
): OutboundEmailIntentEntity {
  const e = new OutboundEmailIntentEntity();
  e.conversationId = "conv-1";
  e.sourceUserMessageId = "msg-1";
  e.mode = mode;
  e.reasonCode = "explicit_send_instruction";
  e.confidence = 1;
  e.evidenceJson = "[]";
  e.sourceTextHash = "a".repeat(64);
  e.resolverVersion = "outbound-resolver-v1";
  e.previousAssistantMessageId = null;
  return e;
}

function makeBatch(
  overrides: Partial<OutboundEmailDraftBatchEntity> = {}
): OutboundEmailDraftBatchEntity {
  const e = new OutboundEmailDraftBatchEntity();
  e.conversationId = "conv-1";
  e.sourceUserMessageId = "msg-1";
  e.intentDecisionId = 1;
  e.status = "draft_ready";
  e.recipientSourceType = "direct";
  e.recipientCount = 1;
  e.validRecipientCount = 1;
  e.emailServiceIdsJson = "[1]";
  e.batchHash = "a".repeat(64);
  return Object.assign(e, overrides);
}

function makeGateInput(
  intentDecisionId: number | null
): Record<string, unknown> {
  return {
    conversationId: "conv-1",
    sourceUserMessageId: "msg-1",
    intentDecisionId,
  };
}

describe("AIChatQueryLoop outbound-email gate plumbing", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  it("blocks draft_required when the turn has no intent decision", async () => {
    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(makeGateInput(null));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("draft_required");
  });

  it("allows a send_now turn with a draft_ready batch and returns the claim triple", async () => {
    // Seed a real intent + batch for the turn. Constructing the models first
    // creates the shared SqliteDb instance; ensureInitialized then completes it.
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(makeIntent("send_now"));
    const batch = await draftModel.createBatch(
      makeBatch({ intentDecisionId: intent.id, status: "draft_ready" })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id)
    );
    expect(result.allowed).toBe(true);
    expect(result.batchId).toBe(batch.id);
    expect(result.authorizationId).toBeTypeOf("number");
    expect(result.batchHash).toBe("a".repeat(64));

    // The batch advanced to direct_authorized (§8.1) — the status the claim
    // transaction requires.
    const reloaded = await draftModel.readBatch(batch.id);
    expect(reloaded?.status).toBe("direct_authorized");
  });

  it("blocks authorization_missing for a send_now turn with no authorizable batch", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(makeIntent("send_now"));
    // Only a TERMINAL batch exists for the turn — must not authorize.
    await draftModel.createBatch(
      makeBatch({ intentDecisionId: intent.id, status: "sent" })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id)
    );
    expect(result.allowed).toBe(false);
    // send_now intent + no authorizable batch → no authorization → the gate's
    // authorization_missing branch.
    expect(result.code).toBe("authorization_missing");
  });

  it("blocks review_required for a review_first intent even with a batch", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(makeIntent("review_first"));
    await draftModel.createBatch(
      makeBatch({ intentDecisionId: intent.id, status: "draft_ready" })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id)
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("review_required");
  });
});
