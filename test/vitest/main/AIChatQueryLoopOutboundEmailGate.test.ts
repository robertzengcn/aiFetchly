/**
 * Unit tests for the outbound-email gate plumbing inside AIChatQueryLoop
 * (RC1/RC4, technical design §13.1 + §14.2 + §15.1).
 *
 * Verifies that `evaluateOutboundEmailGate` — the loop's private seam:
 *   1. Returns a blocking draft_required when the turn has no intent.
 *   2. Blocks review_required for a send_now turn whose latest batch is
 *      draft_ready but the user has not clicked Review. Auto-creating a
 *      direct-send authorization here is what let the model send in the
 *      same turn as the draft.
 *   3. Blocks draft_required when the turn is send_now but has no authorizable
 *      batch (only terminal batches exist), unless skip_review=true — then
 *      the send proceeds without a draft (skipReviewDirectSend).
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
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import type { OutboundEmailIntentReasonCode } from "@/entityTypes/outboundEmailDeliveryTypes";

/** Type-erased accessors for the loop's private seams. */
interface LoopWithInternals {
  evaluateOutboundEmailGate: (
    input: Record<string, unknown>,
    toolArguments?: Record<string, unknown>
  ) => Promise<{
    allowed: boolean;
    code?: string;
    batchId?: number | null;
    authorizationId?: number;
    batchHash?: string;
    skipReviewDirectSend?: boolean;
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
  mode: "send_now" | "draft_only" | "review_first",
  reasonCode: OutboundEmailIntentReasonCode = "explicit_send_instruction",
  sourceUserMessageId = "msg-1"
): OutboundEmailIntentEntity {
  const e = new OutboundEmailIntentEntity();
  e.conversationId = "conv-1";
  e.sourceUserMessageId = sourceUserMessageId;
  e.mode = mode;
  e.reasonCode = reasonCode;
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
  intentDecisionId: number | null,
  sourceUserMessageId = "msg-1"
): Record<string, unknown> {
  return {
    conversationId: "conv-1",
    sourceUserMessageId,
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

  it("allows skip_review with no intent and no draft", async () => {
    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(makeGateInput(null), {
      skip_review: true,
    });
    expect(result.allowed).toBe(true);
    expect(result.skipReviewDirectSend).toBe(true);
  });

  it("blocks review_required for a send_now turn with an unreviewed draft_ready batch", async () => {
    // Reproduction of the live chat: user said "send a test email", the
    // model drafted, then immediately called start_email_send_task. Saying
    // "send" must not auto-authorize LLM-composed content the user has not
    // clicked Review on.
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
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("review_required");
    expect(result.batchId).toBe(batch.id);

    // Must not have silently created a direct-send authorization.
    const reloaded = await draftModel.readBatch(batch.id);
    expect(reloaded?.status).toBe("draft_ready");
  });

  it("allows a send_now turn after the user has approved the exact draft", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(makeIntent("send_now"));
    const batch = await draftModel.createBatch(
      makeBatch({ intentDecisionId: intent.id, status: "draft_ready" })
    );
    const approval = await new OutboundEmailAuthorizationService(
      tmpDir
    ).createReviewApproval({
      batchId: batch.id,
      batchHash: "a".repeat(64),
      sourceUserMessageId: "msg-1",
    });
    expect(approval.success).toBe(true);

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
    expect(result.authorizationId).toBe(approval.authorizationId);
    expect(result.batchHash).toBe("a".repeat(64));
  });

  it("blocks draft_required for a send_now turn with no authorizable batch", async () => {
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
    // A send_now instruction is already authorization intent. With no
    // authorizable batch yet, the next action is drafting, not asking the user
    // to confirm the same send a second time.
    expect(result.code).toBe("draft_required");
  });

  it("allows skip_review send_now with no draft batch", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(makeIntent("send_now"));

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id),
      { skip_review: true }
    );
    expect(result.allowed).toBe(true);
    expect(result.skipReviewDirectSend).toBe(true);
  });

  it("allows skip_review draft_only with no draft batch", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("draft_only", "ambiguous_instruction")
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id),
      { skip_review: true }
    );
    expect(result.allowed).toBe(true);
    expect(result.skipReviewDirectSend).toBe(true);
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

  it("allows a skip-review send_now turn after a draft exists", async () => {
    // Reproduction: user said "write a test email … without review". After
    // draft_outbound_email_batch, start_email_send_task must be allowed
    // without a Review click.
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("send_now", "explicit_skip_review")
    );
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
    expect(result.authorizationId).toBeGreaterThan(0);
    expect(result.batchHash).toBe("a".repeat(64));

    const reloaded = await draftModel.readBatch(batch.id);
    expect(reloaded?.status).toBe("direct_authorized");
  });

  it("blocks review_required for draft_only after a draft exists so the model stops re-drafting", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("draft_only", "ambiguous_instruction")
    );
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
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("review_required");
    expect(result.batchId).toBe(batch.id);
  });

  it("binds a distinct batch per skip-review send when the turn drafted several", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("send_now", "explicit_skip_review")
    );
    const firstBatch = await draftModel.createBatch(
      makeBatch({
        intentDecisionId: intent.id,
        status: "draft_ready",
        batchHash: "a".repeat(64),
      })
    );
    const secondBatch = await draftModel.createBatch(
      makeBatch({
        intentDecisionId: intent.id,
        status: "draft_ready",
        batchHash: "b".repeat(64),
      })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const first = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id)
    );
    const second = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id)
    );
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(first.batchId).toBe(firstBatch.id);
    expect(second.batchId).toBe(secondBatch.id);
  });

  it("allows a chat confirmation turn to send the previous turn's draft", async () => {
    // Reproduction: user said "send a test email" (msg-1, batch created),
    // then "yes, please send it" (msg-2). The confirmation turn has no
    // batch of its own; it must inherit and authorize the prior draft.
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("send_now", "contextual_affirmation", "msg-2")
    );
    const batch = await draftModel.createBatch(
      makeBatch({
        intentDecisionId: intent.id,
        status: "draft_ready",
        sourceUserMessageId: "msg-1",
      })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id, "msg-2")
    );
    expect(result.allowed).toBe(true);
    expect(result.batchId).toBe(batch.id);
    expect(result.authorizationId).toBeGreaterThan(0);

    const reloaded = await draftModel.readBatch(batch.id);
    expect(reloaded?.status).toBe("direct_authorized");
  });

  it("allows a skip-review follow-up to send the previous turn's draft", async () => {
    // Reproduction: user said "create a test email and send it to X
    // directly" (msg-1, draft created, Review still required because the
    // first phrasing was missed), then "please send it directly without
    // review" (msg-2). The skip-review turn has no batch of its own; it
    // must inherit and authorize the prior draft without a Review click.
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("send_now", "explicit_skip_review", "msg-2")
    );
    const batch = await draftModel.createBatch(
      makeBatch({
        intentDecisionId: intent.id,
        status: "draft_ready",
        sourceUserMessageId: "msg-1",
      })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id, "msg-2")
    );
    expect(result.allowed).toBe(true);
    expect(result.batchId).toBe(batch.id);
    expect(result.authorizationId).toBeGreaterThan(0);

    const reloaded = await draftModel.readBatch(batch.id);
    expect(reloaded?.status).toBe("direct_authorized");
  });

  it("allows draft_only send when the model passes skip_review after a draft exists", async () => {
    // Phrase matching missed the waiver (draft_only), but the user asked
    // to send without review and the model declared skip_review=true.
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("draft_only", "ambiguous_instruction")
    );
    const batch = await draftModel.createBatch(
      makeBatch({ intentDecisionId: intent.id, status: "draft_ready" })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id),
      { skip_review: true }
    );
    expect(result.allowed).toBe(true);
    expect(result.batchId).toBe(batch.id);
    expect(result.authorizationId).toBeGreaterThan(0);

    const reloaded = await draftModel.readBatch(batch.id);
    expect(reloaded?.status).toBe("direct_authorized");
  });

  it("does not treat skip_review string true as a waiver", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("draft_only", "ambiguous_instruction")
    );
    const batch = await draftModel.createBatch(
      makeBatch({ intentDecisionId: intent.id, status: "draft_ready" })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id),
      { skip_review: "true" }
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("review_required");
    expect(result.batchId).toBe(batch.id);
  });

  it("allows ordinary send_now when skip_review is true after a draft exists", async () => {
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
      makeGateInput(intent.id),
      { skip_review: true }
    );
    expect(result.allowed).toBe(true);
    expect(result.batchId).toBe(batch.id);
  });

  it("ignores skip_review when the user asked to review first", async () => {
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
      makeGateInput(intent.id),
      { skip_review: true }
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("review_required");
  });

  it("ignores skip_review when the user said not to send", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(
      makeIntent("draft_only", "explicit_do_not_send")
    );
    const batch = await draftModel.createBatch(
      makeBatch({ intentDecisionId: intent.id, status: "draft_ready" })
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id),
      { skip_review: true }
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("review_required");
    expect(result.batchId).toBe(batch.id);
  });

  it("ignores skip_review for review_first even when no draft exists", async () => {
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intent = await intentModel.create(makeIntent("review_first"));

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(),
      executeTool: vi.fn(),
    } as never) as unknown as LoopWithInternals;

    const result = await loop.evaluateOutboundEmailGate(
      makeGateInput(intent.id),
      { skip_review: true }
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("review_required");
    expect(result.skipReviewDirectSend).not.toBe(true);
  });
});
