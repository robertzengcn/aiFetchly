# Async Tool Job Polling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI chat v2 query loop poll `ToolJobRegistry` until async tool jobs (run_subagent, search_maps_businesses, extract_contact_info) complete, inject the real result back into the model loop, and surface live progress via a running badge on the tool card.

**Architecture:** Add a `pollAsyncJobToCompletion` private method to `AIChatQueryLoop` that polls every 15s up to a 30-min cap. Refactor `executeAsyncTool` to return `{jobId}` instead of a placeholder envelope. Wire the existing engine `tool_progress` event through IPC to the renderer, render a badge on the tool_call card.

**Tech Stack:** TypeScript, Vue 3 Composition API, Vuetify 3, Vitest, Electron IPC.

## Global Constraints

- TypeScript strict mode — no `any` (use `unknown` or explicit interfaces).
- TypeScript: all functions have explicit return types.
- Immutability: never mutate objects in place; always spread into new objects/arrays.
- i18n: all new user-facing strings must be added to `src/views/lang/{en,zh,es,fr,de,ja}.ts` with English fallback in the component (`t(\'key\') || \'English Text\'`).
- After completing each logical unit, stage and commit with conventional commit format (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).
- Async tools flow through `executeToolWithTimeout` -> `executeAsyncTool` (single funnel); do not add per-tool code.

---

## Task 1: Add poll constants and tool_progress chunk type

**Files:**
- Modify: `src/service/AIChatQueryLoop.ts` (near line 55, after `CHAT_V2_MAX_TOOL_ROUNDS`)
- Modify: `src/entityTypes/aiChatV2Types.ts:101-149`

**Interfaces:**
- Produces: `ASYNC_POLL_INTERVAL_MS`, `ASYNC_POLL_MAX_MS` constants in `AIChatQueryLoop.ts`
- Produces: `"tool_progress"` member of `ChatV2StreamEventType`; new fields on `ChatV2StreamChunk`

- [ ] **Step 1: Add constants to AIChatQueryLoop.ts**

In `src/service/AIChatQueryLoop.ts`, immediately after the `CHAT_V2_MAX_TOOL_ROUNDS = 30` line (around line 55), add:

```typescript
/**
 * Polling interval for async tool jobs. The loop sleeps this long between
 * ToolJobRegistry.getStatus() calls. Must be >= the registry\'s
 * pollMinIntervalMs (5s) to avoid rate_limited snapshots.
 */
const ASYNC_POLL_INTERVAL_MS = 15_000;

/**
 * Hard cap on async tool job polling. Jobs that exceed this are almost
 * certainly stuck; we inject a timeout error so the model can decide
 * whether to ask the user or retry. 30min matches the outer bound of
 * plausible subagent cascades.
 */
const ASYNC_POLL_MAX_MS = 30 * 60_000;
```

- [ ] **Step 2: Add tool_progress to ChatV2StreamEventType**

In `src/entityTypes/aiChatV2Types.ts`, edit the `ChatV2StreamEventType` union (line 101-118) to insert `"tool_progress"` after `"tool_call"`:

```typescript
export type ChatV2StreamEventType =
  | "start"
  | "token"
  | "tool_call_delta"
  | "tool_call"
  | "tool_progress"
  | "tool_result"
  | "plan_state"
  | "ask_user_question"
  | "plan_submitted"
  | "plan_approved"
  | "plan_rejected"
  | "plan_blocked_tool"
  | "plan_changes_requested"
  | "retry_connect"
  | "usage_update"
  | "error"
  | "cancelled"
  | "complete";
```

- [ ] **Step 3: Add progress fields to ChatV2StreamChunk**

In the same file, edit the `ChatV2StreamChunk` interface. Insert immediately after `replacesPermissionPromptForToolId?: string;` (line 133):

```typescript
  /** tool_progress: lifecycle phase of a long-running tool. */
  phase?:
    | "queued"
    | "running"
    | "fetching"
    | "extracting"
    | "finalizing";
  /** tool_progress: human-readable status message (i18n key or English fallback). */
  progressMessage?: string;
  /** tool_progress: 0..1 progress fraction, or undefined when indeterminate. */
  progressFraction?: number;
  /** tool_progress: count of items processed so far, when known. */
  partialCount?: number;
  /** tool_progress: total items expected, when known. */
  expectedCount?: number;
  /** tool_progress: epoch ms when this progress update was emitted. */
  progressTimestamp?: number;
```

