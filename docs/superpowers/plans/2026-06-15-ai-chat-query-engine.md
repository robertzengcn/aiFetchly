# AI Chat Query Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract AI chat v2 orchestration from `ai-chat-v2-ipc.ts` into a dedicated `AIChatQueryEngine` + `AIChatQueryLoop` service layer, preserving all existing behavior and renderer contracts.

**Architecture:** Two new services: `AIChatQueryEngine` owns conversation lifecycle (setup, persistence, pending state, resume), `AIChatQueryLoop` owns the model→tool→model round loop (streaming, tool execution, plan tool interception). IPC handlers become thin: AI gate, validation, event forwarding. The engine emits events through an `AIChatQueryEventSink` interface that IPC implements.

**Tech Stack:** TypeScript, Vitest, Electron IPC, OpenAI-compatible streaming API, existing SkillRegistry/SkillExecutor, existing AIChatV2Module/AIChatPlanModule.

**Reference docs:**
- PRD: `docs/ai-chat-query-engine-prd.md`
- Technical design: `docs/ai-chat-query-engine-technical-design.md`

---

## File Structure

### New files

| File | Responsibility |
| --- | --- |
| `src/service/AIChatQueryEvents.ts` | Event sink interface, engine event union, loop result union, pending turn types |
| `src/service/AIChatQueryLoop.ts` | Inner model/tool loop for one user turn; returns terminal or paused result |
| `src/service/AIChatQueryEngine.ts` | Conversation lifecycle owner: setup, persistence, pending state, resume |
| `src/service/AIChatErrorMapper.ts` | User-safe error mapping (extracted from IPC) |
| `test/vitest/main/service/AIChatQueryLoop.test.ts` | Loop unit tests with fake model/tool deps |
| `test/vitest/main/service/AIChatQueryEngine.test.ts` | Engine tests with fake modules/loop |

### Modified files

| File | Change |
| --- | --- |
| `src/main-process/communication/ai-chat-v2-ipc.ts` | Reduce to validation, AI gate, event forwarding, channel registration |

### Unchanged files (preserved contracts)

- `src/entityTypes/aiChatV2Types.ts` — `ChatV2StreamChunk` shape stays the same (no UI changes)
- `src/service/OpenAIStreamAccumulator.ts` — reused as-is
- `src/service/OpenAIChatTranscriptBuilder.ts` — reused as-is
- `src/service/PlanModePromptBuilder.ts` — reused as-is
- `src/service/PlanModeToolPolicy.ts` — reused as-is
- `src/service/PlanModeToolRegistry.ts` — reused as-is
- `src/config/skillsRegistry.ts` — reused as-is
- `src/service/SkillExecutor.ts` — reused as-is

---

## Migration Strategy

Five incremental commits. Each commit leaves the app in a working state. If any step breaks, revert that commit only.

- **Step 1:** Add types + empty shells + error mapper (no behavior change)
- **Step 2:** Extract query loop (move `continueStreamAfterTools` into `AIChatQueryLoop.run()`)
- **Step 3:** Extract engine setup (move `handleStream` body into `AIChatQueryEngine.submitMessage()`)
- **Step 4:** Extract resume paths (permission resume + plan question resume)
- **Step 5:** Final IPC cleanup (remove dead code)

---

## Step 1: Add Types, Error Mapper, and Empty Shells

**Goal:** Create the new files with full type definitions and placeholder implementations. No behavior changes yet. IPC still uses the old code.

### Task 1.1: Create AIChatQueryEvents.ts

**Files:**
- Create: `src/service/AIChatQueryEvents.ts`

- [ ] **Step 1: Write the event/result types file**

```typescript
// src/service/AIChatQueryEvents.ts
import type {
  OpenAIChatMessage,
  OpenAITool,
  ToolExecutionResult,
} from "@/api/aiChatApi";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";
import type {
  AIChatPlanQuestionView,
  AIChatPlanStateView,
  AskUserQuestionAnswer,
  AskUserQuestionPayload,
  SubmitPlanForApprovalPayload,
} from "@/entityTypes/aiChatPlanTypes";

/**
 * Sink the engine emits non-terminal and terminal events into.
 * IPC implements this to forward events to the renderer channel.
 */
export interface AIChatQueryEventSink {
  emit(event: AIChatQueryEvent): void;
}

export interface AIChatQueryStartEvent {
  type: "start";
  conversationId: string;
  messageId: string;
}

export interface AIChatQueryTokenEvent {
  type: "token";
  conversationId: string;
  messageId: string;
  contentDelta: string;
  model?: string;
}

export interface AIChatQueryRetryEvent {
  type: "retry_connect";
  conversationId: string;
  messageId: string;
  retryAttempt: number;
  retryMaxAttempts: number;
  retryDelayMs: number;
}

export interface AIChatQueryToolCallEvent {
  type: "tool_call";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
}

export interface AIChatQueryToolResultEvent {
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  fullContent: string;
  toolResult: Record<string, unknown>;
  replacesPermissionPromptForToolId?: string;
}

export interface AIChatQueryToolResultNormalEvent
  extends AIChatQueryToolResultEvent {
  type: "tool_result";
}

export interface AIChatQueryPlanBlockedToolEvent {
  type: "plan_blocked_tool";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  fullContent: string;
  planBlockedToolName: string;
  planBlockedReason?: string;
}

export interface AIChatQueryAskUserQuestionEvent {
  type: "ask_user_question";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  question: AIChatPlanQuestionView;
  planState: AIChatPlanStateView;
}

export interface AIChatQueryPlanSubmittedEvent {
  type: "plan_submitted";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  planState: AIChatPlanStateView;
}

export interface AIChatQueryCompleteEvent {
  type: "complete";
  conversationId: string;
  messageId: string;
  fullContent: string;
  model?: string;
  finishReason?: string | null;
}

export interface AIChatQueryCancelledEvent {
  type: "cancelled";
  conversationId: string;
  messageId?: string;
  fullContent: string;
}

export interface AIChatQueryErrorEvent {
  type: "error";
  conversationId: string;
  messageId?: string;
  errorMessage: string;
}

export type AIChatQueryEvent =
  | AIChatQueryStartEvent
  | AIChatQueryTokenEvent
  | AIChatQueryRetryEvent
  | AIChatQueryToolCallEvent
  | AIChatQueryToolResultNormalEvent
  | AIChatQueryPlanBlockedToolEvent
  | AIChatQueryAskUserQuestionEvent
  | AIChatQueryPlanSubmittedEvent
  | AIChatQueryCompleteEvent
  | AIChatQueryCancelledEvent
  | AIChatQueryErrorEvent;

/**
 * Result returned by AIChatQueryLoop.run().
 * The engine decides persistence and terminal event emission based on this.
 */
export type AIChatQueryLoopResult =
  | {
      type: "completed";
      fullContent: string;
      finishReason: string;
      model?: string;
      responseId?: string;
    }
  | {
      type: "cancelled";
      partialContent: string;
      model?: string;
      responseId?: string;
    }
  | {
      type: "paused_for_permission";
      pending: PendingPermissionTurn;
    }
  | {
      type: "paused_for_plan_question";
      pending: PendingPlanQuestionTurn;
    }
  | {
      type: "failed";
      error: unknown;
      partialContent: string;
      model?: string;
      responseId?: string;
    };

/** State stored when a tool needs user permission. */
export interface PendingPermissionTurn {
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  request: ChatV2StreamRequest;
  openAITools: OpenAITool[];
  nextRound: number;
  toolCallId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  planContext?: AIChatPlanLoopContext;
  eventSink: AIChatQueryEventSink;
}

/** State stored when plan mode asks the user a question. */
export interface PendingPlanQuestionTurn {
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  request: ChatV2StreamRequest;
  openAITools: OpenAITool[];
  nextRound: number;
  toolCallId: string;
  questionId: string;
  planId: string;
  eventSink: AIChatQueryEventSink;
}

/** Plan context carried through the loop. */
export interface AIChatPlanLoopContext {
  planModule: {
    saveQuestion(input: {
      conversationId: string;
      planId?: string;
      payload: AskUserQuestionPayload;
    }): Promise<AIChatPlanQuestionView>;
    submitPlanForApproval(input: {
      conversationId: string;
      planId?: string;
      payload: SubmitPlanForApprovalPayload;
    }): Promise<AIChatPlanStateView>;
    getPlanStateByPlanId(planId: string): Promise<AIChatPlanStateView | null>;
    answerQuestion(input: {
      conversationId: string;
      questionId: string;
      answers: AskUserQuestionAnswer[];
    }): Promise<{
      question: AIChatPlanQuestionView;
      planState: AIChatPlanStateView;
    }>;
  };
  planState: AIChatPlanStateView;
}

/** Loop input assembled by the engine. */
export interface AIChatQueryLoopInput {
  conversationId: string;
  assistantMessageId: string;
  messages: OpenAIChatMessage[];
  request: ChatV2StreamRequest;
  openAITools: OpenAITool[];
  abortController: AbortController;
  eventSink: AIChatQueryEventSink;
  planContext?: AIChatPlanLoopContext;
  startRound: number;
}

/** Request payload for resumeToolAfterPermission. */
export interface ResumeToolAfterPermissionRequest {
  toolId: string;
  conversationId?: string;
}

/** Request payload for answerPlanQuestion. */
export interface AnswerPlanQuestionRequest {
  questionId: string;
  conversationId: string;
  answers: AskUserQuestionAnswer[];
}

/** Result of a resume operation. */
export interface ResumeTurnResult {
  ok: boolean;
  error?: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -20`
