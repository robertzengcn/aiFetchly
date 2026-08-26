# TODO: Complete Small-Model Background Workloads

**Created:** 2026-08-24  
**Status:** Open  
**Source audit:** Repository review against the PRD and technical design on 2026-08-24  
**PRD:** [Small-Model Routing for Auto-Dream and Conversation Summaries](small-model-background-workloads-prd.md)  
**Technical design:** [Small-Model Routing for Background AI Workloads](small-model-background-workloads-technical-design.md)  
**Existing implementation plan:** [Small-Model Background Workloads Implementation Plan](small-model-background-workloads-implementation-plan.md)  
**Operations guide:** [Small-Model Routing Operations](../small-model-routing-operations.md)

## Purpose

This checklist tracks the work still required to satisfy the PRD acceptance criteria and both documents' Definition of Done. A task is complete only when its implementation, focused tests, and listed verification checks pass.

Do not enable hosted small-model routing in production until the Phase 0 server contract and the release gates in this document are complete.

## Priority summary

| Priority | Scope | Exit condition |
| --- | --- | --- |
| P0 | Context safety, fallback correctness, and server capability contract | No request knowingly exceeds its route budget; compact cannot perform multiple normal fallbacks or mix routes |
| P1 | Auto-dream batching, session chunking, cancellation, and observability | All four workloads follow the documented state machine and preserve correct boundaries |
| P2 | Integration, quality, rollout evidence, and document reconciliation | All required gates pass and production readiness is measurable |

## P0: Full compact correctness

### SMBW-001: Gate full compact on discovered small-model capability

- [ ] Make full compact use the small route only when the active provider is hosted, routing is enabled, `small_model.available` is true, and `context_size` is a valid positive integer.
- [ ] When capability metadata is missing, malformed, or unavailable, route directly to the normal provider without first sending `model: "small"`.
- [ ] Record a route reason such as `capability_missing` without counting it as a fallback attempt.
- [ ] Test hosted capability present, capability absent, `available: false`, malformed context, kill switch disabled, and local/custom providers.

Acceptance:

- A missing capability produces zero small-model requests.
- A valid capability uses its reported context and maximum-output limits.
- Local/custom providers never receive `small` or `haiku`.

Primary code: `src/service/AIChatCompactAgentService.ts`, `src/service/AIChatLightweightCompletionService.ts`, `src/service/AIChatModelCatalogService.ts`.

### SMBW-002: Reuse the active compact boundary

- [ ] Load the active compact summary before selecting source rows.
- [ ] If an active compact exists, use it as the representation of covered history and load only messages strictly after `throughMessageId`/`throughTimestamp`.
- [ ] If no active compact exists, process the full conversation.
- [ ] Preserve deterministic timestamp ordering with row ID as the tie-breaker.
- [ ] Save `fromMessageId`, `throughMessageId`, source counts, and token estimates for the actual input represented by the replacement compact.

Acceptance:

- Previously covered raw rows are not resent.
- The new boundary never advances past a row excluded from the successful final compact.
- Missing or stale boundaries fail safely instead of silently dropping messages.

### SMBW-003: Make hierarchical merge recursively budgeted

- [ ] Budget map inputs using the selected route's usable payload budget.
- [ ] Budget intermediate-summary merges instead of combining every summary in one request.
- [ ] Recursively merge bounded groups until exactly one validated final summary remains.
- [ ] Reject or deterministically reduce an atomic group that cannot fit by itself; never submit a knowingly oversized request.
- [ ] Preserve tool-call and matching tool-result groups as indivisible units.

Acceptance:

- Every map and reduce request reserves fixed prompt tokens, maximum output tokens, and the 10% safety margin.
- Identical messages and model metadata produce identical chunk boundaries.
- A transcript requiring more than one merge level completes without exceeding the calculated budget.

### SMBW-004: Enforce one fallback per logical compact

