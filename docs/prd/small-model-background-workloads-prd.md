# PRD: Small-Model Routing for Auto-Dream and Conversation Summaries

**Date:** 2026-08-23

**Status:** Draft

**Owner:** AiFetchly AI Chat

**Related areas:** AI Chat V2, conversation compact, user memory, workspace memory, AI provider routing

**Server dependency:** sibling repository document `aifetchserver/doc/API_Endpoints_Documentation.md`, section "Small Model Alias (`haiku` / `small`)"

**Builds on:**

- [Agent Memory and Conversation Compact](../superpowers/specs/2026-06-15-agent-memory-compact-prd.md)
- [Auto-Dream User Memory](../superpowers/specs/2026-06-22-auto-dream-user-memory-prd.md)
- [Local AI Provider Chat](local-ai-provider-chat-prd.md)

## 1. Summary

AiFetchly shall route lightweight AI workloads to the AI server's virtual `small` model alias when the user is using the hosted AiFetchly provider. The initial workloads are user auto-dream, workspace auto-dream, incremental conversation session-memory summaries, and full conversation compaction.

The app shall treat `small` as a workload-routing instruction, not as a model that users select. Normal chat, tool use, plan execution, and other quality-sensitive work shall keep their existing model selection.

Failure handling is part of the product contract:

- Optional background work shall fail closed and shall not silently use a more expensive model.
- User-requested or context-protection compaction may fall back once to the normal chat model when the small model is definitively unavailable or returns no usable summary.
- Ambiguous failures such as timeouts shall not automatically submit a second billable request.
- Local and custom providers shall never receive the hosted-only virtual alias unless a future provider capability explicitly declares support for it.

The implementation shall preserve the actual resolved model returned by the server. Existing consolidation and compact records already store `response.model`, so this feature does not require a database migration.

## 2. Problem

AiFetchly currently sends background memory and summary work through the same completion path used by normal chat:

- User auto-dream omits `model`, so the hosted server selects its normal default model.
- Workspace auto-dream also omits `model`.
- Incremental session-memory updates usually inherit the active conversation model.
- Full conversation compact usually inherits the active conversation model.

These jobs are frequent, structured, and usually do not need the most capable or expensive model. Using the normal chat model increases cost and competes with interactive workloads without a proportional user benefit.

Adding `model: "small"` directly to every request would create new failures:

1. `small` is a virtual alias implemented by the hosted AiFetchly server. Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI, and custom endpoints may treat it as a nonexistent literal model.
2. The alias is not listed by `GET /v1/models`, so AiFetchly cannot currently discover the resolved small model's context window before sending a large conversation.
3. Full compact currently sends all message rows. A conversation that fits the active large model may exceed the small model's context window.
4. A broad catch-and-fallback implementation could silently convert every background failure into an expensive normal-model call.
5. Retrying a timeout can duplicate server cost because the client cannot know whether the first request finished upstream.
6. Repeated configuration failures could trigger another failed background request after every completed chat turn.

The feature therefore needs explicit routing, input budgets, retry classification, fallback rules, and observability.

## 3. Goals

1. Reduce hosted AI cost for auto-dream and conversation-summary workloads.
2. Keep normal interactive chat quality and model selection unchanged.
3. Centralize lightweight routing so services do not duplicate provider rules.
4. Preserve compatibility with local and custom OpenAI-compatible providers.
5. Prevent small-model context overflow through model-aware input budgeting.
6. Define deterministic failure, retry, fallback, cooldown, and user-notification behavior.
7. Prevent silent fallback from optional background work to a more expensive model.
8. Keep user-critical conversation compaction available when the small model is not configured.
9. Record the resolved model so cost, latency, failure rate, and output quality can be measured.
10. Make future lightweight workloads opt in through an explicit allowlist.

## 4. Non-Goals

1. Do not change the model used for normal interactive chat.
2. Do not add `small` or `haiku` to the user-facing model selector.
3. Do not route tool-calling, plan execution, agent reasoning, image requests, or arbitrary prompts to the small model.
4. Do not select a small model by checking prompt length or guessing from a model name.
5. Do not require a new database entity or migration.
6. Do not give worker processes direct database access.
7. Do not delete or rewrite original conversation messages.
8. Do not silently fall back to the normal model for routine auto-dream or incremental session-memory work.
9. Do not send image attachments through the small-model route. The server documents that image requests use a different selection path.
10. Do not expose server administration for `is_small_model` in the desktop app.

