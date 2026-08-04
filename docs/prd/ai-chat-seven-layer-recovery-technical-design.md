# AI Chat V2 Seven-Layer Recovery Technical Design

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-02 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/ai-chat-seven-layer-recovery-strategy.md` |
| Primary code paths | `src/api/aiChatApi.ts`, `src/service/AIChatQueryEngine.ts`, `src/service/AIChatQueryLoop.ts`, `src/service/AIChatContextAssembler.ts`, `src/main-process/communication/ai-chat-v2-ipc.ts`, `src/views/components/aiChatV2/AiChatV2.vue` |

---

## 1. Purpose

This document translates the AI Chat V2 seven-layer recovery PRD into an implementation-facing technical design.

The design keeps the current AI Chat V2 architecture intact:

```text
Renderer
  -> src/views/api/aiChatV2.ts
  -> src/main-process/communication/ai-chat-v2-ipc.ts
  -> src/service/AIChatQueryEngine.ts
  -> src/service/AIChatQueryLoop.ts
  -> src/api/aiChatApi.ts
  -> remote OpenAI-compatible AI server
```

The core change is to add typed recovery services and state around the existing flow. IPC remains thin. The renderer displays recovery state. The API layer classifies transport failures. The engine owns turn-level recovery metadata. The loop owns model-call recovery and tool safety.

## 2. Current Behavior To Preserve

### 2.1 AI Gate

All AI IPC handlers must still check `USER_AI_ENABLED` through `Token` before parsing user payloads or calling AI services.

Current example:

```typescript
async function handleStream(event: IpcEventLike, data: string): Promise<void> {
  if (!isAIEnabled()) {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "AI functionality is only available to subscribers.",
    });
    return;
  }
  // parse payload only after AI gate
}
```

This ordering must not change.

### 2.2 Local Persistence Ownership

AI Chat V2 uses local SQLite through the existing module/model architecture:

- IPC calls service/module methods.
- Modules call models.
- Models use TypeORM.
- Worker processes do not access the database.

Recovery metadata can be stored in existing assistant message metadata for v1. A new audit table is not required for the first implementation.

### 2.3 Query Engine Boundary

`AIChatQueryEngine` remains responsible for:

- conversation creation,
- plan state resolution,
- user message persistence,
- context assembly,
- active abort controller,
- final assistant persistence,
- pending permission and pending plan-question state.

### 2.4 Query Loop Boundary

`AIChatQueryLoop` remains responsible for:

- OpenAI-compatible model rounds,
- streamed token accumulation,
- streamed tool-call buffering,
- tool execution,
- plan tool interception,
- malformed tool-call feedback,
- max-round enforcement.

## 3. Design Overview

Add five recovery-focused service files:

```text
src/service/AIChatRecoveryTypes.ts
src/service/AIChatRecoveryClassifier.ts
src/service/AIChatRetryPolicy.ts
src/service/AIChatRecoveryCoordinator.ts
src/service/AIChatModelFallbackService.ts
src/service/AIChatContextRecoveryService.ts
```

Update existing surfaces:

```text
src/api/aiChatApi.ts
src/service/AIChatQueryEvents.ts
src/service/AIChatQueryEngine.ts
src/service/AIChatQueryLoop.ts
src/service/AIChatContextAssembler.ts
src/entityTypes/aiChatV2Types.ts
src/main-process/communication/ai-chat-v2-ipc.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/lang/{en,zh,es,fr,de,ja}.ts
```

High-level flow:

```text
AIChatQueryEngine.submitMessage()
  create RecoveryAttemptState
  assemble initial context
  run AIChatQueryLoop with recoveryState

AIChatQueryLoop.run()
  call AiChatApi.openAIChatCompletionStream()
    API retries connection/status errors using RetryPolicy
    emits recovery_status during waits
    throws typed AIChatRecoverableError if exhausted
  handle output-limit/context/model errors with RecoveryCoordinator
  resume model round when coordinator returns a safe retry action

AIChatQueryEngine.handleLoopResult()
  persist final assistant once
  attach recovery metadata
  clear recovery state
```

## 4. Recovery Type System

Create `src/service/AIChatRecoveryTypes.ts`.

### 4.1 Recovery Layers

```typescript
export type AIChatRecoveryLayer =
  | "api_retry"
  | "overload_retry"
  | "output_token_recovery"
  | "reactive_compact"
  | "context_collapse_drain"
  | "model_fallback"
  | "persistent_retry";
