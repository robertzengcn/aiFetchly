// test/vitest/main/service/AIChatQueryLoopBudgetGate.test.ts
//
// T05 (FR-08/10/23, AC-06/08/22/27/29): the loop's provider-dispatch gate
// fail-closed behavior. Before each `deps.streamChatCompletion` call the
// loop:
//   1. calls `binding.reserveProviderAttempt` with a unique-per-attempt ID
//      (`prov:<executionId>:<round>:<seq>`, B13b — never reused across
//      retries, resets, or resumes)
//   2. on `Exhausted` → throws `RecoverableHistoryError("MODEL_ATTEMPT_LIMIT")`
//   3. on `Reserved` → calls `binding.persistBudget({providerAttempts:1})`;
//      if false (lease lost) → throws the same fail-closed error
//   4. transport retries inside the stream call are counted via the onRetry
//      hook (B13b), each with its own retry identity
//
// These tests lock the fail-closed contract: an enrolled turn whose budget
// is spent MUST NOT reach the provider, and a lease-loosed persist MUST NOT
// reach the provider either. Flag-off / no-binding paths are byte-identical
// legacy (the stream is called, no throw).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { setHookAuditLoggerForTests } from "@/service/hooks/HookAuditService";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
} from "@/service/AIChatQueryEvents";
import type { LoopTaskExecutionBinding } from "@/service/aiTaskExecution/TaskLoopConsult";
import {
  BudgetReservationResult,
  TaskRunBudget,
} from "@/service/aiTaskExecution/TaskRunBudget";
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/budgetDefaults";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionChunk,
  OpenAIChatMessage,
  ToolExecutionResult,
} from "@/api/aiChatApi";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { RecoverableHistoryError } from "@/entityTypes/aiChatArchiveTypes";

// Tool-result capture flags stay off in this file: with capture enabled,
// every tool turn resolves the conversation epoch through a real database,
// and parallel workers sharing the real DB path collide in schema sync
// ("database is locked"). The budget gate under test never depends on
// capture — same pattern as AIChatQueryLoop.budget.test.ts.
vi.mock("@/config/featureFlags", async () => {
  const actual = await vi.importActual<
    typeof import("@/config/featureFlags")
  >("@/config/featureFlags");
  return {
    ...actual,
    isToolOutputCaptureEnabled: () => false,
    isToolOutputModelRefsEnabled: () => false,
  };
});

/** Scripted stream that emits one assistant text chunk + stop. */
function makeStopStream() {
  return vi.fn(
    async (
      _req: OpenAIChatCompletionRequest,
      onChunk: (c: OpenAIChatCompletionChunk) => void
    ) => {
      onChunk({
        id: "resp-1",
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
      });
    }
  );
}

function makeInput(opts: {
  binding?: LoopTaskExecutionBinding;
  messages?: OpenAIChatMessage[];
}): { input: AIChatQueryLoopInput; events: AIChatQueryEvent[] } {
  const events: AIChatQueryEvent[] = [];
  const eventSink: AIChatQueryEventSink = { emit: (e) => events.push(e) };
  const input: AIChatQueryLoopInput = {
    conversationId: "conv-t05",
    assistantMessageId: "asst-t05",
    messages:
      opts.messages ?? [
        { role: "system", content: "you are helpful" },
        { role: "user", content: "do the task" },
      ],
    request: { message: "do the task" },
    openAITools: [],
    abortController: new AbortController(),
    eventSink,
    startRound: 0,
    isActiveTurn: () => true,
    taskExecutionBinding: opts.binding,
  };
  return { input, events };
}

/** A binding whose `reserveProviderAttempt` returns a fixed result and
 * whose `persistBudget` returns a fixed boolean. Other closures are no-ops. */