- [ ] Move fallback ownership to the full compact orchestration boundary or introduce a logical execution context shared by all map/reduce calls.
- [ ] Permit at most one normal-model fallback for the entire compact, not one fallback per chunk.
- [ ] On an allowed definitive small-route failure, discard all transient small-model intermediates and restart from the original persisted state on the normal route.
- [ ] Do not mix small-model intermediate summaries with a normal-model final summary.
- [ ] After context overflow, reduce the input once before using the allowed normal fallback.
- [ ] Do not fall back for authentication, quota, invalid request, cancellation, generic server error, timeout, or ambiguous network failure.

Acceptance:

- Exact request-count tests prove no compact execution makes more than one normal-model request.
- Fallback input is rebuilt from the original active compact and raw-message boundary.
- Ambiguous failures produce no further completion request.

## P0: Server contract

### SMBW-005: Add small-model capability metadata to the server

In the sibling `aifetchserver` repository:

- [ ] Extend `GET /v1/models` with `small_model.available`, `resolved_model`, `context_size`, and `max_tokens`.
- [ ] Derive the capability from the best healthy `is_small_model` setting in the current environment.
- [ ] Validate that token limits are positive integers.
- [ ] Do not expose credentials, base URLs containing secrets, or provider configuration details.
- [ ] Add server unit and API tests for available, unavailable, malformed configuration, environment isolation, and model selection changes.

Acceptance:

- The desktop model catalog can consume the real server response without fixtures or client-only metadata injection.
- Provider changes invalidate or refresh the cached capability.

### SMBW-006: Return a stable unavailable error code

In the sibling `aifetchserver` repository:

- [ ] Return HTTP 404 with `error.code = "small_model_unavailable"` when no eligible small model is configured.
- [ ] Preserve a safe human-readable message.
- [ ] Add tests for both `small` and `haiku`, including case-insensitive aliases.
- [ ] Keep the desktop's documented legacy-404 compatibility until all supported servers expose the code.

Acceptance:

- Failure classification does not depend on message substring matching.

## P1: Auto-dream budgeting and cursors

### SMBW-007: Build total-budgeted auto-dream batches

Apply to both user and workspace auto-dream:

- [ ] Resolve the small-model capability or conservative 32,000-token context.
- [ ] Calculate fixed-prompt, output, and safety reserves before selecting payload content.
- [ ] Add active-memory identity/content and source packets only while they fit.
- [ ] Preserve enough active-memory identity and content to validate update/archive IDs and detect duplicates or contradictions.
- [ ] Include tool-call summaries in the same total budget.
- [ ] Process overflow packets in later batches instead of dropping them.
- [ ] Deterministically reduce an oversized packet in this order: oldest tool summaries, oldest message groups, final longest-message clamp.
- [ ] Fail locally without moving the cursor if the minimum useful packet still cannot fit.

Acceptance:

- Every auto-dream request fits the computed usable budget.
- Multiple bounded runs eventually process all eligible packets.
- A failed or unparseable batch never advances the successful watermark.

### SMBW-008: Select sources through one chronological descriptor queue

- [ ] Filter chat and agent-task descriptors by `reviewedSince` before applying a shared batch limit.
- [ ] Merge descriptors before hydration.
- [ ] Sort by `(updatedAt, sourceKind, sourceId)` ascending.
- [ ] Hydrate only descriptors selected for the current batch.
- [ ] Treat all sources at the timestamp boundary as eligible so timestamp-only cursors cannot skip ties.
- [ ] Stop writing the candidate `reviewedThrough` value when the run starts; commit it only with the successful transaction.

Acceptance:

- Tests with interleaved chat/task timestamps and equal timestamps prove that no eligible source is skipped.
- Failed runs leave the previous successful cursor authoritative.

### SMBW-009: Bound JSON repair as part of one logical run

- [ ] Ensure the first completion plus JSON repair cannot exceed the optional-workload limit of two model requests.
- [ ] Prevent the router from independently retrying the first request and then allowing a third repair request.
- [ ] Use the same selected route for repair.
- [ ] Include only the bounded invalid output, schema, and formatting instruction.
- [ ] Track `repairAttempted` in the logical completion event.
- [ ] Do not repair empty output, secret-filter rejection, or semantic rejection.

Acceptance:

- Request-count tests cover first-attempt repair, retry exhaustion, cancellation before repair, and invalid repaired output.