```

### 4.2 Recovery Reasons

```typescript
export type AIChatRecoveryReason =
  | "network"
  | "timeout"
  | "rate_limit"
  | "overload"
  | "server_error"
  | "output_limit"
  | "context_overflow"
  | "media_overflow"
  | "model_unavailable"
  | "auth"
  | "quota"
  | "cancelled"
  | "non_recoverable";
```

### 4.3 Recovery Error

The API and loop need a structured error instead of parsing arbitrary strings.

```typescript
export interface AIChatRecoverableErrorDetails {
  readonly reason: AIChatRecoveryReason;
  readonly status?: number;
  readonly message: string;
  readonly retryAfterMs?: number;
  readonly rateLimitResetMs?: number;
  readonly responseBody?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly originalError?: unknown;
}

export class AIChatRecoverableError extends Error {
  readonly reason: AIChatRecoveryReason;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly rateLimitResetMs?: number;
  readonly responseBody?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly originalError?: unknown;

  constructor(details: AIChatRecoverableErrorDetails) {
    super(details.message);
    this.name = "AIChatRecoverableError";
    this.reason = details.reason;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    this.rateLimitResetMs = details.rateLimitResetMs;
    this.responseBody = details.responseBody;
    this.headers = details.headers;
    this.originalError = details.originalError;
  }
}
```

### 4.4 Recovery Status Event

Add to `AIChatQueryEvents.ts`:

```typescript
export interface AIChatQueryRecoveryStatusEvent {
  type: "recovery_status";
  conversationId: string;
  messageId: string;
  recoveryLayer: AIChatRecoveryLayer;
  recoveryReason: AIChatRecoveryReason;
  attempt: number;
  maxAttempts?: number;
  delayMs?: number;
  elapsedMs?: number;
  originalModel?: string;
  currentModel?: string;
  fallbackModel?: string;
  message: string;
}
```

Add it to `AIChatQueryEvent`.

Add to `entityTypes/aiChatV2Types.ts`:

```typescript
export type ChatV2StreamEventType =
  | ...
  | "recovery_status";

export interface ChatV2StreamChunk {
  ...
  recoveryLayer?: AIChatRecoveryLayer;
  recoveryReason?: AIChatRecoveryReason;
  recoveryAttempt?: number;
  recoveryMaxAttempts?: number;
  recoveryDelayMs?: number;
  recoveryElapsedMs?: number;
  recoveryOriginalModel?: string;
  recoveryCurrentModel?: string;
  recoveryFallbackModel?: string;
  recoveryMessage?: string;
}
```

Keep the existing `retry_connect` fields for backward compatibility during Phase 1.

### 4.5 Recovery Attempt State

This state is per assistant turn.

```typescript
export interface AIChatRecoveryAttemptRecord {
  readonly layer: AIChatRecoveryLayer;
  readonly reason: AIChatRecoveryReason;
  readonly attempt: number;
  readonly delayMs?: number;
  readonly model?: string;
  readonly at: number;
}

export interface AIChatRecoveryAttemptState {
  readonly turnStartedAt: number;
  originalModel?: string;
  currentModel?: string;
  maxTokensOverride?: number;
  outputEscalationAttempted: boolean;
  outputContinuationCount: number;
  reactiveCompactAttempted: boolean;
  contextDrainAttempted: boolean;
  consecutiveOverloadCount: number;
  persistentStartedAt?: number;
  sideEffectBoundaryCrossed: boolean;
  records: AIChatRecoveryAttemptRecord[];
}
```

Create helper:

```typescript
export function createRecoveryAttemptState(model?: string): AIChatRecoveryAttemptState {
  return {
    turnStartedAt: Date.now(),
    originalModel: model,
    currentModel: model,
    outputEscalationAttempted: false,
    outputContinuationCount: 0,
    reactiveCompactAttempted: false,
    contextDrainAttempted: false,
    consecutiveOverloadCount: 0,
    sideEffectBoundaryCrossed: false,
    records: [],
  };
}
```

## 5. Error Classification

Create `src/service/AIChatRecoveryClassifier.ts`.

### 5.1 Responsibilities

The classifier maps raw status codes, headers, response bodies, thrown network errors, and stream finish reasons into `AIChatRecoverableError`.

It must never decide whether to retry. It only classifies.

### 5.2 API

```typescript
export interface ClassifyHttpFailureInput {
  readonly status: number;
  readonly statusText?: string;
  readonly responseBody?: string;
  readonly headers?: Headers;
}

