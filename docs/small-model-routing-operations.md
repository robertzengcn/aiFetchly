# Small-Model Routing — Operations & Rollout

**Status:** Implemented (commits `da9740ea` … `fd0cc08c`). Kill switch **default OFF**.
**PRD:** `docs/prd/small-model-background-workloads-prd.md`
**Technical design:** `docs/prd/small-model-background-workloads-technical-design.md`
**Implementation plan:** `docs/prd/small-model-background-workloads-implementation-plan.md`

## 1. What this feature does

AiFetchly routes four bounded, text-only background AI workloads through the hosted AI server's virtual `small` model alias when the user is on the hosted AiFetchly provider and the kill switch is enabled:

| Workload ID              | Entry point                    | Criticality          | Profile (temp / max out) | Fallback |
| ------------------------ | ------------------------------ | -------------------- | -----------------------: | -------- |
| `user_auto_dream`        | `AIAutoDreamService`           | Optional background  | 0.1 / 4000               | never    |
| `workspace_auto_dream`   | `AIWorkspaceAutoDreamService`  | Optional background  | 0.1 / 4000               | never    |
| `session_memory_summary` | `AIChatCompactAgentService`     | Optional background  | 0.2 / 2000               | never    |
| `conversation_compact`   | `AIChatCompactAgentService`     | Conversation protect | 0.2 / 4000               | normal_once |

Normal interactive chat, tool use, plan execution, agents, and image inputs are **not** routed through the small model. The `small` alias never appears in the user-facing model selector.

## 2. Kill switch (release control)

- **Environment variable:** `AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED`
- **Accepted values (case-insensitive):** `true` / `1` to enable; `false` / `0` to disable.
- **Default when absent:** **DISABLED.** An invalid value is logged once and resolves to disabled (an operator typo cannot unexpectedly enable new routing).
- **Read time:** the value is read when the shared lightweight service is constructed. Changing it requires an app restart.
- **When disabled:** every lightweight workload uses the provider-normal path; all small-specific retry, cooldown, and fallback behavior is bypassed. Auto-dream's own enablement settings are unchanged.
- **Why default OFF:** the design's Phase 1 says the kill switch "remains off in production during code-only validation if server readiness is incomplete." Routing is fully built and tested but inert until an operator verifies the server has an `is_small_model` setting and flips the flag. This is a deliberate, safer deviation from tech-design §8.3 ("default enabled").

To enable after server verification:

```bash
export AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED=true
```

## 3. Server-side prerequisites (Phase 0)

1. Configure at least one healthy hosted chat API setting with `is_small_model = true` in each deployed environment.
2. Add small-model capability metadata to the `GET /v1/models` response:
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
3. Return a stable machine-readable error code `small_model_unavailable` (HTTP 404) when no small model is configured.
4. Verify the completion `model` field returned for `model: "small"` is the **resolved real model**, not the alias.

The client (`AIChatModelCatalogService.getSmallModelCapability()`) caches this metadata and invalidates it on provider/DB switch. For auto-dream and session summaries, absent metadata uses a conservative 32 000-token context assumption. For full compact, absent/invalid metadata means the small route is **not eligible** — compact goes directly to the normal model (this is NOT counted as the one failure fallback).

## 4. Failure, retry, fallback, cooldown contract

| Failure                                       | Optional background workloads                | conversation_compact                |
| --------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| Small model not configured (404 / `small_model_unavailable`) | Record failure; 6-hour cooldown; no fallback | Retry once with normal model        |
| 429 with `Retry-After`                        | One delayed retry (bounded)                  | Existing foreground recovery        |
| 5xx overload                                  | One retry with jitter; no fallback           | Retry, then one normal fallback only for model-specific overload |
| Ambiguous timeout / network loss after submit | No resubmit; no fallback                     | No resubmit; no fallback            |
| Invalid auto-dream JSON                       | One same-small repair attempt; no fallback   | N/A                                 |
| Invalid/empty compact output                 | Record failure; no fallback                  | One normal-model fallback           |
| DB save failure after valid output            | No further model call                        | No further model call               |
| Cancellation                                 | Stop immediately; no retry/fallback         | Stop immediately; no retry/fallback |

Hard invariants:

- `attemptCount <= 2` for optional workloads (attempt two is a safe same-route retry or JSON repair).
- A normal-model fallback occurs **at most once** and only for `conversation_compact`.
- Ambiguous failures make no further model request.
- Persistence failure never invokes a model again.
- The general chat recovery/fallback chain is never entered by this service.

## 5. Observability

Every lightweight execution emits one structured log line (no prompt/output content):

| Field                | Example / values                                  |
| -------------------- | ------------------------------------------------- |
| `workload`           | `user_auto_dream`, `session_memory_summary`, …    |
| `providerKind`       | `hosted`, `ollama`, `lm_studio`, …                |
| `route`              | `hosted_small`, `provider_normal`, `normal_fallback` |
| `resolvedModel`      | Response model (on success)                       |
| `attemptCount`       | 1 or 2                                            |
| `retryReason`        | Typed reason or absent                            |
| `fallbackAttempted`  | boolean                                           |
| `fallbackReason`     | Typed reason or absent                             |
| `durationMs`         | End-to-end execution time                         |
| `outcome`            | `success`, `failed`, `cancelled`, `cooldown_skip` |

Auto-dream run records and compact/session-memory records continue to store the resolved real model as durable attribution. Logs never contain raw prompts, transcripts, memory contents, or credentials.

## 6. Success metrics (measure baseline before rollout, compare after)

1. ≥ 90% of successful hosted auto-dream and session-summary calls resolve to the configured small model.
2. Normal interactive chat model distribution unchanged.
3. Hosted cost per successful auto-dream/summary decreases vs baseline.
4. Auto-dream parse-failure rate does not regress by more than 2 percentage points.
5. Conversation compact success rate ≥ 99% when the normal provider is available.
6. Small-model-unavailable failures do not create more than one background attempt per cooldown window.
7. No local/custom provider request contains the hosted virtual alias.
8. No successful run advances a source or compact boundary past unprocessed content.
9. No background lightweight failure causes a visible chat turn to fail.

## 7. Rollout phases

- **Phase 1 (this implementation):** infrastructure + optional bounded workloads. Kill switch OFF by default.
- **Phase 2:** enable the kill switch after the server deploys `small_model` capability metadata and a healthy `is_small_model` setting. Observe quality, cost, latency, cooldowns, and parse failures.
- **Phase 3:** full compact on the small model (requires discovered capabilities — already gated by `requiresDiscoveredSmallContext`).
- **Phase 4 (stabilization):** compare against baseline. Investigate any workload with > 5% normal-model fallback or > 5% validation failure. Keep the kill switch for at least two stable releases.

## 8. Rollback

Disable `AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED` (or leave it absent). All workloads revert to their previous model behavior. Existing memory and compact records remain valid. No migration or data repair is needed. The renderer requires no change.

## 9. Deferred work (not in this release)

- Durable cross-restart cooldown storage.
- Composite `(timestamp, sourceKind, sourceId)` DB cursor for exact-once boundary selection.
- Provider-declared virtual lightweight aliases for non-hosted providers.
- Server idempotency keys permitting safe retry after ambiguous failures.
- A user-visible model-routing/cost diagnostics page.
- Dynamic remote-controlled workload profiles.
- Quality-evaluation corpus run (requires the live server).