## P1: Incremental session memory

### SMBW-010: Implement rolling chronological chunks

- [ ] Calculate a `session_memory_summary` budget from capability metadata or the conservative context.
- [ ] Convert delta rows into chronological atomic groups.
- [ ] For each chunk, include the current persisted summary or an explicit empty-summary marker.
- [ ] Persist the replacement summary and last included boundary only after that chunk validates.
- [ ] Use the newly persisted summary as the input to the next chunk.
- [ ] Resume at the first unprocessed group after a later chunk fails.
- [ ] Allow at most one same-small formatting repair when output is definitively received but invalid.

Acceptance:

- Oversized deltas cause multiple bounded requests.
- Successful early chunks remain committed after a later failure.
- The next run resumes without replaying successful billable work.

## P1: Cancellation and lifecycle

### SMBW-011: Propagate cancellation through every workload

- [ ] Add optional `AbortSignal` support to user/workspace auto-dream entry points, session-memory updates, and manual/automatic full compact.
- [ ] Forward the signal through every lightweight request.
- [ ] Check cancellation before retry delay, JSON repair, chunk iteration, fallback restart, transactional apply, and final compact activation.
- [ ] Do not record a generic failure or perform persistence after cancellation unless existing cancellation-state behavior explicitly requires it.
- [ ] Connect application shutdown and stream cancellation signals where lifecycle signals already exist.

Acceptance:

- Decision-boundary tests prove cancellation causes no later model or database call.

## P1: Router accounting and observability

### SMBW-012: Correct logical attempt accounting

- [ ] Count the initial small request on every failure path.
- [ ] Count a same-route retry as attempt two.
- [ ] Count a normal fallback in the total network-attempt count.
- [ ] Preserve counts when the retry or fallback fails.
- [ ] Track domain repair within the same logical execution metrics.

Acceptance:

- Logs never report zero attempts after a network request.
- A small request plus normal fallback reports two attempts.

### SMBW-013: Complete structured event fields

- [ ] Include workload, provider kind, route, requested alias, resolved model, context window, input-token estimate, provider input/output usage, attempt count, repair flag, retry reason, fallback flag/reason, duration, and outcome.
- [ ] Preserve `requestedAlias: "small"` when a normal fallback follows a small attempt.
- [ ] Distinguish `cancelled`, `failed`, and `cooldown_skip` accurately.
- [ ] Log cooldown starts and skips with typed reasons.
- [ ] Ensure logs contain no prompt, transcript, memory, workspace path, credential, token, cookie, or bounded HTTP response body.

Acceptance:

- Snapshot or object-shape tests cover success, retry, fallback, failure, cancellation, and cooldown skip.

### SMBW-014: Require a real resolved model before persistence

- [ ] Treat `response.model` as authoritative.
- [ ] Decide and document safe behavior when it is missing or still equals `small`/`haiku`.
- [ ] Do not silently persist the virtual alias as a resolved real model.
- [ ] Test user consolidation, workspace consolidation, session memory, single-chunk compact, multi-chunk compact, and normal fallback attribution.

## P2: Configuration and documentation consistency

### SMBW-015: Resolve the kill-switch default conflict

- [ ] Choose one contract: default enabled as stated in technical design section 8.3, or default disabled as stated in the implementation plan and operations guide.
- [ ] Update the PRD, technical design, implementation plan, operations guide, code comments, and tests to agree.
- [ ] Document the production enablement procedure and restart requirement.

Recommended resolution: retain default disabled until server Phase 0 and quality gates pass, then explicitly decide whether the permanent default changes.

### SMBW-016: Correct implementation-status documentation

- [ ] Remove or qualify claims that all phases are implemented in `docs/small-model-routing-operations.md`.
- [ ] Mark the original implementation-plan units that need remediation or link them to this TODO.
- [ ] Update document status only after the corresponding acceptance checks pass.

## P2: Required automated verification

### SMBW-017: Fill unit and policy-test gaps

