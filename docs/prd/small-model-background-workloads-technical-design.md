# Technical Design: Small-Model Routing for Background AI Workloads

**Date:** 2026-08-23

**Status:** Draft for implementation

**Owner:** AiFetchly AI Chat

**Product requirements:** [Small-Model Routing for Auto-Dream and Conversation Summaries](small-model-background-workloads-prd.md)

**Server contract:** `../aifetchserver/doc/API_Endpoints_Documentation.md`, section “Small Model Alias (`haiku` / `small`)”

**Related designs:**

- [Agent Memory and Conversation Compact](../superpowers/specs/2026-06-15-agent-memory-compact-technical-design.md)
- [Local AI Provider Chat](local-ai-provider-chat-technical-design.md)

## 1. Purpose

This document defines how AiFetchly routes four bounded, text-only workloads to the hosted AI server's virtual `small` model while preserving local-provider compatibility, preventing duplicate billable requests, and keeping conversation compaction recoverable.

The four initial workloads are:

1. User auto-dream.
2. Workspace auto-dream.
3. Incremental session-memory summary.
4. Full conversation compact.

This is an implementation design, not a generic model-selection framework. A workload must be explicitly registered before it can use the lightweight route. Normal chat, tools, planning, agents, and image inputs remain on their existing paths.

## 2. Current-State Findings

### 2.1 Completion routing

`AiChatApi.openAIChatCompletion()` is the current non-streaming completion boundary. It selects the active provider:

- Hosted AiFetchly calls `/api/ai/v1/chat/completions` through `HttpClient`.
- Local/custom providers call `OpenAICompatibleProviderClient.complete()`.

The request type already accepts `model`, `temperature`, and `max_tokens`. No protocol replacement is required.

### 2.2 Lightweight callers

`AIAutoDreamFactory` currently injects `new AiChatApi().openAIChatCompletion()` into both auto-dream services. `AIChatCompactAgentService` receives the same normal completion dependency from `ai-chat-v2-ipc.ts`. Each caller currently decides its own request shape, and none owns a safe small-model failure policy.

### 2.3 Capability catalog

`AIChatModelCatalogService` caches context and maximum-output metadata returned by `GET /v1/models`. `OpenAIModelsResponse` has `default_model`, but `normalizeModelsResponse()` can discard extra top-level metadata when normalizing an OpenAI-shaped response. The catalog has no representation of the virtual small route.

### 2.4 Error information

`HttpClient._fetchJSON()` currently throws `Error(res.statusText)` for a non-success response. That removes the status code, bounded response body, response headers, and any server error code. A centralized fallback policy cannot safely distinguish authentication, missing small-model configuration, overload, context overflow, or a malformed request until this boundary preserves typed failure data.

### 2.5 Auto-dream cursor risk

`AIAutoDreamSourceCollector` obtains conversations and completed tasks newest-first, truncates them to five of each kind, and sets `reviewedThrough` to the wall-clock collection time. That is safe only while one request always processes every eligible source. Once model-aware batching is introduced, advancing that cursor can skip older eligible sources forever.

The new design therefore uses a cursor derived from successfully committed source packets, not from the clock. Bounded selection is oldest-first. This deliberately corrects the earlier PRD wording that preferred newest packets.

### 2.6 Persistence

Existing records already contain the resolved response model:

- User and workspace consolidation runs have `model`.
- Session-memory and compact-summary records have `model`.
- Full compact activation is already transactional.

No database migration is needed. The run models do need to accept `reviewedThrough` when completing a run so the cursor is committed with the successful result rather than when the run starts.

## 3. Design Decisions

| Decision                    | Choice                                   | Reason                                                         |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Hosted alias                | Always send `small`                      | One canonical alias; server matching remains case-insensitive. |
| Local/custom behavior       | Preserve real requested/default model    | The hosted alias is not portable.                              |
| Policy owner                | One `AIChatLightweightCompletionService` | Prevent duplicated routing, retry, and fallback logic.         |
| Optional workload fallback  | Never use normal model automatically     | Cost behavior must be predictable.                             |
| Compact fallback            | At most one normal-model attempt         | Conversation survival outweighs one controlled extra request.  |
| Ambiguous transport failure | No retry and no fallback                 | The server may already have completed a billable request.      |
| Capability absence          | Keep full compact on normal route        | An unknown context window is unsafe for large input.           |
| Auto-dream cursor order     | Oldest unreviewed first                  | A single timestamp cursor can then advance without gaps.       |
| Cooldown storage            | Process-local in phase 1                 | Meets the PRD and avoids schema work; resets are explicit.     |
| Kill switch                 | Environment override, default disabled (§8.3 amendment) | Release-operator control with no schema or settings UI change. |
| Tools and media             | Reject at router boundary                | The workload route is text-only and cannot execute tools.      |

## 4. Target Architecture