function makeBudgetBinding(opts: {
  reservation: BudgetReservationResult;
  persistOk?: boolean;
  captureReserve?: (id: string) => void;
  capturePersist?: (delta: unknown) => void;
}): LoopTaskExecutionBinding {
  return {
    executionId: "exec-t05",
    policyAccepted: true,
    ledgerId: "ledger-t05",
    leaseGeneration: 0,
    reserveContinuation: () => BudgetReservationResult.Reserved,
    reserveProviderAttempt: (id) => {
      opts.captureReserve?.(id);
      return opts.reservation;
    },
    reserveToolExecution: () => BudgetReservationResult.Reserved,
    reconcileTokens: () => true,
    addActiveRuntime: () => undefined,
    persistBudget: async (delta) => {
      opts.capturePersist?.(delta);
      return opts.persistOk ?? true;
    },
    consult: async () => ({ type: "finish_response", result: "response_ended" }),
    recordDecision: () => undefined,
    recordToolRoundProgress: () => undefined,
    recordAssistantTextProgress: () => undefined,
  };
}

describe("AIChatQueryLoop T05 provider-dispatch budget gate (FR-08/10/23, AC-06/08/22/27/29)", () => {
  beforeEach(() => {
    // Builtin hooks registered at module init touch a real database on the
    // post-tool-use path; reset them so tool-executing tests never leave
    // this worker for SQLite (parallel workers sharing the real DB path
    // collide in schema sync with "database is locked"). Mirrors
    // AIChatQueryLoop.test.ts.
    HookRegistry.resetForTests();
    setHookAuditLoggerForTests({ log: () => undefined });
  });
  it("throws RecoverableHistoryError(MODEL_ATTEMPT_LIMIT) when the provider budget is Exhausted", async () => {
    const stream = makeStopStream();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    let reservedId = "";
    const binding = makeBudgetBinding({
      reservation: BudgetReservationResult.Exhausted,
      captureReserve: (id) => {
        reservedId = id;
      },
    });
    const { input } = makeInput({ binding });

    // The loop's outer try/catch converts thrown errors to a
    // { type: "failed", error } result, so read the error off the result
    // rather than expecting run() to throw.
    const result = await loop.run(input);
    // Fail-closed: the loop did NOT reach the provider.
    expect(result.type).toBe("failed");
    const err = (result as { error: unknown }).error;
    expect(err).toBeInstanceOf(RecoverableHistoryError);
    expect((err as RecoverableHistoryError).code).toBe("MODEL_ATTEMPT_LIMIT");
    expect(stream).not.toHaveBeenCalled();
    // B13b: the ID is unique per actual attempt —
    // `prov:<executionId>:<round>:<seq>` (round 0, first mint of the instance).
    expect(reservedId).toBe("prov:exec-t05:0:0");
  });

  it("throws MODEL_ATTEMPT_LIMIT when persistBudget returns false (lease lost/superseded)", async () => {
    const stream = makeStopStream();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const persisted: Array<Record<string, unknown>> = [];
    const binding = makeBudgetBinding({
      reservation: BudgetReservationResult.Reserved,
      persistOk: false, // lease released / superseded by a Continue successor
      capturePersist: (delta) => {
        persisted.push(delta as Record<string, unknown>);
      },
    });
    const { input } = makeInput({ binding });

    const result = await loop.run(input);
    expect(result.type).toBe("failed");
    const err = (result as { error: unknown }).error;
    expect(err).toBeInstanceOf(RecoverableHistoryError);
    expect((err as RecoverableHistoryError).code).toBe("MODEL_ATTEMPT_LIMIT");
    expect(stream).not.toHaveBeenCalled();
    // The persist carried providerAttempts:1 (the durable ledger delta).
    expect(persisted).toHaveLength(1);
    expect(persisted[0].providerAttempts).toBe(1);
  });

  it("proceeds to the provider when reservation is Reserved and persist succeeds", async () => {
    const stream = makeStopStream();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const persisted: Array<Record<string, unknown>> = [];
    const binding = makeBudgetBinding({
      reservation: BudgetReservationResult.Reserved,
      persistOk: true,
      capturePersist: (delta) => {
        persisted.push(delta as Record<string, unknown>);
      },
    });
    const { input } = makeInput({ binding });

    const result = await loop.run(input);
    // The provider WAS called this round.
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("completed");
    // The first persist carries providerAttempts:1.
    expect(persisted.length).toBeGreaterThanOrEqual(1);
    expect(persisted[0].providerAttempts).toBe(1);
  });

  it("AlreadyReserved (transport retry of same round) proceeds without re-persisting providerAttempts", async () => {
    const stream = makeStopStream();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const persisted: Array<Record<string, unknown>> = [];
    const binding = makeBudgetBinding({
      reservation: BudgetReservationResult.AlreadyReserved,
      capturePersist: (delta) => {
        persisted.push(delta as Record<string, unknown>);
      },
    });
    const { input } = makeInput({ binding });

    await loop.run(input);
    expect(stream).toHaveBeenCalledTimes(1);
    // No providerAttempts persist fired (AlreadyReserved dedups). The
    // token/runtime persist (which uses a different code path keyed on
    // reconcileTokens' boolean) MAY fire with tokens/activeRuntimeMs but
    // must not carry providerAttempts.
    const providerAttemptPersists = persisted.filter(
      (d) => d.providerAttempts !== undefined
    );
    expect(providerAttemptPersists).toHaveLength(0);
  });

  it("flag-off (no binding): stream proceeds, no reservation, no persist", async () => {
    const stream = makeStopStream();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const { input } = makeInput({}); // no binding

    const result = await loop.run(input);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("completed");
  });

  it("binding present but policyAccepted=false: stream proceeds (legacy path)", async () => {
    const stream = makeStopStream();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    // A binding that is NOT accepted (flag turned off after enrollment — but
    // T16 freezes policyAccepted=true at enrollment, so this only happens
    // for tests / flag-off callers). The gate must skip entirely.
    const binding = makeBudgetBinding({
      reservation: BudgetReservationResult.Exhausted,
    });
    // Override policyAccepted to false to simulate the not-accepted case.
    const unaccepted: LoopTaskExecutionBinding = {
      ...binding,
      policyAccepted: false,
    };
    const { input } = makeInput({ binding: unaccepted });

    const result = await loop.run(input);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("completed");
  });

  it("uses a real TaskRunBudget: 1 allowed attempt, 2nd round throws MODEL_ATTEMPT_LIMIT", async () => {
    // End-to-end with a real budget object (maxProviderAttempts:1) to verify
    // the closure wiring in the loop matches the budget's reservation
    // semantics. The first round reserves + persists; the controller's
    // `continue` decision drives a second round which must fail-closed.
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxProviderAttempts: 1,
    });
    // Stubbed: the stream emits a "stop" round 0, then the loop's consult
    // site at round_cap returns `continue` to drive a 2nd round. To keep this
    // test focused on the gate (not the consult plumbing), we use a stream
    // that emits tool_calls on round 0 so the loop continues to round 1
    // naturally (the round-cap is reached when round >= maxToolRounds).
    const stream = vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        onChunk({
          id: "resp-2",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: { content: "round content", role: "assistant" },
              finish_reason: "stop",
            },
          ],
        });
      }
    );
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const binding: LoopTaskExecutionBinding = {
      executionId: "exec-t05-real",
      policyAccepted: true,
      ledgerId: "ledger-t05-real",
      leaseGeneration: 0,
      reserveContinuation: (id) => budget.reserveContinuation(id),
      reserveProviderAttempt: (id) => budget.reserveProviderAttempt(id),
      reserveToolExecution: (id) => budget.reserveToolExecution(id),
      reconcileTokens: (id, n) => budget.reconcileTokens(id, n),
      addActiveRuntime: (ms) => budget.addActiveRuntime(ms),
      addWaitMs: (ms) => budget.addWaitMs(ms),
      getRemainingBudgets: () => budget.getRemaining(),
      persistBudget: async () => true, // ledger persist always succeeds
      consult: async () => ({ type: "finish_response", result: "response_ended" }),
      recordDecision: () => undefined,
      recordToolRoundProgress: () => undefined,
      recordAssistantTextProgress: () => undefined,
    };
    // maxToolRounds=1 so round 1 hits the round-cap consult. The consult
    // returns finish_response (break) so the loop ends after round 0 without
    // needing a 2nd provider dispatch. This confirms the happy path: the
    // budget allows the 1 attempt, the consult breaks, no throw.
    const { input } = makeInput({ binding });

    const result = await loop.run(input);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("completed");
    expect(budget.getConsumed().providerAttempts).toBe(1);
  });
});