- [ ] **Step 4: Run TypeScript type check**

Run: `yarn vue-check 2>&1 | head -30`
Expected: no errors related to `aiChatV2Types.ts`. Existing unrelated type errors may be present — only verify our files are clean.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatQueryLoop.ts src/entityTypes/aiChatV2Types.ts
git commit -m "feat(ai-chat-v2): add async poll constants and tool_progress chunk type"
```

---

## Task 2: Add tool_progress IPC mapping

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts:187-209`

**Interfaces:**
- Consumes: `AIChatQueryToolProgressEvent` from `@/service/AIChatQueryEvents`
- Produces: IPC chunk with `eventType: "tool_progress"` and the progress fields from Task 1.

- [ ] **Step 1: Add the tool_progress switch case**

In `src/main-process/communication/ai-chat-v2-ipc.ts`, find the `case "tool_call":` block (line 187). Immediately before it, insert:

```typescript
        case "tool_progress":
          sendChunk(event, {
            eventType: "tool_progress",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            phase: e.phase,
            progressMessage: e.message,
            progressFraction:
              typeof e.progress === "number" ? e.progress : undefined,
            partialCount: e.partialCount ?? undefined,
            expectedCount: e.expectedCount ?? undefined,
            progressTimestamp: e.timestamp,
          });
          break;
```

Notes:
- The engine event field is `message` (per `AIChatQueryToolProgressEvent`); the chunk field is `progressMessage` to avoid collision with existing `ChatV2StreamChunk` semantics.
- `e.progress` is `number | null`; convert null to undefined to match the optional chunk field.
- `e.partialCount` / `e.expectedCount` are `number | null`; same conversion.

- [ ] **Step 2: Run TypeScript type check**

Run: `yarn vue-check 2>&1 | head -30`
Expected: no new type errors in `ai-chat-v2-ipc.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/main-process/communication/ai-chat-v2-ipc.ts
git commit -m "feat(ai-chat-v2): map tool_progress engine event to IPC chunk"
```

---

## Task 3: Write failing tests for pollAsyncJobToCompletion

**Files:**
- Create: `test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts`
- Test helpers to mirror: `test/vitest/main/service/AIChatQueryLoop.test.ts:1-80`

**Interfaces:**
- Consumes: `AIChatQueryLoop`, `setDefaultToolJobRegistry`, `ToolJobRegistry`, `AIChatQueryLoopInput`, `AIChatQueryEvent`
- Produces: coverage for success, failure, abort paths.

- [ ] **Step 1: Create the test file skeleton**

Create `test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  ToolJobRegistry,
  setDefaultToolJobRegistry,
} from "@/service/ToolJobRegistry";
import type {
  AIChatQueryLoopInput,
  AIChatQueryEvent,
} from "@/service/AIChatQueryEvents";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

const ASYNC_POLL_INTERVAL_MS_PLUS = 20_000;

class FakeJobRegistry extends ToolJobRegistry {
  statusOverrides = new Map<string, "running" | "completed" | "failed" | "cancelled">();
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
    choices: [
      { index: 0, delta: { content: "done" }, finish_reason: "stop" },
    ],
  };
}

function makeFakeStream(spec: { toolCallId: string; toolName: string; argsJson: string }) {
  let round = 0;
  return vi.fn(async function* (): AsyncGenerator<OpenAIChatCompletionChunk> {
    if (round === 0) {
      yield makeAsyncToolCallChunk(spec.toolCallId, spec.toolName, spec.argsJson);
    } else {
      yield makeStopChunk();
    }
    round += 1;
  });
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
      mode: "chat",
    } as never,
    openAITools: [],
    abortController,
    eventSink: { emit: (e: AIChatQueryEvent) => { events.push(e); } },
    startRound: 0,
    isActiveTurn: () => true,
  };
}

describe("AIChatQueryLoop async poll", () => {
  let fake: FakeJobRegistry;
  let capturedJobIds: string[] = [];
  let startSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fake = new FakeJobRegistry();
    capturedJobIds = [];
    setDefaultToolJobRegistry(fake);
    startSpy = vi.spyOn(fake, "start");
    startSpy.mockImplementation((toolName, args, ctx, spawn) => {
      const result = ToolJobRegistry.prototype.start.call(
        fake,
        toolName,
        args,
        ctx,
        spawn
      );
      capturedJobIds.push(result.jobId);
      return result;
    });
  });

  afterEach(() => {
    startSpy?.mockRestore();
    vi.useRealTimers();
  });

  function lastStartedJobId(): string | undefined {
    return capturedJobIds[capturedJobIds.length - 1];
  }

  // Tests land in subsequent steps.
});
```