```text
 AIAutoDreamService -------------------+
 AIWorkspaceAutoDreamService ----------+
 AIChatCompactAgentService ------------+--> AIChatLightweightCompletionService
                                              |  profile + policy
                                              |  budget + classification
                                              |  retry/cooldown/fallback
                                              v
                                      AIChatLightweightProvider
                                         /                 \
                              hosted AiFetchly          local/custom
                              model = "small"          real/default model
                                         \                 /
                                          v               v
                                         AiChatApi completion paths

 Model capabilities --> AIChatModelCatalogService --> prompt budget/chunking
 Typed HTTP failures --> failure classifier --------> policy state machine
```

The workload services remain responsible for domain behavior: selecting sources, building prompts, validating output, and committing results. The lightweight service owns only completion-route policy and attempt control.

## 5. Proposed Files and Responsibilities

### 5.1 New files

| File                                                | Responsibility                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/service/AIChatLightweightTypes.ts`             | Workload IDs, profiles, route results, typed failure reasons, and attempt metadata.                         |
| `src/service/AIChatLightweightProfiles.ts`          | Frozen allowlist and per-workload defaults.                                                                 |
| `src/service/AIChatLightweightCompletionService.ts` | Provider selection, kill switch, retries, cooldown, compact fallback, cancellation, and structured logging. |
| `src/service/AIChatLightweightCompletionFactory.ts` | Shared process singleton plus reset hooks for provider/database changes and tests.                          |
| `src/service/AIChatLightweightFailureClassifier.ts` | Convert typed HTTP/provider/parser failures into policy categories.                                         |
| `src/service/AIChatPromptBudget.ts`                 | Pure token-budget, atomic grouping, and deterministic chunk helpers.                                        |
| `src/config/aiLightweightRouting.ts`                | Parse the release-level environment kill switch with a safe default.                                        |

### 5.2 Modified files

| File                                                       | Change                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/api/aiChatApi.ts`                                     | Preserve small capability metadata; add hosted lightweight request method; pass cancellation to non-streaming completion. |
| `src/modules/lib/httpclient.ts`                            | Throw a typed response error with status, bounded body, and selected headers.                                             |
| `src/service/aiProvider/ChatProviderClient.ts`             | Add non-stream completion options containing `AbortSignal`.                                                               |
| `src/service/aiProvider/OpenAICompatibleProviderClient.ts` | Forward the signal while retaining real/default model behavior.                                                           |
| `src/service/AIChatModelCatalogService.ts`                 | Cache and expose small-route capabilities.                                                                                |
| `src/service/AIAutoDreamFactory.ts`                        | Inject the shared lightweight service.                                                                                    |
| `src/service/AIAutoDreamSourceCollector.ts`                | Produce gap-free oldest-first batches and a source-derived cursor.                                                        |
| `src/service/AIAutoDreamService.ts`                        | Use profile, budgeted batches, repair, transactional apply, and successful cursor commit.                                 |
| `src/service/AIWorkspaceAutoDreamService.ts`               | Apply the same policy per workspace.                                                                                      |
| `src/service/AIChatCompactAgentService.ts`                 | Chunk incremental summaries; build full compact hierarchically; use controlled fallback.                                  |
| `src/model/AIMemoryConsolidationRun.model.ts`              | Write `reviewedThrough` only on successful completion.                                                                    |
| `src/model/AIWorkspaceMemoryConsolidationRun.model.ts`     | Same for a workspace run.                                                                                                 |
| User/workspace memory and consolidation-run models/modules | Add one transaction-scoped plan application plus successful run completion.                                               |
| `src/main-process/communication/ai-chat-v2-ipc.ts`         | Reset shared lightweight state on provider/database switch.                                                               |

No renderer file is required for the initial release. Therefore this phase adds no user-facing text, translations, or component UI tests.

## 6. Core Types

The following is the intended contract. Names may change during implementation, but the separation of concerns shall remain.

```typescript
export type AIChatLightweightWorkload =
  | "user_auto_dream"
  | "workspace_auto_dream"
  | "session_memory_summary"
  | "conversation_compact";

export type AIChatLightweightCriticality =
  | "optional_background"
  | "conversation_protection";

export type AIChatLightweightFallbackPolicy = "never" | "normal_once";

export interface AIChatLightweightProfile {
  readonly workload: AIChatLightweightWorkload;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly criticality: AIChatLightweightCriticality;
  readonly fallback: AIChatLightweightFallbackPolicy;
  readonly requiresDiscoveredSmallContext: boolean;
}

export type AIChatLightweightFailureReason =
  | "small_model_unavailable"
  | "model_specific_overload"
  | "context_overflow"
  | "rate_limit"
  | "server_error"
  | "authentication"
  | "quota"
  | "invalid_request"
  | "invalid_output"
  | "network_ambiguous"
  | "timeout_ambiguous"
  | "cancelled"
  | "persistence_failure"
  | "unknown";

export interface AIChatLightweightCompletionInput {
  readonly workload: AIChatLightweightWorkload;
  readonly messages: readonly OpenAIChatMessage[];
  readonly normalModel?: string;
  readonly manual: boolean;
  readonly signal?: AbortSignal;
}

export interface AIChatLightweightCompletionResult {
  readonly response: OpenAIChatCompletionResponse;
  readonly route: "hosted_small" | "provider_normal" | "normal_fallback";
  readonly resolvedModel: string;
  readonly attemptCount: number;
  readonly fallbackReason?: AIChatLightweightFailureReason;
}
```