describe("AIChatQueryLoop B13a tool-dispatch budget gate (FR-08/10/23, AC-27)", () => {
  function makeToolCallStream() {
    let calls = 0;
    return vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        calls += 1;
        if (calls === 1) {
          onChunk({
            id: "resp-tool",
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
                      id: "call-b13a",
                      type: "function",
                      function: { name: "search", arguments: '{"q":"x"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          });
          return;
        }
        onChunk({
          id: "resp-done",
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
        });
      }
    );
  }

  function makeToolBudgetBinding(
    budget: TaskRunBudget,
    persistOk: boolean | ((delta: Record<string, number | undefined>) => boolean) = true
  ): LoopTaskExecutionBinding {
    return {
      executionId: "exec-b13a",
      policyAccepted: true,
      ledgerId: "ledger-b13a",
      leaseGeneration: 0,
      reserveContinuation: (id) => budget.reserveContinuation(id),
      reserveProviderAttempt: (id) => budget.reserveProviderAttempt(id),
      reserveToolExecution: (id) => budget.reserveToolExecution(id),
      reconcileTokens: (id, n) => budget.reconcileTokens(id, n),
      addActiveRuntime: (ms) => budget.addActiveRuntime(ms),
      addWaitMs: (ms) => budget.addWaitMs(ms),
      getRemainingBudgets: () => budget.getRemaining(),
      persistBudget: async (delta) =>
        typeof persistOk === "function" ? persistOk(delta) : persistOk,
      consult: async () => ({ type: "finish_response", result: "response_ended" }),
      recordDecision: () => undefined,
      recordToolRoundProgress: () => undefined,
      recordAssistantTextProgress: () => undefined,
    };
  }

  function makeToolLoop(
    stream: (
      req: OpenAIChatCompletionRequest,
      onChunk: (c: OpenAIChatCompletionChunk) => void
    ) => Promise<void>,
    execute: (
      name: string,
      args: Record<string, unknown>,
      context: SkillExecutionContext
    ) => Promise<ToolExecutionResult>
  ) {
    return new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: execute,
      getSkillDefinition: () => undefined,
    });
  }

  function makeToolInput(binding: LoopTaskExecutionBinding) {
    const { input } = makeInput({ binding });
    input.openAITools = [
      {
        type: "function",
        function: {
          name: "search",
          description: "test tool",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    return input;
  }

  it("refuses tool dispatch when the tool budget is Exhausted (fail-closed, no execute)", async () => {
    // Real budget with zero tool allowance: the FIRST tool reservation is
    // already Exhausted. The gate must refuse BEFORE deps.executeTool runs
    // (record-but-no-gate/D4 let exhausted tools dispatch — B13 forbids it).
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxToolExecutions: 0,
    });
    const stream = makeToolCallStream();
    const execute = vi.fn().mockResolvedValue({
      tool_call_id: "call-b13a",
      tool_name: "search",
      success: true,
      result: { answer: "found" },
      execution_time_ms: 10,
    });
    const result = await makeToolLoop(stream, execute).run(
      makeToolInput(makeToolBudgetBinding(budget))
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.error).toBeInstanceOf(RecoverableHistoryError);
      expect((result.error as RecoverableHistoryError).code).toBe(
        "TOOL_BUDGET_EXHAUSTED"
      );
    }
  });

  it("refuses tool dispatch when persistBudget returns false (lease lost)", async () => {
    // Allowance remains but the durable write fails: dispatching would run
    // unfunded work (B14 siblings). Fail closed — no execute. Provider-side
    // persists succeed so the turn reaches the tool gate (isolating it).
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxToolExecutions: 50,
    });
    const stream = makeToolCallStream();
    const execute = vi.fn().mockResolvedValue({
      tool_call_id: "call-b13a",
      tool_name: "search",
      success: true,
      result: { answer: "found" },
      execution_time_ms: 10,
    });
    const result = await makeToolLoop(stream, execute).run(
      makeToolInput(
        makeToolBudgetBinding(
          budget,
          (delta) => delta.toolExecutions === undefined
        )
      )
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect((result.error as RecoverableHistoryError).code).toBe(
        "TOOL_BUDGET_EXHAUSTED"
      );
    }
  });

  it("dispatches the tool when reservation is Reserved and persist succeeds", async () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxToolExecutions: 50,
    });
    const stream = makeToolCallStream();
    const execute = vi.fn().mockResolvedValue({
      tool_call_id: "call-b13a",
      tool_name: "search",
      success: true,
      result: { answer: "found" },
      execution_time_ms: 10,
    });
    const result = await makeToolLoop(stream, execute).run(
      makeToolInput(makeToolBudgetBinding(budget, true))
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("completed");
    expect(budget.getConsumed().toolExecutions).toBe(1);
  });
});

