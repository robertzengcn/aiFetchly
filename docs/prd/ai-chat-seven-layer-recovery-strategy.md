# PRD: AI Chat V2 Seven-Layer Recovery Strategy

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-02 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Primary area | AI Chat V2 stability |
| Reference | `/home/robertzeng/project/github/claude-code/docs/recovery-strategies.md` |
| Related code | `src/main-process/communication/ai-chat-v2-ipc.ts`, `src/views/components/aiChatV2/AiChatV2.vue`, `src/api/aiChatApi.ts`, `src/service/AIChatQueryEngine.ts`, `src/service/AIChatQueryLoop.ts`, `src/service/AIChatContextAssembler.ts` |

---

## 1. Executive Summary

AiFetchly AI Chat V2 should implement a seven-layer recovery strategy inspired by Claude Code's recovery model, adapted for an Electron desktop app that uses an OpenAI-compatible remote AI server, local SQLite conversation history, plan mode, tool execution, and permission-gated actions.

The current V2 chat stack already has the right architectural seams:

- `ai-chat-v2-ipc.ts` is a thin IPC adapter that checks `USER_AI_ENABLED`, validates stream requests, forwards query events, and registers channels.
- `AIChatQueryEngine` owns conversation lifecycle, persistence, pause/resume state, abort state, and final result handling.
- `AIChatQueryLoop` owns the model-to-tool-to-model round loop, malformed tool-call recovery, usage events, and tool execution.
- `AiChatApi.openAIChatCompletionStream()` already retries initial stream connection failures up to 3 times and emits `retry_connect`.
- `AiChatV2.vue` already displays stream state, retry info, stop behavior, context usage, compact controls, and conversation history.

The missing piece is a coordinated recovery policy. Today, transient errors, overloads, context overflow, output truncation, model outage, and long rate-limit windows are handled inconsistently or surfaced as user-facing failures that require manual retry. The product goal is to make recoverable failures invisible when possible, visible-but-nonfatal when waiting, and explicit only after safe recovery paths are exhausted.

## 2. Problem Statement

AI Chat V2 can fail in ways that are common for long, tool-heavy, model-backed workflows:

1. The remote AI server temporarily refuses or drops a streaming request.
2. The model provider returns 429, 500, 502, 503, 504, or overload-style 529 errors.
3. The assistant response or tool call is cut off by `max_tokens`.
4. The request is too large for the remote server or model context window.
5. Existing compaction is available, but not automatically integrated into overflow recovery.
6. One selected model can be unavailable while another model is usable.
7. Long agent-like tasks can stall for hours during capacity or rate-limit windows.

Current user-visible symptoms include:

- "AI server returned an empty response with no finish reason."
- `finish_reason=error` messages that ask the user to resend manually.
- Retry status limited to connection retry, not a full recovery state.
- Manual compaction required before the user knows whether context size was the issue.
- No model fallback flow when a selected model is overloaded or unavailable.
- No persistent retry mode for unattended long-running plan/tool tasks.

## 3. Goals

- Provide a single seven-layer recovery strategy for AI Chat V2.
- Keep AI enable gating first in every AI IPC handler.
- Keep IPC thin; recovery orchestration belongs in service/API layers.
- Recover automatically from transient network, provider, output, context, and model failures.
- Preserve local conversation history as the source of truth.
- Prevent duplicate persistence and duplicate tool side effects during retries.
- Give the renderer structured recovery events so users can see when the assistant is waiting, compacting, switching model, or retrying.
- Allow user cancellation to interrupt any recovery wait immediately.
- Add testable boundaries so most behavior can be verified without Electron UI.

## 4. Non-Goals

- Do not copy Claude Code internals directly.
- Do not move database access into IPC handlers or worker processes.
- Do not let the renderer call the AI server directly.
- Do not auto-replay side-effectful tools after they may have executed.
- Do not make persistent retry the default for normal foreground chat.
- Do not require a full UI redesign.
- Do not remove the existing manual compact action.
- Do not introduce LangChain, LangGraph, or another agent framework.