## 5. Users and User Outcomes

### 5.1 Hosted AI user

The user receives the same visible chat behavior while background memory work consumes a lower-cost model. Long conversations remain compactable even if the small-model configuration is temporarily unavailable.

### 5.2 Local or custom provider user

The user's provider continues receiving real model IDs. AiFetchly does not send the hosted `small` alias to an endpoint that may not support it.

### 5.3 Administrator or operator

The operator can configure one or more hosted chat settings with `is_small_model = true`, verify which real model handled each workload, and detect missing configuration or quality regressions.

### 5.4 Developer

The developer adds a lightweight workload through one explicit routing API and one workload profile. The developer does not reproduce provider checks or fallback rules in individual services.

## 6. Definitions

### 6.1 Small model

A normal hosted chat API setting marked `is_small_model = true`. The AI server resolves the virtual, case-insensitive aliases `small` and `haiku` to the best healthy small-model setting in the current environment.

AiFetchly shall send `small`. It shall store the real model ID returned in the response.

### 6.2 Lightweight workload

An allowlisted, text-only completion task whose expected output is a summary or structured consolidation result and which does not execute tools.

### 6.3 Normal model

The model that the current provider would use without lightweight routing. For hosted AI this is the requested chat model or server default. For a local/custom provider it is the requested real model or configured provider default.

### 6.4 Definitive failure

A response that proves the request did not produce a usable result and identifies a safe next action, such as `small_model_unavailable`, a context-limit rejection, or an empty completion response.

### 6.5 Ambiguous failure

A network interruption or timeout where the server may have completed the request even though the client did not receive the response. AiFetchly shall not automatically resubmit an ambiguous failure.

## 7. Workload Classification

Only the following workloads are in the initial allowlist:

| Workload ID              | Current entry point           | Trigger                                   | User criticality    | Hosted route                      |
| ------------------------ | ----------------------------- | ----------------------------------------- | ------------------- | --------------------------------- |
| `user_auto_dream`        | `AIAutoDreamService`          | Background or manual run                  | Optional background | `small`                           |
| `workspace_auto_dream`   | `AIWorkspaceAutoDreamService` | Background or manual run                  | Optional background | `small`                           |
| `session_memory_summary` | `AIChatCompactAgentService`   | Background after chat turns               | Optional background | `small`                           |
| `conversation_compact`   | `AIChatCompactAgentService`   | Manual action or context-pressure trigger | User critical       | `small`, with controlled fallback |

All other workloads shall use existing routing unless a later PRD adds them to the allowlist.

## 8. Product Behavior

### 8.1 Routing architecture

```text
User auto-dream --------------------+
Workspace auto-dream ---------------+
Incremental session summary --------+--> Lightweight completion API
Full conversation compact ----------+          |
                                                +--> Hosted provider
                                                |      request.model = "small"
                                                |
                                                +--> Local/custom provider
                                                       requested real model
                                                       or provider default

Normal chat, tools, plan execution ------> Existing chat completion API
```

AiFetchly shall expose one central lightweight completion operation at the provider boundary. Workload services shall request lightweight completion without implementing hosted/local branching themselves.

The routing operation shall accept a typed workload ID so that request profiles, fallback rules, logging, and future policy changes remain explicit.

### 8.2 Provider behavior

#### Hosted provider

1. Replace any incoming model preference with `model: "small"` for the first lightweight attempt.
2. Keep the request text-only and omit tools.
3. Send the workload profile's temperature and output-token limit.
4. Store the resolved `response.model`, never the alias, in the existing run or summary record.

#### Local or custom provider

1. Do not send `small` or `haiku` as a virtual alias.
2. Preserve a requested real model when the caller supplied one.
3. Otherwise use the configured local provider default model.
4. Apply the same temperature, output budget, validation, and context-budget rules where supported.
5. Use existing local-provider error behavior. Hosted small-model fallback rules do not apply.

#### Worker process

Worker-hosted completion may use the small alias only through the existing authenticated hosted path. No worker may read or write compact or memory tables directly.

### 8.3 Workload profiles

Initial defaults:

| Workload               | Temperature | Maximum output tokens | Tool choice | Response validation                        |
| ---------------------- | ----------: | --------------------: | ----------- | ------------------------------------------ |
| User auto-dream        |       `0.1` |                `4000` | None        | Strict consolidation JSON parser           |
| Workspace auto-dream   |       `0.1` |                `4000` | None        | Strict workspace consolidation JSON parser |
| Session-memory summary |       `0.2` |                `2000` | None        | Non-empty structured markdown              |
| Conversation compact   |       `0.2` |                `4000` | None        | Non-empty structured markdown              |

These values shall live in one typed configuration map. Individual services shall not repeat numeric literals.

The configuration map is an application default, not a user-facing settings surface in the first release.

### 8.4 Model capability discovery

Before full conversation compaction moves to the small model in production, the AI server shall expose small-model capability metadata. The preferred extension to `GET /v1/models` is:

```json
{
  "object": "list",
  "data": [],
  "default_model": "gpt-4o",
  "small_model": {
    "available": true,
    "resolved_model": "claude-haiku",
    "context_size": 200000,
    "max_tokens": 4096
  }
}
```

Requirements:

1. `available` shall reflect the current environment.
2. `resolved_model` shall identify the model that would currently receive the alias.
3. `context_size` shall be the usable input-plus-output context window.
4. `max_tokens` shall be the maximum supported output value.
5. Capability metadata shall not expose credentials or provider secrets.
6. AiFetchly shall cache this metadata with the existing model catalog and invalidate it on provider changes.

If capability metadata is absent, AiFetchly may route bounded auto-dream and incremental summary work to `small`, but shall keep full compact on the normal model unless a conservative, tested context limit is configured for that release.

### 8.5 Input budgeting

Every lightweight request shall reserve space for:

1. System instructions.
2. Required response headings or JSON schema.
3. Maximum output tokens.
4. A safety margin of at least 10 percent of the small model's context window.

The usable input budget is:

```text
usable_input = context_window
             - max_output_tokens
             - fixed_prompt_estimate
             - safety_margin
```

AiFetchly shall use `AIChatTokenEstimator` for client-side estimates. Server rejection remains authoritative.

#### Auto-dream budgeting

Auto-dream already limits source counts, message counts, and source message length. It does not currently impose a total token limit across active memories and packets.

The new behavior shall:

1. Add active memories and source packets only while they fit within the usable budget.
2. Prefer the newest changed packets.
3. Preserve enough active-memory identity and content to detect duplicates and contradictions.
4. Process overflow packets in later bounded batches rather than discarding them.
5. Advance `reviewedThrough` only through source material that was actually included in a successful batch.
6. Never advance the consolidation watermark after a failed or unparseable response.
7. Cap tool-call summaries as part of the same total budget.

#### Incremental session-memory budgeting

The request shall contain:

- The existing session summary.
- New message rows after the stored boundary.
- Required summary headings.

If the delta does not fit, AiFetchly shall split it into chronological chunks and update the rolling summary once per chunk. The persisted boundary shall advance only after each successful chunk.

#### Full conversation compact budgeting

Full compact shall stop sending the entire raw conversation unconditionally.

```text
Active compact summary, if any
              +
Messages after its stored boundary
              |
              v
Fits one small-model request?
       +------+------+
       |             |
      yes            no
       |             |
Summarize once   Summarize chronological chunks
                       |
                 Merge chunk summaries
```

Requirements:

1. Reuse the active compact summary as the representation of already-covered history.
2. Add only messages after the compact boundary when an active summary exists.
3. When no prior summary exists and the transcript exceeds the budget, summarize chronological chunks and merge their summaries.
4. Keep tool-call and matching tool-result groups together in the same chunk.
5. Preserve original database rows.
6. Save a new compact boundary only after the final merged summary passes validation.
7. If any intermediate chunk fails, leave the previous active compact unchanged.
8. Maintain deterministic chronological ordering for equal timestamps by using the existing row ID tie-breaker.

## 9. Failure and Fallback Contract

### 9.1 Principles

1. Background optimization must not silently create high normal-model cost.
2. Conversation survival is more important than the cost of one controlled fallback.
3. Retry only when the client knows the request did not complete or when the existing retry policy explicitly classifies it as safe.
4. Never catch every error and retry with the normal model.
5. Validate output before any memory or compact state is changed.
6. Persist and display the real model that produced the accepted output.
7. A fallback attempt shall happen at most once per logical workload execution.

### 9.2 Failure matrix