export interface ClassifyStreamFinishInput {
  readonly finishReason?: string | null;
  readonly fullContent: string;
  readonly sawToolCallDelta: boolean;
  readonly rawToolArguments?: readonly string[];
}

export class AIChatRecoveryClassifier {
  classifyThrown(error: unknown): AIChatRecoverableError;
  classifyHttpFailure(input: ClassifyHttpFailureInput): AIChatRecoverableError;
  classifyStreamFinish(input: ClassifyStreamFinishInput): AIChatRecoverableError | null;
}
```

### 5.3 Classification Rules

HTTP:

| Condition | Reason |
|-----------|--------|
| `status === 401 || status === 403` | `auth` |
| `status === 402` or body contains quota markers | `quota` |
| `status === 408` | `timeout` |
| `status === 409` | `timeout` |
| `status === 413` and body indicates media | `media_overflow` |
| `status === 413` otherwise | `context_overflow` |
| `status === 429` | `rate_limit` |
| `status === 404 || status === 410` | `model_unavailable` |
| `status === 529` | `overload` |
| `status >= 500` | `server_error` |

Body text:

| Pattern | Reason |
|---------|--------|
| `overloaded_error` | `overload` |
| `input length` and `context limit` | `context_overflow` |
| `Prompt Too Long` | `context_overflow` |
| `max_output_tokens` | `output_limit` |
| `max_tokens` and `exceed context limit` | `context_overflow` |

Thrown errors:

| Pattern | Reason |
|---------|--------|
| `AbortError` | `cancelled` |
| `ECONNRESET`, `EPIPE`, `ECONNREFUSED`, `fetch failed`, `Failed to fetch` | `network` |
| `timeout`, `ETIMEDOUT` | `timeout` |

Stream finish:

| Condition | Reason |
|-----------|--------|
| `finishReason === "length"` | `output_limit` |
| `finishReason === "max_tokens"` | `output_limit` |
| `finishReason === "error"` and empty content | `server_error` |
| saw tool call delta but no parseable tool call | `output_limit` when raw JSON looks truncated, otherwise `non_recoverable` |
| empty content and no finish reason | `server_error` |

### 5.4 Header Parsing

Support:

- `Retry-After`: seconds or HTTP date.
- `x-should-retry`: `true`.
- provider reset headers such as `anthropic-ratelimit-unified-reset` when present.

Do not make Anthropic-specific headers required. Store them generically as `rateLimitResetMs`.

## 6. Retry Policy

Create `src/service/AIChatRetryPolicy.ts`.

### 6.1 Constants

```typescript
export const AI_CHAT_RECOVERY_DEFAULTS = {
  foregroundMaxAttempts: 10,
  foregroundBaseDelayMs: 500,
  foregroundMaxDelayMs: 32_000,
  overloadFallbackThreshold: 3,
  persistentMaxBackoffMs: 5 * 60_000,
  persistentHardCapMs: 6 * 60 * 60_000,
  persistentHeartbeatMs: 30_000,
  contextCollapseSoftThreshold: 0.9,
  contextCollapseHardThreshold: 0.95,
  outputTokenEscalationMax: 65_536,
  outputContinuationLimit: 3,
} as const;
```

### 6.2 Profiles

```typescript
export type AIChatRetryProfile =
  | "foreground"
  | "background"
  | "persistent";
```

Foreground is user-visible chat. Background is compact/memory/title maintenance. Persistent is opt-in long-running plan/agent work.

### 6.3 API

```typescript
export interface RetryDecisionInput {
  readonly error: AIChatRecoverableError;
  readonly profile: AIChatRetryProfile;
  readonly attempt: number;
  readonly consecutiveOverloadCount: number;
  readonly elapsedMs: number;
  readonly hasFallbackModel: boolean;
}