Expected: No errors related to `AIChatQueryEvents.ts`

- [ ] **Step 3: Commit**

```bash
git add src/service/AIChatQueryEvents.ts
git commit -m "feat(ai-chat-v2): add AI chat query engine event and result types"
```

### Task 1.2: Create AIChatErrorMapper.ts

**Files:**
- Create: `src/service/AIChatErrorMapper.ts`

- [ ] **Step 1: Write the error mapper**

This extracts the existing `userSafeError` function verbatim from `ai-chat-v2-ipc.ts` (lines 1456-1480).

```typescript
// src/service/AIChatErrorMapper.ts

/**
 * Map unknown errors to user-safe messages.
 * Raw server bodies, stack traces, and sensitive request details
 * are logged but never surfaced to the renderer.
 */
export function userSafeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return "Generation stopped.";
    }
    const msg = err.message || "Unknown error";
    if (/401|403/.test(msg)) {
      return "Please sign in again.";
    }
    if (/404/.test(msg)) {
      return "Selected model is not available.";
    }
    if (/503/.test(msg)) {
      return "No chat model is configured on the AI server.";
    }
    if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(msg)) {
      return "Could not connect to the AI server.";
    }
    console.error("[ai-chat-v2] unmapped error:", msg);
    return "An unexpected error occurred. Please try again.";
  }
  return "Unknown error";
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/service/AIChatErrorMapper.ts
git commit -m "feat(ai-chat-v2): extract user-safe error mapper to its own module"
```

### Task 1.3: Create AIChatQueryLoop.ts (empty shell)

**Files:**
- Create: `src/service/AIChatQueryLoop.ts`

- [ ] **Step 1: Write the loop shell with deps interface and placeholder**

```typescript
// src/service/AIChatQueryLoop.ts
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatMessage,
  OpenAITool,
  OpenAIToolCall,
  ToolExecutionResult,
} from "@/api/aiChatApi";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { SkillDefinition } from "@/config/skillsRegistry";
import type { StreamRetryInfo } from "@/api/aiChatApi";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import {
  checkPlanModeToolPolicy,
  isPlanToolName,
} from "@/service/PlanModeToolPolicy";
import type { SkillRegistry } from "@/config/skillsRegistry";

/** Max model→tool→model rounds per user turn. */
const CHAT_V2_MAX_TOOL_ROUNDS = 8;

/** Dependencies injected into the loop for testability. */
export interface AIChatQueryLoopDeps {
  streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: {
      signal?: AbortSignal;
      onRetry?: (info: StreamRetryInfo) => void;
    }
  ): Promise<void>;

  executeTool(
    name: string,
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<ToolExecutionResult>;

  getSkillDefinition(name: string): SkillDefinition | undefined;
}

/** Serialization helpers (moved from ai-chat-v2-ipc.ts). */
function serializeToolResultContent(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      success: false,
      error: "Tool result could not be serialized",
    });
  }
}

function normalizeToolResult(
  result: ToolExecutionResult
): Record<string, unknown> {
  return {
    success: result.success,
    executionTimeMs: result.execution_time_ms,
    ...result.result,
  };
}

function isPermissionPromptResult(result: ToolExecutionResult): boolean {
  return result.result.needsPermissionPrompt === true;
}

function buildAssistantToolCallMessage(
  parsedCalls: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  }>,
  assistantContent: string
): OpenAIChatMessage {
  const toolCalls: OpenAIToolCall[] = parsedCalls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    type: "function",
    function: {
      name: call.name ?? "unknown_tool",
      arguments: JSON.stringify(call.arguments ?? {}),
    },
  }));
  return {
    role: "assistant",
    content: assistantContent || null,
    tool_calls: toolCalls,
  };
}

export class AIChatQueryLoop {
  constructor(private readonly deps: AIChatQueryLoopDeps) {}

  async run(input: AIChatQueryLoopInput): Promise<AIChatQueryLoopResult> {
    // Placeholder — implemented in Step 2.
    void input;
    throw new Error("AIChatQueryLoop.run() not implemented");
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/service/AIChatQueryLoop.ts
git commit -m "feat(ai-chat-v2): add AIChatQueryLoop shell with dependency injection interface"
```

### Task 1.4: Create AIChatQueryEngine.ts (empty shell)

**Files:**
- Create: `src/service/AIChatQueryEngine.ts`

- [ ] **Step 1: Write the engine shell**

```typescript
// src/service/AIChatQueryEngine.ts
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopResult,
  AnswerPlanQuestionRequest,
  ResumeToolAfterPermissionRequest,
  ResumeTurnResult,
} from "@/service/AIChatQueryEvents";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";

export interface AIChatQuerySubmitInput {
  eventSink: AIChatQueryEventSink;
  request: ChatV2StreamRequest;
}

export class AIChatQueryEngine {
  constructor(private readonly loop: AIChatQueryLoop) {}

  async submitMessage(input: AIChatQuerySubmitInput): Promise<void> {
    void input;
    throw new Error("AIChatQueryEngine.submitMessage() not implemented");
  }

  stopActiveTurn(): void {
    throw new Error("AIChatQueryEngine.stopActiveTurn() not implemented");
  }

  async resumeToolAfterPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error(
      "AIChatQueryEngine.resumeToolAfterPermission() not implemented"
    );
  }

  async answerPlanQuestion(
    request: AnswerPlanQuestionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error("AIChatQueryEngine.answerPlanQuestion() not implemented");
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/service/AIChatQueryEngine.ts
git commit -m "feat(ai-chat-v2): add AIChatQueryEngine shell with lifecycle method signatures"
```

### Task 1.5: Verify existing tests still pass

- [ ] **Step 1: Run the existing IPC test suite**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts 2>&1 | tail -20`
Expected: All existing tests PASS (no behavior change yet)

---

## Step 2: Extract Query Loop

**Goal:** Move the `continueStreamAfterTools()` logic from `ai-chat-v2-ipc.ts` into `AIChatQueryLoop.run()`. The loop returns a result; it does NOT persist messages or emit terminal events. The engine (still inline in IPC for now) handles persistence.

**Key behavioral change:** The loop now emits non-terminal events (token, tool_call, tool_result, plan events, retry) through the event sink, and returns a result that the caller uses to persist + emit terminal events.

### Task 2.1: Write failing test for normal streaming completion

**Files:**
- Create: `test/vitest/main/service/AIChatQueryLoop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/service/AIChatQueryLoop.test.ts
import { describe, expect, it, vi } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

function makeChunk(delta: string, finishReason?: string): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    model: "test-model",
    choices: [
      {
        delta: { content: delta },
        finish_reason: finishReason ?? null,
      },
    ],
  };
}

