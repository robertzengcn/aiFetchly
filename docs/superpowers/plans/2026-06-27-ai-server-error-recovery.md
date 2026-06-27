# Fix: Handle AI server `finish_reason: "error"` and non-SSE error bodies

## Context

When the remote AI server is under load (typically after long tool-polling loops inflate the context), it occasionally returns an error response shaped like a **non-streaming** JSON body:

```json
{"id":"chatcmpl-...","model":"deepseek-v4-flash","choices":[{"index":0,"message":{"role":"assistant","content":"","tool_calls":null},"finish_reason":"error"}]}
```

The client requests `stream: true`, so `_consumeOpenAIStreamResponse` (`src/api/aiChatApi.ts:2401`) only parses lines prefixed with `data:`. A plain JSON body has no such prefix → **zero chunks are emitted**, the accumulator stays empty, `finishReason` stays `undefined`. `AIChatQueryLoop` then throws `"AI server returned an empty response with no finish reason..."`, which `userSafeError` (`src/service/AIChatErrorMapper.ts`) doesn't recognize, so the user sees the generic `"An unexpected error occurred. Please try again."`.

Evidence: the application log shows `round 16 ← finishReason=undefined sawToolCallDelta=false parsedCalls=0 willContinue=false` even though the server reported `finish_reason: "error"`. If the body had been SSE-formatted, `normalizeOpenAIStreamPayload` (aiChatApi.ts:2277) already normalizes the `choice.message` shape and would have set `finishReason="error"`.

Goal: surface these transient server-side errors as clear, retryable conditions — auto-retry with backoff where possible, and otherwise show an actionable message instead of the generic one.

## Approach

Three focused changes layered from the network boundary inward.

### 1. Recover non-SSE JSON bodies (`src/api/aiChatApi.ts`)

In `_consumeOpenAIStreamResponse` (~line 2401), track whether any payload was emitted. After the read loop ends, if **zero payloads were emitted** and the accumulated buffer is non-empty, attempt to parse the whole buffer as a single JSON object and feed it through `normalizeOpenAIStreamPayload` + `emitPayload`. This makes the existing `choice.message` handling kick in for non-SSE bodies, so `finishReason="error"` is captured on the accumulator.

- Keep the existing SSE line-by-line path untouched.
- Only fall back to whole-body JSON parsing when nothing else was emitted (avoid double-processing).
- Log clearly when this fallback path triggers, so we can monitor how often the server misbehaves.
- If the body isn't valid JSON either, leave current behavior (empty accumulator) — the loop's existing empty-response guard still catches it.

### 2. Treat `finish_reason: "error"` as retryable (`src/api/aiChatApi.ts` + `src/service/AIChatQueryLoop.ts`)

Add an explicit guard for `finish_reason === "error"`:

- In `AIChatQueryLoop` (around line 388, after the empty-response check): if `accumulator.state.finishReason === "error"` and content is empty, throw a tagged error (e.g. `Error("AI server reported finish_reason=error ...")` with a recognizable marker) so downstream mapping can detect it.
- Extend `openAIChatCompletionStream`'s existing retry loop (line 1878, `STREAM_RETRY_MAX_ATTEMPTS`) so that when the loop consumer throws the tagged in-stream error, the caller treats it as retryable with the same exponential backoff already used for 5xx/429. This requires surfacing the in-stream error back to the stream method — implement by having `_consumeOpenAIStreamResponse`/`emitPayload` throw a sentinel-tagged error that the retry loop in `openAIChatCompletionStream` recognizes.
- Cap auto-retry at the existing `STREAM_RETRY_MAX_ATTEMPTS` constant. Do not add unbounded retries.

### 3. Improve `userSafeError` pass-through (`src/service/AIChatErrorMapper.ts`)

The current mapper replaces every unrecognized message with `"An unexpected error occurred. Please try again."`, throwing away useful diagnostic text. Add explicit recognition for transient server-issue messages so a clearer message survives:

- Match messages containing `"finish_reason"` / `"empty response"` / `"transient server"` / `"rate limit"` / `"timeout"` / `"502"` and return a stable, user-friendly string like: `"The AI service is busy or had a transient issue. Please try again in a moment."`.
- Keep all existing patterns (402, 401, 404, 503, network) unchanged.

### Out of scope (flagged for later)

The chat history shows ~16 rounds of `check_tool_job_status` polling every ~2s, ignoring the `retry_after_ms` hint in each response. This balloons the context (tokens 9k→13k) and likely triggered the server-side error. A follow-up could enforce a minimum poll interval or have the loop inject a "wait" tool result when `retry_after_ms` is present. Not part of this fix.

## Files to Modify

- `src/api/aiChatApi.ts` — non-SSE body recovery in `_consumeOpenAIStreamResponse`; tagged-error + retry integration in `openAIChatCompletionStream`.
- `src/service/AIChatQueryLoop.ts` — detect `finishReason === "error"` and throw the tagged retryable error.
- `src/service/AIChatErrorMapper.ts` — add transient-server-issue patterns to `userSafeError`.
- `test/vitest/utilitycode/aiChatApi.test.ts` — new tests for non-SSE JSON body recovery and `finish_reason=error` retry path.
- `test/vitest/main/service/AIChatQueryLoop.test.ts` (or equivalent existing test file) — test that `finish_reason=error` surfaces a retryable error.

## Reused Existing Utilities

- `normalizeOpenAIStreamPayload` (aiChatApi.ts:2246) — already normalizes `choice.message` to a delta chunk; reused by the new fallback path.
- `STREAM_RETRY_MAX_ATTEMPTS` / `computeStreamRetryDelay` / `sleepWithAbort` (aiChatApi.ts) — existing backoff machinery, reused for in-stream-error retry.
- `isRetryableStreamStatus` (aiChatApi.ts:1969) — pattern reference for the new in-stream retryable check.

## Verification

1. **Unit tests** (TDD — write first):
   - `_consumeOpenAIStreamResponse` emits a chunk with `finish_reason="error"` when given a plain JSON body `{"choices":[{"message":{...},"finish_reason":"error"}]}` with no `data:` prefix.
   - `_consumeOpenAIStreamResponse` still works unchanged for normal SSE bodies (regression).
   - `AIChatQueryLoop` throws a retryable-tagged error when accumulator ends with `finishReason === "error"` and empty content.
   - `userSafeError` returns the new transient-server message for the relevant error strings.
   - `openAIChatCompletionStream` retries up to `STREAM_RETRY_MAX_ATTEMPTS` when the in-stream error is tagged, then surfaces the mapped message.
2. **Run**: `yarn vue-check` (type check) + `yarn test <new test files>` + `yarn testmain` for IPC/loop tests.
3. **Manual smoke**: repro the original scenario (lead-researcher subagent polling loop) and confirm that on a `finish_reason: "error"` response the UI now shows the transient-issue message (and ideally auto-retries once or twice before showing it).