The router constructs the final completion request. Callers cannot supply tools, `tool_choice`, images, or arbitrary temperature/output values through this interface.

## 7. Workload Profiles

```typescript
export const LIGHTWEIGHT_PROFILES: Readonly<
  Record<AIChatLightweightWorkload, AIChatLightweightProfile>
> = Object.freeze({
  user_auto_dream: {
    workload: "user_auto_dream",
    temperature: 0.1,
    maxOutputTokens: 4000,
    criticality: "optional_background",
    fallback: "never",
    requiresDiscoveredSmallContext: false,
  },
  workspace_auto_dream: {
    workload: "workspace_auto_dream",
    temperature: 0.1,
    maxOutputTokens: 4000,
    criticality: "optional_background",
    fallback: "never",
    requiresDiscoveredSmallContext: false,
  },
  session_memory_summary: {
    workload: "session_memory_summary",
    temperature: 0.2,
    maxOutputTokens: 2000,
    criticality: "optional_background",
    fallback: "never",
    requiresDiscoveredSmallContext: false,
  },
  conversation_compact: {
    workload: "conversation_compact",
    temperature: 0.2,
    maxOutputTokens: 4000,
    criticality: "conversation_protection",
    fallback: "normal_once",
    requiresDiscoveredSmallContext: true,
  },
});
```

The map is exhaustive. TypeScript must fail compilation if a new workload ID has no profile.

## 8. Provider and API Contract

### 8.1 Hosted first attempt

For an enabled lightweight route, the hosted request is built as:

```typescript
{
  messages,
  model: "small",
  temperature: profile.temperature,
  max_tokens: effectiveOutputTokens,
  stream: false
}
```

The response's actual `model` is authoritative and is persisted. The alias itself is never written as the resolved model unless an older server incorrectly echoes it; that condition is logged as `resolved_alias_unexpected` but does not invalidate an otherwise usable response.

### 8.2 Local/custom provider

Local and custom providers never receive `small` or `haiku` from this feature. The router calls the existing provider-normal path with `normalModel` when present, otherwise the configured provider default. Profile temperature and output limits still apply.

This is not considered a fallback: no small attempt occurred, so `route` is `provider_normal` and `fallbackReason` is absent.

### 8.3 Kill switch

Read the optional process environment value:

```typescript
export const AI_SMALL_MODEL_ROUTING_ENV =
  "AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED";
```

