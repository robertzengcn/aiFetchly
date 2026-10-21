import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock the Token service so executeAsyncTool's defense-in-depth AI-enabled
 * gate passes. The real Token constructor touches ElectronStoreService which
 * is not available in the vitest environment.
 *
 * NOTE: vi.mock is hoisted to the top of the file by vitest, so it runs
 * before the imports below. The factory returns a mock Token whose getValue
 * always returns 'true' for USER_AI_ENABLED.
 */
vi.mock("@/modules/token", () => ({
  Token: class {
    constructor() {
      return {
    getValue: vi.fn().mockReturnValue("true"),
  };
    }
  },
}));

import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  ToolJobRegistry,
  setDefaultToolJobRegistry,
  type ToolJobSpawnHandle,
} from "@/service/ToolJobRegistry";
import type {
  AIChatQueryLoopInput,
  AIChatQueryEvent,
} from "@/service/AIChatQueryEvents";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

/**
 * Headroom past the largest possible async-poll interval. AIChatQueryLoop now
 * uses bounded backoff (§10.3: 5s start → ×1.5 growth → 15s cap), so a single
 * tick waits at most 15s. Tests advance fake timers 20s to flush one tick with
 * margin, regardless of where the loop is on the backoff curve.
 */
const ASYNC_POLL_INTERVAL_MS_PLUS = 20_000;

/**
 * Fake registry that lets each test override the status/result/error of a
 * jobId AFTER it has been started. Extends ToolJobRegistry so the `override`
 * keyword is valid (both getStatus and cancel are public methods on the base
 * class).
 */
class FakeJobRegistry extends ToolJobRegistry {
  statusOverrides = new Map<
    string,
    "running" | "completed" | "failed" | "cancelled"
  >();
  resultOverrides = new Map<string, unknown>();
  errorOverrides = new Map<string, string>();
  cancelSpied = vi.fn();

  override getStatus(jobId: string) {
    const override = this.statusOverrides.get(jobId);
    if (override === undefined) return super.getStatus(jobId);
    const base = super.getStatus(jobId);
    return {
      ...base,
      status: override,
      result: this.resultOverrides.get(jobId) ?? base.result,
      error: this.errorOverrides.get(jobId) ?? base.error,
    };
  }

  override cancel(jobId: string) {
    this.cancelSpied(jobId);
    return super.cancel(jobId);
  }
}

function makeAsyncToolCallChunk(
  toolCallId: string,
  toolName: string,
  argsJson: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
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
              id: toolCallId,
              type: "function",
              function: { name: toolName, arguments: argsJson },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function makeStopChunk(): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }],
  };
}

/**
 * Build a fake streamChatCompletion. The real dep signature is
 * `(request, onChunk, options?) => Promise<void>` — a callback-based stream,
 * NOT an async generator. This mirrors the pattern used in
 * AIChatQueryLoop.test.ts.
 *
 * Round 0 emits the tool-call chunk; round >=1 emits a stop chunk so the loop
 * can terminate after the async job result is injected.
 */
function makeFakeStream(spec: {
  toolCallId: string;
  toolName: string;
  argsJson: string;
}) {
  let round = 0;
  return vi.fn(
    async (
      _req: unknown,
      onChunk: (c: OpenAIChatCompletionChunk) => void
    ): Promise<void> => {
      if (round === 0) {
        onChunk(
          makeAsyncToolCallChunk(spec.toolCallId, spec.toolName, spec.argsJson)
        );
      } else {
        onChunk(makeStopChunk());
      }
      round += 1;
    }
  );
}

function buildInput(
  events: AIChatQueryEvent[],
  abortController: AbortController
): AIChatQueryLoopInput {
  return {
    conversationId: "conv-test",
    assistantMessageId: "msg-test",
    messages: [],
    request: {
      message: "test",
      conversationId: "conv-test",
      model: "deepseek-v4-flash",
      mode: "chat",
    } as never,
    openAITools: [],
    abortController,
    eventSink: {
      emit: (e: AIChatQueryEvent) => {
        events.push(e);
      },
    },
    startRound: 0,
    isActiveTurn: () => true,
    /**
     * Provides the "async" timeout class for run_subagent so
     * executeToolWithTimeout routes to executeAsyncTool (the job-registry
     * path) instead of the blocking foreground race.
     */
    skillRegistry: {
      getSkill: (name: string) => {
        if (name === "run_subagent") {
          return { timeoutClass: "async" } as never;
        }
        return null;
      },
    },
  };
}