## 5. Current State Analysis

### 5.1 IPC Layer

`src/main-process/communication/ai-chat-v2-ipc.ts`:

- Checks AI enable before parsing stream payloads.
- Sends `start`, `token`, `retry_connect`, `tool_progress`, `tool_call`, `tool_result`, plan events, `usage_update`, `complete`, `cancelled`, and `error` chunks.
- Delegates stream execution to `AIChatQueryEngine.submitMessage()`.
- Does not currently classify recovery reasons beyond `retry_connect`.

Required direction: keep this file thin. Add forwarding for new structured recovery events only.

### 5.2 API Layer

`src/api/aiChatApi.ts`:

- `openAIChatCompletionStream()` retries network errors and retryable HTTP statuses up to `STREAM_RETRY_MAX_ATTEMPTS = 3`.
- Retry delay is deterministic exponential backoff: 1s, 2s, 4s.
- Retryable statuses are `0`, `429`, and `5xx`.
- There is no jitter, `Retry-After` handling, 529-specific policy, persistent retry, or typed error classification.

Required direction: API boundary must classify recoverable failures before they become plain strings.

### 5.3 Query Engine

`src/service/AIChatQueryEngine.ts`:

- Saves the user message before remote AI work.
- Builds context via `AIChatContextAssembler`.
- Persists assistant/tool messages.
- Stores pending permission and plan-question state.
- Handles cancellation and terminal stream events.

Required direction: turn-level recovery state belongs here or in a dedicated recovery coordinator used by the engine.

### 5.4 Query Loop

`src/service/AIChatQueryLoop.ts`:

- Runs up to `CHAT_V2_MAX_TOOL_ROUNDS = 30`.
- Emits retry events from the API callback.
- Detects malformed tool calls and gives the model up to 3 self-correction rounds.
- Doubles token budget up to 65536 when tool-call arguments look truncated.
- Converts empty or error finishes into failed turn results.

Required direction: output-token recovery, withheld partial output, safe retry boundaries, and tool replay guards belong here.

### 5.5 Context Assembly

`src/service/AIChatContextAssembler.ts`:

- Builds prompt from system prompt, custom directive, workspace, durable memory, compact/session memory, recent message window, and current user message.
- Uses a fixed recent window by default.
- Reports token estimate, but does not automatically collapse or drain context near model limits.

Required direction: context budget policy should be explicit, token-aware, and recoverable after overflow.

### 5.6 Renderer

`src/views/components/aiChatV2/AiChatV2.vue`:

- Tracks `retryInfo`.
- Shows context badge and manual compact button.
- Handles stop, plan approval, tool permission, pending question, and stream errors.

Required direction: add a compact recovery status model that can render all seven recovery layers without turning the chat UI into a log viewer.

## 6. Product Principles

### 6.1 Recover Before Failing

If a failure is recoverable and recovery is safe, the system should try recovery before emitting a terminal `error` event.

### 6.2 No Duplicate Side Effects

The system must never automatically replay a tool call that may have already changed external state. Recovery is safe before the model asks for tools, after deterministic tool results have been appended to the transcript, or when a tool explicitly reports an idempotency key and safe retry support.

### 6.3 Withhold Recoverable Failures

Recoverable internal failures should not be persisted as final assistant errors unless all recovery attempts are exhausted. Partial assistant content should be buffered or marked tentative until the turn is terminal.

### 6.4 User Stop Wins

The user's stop action must abort active streams, retry sleeps, compaction calls, fallback attempts, and persistent retry waits.

### 6.5 Foreground and Background Differ

Foreground user chat may retry enough to feel stable. Background maintenance, title generation, memory updates, and compact tasks must avoid retry amplification during provider overload.

### 6.6 Local State Is Authoritative

Conversation history, plan state, pending permission state, and recovery metadata must remain owned by the local app.

## 7. Seven Recovery Layers

### Layer 1: API Exponential Backoff Retry