describe("AIChatQueryLoop", () => {
  describe("normal streaming", () => {
    it("returns completed with full content when model finishes without tool calls", async () => {
      const emitted: string[] = [];
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(makeChunk("Hello, "));
          onChunk(makeChunk("world!", "stop"));
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "assistant-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: (e) => {
          if (e.type === "token") emitted.push(e.contentDelta);
        } },
        startRound: 0,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        expect(result.fullContent).toBe("Hello, world!");
        expect(result.finishReason).toBe("stop");
        expect(result.model).toBe("test-model");
      }
      expect(emitted.join("")).toBe("Hello, world!");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryLoop.test.ts 2>&1 | tail -20`
Expected: FAIL — "AIChatQueryLoop.run() not implemented"

### Task 2.2: Implement normal streaming in AIChatQueryLoop.run()

**Files:**
- Modify: `src/service/AIChatQueryLoop.ts`

- [ ] **Step 1: Implement the run method for the streaming + completion path**

Replace the placeholder `run()` method in `AIChatQueryLoop.ts` with this implementation. This handles the core streaming loop, tool-call parsing, tool execution, plan tool interception, policy blocking, permission pause, plan question pause, max rounds, and cancellation.

```typescript
async run(input: AIChatQueryLoopInput): Promise<AIChatQueryLoopResult> {
  const { eventSink, deps } = { eventSink: input.eventSink, deps: this.deps };
  let activeAccumulator: OpenAIStreamAccumulator | null = null;
  let finalAccumulator: OpenAIStreamAccumulator | null = null;
  const messages = input.messages;

  try {
    for (
      let round = input.startRound;
      round < CHAT_V2_MAX_TOOL_ROUNDS;
      round += 1
    ) {
      const accumulator = new OpenAIStreamAccumulator();
      activeAccumulator = accumulator;

      console.log(
        `[ai-chat-v2] round ${round} → POST /chat/completions msgs=${
          messages.length
        } roles=[${messages.map((m) => m.role).join(",")}] tools=${
          input.openAITools.length
        }`
      );

      await deps.streamChatCompletion(
        {
          messages,
          model: input.request.model,
          temperature: input.request.temperature,
          max_tokens: input.request.maxTokens,
          stream: true,
          tools: input.openAITools.length > 0 ? input.openAITools : undefined,
          tool_choice: input.openAITools.length > 0 ? "auto" : undefined,
        },
        (rawChunk) => {
          if (input.abortController.signal.aborted) return;
          const delta = accumulator.ingest(rawChunk);
          if (delta) {
            eventSink.emit({
              type: "token",
              conversationId: input.conversationId,
              messageId: input.assistantMessageId,
              contentDelta: delta,
              model: accumulator.state.model,
            });
          }
        },
        {
          signal: input.abortController.signal,
          onRetry: (info) => {
            eventSink.emit({
              type: "retry_connect",
              conversationId: input.conversationId,
              messageId: input.assistantMessageId,
              retryAttempt: info.attempt,
              retryMaxAttempts: info.maxAttempts,
              retryDelayMs: info.delayMs,
            });
          },
        }
      );

      finalAccumulator = accumulator;
      const parsedCalls = accumulator
        .tryParseToolCallArguments()
        .filter((call) => call.name && call.id);

      console.log(
        `[ai-chat-v2] round ${round} ← finishReason=${
          accumulator.state.finishReason
        } parsedCalls=${parsedCalls.length} willContinue=${
          accumulator.state.finishReason === "tool_calls" &&
          parsedCalls.length > 0
        }`
      );

      if (
        accumulator.state.finishReason !== "tool_calls" ||
        parsedCalls.length === 0
      ) {
        break;
      }

      if (parsedCalls.some((call) => !call.ok)) {
        throw new Error("Tool call arguments were malformed.");
      }

      messages.push(
        buildAssistantToolCallMessage(
          parsedCalls.filter(
            (call): call is typeof call & {
              id: string;
              name: string;
              arguments: Record<string, unknown>;
            } => Boolean(call.id && call.name && call.arguments)
          ),
          accumulator.state.fullContent
        )
      );

      for (const call of parsedCalls) {
        if (!call.ok || !call.id || !call.name) {
          continue;
        }

        eventSink.emit({
          type: "tool_call",
          conversationId: input.conversationId,
          messageId: input.assistantMessageId,
          toolCallId: call.id,
          toolName: call.name,
          toolArguments: call.arguments ?? {},
        });

        // Plan tools are intercepted locally.
        if (input.planContext && isPlanToolName(call.name)) {
          if (call.name === "AskUserQuestion") {
            const paused = await this.handlePlanToolAskUserQuestion(
              input,
              messages,
              call,
              round,
              eventSink
            );
            if (paused) {
              return paused;
            }
            continue;
          }
          if (call.name === "SubmitPlanForApproval") {
            await this.handlePlanToolSubmitForApproval(
              input,
              messages,
              call,
              eventSink
            );
            continue;
          }
        }

        // Plan-mode policy gate.
        if (input.planContext && input.planContext.planState) {
          const skillDef = deps.getSkillDefinition(call.name);
          const policyDecision = checkPlanModeToolPolicy({
            toolName: call.name,
            skillPermissionCategory: skillDef?.permissionCategory,
            context: {
              conversationId: input.conversationId,
              planState: input.planContext.planState,
            },
          });
          if (!policyDecision.allowed) {
            const blockedContent = serializeToolResultContent({
              success: false,
              planApprovalRequired: true,
              reason: policyDecision.reason ?? "Plan approval required.",
            });
            eventSink.emit({
              type: "plan_blocked_tool",
              conversationId: input.conversationId,
              messageId: input.assistantMessageId,
              toolCallId: call.id,
              toolName: call.name,
              fullContent: blockedContent,
              planBlockedToolName: call.name,
              planBlockedReason: policyDecision.reason ?? undefined,
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: blockedContent,
            });
            continue;
          }
        }

        const toolResult = await deps.executeTool(call.name, call.arguments ?? {}, {
          conversationId: input.conversationId,
          toolCallId: call.id,
          args: call.arguments,
        });
        const toolPayload = normalizeToolResult(toolResult);
        const toolContent = serializeToolResultContent(toolPayload);
        console.log(
          `[ai-chat-v2] tool ${call.name} ok=${
            toolResult.success
          } needsPermission=${isPermissionPromptResult(toolResult)}`
        );

        eventSink.emit({
          type: "tool_result",
          conversationId: input.conversationId,
          messageId: input.assistantMessageId,
          toolCallId: call.id,
          toolName: call.name,
          fullContent: toolContent,
          toolResult: toolPayload,
        });

        if (isPermissionPromptResult(toolResult)) {
          return {
            type: "paused_for_permission",
            pending: {
              conversationId: input.conversationId,
              assistantMessageId: input.assistantMessageId,
              conversationMessages: messages,
              abortController: input.abortController,
              request: input.request,
              openAITools: input.openAITools,
              nextRound: round + 1,
              toolCallId: call.id,
              toolName: call.name,
              toolArguments: call.arguments ?? {},
              planContext: input.planContext,
              eventSink: eventSink,
            },
          };
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolContent,
        });
        console.log(
          `[ai-chat-v2] tool ${call.name} result pushed → round ${round} will continue`
        );
      }
    }

    if (input.abortController.signal.aborted) {
      return {
        type: "cancelled",
        partialContent: finalAccumulator?.state.fullContent ?? "",
        model: finalAccumulator?.state.model,
        responseId: finalAccumulator?.state.responseId,
      };
    }

    const fullContent = finalAccumulator?.state.fullContent ?? "";
    const finishReason = finalAccumulator?.state.finishReason ?? "stop";
    return {
      type: "completed",
      fullContent,
      finishReason,
      model: finalAccumulator?.state.model,
      responseId: finalAccumulator?.state.responseId,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        type: "cancelled",
        partialContent: activeAccumulator?.state.fullContent ?? "",
        model: activeAccumulator?.state.model,
        responseId: activeAccumulator?.state.responseId,
      };
    }
    return {
      type: "failed",
      error: err,
      partialContent: activeAccumulator?.state.fullContent ?? "",
      model: activeAccumulator?.state.model,
      responseId: activeAccumulator?.state.responseId,
    };
  }
}
```

- [ ] **Step 2: Add the plan tool handler helper methods to the class**

Add these private methods to the `AIChatQueryLoop` class (inside the class body, after `run()`):

```typescript
private async handlePlanToolAskUserQuestion(
  input: AIChatQueryLoopInput,
  messages: OpenAIChatMessage[],
  call: { id?: string; name?: string; arguments?: Record<string, unknown> },
  round: number,
  eventSink: AIChatQueryEventSink
): Promise<AIChatQueryLoopResult | null> {
  if (!input.planContext || !call.id || !call.name) return null;
  const payload = (call.arguments ?? {}) as unknown as import("@/entityTypes/aiChatPlanTypes").AskUserQuestionPayload;
  if (!payload || !Array.isArray(payload.questions)) return null;

  let questionView: import("@/entityTypes/aiChatPlanTypes").AIChatPlanQuestionView;
  try {
    questionView = await input.planContext.planModule.saveQuestion({
      conversationId: input.conversationId,
      planId: input.planContext.planState.planId,
      payload,
    });
  } catch (err) {
    console.error("[ai-chat-v2] saveQuestion failed:", err);
    const errContent = serializeToolResultContent({
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "AskUserQuestion payload was rejected.",
    });
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: errContent,
    });
    return null;
  }

  eventSink.emit({
    type: "ask_user_question",
    conversationId: input.conversationId,
    messageId: input.assistantMessageId,
    toolCallId: call.id,
    toolName: call.name,
    question: questionView,
    planState: input.planContext.planState,
  });

  const ackContent = serializeToolResultContent({
    success: true,
    status: "awaiting_answer",
    questionId: questionView.questionId,
  });
  messages.push({
    role: "tool",
    tool_call_id: call.id,
    content: ackContent,
  });

  return {
    type: "paused_for_plan_question",
    pending: {
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      conversationMessages: messages,
      abortController: input.abortController,
      request: input.request,
      openAITools: input.openAITools,
      nextRound: round + 1,
      toolCallId: call.id,
      questionId: questionView.questionId,
      planId: input.planContext.planState.planId,
      eventSink: eventSink,
    },
  };
}