export type RetryDecision =
  | { readonly type: "retry"; readonly delayMs: number; readonly layer: AIChatRecoveryLayer }
  | { readonly type: "fallback"; readonly layer: "model_fallback" }
  | { readonly type: "fail" };

export class AIChatRetryPolicy {
  decide(input: RetryDecisionInput): RetryDecision;
  computeDelay(input: {
    readonly attempt: number;
    readonly retryAfterMs?: number;
    readonly maxDelayMs: number;
    readonly baseDelayMs?: number;
  }): number;
}
```

### 6.4 Delay Formula

Use bounded exponential backoff with 25 percent jitter:

```typescript
const base = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
const jitter = Math.random() * 0.25 * base;
return Math.round(base + jitter);
```

If `retryAfterMs` is valid and positive, use it up to the profile max.

### 6.5 Non-Retryable Reasons

Never retry:

- `auth`,
- `quota`,
- `cancelled`,
- `non_recoverable`.

## 7. API Layer Integration

Update `src/api/aiChatApi.ts`.

### 7.1 Stream Options

Extend `openAIChatCompletionStream()` options:

```typescript
export interface StreamRecoveryInfo {
  readonly layer: AIChatRecoveryLayer;
  readonly reason: AIChatRecoveryReason;
  readonly attempt: number;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly elapsedMs?: number;
  readonly message: string;
}

export interface OpenAIChatCompletionStreamOptions {
  readonly signal?: AbortSignal;
  readonly retryProfile?: AIChatRetryProfile;
  readonly onRetry?: (info: StreamRetryInfo) => void;
  readonly onRecoveryStatus?: (info: StreamRecoveryInfo) => void;
}
```

Keep `onRetry` while migrating callers. Internally emit both:

- `onRetry` for old `retry_connect`.
- `onRecoveryStatus` for new `recovery_status`.

### 7.2 Status Retry Flow

`openAIChatCompletionStream()` should:

1. Build the OpenAI request.
2. Attempt `postStream`.
3. If `postStream` throws, classify the thrown error.
4. If response status is not OK, read bounded body text, classify it, and drain body.
5. Ask `AIChatRetryPolicy` whether to retry, fallback, or fail.
6. Emit status event before sleeping.
7. Sleep through an abortable helper.
8. Throw `AIChatRecoverableError` when exhausted.

The API layer should only handle Layer 1 and Layer 2 retries. It should not compact context, change max tokens, or switch models. It can report that fallback should happen by throwing the typed error after overload threshold is exhausted.

### 7.3 Abortable Sleep

Retain and reuse current `sleepWithAbort()` behavior. It must be used for:

- normal retry delays,
- persistent retry waits,
- heartbeat chunk waits.

### 7.4 Bounded Error Body Reads

Avoid pulling very large response bodies into memory. Add a helper that truncates:

```typescript
async function readErrorBody(response: Response, maxChars = 8_000): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
```

## 8. Query Event and IPC Integration

### 8.1 Query Event

Add `AIChatQueryRecoveryStatusEvent` to `AIChatQueryEvents.ts`.

### 8.2 Loop Emission

`AIChatQueryLoop` should forward API recovery info:

```typescript
onRecoveryStatus: (info) => {
  eventSink.emit({
    type: "recovery_status",
    conversationId: input.conversationId,
    messageId: input.assistantMessageId,
    recoveryLayer: info.layer,
    recoveryReason: info.reason,
    attempt: info.attempt,
    maxAttempts: info.maxAttempts,
    delayMs: info.delayMs,
    elapsedMs: info.elapsedMs,
    currentModel,
    message: info.message,
  });
}
```

### 8.3 IPC Forwarding

Update `createEventSink()` in `ai-chat-v2-ipc.ts` with a new case:

```typescript
case "recovery_status":
  sendChunk(event, {
    eventType: "recovery_status",
    conversationId: e.conversationId,
    messageId: e.messageId,
    recoveryLayer: e.recoveryLayer,
    recoveryReason: e.recoveryReason,
    recoveryAttempt: e.attempt,
    recoveryMaxAttempts: e.maxAttempts,
    recoveryDelayMs: e.delayMs,
    recoveryElapsedMs: e.elapsedMs,
    recoveryOriginalModel: e.originalModel,
    recoveryCurrentModel: e.currentModel,
    recoveryFallbackModel: e.fallbackModel,
    recoveryMessage: e.message,
  });
  break;