describe("AIChatQueryLoop async poll", () => {
  let fake: FakeJobRegistry;
  let capturedJobIds: string[] = [];
  let startSpy: ReturnType<typeof vi.spyOn> & {
    mockImplementation: (
      impl: (
        toolName: string,
        args: Record<string, unknown>,
        ctx: { conversationId: string; toolCallId: string },
        spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
      ) => { jobId: string; queued: boolean }
    ) => typeof startSpy;
  };

  beforeEach(() => {
    fake = new FakeJobRegistry();
    capturedJobIds = [];
    setDefaultToolJobRegistry(fake);
    startSpy = vi.spyOn(fake, "start") as typeof startSpy;
    startSpy.mockImplementation(
      (
        toolName: string,
        args: Record<string, unknown>,
        ctx: { conversationId: string; toolCallId: string },
        spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
      ) => {
        const result = ToolJobRegistry.prototype.start.call(
          fake,
          toolName,
          args,
          ctx,
          spawn
        );
        capturedJobIds.push(result.jobId);
        return result;
      }
    );
  });

  afterEach(() => {
    startSpy?.mockRestore();
    vi.useRealTimers();
  });

  function lastStartedJobId(): string | undefined {
    return capturedJobIds[capturedJobIds.length - 1];
  }

  it("returns success result when async job completes", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-success";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async (
        _name: string,
        _args: Record<string, unknown>,
        context: { model?: string; [key: string]: unknown }
      ) => {
        expect(context.model).toBe("deepseek-v4-flash");
        const jobId = lastStartedJobId();
        if (jobId) {
          fake.statusOverrides.set(jobId, "completed");
          fake.resultOverrides.set(jobId, { agentTaskId: 42, output: "ok" });
        }
        return {
          success: true,
          result: { agentTaskId: 42, output: "ok" },
          execution_time_ms: 1,
        };
      },
      getSkillDefinition: () => undefined,
    };

    // `as never` is load-bearing for test ergonomics: the test supplies a
    // partial mock of AIChatQueryLoopDeps (only streamChatCompletion /
    // executeTool / getSkillDefinition), not the full type. `as never`
    // satisfies the constructor without stubbing every dep. The same pattern
    // is reused in the two tests below, and for the `request` /
    // `skillRegistry` shapes inside buildInput().
    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    expect(result.type).toBe("completed");
    const progressEvents = events.filter((e) => e.type === "tool_progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents.length).toBe(1);
    const payload = (resultEvents[0] as { toolResult: Record<string, unknown> })
      .toolResult;
    expect(payload).not.toHaveProperty("async");
    expect(payload).toMatchObject({ success: true });
  });

  it("returns failure result when async job fails", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-fail";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        const jobId = lastStartedJobId();
        if (jobId) {
          fake.statusOverrides.set(jobId, "failed");
          fake.errorOverrides.set(jobId, "subagent crashed");
        }
        return {
          success: false,
          error: "subagent crashed",
          execution_time_ms: 1,
        };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    expect(result.type).toBe("completed");
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents.length).toBe(1);
    const payload = (resultEvents[0] as { toolResult: Record<string, unknown> })
      .toolResult;
    expect(payload).toMatchObject({ success: false });
    expect(String(payload.error ?? "").toLowerCase()).toContain("crash");
  });

  it("cancels the job when abort signal fires mid-poll", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-abort";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        return { success: true, result: {}, execution_time_ms: 1 };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    abort.abort();
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    expect(result.type).toBe("cancelled");
    // R05 (lazy admission): an abort that wins before the tool starts
    // leaves no job to cancel. When a job DID start, it must be cancelled
    // with its own id — never an undefined one.
    if (capturedJobIds.length > 0) {
      expect(fake.cancelSpied).toHaveBeenCalledWith(lastStartedJobId());
    } else {
      expect(fake.cancelSpied).not.toHaveBeenCalled();
    }
    // Regression: the abort must NOT emit a tool_result event, otherwise the
    // renderer inserts an orphan "Turn cancelled" card on the cancel path.
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents.length).toBe(0);
  });

  it("passes a cancellable abort signal into the async tool context", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-signal";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    let capturedSignal: AbortSignal | undefined;
    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async (
        _name: string,
        _args: Record<string, unknown>,
        context: { signal?: AbortSignal }
      ) => {
        capturedSignal = context.signal;
        // Hold the job open until the tool-level signal fires, the way a
        // long-running batch tool waits on its abort signal between items.
        await new Promise<void>((resolve) => {
          if (context.signal?.aborted) {
            resolve();
            return;
          }
          context.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return { success: false, error: "cancelled", execution_time_ms: 1 };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);

    // The async tool context must carry a real, not-yet-aborted AbortSignal.
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    abort.abort();
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    // Registry cancellation fires the tool-level signal via onCancel wiring,
    // so a batch tool reading context.signal aborts its in-flight work.
    expect(fake.cancelSpied).toHaveBeenCalledWith(lastStartedJobId());
    expect(capturedSignal?.aborted).toBe(true);
    expect(result.type).toBe("cancelled");
  });

  /**
   * §10.3 — bounded job polling/backoff. "Approved read-only polling
   * consumes budgets/time with backoff and a minimum one-second interval. No
   * unbounded internal polling."
   *
   * The poll interval starts at the registry's pollMinIntervalMs (5s), grows
   * ×1.5 each tick, caps at 15s, and never drops below 1s. This test records
   * the wall-clock time of each getStatus call and asserts the gaps follow
   * the backoff curve (5s → 7.5s → 11.25s → 15s → 15s ...). It does NOT depend
   * on the registry's rate_limited branch — the loop schedules its own backoff.
   */
  it("polls with backoff: 5s start, ×1.5 growth, 15s cap (§10.3)", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-backoff";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    // Spy getStatus to record poll timestamps; the job stays running so the
    // loop keeps polling (we drive it to the cap).
    //
    // The first entry seeded into pollTimestamps is the job's startedAt (the
    // moment start() registered the job). The §10.3 start interval (5s) is the
    // wait from job-start to poll #1 — NOT the gap between two polls. Without
    // this baseline, gap[0] would be the GROWN interval (7.5s), hiding the 5s
    // start. With it, gap[0] = poll1 - startedAt = 5s.
    const pollTimestamps: number[] = [];
    let seededBaseline = false;
    const getStatusSpy = vi.spyOn(fake, "getStatus").mockImplementation(
      (jobId: string) => {
        const base = ToolJobRegistry.prototype.getStatus.call(fake, jobId);
        if (!seededBaseline) {
          pollTimestamps.push(base.startedAt);
          seededBaseline = true;
        }
        pollTimestamps.push(Date.now());
        // Force running so the loop keeps polling — the test controls ticks.
        return {
          ...base,
          status: "running" as const,
          progress: null,
          partial: null,
          result: null,
          error: null,
        };
      }
    );

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        return { success: true, result: {}, execution_time_ms: 1 };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    // Advance past the first 4 poll ticks. With backoff (5s, 7.5s, 11.25s, 15s)
    // the cumulative time through 4 ticks = 5 + 7.5 + 11.25 + 15 = 38.75s.
    // Advance 40s to flush all four.
    await vi.advanceTimersByTimeAsync(40_000);
    // Stop the loop: complete the job on the next tick.
    getStatusSpy.mockRestore();
    const jobId = lastStartedJobId();
    if (jobId) {
      fake.statusOverrides.set(jobId, "completed");
      fake.resultOverrides.set(jobId, { output: "ok" });
    }
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    expect(result.type).toBe("completed");
    // We observed at least 4 polls plus the baseline (5 entries → 4 gaps).
    expect(pollTimestamps.length).toBeGreaterThanOrEqual(5);
    // Compute the inter-poll gaps and assert the backoff curve.
    const gaps: number[] = [];
    for (let i = 1; i < pollTimestamps.length; i++) {
      gaps.push(pollTimestamps[i] - pollTimestamps[i - 1]);
    }
    // First gap ≈ 5s (registry pollMinIntervalMs — the §10.3 start interval;
    // this is poll1 - startedAt, the wait from job-start to the first poll).
    expect(gaps[0]).toBeGreaterThanOrEqual(4_900);
    expect(gaps[0]).toBeLessThanOrEqual(5_100);
    // Second gap ≈ 7.5s (×1.5 growth — the first grown interval).
    expect(gaps[1]).toBeGreaterThanOrEqual(7_400);
    expect(gaps[1]).toBeLessThanOrEqual(7_600);
    // Third gap ≈ 11.25s (×1.5 again).
    expect(gaps[2]).toBeGreaterThanOrEqual(11_100);
    expect(gaps[2]).toBeLessThanOrEqual(11_400);
    // Fourth gap caps at 15s — no further growth.
    expect(gaps[3]).toBeGreaterThanOrEqual(14_900);
    expect(gaps[3]).toBeLessThanOrEqual(15_100);
  });

  /**
   * §10.3 — "a minimum one-second interval." Even under aggressive backoff
   * decay or a tiny registry pollMinIntervalMs, the loop never polls faster
   * than once per second.
   */
  it("never polls faster than once per second (§10.3 floor)", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-floor";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    const pollTimestamps: number[] = [];
    const getStatusSpy = vi.spyOn(fake, "getStatus").mockImplementation(
      (jobId: string) => {
        const base = ToolJobRegistry.prototype.getStatus.call(fake, jobId);
        pollTimestamps.push(Date.now());
        return {
          ...base,
          status: "running" as const,
          progress: null,
          partial: null,
          result: null,
          error: null,
        };
      }
    );

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        return { success: true, result: {}, execution_time_ms: 1 };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    // Advance 20s — enough for ~3 backoff ticks (5 + 7.5 = 12.5s for 2 gaps).
    await vi.advanceTimersByTimeAsync(20_000);
    getStatusSpy.mockRestore();
    const jobId = lastStartedJobId();
    if (jobId) {
      fake.statusOverrides.set(jobId, "completed");
      fake.resultOverrides.set(jobId, { output: "ok" });
    }
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    await promise;

    // Every inter-poll gap must be >= 1s (§10.3 minimum interval floor).
    for (let i = 1; i < pollTimestamps.length; i++) {
      const gap = pollTimestamps[i] - pollTimestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(1_000);
    }
  });
});