Purpose: recover from transient network and server errors at the lowest API boundary.

Trigger conditions:

- Network failures before receiving a usable stream.
- `AbortError` excluded unless caused by internal retry cancellation.
- HTTP 408, 409, 429, 500, 502, 503, 504.
- HTTP 529 or error payloads containing overload markers.
- Header `x-should-retry: true` when present.
- Retryable OpenAI-compatible stream errors before visible side effects.

Requirements:

- Replace fixed 3-attempt stream retry with a shared retry policy.
- Respect `Retry-After` when present.
- Use exponential backoff with jitter.
- Default foreground max attempts: 10 total attempts including initial attempt.
- Default max delay: 32 seconds for normal foreground chat.
- Emit structured recovery events for every wait.
- Abort immediately when the active turn's abort signal fires.
- Reset stale HTTP connection state if the transport reports stale connection errors such as `ECONNRESET` or `EPIPE`.

Acceptance criteria:

- A simulated 502 followed by success completes the original turn without duplicate user or assistant messages.
- The UI shows retry attempt and delay while waiting.
- Clicking Stop during backoff cancels the wait and emits `cancelled`.

### Layer 2: 529 Overload Retry

Purpose: treat capacity overload as a first-class state, not a generic server error.

Trigger conditions:

- HTTP 529.
- Error text containing provider overload markers such as `overloaded_error`.
- OpenAI-compatible stream finish/error payload indicating provider overload.

Requirements:

- Track consecutive 529 failures separately from generic retry attempts.
- Foreground chat, plan execution, permission resume, and user-triggered compact may retry 529.
- Background memory updates, auto titles, suggestions, and nonessential maintenance should not fan out retries during overload.
- After 3 consecutive 529 failures for the same model and turn, either trigger model fallback if configured or return a clear overload message.
- Retry events must distinguish overload from generic connection retry.

Acceptance criteria:

- Three consecutive simulated 529 responses trigger fallback when a fallback model exists.
- A background compact/session-memory update does not retry 529 more than once.
- User-facing status says the model is overloaded rather than "unknown error".

### Layer 3: Output Token Recovery

Purpose: recover when the assistant or tool-call JSON is cut off by output limits.

Trigger conditions:

- `finish_reason` equals `length`, `max_tokens`, or equivalent provider-specific value.
- Tool-call arguments are syntactically truncated.
- Error text indicates `max_output_tokens` or output token limit.
- Stream ends with incomplete assistant/tool-call content while the request otherwise succeeded.

Requirements:

- Stage 1: increase `max_tokens` once for the same request when no override is already active.
- Default escalation target: min(model max output, 65536), with a lower bound of 16384 for tool-heavy turns.
- Stage 2: if escalation has already happened, append a meta user message instructing the model to continue directly from the cutoff.
- Maximum continuation attempts: 3 per user turn.
- Withhold truncated assistant output from final persistence until recovery completes.
- For tool-call truncation, prefer regenerating the complete tool call over executing partial arguments.
- Existing malformed-argument self-correction should become part of this layer's policy.

Acceptance criteria:

- A simulated `finish_reason=length` followed by a continuation yields one final assistant message, not multiple cutoff fragments.
- Truncated JSON tool arguments are not executed.
- Recovery stops after 3 continuation attempts with a user-safe error.

### Layer 4: Reactive Compact

Purpose: recover after the server rejects the prompt or media payload as too large.

Trigger conditions:

- HTTP 413.
- Error text indicating `Prompt Too Long`, context overflow, request body too large, image too large, PDF too large, or media payload too large.
- OpenAI-compatible error indicating `input length + max_tokens > context limit`.

Requirements:

- Attempt reactive compact once per turn.
- For prompt overflow, run conversation compaction or construct a compacted prompt from existing compact/session memory plus recent messages.
- For media or attachment overflow, strip or downscope oversized attachment references before retrying.
- Prefer context collapse/drain layer first when a committed collapse can solve the overflow; use reactive compact when no collapse is available.
- Emit a status event before and after compaction.
- Never delete raw conversation history during reactive compact.