```

No database access belongs in this IPC case.

## 9. Recovery Coordinator

Create `src/service/AIChatRecoveryCoordinator.ts`.

The coordinator owns cross-layer decisions after the API layer has either exhausted its low-level retry or the loop detects output/context issues from a completed stream.

### 9.1 API

```typescript
export interface RecoveryCoordinatorInput {
  readonly error: unknown;
  readonly state: AIChatRecoveryAttemptState;
  readonly messages: readonly OpenAIChatMessage[];
  readonly request: ChatV2StreamRequest;
  readonly currentModel?: string;
  readonly sideEffectBoundaryCrossed: boolean;
}

export type RecoveryAction =
  | {
      readonly type: "retry_model_call";
      readonly messages: OpenAIChatMessage[];
      readonly model?: string;
      readonly maxTokens?: number;
      readonly reason: AIChatRecoveryReason;
    }
  | {
      readonly type: "fallback_model";
      readonly model: string;
      readonly messages: OpenAIChatMessage[];
      readonly reason: AIChatRecoveryReason;
    }
  | {
      readonly type: "fail";
      readonly error: unknown;
    };

export class AIChatRecoveryCoordinator {
  recover(input: RecoveryCoordinatorInput): Promise<RecoveryAction>;
}
```

### 9.2 Safe Retry Boundary

`sideEffectBoundaryCrossed` means a tool may have executed in the current turn. It is conservative:

- `false` before any tool call starts.
- `true` once `executeToolWithTimeout()` starts for a non-plan local tool.
- `true` once async tool job starts.
- remains `false` for plan tools that only save questions or plan drafts because those have their own durable pause states.

Model calls may still retry after tool results are appended. Tool execution itself must not be replayed by recovery.

Idempotent means safe to repeat without changing the outcome twice. In this design, tools are treated as non-idempotent unless they explicitly say otherwise in future metadata.

### 9.3 Coordinator Layer Order

For a classified error:

1. `output_limit`: try output token recovery.
2. `context_overflow` or `media_overflow`: try context collapse drain, then reactive compact.
3. `overload` or `model_unavailable`: try model fallback if low-level retries are exhausted.
4. `rate_limit` in persistent profile: try persistent retry.
5. Otherwise fail.

The coordinator must record every action in `AIChatRecoveryAttemptState.records`.

## 10. Layer 3: Output Token Recovery

Implement inside `AIChatQueryLoop` with help from the coordinator.

### 10.1 Detection

Use `AIChatRecoveryClassifier.classifyStreamFinish()` after `deps.streamChatCompletion()` returns and before the loop executes tools.

Also detect malformed tool JSON that looks truncated:

```typescript
function looksTruncatedJson(raw: string): boolean {
  const trimmed = raw.trim();
  return (
    trimmed.length > 0 &&
    ((trimmed.startsWith("{") && !trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && !trimmed.endsWith("]")))
  );
}
```

### 10.2 Escalation

When `outputEscalationAttempted === false`:

- set `state.outputEscalationAttempted = true`,
- set `currentMaxTokens = min(modelMaxOutput ?? 65536, 65536)`,
- emit `recovery_status`,
- retry same model call with the same messages.

### 10.3 Continuation

When escalation has already been attempted and `outputContinuationCount < 3`:

Append a meta user message:

```typescript
{
  role: "user",
  content:
    "Output token limit hit. Continue directly from the cutoff. " +
    "Do not apologize or recap. If a tool call was cut off, regenerate " +
    "the complete tool call arguments as valid JSON."
}
```

Do not persist this meta message as a normal user message.

### 10.4 Withheld Output

Partial assistant content from a recoverable output-limit failure must stay in memory until one of these happens:

- recovery completes and final assistant content is saved once,
- user cancels and visible partial content is saved as cancelled,
- recovery exhausts and a user-safe error is emitted.

Do not save multiple cutoff fragments as separate assistant messages.

## 11. Layers 4 and 5: Context Recovery

Create `src/service/AIChatContextRecoveryService.ts`.

### 11.1 Context Budget Input

Extend `AIChatContextAssembler.assemble()` to accept optional context policy:

```typescript
export interface AIChatContextBudgetPolicy {
  readonly contextWindowTokens: number;
  readonly softThresholdRatio: number;
  readonly hardThresholdRatio: number;
  readonly reserveOutputTokens: number;
}
```

The assembler already receives `model` and `maxTokens`. It should resolve context window through a model metadata provider rather than hardcoding the renderer's `DEFAULT_CONTEXT_WINDOW`.

### 11.2 Model Context Metadata

Create a small service:

```text
src/service/AIChatModelCatalogService.ts
```

Responsibilities:

- call `AiChatApi.listOpenAIModels()` through main-process service code,
- cache model context sizes for the process lifetime,
- expose `getContextWindow(model?: string): Promise<number>`,
- expose `getMaxOutputTokens(model?: string): Promise<number | undefined>`,
- fall back to the existing default context window when model metadata is unavailable.

This service should not be used in the renderer. The renderer can keep its existing model list for UI display.

### 11.3 Collapse Strategy

The assembler must not split tool groups. A tool group is:

```text
assistant message with tool_calls
  followed by one or more role=tool messages matching those tool_call_ids