/**
 * §10.3 rate_limited branch (D8 review-coverage gap): when the registry
 * returns a `rate_limited` snapshot carrying `retryAfterMs`, the loop's
 * next interval must HONOR that value (clamped to [1s floor, 15s cap])
 * instead of applying the ×1.5 growth. The registry emits this snapshot
 * when a poll arrives before pollMinIntervalMs has elapsed since
 * lastPolledAt.
 */
describe("AIChatQueryLoop async poll — rate_limited retryAfterMs override", () => {
  let fake: FakeJobRegistry;

  beforeEach(() => {
    fake = new FakeJobRegistry();
    setDefaultToolJobRegistry(fake);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Drive the loop with one async tool call whose getStatus is forced
   * rate_limited (with the given retryAfterMs) on the FIRST poll only,
   * then running on subsequent polls. Advances `advanceMs` of fake time,
   * records the poll timestamps seen in that window, then flushes the
   * loop by completing the job. Returns the inter-poll gaps: gap[0] is
   * job-start → poll #1 (the §10.3 start interval — poll #1 happens 5s
   * AFTER job start because the loop sleeps currentIntervalMs before the
   * first getStatus), gap[1] is poll #1 → poll #2 (the interval the
   * rate_limited snapshot's retryAfterMs won over the ×1.5 growth).
   */
  async function pollWithRateLimitOnce(
    retryAfterMs: number,
    advanceMs: number
  ): Promise<{ gaps: number[] }> {
    vi.useFakeTimers();
    const toolCallId = `call-rl-${retryAfterMs}`;
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    // Same baseline-seeding trick as the backoff test: the first entry is
    // the job's startedAt, so gap[0] is the 5s start interval to poll #1
    // and gap[1] is the interval the rate_limited snapshot chose.
    const pollTimestamps: number[] = [];
    let seededBaseline = false;
    let observedJobId: string | undefined;
    let rateLimitedSeen = false;
    const getStatusSpy = vi.spyOn(fake, "getStatus").mockImplementation(
      (jobId: string) => {
        const base = ToolJobRegistry.prototype.getStatus.call(fake, jobId);
        observedJobId = jobId;
        if (!seededBaseline) {
          seededBaseline = true;
          pollTimestamps.push(base.startedAt);
        }
        pollTimestamps.push(Date.now());
        if (!rateLimitedSeen) {
          rateLimitedSeen = true;
          return {
            ...base,
            status: "rate_limited" as const,
            progress: null,
            partial: null,
            result: null,
            error: null,
            retryAfterMs,
          };
        }
        return {
          ...base,
          status: "running" as const,
          progress: null,
          partial: null,
          result: null,
          error: null,
        };
      }
    );

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        return { success: true, result: {}, execution_time_ms: 1 };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);
    const promise = loop.run(input);

    // First poll fires at the 5s §10.3 start interval; the second honors
    // retryAfterMs (clamped). 20s covers both for any retryAfterMs in
    // [1s, 15s]: 5s + up to 15s = 20s.
    await vi.advanceTimersByTimeAsync(advanceMs);
    const recorded = [...pollTimestamps];

    getStatusSpy.mockRestore();
    if (observedJobId) {
      fake.statusOverrides.set(observedJobId, "completed");
      fake.resultOverrides.set(observedJobId, { output: "ok" });
    }
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;
    // The loop must terminate normally through the override sequence — no
    // stall, no abort, no 30-minute timeout return.
    expect(result.type).toBe("completed");

    const gaps: number[] = [];
    for (let i = 1; i < recorded.length; i++) {
      gaps.push(recorded[i] - recorded[i - 1]);
    }
    return { gaps };
  }

  it("honors the registry's retryAfterMs as the next poll interval when rate_limited", async () => {
    // 8s retryAfterMs: above the ×1.5-grown 7.5s, below the 15s cap — the
    // override must WIN over the growth. Polls fire at t=5s (rate_limited)
    // and t=13s (5+8), so a 20s advance captures exactly the two.
    const { gaps } = await pollWithRateLimitOnce(8_000, 20_000);

    expect(gaps.length).toBeGreaterThanOrEqual(2);
    // First gap ≈ 5s — the §10.3 start interval to the FIRST poll (which
    // returned the rate_limited snapshot).
    expect(gaps[0]).toBeGreaterThanOrEqual(4_900);
    expect(gaps[0]).toBeLessThanOrEqual(5_100);
    // Second gap ≈ 8s — retryAfterMs honored (×1.5 growth would give 7.5s).
    expect(gaps[1]).toBeGreaterThanOrEqual(7_900);
    expect(gaps[1]).toBeLessThanOrEqual(8_100);
  });

  it("clamps a tiny retryAfterMs to the 1s floor (no hot loop)", async () => {
    // 50ms retryAfterMs is below the 1s floor — the next poll must still
    // be at least 1s out (§10.3 "a minimum one-second interval"), never
    // 50ms. The second poll fires at t=6s (5+1), then normal growth.
    const { gaps } = await pollWithRateLimitOnce(50, 20_000);

    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect(gaps[0]).toBeGreaterThanOrEqual(4_900);
    expect(gaps[0]).toBeLessThanOrEqual(5_100);
    // Clamped to the 1s floor — and exactly ~1s (not the grown 7.5s)
    // proves the retryAfterMs override was applied before the clamp.
    expect(gaps[1]).toBeGreaterThanOrEqual(1_000);
    expect(gaps[1]).toBeLessThanOrEqual(1_050);
  });

  it("caps a huge retryAfterMs at the 15s max (a misbehaving registry cannot stall the poll)", async () => {
    // 60s retryAfterMs exceeds the 15s cap — the next poll must fire at
    // 15s, not 60s (otherwise the loop looks hung for a minute per tick).
    // Polls fire at t=5s (rate_limited) and t=20s (5+15); 22s captures both.
    const { gaps } = await pollWithRateLimitOnce(60_000, 22_000);

    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect(gaps[0]).toBeGreaterThanOrEqual(4_900);
    expect(gaps[0]).toBeLessThanOrEqual(5_100);
    // Capped at ~15s — the override won over the grown interval (7.5s)
    // but did NOT exceed the §10.3 max.
    expect(gaps[1]).toBeGreaterThanOrEqual(14_900);
    expect(gaps[1]).toBeLessThanOrEqual(15_100);
  });
});