Acceptance criteria:

- A simulated 413 triggers one compact attempt and retries with a smaller prompt.
- If compact succeeds, the final assistant response completes without requiring the user to manually click compact.
- If compact fails, the UI shows a clear context-too-large message.

### Layer 5: Context Collapse Drain

Purpose: prevent overflow before requests and drain old context after an overflow without losing the local transcript.

Trigger conditions:

- Estimated prompt tokens exceed 90 percent of the selected model context window.
- Estimated prompt tokens exceed a configured hard threshold before request.
- A 413 or context overflow occurs and older message groups can be collapsed.

Requirements:

- `AIChatContextAssembler` must use model context-window metadata from `/models` when available.
- At or above 90 percent, collapse older message groups into summary context before the API call.
- At or above 95 percent, block unsafe prompt assembly and force collapse or compact before the API call.
- Tool-call groups must be collapsed atomically: assistant tool call plus matching tool result must never be split.
- Collapse summaries must be stored separately from raw messages and projected at read time.
- Only one drain retry may occur for a single overflow transition to avoid loops.

Acceptance criteria:

- A long conversation near 90 percent context automatically includes a summary and fewer raw old messages.
- Tool call/result pairs are never separated in the assembled prompt.
- A context overflow after drain does not loop indefinitely.

### Layer 6: Model Fallback

Purpose: continue the turn on a compatible fallback model when the selected model is unavailable or overloaded.

Trigger conditions:

- Three consecutive 529 errors for the active model.
- HTTP 404 or 410 model unavailable for the selected model.
- HTTP 503 or provider error indicating model capacity unavailable.
- Explicit server response recommending fallback.

Requirements:

- Add a fallback model resolver that can use:
  - server-provided `default_model`,
  - configured fallback map,
  - first compatible model from `/models`.
- Fallback model must not equal the original model.
- Emit a model fallback event with original model and fallback model.
- Clear model-bound transient state before retrying.
- Preserve local conversation ID, user message, plan state, and tool results already safely appended.
- Do not fallback during a tool execution itself; fallback only around model calls.

Acceptance criteria:

- If selected model returns repeated overload and fallback is available, the turn completes with the fallback model.
- The assistant message metadata records both original and final model.
- UI status shows model switch without requiring a new user message.

### Layer 7: Unattended Persistent Retry

Purpose: keep approved long-running AI tasks alive through long 429/529 capacity windows.

Trigger conditions:

- 429 or 529 during an explicitly persistent mode.
- Persistent mode may be enabled only for approved long-running tasks, plan execution, or agent-style workflows.
- Normal foreground chat is not persistent by default.

Requirements:

- Persistent retry ignores normal max retry count but enforces a 6-hour hard cap.
- Max persistent backoff: 5 minutes.
- Respect provider rate-limit reset headers when present.
- Emit heartbeat recovery events at least every 30 seconds during long waits.
- User Stop must cancel persistent retry immediately.
- Persistent retry must not replay non-idempotent tools.
- Persistent retry state should be visible in UI and logs.

Acceptance criteria:

- A simulated 429 with reset time waits until reset, emits heartbeats, then resumes.
- Stop cancels the persistent wait within one heartbeat interval.
- Persistent mode cannot be activated by ordinary chat without explicit engine option.

## 8. Functional Requirements

### FR-1 Recovery Classification

- Define a typed recovery error classification used by `AiChatApi`, `AIChatQueryLoop`, and `AIChatQueryEngine`.
- Classifications must include: `network`, `timeout`, `rate_limit`, `overload`, `server_error`, `output_limit`, `context_overflow`, `media_overflow`, `model_unavailable`, `auth`, `quota`, `cancelled`, and `non_recoverable`.
- `quota` and AI-disabled/auth failures must not be retried.

### FR-2 Recovery Attempt State