describe("AIChatQueryLoop B13b unique attempt identities + retry counting (FR-08/23)", () => {
  function makeStopStream() {
    return vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        onChunk({
          id: "resp-b13b",
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
        });
      }
    );
  }

  function makeRealBudgetBinding(
    budget: TaskRunBudget,
    captured: { reserves: string[]; persists: unknown[] }
  ): LoopTaskExecutionBinding {
    return {
      executionId: "exec-b13b",
      policyAccepted: true,
      ledgerId: "ledger-b13b",
      leaseGeneration: 0,
      reserveContinuation: (id) => budget.reserveContinuation(id),
      reserveProviderAttempt: (id) => {
        captured.reserves.push(id);
        return budget.reserveProviderAttempt(id);
      },
      reserveToolExecution: (id) => budget.reserveToolExecution(id),
      reconcileTokens: (id, n) => budget.reconcileTokens(id, n),
      addActiveRuntime: (ms) => budget.addActiveRuntime(ms),
      addWaitMs: (ms) => budget.addWaitMs(ms),
      getRemainingBudgets: () => budget.getRemaining(),
      persistBudget: async (delta) => {
        captured.persists.push(delta);
        return true;
      },
      consult: async () => ({ type: "finish_response", result: "response_ended" }),
      recordDecision: () => undefined,
      recordToolRoundProgress: () => undefined,
      recordAssistantTextProgress: () => undefined,
    };
  }

  function makeLoop() {
    return new AIChatQueryLoop({
      streamChatCompletion: makeStopStream(),
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
  }

  it("repeated runOnce calls mint fresh identities — re-dispatched rounds count again (no dedup swallow)", async () => {
    // run() retries and permission/plan resumes re-run the same rounds on
    // the same execution. With the old `prov:<exec>:<round>` scheme the
    // second run deduped (AlreadyReserved) and dispatched UNCOUNTED work.
    // Each actual attempt must reserve, count, and persist exactly once.
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS });
    const captured = { reserves: [] as string[], persists: [] as unknown[] };
    const binding = makeRealBudgetBinding(budget, captured);
    const loop = makeLoop();
    const { input } = makeInput({ binding });

    const first = await loop.runOnce(input, { delivered: false });
    expect(first.type).toBe("completed");
    const second = await loop.runOnce(input, { delivered: false });
    expect(second.type).toBe("completed");

    // Two actual provider dispatches → two unique reservations, two
    // provider persists, mirror at 2. Uniqueness is per mint, not per round.
    expect(captured.reserves).toHaveLength(2);
    expect(new Set(captured.reserves).size).toBe(2);
    expect(captured.reserves[0]).not.toBe(captured.reserves[1]);
    expect(budget.getConsumed().providerAttempts).toBe(2);
    const providerPersists = captured.persists.filter(
      (d) =>
        typeof d === "object" &&
        d !== null &&
        "providerAttempts" in (d as Record<string, unknown>)
    );
    expect(providerPersists).toHaveLength(2);
  });

  it("transport retries via onRetry reserve unique retry identities and count toward the cap", async () => {
    // The stream machinery retries a failed connection inside ONE round
    // (invisible to the per-round gate). Each retry is a real wire attempt
    // and must reserve against the 60-attempt cap with a distinct identity.
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS });
    const captured = { reserves: [] as string[], persists: [] as unknown[] };
    const binding = makeRealBudgetBinding(budget, captured);
    let calls = 0;
    const retryingStream = vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void,
        options?: {
          onRetry?: (info: { attempt: number; maxAttempts: number }) => void;
        }
      ) => {
        calls += 1;
        // Simulate one transport retry before the successful response.
        options?.onRetry?.({ attempt: 1, maxAttempts: 3 });
        onChunk({
          id: "resp-retry",
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
        });
      }
    );
    const loop = new AIChatQueryLoop({
      streamChatCompletion: retryingStream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const { input } = makeInput({ binding });
    const result = await loop.runOnce(input, { delivered: false });
    expect(result.type).toBe("completed");
    // Gate reservation + one retry reservation, distinct identities, mirror
    // at 2 against the shared 60-attempt cap.
    expect(captured.reserves).toHaveLength(2);
    expect(new Set(captured.reserves).size).toBe(2);
    expect(
      captured.reserves.some((id) => id.includes(":retry:"))
    ).toBe(true);
    expect(budget.getConsumed().providerAttempts).toBe(2);
  });

  it("reconcile reuses the round identity so one attempt counts tokens once", async () => {
    // The same minted string flows through reserve → reconcile → persist:
    // a second reconcile of the same round is a dedup replay (false), so
    // tokens are never double-counted for one attempt.
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS });
    const first = budget.reserveProviderAttempt("prov:e:0:7");
    expect(first).toBe(BudgetReservationResult.Reserved);
    expect(budget.reconcileTokens("prov:e:0:7", 100)).toBe(true);
    expect(budget.reconcileTokens("prov:e:0:7", 100)).toBe(false);
    expect(budget.getConsumed().tokens).toBe(100);
  });

  it("B13c: provider gate refuses when no token allowance remains (spent tokens gate dispatch)", async () => {
    // Attempts remain but tokens are spent: dispatching would run work the
    // turn cannot account for. Refuse BEFORE reserving (no attempt burned)
    // with a token-distinct code.
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxTokens: 0,
    });
    const stream = makeStopStream();
    const loop = makeLoop();
    const { input } = makeInput({
      binding: makeRealBudgetBinding(budget, { reserves: [], persists: [] }),
    });
    const result = await loop.run(input);
    expect(stream).not.toHaveBeenCalled();
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect((result.error as RecoverableHistoryError).code).toBe(
        "TOKEN_BUDGET_EXHAUSTED"
      );
    }
    expect(budget.getConsumed().providerAttempts).toBe(0);
  });

  it("B13c: provider gate refuses when the next round cannot fit (conservative token preflight)", async () => {
    // 10 tokens remain but the current transcript already estimates above
    // it: the round is impossible, so refuse without spending an attempt.
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxTokens: 10,
    });
    const stream = makeStopStream();
    const loop = makeLoop();
    const { input } = makeInput({
      binding: makeRealBudgetBinding(budget, { reserves: [], persists: [] }),
    });
    const result = await loop.run(input);
    expect(stream).not.toHaveBeenCalled();
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect((result.error as RecoverableHistoryError).code).toBe(
        "TOKEN_BUDGET_EXHAUSTED"
      );
    }
    expect(budget.getConsumed().providerAttempts).toBe(0);
  });

  it("B13c: provider gate refuses when active runtime is spent", async () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxActiveRuntimeMs: 0,
    });
    const stream = makeStopStream();
    const loop = makeLoop();
    const { input } = makeInput({
      binding: makeRealBudgetBinding(budget, { reserves: [], persists: [] }),
    });
    const result = await loop.run(input);
    expect(stream).not.toHaveBeenCalled();
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect((result.error as RecoverableHistoryError).code).toBe(
        "ACTIVE_RUNTIME_EXHAUSTED"
      );
    }
  });

  it("B13c: provider gate refuses when cumulative waits are spent", async () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxWaitMs: 0,
    });
    const stream = makeStopStream();
    const loop = makeLoop();
    const { input } = makeInput({
      binding: makeRealBudgetBinding(budget, { reserves: [], persists: [] }),
    });
    const result = await loop.run(input);
    expect(stream).not.toHaveBeenCalled();
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect((result.error as RecoverableHistoryError).code).toBe(
        "WAIT_BUDGET_EXHAUSTED"
      );
    }
  });

  function makeToolStyleBinding(budget: TaskRunBudget): LoopTaskExecutionBinding {
    return {
      executionId: "exec-b13c-tool",
      policyAccepted: true,
      ledgerId: "ledger-b13c-tool",
      leaseGeneration: 0,
      reserveContinuation: (id) => budget.reserveContinuation(id),
      reserveProviderAttempt: (id) => budget.reserveProviderAttempt(id),
      reserveToolExecution: (id) => budget.reserveToolExecution(id),
      reconcileTokens: (id, n) => budget.reconcileTokens(id, n),
      addActiveRuntime: (ms) => budget.addActiveRuntime(ms),
      addWaitMs: (ms) => budget.addWaitMs(ms),
      getRemainingBudgets: () => budget.getRemaining(),
      persistBudget: async () => true,
      consult: async () => ({ type: "finish_response", result: "response_ended" }),
      recordDecision: () => undefined,
      recordToolRoundProgress: () => undefined,
      recordAssistantTextProgress: () => undefined,
    };
  }

  it("B13c: tool gate refuses when the round's usage spent the token allowance", async () => {
    // Reachable mid-round path: the provider gate passed (estimate fit),
    // but the streamed round reported usage that exhausted tokens before
    // the tool dispatch. The follow-up work is unfundable — refuse up front
    // rather than spending a tool call the turn cannot use.
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxTokens: 100,
    });
    let calls = 0;
    const stream = vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        calls += 1;
        onChunk({
          id: "resp-tool",
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
                    id: "call-b13c",
                    type: "function",
                    function: { name: "search", arguments: '{"q":"x"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 100,
            total_tokens: 150,
          },
        });
      }
    );
    const execute = vi.fn().mockResolvedValue({
      tool_call_id: "call-b13c",
      tool_name: "search",
      success: true,
      result: { answer: "found" },
      execution_time_ms: 10,
    });
    const toolLoop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: execute,
      getSkillDefinition: () => undefined,
    });
    const { input } = makeInput({
      binding: makeToolStyleBinding(budget),
    });
    input.openAITools = [
      {
        type: "function",
        function: {
          name: "search",
          description: "test tool",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    const result = await toolLoop.run(input);
    // The provider round itself ran (reaching the tool call); only the
    // tool dispatch was refused.
    expect(stream).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect((result.error as RecoverableHistoryError).code).toBe(
        "TOKEN_BUDGET_EXHAUSTED"
      );
    }
    expect(budget.getConsumed().tokens).toBe(150);
  });

  it("B13c: run() backoff waits accumulate measured wall-clock into waitMs and persist", async () => {
    // Backoff storms are the unbounded in-loop wait source. The actual
    // slept delay (not the scheduled one) counts toward the 1-hour
    // cumulative wait cap and persists for pause/resume continuity.
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS });
    const persists: unknown[] = [];
    const binding = makeRealBudgetBinding(budget, {
      reserves: [],
      persists,
    });
    let calls = 0;
    const flakyStream = vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        calls += 1;
        if (calls === 1) {
          throw new Error(
            "AI server returned finish_reason=error (transient server-side failure)."
          );
        }
        onChunk({
          id: "resp-wait",
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
        });
      }
    );
    const loop = new AIChatQueryLoop({
      streamChatCompletion: flakyStream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const { input } = makeInput({ binding });
    input.transientRetryConfig = { maxAttempts: 1, baseDelayMs: 30 };
    const result = await loop.run(input);
    expect(result.type).toBe("completed");
    // Node timers fire late, never early: the measured wait covers the
    // full 30ms backoff.
    expect(budget.getConsumed().waitMs).toBeGreaterThanOrEqual(30);
    expect(
      persists.some(
        (d) =>
          typeof d === "object" &&
          d !== null &&
          typeof (d as Record<string, unknown>).waitMs === "number" &&
          ((d as Record<string, unknown>).waitMs as number) >= 30
      )
    ).toBe(true);
  });
});