| Failure                                             | Optional background workloads                                          | Manual or context-protection compact                                                                    | User-visible behavior                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Small model not configured, typed 404               | Record failure; no normal-model fallback; enter configuration cooldown | Retry once with normal/current model                                                                    | Manual compact shows success with resolved model, or a clear final error |
| Requested small model rejected as unavailable       | Same as missing configuration                                          | Retry once with normal/current model                                                                    | Same as above                                                            |
| Authentication or subscription failure              | No retry; no fallback                                                  | No retry; no fallback                                                                                   | Existing subscription/auth error                                         |
| Validation error in request                         | No retry; developer-visible error                                      | No retry; developer-visible error                                                                       | Generic safe error; detailed local log                                   |
| Rate limit with authoritative retry delay           | At most one delayed retry within background retry budget               | Use existing foreground recovery policy                                                                 | Existing recovery status where available                                 |
| Hosted 5xx or overload                              | At most one retry with jitter; no model fallback                       | Use existing retry policy, then one normal-model fallback only if classified as model-specific overload | Compact remains recoverable; no repeated fallback loop                   |
| Network unavailable before request is sent          | At most one retry if classified safe                                   | Existing foreground recovery policy                                                                     | Clear network error after exhaustion                                     |
| Timeout or connection loss after request submission | Do not auto-resubmit                                                   | Do not auto-resubmit                                                                                    | Manual action reports uncertain failure and allows user retry            |
| Context overflow                                    | Reduce batch/chunk size and retry once; no normal-model fallback       | Reduce batch/chunk size once, then normal-model fallback once                                           | Compact error only after both safe paths fail                            |
| Empty summary                                       | Record failure; no fallback                                            | Retry once with normal/current model                                                                    | Manual compact succeeds or shows clear invalid-output error              |
| Invalid auto-dream JSON                             | One same-small-model repair attempt; no normal-model fallback          | Not applicable                                                                                          | Failed run remains visible in memory status                              |
| Secret-filter or semantic validation rejects output | Record failure; no fallback                                            | Keep previous compact/memory state                                                                      | No unsafe data is persisted                                              |
| Database save fails after valid model output        | Do not call model again                                                | Do not call model again                                                                                 | Existing state remains authoritative; log persistence failure            |
| User cancels                                        | Stop immediately; no retry or fallback                                 | Stop immediately; no retry or fallback                                                                  | Existing cancelled state                                                 |

### 9.3 Background cooldown

Background jobs shall prevent repeated failures after every completed chat turn.

1. A typed missing-small-model or invalid-small-model configuration failure shall open a six-hour cooldown for that workload.
2. Three consecutive transient failures shall open a one-hour cooldown.
3. A successful lightweight completion shall reset its workload's failure count and cooldown.
4. Manual auto-dream execution may bypass the scheduling cooldown, but it shall not change the no-expensive-fallback rule.
5. Cooldown state may initially be process-local if it is clearly logged; durable cooldown state is preferred when the existing run records can represent it without a new table.
6. A process restart shall not cause more than one immediate retry per workload.

### 9.4 Auto-dream JSON repair

When the small model returns non-empty but invalid consolidation JSON:

1. Do not apply create, update, or archive operations.
2. Send one repair request to the same small model containing the invalid output and the required JSON schema.
3. Do not include the original full source prompt again unless needed for correction.
4. If repaired output still fails validation, mark the run failed.
5. Do not fall back to the normal model.

### 9.5 Fallback safety

The normal-model fallback shall:

1. Reuse the same sanitized and budgeted text input.
2. Remove the virtual `small` alias and resolve through normal provider routing.
3. Occur once at most.
4. Never fall back again through the general chat model-fallback chain.
5. Preserve `requestedWorkload`, `requestedAlias`, `fallbackReason`, and resolved response model in logs.
6. Save only the successful response.
7. Never replay a database mutation because all mutations occur after response validation.

## 10. User Experience

### 10.1 No new model selector option

Users shall not select `small`. It is an internal workload route and may resolve to a different real model as server configuration changes.

### 10.2 Auto-dream status

Existing user-memory and workspace-memory status surfaces shall continue showing running, successful, and failed runs. A missing small-model configuration shall produce a clear safe message such as:

> Background memory summary is paused because no small AI model is configured. Your conversations are unaffected.

If this new message is added to the UI, all six language files and the corresponding component tests shall be updated in the same change.

### 10.3 Manual compact