- [ ] **Step 2: Add success path test**

Inside the `describe("AIChatQueryLoop async poll", ...)` block, after `lastStartedJobId`, add:

```typescript
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
      streamCompletion: fakeStream,
      executeTool: async () => {
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
    const payload = (resultEvents[0] as { toolResult: Record<string, unknown> }).toolResult;
    expect(payload).not.toHaveProperty("async");
    expect(payload).toMatchObject({ success: true });
  });
```

- [ ] **Step 3: Add failure path test**

```typescript
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
      streamCompletion: fakeStream,
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
    const payload = (resultEvents[0] as { toolResult: Record<string, unknown> }).toolResult;
    expect(payload).toMatchObject({ success: false });
    expect(String(payload.error ?? "").toLowerCase()).toContain("crash");
  });
```

- [ ] **Step 4: Add abort mid-poll test**

```typescript
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
      streamCompletion: fakeStream,
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
    expect(fake.cancelSpied).toHaveBeenCalledWith(lastStartedJobId());
  });
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts 2>&1 | tail -30`
Expected: all 3 tests FAIL. Reasons vary: `pollAsyncJobToCompletion` does not exist yet; the placeholder envelope is still being returned; abort does not cancel.

If a test PASSES already, the test is not exercising the new code path — fix the test before implementing.

- [ ] **Step 6: Commit the failing tests**

```bash
git add test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts
git commit -m "test(ai-chat-v2): add failing tests for async tool job polling"
```

---

## Task 4: Implement pollAsyncJobToCompletion and refactor executeAsyncTool

**Files:**
- Modify: `src/service/AIChatQueryLoop.ts:894-997`

**Interfaces:**
- Consumes: constants from Task 1; `getDefaultToolJobRegistry` (already imported); `ToolJobSnapshot` from `ToolJobRegistry.ts`
- Produces: `ToolExecutionResult` for every exit path; emits `tool_progress` events via `input.eventSink`

- [ ] **Step 1: Refactor executeAsyncTool to return {jobId}**

In `src/service/AIChatQueryLoop.ts`, find `executeAsyncTool` (line 894).

Change the return type from `Promise<ToolExecutionResult>` to:
```typescript
  ): Promise<{ jobId: string }> {
```

Find the AI-enable early-return block (around line 906-915). Replace the `return { tool_call_id: ... }` with a throw:
```typescript
    if (!aiEnabled) {
      throw new Error("AI features are not enabled on this plan.");
    }
```

Find the final return block near the end of the method (around line 955-967) and DELETE it:

```typescript
    return {
      tool_call_id: call.id,
      tool_name: call.name,
      success: true,
      result: {
        async: true,
        job_id: jobId,
        status: registry.getStatus(jobId).status,
        message:
          "Tool is running asynchronously. Poll with check_tool_job_status(job_id) every 15-30s.",
      },
      execution_time_ms: Date.now() - startedAt,
    };
```

Replace with:
```typescript
    return { jobId };
```

Delete the now-unused `const startedAt = Date.now();` line near the top of the method (around line 902).

- [ ] **Step 2: Add pollAsyncJobToCompletion method**

Add this new private method immediately after `executeAsyncTool`:

```typescript
  /**
   * Poll an async tool job until terminal status or the 30-min cap.
   *
   * Emits tool_progress events on the same toolCallId so the UI can render
   * a live "running" badge on the tool card. Returns a ToolExecutionResult
   * on every exit path so the caller can push a well-formed `tool` message
   * (required by the OpenAI chat-completions contract: every tool_call_id
   * must have a matching tool response).
   *
   * Abort-aware: if input.abortController fires, we cancel the job in the
   * registry and return a cancelled-state result; the outer loop breaks via
   * its existing cancel detection.
   */
  private async pollAsyncJobToCompletion(
    input: AIChatQueryLoopInput,
    call: { id: string; name: string },
    jobId: string
  ): Promise<ToolExecutionResult> {
    const registry = getDefaultToolJobRegistry();
    const startedAt = Date.now();
    const shortId = jobId.slice(0, 8);

    const emitProgress = (
      phase: "queued" | "running" | "fetching" | "extracting" | "finalizing",
      message: string,
      progress: number | null,
      partialCount: number | null,
      expectedCount: number | null
    ): void => {
      input.eventSink.emit({
        type: "tool_progress",
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
        toolCallId: call.id,
        toolName: call.name,
        phase,
        message,
        progress,
        partialCount,
        expectedCount,
        timestamp: Date.now(),
      });
    };

    emitProgress(
      "running",
      `Background job started (job_id: ${shortId})`,
      null,
      null,
      null
    );

    let lastProgressSig = "";
    let lastPhase = "";

    const sleepUntilAbortOrTimeout = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        if (input.abortController.signal.aborted) {
          resolve();
          return;
        }
        const done = (): void => {
          clearTimeout(timer);
          input.abortController.signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = (): void => done();
        const timer = setTimeout(done, ms);
        input.abortController.signal.addEventListener("abort", onAbort, {
          once: true,
        });
      });

    while (true) {
      await sleepUntilAbortOrTimeout(ASYNC_POLL_INTERVAL_MS);

      if (input.abortController.signal.aborted) {
        try {
          registry.cancel(jobId);
        } catch {
          // Best-effort; the turn is dead anyway.
        }
        return {
          tool_call_id: call.id,
          tool_name: call.name,
          success: false,
          result: { error: "Turn cancelled" },
          execution_time_ms: Date.now() - startedAt,
        };
      }

      if (Date.now() - startedAt >= ASYNC_POLL_MAX_MS) {
        return {
          tool_call_id: call.id,
          tool_name: call.name,
          success: false,
          result: {
            error:
              "Background job did not complete within 30 minutes. " +
              "The job may still be running; ask the user whether to keep " +
              "waiting or cancel via cancel_tool_job(job_id).",
            job_id: jobId,
          },
          execution_time_ms: Date.now() - startedAt,
        };
      }

      const snap = registry.getStatus(jobId);
      const progressSig = `${snap.progress?.phase ?? ""}|${snap.progress?.progress ?? ""}|${snap.progress?.partialCount ?? ""}|${snap.progress?.expectedCount ?? ""}`;

      if (
        snap.progress &&
        (snap.progress.phase !== lastPhase || progressSig !== lastProgressSig)
      ) {
        lastPhase = snap.progress.phase;
        lastProgressSig = progressSig;
        emitProgress(
          snap.progress.phase,
          snap.progress.message,
          snap.progress.progress,
          snap.progress.partialCount,
          snap.progress.expectedCount
        );
      }

      if (snap.status === "completed") {
        return {
          tool_call_id: call.id,
          tool_name: call.name,
          success: true,
          result: snap.result,
          execution_time_ms: Date.now() - startedAt,
        };
      }
      if (snap.status === "failed") {
        return {
          tool_call_id: call.id,
          tool_name: call.name,
          success: false,
          result: { error: snap.error ?? "Job failed", job_id: jobId },
          execution_time_ms: Date.now() - startedAt,
        };
      }
      if (snap.status === "cancelled") {
        return {
          tool_call_id: call.id,
          tool_name: call.name,
          success: false,
          result: { error: "Job cancelled", job_id: jobId },
          execution_time_ms: Date.now() - startedAt,
        };
      }
      if (snap.status === "not_found") {
        return {
          tool_call_id: call.id,
          tool_name: call.name,
          success: false,
          result: {
            error: "Job evicted from registry; retry the tool call",
            job_id: jobId,
          },
          execution_time_ms: Date.now() - startedAt,
        };
      }
      // status === "running" | "queued" | "rate_limited" -> keep polling.
    }
  }
```

- [ ] **Step 3: Wire pollAsyncJobToCompletion into executeToolWithTimeout**

Find `executeToolWithTimeout` (line 970). Find the async dispatch at lines 993-995:

```typescript
    if (timeoutMs === null) {
      return await this.executeAsyncTool(input, call);
    }
```

Replace with:

```typescript
    if (timeoutMs === null) {
      const { jobId } = await this.executeAsyncTool(input, call);
      return await this.pollAsyncJobToCompletion(input, call, jobId);
    }
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts 2>&1 | tail -40`
Expected: all 3 tests PASS.

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryLoop.test.ts test/vitest/main/service/AIChatQueryLoopTimeout.test.ts test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -40`
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/service/AIChatQueryLoop.ts
git commit -m "fix(ai-chat-v2): poll async tool jobs to completion instead of returning placeholder"
```