**Default: DISABLED when absent.** *(Amended 2026-08-25, resolving the SMBW-015 conflict with the earlier "default enabled" wording. The implementation plan, operations guide, code, and tests all ship default-disabled — the safer direction this design's own §22 Phase 1 sanctions while server readiness is incomplete. Revisit only after the Phase 0 server contract and the quality gates in the TODO pass.)*

Accept only explicit case-insensitive `true`/`1` and `false`/`0`; an invalid value is logged once and resolves to disabled so an operator typo cannot unexpectedly enable new routing. The value is read when the shared lightweight service is constructed, so changing it requires an app restart. To enable after server verification, an operator sets `AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED=true` in the environment and restarts the app (production enablement procedure: `docs/small-model-routing-operations.md` §2).

When disabled, every workload uses the provider-normal path and all small-specific retry, cooldown, and fallback behavior is bypassed. Auto-dream's own enablement settings remain unchanged.

### 8.4 Server capability extension

`OpenAIModelsResponse` gains:

```typescript
export interface OpenAISmallModelCapability {
  readonly available: boolean;
  readonly resolved_model?: string;
  readonly context_size?: number;
  readonly max_tokens?: number;
}
```

`normalizeModelsResponse()` must preserve `default_model` and `small_model` for both supported response shapes. It must validate positive integer token values and ignore malformed optional fields without rejecting the model list.

`AIChatModelCatalogService` exposes:

```typescript
getSmallModelCapability(): Promise<OpenAISmallModelCapability | null>;
```

For hosted auto-dream and session summary, absent metadata uses a conservative 32,000-token context assumption. For full compact, absent or invalid metadata means the lightweight route is not eligible; compact goes directly to the normal model with route reason `capability_missing`. This direct route is not counted as the one failure fallback because no unsafe small request was attempted.

The server should also return a machine-readable error:

```json
{
  "error": {
    "code": "small_model_unavailable",
    "message": "No small model configured for this environment"
  }
}
```

Until deployed everywhere, the client classifier may map the documented 404 response to the same typed reason at the API boundary. Workload call sites must never use message substring matching.

## 9. Typed HTTP Errors

Add an exported error to the HTTP client layer:

```typescript
export class HttpResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
    public readonly retryAfterMs?: number,
    public readonly serverCode?: string
  ) {
    super(message);
    this.name = "HttpResponseError";
  }
}
```

Before throwing, `_fetchJSON()` reads at most 16 KiB of the response body, parses `error.code` only when valid JSON, and parses `Retry-After` with an upper bound. It must not log the response body because provider messages can contain request fragments or sensitive data.

Authentication refresh behavior remains in `HttpClient`. If refresh ultimately fails, the thrown error must still classify as authentication rather than generic network failure.

This change is shared infrastructure. Existing tests for token refresh must continue passing, and new tests must prove status/body/code preservation and the 16 KiB bound.

## 10. Failure Classification

Classification is deterministic and central:

| Evidence                                 | Reason                    | Definitive? |                    Retry same route? |                                              Normal fallback? |
| ---------------------------------------- | ------------------------- | ----------: | -----------------------------------: | ------------------------------------------------------------: |
| Server code `small_model_unavailable`    | `small_model_unavailable` |         Yes |                                   No |                                                  Compact only |
| HTTP 401/403 after refresh               | `authentication`          |         Yes |                                   No |                                                            No |
| HTTP 402 or known quota code             | `quota`                   |         Yes |                                   No |                                                            No |
| HTTP 429                                 | `rate_limit`              |         Yes | Once, honoring bounded `Retry-After` |                                                            No |
| HTTP 500/502/503/504                     | `server_error`            |         Yes |                     Once with jitter | Compact only when server code identifies small-route overload |
| Small-route context error                | `context_overflow`        |         Yes |            Once after reducing input |                             Compact after reduced input fails |
| HTTP 400/422 other                       | `invalid_request`         |         Yes |                                   No |                                                            No |
| Empty or invalid summary                 | `invalid_output`          |         Yes |                        Domain policy |                                                  Compact only |
| `AbortError` with caller signal aborted  | `cancelled`               |         Yes |                                   No |                                                            No |
| Client timeout after fetch began         | `timeout_ambiguous`       |          No |                                   No |                                                            No |
| Connection reset/unknown fetch rejection | `network_ambiguous`       |          No |                                   No |                                                            No |
| DB transaction failure                   | `persistence_failure`     |         Yes |                        No model call |                                                            No |

Generic 5xx does not prove that a normal model will work. A compact normal fallback after overload is allowed only when the server returns a stable model-specific code. Otherwise the service performs the one same-route retry and returns the error.

## 11. Attempt State Machine

```text
                         route disabled/local/capability absent
                      +------------------------------------------+
                      |                                          v
start --> validate --> select route --> normal provider ------> validate output
                         |
                         v
                    hosted small
                         |
             +-----------+------------+
             |                        |
          success                 classified failure
             |                        |
      validate output      +----------+-----------+
             |             |          |           |
             v          retry-safe  ambiguous   definitive
          persist           |          |           |
                             v          v      optional: fail
                        retry once     fail     compact: fallback once
                                                     |
                                                     v
                                              normal completion
                                                     |
                                                     v
                                           validate once, then finish
```

Hard invariants:

1. `attemptCount <= 2` for optional workloads, where attempt two is only a safe same-route retry or JSON repair.
2. A normal-model fallback occurs at most once and only for `conversation_compact`.
3. Ambiguous failures produce no further model request.
4. Cancellation is checked before every retry, repair, fallback, and persistence step.
5. Persistence failure never invokes a model again.
6. The general chat recovery/fallback chain is not entered by this service.

## 12. Cooldown

The shared factory owns one process-local map keyed by workload:

```typescript
interface LightweightCooldownState {
  readonly consecutiveTransientFailures: number;
  readonly cooldownUntil?: number;
  readonly reason?: AIChatLightweightFailureReason;
}
```

Rules:

- `small_model_unavailable` opens a six-hour cooldown immediately.
- Three consecutive transient failures open a one-hour cooldown.
- Success clears failure count and cooldown for that workload.
- Authentication, quota, invalid request, cancellation, invalid output, and persistence failures do not increment the transient counter.
- Scheduled/background execution returns `cooldown_skip` without starting a consolidation run or calling the server.
- Manual auto-dream bypasses the scheduling cooldown but still has no normal-model fallback.
- Manual compact bypasses background cooldown because it has its own controlled critical path.

The singleton must be shared across user auto-dream, workspace auto-dream, and compact services. `resetAiChatV2RuntimeForDatabaseSwitch()` and provider-setting updates clear it so one account/provider cannot suppress another. A process restart also clears phase-1 cooldown state and therefore allows one immediate probe.

## 13. Prompt Budgeting

### 13.1 Formula

For every request:

```text
contextWindow       = discovered small context or conservative fallback
effectiveOutput     = min(profile max output, discovered model max output)
softContextLimit    = floor(contextWindow * 0.90)
fixedPromptTokens   = estimate(system prompt + response schema + scaffolding)
usablePayloadTokens = max(0, softContextLimit - effectiveOutput - fixedPromptTokens)
```

Use `AIChatTokenEstimator` consistently. Do not mix the estimator's built-in safety allowance with an additional undocumented allowance. Tests use the estimator rather than character-count assertions.

If fixed prompt plus output reserve does not fit, fail locally as `invalid_request`; do not send a predictably overflowing request.

### 13.2 Atomic message groups

Expose the existing tool-call grouping logic from `AIChatContextRecoveryService` as a shared pure helper or move it to `AIChatPromptBudget`. An assistant tool-call and all matching tool-result messages are one indivisible group. Chunking must not orphan a tool result.

Although current compact persistence often exposes only `MessageType.MESSAGE` rows, the budget layer must be correct for complete OpenAI message arrays and future storage changes.

### 13.3 Determinism

Given identical model metadata and input rows, chunk boundaries must be identical. Sort with stable tie-breakers and never depend on repository iteration order.

## 14. Auto-Dream Detailed Flow

### 14.1 Gap-free candidate selection

Each source has a cursor tuple:

```text
(updatedAt, sourceKind, sourceId)
```

The database-backed collector returns eligible sources in ascending tuple order. Because existing run records persist only a timestamp, phase 1 treats all rows at the boundary timestamp as eligible (`>=`) and relies on idempotent consolidation plus exact source references. This may re-review a boundary row, but it cannot skip data.

Required collector changes:

1. Filter using `reviewedSince` before applying limits.
2. Sort oldest-first before taking bounded candidates.
3. Merge chat and agent-task descriptors into one chronological list before hydration.
4. Hydrate packets only after selection to bound database and memory work.
5. Set `batchReviewedThrough` to the greatest `updatedAt` actually included.
6. Never use `new Date()` as a success cursor.

If exact-once boundary behavior later matters, add kind/id cursor columns in a separate migration. It is not required for correctness because duplicate review is safe while skipped review is not.

### 14.2 Batch construction

The service packs whole source packets until the next packet would exceed `usablePayloadTokens`. An oversized single packet is reduced deterministically:

1. Preserve title, source identity, update time, and the newest user/assistant exchange.
2. Remove oldest tool summaries first.
3. Remove oldest message groups next.
4. Clamp the remaining longest message only as the final step.
5. If the identity and minimum useful exchange still do not fit, fail locally and do not advance the cursor.

Active memories are included as a compact index of ID, type, title, and bounded content. Output validation accepts update/archive operations only for IDs present in that request.

### 14.3 Request and repair

The first request uses the relevant auto-dream profile. The strict existing parser validates the complete response before any mutation.

If and only if JSON syntax/schema validation fails, the service may make one repair request on the same route. The repair request includes:

- The expected schema.
- The invalid model output, bounded to the available payload budget.
- An instruction to return JSON only.

It does not resend all source conversations. Secret and semantic validation failure is not repairable and produces no second request.

### 14.4 Atomic apply and cursor commit

User and workspace consolidation modules add `applyPlanAndCompleteRun()` methods. Each method opens one TypeORM transaction and performs archive, update, and create operations through transaction-bound repositories, then updates the run to completed with counts, resolved model, and `reviewedThrough` in that same transaction. It returns counts only after commit.

The sequence is:

```text
validate full response
  -> check cancellation
  -> one transaction:
       apply memory plan
       mark run completed with source-derived reviewedThrough
  -> commit
```

If either memory-plan persistence or run completion fails, the entire transaction rolls back. The run is then marked failed in a separate best-effort update, the previous successful cursor remains authoritative, and no model request is repeated. If even the failure update cannot be written, stale-run recovery handles the remaining `running` record later.

The system must not mark a run complete with a cursor if no packet was processed. A no-source run returns `skipped_no_sources` without creating a run record, preserving current cooldown semantics.

### 14.5 Workspace behavior

Workspace grouping remains based on resolved durable `workspaceKey`. Each workspace gets its own chronological batch and cursor from its latest successful workspace run. Failure in one workspace does not prevent other workspace batches from running, but the shared workload cooldown may suppress later batches after a route-level failure.

## 15. Incremental Session-Memory Summary

### 15.1 Input

Load message rows strictly after the persisted session-memory boundary. Convert them to atomic chronological groups and calculate the request budget from the selected route.

### 15.2 Rolling chunks

For each chunk:

1. Include the current session summary, or an empty-summary marker.
2. Include the next set of complete message groups.
3. Request a replacement structured summary.
4. Require non-empty output.
5. Persist the replacement summary and the last included message boundary.
6. Continue with the persisted summary as input to the next chunk.

Partial progress is intentional. If chunk three fails after two successful chunks, the first two boundaries remain committed and the next background run resumes at chunk three. This avoids replaying successful billable work.

The per-conversation lock in `AIChatCompactAgentService` remains mandatory. The global workload service does not serialize different conversations.

Session-summary invalid output may receive one same-small retry only if the first request returned definitively and the retry prompt is a pure formatting repair. It never receives a normal-model fallback.

### 15.3 Failure record behavior

The current failure counter can record only after a session-memory row exists. Add a module operation that creates the initial state on first failure or persist a minimal row before the first request. The chosen implementation must preserve the per-conversation circuit breaker across first-run failures.

## 16. Full Conversation Compact

### 16.1 Eligibility

Full compact uses small routing only when:

- The active provider is hosted AiFetchly.
- The kill switch is enabled.
- Capability metadata says the small route is available.
- A valid small context window is known.

Otherwise it goes directly to the normal provider path. Local providers always follow their normal path.

### 16.2 Hierarchical compact

Sending all messages in one request is replaced by a map/reduce-style flow:

1. Load the active compact summary, if present.
2. Load raw rows after its boundary; otherwise load the full conversation.
3. Convert messages into chronological atomic groups.
4. Split groups into budgeted chunks.
5. Summarize each chunk to a bounded intermediate summary.
6. Merge intermediate summaries, recursively batching if necessary.
7. Validate one final non-empty structured compact.
8. Atomically activate the final compact at the last included message boundary.

Intermediate summaries are transient and are not persisted as active compacts. A failure leaves the previous active compact untouched. The final `saveFullCompact()` transaction continues to supersede the previous active compact and save the replacement atomically.

### 16.3 Controlled fallback

A normal-model fallback is permitted only after one of these definitive small-route outcomes:

- `small_model_unavailable`.
- `context_overflow` after one reduced-input attempt.
- Empty/invalid final compact after permitted small-route validation handling.
- A future typed `model_specific_overload` response.

The fallback restarts the logical compact from the original persisted state. It must not mix small-model intermediate summaries with a normal-model final merge, because doing so makes quality and attribution ambiguous.

The normal attempt uses the current conversation model or provider default, runs once, validates once, and calls no general fallback chain. If it fails, return the final typed error. Persist the response's actual model only after successful final activation.

### 16.4 Automatic versus manual compact

Manual and automatic compact share the same engine and fallback rules. Manual compact surfaces the final existing error state. Automatic compact stays non-blocking; after final failure, the existing context-recovery path may drain tool groups or report context overflow, but it must not trigger another model fallback.

## 17. Cancellation and Concurrency

### 17.1 Abort propagation

Add an optional `AbortSignal` to non-streaming completion options and forward it through:

```text
workload caller
  -> lightweight service
  -> AiChatApi
  -> HttpClient or OpenAICompatibleProviderClient
  -> fetch
```

Call `throwIfAborted()` before request creation, retry delay, repair, fallback, transaction apply, and final activation.

### 17.2 Single-flight rules

- Existing auto-dream running-run guards remain authoritative.
- Existing per-conversation compact locks remain authoritative.
- The shared lightweight router is concurrency-safe and keeps no mutable current-request fields.
- Cooldown updates are synchronous map replacements after an attempt completes.
- Model-catalog refresh uses its existing shared cache behavior.

### 17.3 Shutdown

Application shutdown aborts active background requests where the existing lifecycle has a signal. A process exit may leave a `running` consolidation record; existing stale-run recovery marks it failed on the next startup. No cursor advances until completion.

## 18. Observability

Emit one structured completion event without prompt or output content:

| Field                  | Values/example                                       |
| ---------------------- | ---------------------------------------------------- |
| `workload`             | One allowlisted workload ID                          |
| `provider_kind`        | `hosted`, `ollama`, `lm_studio`, `openai`, etc.      |
| `route`                | `hosted_small`, `provider_normal`, `normal_fallback` |
| `requested_alias`      | `small` or absent                                    |
| `resolved_model`       | Response model, on success                           |
| `context_window`       | Budget source value                                  |
| `input_token_estimate` | Local estimate, not prompt content                   |
| `output_tokens`        | Provider usage when present                          |
| `attempt_count`        | One or two                                           |
| `retry_reason`         | Typed reason or absent                               |
| `fallback_attempted`   | Boolean                                              |
| `fallback_reason`      | Typed reason or absent                               |
| `duration_ms`          | Whole logical completion duration                    |
| `outcome`              | `success`, `failed`, `cancelled`, `cooldown_skip`    |

Auto-dream run records and compact/session records keep the resolved model as durable attribution. Do not store alias capability payloads, error response bodies, prompts, message text, workspace paths, or memory content in new logs.

Recommended operational counters:

- Success and failure rate by workload/route/resolved model.
- Parse/validation failure rate.
- Cooldown starts and skips by reason.
- Same-route retry rate.
- Compact normal-fallback frequency and success rate.
- Input/output token distributions and latency percentiles.

## 19. Security and Privacy

1. The AI enablement gate remains at every renderer-facing AI IPC handler before parsing input or performing work, using `Token` and `USER_AI_ENABLED` as required by repository policy.
2. The lightweight route never accepts tools, so it cannot execute file, shell, browser, or plugin operations.
3. The route is text-only and rejects media-bearing input before the provider call.
4. Existing auto-dream secret filters run before persistence; output repair does not bypass them.
5. Error bodies are bounded and never logged.
6. Provider credentials remain inside existing token/provider services.
7. Workers perform no database access. Any future worker execution sends results to the main process, where modules and models persist them.
8. Original messages are never deleted or rewritten by this feature.

## 20. Compatibility

### 20.1 Older server

An older server may accept `model: "small"` but expose no capability metadata. Auto-dream and incremental summaries can use the conservative budget. Full compact stays on the normal model until metadata exists.

If the old server does not support the alias, its documented 404 maps to `small_model_unavailable`, background cooldown opens, and optional workloads do not fall back.

### 20.2 Local providers

Existing local-provider selection, model IDs, timeouts, and typed errors remain intact. Adding `AbortSignal` is backward compatible because it is optional. Local completion tests must explicitly assert that neither alias is sent.

### 20.3 Stored data

No entity change is required. Previously stored compacts and consolidation runs remain readable. New records continue storing actual response models.

## 21. Test Strategy

### 21.1 Pure unit tests

Add tests under `test/vitest/main/service/` for:

- Exhaustive workload profiles and exact numeric settings.
- Context/output budget calculations and invalid fixed-prompt budgets.
- Stable atomic grouping for assistant tool calls and matching results.
- Deterministic chunk boundaries.
- Failure classification for every matrix row.
- Cooldown threshold, duration, reset, manual bypass, and runtime reset.
- Cancellation before retry, repair, fallback, and persistence.

### 21.2 API and provider tests

Extend `test/vitest/utilitycode/aiChatApi.test.ts` and provider tests:

- Hosted lightweight request sends `model: "small"`.
- Hosted request omits tools and uses profile limits.
- Local/custom requests preserve a real/default model and never send aliases.
- Model normalization preserves valid `small_model` metadata.
- Malformed optional capability fields are ignored safely.
- Abort signals reach hosted and local `fetch` calls.
- Typed HTTP errors retain status, server code, bounded body, and retry delay.

### 21.3 Router policy tests

For every workload:

- Successful first attempt.
- Kill-switch direct normal path.
- Missing-small configuration.
- 429 safe retry.
- Generic 5xx retry without broad fallback.
- Ambiguous timeout/network failure with exactly one total request.
- Authentication/quota with no retry or fallback.
- Cancellation at each decision boundary.

Additional compact tests prove exactly one normal fallback for each allowed definitive reason and zero fallback for all other reasons.

### 21.4 Auto-dream tests

- Oldest-first selection across chat and agent sources.
- More candidates than one batch, with no skipped cursor interval.
- Failure leaves the previous successful cursor unchanged.
- Boundary timestamp may repeat but does not skip a packet.
- JSON repair uses the same route and occurs once.
- Semantic/secret validation does not repair.
- Consolidation-plan transaction rolls back all mutations on an injected failure.
- Cursor and counts are written only after successful plan commit.
- Workspace failure isolation and shared route cooldown.

### 21.5 Compact tests

- Incremental multi-chunk rolling summary and resumable partial progress.
- First-chunk failure persists circuit-breaker state.
- Full compact uses discovered context and keeps atomic message groups.
- Intermediate failure leaves the previous active compact untouched.
- Final activation is atomic.
- Capability absence goes directly to normal route.
- Definitive small failure restarts from original state on one normal fallback.
- Small intermediate summaries are not reused by fallback.

### 21.6 Integration tests

Use a fake hosted server to cover:

1. `/v1/models` capability discovery.
2. Alias request and actual resolved response model.
3. Machine-readable alias 404.
4. 429 with `Retry-After`.
5. Delayed response followed by client timeout, asserting no duplicate request.
6. Context overflow followed by smaller chunk.
7. Compact fallback with exact request counts.

### 21.7 Verification commands

At minimum:

```bash
yarn testmain
yarn vue-check
yarn build
```

Run the focused Vitest files during development. There is no renderer change, so no new component test is required, but the existing component suite remains part of normal CI.

## 22. Rollout Plan

### Phase 0: Server readiness

1. Add `small_model` capability metadata.
2. Add stable `small_model_unavailable` error code.
3. Configure at least one healthy small setting in each environment.
4. Verify returned completion `model` is the resolved real model.

### Phase 1: Infrastructure

1. Add typed HTTP error preservation.
2. Extend model capability types/catalog.
3. Add profiles, budget helpers, classifier, router, shared factory, cooldown, and kill switch.
4. Add provider and policy tests.

The kill switch remains off in production during this code-only validation if server readiness is incomplete.

### Phase 2: Optional workloads

1. Route user and workspace auto-dream.
2. Introduce oldest-first batching, transactional apply, successful cursor commit, and JSON repair.
3. Route incremental session-memory summaries with rolling chunks.
4. Observe quality, cost, latency, cooldowns, and parse failures.

### Phase 3: Full compact

1. Require discovered capabilities.
2. Enable hierarchical small-model compact.
3. Enable one controlled normal fallback.
4. Verify manual and context-pressure behavior with long conversations.

### Phase 4: Stabilization

1. Compare against pre-release cost and quality baselines.
2. Investigate any workload with more than 5% validation failure.
3. Investigate compact normal fallback above 5%.
4. Keep the kill switch for at least two stable releases.

## 23. Implementation and Commit Sequence

Each item is a complete logical unit and should be committed separately under the repository's mandatory auto-commit rule.

1. `feat: preserve typed hosted AI response errors`
   - HTTP error type, bounded response parsing, abort support, tests.
2. `feat: discover hosted small-model capabilities`
   - API types/normalization, catalog accessors, tests.
3. `feat: add lightweight AI workload routing policy`
   - Profiles, classifier, budget helpers, router, factory, cooldown, kill switch, tests.
4. `fix: make auto-dream cursors batch safe`
   - Oldest-first source selection, successful cursor writes, regression tests.
5. `feat: route auto-dream through the small model`
   - Budgeting, repair, atomic apply, observability, user/workspace tests.
6. `feat: chunk session summaries for small models`
   - Rolling chunks, first-failure state, cancellation, tests.
7. `feat: compact conversations with controlled small-model fallback`
   - Capability gate, hierarchical compact, one fallback, tests.
8. `docs: document small-model operations and rollout`
   - Server/operator configuration and release evidence after implementation.

Do not combine all phases into one commit. Do not commit incomplete code or disabled tests.

## 24. Acceptance Traceability

| PRD requirement                         | Design mechanism                        | Primary verification            |
| --------------------------------------- | --------------------------------------- | ------------------------------- |
| Hosted lightweight work uses `small`    | Central router hosted request builder   | API request test                |
| Local/custom never receive alias        | Provider-normal branch                  | Provider matrix test            |
| Normal chat unchanged                   | Separate lightweight API; allowlist     | Existing chat regression suite  |
| Optional work has no expensive fallback | Profile `fallback: "never"`             | Router request-count tests      |
| Compact has at most one fallback        | State machine and `normal_once` profile | Compact policy tests            |
| Ambiguous failure is not repeated       | Classifier + terminal policy            | Delayed-server integration test |
| Context is model-aware                  | Capability catalog + 90% budget         | Budget/chunk tests              |
| No packet is skipped                    | Oldest-first source cursor              | Multi-batch cursor test         |
| Invalid auto-dream JSON repairs once    | Domain repair path on same route        | Parser/attempt test             |
| Cancellation stops all later work       | Signal propagation and guards           | Decision-boundary tests         |
| Actual model is stored                  | Persist `response.model`                | Model/module tests              |
| Repeated failures cool down             | Shared process map                      | Fake-clock tests                |
| Rollback is possible                    | Release environment kill switch         | Kill-switch route test          |
| No migration                            | Reuse existing fields                   | Schema snapshot unchanged       |

## 25. Risks and Mitigations

### Small-model summaries lose important detail

Use stable structured prompts, low temperature, output validation, a fixed evaluation corpus, and phased rollout. Route quality-sensitive workloads only after explicit evaluation.

### Batching changes summary meaning

Use chronological rolling summaries, deterministic chunks, and a final hierarchical merge. Evaluate long conversations, tool-heavy conversations, and multilingual conversations.

### Duplicate cost after timeout

Treat post-dispatch transport failures as ambiguous and terminal. Do not use the existing broad streaming recovery policy for non-streaming background requests without idempotency keys.

### Cursor skips source material

Select oldest-first and advance only to the maximum timestamp in a successfully committed batch. Accept harmless boundary reprocessing rather than data loss.

### Background failure floods logs/server

Use one shared cooldown map, structured single-event logging, and reset only on success, manual bypass, provider switch, or process restart.

### Broad infrastructure error change breaks callers

Keep `HttpResponseError` an `Error` subclass, preserve current refresh behavior, add existing-client regression tests, and avoid exposing raw bodies in messages or logs.

## 26. Deferred Work

1. Durable cooldown storage across application restarts.
2. A composite `(timestamp, sourceKind, sourceId)` database cursor for exact-once boundary selection.
3. Provider-declared virtual lightweight aliases for non-hosted providers.
4. Server idempotency keys that permit safe retry after ambiguous failures.
5. A user-visible model-routing or cost diagnostics page.
6. Dynamic workload profiles controlled remotely.

Each item requires a separate product/security review and is not implied by this design.

## 27. Definition of Done

The feature is complete when:

1. All four workloads use the central typed router.
2. Hosted eligible requests use `small`; local/custom requests never do.
3. Capability-aware budgeting prevents knowingly oversized requests.
4. Auto-dream batches cannot skip eligible sources and commit their cursor only after successful memory persistence.
5. Optional workloads never automatically use a normal model.
6. Compact uses no more than one controlled normal-model fallback.
7. Ambiguous failures, cancellation, and persistence failures make no additional model request.
8. Resolved models and policy outcomes are observable without logging user content.
9. The kill switch restores previous routing at runtime.
10. Focused unit/integration tests, `yarn testmain`, `yarn vue-check`, and `yarn build` pass.
11. The server capability and stable error-code dependencies are deployed before full compact routing is enabled.