Manual compact shall keep its existing loading and error behavior. If the small model is unavailable and normal-model fallback succeeds, the action shall complete without requiring a second click.

The first release does not need to announce the fallback unless an existing debug/status surface already exposes model metadata. The resolved model shall remain inspectable in stored compact metadata and logs.

### 10.4 Automatic context-protection compact

Automatic full compact shall remain non-blocking where possible. If both small-model processing and the one allowed normal-model fallback fail, the next chat request shall use existing context-recovery behavior and surface a clear context error rather than silently losing conversation state.

## 11. Functional Requirements

### 11.1 Routing

1. The system shall provide one provider-aware lightweight completion operation.
2. The operation shall require an allowlisted workload ID.
3. Hosted lightweight requests shall use `model: "small"` for their first attempt.
4. Local/custom requests shall never receive the hosted alias by default.
5. Normal chat requests shall not pass through lightweight routing.
6. Lightweight requests shall be text-only and shall not advertise tools.
7. The alias shall not appear in the user model catalog or selector.

### 11.2 Request construction

1. Each workload shall use its configured temperature and output limit.
2. Each request shall fit the discovered or configured input budget.
3. The system shall reserve output and safety-margin tokens before adding source content.
4. Structured workloads shall validate their output before persistence.
5. A request shall include a stable workload identifier in local logs and server metadata when the API supports it.

### 11.3 State and persistence

1. Existing run and compact entities shall continue storing the resolved response model.
2. No memory operation shall be applied before the full auto-dream response passes validation.
3. No compact boundary shall become active before the final summary passes validation.
4. Failed requests shall preserve the last successful session memory, compact summary, and durable memories.
5. Auto-dream watermarks shall advance only through successfully processed source material.
6. Database save failure shall not trigger another model call.

### 11.4 Retry and fallback

1. Retry and fallback decisions shall use typed failure categories, not substring checks at call sites.
2. Optional background workloads shall never fall back to a normal hosted model.
3. Manual and automatic full compact may fall back once under the failure matrix.
4. Ambiguous timeout failures shall not be automatically resubmitted.
5. Cancellation shall prevent all further retry, repair, fallback, and persistence work.
6. Workload cooldowns shall suppress repeated background failures.

### 11.5 AI enablement

1. Every hosted auto-dream IPC path shall continue checking `Token` and `USER_AI_ENABLED` before parsing request data or performing work.
2. Conversation compact shall continue using the existing provider availability resolver so local-provider users can compact without a hosted subscription.
3. Lightweight routing shall not bypass subscription or provider configuration checks.

## 12. Non-Functional Requirements

### 12.1 Reliability

- Background summary failure shall never fail or delay the completed visible chat turn.
- The last successful memory or compact summary shall remain active after a failed replacement attempt.
- Concurrent runs shall continue using existing per-service and per-conversation locks.
- One logical run shall create at most one accepted state transition.

### 12.2 Cost control

- Optional background work shall have zero automatic normal-model fallbacks.
- A user-critical compact shall have at most one normal-model fallback.
- JSON repair shall contain only the invalid output and schema where possible.
- Retries and fallbacks shall be countable by workload and reason.

### 12.3 Performance

- Model capability discovery shall use the existing in-process model catalog cache.
- Token estimation and chunk construction shall happen before the network call.
- Source batching shall avoid loading unnecessary full transcripts beyond existing bounded queries.
- Background workloads shall not run concurrently for the same logical scope.

### 12.4 Privacy and security

- Existing secret filters and prompt instructions shall remain active.
- Logs shall not contain raw conversations, memory contents, credentials, cookies, tokens, or provider API keys.
- Error messages sent to the renderer shall be safe and bounded.
- Hosted aliases and provider configuration shall be resolved in the main process, never the renderer.

### 12.5 Compatibility

- Older servers without `small_model` capability metadata shall continue supporting normal chat.
- Missing capability metadata shall not make full compact unsafe.
- Existing stored run and compact records shall remain readable.
- Existing local-provider configuration shall require no migration.

## 13. Observability

Every lightweight execution shall log structured metadata without prompt content:

| Field                  | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `workload`             | Allowlisted workload ID                              |
| `provider_kind`        | `hosted` or `local`                                  |
| `requested_route`      | `small` or `normal`                                  |
| `resolved_model`       | Model returned by the accepted response              |
| `attempt_count`        | Total network completion attempts                    |
| `repair_attempted`     | Whether JSON repair ran                              |
| `fallback_attempted`   | Whether normal-model fallback ran                    |
| `fallback_reason`      | Typed failure category                               |
| `input_token_estimate` | Client estimate before the call                      |
| `input_tokens`         | Server usage when returned                           |
| `output_tokens`        | Server usage when returned                           |
| `duration_ms`          | End-to-end execution time                            |
| `outcome`              | `success`, `failed`, `cancelled`, or `cooldown_skip` |

Existing run records shall remain the source for user/workspace consolidation status. Existing compact records shall remain the source for compact model and boundary metadata. Server usage analytics shall be used to verify cost by resolved model.

Logs shall distinguish:

- Small-model routing succeeded.
- Small-model configuration is unavailable.
- A background run was skipped because of cooldown.
- A user-critical compact used its one normal-model fallback.
- A result was rejected by parser, secret filter, or persistence.

## 14. Success Metrics

Measure a baseline before rollout and compare by workload after rollout.

1. At least 90 percent of successful hosted auto-dream and session-summary calls resolve to the configured small model.
2. Normal interactive chat model distribution remains unchanged.
3. Hosted cost per successful auto-dream or summary decreases relative to baseline.
4. Auto-dream parse-failure rate does not regress by more than 2 percentage points.
5. Conversation compact success rate remains at least 99 percent when the normal provider is available.
6. Small-model-unavailable failures do not create more than one background attempt per cooldown window.
7. No local/custom provider request contains the hosted virtual alias.
8. No successful run advances a source or compact boundary past unprocessed content.
9. No background lightweight failure causes a visible chat turn to fail.

## 15. Rollout Plan

### Phase 0: Server readiness

1. Configure at least one healthy chat setting with `is_small_model = true` in each deployed environment.
2. Add small-model capability metadata to the model catalog response.
3. Verify alias selection, response `model`, usage accounting, 404 behavior, environment isolation, and text-only behavior.
4. Confirm the configured model's context and output limits.

Exit criterion: a production-like environment can resolve `small`, report its capabilities, and return the real resolved model.

### Phase 1: Central routing and optional bounded workloads

1. Add provider-aware lightweight completion routing.
2. Add typed workload profiles.
3. Route user auto-dream and workspace auto-dream to the lightweight operation.
4. Route incremental session-memory summaries to the lightweight operation.
5. Add typed errors, background cooldowns, JSON repair, structured logging, and tests.
6. Keep full compact on the existing normal model.

Exit criterion: optional background workloads meet parse-quality and cooldown targets without affecting local providers.

### Phase 2: Budgeted full compact

1. Add small-model capability consumption to the model catalog.
2. Implement boundary-aware and chunked full compact.
3. Route manual and automatic full compact through the lightweight operation.
4. Enable the controlled one-time normal-model fallback.
5. Test large conversations, tool-call grouping, cancellation, and partial chunk failure.

Exit criterion: large conversations compact successfully within the small-model budget, with no boundary corruption.

### Phase 3: Production verification

1. Compare cost, latency, parse failures, fallback frequency, and compact success against baseline.
2. Investigate any workload with more than 5 percent normal-model fallback.
3. Keep a release-level kill switch that routes all lightweight workloads through existing normal behavior.
4. Remove the kill switch only after two stable releases, or retain it if operationally useful.

## 16. Kill Switch and Reversibility

The release shall include one main-process setting or build-time configuration that disables lightweight routing globally.

When disabled:

- Requests use their previous model behavior.
- Existing memory and compact records remain valid.
- No migration or data repair is needed.
- The renderer requires no change.

The kill switch shall not disable auto-dream itself. Existing auto-dream enablement settings remain separate.

## 17. Acceptance Criteria

### Routing

- [ ] Hosted user auto-dream sends `model: "small"`.
- [ ] Hosted workspace auto-dream sends `model: "small"`.
- [ ] Hosted incremental session summary sends `model: "small"`.
- [ ] Hosted budgeted full compact sends `model: "small"` after Phase 2 is enabled.
- [ ] Local/custom completion never receives the hosted alias.
- [ ] Normal chat and tool-calling requests retain existing model selection.
- [ ] `small` is absent from the user model selector.

### Failure behavior