---

## Task 5: Add upsertToolProgress helper and chunk handler in AiChatV2.vue

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue` around line 830 (near `upsertToolResultMessage`) and around line 1391 (the `tool_call`/`tool_result` chunk handler)

**Interfaces:**
- Consumes: `ChatV2StreamChunk` with progress fields from Task 1; `MessageType` enum from `@/entityTypes/commonType`
- Produces: tool_call messages with `metadata.toolProgress` for the renderer

- [ ] **Step 1: Add upsertToolProgress helper**

In `src/views/components/aiChatV2/AiChatV2.vue`, find `upsertToolResultMessage` (around line 858). Immediately BEFORE it, add:

```typescript
const upsertToolProgress = (
  chunk: ChatV2StreamChunk,
  conversationId: string
): void => {
  if (!chunk.toolCallId) return;
  const idx = messages.value.findIndex(
    (m) =>
      m.messageType === MessageType.TOOL_CALL &&
      m.metadata?.toolCallId === chunk.toolCallId
  );
  if (idx === -1) {
    return;
  }
  const existing = messages.value[idx];
  const nextProgress = {
    phase: chunk.phase,
    message: chunk.progressMessage,
    progress:
      typeof chunk.progressFraction === "number" ? chunk.progressFraction : null,
    partialCount: chunk.partialCount ?? null,
    expectedCount: chunk.expectedCount ?? null,
    updatedAt: chunk.progressTimestamp ?? Date.now(),
  };
  messages.value = [
    ...messages.value.slice(0, idx),
    {
      ...existing,
      metadata: {
        ...existing.metadata,
        toolProgress: nextProgress,
      },
    },
    ...messages.value.slice(idx + 1),
  ];
};
```

- [ ] **Step 2: Wire the tool_progress chunk event**

In the same file, find the chunk handler block that contains `else if (chunk.eventType === "tool_call") {` (around line 1391). Immediately BEFORE that branch, insert a new branch. The result is a chain:

```typescript
          } else if (chunk.eventType === "tool_progress") {
            upsertToolProgress(
              chunk,
              chunk.conversationId || activeConversationId.value || ""
            );
          } else if (chunk.eventType === "tool_call") {
            // ... existing tool_call handling unchanged ...
```

Preserve all existing branches after `tool_call`.

- [ ] **Step 3: TypeScript check**

Run: `yarn vue-check 2>&1 | grep -E "(AiChatV2\.vue|error TS)" | head -20`
Expected: no errors referencing `AiChatV2.vue`.

- [ ] **Step 4: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2.vue
git commit -m "feat(ai-chat-v2): handle tool_progress chunks and update tool card metadata"
```

---

## Task 6: Render running badge on tool_call card in AiChatV2Message.vue

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2Message.vue` (the tool_call card template block)
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

**Interfaces:**
- Consumes: `message.metadata.toolProgress` written by Task 5\'s `upsertToolProgress`
- Produces: visible spinner + progress message + optional progress bar

- [ ] **Step 1: Read the existing component**

Read `/Users/cengjianze/project/aiFetchly/src/views/components/aiChatV2/AiChatV2Message.vue` end-to-end. Identify:
- The template block that renders `messageType === TOOL_CALL` cards (around line 15-28).
- The `<script setup>` imports (Vue, Vuetify, vue-i18n).
- The existing prop name (`message` vs `msg` etc.).

- [ ] **Step 2: Add computed flag for progress presence**

In the `<script setup>` section, add near other computed properties:

```typescript
interface ToolProgressView {
  phase: string;
  message?: string;
  progress: number | null;
  partialCount: number | null;
  expectedCount: number | null;
  updatedAt: number;
}

const toolProgress = computed<ToolProgressView | null>(() => {
  const meta = props.message.metadata as
    | { toolProgress?: ToolProgressView }
    | undefined;
  return meta?.toolProgress ?? null;
});
```

Adjust `props.message` to the actual prop name from Step 1. Add `computed` to the existing `import { ... } from "vue";` if not already present.

- [ ] **Step 3: Add the running badge to the template**

Inside the tool_call card template block, adjacent to the tool name (between the icon and the `<details>` summary, or wherever the tool name is rendered), insert:

```vue
<span
  v-if="toolProgress"
  class="tool-progress-badge"
  style="margin-left: 8px; display: inline-flex; align-items: center; gap: 4px;"
>
  <v-icon size="small" class="mdi-spin">mdi-loading</v-icon>
  <span class="text-caption">{{
    toolProgress.message ||
    t("aiChatV2.tool_running") ||
    "Running..."
  }}</span>
  <span
    v-if="
      typeof toolProgress.partialCount === \'number\' &&
      typeof toolProgress.expectedCount === \'number\'
    "
    class="text-caption"
  >
    ({{ toolProgress.partialCount }}/{{ toolProgress.expectedCount }})
  </span>
</span>
<v-progress-linear
  v-if="toolProgress && typeof toolProgress.progress === \'number\'"
  :model-value="Math.round(toolProgress.progress * 100)"
  height="4"
  style="margin-top: 4px;"
/>
```

If `useI18n` is not imported, add: `import { useI18n } from "vue-i18n"; const { t } = useI18n();`. If it is, reuse the existing `t`.

- [ ] **Step 4: Add the i18n key to all six language files**

For each of `src/views/lang/{en,zh,es,fr,de,ja}.ts`, locate or create the `aiChatV2:` section and add `tool_running`. Translations:

- `en.ts`: `tool_running: "Running...",`
- `zh.ts`: `tool_running: "运行中...",`
- `es.ts`: `tool_running: "Ejecutando...",`
- `fr.ts`: `tool_running: "En cours...",`
- `de.ts`: `tool_running: "Läuft...",`
- `ja.ts`: `tool_running: "実行中...",`

If a language file does not have an `aiChatV2` section, add the whole section with `tool_running` as its first key.

- [ ] **Step 5: TypeScript check**

Run: `yarn vue-check 2>&1 | grep -E "(AiChatV2Message|lang/)" | head -20`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2Message.vue src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat(ai-chat-v2): render running badge with progress on tool_call cards"
```

---

## Task 7: Add component test for the running badge

**Files:**
- Create: `test/vitest/main/components/AiChatV2Message.toolProgress.test.ts`

**Interfaces:**
- Consumes: `AiChatV2Message.vue` from Task 6; `MessageType` from `@/entityTypes/commonType`

- [ ] **Step 0: Verify `@vue/test-utils` is installed**

Run: `grep "@vue/test-utils" package.json`
If missing, run: `yarn add -D @vue/test-utils`

If the project uses a different component-testing utility, mirror the existing pattern instead.

- [ ] **Step 1: Create the test file**

```typescript
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";

function makeBaseMessage() {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant" as const,
    content: "",
    timestamp: new Date().toISOString(),
    messageType: MessageType.TOOL_CALL,
    metadata: {
      source: "chat-v2" as const,
      toolCallId: "tc1",
      toolName: "run_subagent",
      toolArguments: {},
    },
  };
}

describe("AiChatV2Message tool progress badge", () => {
  it("renders spinner and message when toolProgress metadata is present", () => {
    const base = makeBaseMessage();
    const message = {
      ...base,
      metadata: {
        ...base.metadata,
        toolProgress: {
          phase: "running",
          message: "Subagent running...",
          progress: null,
          partialCount: null,
          expectedCount: null,
          updatedAt: Date.now(),
        },
      },
    };
    const wrapper = mount(AiChatV2Message, {
      props: { message },
      global: { mocks: { $t: (k: string) => k } },
    });
    expect(wrapper.text()).toContain("Subagent running...");
  });

  it("does not render progress badge when toolProgress is absent", () => {
    const wrapper = mount(AiChatV2Message, {
      props: { message: makeBaseMessage() },
      global: { mocks: { $t: (k: string) => k } },
    });
    expect(wrapper.find(".tool-progress-badge").exists()).toBe(false);
  });

  it("renders progress bar and count when progress and counts are set", () => {
    const base = makeBaseMessage();
    const message = {
      ...base,
      metadata: {
        ...base.metadata,
        toolProgress: {
          phase: "extracting",
          message: "Extracting",
          progress: 0.42,
          partialCount: 4,
          expectedCount: 10,
          updatedAt: Date.now(),
        },
      },
    };
    const wrapper = mount(AiChatV2Message, {
      props: { message },
      global: { mocks: { $t: (k: string) => k } },
    });
    const bar = wrapper.find(".v-progress-linear");
    expect(bar.exists()).toBe(true);
    expect(wrapper.text()).toContain("4/10");
  });
});
```

Adjust `props: { message: ... }` if the component\'s prop is named differently.

- [ ] **Step 2: Run the component tests**

Run: `yarn vitest run test/vitest/main/components/AiChatV2Message.toolProgress.test.ts 2>&1 | tail -30`
Expected: all 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add test/vitest/main/components/AiChatV2Message.toolProgress.test.ts
git commit -m "test(ai-chat-v2): cover tool progress badge rendering on tool_call cards"
```

---

## Task 8: Write the manual test doc

**Files:**
- Create: `docs/test-manual/aiChatV2-async-jobs.md`

- [ ] **Step 1: Create the doc**

Content for `docs/test-manual/aiChatV2-async-jobs.md`:

```markdown
# Manual Test: AI Chat V2 Async Tool Jobs

**Date added:** 2026-06-27
**Covers:** async tool job polling fix + running badge UI

## Setup

1. Start the dev server.
2. Open the AI Chat V2 view.
3. Ensure AI is enabled (`USER_AI_ENABLED === \'true\'`).
4. Have at least one social account configured for scraping tests.

## Test 1: Lead Researcher subagent (run_subagent — always async)

**Prompt:**

    Research Acme Corp (a fintech SMB) and report its business summary with
    source URLs.

**Expected:**
- Model calls `run_subagent`.
- Tool_call card shows a running badge: spinner + "Background job started (job_id: …)".
- Badge updates over the next 30-90 seconds as the subagent progresses.
- When the subagent finishes, the badge clears and the card shows the real result.
- The model continues the conversation, citing the subagent\'s findings (not the raw `{async:true,job_id}` envelope).

**Fail indicators:**
- Card shows "Poll with check_tool_job_status(job_id) every 15-30s." (placeholder leaked)
- Chat hangs with no progress for >2 minutes.
- Model ends its turn without referencing the subagent\'s output.

## Test 2: extract_contact_info with 8+ URLs

Provide a list of 8+ URLs in the prompt.

**Expected:**
- Tool_call card shows running badge.
- Progress count (X/Y) updates as URLs are processed.
- On completion, card shows aggregated contact info; model summarizes.

## Test 3: Stop mid-job

1. Send Test 1\'s prompt.
2. While the running badge is visible, click Stop.

**Expected:**
- Chat stops within ~100ms (not 15s).
- Tool job is cancelled in the registry.
- No orphaned `{async:true,job_id}` message remains in the UI.

## Test 4: 30-minute timeout (mocked)

Hard to test live. Either:
- (a) Temporarily set `ASYNC_POLL_MAX_MS = 30_000;` in `AIChatQueryLoop.ts`, stub the subagent to never complete, send Test 1\'s prompt, expect a timeout error message after 30s. Restore the constant afterward.
- (b) Trust the unit-test coverage from `AIChatQueryLoopAsyncPoll.test.ts`.

## Regression

Run the full Vitest suite:

    yarn vitest run test/vitest/main/

Expected: no new failures vs. baseline.
```

- [ ] **Step 2: Commit**

```bash
git add docs/test-manual/aiChatV2-async-jobs.md
git commit -m "docs(ai-chat-v2): manual test doc for async tool jobs and running badge"
```

---

## Task 9: Final regression sweep

**Files:** none modified.

- [ ] **Step 1: Run all Vitest tests**

Run: `yarn vitest run test/vitest/ 2>&1 | tail -40`
Expected: no new failures vs. the pre-change baseline.

- [ ] **Step 2: TypeScript check**

Run: `yarn vue-check 2>&1 | tail -30`
Expected: no new errors.

- [ ] **Step 3: Smoke launch**

Launch the dev server in tmux (per project hook requirement):

    tmux new-session -d -s dev "<dev command>"

Then attach and verify the chat opens and responds to a simple non-tool prompt ("hello") without regression.

- [ ] **Step 4: Commit (only if drift was found)**

If Steps 1-3 required fixes, commit them. If clean, no commit.

---

## Out-of-Scope Reminders

- Do NOT add a `cancel_tool_job` button to the tool card itself — Stop is the cancel path.
- Do NOT move `scrape_urls_from_search_engine` (Google/Yandex) to async. Separate change.
- Do NOT add a separate "Background Jobs" panel. The running badge covers the UX gap.
- Do NOT modify `ToolJobRegistry.ts` — it already supports everything needed.