```

Current persisted `ChatV2MessageView` stores tool calls and tool results as separate local rows. The transcript builder must group them before trimming.

Algorithm:

1. Load sorted history rows.
2. Convert rows into logical transcript groups:
   - single user message,
   - single assistant text message,
   - assistant tool-call message plus matching tool result rows,
   - plan display rows excluded unless needed by plan mode.
3. Keep recent groups from newest to oldest until target token budget is reached.
4. Summarize or use existing compact/session memory for older groups.
5. Project summary as system context.

### 11.4 Reactive Compact

When a 413/context overflow is thrown:

1. If `contextDrainAttempted === false`, try drain first.
2. If drain cannot reduce enough and `reactiveCompactAttempted === false`, run compact recovery.
3. Retry the model call once with reduced prompt.
4. If still overflow, fail with context-too-large message.

`AIChatCompactAgentService.runFullCompact()` can be reused for full compact, but recovery must not depend on a long-running compact call completing when a faster local drain can solve the overflow.

Recommended v1 order:

- Use existing active full compact or session memory if present.
- If not present, construct a temporary recovery summary prompt through `AIChatCompactAgentService`.
- Store successful summary through existing compact/session memory modules.

Raw history remains unchanged.

## 12. Layer 6: Model Fallback

Create `src/service/AIChatModelFallbackService.ts`.

### 12.1 API

```typescript
export interface ResolveFallbackInput {
  readonly originalModel?: string;
  readonly currentModel?: string;
  readonly reason: AIChatRecoveryReason;
}

export interface ResolveFallbackResult {
  readonly fallbackModel?: string;
  readonly reason?: string;
}