- [ ] Missing small-model configuration records a background failure and opens the six-hour cooldown.
- [ ] Optional background work never falls back to the normal model.
- [ ] Manual full compact falls back at most once after a definitive small-model failure.
- [ ] Automatic full compact falls back at most once when needed to protect the active conversation.
- [ ] Timeout after submission does not trigger an automatic duplicate request.
- [ ] Cancellation prevents repair, retry, fallback, and persistence.
- [ ] Invalid auto-dream JSON receives at most one same-model repair attempt.
- [ ] Failed replacement attempts preserve the last successful state.

### Context safety

- [ ] Every lightweight request reserves output tokens and a safety margin.
- [ ] Oversized session deltas are processed in chronological chunks.
- [ ] Full compact reuses the active summary and processes only later messages.
- [ ] Tool-call and tool-result groups are not split across compact chunks.
- [ ] Auto-dream advances its watermark only through successfully processed packets.
- [ ] A partial chunk failure does not activate a partial compact summary.

### Persistence and observability

- [ ] Successful records store the real model returned by the provider.
- [ ] Logs contain workload, route, model, attempts, fallback, timing, and outcome metadata.
- [ ] Logs do not contain raw prompts, transcripts, memories, or credentials.
- [ ] Server usage analytics can distinguish cost by resolved model.

### Compatibility

- [ ] Existing databases open without migration.
- [ ] Existing compact and memory records remain readable.
- [ ] Older servers without capability metadata keep normal chat working.
- [ ] Full compact stays on the normal model until a safe small-model context budget is available.

## 18. Test Requirements

### 18.1 API and provider-routing unit tests

Add tests for:

1. Hosted lightweight requests forcing `model: "small"`.
2. Local requests preserving a requested real model.
3. Local requests using the configured default when no model is provided.
4. Normal hosted chat remaining unchanged.
5. Text-only and no-tools enforcement.
6. Capability metadata parsing, cache reuse, and cache invalidation.
7. Typed classification for missing alias, authentication, rate limit, overload, context overflow, timeout, cancellation, and unknown errors.
8. Kill-switch behavior.

### 18.2 Auto-dream service tests

Extend the existing user and workspace auto-dream tests to cover:

1. The lightweight dependency receiving the expected workload ID and profile.
2. Invalid JSON repair succeeding.
3. Invalid JSON repair failing without database mutations.
4. Missing small-model configuration opening cooldown.
5. Cooldown suppressing subsequent background calls.
6. Manual execution bypassing scheduling cooldown without enabling expensive fallback.
7. Watermark advancement across multiple bounded batches.
8. Database failure not causing another model call.

### 18.3 Compact service tests

Extend `AIChatCompactAgentService` tests to cover:

1. Incremental summaries using lightweight completion.
2. Oversized deltas updating in chronological chunks.
3. Per-chunk boundary advancement only after success.
4. Full compact using the prior active summary plus later messages.
5. First-time oversized compact using hierarchical chunk summaries.
6. Tool-call/result atomic grouping.
7. One normal-model fallback on definitive small-model unavailability.
8. No duplicate submission on ambiguous timeout.
9. Empty small-model output triggering one allowed full-compact fallback.
10. Cancellation before and during chunk processing.
11. Partial chunk failure preserving the previous active compact.
12. The stored model matching `response.model` from the accepted attempt.

### 18.4 IPC regression tests

Verify:

1. AI enable checks remain first in all affected hosted AI IPC handlers.
2. Manual compact still validates and sanitizes input.
3. IPC handlers do not contain database access.
4. Existing success, failure, and cancellation response shapes remain compatible.

### 18.5 Integration tests

Use a fake hosted provider/server to verify:

1. Alias success returns and stores a real resolved model.
2. Alias 404 produces background cooldown without fallback.
3. Alias 404 during manual compact invokes exactly one normal-model request.
4. A large conversation produces multiple bounded small-model calls and one final compact record.
5. A local provider receives its configured real model.

### 18.6 Quality evaluation

Create a fixed evaluation corpus containing:

- Short and long conversations.
- Contradictory user preferences.
- Multiple workspace decisions.
- Tool successes and failures.
- Pending tasks and current-state handoffs.
- Content containing secret-like values that must not be stored.
- Conversations near and above the small-model context limit.

Compare the configured small model with the current normal model on:

1. Required fact retention.
2. Unsupported fact introduction.
3. Decision and pending-task retention.
4. Valid JSON rate for auto-dream.
5. Required markdown heading coverage.
6. Secret-filter rejection rate.
7. Output token count, latency, and cost.

