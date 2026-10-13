// test/vitest/main/service/AIChatQueryLoopOperationGuard.test.ts
//
// T23d (audit line 337, §10.2): the TaskOperationGuard is wired at the send
// tool's ACTUAL dispatch site in the query loop. Locks the wiring contract:
//   1. Enrolled turn (binding.policyAccepted) + allowed gate + authorization
//      triple → prepareDispatch claims an operation row, the tool executes,
//      settleDispatch lands the receipt/outcome on the same row.
//   2. Blocked by the guard (already-confirmed receipt) → the tool does NOT
//      execute and the model sees an operationGuardBlocked tool result.
//   3. Lost send response (timedOut) → the row settles to `unknown`, never
//      terminal.
//   4. Not enrolled (no binding / policyAccepted=false) → byte-identical
//      legacy: the tool executes, NO operation row exists.
//   5. skip_review direct send (no authorization triple) → no guard, legacy.
//   6. A second dispatch of the same intent in a later turn is blocked by the
//      confirmed receipt (recurring authorized repeats reuse the receipt).
// The store is the REAL AiTaskOperationModule against a temp SQLite database
// (the same Token/USERSDBPATH pattern the outbound-gate tests use), so the
// test holds for the production model CAS machine, not a fake.
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
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

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-loop-op-guard-${crypto.randomUUID()}`
);

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
  USERSERVICE: "user_service",
}));

import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { guardOperationKey } from "@/service/aiTaskExecution/TaskOperationGuard";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";
import type { AIChatQueryEvent } from "@/service/AIChatQueryEvents";
import type { LoopTaskExecutionBinding } from "@/service/aiTaskExecution/TaskLoopConsult";
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatMessage,
  OpenAITool,
} from "@/api/aiChatApi";

const CONVERSATION_ID = "conv-op-guard";

/** One tool round: model calls the send tool, then the turn stops. */
function makeSendStream(sendArgs: Record<string, unknown>) {
  let round = 0;
  return vi.fn(
    async (
      _req: OpenAIChatCompletionRequest,
      onChunk: (c: OpenAIChatCompletionChunk) => void
    ) => {
      round += 1;
      if (round === 1) {
        onChunk({
          id: "r1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_send_1",
                    type: "function",
                    function: {
                      name: "start_email_send_task",
                      arguments: JSON.stringify(sendArgs),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        } as unknown as OpenAIChatCompletionChunk);
        onChunk({
          id: "r1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [
            { index: 0, delta: {}, finish_reason: "tool_calls" },
          ],
        } as unknown as OpenAIChatCompletionChunk);
        return;
      }
      onChunk({
        id: "r2",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            delta: { content: "done", role: "assistant" },
            finish_reason: "stop",
          },
        ],
      } as unknown as OpenAIChatCompletionChunk);
    }
  );
}

const SEND_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: "start_email_send_task",
    description: "send",
    parameters: { type: "object", properties: {} },
  },
};

const SEND_ARGS: Record<string, unknown> = {
  service_ids: [3],
  email_search_task_id: 42,
  emails: ["victim@example.com"],
  email_subject: "Hi",
  email_content: "Body",
};

function makeInput(opts: {
  binding?: LoopTaskExecutionBinding;
  intentDecisionId?: number | null;
}): { input: Parameters<AIChatQueryLoop["run"]>[0]; events: AIChatQueryEvent[] } {
  const events: AIChatQueryEvent[] = [];
  const messages: OpenAIChatMessage[] = [
    { role: "system", content: "you are helpful" },
    { role: "user", content: "send the emails" },
  ];
  const input = {
    conversationId: CONVERSATION_ID,
    assistantMessageId: "asst-op-guard",
    messages,
    request: {
      message: "send the emails",
      model: "test-model",
      conversationId: CONVERSATION_ID,
    },
    openAITools: [SEND_TOOL],
    abortController: new AbortController(),
    eventSink: { emit: (e: AIChatQueryEvent) => events.push(e) },
    startRound: 0,
    isActiveTurn: () => true,
    sourceUserMessageId: "msg-op-guard",
    intentDecisionId: opts.intentDecisionId ?? null,
    taskExecutionBinding: opts.binding,
    // The test's send tool resolves timeoutClass "fast" via the mocked
    // registry lookup returning undefined → name inference... but the mocked
    // ToolTimeoutPolicy maps everything to "fast", so the send dispatch takes
    // the FOREGROUND path and resolves within the run.
    skillRegistry: {
      getSkill: () => undefined,
    },
  } as Parameters<AIChatQueryLoop["run"]>[0];
  return { input, events };
}

/** Minimal enrolled binding — the guard only reads executionId + policyAccepted. */
function makeBinding(executionId = "exec-op-guard"): LoopTaskExecutionBinding {
  return {
    executionId,
    policyAccepted: true,
    reserveContinuation: () => BudgetReservationResult.Reserved,
    reserveProviderAttempt: () => BudgetReservationResult.Reserved,
    reserveToolExecution: () => BudgetReservationResult.Reserved,
    reconcileTokens: () => true,
    addActiveRuntime: () => undefined,
    persistBudget: async () => true,
    consult: async () => ({
      type: "finish_response",
      result: "response_ended",
    }),
    recordDecision: () => undefined,
    recordToolRoundProgress: () => undefined,
    recordAssistantTextProgress: () => undefined,
  };
}

function makeLoop(
  executeTool: ReturnType<typeof vi.fn>
): AIChatQueryLoop {
  return new AIChatQueryLoop({
    streamChatCompletion: makeSendStream(SEND_ARGS),
    executeTool,
    getSkillDefinition: () => undefined,
  } as never);
}

function resetDb(): void {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
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

/**
 * The loop evaluates the outbound gate BEFORE the guard. Seed a send_now
 * intent + draft_ready batch + review approval so the gate allows and hands
 * the loop a real authorization triple (batchId etc.) — exactly the trusted
 * context §10.2 requires the guard's domain target to come from. Returns
 * the intent id too: the gate resolves the turn's intent from
 * input.intentDecisionId, so every gate-dependent test must thread it.
 */
async function seedAllowedGate(): Promise<{
  batchId: number;
  intentId: number;
}> {
  const { OutboundEmailIntentModel } = await import(
    "@/model/OutboundEmailIntent.model"
  );
  const { OutboundEmailDraftModel } = await import(
    "@/model/OutboundEmailDraft.model"
  );
  const { OutboundEmailAuthorizationService } = await import(
    "@/service/outboundEmail/OutboundEmailAuthorizationService"
  );
  const { OutboundEmailIntentEntity } = await import(
    "@/entity/OutboundEmailIntent.entity"
  );
  const { OutboundEmailDraftBatchEntity } = await import(
    "@/entity/OutboundEmailDraftBatch.entity"
  );
  // Construct the models FIRST — their constructors call SqliteDb.getInstance
  // (the same ordering the outbound-gate tests use); ensureInitialized after.
  const intentModel = new OutboundEmailIntentModel(tmpDir);
  const draftModel = new OutboundEmailDraftModel(tmpDir);
  await SqliteDb.ensureInitialized();

  const intentEntity = new OutboundEmailIntentEntity();
  intentEntity.conversationId = CONVERSATION_ID;
  intentEntity.sourceUserMessageId = "msg-op-guard";
  intentEntity.mode = "send_now";
  intentEntity.reasonCode = "explicit_send_instruction";
  intentEntity.confidence = 1;
  intentEntity.evidenceJson = "[]";
  intentEntity.sourceTextHash = "a".repeat(64);
  intentEntity.resolverVersion = "outbound-resolver-v1";
  intentEntity.previousAssistantMessageId = null;
  const intent = await intentModel.create(intentEntity);

  const batchEntity = new OutboundEmailDraftBatchEntity();
  batchEntity.conversationId = CONVERSATION_ID;
  batchEntity.sourceUserMessageId = "msg-op-guard";
  batchEntity.intentDecisionId = intent.id;
  batchEntity.status = "draft_ready";
  batchEntity.recipientSourceType = "direct";
  batchEntity.recipientCount = 1;
  batchEntity.validRecipientCount = 1;
  batchEntity.emailServiceIdsJson = "[3]";
  batchEntity.batchHash = "b".repeat(64);
  const batch = await draftModel.createBatch(batchEntity);

  const approval = await new OutboundEmailAuthorizationService(
    tmpDir
  ).createReviewApproval({
    batchId: batch.id,
    batchHash: "b".repeat(64),
    sourceUserMessageId: "msg-op-guard",
  });
  expect(approval.success).toBe(true);
  return { batchId: batch.id, intentId: intent.id };
}

async function readOperationRow(operationKey: string) {
  const mod = new AiTaskOperationModule();
  return mod.getOperation(operationKey);
}

describe("AIChatQueryLoop T23d operation guard wiring (§10.2)", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  it("claims + settles a confirmed send when enrolled and allowed", async () => {
    const { batchId, intentId } = await seedAllowedGate();
    const executeTool = vi.fn().mockResolvedValue({
      tool_call_id: "call_send_1",
      tool_name: "start_email_send_task",
      success: true,
      result: {
        status: "claimed",
        send_attempt_id: "77",
        batch_id: batchId,
      },
      execution_time_ms: 5,
    });
    const loop = makeLoop(executeTool);
    const { input } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intentId,
    });

    await loop.run(input);

    // The tool actually dispatched.
    expect(executeTool).toHaveBeenCalledTimes(1);
    const row = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(row).not.toBeNull();
    expect(row?.operation_state).toBe("accepted");
    expect(row?.receipt_reference).toBe("attempt:77");
    expect(row?.tool_identity).toBe("start_email_send_task");
    expect(row?.domain_target).toBe(`outbound_batch:${batchId}`);
  });

  it("settles to unknown on a lost send response (timedOut) — never terminal", async () => {
    const { batchId, intentId } = await seedAllowedGate();
    // A foreground timeout result (executeForegroundToolWithTimeout shape):
    // the dispatch left the process but no receipt ever arrived.
    const executeTool = vi.fn().mockResolvedValue({
      tool_call_id: "call_send_1",
      tool_name: "start_email_send_task",
      success: false,
      result: {
        error: 'Tool "start_email_send_task" timed out after 5000ms.',
        timedOut: true,
      },
      execution_time_ms: 5000,
    });
    const loop = makeLoop(executeTool);
    const { input } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intentId,
    });

    await loop.run(input);

    const row = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(row?.operation_state).toBe("unknown");
    // §10.2: unknown is NOT terminal — settled_at must be null.
    expect(row?.settled_at).toBeNull();
  });

  it("blocks the second dispatch of a confirmed intent (receipt reuse, no re-send)", async () => {
    const { batchId, intentId } = await seedAllowedGate();
    const executeTool = vi.fn().mockResolvedValue({
      tool_call_id: "call_send_1",
      tool_name: "start_email_send_task",
      success: true,
      result: { status: "claimed", send_attempt_id: "77" },
      execution_time_ms: 5,
    });
    const { input, events } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intentId,
    });
    // Turn 1: the send dispatches and confirms (accepted + receipt).
    const loop1 = new AIChatQueryLoop({
      streamChatCompletion: makeSendStream(SEND_ARGS),
      executeTool,
      getSkillDefinition: () => undefined,
    } as never);
    await loop1.run(input);

    // A second turn in the SAME execution asks for the same send again.
    const stream2 = makeSendStream(SEND_ARGS);
    const loop2 = new AIChatQueryLoop({
      streamChatCompletion: stream2,
      executeTool,
      getSkillDefinition: () => undefined,
    } as never);
    const secondInput = {
      ...input,
      assistantMessageId: "asst-op-guard-2",
    };
    await loop2.run(secondInput);

    // The guard blocked the replay: executeTool was called exactly ONCE
    // across both turns.
    expect(executeTool).toHaveBeenCalledTimes(1);
    const blocked = events.find(
      (e) =>
        e.type === "tool_result" &&
        (e.toolResult as Record<string, unknown> | undefined)
          ?.operationGuardBlocked === true
    );
    expect(blocked).toBeDefined();
    const row = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(row?.operation_state).toBe("accepted");
  });

  it("does not create an operation row when the turn is not enrolled (legacy byte-identical)", async () => {
    const { batchId, intentId } = await seedAllowedGate();
    const executeTool = vi.fn().mockResolvedValue({
      tool_call_id: "call_send_1",
      tool_name: "start_email_send_task",
      success: true,
      result: { status: "claimed", send_attempt_id: "77" },
      execution_time_ms: 5,
    });
    const loop = makeLoop(executeTool);
    // No binding at all — the pre-policy legacy path. The gate still needs
    // the intent (its allowed decision is independent of the guard).
    const { input } = makeInput({ intentDecisionId: intentId });

    await loop.run(input);

    expect(executeTool).toHaveBeenCalledTimes(1);
    const row = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(row).toBeNull();
  });

  it("does not create an operation row when policyAccepted is false on the binding", async () => {
    const { batchId, intentId } = await seedAllowedGate();
    const executeTool = vi.fn().mockResolvedValue({
      tool_call_id: "call_send_1",
      tool_name: "start_email_send_task",
      success: true,
      result: { status: "claimed", send_attempt_id: "77" },
      execution_time_ms: 5,
    });
    const loop = makeLoop(executeTool);
    const { input } = makeInput({
      binding: { ...makeBinding(), policyAccepted: false },
      intentDecisionId: intentId,
    });

    await loop.run(input);

    expect(executeTool).toHaveBeenCalledTimes(1);
    const row = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(row).toBeNull();
  });

  it("fences a skip_review direct send with a direct-send operation row (D4)", async () => {
    // D4 review fix: a skip_review direct send previously bypassed the
    // durable fence entirely (no authorization triple → no guard). The send
    // proceeds via the legacy claim path (no batch), but the guard now runs
    // with a direct-send descriptor whose domain target derives from the
    // trusted loop input's source user message id.
    const { OutboundEmailIntentModel } = await import(
      "@/model/OutboundEmailIntent.model"
    );
    const { OutboundEmailIntentEntity } = await import(
      "@/entity/OutboundEmailIntent.entity"
    );
    // Construct the model FIRST (its constructor calls SqliteDb.getInstance);
    // ensureInitialized after — same ordering as seedAllowedGate.
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intentEntity = new OutboundEmailIntentEntity();
    intentEntity.conversationId = CONVERSATION_ID;
    intentEntity.sourceUserMessageId = "msg-op-guard";
    intentEntity.mode = "draft_only";
    intentEntity.reasonCode = "explicit_do_not_send";
    intentEntity.confidence = 1;
    intentEntity.evidenceJson = "[]";
    intentEntity.sourceTextHash = "a".repeat(64);
    intentEntity.resolverVersion = "outbound-resolver-v1";
    intentEntity.previousAssistantMessageId = null;
    const intent = await intentModel.create(intentEntity);

    const executeTool = vi.fn().mockResolvedValue({
      tool_call_id: "call_send_1",
      tool_name: "start_email_send_task",
      success: true,
      result: { status: "completed", task_id: 9 },
      execution_time_ms: 5,
    });
    const stream = makeSendStream({
      ...SEND_ARGS,
      skip_review: true,
    });
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool,
      getSkillDefinition: () => undefined,
    } as never);
    const { input } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intent.id,
    });
    (input as { outboundSendPreAuthorized?: boolean }).outboundSendPreAuthorized =
      true;

    await loop.run(input);

    // The direct send executed AND left a durable operation row keyed on the
    // direct-send target (source user message id), settled to the §10.2
    // uncertainty state — the tool returned an unrecognized success status
    // (completed on a start-tool is not a native claim receipt).
    expect(executeTool).toHaveBeenCalledTimes(1);
    const mod = new AiTaskOperationModule();
    const directRow = await mod.getOperation(
      guardOperationKey("exec-op-guard", "outbound_direct:msg-op-guard")
    );
    expect(directRow).not.toBeNull();
    expect(directRow?.operation_state).toBe("unknown");
    // Unresolved for this intent — a second dispatch is fenced.
    const rows = await mod.findUnresolvedByIntent({
      toolIdentity: "start_email_send_task",
      domainTarget: "outbound_direct:msg-op-guard",
      intentHash: "sha256:any",
    });
    expect(rows).toHaveLength(1);
  });

  it("blocks a duplicate skip_review direct send via the durable fence (D4)", async () => {
    // The fence exists so a crash/retry loop cannot silently re-run an
    // unattended send whose outcome was never observed. Reuse the same turn
    // identity: the second dispatch of the same intent is blocked by the
    // unknown-outcome row the first one left.
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: guardOperationKey(
        "exec-op-guard",
        "outbound_direct:msg-op-guard"
      ),
      executionId: "exec-op-guard",
      toolIdentity: "start_email_send_task",
      domainTarget: "outbound_direct:msg-op-guard",
      intentHash: "sha256:any",
    });
    await mod.updateState({
      operationKey: guardOperationKey(
        "exec-op-guard",
        "outbound_direct:msg-op-guard"
      ),
      expectedClaimGeneration: 0,
      newState: "claimed",
    });

    const { OutboundEmailIntentModel } = await import(
      "@/model/OutboundEmailIntent.model"
    );
    const { OutboundEmailIntentEntity } = await import(
      "@/entity/OutboundEmailIntent.entity"
    );
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const intentEntity = new OutboundEmailIntentEntity();
    intentEntity.conversationId = CONVERSATION_ID;
    intentEntity.sourceUserMessageId = "msg-op-guard";
    intentEntity.mode = "draft_only";
    intentEntity.reasonCode = "explicit_do_not_send";
    intentEntity.confidence = 1;
    intentEntity.evidenceJson = "[]";
    intentEntity.sourceTextHash = "a".repeat(64);
    intentEntity.resolverVersion = "outbound-resolver-v1";
    intentEntity.previousAssistantMessageId = null;
    const intent = await intentModel.create(intentEntity);

    const executeTool = vi.fn();
    const stream = makeSendStream({
      ...SEND_ARGS,
      skip_review: true,
    });
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool,
      getSkillDefinition: () => undefined,
    } as never);
    const { input } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intent.id,
    });
    (input as { outboundSendPreAuthorized?: boolean }).outboundSendPreAuthorized =
      true;

    await loop.run(input);

    // The send must NOT have executed — the unknown-outcome fence blocks it.
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("settles a definitive claim failure to no_effect (failed) with a failure code", async () => {
    const { batchId, intentId } = await seedAllowedGate();
    const executeTool = vi.fn().mockResolvedValue({
      tool_call_id: "call_send_1",
      tool_name: "start_email_send_task",
      success: false,
      result: {
        status: "claim_failed",
        batch_id: batchId,
        error: "claim rejected",
      },
      execution_time_ms: 5,
    });
    const loop = makeLoop(executeTool);
    const { input } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intentId,
    });

    await loop.run(input);

    const row = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(row?.operation_state).toBe("failed");
    expect(row?.failure_code).toBe("CLAIM_FAILED");
    // Evidenced no-effect: a retry occurrence is permitted next time.
  });

  it("permits an explicit Retry after an evidenced no-effect failure (fresh occurrence)", async () => {
    const { batchId, intentId } = await seedAllowedGate();
    let attempt = 0;
    const executeTool = vi.fn().mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          tool_call_id: "call_send_1",
          tool_name: "start_email_send_task",
          success: false,
          result: { status: "claim_failed", batch_id: batchId },
          execution_time_ms: 5,
        };
      }
      return {
        tool_call_id: "call_send_2",
        tool_name: "start_email_send_task",
        success: true,
        result: { status: "claimed", send_attempt_id: "78" },
        execution_time_ms: 5,
      };
    });

    // Turn 1: claim fails (evidenced no-effect).
    const loop1 = new AIChatQueryLoop({
      streamChatCompletion: makeSendStream(SEND_ARGS),
      executeTool,
      getSkillDefinition: () => undefined,
    } as never);
    const { input: input1 } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intentId,
    });
    await loop1.run(input1);
    const failedRow = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(failedRow?.operation_state).toBe("failed");

    // Turn 2: explicit Retry — the guard derives a NEW occurrence from the
    // store and dispatches.
    const loop2 = new AIChatQueryLoop({
      streamChatCompletion: makeSendStream(SEND_ARGS),
      executeTool,
      getSkillDefinition: () => undefined,
    } as never);
    const { input: input2 } = makeInput({
      binding: makeBinding(),
      intentDecisionId: intentId,
    });
    await loop2.run(input2);

    expect(executeTool).toHaveBeenCalledTimes(2);
    const occurrenceRow = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}#occ1`)
    );
    expect(occurrenceRow?.operation_state).toBe("accepted");
    expect(occurrenceRow?.receipt_reference).toBe("attempt:78");
    // The failed receipt row is preserved as evidence.
    const receiptRow = await readOperationRow(
      guardOperationKey("exec-op-guard", `outbound_batch:${batchId}`)
    );
    expect(receiptRow?.operation_state).toBe("failed");
  });
});