export class AIChatModelFallbackService {
  resolveFallback(input: ResolveFallbackInput): Promise<ResolveFallbackResult>;
}
```

### 12.2 Resolution Order

1. Local configured fallback map.
2. Server `default_model`.
3. First model from `/models` with a different ID.

Never return the same model.

### 12.3 Loop Integration

`AIChatQueryLoop` should track `currentModel` separately from `input.request.model`.

When fallback action is returned:

- set `currentModel = fallbackModel`,
- set `state.currentModel = fallbackModel`,
- emit `recovery_status` with Layer 6,
- discard the failed accumulator state,
- retry model call with the same messages and safe max token settings.

Do not fallback while a tool is executing.

### 12.4 Persistence

Extend `ChatV2MessageMetadata`:

```typescript
recovery?: {
  layersUsed: AIChatRecoveryLayer[];
  attempts: number;
  originalModel?: string;
  finalModel?: string;
  outputEscalated?: boolean;
  contextCompacted?: boolean;
  contextDrained?: boolean;
}
```

`AIChatQueryEngine.handleLoopResult()` should write this metadata on the final assistant row.

## 13. Layer 7: Persistent Retry

Persistent retry is opt-in. It is not enabled by normal chat.

### 13.1 Activation

Add optional request/runtime flag:

```typescript
export interface ChatV2StreamRequest {
  ...
  recoveryMode?: "foreground" | "persistent";
}
```

For Phase 3, avoid exposing this directly in the renderer. The engine can set persistent mode internally when:

- plan mode is approved and executing,
- an async agent/subagent tool is running,
- a future long-running task explicitly requests it.

### 13.2 Heartbeat Events

During long wait:

- emit `recovery_status` every 30 seconds,
- include `elapsedMs`,
- keep Stop enabled,
- do not append assistant text.

### 13.3 Hard Cap

After 6 hours:

- stop retrying,
- emit terminal `error`,
- preserve conversation and any completed tool results.

## 14. Renderer Design

### 14.1 State

In `AiChatV2.vue`, replace or extend `retryInfo`:

```typescript
const recoveryInfo = ref<{
  layer: AIChatRecoveryLayer;
  reason: AIChatRecoveryReason;
  attempt: number;
  maxAttempts?: number;
  delayMs?: number;
  elapsedMs?: number;
  originalModel?: string;
  currentModel?: string;
  fallbackModel?: string;
  message: string;
} | null>(null);
```

Keep `retryInfo` until all child components are migrated.

### 14.2 Chunk Handling

On `recovery_status`:

- set `recoveryInfo`,
- set `receivedFirstResponse = true` so the UI does not look idle,
- keep `isStreaming = true`.

On `token`, `tool_call`, `tool_result`, `usage_update`, `complete`, `cancelled`, `error`:

- clear `recoveryInfo` when the recovery state is no longer active.

### 14.3 UI Component

Add:

```text
src/views/components/aiChatV2/AiChatV2RecoveryStatus.vue
```

Props:

```typescript
interface Props {
  readonly info: RecoveryInfo | null;
}
```

Render compact statuses:

| Layer | User text |
|-------|-----------|
| `api_retry` | Reconnecting to AI service... |
| `overload_retry` | The selected model is busy. Waiting to retry... |
| `output_token_recovery` | The answer was cut off. Asking the model to continue... |
| `reactive_compact` | Conversation is too large. Compacting context... |
| `context_collapse_drain` | Reducing older context for this request... |
| `model_fallback` | Switching to another available model... |
| `persistent_retry` | Waiting for AI capacity to recover... |

All strings must be added to:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

## 15. Persistence Design

### 15.1 No New Table For V1

Use existing `metadata` on assistant messages. This avoids schema migration for the first recovery rollout.

### 15.2 Metadata Shape

Extend `ChatV2MessageMetadata`:

```typescript
export interface ChatV2RecoveryMetadata {
  layersUsed: AIChatRecoveryLayer[];
  attempts: number;
  originalModel?: string;
  finalModel?: string;
  outputEscalated?: boolean;
  outputContinuationCount?: number;
  contextCompacted?: boolean;
  contextDrained?: boolean;
  fallbackModel?: string;
}
```

Add optional field:

```typescript
recovery?: ChatV2RecoveryMetadata;
```

### 15.3 Save Timing

Only `AIChatQueryEngine.handleLoopResult()` saves final assistant recovery metadata.

Intermediate recovery events are not saved as chat messages.

## 16. Logging

Add a small helper in `AIChatRecoveryTypes.ts` or a dedicated file:

```typescript
export function logRecoveryEvent(input: {
  readonly conversationId: string;
  readonly assistantMessageId: string;
  readonly layer: AIChatRecoveryLayer;
  readonly reason: AIChatRecoveryReason;
  readonly attempt: number;
  readonly delayMs?: number;
  readonly model?: string;
  readonly fallbackModel?: string;
  readonly outcome?: "retrying" | "fallback" | "recovered" | "failed";
}): void {
  console.info("[ai-chat-recovery]", JSON.stringify(input));
}
```

Do not log message text, tool arguments, API keys, workspace file contents, or raw server bodies.

## 17. Test Strategy

### 17.1 New Unit Tests

Add:

```text
test/vitest/main/service/AIChatRecoveryClassifier.test.ts
test/vitest/main/service/AIChatRetryPolicy.test.ts
test/vitest/main/service/AIChatRecoveryCoordinator.test.ts
test/vitest/main/service/AIChatModelFallbackService.test.ts
test/vitest/main/service/AIChatContextRecoveryService.test.ts
```

Coverage:

- status and body classification,
- `Retry-After` seconds and date parsing,
- jitter bounded by max delay,
- non-retryable quota/auth/cancelled,
- model fallback does not return same model,
- context grouping keeps tool call/result pairs atomic.

### 17.2 API Tests

Extend `test/vitest/utilitycode/aiChatApi.test.ts`:

- network failure then success,
- 429 with `Retry-After`,
- 529 overload events,
- abort during retry sleep,
- exhausted retry throws `AIChatRecoverableError`.

### 17.3 Query Loop Tests

Extend `test/vitest/main/service/AIChatQueryLoop.test.ts`:

- `finish_reason=length` escalates max tokens once,
- output continuation appends meta user message,
- truncated tool JSON is not executed,
- three continuation failures produce failed result,
- fallback model retries model call without replaying tools,
- side effect boundary blocks unsafe tool replay.

### 17.4 Engine Tests

Extend `test/vitest/main/service/AIChatQueryEngine.test.ts`:

- final assistant message saved once after recovery,
- recovery metadata saved on final assistant row,
- cancelled recovery saves visible partial only when appropriate,
- pending permission state survives model recovery after approved tool result.

### 17.5 IPC Tests

Extend `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`:

- AI gate still happens before JSON parse,
- `recovery_status` maps to `ChatV2StreamChunk`,
- terminal error still uses `userSafeError`.

### 17.6 Renderer Tests

Extend `test/vitest/utilitycode/aiChatV2PanelLayout.test.ts` or add a component test if the project has a component harness:

- recovery status does not resize composer,
- Stop remains enabled during recovery,
- recovery status clears on complete/cancel/error.

## 18. Rollout Plan

### Phase 1: API Retry and Events

Files:

- `AIChatRecoveryTypes.ts`
- `AIChatRecoveryClassifier.ts`
- `AIChatRetryPolicy.ts`
- `aiChatApi.ts`
- `AIChatQueryEvents.ts`
- `ai-chat-v2-ipc.ts`
- `aiChatV2Types.ts`
- `AiChatV2.vue`
- language files

Keep behavior close to current retry path, but add typed errors and `recovery_status`.

### Phase 2: Output and Context Recovery

Files:

- `AIChatRecoveryCoordinator.ts`
- `AIChatContextRecoveryService.ts`
- `AIChatContextAssembler.ts`
- `AIChatQueryLoop.ts`
- compact/session memory modules as needed

Add output-token recovery, context drain, and reactive compact.

### Phase 3: Fallback and Persistent Retry

Files:

- `AIChatModelFallbackService.ts`
- `AIChatQueryLoop.ts`
- `AIChatQueryEngine.ts`
- `AiChatV2RecoveryStatus.vue`

Add overload fallback and persistent retry.

## 19. Migration and Compatibility

- `retry_connect` remains emitted during Phase 1.
- `recovery_status` is additive and does not break existing renderer handlers.
- Existing conversations require no migration.
- Existing assistant metadata remains valid because `recovery` is optional.
- Manual compact remains available.
- Old AI chat stack remains untouched.

## 20. Implementation Notes

### 20.1 Avoid Circular Imports

`AIChatRecoveryTypes.ts` should contain only types, constants, and small pure helpers. Avoid importing `AiChatApi`, `AIChatQueryLoop`, modules, or Vue types from it.

### 20.2 Keep Classifier Pure

The classifier should not call services or read settings. That keeps tests simple and prevents hidden side effects.

### 20.3 Keep Retry Policy Deterministic In Tests

Allow dependency injection for random jitter:

```typescript
constructor(private readonly random: () => number = Math.random) {}
```

Tests can pass `() => 0` or `() => 1`.

### 20.4 Do Not Persist Meta Continuation Messages

Meta continuation messages exist only in the in-memory OpenAI transcript. They are not user messages and should not appear in local chat history.

### 20.5 Preserve Tool Progress

Recovery status must not overwrite active tool progress. A tool can be running while model recovery is inactive; persistent retry may wait between model calls. Render them separately if both exist.

## 21. Done Criteria

The implementation is complete when:

- all seven layers have typed state and status events,
- transport retries use typed classification and abortable jittered backoff,
- output-limit recovery saves one final assistant message,
- context overflow can recover through drain or compact once,
- fallback model works after repeated overload,
- persistent retry is opt-in and cancellable,
- recovery metadata is persisted on final assistant messages,
- UI strings are translated across all supported languages,
- tests cover classifier, retry policy, loop recovery, IPC mapping, and renderer status behavior.