The production switch shall not proceed if the small model fails the agreed quality threshold, even if it is cheaper.

## 19. Expected Implementation Surface

The exact implementation may change during technical design, but the expected primary files are:

| Area                                 | Expected files                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Provider-aware routing               | `src/api/aiChatApi.ts`, provider resolver/client tests                             |
| Workload profiles and typed failures | New small focused service or types file under `src/service/`                       |
| Auto-dream wiring                    | `src/service/AIAutoDreamFactory.ts`, both auto-dream services as needed            |
| Compact routing and budgeting        | `src/service/AIChatCompactAgentService.ts`, compact prompt/budget helpers          |
| Capability discovery                 | `src/service/AIChatModelCatalogService.ts`, OpenAI model response types            |
| Existing tests                       | `test/vitest/main/service/`, `test/vitest/utilitycode/`, IPC tests                 |
| Optional UI error text               | Existing memory/compact components plus all six language files and component tests |

Database access shall remain in Model and Module classes. Provider routing, prompt budgeting, retry policy, and orchestration shall remain in service/API layers. IPC handlers shall remain communication-only.

## 20. Dependencies

1. The AI server must support `model: "small"` and return the resolved real model.
2. Every target environment must configure at least one healthy `is_small_model` chat setting.
3. The AI server should return structured error information for missing small-model configuration.
4. The AI server must expose small-model context and output capability metadata before Phase 2 production rollout.
5. Existing AI Chat recovery classification should be reused where it can represent non-streaming completion failures accurately.

## 21. Risks and Mitigations

### Summary quality regression

**Risk:** A cheaper model may omit decisions, pending tasks, or contradictions.

**Mitigation:** Fixed evaluation corpus, stable prompts, low temperature, output validation, phased rollout, and kill switch.

### Small context window

**Risk:** A conversation that fits the main model may overflow the small model.

**Mitigation:** Capability metadata, reserved output budget, chunking, boundary reuse, and delayed Phase 2 rollout.

### Silent cost regression

**Risk:** Broad fallback turns every background failure into a normal-model request.

**Mitigation:** No fallback for optional workloads, one fallback for user-critical compact, structured counters, and alerts.

### Repeated configuration failure

**Risk:** Every chat turn triggers another alias 404.

**Mitigation:** Typed configuration error and six-hour workload cooldown.

### Duplicate billable request

**Risk:** Automatic retry after a timeout repeats an upstream completion.

**Mitigation:** Treat post-submission timeout as ambiguous and require explicit user retry.

### Watermark data loss

**Risk:** Input budgeting omits packets but the run marks them reviewed.

**Mitigation:** Batch-aware watermarks that advance only through successfully processed sources.

### Local-provider breakage

**Risk:** A local endpoint receives `model: "small"` and returns model-not-found.

**Mitigation:** Resolve provider kind centrally and never forward the hosted alias to local/custom providers by default.

### Partial compact activation

**Risk:** One chunk succeeds and another fails, leaving incomplete conversation context active.

**Mitigation:** Keep intermediate summaries transient and activate only the final validated summary.

## 22. Open Questions for Technical Design

1. Should the AI server add `small_model` metadata to `GET /v1/models`, or expose a separate authenticated capabilities endpoint?
2. Can the hosted API return a stable machine-readable error code such as `small_model_unavailable` in addition to HTTP 404?
3. Should background cooldown use existing consolidation run records or a small persisted system-setting state?
4. What evaluation threshold is acceptable for required-fact retention and unsupported-fact rate?
5. Should the global lightweight-routing kill switch be a hidden system setting, environment flag, or remotely controlled capability?

These questions affect technical design but do not change the product rule: optional background workloads do not receive expensive fallback, while user-critical compact receives at most one controlled fallback.

## 23. Definition of Done

The feature is complete when:

1. All four allowlisted workloads follow the provider-aware routing contract.
2. Full compact respects the small model's real context window and handles oversized input without losing boundaries.
3. The failure matrix is implemented with typed errors, bounded retries, cooldowns, and one controlled critical-path fallback.
4. Normal chat and local-provider behavior remain unchanged.
5. Existing records store the resolved real model.
6. Unit, IPC, integration, and quality-evaluation gates pass.
7. Production metrics show lower workload cost without an unacceptable summary-quality or compact-success regression.
8. The kill switch can restore prior routing without a database change.