- Track attempt state per turn, not globally.
- State must include active layer, attempt count, original model, current model, max token override, context compact attempted, collapse drain attempted, consecutive 529 count, persistent retry elapsed time, and whether a tool side effect boundary has been crossed.
- State must be cleared at terminal `complete`, `cancelled`, or `error`.

### FR-3 Stream Events

Add a unified recovery status event instead of creating many unrelated event types.

Required event fields:

- `eventType: "recovery_status"`
- `recoveryLayer`
- `recoveryReason`
- `attempt`
- `maxAttempts`
- `delayMs`
- `elapsedMs`
- `originalModel`
- `currentModel`
- `fallbackModel`
- `message`

Existing `retry_connect` may be retained for backward compatibility, but the renderer should migrate to `recovery_status`.

### FR-4 Renderer UX

`AiChatV2.vue` and child message/status components must:

- Show a compact inline status while recovery is active.
- Continue showing the typing indicator during recoverable waits.
- Show overload, fallback, compacting, and persistent-wait states distinctly.
- Keep Stop enabled during recovery waits.
- Clear recovery status on complete, error, cancelled, or conversation switch.
- Add i18n keys in all supported languages: `en`, `zh`, `es`, `fr`, `de`, `ja`.

### FR-5 Persistence

- Do not save recoverable intermediate errors as assistant messages.
- Save final assistant message once per turn.
- Save partial assistant content on user cancellation only when content was visible and meaningful.
- Store recovery metadata in assistant message metadata after completion:
  - recovery layers used,
  - retry counts,
  - original model,
  - final model,
  - compact/collapse applied flags.
- Any new durable recovery audit table must use Model and Module layers, never direct IPC database access.

### FR-6 Tool Safety

- Model-call retries before tool execution are allowed.
- Model-call retries after tool results are appended are allowed.
- Tool execution retries are not part of this PRD unless the tool declares idempotency.
- Permission-gated tools must not be auto-replayed after permission denial or stop.
- Plan-mode high-impact tool blocking remains unchanged.

### FR-7 Configuration

Add configuration defaults in service-layer constants or existing settings infrastructure:

- foreground retry max attempts,
- max normal backoff,
- overload fallback threshold,
- context collapse thresholds,
- persistent retry enabled flag,
- persistent retry cap,
- model fallback map.

Do not require UI settings for the first release.

### FR-8 Telemetry and Logs

Log structured recovery events with:

- conversation ID,
- assistant message ID,
- layer,
- reason,
- attempt,
- delay,
- model,
- fallback model,
- final outcome.

Logs must redact message content and tool arguments by default.

## 9. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Recovery must not add more than 100 ms overhead to successful no-retry model calls, excluding token estimation already done today. |
| NFR-2 | All retry sleeps must be abortable. |
| NFR-3 | New TypeScript code must avoid `any`; use explicit types or `unknown`. |
| NFR-4 | Recovery logic must be unit-testable without Electron. |
| NFR-5 | UI text must be localized in all supported languages. |
| NFR-6 | Recovery must not mutate raw conversation history while compacting or collapsing context. |
| NFR-7 | Background retries must be bounded to avoid capacity amplification. |

## 10. Proposed Architecture

```text
Renderer
  AiChatV2.vue
    receives recovery_status
    renders compact status
    keeps Stop available

IPC
  ai-chat-v2-ipc.ts
    AI gate first
    request validation
    event forwarding only

Engine
  AIChatQueryEngine
    turn state
    persistence
    pause/resume
    recovery metadata

Loop
  AIChatQueryLoop
    model/tool rounds
    output-token recovery
    safe retry boundaries

Recovery Services
  AIChatRecoveryClassifier
  AIChatRetryPolicy
  AIChatRecoveryCoordinator
  AIChatModelFallbackService
  AIChatContextRecoveryService

API
  AiChatApi
    typed remote errors
    retry-after parsing
    jittered retry waits
```

## 11. Implementation Phases

### Phase 1: Classified API Retry and Recovery Events

Scope:

- Add typed error classification.
- Upgrade stream retry policy with jitter and `Retry-After`.
- Emit `recovery_status`.
- Update `AiChatV2.vue` to render recovery status.
- Preserve `retry_connect` compatibility.

Exit criteria:

- Existing retry UI still works.
- New recovery status renders for 429, 500, network timeout.
- Stop cancels retry waits.

### Phase 2: Output Token and Context Recovery

Scope:

- Add output token recovery state to `AIChatQueryLoop`.
- Withhold truncated output until recovered.
- Add reactive compact on 413/context overflow.
- Add context collapse thresholds in `AIChatContextAssembler`.
- Preserve tool-call/result atomicity during collapse.

Exit criteria:

- `finish_reason=length` can recover into one assistant message.
- 413 can trigger automatic compact once.
- Long tool conversations do not split tool-call groups.

### Phase 3: Overload, Model Fallback, and Persistent Retry

Scope:

- Add 529-specific retry and consecutive overload tracking.
- Add model fallback resolver.
- Add opt-in persistent retry for long-running plan/agent workflows.
- Add heartbeat events.

Exit criteria:

- Three 529s switch to fallback when available.
- Persistent retry waits through a simulated rate-limit reset.
- Normal foreground chat is not persistent unless explicitly enabled.

## 12. Acceptance Test Scenarios

1. Network failure before stream starts, then success.
2. HTTP 429 with `Retry-After`, then success.
3. Three HTTP 529 responses, then fallback model success.
4. HTTP 413 prompt too long, reactive compact success.
5. Context estimate above 90 percent, proactive collapse before request.
6. `finish_reason=length`, max token escalation success.
7. Truncated tool-call JSON, no tool execution, model self-correction success.
8. User clicks Stop during normal backoff.
9. User clicks Stop during persistent retry heartbeat wait.
10. Permission-gated tool pauses, user grants permission, later model overload recovers without replaying the tool.
11. Plan-mode blocked high-impact tool remains blocked and is not retried as recovery.
12. AI disabled causes immediate denial before parsing stream request and never enters recovery.

## 13. Metrics

Track these metrics locally in logs and, if product telemetry exists, as aggregate counters:

- Recovery attempts by layer.
- Recovery success rate by layer.
- Terminal error rate before and after rollout.
- Average added latency for successful recovered turns.
- Model fallback frequency by original model.
- Context compact/collapse frequency.
- User cancellations during recovery.
- Duplicate-message prevention count.

## 14. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Retrying after side effects duplicates external actions | Track side-effect boundary; do not auto-replay non-idempotent tools. |
| Retry amplification worsens provider overload | Split foreground/background policy; cap background retries. |
| Recovery status makes UI noisy | Use one compact status area, not a full event log. |
| Context collapse loses important details | Keep raw history immutable; store summaries separately; prefer recent raw messages. |
| Fallback model changes behavior mid-turn | Emit model switch status and store original/final model metadata. |
| Persistent retry makes the app look stuck | Heartbeat events, elapsed wait display, Stop remains enabled. |

## 15. Open Questions

1. Should model fallback maps be delivered by the remote AI server, local config, or both?
2. Should persistent retry be exposed as a user-facing toggle for plan mode, or remain internal for approved long-running workflows?
3. Should recovery metadata get its own audit table, or is assistant message metadata enough for v1?
4. What exact model context-window metadata can the AI server guarantee in `/api/ai/v1/models`?

## 16. Summary

The target system should recover in this order:

1. API retry with exponential backoff.
2. 529 overload retry with foreground/background policy.
3. Output token recovery.
4. Reactive compact.
5. Context collapse drain.
6. Model fallback.
7. Opt-in unattended persistent retry.

This sequence matches the current AiFetchly architecture: low-level transport issues stay in `AiChatApi`, turn and persistence state stay in `AIChatQueryEngine`, model/tool recovery stays in `AIChatQueryLoop`, context overflow is handled by context services, and the renderer receives structured status events without owning recovery logic.