private async handlePlanToolSubmitForApproval(
  input: AIChatQueryLoopInput,
  messages: OpenAIChatMessage[],
  call: { id?: string; name?: string; arguments?: Record<string, unknown> },
  eventSink: AIChatQueryEventSink
): Promise<void> {
  if (!input.planContext || !call.id) return;
  const payload = (call.arguments ??
    {}) as unknown as import("@/entityTypes/aiChatPlanTypes").SubmitPlanForApprovalPayload;
  let updatedPlan: import("@/entityTypes/aiChatPlanTypes").AIChatPlanStateView;
  try {
    updatedPlan = await input.planContext.planModule.submitPlanForApproval({
      conversationId: input.conversationId,
      planId: input.planContext.planState.planId,
      payload,
    });
  } catch (err) {
    console.error("[ai-chat-v2] submitPlanForApproval failed:", err);
    const errContent = serializeToolResultContent({
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "SubmitPlanForApproval payload was rejected.",
    });
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: errContent,
    });
    return;
  }

  eventSink.emit({
    type: "plan_submitted",
    conversationId: input.conversationId,
    messageId: input.assistantMessageId,
    toolCallId: call.id,
    toolName: call.name ?? "SubmitPlanForApproval",
    planState: updatedPlan,
  });

  const ackContent = serializeToolResultContent({
    success: true,
    status: "awaiting_approval",
    planId: updatedPlan.planId,
    version: updatedPlan.currentVersion,
  });
  messages.push({
    role: "tool",
    tool_call_id: call.id,
    content: ackContent,
  });
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryLoop.test.ts 2>&1 | tail -20`
Expected: PASS

### Task 2.3: Write tests for tool call, malformed args, max rounds, permission pause, plan question pause

**Files:**
- Modify: `test/vitest/main/service/AIChatQueryLoop.test.ts`

- [ ] **Step 1: Add tool call test**

Append to the `describe("AIChatQueryLoop", ...)` block:

```typescript
describe("tool calls", () => {
  it("executes tool and continues to next round when finish_reason is tool_calls", async () => {
    const toolCallChunk: OpenAIChatCompletionChunk = {
      id: "resp-1",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "search", arguments: '{"q":"test"}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
    };
    const finalChunk: OpenAIChatCompletionChunk = {
      id: "resp-2",
      model: "test-model",
      choices: [{ delta: { content: "Done" }, finish_reason: "stop" }],
    };
    let callCount = 0;
    const fakeStream = vi.fn(async (_req: unknown, onChunk: (c: OpenAIChatCompletionChunk) => void) => {
      if (callCount === 0) { onChunk(toolCallChunk); callCount++; }
      else { onChunk(finalChunk); }
    });
    const fakeExecute = vi.fn().mockResolvedValue({
      tool_call_id: "call-1",
      tool_name: "search",
      success: true,
      result: { answer: "found" },
      execution_time_ms: 10,
    });
    const loop = new AIChatQueryLoop({
      streamChatCompletion: fakeStream,
      executeTool: fakeExecute,
      getSkillDefinition: vi.fn().mockReturnValue(undefined),
    });
    const input: AIChatQueryLoopInput = {
      conversationId: "v2-test",
      assistantMessageId: "a-1",
      messages: [],
      request: { message: "hi" },
      openAITools: [],
      abortController: new AbortController(),
      eventSink: { emit: vi.fn() },
      startRound: 0,
    };
    const result = await loop.run(input);
    expect(result.type).toBe("completed");
    expect(fakeExecute).toHaveBeenCalledWith("search", { q: "test" }, expect.objectContaining({ toolCallId: "call-1" }));
  });

  it("returns failed for malformed tool arguments", async () => {
    const badChunk: OpenAIChatCompletionChunk = {
      id: "resp-1",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "search", arguments: '{invalid json' },
          }],
        },
        finish_reason: "tool_calls",
      }],
    };
    const fakeStream = vi.fn(async (_req: unknown, onChunk: (c: OpenAIChatCompletionChunk) => void) => {
      onChunk(badChunk);
    });
    const loop = new AIChatQueryLoop({
      streamChatCompletion: fakeStream,
      executeTool: vi.fn(),
      getSkillDefinition: vi.fn().mockReturnValue(undefined),
    });
    const input: AIChatQueryLoopInput = {
      conversationId: "v2-test",
      assistantMessageId: "a-1",
      messages: [],
      request: { message: "hi" },
      openAITools: [],
      abortController: new AbortController(),
      eventSink: { emit: vi.fn() },
      startRound: 0,
    };
    const result = await loop.run(input);
    expect(result.type).toBe("failed");
  });

  it("returns paused_for_permission when tool result needs permission", async () => {
    const toolCallChunk: OpenAIChatCompletionChunk = {
      id: "resp-1",
      model: "test-model",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "scrape", arguments: '{}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
    };
    const fakeStream = vi.fn(async (_req: unknown, onChunk: (c: OpenAIChatCompletionChunk) => void) => {
      onChunk(toolCallChunk);
    });
    const fakeExecute = vi.fn().mockResolvedValue({
      tool_call_id: "call-1",
      tool_name: "scrape",
      success: false,
      result: { needsPermissionPrompt: true },
      execution_time_ms: 1,
    });
    const loop = new AIChatQueryLoop({
      streamChatCompletion: fakeStream,
      executeTool: fakeExecute,
      getSkillDefinition: vi.fn().mockReturnValue(undefined),
    });
    const input: AIChatQueryLoopInput = {
      conversationId: "v2-test",
      assistantMessageId: "a-1",
      messages: [],
      request: { message: "hi" },
      openAITools: [],
      abortController: new AbortController(),
      eventSink: { emit: vi.fn() },
      startRound: 0,
    };
    const result = await loop.run(input);
    expect(result.type).toBe("paused_for_permission");
    if (result.type === "paused_for_permission") {
      expect(result.pending.toolCallId).toBe("call-1");
      expect(result.pending.nextRound).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryLoop.test.ts 2>&1 | tail -20`
Expected: All 4 tests PASS

### Task 2.4: Wire AIChatQueryLoop into IPC (replace continueStreamAfterTools)

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts`

This is the critical integration step. We replace the call to `continueStreamAfterTools()` with a call to `AIChatQueryLoop.run()`, and translate the loop result into the existing persistence + terminal event behavior.

- [ ] **Step 1: Create the production loop deps factory and result handler**

In `ai-chat-v2-ipc.ts`, add a new import and helper. First add the import at the top (after existing service imports):

```typescript
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import { userSafeError as userSafeErrorFromMapper } from "@/service/AIChatErrorMapper";
```

Add a helper to build the production loop:

```typescript
function createQueryLoop(): AIChatQueryLoop {
  const deps: AIChatQueryLoopDeps = {
    streamChatCompletion: (request, onChunk, options) => {
      const api = new AiChatApi();
      return api.openAIChatCompletionStream(request, onChunk, options);
    },
    executeTool: (name, args, context) => {
      return SkillExecutor.execute(name, args, context);
    },
    getSkillDefinition: (name) => SkillRegistry.getSkill(name),
  };
  return new AIChatQueryLoop(deps);
}
```

Add an event sink adapter that converts engine events to existing `ChatV2StreamChunk` renderer events:

```typescript
function createEventSink(
  event: IpcEventLike,
  conversationId: string
): AIChatQueryEventSink {
  return {
    emit: (e: AIChatQueryEvent) => {
      switch (e.type) {
        case "token":
          sendChunk(event, {
            eventType: "token",
            conversationId: e.conversationId,
            messageId: e.messageId,
            contentDelta: e.contentDelta,
            model: e.model,
          });
          break;
        case "retry_connect":
          sendChunk(event, {
            eventType: "retry_connect",
            conversationId: e.conversationId,
            messageId: e.messageId,
            retryAttempt: e.retryAttempt,
            retryMaxAttempts: e.retryMaxAttempts,
            retryDelayMs: e.retryDelayMs,
          });
          break;
        case "tool_call":
          sendChunk(event, {
            eventType: "tool_call",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            toolArguments: e.toolArguments,
          });
          break;
        case "tool_result":
          sendChunk(event, {
            eventType: "tool_result",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            toolResult: e.toolResult,
            replacesPermissionPromptForToolId: e.replacesPermissionPromptForToolId,
          });
          break;
        case "plan_blocked_tool":
          sendChunk(event, {
            eventType: "plan_blocked_tool",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            planBlockedToolName: e.planBlockedToolName,
            planBlockedReason: e.planBlockedReason,
          } as ChatV2StreamChunk);
          break;
        case "ask_user_question":
          sendChunk(event, {
            eventType: "ask_user_question",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            question: e.question,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        case "plan_submitted":
          sendChunk(event, {
            eventType: "plan_submitted",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        // start, complete, cancelled, error are handled by the caller based on loop result
      }
    },
  };
}
```

- [ ] **Step 2: Replace the `continueStreamAfterTools` call in `handleStream`**

In the `handleStream` function, replace the `try { await continueStreamAfterTools({...}) }` block (lines ~500-537) with:

```typescript
  const loop = createQueryLoop();
  const eventSink = createEventSink(event, conversationId);
  const planContext = isPlanMode && planState
    ? {
        planModule: {
          saveQuestion: (input: { conversationId: string; planId?: string; payload: import("@/entityTypes/aiChatPlanTypes").AskUserQuestionPayload }) =>
            planModule.saveQuestion(input),
          submitPlanForApproval: (input: { conversationId: string; planId?: string; payload: import("@/entityTypes/aiChatPlanTypes").SubmitPlanForApprovalPayload }) =>
            planModule.submitPlanForApproval(input),
          getPlanStateByPlanId: (planId: string) => planModule.getPlanStateByPlanId(planId),
          answerQuestion: (input: { conversationId: string; questionId: string; answers: import("@/entityTypes/aiChatPlanTypes").AskUserQuestionAnswer[] }) =>
            planModule.answerQuestion(input),
        },
        planState,
      }
    : undefined;

  const loopInput: AIChatQueryLoopInput = {
    conversationId,
    assistantMessageId,
    messages: conversationMessages,
    request: req,
    openAITools: allOpenAITools,
    abortController,
    eventSink,
    planContext,
    startRound: 0,
  };

  try {
    const result = await loop.run(loopInput);
    await handleLoopResult({
      result,
      event,
      module,
      conversationId,
      assistantMessageId,
    });
  } catch (err) {
    await handleStreamingFailure({
      event,
      module,
      conversationId,
      assistantMessageId,
      err,
    });
  } finally {
    const waitingForPermission =
      hasPendingPermissionForConversation(conversationId);
    const waitingForPlanQuestion =
      hasPendingPlanQuestionForConversation(conversationId);
    if (
      currentConversationId === conversationId &&
      !waitingForPermission &&
      !waitingForPlanQuestion
    ) {
      currentAbortController = null;
      currentConversationId = null;
    }
  }
```

- [ ] **Step 3: Add the handleLoopResult helper**

Add this function to `ai-chat-v2-ipc.ts`:

```typescript
async function handleLoopResult(args: {
  result: AIChatQueryLoopResult;
  event: IpcEventLike;
  module: AIChatV2Module;
  conversationId: string;
  assistantMessageId: string;
}): Promise<void> {
  const { result, event, module, conversationId, assistantMessageId } = args;

  switch (result.type) {
    case "completed": {
      if (result.fullContent.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: result.fullContent,
          messageId: assistantMessageId,
          model: result.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: result.responseId,
            finishReason: result.finishReason,
          },
        });
      }
      sendComplete(event, {
        eventType: "complete",
        conversationId,
        messageId: assistantMessageId,
        fullContent: result.fullContent,
        model: result.model,
        finishReason: result.finishReason,
      });
      currentAbortController = null;
      currentConversationId = null;
      break;
    }
    case "cancelled": {
      if (result.partialContent.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: result.partialContent,
          messageId: assistantMessageId,
          model: result.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: result.responseId,
            finishReason: "cancelled",
            cancelled: true,
          } as ChatV2MessageMetadata,
        });
      }
      sendComplete(event, {
        eventType: "cancelled",
        conversationId,
        messageId: result.partialContent.length > 0 ? assistantMessageId : undefined,
        fullContent: result.partialContent,
      });
      currentAbortController = null;
      currentConversationId = null;
      break;
    }
    case "failed": {
      if (result.partialContent.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: result.partialContent,
          messageId: assistantMessageId,
          model: result.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: result.responseId,
            finishReason: "error",
            error: userSafeError(result.error),
          },
        });
      }
      sendComplete(event, {
        eventType: "error",
        conversationId,
        messageId: result.partialContent.length > 0 ? assistantMessageId : undefined,
        errorMessage: userSafeError(result.error),
      });
      currentAbortController = null;
      currentConversationId = null;
      pendingPermissionState = null;
      break;
    }
    case "paused_for_permission": {
      pendingPermissionState = {
        event,
        module,
        api: new AiChatApi(),
        req: result.pending.request,
        conversationId: result.pending.conversationId,
        assistantMessageId: result.pending.assistantMessageId,
        conversationMessages: result.pending.conversationMessages,
        abortController: result.pending.abortController,
        nextRound: result.pending.nextRound,
        toolCallId: result.pending.toolCallId,
        toolName: result.pending.toolName,
        toolArguments: result.pending.toolArguments,
      };
      console.log(
        `[ai-chat-v2] tool ${result.pending.toolName} needs permission — paused (nextRound=${result.pending.nextRound})`
      );
      break;
    }
    case "paused_for_plan_question": {
      pendingPlanQuestionState = {
        event,
        module,
        planModule: new AIChatPlanModule(),
        api: new AiChatApi(),
        req: result.pending.request,
        conversationId: result.pending.conversationId,
        assistantMessageId: result.pending.assistantMessageId,
        conversationMessages: result.pending.conversationMessages,
        abortController: result.pending.abortController,
        nextRound: result.pending.nextRound,
        toolCallId: result.pending.toolCallId,
        questionId: result.pending.questionId,
        planId: result.pending.planId,
      };
      console.log(
        `[ai-chat-v2] AskUserQuestion paused (questionId=${result.pending.questionId}, nextRound=${result.pending.nextRound})`
      );
      break;
    }
  }
}
```

- [ ] **Step 4: Delete the old `continueStreamAfterTools` function**

Remove the old `continueStreamAfterTools` function (lines ~569-872) and its helpers (`handlePlanToolAskUserQuestion`, `handlePlanToolSubmitForApproval`) from `ai-chat-v2-ipc.ts` — they now live in the loop.

Also remove now-unused helpers: `serializeToolResultContent`, `normalizeToolResult`, `isPermissionPromptResult`, `buildAssistantToolCallMessage`, `toOpenAITools` (moved or no longer needed in IPC). Keep `toOpenAITools` in IPC for now if resume handlers still use it.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -30`
Expected: No errors. Fix any unused import or type mismatch errors.

- [ ] **Step 6: Run existing IPC tests to verify no regression**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts 2>&1 | tail -30`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/service/AIChatQueryLoop.ts src/service/AIChatQueryEngine.ts src/main-process/communication/ai-chat-v2-ipc.ts test/vitest/main/service/AIChatQueryLoop.test.ts
git commit -m "refactor(ai-chat-v2): extract query loop from IPC handler into AIChatQueryLoop"
```

---

## Step 3: Extract Engine Setup

**Goal:** Move the conversation lifecycle logic from `handleStream()` into `AIChatQueryEngine.submitMessage()`. Move module-level mutable state (`currentAbortController`, `currentConversationId`, `pendingPermissionState`, `pendingPlanQuestionState`) into the engine.

### Task 3.1: Write failing test for engine.submitMessage saving user message

**Files:**
- Create: `test/vitest/main/service/AIChatQueryEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/service/AIChatQueryEngine.test.ts
import { describe, expect, it, vi } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop, AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopInput, AIChatQueryLoopResult } from "@/service/AIChatQueryEvents";

// Mock AIChatV2Module
const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi.fn().mockReturnValue("v2-test-conv");
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    saveUserMessage: mockSaveUserMessage,
    getConversationMessages: mockGetConversationMessages,
    saveAssistantMessage: mockSaveAssistantMessage,
    createConversationIfNeeded: mockCreateConversationIfNeeded,
    getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
  })),
}));

vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: { getAllToolFunctions: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn().mockReturnValue("true") })),
}));

vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

function createEngineWithFakeLoop(
  fakeRun: (input: AIChatQueryLoopInput) => Promise<AIChatQueryLoopResult>
): AIChatQueryEngine {
  const fakeLoop = {
    run: fakeRun,
  } as unknown as AIChatQueryLoop;
  return new AIChatQueryEngine(fakeLoop);
}

describe("AIChatQueryEngine", () => {
  it("saves user message before calling the loop", async () => {
    const fakeRun = vi.fn().mockResolvedValue({
      type: "completed",
      fullContent: "",
      finishReason: "stop",
    });
    const engine = createEngineWithFakeLoop(fakeRun);
    const events: string[] = [];
    await engine.submitMessage({
      request: { message: "hello" },
      eventSink: { emit: (e) => events.push(e.type) },
    });
    expect(mockSaveUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello" })
    );
    expect(fakeRun).toHaveBeenCalled();
    expect(events).toContain("start");
    expect(events).toContain("complete");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -20`
Expected: FAIL — "submitMessage() not implemented"

### Task 3.2: Implement AIChatQueryEngine.submitMessage()

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts`

- [ ] **Step 1: Implement submitMessage, stopActiveTurn, and internal state**

Replace the placeholder engine shell with the full implementation. The engine owns the mutable turn state that used to be module-level in IPC.

```typescript
// src/service/AIChatQueryEngine.ts
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { AiChatApi } from "@/api/aiChatApi";
import type { OpenAITool, ToolFunction } from "@/api/aiChatApi";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { userSafeError } from "@/service/AIChatErrorMapper";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
  AIChatPlanLoopContext,
  AIChatQuerySubmitInput as _SubmitInput,
  AnswerPlanQuestionRequest,
  PendingPermissionTurn,
  PendingPlanQuestionTurn,
  ResumeToolAfterPermissionRequest,
  ResumeTurnResult,
} from "@/service/AIChatQueryEvents";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";
import type {
  AIChatPlanStateView,
  AskUserQuestionPayload,
  SubmitPlanForApprovalPayload,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";

const CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES = 30;

function isActivePlanState(plan?: AIChatPlanStateView | null): boolean {
  if (!plan) return false;
  return (
    plan.status !== "completed" &&
    plan.status !== "cancelled" &&
    plan.status !== "rejected"
  );
}

function toOpenAITools(toolFunctions: ToolFunction[]): OpenAITool[] {
  return toolFunctions
    .filter((tool) => tool.type === "function" && typeof tool.name === "string")
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
}

export interface AIChatQuerySubmitInput {
  eventSink: AIChatQueryEventSink;
  request: ChatV2StreamRequest;
}

export class AIChatQueryEngine {
  private currentAbortController: AbortController | null = null;
  private currentConversationId: string | null = null;
  private currentAssistantMessageId: string | null = null;
  private pendingPermission: PendingPermissionTurn | null = null;
  private pendingPlanQuestion: PendingPlanQuestionTurn | null = null;

  constructor(private readonly loop: AIChatQueryLoop) {}

  async submitMessage(input: AIChatQuerySubmitInput): Promise<void> {
    const { eventSink, request } = input;
    const module = new AIChatV2Module();
    const planModule = new AIChatPlanModule();

    // Resolve plan state.
    let planState: AIChatPlanStateView | null = null;
    if (request.conversationId && request.conversationId.startsWith("v2-")) {
      try {
        planState = await planModule.getPlanState(request.conversationId);
      } catch {
        // ignore
      }
    }
    const isPlanMode = request.mode === "plan" || isActivePlanState(planState);

    let conversationId: string;
    let assistantMessageId: string;
    let messages: import("@/api/aiChatApi").OpenAIChatMessage[];

    try {
      conversationId = module.createConversationIfNeeded(request.conversationId);
      this.currentConversationId = conversationId;

      if (isPlanMode) {
        if (!planState) {
          planState = await planModule.ensurePlanForConversation({
            conversationId,
            title: request.message.slice(0, 80) || "New plan",
            objective: request.message.slice(0, 500),
          });
        } else if (planState.conversationId !== conversationId) {
          planState = await planModule.getPlanState(conversationId);
        }
      }

      const savedUser = await module.saveUserMessage({
        conversationId,
        content: request.message,
      });

      const history = await module.getConversationMessages(conversationId);
      const basePrompt = request.systemPrompt ?? module.getDefaultSystemPrompt();
      const transcript = buildOpenAITranscript({
        history: history.filter((r) => r.messageId !== savedUser.messageId),
        currentUserMessage: request.message,
        systemPrompt: isPlanMode
          ? buildPlanModeSystemPrompt({ baseSystemPrompt: basePrompt, planState })
          : basePrompt,
        filterSource: "chat-v2",
        maxMessages: CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES,
      });

      assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.currentAssistantMessageId = assistantMessageId;
      messages = [...transcript.messages];
    } catch (err) {
      console.error("[ai-chat-v2] pre-stream error:", err);
      this.currentConversationId = null;
      eventSink.emit({
        type: "error",
        conversationId: request.conversationId ?? "",
        errorMessage: userSafeError(err),
      });
      return;
    }

    const toolFunctions = await SkillRegistry.getAllToolFunctions();
    const openAITools = toOpenAITools(toolFunctions);
    const allOpenAITools = isPlanMode
      ? [...openAITools, ...PlanModeToolRegistry.toOpenAITools()]
      : openAITools;

    const abortController = new AbortController();
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    this.currentAbortController = abortController;
    this.pendingPermission = null;

    eventSink.emit({
      type: "start",
      conversationId,
      messageId: assistantMessageId,
    });

    const planContext: AIChatPlanLoopContext | undefined =
      isPlanMode && planState
        ? {
            planModule: {
              saveQuestion: (inp) => planModule.saveQuestion(inp),
              submitPlanForApproval: (inp) => planModule.submitPlanForApproval(inp),
              getPlanStateByPlanId: (planId) => planModule.getPlanStateByPlanId(planId),
              answerQuestion: (inp) => planModule.answerQuestion(inp),
            },
            planState,
          }
        : undefined;

    const loopInput: AIChatQueryLoopInput = {
      conversationId,
      assistantMessageId,
      messages,
      request,
      openAITools: allOpenAITools,
      abortController,
      eventSink,
      planContext,
      startRound: 0,
    };

    try {
      const result = await this.loop.run(loopInput);
      await this.handleLoopResult(result, module, eventSink);
    } catch (err) {
      this.handleFailure(err, module, conversationId, assistantMessageId, eventSink);
    } finally {
      if (
        this.currentConversationId === conversationId &&
        !this.pendingPermission &&
        !this.pendingPlanQuestion
      ) {
        this.currentAbortController = null;
        this.currentConversationId = null;
      }
    }
  }

  stopActiveTurn(): void {
    if (this.pendingPermission) {
      const pending = this.pendingPermission;
      this.pendingPermission = null;
      this.currentAbortController = null;
      this.currentConversationId = null;
      // The eventSink is not available here in phase 1 — IPC will emit cancelled.
      void pending;
    }
    if (this.pendingPlanQuestion) {
      const pending = this.pendingPlanQuestion;
      this.pendingPlanQuestion = null;
      void pending;
    }
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.currentConversationId = null;
  }

  private async handleLoopResult(
    result: AIChatQueryLoopResult,
    module: AIChatV2Module,
    eventSink: AIChatQueryEventSink
  ): Promise<void> {
    switch (result.type) {
      case "completed": {
        if (result.fullContent.length > 0) {
          await module.saveAssistantMessage({
            conversationId: this.currentConversationId ?? "",
            content: result.fullContent,
            messageId: this.currentAssistantMessageId ?? "",
            model: result.model,
            metadata: {
              source: "chat-v2",
              openaiResponseId: result.responseId,
              finishReason: result.finishReason,
            },
          });
        }
        eventSink.emit({
          type: "complete",
          conversationId: this.currentConversationId ?? "",
          messageId: this.currentAssistantMessageId ?? "",
          fullContent: result.fullContent,
          model: result.model,
          finishReason: result.finishReason,
        });
        this.currentAbortController = null;
        this.currentConversationId = null;
        break;
      }
      case "cancelled": {
        if (result.partialContent.length > 0) {
          await module.saveAssistantMessage({
            conversationId: this.currentConversationId ?? "",
            content: result.partialContent,
            messageId: this.currentAssistantMessageId ?? "",
            model: result.model,
            metadata: {
              source: "chat-v2",
              openaiResponseId: result.responseId,
              finishReason: "cancelled",
              cancelled: true,
            },
          });
        }
        eventSink.emit({
          type: "cancelled",
          conversationId: this.currentConversationId ?? "",
          messageId: result.partialContent.length > 0 ? this.currentAssistantMessageId ?? undefined : undefined,
          fullContent: result.partialContent,
        });
        this.currentAbortController = null;
        this.currentConversationId = null;
        break;
      }
      case "failed": {
        if (result.partialContent.length > 0) {
          await module.saveAssistantMessage({
            conversationId: this.currentConversationId ?? "",
            content: result.partialContent,
            messageId: this.currentAssistantMessageId ?? "",
            model: result.model,
            metadata: {
              source: "chat-v2",
              openaiResponseId: result.responseId,
              finishReason: "error",
              error: userSafeError(result.error),
            },
          });
        }
        eventSink.emit({
          type: "error",
          conversationId: this.currentConversationId ?? "",
          messageId: result.partialContent.length > 0 ? this.currentAssistantMessageId ?? undefined : undefined,
          errorMessage: userSafeError(result.error),
        });
        this.currentAbortController = null;
        this.currentConversationId = null;
        this.pendingPermission = null;
        break;
      }
      case "paused_for_permission": {
        this.pendingPermission = result.pending;
        break;
      }
      case "paused_for_plan_question": {
        this.pendingPlanQuestion = result.pending;
        break;
      }
    }
  }

  private handleFailure(
    err: unknown,
    module: AIChatV2Module,
    conversationId: string,
    assistantMessageId: string,
    eventSink: AIChatQueryEventSink
  ): void {
    console.error("[ai-chat-v2] engine failure:", err);
    eventSink.emit({
      type: "error",
      conversationId,
      messageId: assistantMessageId,
      errorMessage: userSafeError(err),
    });
    this.currentAbortController = null;
    this.currentConversationId = null;
    this.pendingPermission = null;
    void module;
  }

  async resumeToolAfterPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error("Not implemented in step 3");
  }

  async answerPlanQuestion(
    request: AnswerPlanQuestionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error("Not implemented in step 3");
  }
}
```

**Note:** The engine tracks `currentConversationId` and `currentAssistantMessageId` as fields so that `handleLoopResult` can persist with the correct IDs. These are set during `submitMessage()` setup and cleared on completion/cancellation/failure.

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -20`
Expected: PASS

### Task 3.3: Wire engine into IPC handleStream

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts`

- [ ] **Step 1: Create a singleton engine instance and replace handleStream body**

At the module level in `ai-chat-v2-ipc.ts`, replace the module-level mutable state with a singleton engine:

```typescript
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryEventSink, AIChatQueryEvent } from "@/service/AIChatQueryEvents";

// Singleton engine — owns all turn state that used to be module-level.
let queryEngine: AIChatQueryEngine | null = null;

function getQueryEngine(): AIChatQueryEngine {
  if (!queryEngine) {
    const loop = createQueryLoop();
    queryEngine = new AIChatQueryEngine(loop);
  }
  return queryEngine;
}
```

Replace the body of `handleStream` (after the AI gate + parse + validation) with:

```typescript
async function handleStream(event: IpcEventLike, data: string): Promise<void> {
  if (!isAIEnabled()) {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "AI is not enabled",
    });
    return;
  }

  let req: ChatV2StreamRequest;
  try {
    req = JSON.parse(data ?? "{}");
  } catch {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "Invalid request payload",
    });
    return;
  }

  const validationError = validateStreamRequest(req);
  if (validationError) {
    sendComplete(event, {
      eventType: "error",
      conversationId: req.conversationId ?? "",
      errorMessage: validationError,
    });
    return;
  }

  const engine = getQueryEngine();
  const eventSink = createEventSink(event);

  await engine.submitMessage({ request: req, eventSink });
}
```

- [ ] **Step 2: Update createEventSink to handle terminal events too**

The event sink now needs to handle ALL event types including `start`, `complete`, `cancelled`, and `error` (since the engine emits these). Update `createEventSink`:

```typescript
function createEventSink(event: IpcEventLike): AIChatQueryEventSink {
  return {
    emit: (e: AIChatQueryEvent) => {
      switch (e.type) {
        case "start":
          sendChunk(event, {
            eventType: "start",
            conversationId: e.conversationId,
            messageId: e.messageId,
          });
          break;
        case "token":
          sendChunk(event, {
            eventType: "token",
            conversationId: e.conversationId,
            messageId: e.messageId,
            contentDelta: e.contentDelta,
            model: e.model,
          });
          break;
        case "retry_connect":
          sendChunk(event, {
            eventType: "retry_connect",
            conversationId: e.conversationId,
            messageId: e.messageId,
            retryAttempt: e.retryAttempt,
            retryMaxAttempts: e.retryMaxAttempts,
            retryDelayMs: e.retryDelayMs,
          });
          break;
        case "tool_call":
          sendChunk(event, {
            eventType: "tool_call",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            toolArguments: e.toolArguments,
          });
          break;
        case "tool_result":
          sendChunk(event, {
            eventType: "tool_result",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            toolResult: e.toolResult,
            replacesPermissionPromptForToolId: e.replacesPermissionPromptForToolId,
          });
          break;
        case "plan_blocked_tool":
          sendChunk(event, {
            eventType: "plan_blocked_tool",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            planBlockedToolName: e.planBlockedToolName,
            planBlockedReason: e.planBlockedReason,
          } as ChatV2StreamChunk);
          break;
        case "ask_user_question":
          sendChunk(event, {
            eventType: "ask_user_question",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            question: e.question,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        case "plan_submitted":
          sendChunk(event, {
            eventType: "plan_submitted",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        case "complete":
          sendComplete(event, {
            eventType: "complete",
            conversationId: e.conversationId,
            messageId: e.messageId,
            fullContent: e.fullContent,
            model: e.model,
            finishReason: e.finishReason,
          });
          break;
        case "cancelled":
          sendComplete(event, {
            eventType: "cancelled",
            conversationId: e.conversationId,
            messageId: e.messageId,
            fullContent: e.fullContent,
          });
          break;
        case "error":
          sendComplete(event, {
            eventType: "error",
            conversationId: e.conversationId,
            messageId: e.messageId,
            errorMessage: e.errorMessage,
          });
          break;
      }
    },
  };
}
```

- [ ] **Step 3: Update handleStop to call engine.stopActiveTurn()**

```typescript
function handleStop(): void {
  // For cancelled events on pending permission/plan, we need the event sink.
  // In phase 1, keep this simple — the engine clears state, and we emit
  // cancelled through the engine's stored event sink if available.
  getQueryEngine().stopActiveTurn();
}
```

Note: The stop path needs access to the event sink for the pending turn. In phase 1, the engine stores the eventSink reference as part of pending state. This will be properly handled in Step 4 when we move pending state into the engine. For now, the abort controller handles the streaming case.

- [ ] **Step 4: Remove old module-level state and helpers from IPC**

Remove from `ai-chat-v2-ipc.ts`:
- `let currentAbortController` / `let currentConversationId`
- `let pendingPermissionState` / `let pendingPlanQuestionState`
- `hasPendingPermissionForConversation` / `hasPendingPlanQuestionForConversation`
- `handleLoopResult` (now in engine)
- `handleStreamingFailure` (now in engine)
- `isActivePlanState` (now in engine)
- `continueStreamAfterTools` type and references
- All tool serialization helpers that moved to the loop

Keep in IPC:
- `isAIEnabled`, `denied`, `ok`, `sendChunk`, `sendComplete`
- `validateStreamRequest`
- `toOpenAITools` (if still needed by resume handlers — remove if not)
- `userSafeError` (delegate to `AIChatErrorMapper` for new code, keep local for remaining handlers)
- `parseMetadata`
- All plan IPC handlers (`handlePlanState`, `handleApprovePlan`, `handleRejectPlan`, `handleRequestPlanChanges`, `handlePlanVersions`)
- `handleModels`, `handleConversations`, `handleHistory`, `handleClearConversation`, `handleClearAll`

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Run existing IPC tests**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts 2>&1 | tail -30`
Expected: Tests may need updating since the internal structure changed. Update mocks if needed. Tests should PASS after adjustment.

- [ ] **Step 7: Commit**

```bash
git add src/service/AIChatQueryEngine.ts src/main-process/communication/ai-chat-v2-ipc.ts test/vitest/main/service/AIChatQueryEngine.test.ts test/vitest/main/ipc/ai-chat-v2-ipc.test.ts
git commit -m "refactor(ai-chat-v2): extract conversation lifecycle into AIChatQueryEngine"
```

---

## Step 4: Extract Resume Paths

**Goal:** Move `handleResumeToolAfterPermission` and `handleAnswerQuestion` resume logic into the engine.

### Task 4.1: Write failing test for resumeToolAfterPermission

**Files:**
- Modify: `test/vitest/main/service/AIChatQueryEngine.test.ts`

- [ ] **Step 1: Add the resume test**

```typescript
describe("resumeToolAfterPermission", () => {
  it("returns ok:false when no pending permission exists", async () => {
    const fakeRun = vi.fn();
    const engine = createEngineWithFakeLoop(fakeRun);
    const result = await engine.resumeToolAfterPermission({
      toolId: "call-1",
      conversationId: "v2-test",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -20`
Expected: FAIL — throws "Not implemented"

### Task 4.2: Implement resumeToolAfterPermission in engine

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts`

- [ ] **Step 1: Implement the resume method**

The engine needs to re-enter the loop with the pending state. The pending turn already includes `eventSink` (added in Task 1.1). Implement resume in the engine:

```typescript
async resumeToolAfterPermission(
  request: ResumeToolAfterPermissionRequest
): Promise<ResumeTurnResult> {
  const pending = this.pendingPermission;
  if (!pending || pending.toolCallId !== request.toolId) {
    return { ok: false, error: "No active permission-gated tool call to continue." };
  }
  if (request.conversationId && request.conversationId !== pending.conversationId) {
    return { ok: false, error: "Conversation mismatch for pending tool call." };
  }

  this.pendingPermission = null;
  this.currentAbortController = pending.abortController;
  this.currentConversationId = pending.conversationId;
  this.currentAssistantMessageId = pending.assistantMessageId;

  const module = new AIChatV2Module();
  try {
    const toolResult = await SkillExecutor.execute(
      pending.toolName,
      pending.toolArguments,
      {
        conversationId: pending.conversationId,
        toolCallId: pending.toolCallId,
        args: pending.toolArguments,
        skipPermissionCheck: true,
      }
    );

    // Serialize result.
    const toolPayload = {
      success: toolResult.success,
      executionTimeMs: toolResult.execution_time_ms,
      ...toolResult.result,
    };
    let toolContent: string;
    try {
      toolContent = JSON.stringify(toolPayload);
    } catch {
      toolContent = JSON.stringify({ success: false, error: "Tool result could not be serialized" });
    }

    pending.eventSink.emit({
      type: "tool_result",
      conversationId: pending.conversationId,
      messageId: pending.assistantMessageId,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      fullContent: toolContent,
      toolResult: toolPayload,
      replacesPermissionPromptForToolId: pending.toolCallId,
    });

    if (toolResult.result.needsPermissionPrompt === true) {
      this.pendingPermission = pending;
      return { ok: false, error: "Permission is still required for this tool." };
    }

    pending.conversationMessages.push({
      role: "tool",
      tool_call_id: pending.toolCallId,
      content: toolContent,
    });

    const loopInput: AIChatQueryLoopInput = {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      messages: pending.conversationMessages,
      request: pending.request,
      openAITools: pending.openAITools,
      abortController: pending.abortController,
      eventSink: pending.eventSink,
      planContext: pending.planContext,
      startRound: pending.nextRound,
    };

    void this.loop.run(loopInput).then((result) => {
      this.handleLoopResult(result, module, pending.eventSink);
    });

    return { ok: true };
  } catch (err) {
    this.pendingPermission = null;
    this.currentAbortController = null;
    this.currentConversationId = null;
    return { ok: false, error: userSafeError(err) };
  }
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -20`
Expected: PASS

### Task 4.3: Implement answerPlanQuestion in engine

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts`

- [ ] **Step 1: Implement answerPlanQuestion**

```typescript
async answerPlanQuestion(
  request: AnswerPlanQuestionRequest
): Promise<ResumeTurnResult> {
  const pending = this.pendingPlanQuestion;
  const planModule = new AIChatPlanModule();

  let answered;
  try {
    answered = await planModule.answerQuestion({
      conversationId: request.conversationId,
      questionId: request.questionId,
      answers: request.answers,
    });
  } catch (err) {
    return { ok: false, error: userSafeError(err) };
  }

  if (
    pending &&
    pending.questionId === request.questionId &&
    pending.conversationId === request.conversationId
  ) {
    this.pendingPlanQuestion = null;

    let answerContent: string;
    try {
      answerContent = JSON.stringify({
        success: true,
        status: "answered",
        questionId: answered.questionId,
        answers: request.answers,
      });
    } catch {
      answerContent = JSON.stringify({ success: true, status: "answered" });
    }

    const toolMsgIndex = pending.conversationMessages.findIndex(
      (m) => m.role === "tool" && m.tool_call_id === pending.toolCallId
    );
    if (toolMsgIndex >= 0) {
      pending.conversationMessages[toolMsgIndex] = {
        role: "tool",
        tool_call_id: pending.toolCallId,
        content: answerContent,
      };
    } else {
      pending.conversationMessages.push({
        role: "tool",
        tool_call_id: pending.toolCallId,
        content: answerContent,
      });
    }

    this.currentAbortController = pending.abortController;
    this.currentConversationId = pending.conversationId;
    this.currentAssistantMessageId = pending.assistantMessageId;

    const planState = await planModule.getPlanStateByPlanId(pending.planId);
    const toolFunctions = await SkillRegistry.getAllToolFunctions();
    const allOpenAITools = [
      ...toOpenAITools(toolFunctions),
      ...PlanModeToolRegistry.toOpenAITools(),
    ];

    const planContext: AIChatPlanLoopContext | undefined = planState
      ? {
          planModule: {
            saveQuestion: (inp) => planModule.saveQuestion(inp),
            submitPlanForApproval: (inp) => planModule.submitPlanForApproval(inp),
            getPlanStateByPlanId: (pid) => planModule.getPlanStateByPlanId(pid),
            answerQuestion: (inp) => planModule.answerQuestion(inp),
          },
          planState,
        }
      : undefined;

    const loopInput: AIChatQueryLoopInput = {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      messages: pending.conversationMessages,
      request: pending.request,
      openAITools: allOpenAITools,
      abortController: pending.abortController,
      eventSink: pending.eventSink,
      planContext,
      startRound: pending.nextRound,
    };

    const module = new AIChatV2Module();
    void this.loop.run(loopInput).then((result) => {
      this.handleLoopResult(result, module, pending.eventSink);
    });
  }

  return { ok: true };
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -20`
Expected: PASS

### Task 4.4: Wire resume paths into IPC

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts`

- [ ] **Step 1: Update handleResumeToolAfterPermission and handleAnswerQuestion to delegate to engine**

Replace `handleResumeToolAfterPermission` with:

```typescript
async function handleResumeToolAfterPermission(
  data: string
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data
    ? (JSON.parse(data) as { toolId?: string; conversationId?: string })
    : {};
  if (!parsed.toolId || typeof parsed.toolId !== "string") {
    return denied("toolId is required");
  }
  const engine = getQueryEngine();
  const result = await engine.resumeToolAfterPermission({
    toolId: parsed.toolId,
    conversationId: parsed.conversationId,
  });
  return ok(result);
}
```

Replace the resume portion of `handleAnswerQuestion`:

```typescript
async function handleAnswerQuestion(
  data: string
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data
    ? (JSON.parse(data) as {
        questionId?: string;
        answers?: AskUserQuestionAnswer[];
        conversationId?: string;
      })
    : {};
  if (!parsed.questionId || typeof parsed.questionId !== "string") {
    return denied("questionId is required");
  }
  if (!parsed.conversationId || typeof parsed.conversationId !== "string") {
    return denied("conversationId is required");
  }
  if (!Array.isArray(parsed.answers)) {
    return denied("answers must be an array");
  }

  const engine = getQueryEngine();
  const result = await engine.answerPlanQuestion({
    questionId: parsed.questionId,
    conversationId: parsed.conversationId,
    answers: parsed.answers,
  });
  return ok(result);
}
```

- [ ] **Step 2: Update handleStop to handle pending state cancellation properly**

The engine's `stopActiveTurn` needs to emit cancelled events for pending permission/plan. Update the engine to store the eventSink as part of pending state (already done in Task 4.2) and emit cancelled in stopActiveTurn:

```typescript
stopActiveTurn(): void {
  if (this.pendingPermission) {
    const pending = this.pendingPermission;
    this.pendingPermission = null;
    pending.eventSink.emit({
      type: "cancelled",
      conversationId: pending.conversationId,
      messageId: pending.assistantMessageId,
      fullContent: "",
    });
  }
  if (this.pendingPlanQuestion) {
    const pending = this.pendingPlanQuestion;
    this.pendingPlanQuestion = null;
    pending.eventSink.emit({
      type: "cancelled",
      conversationId: pending.conversationId,
      messageId: pending.assistantMessageId,
      fullContent: "",
    });
  }
  if (this.currentAbortController) {
    this.currentAbortController.abort();
    this.currentAbortController = null;
  }
  this.currentConversationId = null;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Run all AI chat v2 tests**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts test/vitest/main/service/AIChatQueryLoop.test.ts test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -30`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatQueryEngine.ts src/service/AIChatQueryEvents.ts src/main-process/communication/ai-chat-v2-ipc.ts test/vitest/main/service/AIChatQueryEngine.test.ts
git commit -m "refactor(ai-chat-v2): move resume flows into query engine"
```

---

## Step 5: Final IPC Cleanup

**Goal:** Remove all dead code from `ai-chat-v2-ipc.ts`. Ensure it only validates, gates, forwards events, and registers channels.

### Task 5.1: Remove dead code and verify

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts`

- [ ] **Step 1: Remove all unused functions and imports**

After Steps 2-4, the following should be removed from `ai-chat-v2-ipc.ts` if not already removed:
- `serializeToolResultContent`, `normalizeToolResult`, `isPermissionPromptResult`, `buildAssistantToolCallMessage`
- `continueStreamAfterTools` and its type `ContinueStreamState`
- `handlePlanToolAskUserQuestion`, `handlePlanToolSubmitForApproval`
- `handleStreamingFailure`
- `handleLoopResult`
- `isActivePlanState`
- `toOpenAITools` (if no longer used)
- `userSafeError` local function — replace remaining usages with import from `AIChatErrorMapper`
- Unused imports (AiChatApi if not used directly, SkillExecutor if not used directly, etc.)

Keep:
- `isAIEnabled`, `denied`, `ok`, `sendChunk`, `sendComplete`
- `validateStreamRequest`
- `handleStream` (now thin)
- `handleStop` (now thin)
- `handleResumeToolAfterPermission` (now thin)
- `handleModels`, `handleConversations`, `handleHistory`, `handleClearConversation`, `handleClearAll`
- `handlePlanState`, `handleAnswerQuestion`, `handleApprovePlan`, `handleRejectPlan`, `handleRequestPlanChanges`, `handlePlanVersions`
- `parseMetadata`
- `registerAiChatV2IpcHandlers`
- `createEventSink`, `createQueryLoop`, `getQueryEngine`

- [ ] **Step 2: Verify TypeScript compiles with no unused-variable warnings**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn tsc 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Run all AI chat v2 tests**

Run: `cd /home/robertzeng/project/aiFetchly/.claude/worktrees/openai-chat-v2 && yarn vitest run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts test/vitest/main/service/AIChatQueryLoop.test.ts test/vitest/main/service/AIChatQueryEngine.test.ts 2>&1 | tail -30`
Expected: All PASS

- [ ] **Step 4: Verify line count reduction**

Run: `wc -l src/main-process/communication/ai-chat-v2-ipc.ts`
Expected: Under 400 lines (down from 1547)

- [ ] **Step 5: Commit**

```bash
git add src/main-process/communication/ai-chat-v2-ipc.ts
git commit -m "refactor(ai-chat-v2): simplify IPC handler to validation and event forwarding"
```

---

## Self-Review Checklist

After completing all steps, verify:

- [ ] `ai-chat-v2-ipc.ts` contains NO model/tool loop logic
- [ ] `ai-chat-v2-ipc.ts` contains NO direct database access
- [ ] `AIChatQueryLoop.run()` can be unit tested without Electron IPC
- [ ] `AIChatQueryEngine.submitMessage()` can be unit tested with a fake loop
- [ ] `ChatV2StreamChunk` renderer contract is unchanged (no UI changes)
- [ ] `knowledge_library_search` remains a normal tool via SkillRegistry
- [ ] One-active-stream model is preserved
- [ ] No `any` types introduced
- [ ] All existing tests pass
- [ ] Permission pause/resume works
- [ ] Plan question pause/resume works
- [ ] Plan policy blocking works
- [ ] Stop/cancel saves partial content
- [ ] Error handling produces user-safe messages

## Manual Verification

After all commits, manually test:
1. Normal chat message → streaming response completes
2. Stop mid-stream → partial content saved
3. Tool call (e.g. search) → executes and continues
4. `knowledge_library_search` → returns results
5. Permission-gated tool → pauses, approve → resumes
6. Plan mode → ask question → answer → continues
7. Plan mode → submit plan → approve → high-impact tools unblocked
8. Plan mode → high-impact tool before approval → blocked