- [ ] Auto-dream total-budget packing and overflow continuation.
- [ ] Interleaved chat/task ordering and equal-timestamp ties.
- [ ] Transient cooldown threshold, one-hour duration, success reset, manual bypass, and runtime reset.
- [ ] Cancellation before/during repair, fallback, persistence, and compact chunks.
- [ ] Session-memory multi-chunk progress and resume.
- [ ] Active compact reuse and post-boundary row selection.
- [ ] Recursive merge budgeting.
- [ ] One fallback for the complete multi-chunk compact.
- [ ] Fallback restart without small intermediate reuse.
- [ ] Missing capability making zero small requests.
- [ ] Context overflow reduction before fallback.
- [ ] Accurate observability fields and request counts.

### SMBW-018: Add fake-server integration tests

- [ ] Capability discovery through `GET /v1/models`.
- [ ] Alias success returning and persisting a real model.
- [ ] Machine-readable alias 404 and background cooldown.
- [ ] Manual compact alias 404 causing exactly one normal request.
- [ ] 429 with bounded `Retry-After`.
- [ ] Delayed response/client timeout causing no duplicate request.
- [ ] Context overflow followed by a smaller input.
- [ ] Large transcript causing bounded map and recursive reduce calls with one final record.
- [ ] Local provider receiving its configured real model.

### SMBW-019: Restore the repository-wide verification gate

- [ ] Fix or disposition `RendererServiceImportGuard.test.ts` failing the `AiChatV2`/`AIChatErrorMapper` sentinel contract.
- [ ] Fix or stabilize the `HookDispatcher.skillRef.test.ts` timeout.
- [ ] Run the complete verification set after remediation.

Required commands:

```bash
yarn testmain run
yarn typecheck
yarn vue-typecheck
yarn build
```

Latest audit result on 2026-08-24:

- Feature-focused suite: 158 tests passed.
- TypeScript: passed.
- Vue type checking: passed.
- Production renderer build: passed.
- Full main-process suite: 4,261 passed, 3 skipped, 2 failed.

## P2: Quality and production rollout

### SMBW-020: Create and run the quality evaluation corpus

- [ ] Include short and long conversations, contradictory preferences, workspace decisions, tool successes/failures, pending tasks, state handoffs, multilingual content, secret-like content, and context-limit edge cases.
- [ ] Compare the configured small and normal models for required-fact retention, unsupported facts, decision/task retention, valid JSON rate, heading coverage, secret-filter rejection, output tokens, latency, and cost.
- [ ] Define and approve numeric quality thresholds before enabling production routing.
- [ ] Store reproducible evaluation inputs and aggregate results without committing real user content or credentials.

### SMBW-021: Verify deployed server readiness

- [ ] Confirm every target environment has at least one healthy `is_small_model = true` setting.
- [ ] Verify environment isolation and priority/health selection.
- [ ] Verify real resolved model attribution and usage accounting.
- [ ] Verify text-only behavior and image-route exclusion.
- [ ] Keep `AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED` disabled until these checks pass.

### SMBW-022: Collect rollout metrics and close the Definition of Done

- [ ] Establish a pre-enable baseline.
- [ ] Verify at least 90% of successful hosted optional workloads resolve to the configured small model.
- [ ] Verify normal interactive model distribution remains unchanged.
- [ ] Demonstrate lower hosted cost per successful background workload.
- [ ] Keep auto-dream parse regression within 2 percentage points.
- [ ] Verify compact success is at least 99% when the normal provider is available.
- [ ] Investigate fallback or validation-failure rates above 5%.
- [ ] Verify no local/custom request contains the hosted alias.
- [ ] Verify no successful boundary advances past unprocessed content.
- [ ] Verify background failures never fail a visible chat turn.
- [ ] Keep the rollback control through at least two stable releases.

## Final completion checklist

- [ ] SMBW-001 through SMBW-022 are complete or explicitly deferred by an approved follow-up PRD.
- [ ] PRD acceptance criteria are checked with linked test or rollout evidence.
- [ ] Desktop and server integration tests pass.
- [ ] Quality thresholds pass.
- [ ] Repository-wide tests, type checks, and production build pass.
- [ ] Operations documentation matches deployed behavior.
- [ ] Production metrics satisfy the PRD success criteria.

