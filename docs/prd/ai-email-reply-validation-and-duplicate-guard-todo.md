# AI email reply validation and duplicate guard — audit TODO

## Review scope and conclusion

- Reviewed on **2026-10-05**.
- Worktree: `email-reply-validation-phase1`; branch: `worktree-email-reply-validation-phase1`.
- Implementation reviewed: **`b9c1d83ba86e76c5ff0ba5a83f32b1ad0caaf45c`**; change baseline: `3c678ab9360e1775259fb65e4305575f27cea840`.
- Requirements: the revised PRD and technical design on the main checkout, revision **`fd23dd5582fed48d9635f6e109c0139efa7051cd`**. This is the documentation revision requested earlier in this review session.
- The worktree still contains the older documents, covering FR-025–FR-034. The revised documents add FR-035–FR-039 and change existing-draft behavior from refusal to reuse. Synchronize that contract before continuing implementation. This report does not copy or change the worktree's PRD.

**The complete feature is not implemented.** Phase 1 improves prompt/schema alignment, preserves correction context, forwards JSON formatting hints, increases the output budget, checks some completion reasons, adds draft-state eligibility checks, and returns some stable refusal codes. These are useful changes, but they do not provide the mailbox evidence, persistent generation reservation, or atomic message-level send protection required by the revised PRD.

The matrix below classifies eight requirements as partial and seven as not implemented. No requirement is marked fully verified against its entire revised acceptance contract. “Partial” includes working behavior with missing acceptance cases; it does not mean every part is broken. Missing FR-035–FR-039 behavior is a full-feature gap, not evidence that the phase-1 branch promised those additions.

This is a source review plus targeted automated testing, not a live-provider or exhaustive production certification. Findings identify reproducible control-flow conditions; they do not claim an observed production incident. Some retained defects predate this branch and are labeled accordingly.

## Verification completed

At the reviewed implementation revision:

- Main-process suite: **8 files, 87 tests passed**, including response-format forwarding, AI tools, generation, prompt construction, pre-draft policy, fake SMTP, send claims, and recovery.
- Utility suite: **2 files, 32 tests passed**, covering generation schema and policy orchestration.
- The main runner's TypeScript gate passed; the utility run also completed successfully with its configured type-check integration.
- Logs: `/tmp/email-reply-phase1-main-review.log` and `/tmp/email-reply-phase1-utility-review.log` (temporary local evidence, not durable repository artifacts).

The existing passing tests do not cover the failure scenarios below. Live hosted/local provider compatibility, real IMAP detection, populated database upgrades, the full component suite, and Electron E2E were not verified. No application source was changed during this audit.

## Requirement coverage

| Requirement | Status | Remaining work / related TODO |
|---|---|---|
| FR-025 — generation contract | Partial | Field alignment and correction context improved; authoritative classification can still be overwritten (B07). Make the prompt/schema contract consistently shared. |
| FR-026 — compatible JSON hints | Partial | Request forwarding exists; unsupported-parameter fallback and bounded transport budget do not (B06, T09). |
| FR-027 — output budget and completion checks | Partial | Larger budget and selected finish reasons checked; refusal/tool-call payloads and persisted completion metadata missing (B05, T09). |
| FR-028 — existing-draft reuse | Partial | Reuse exists; classification runs first, failed drafts are mishandled, warnings disappear, and race reuse is unsafe (B01, B03, B08, B09). |
| FR-029 — local duplicate eligibility | Partial | Draft/message projections checked at draft/send entry; authoritative attempts and a complete post-generation recheck missing (B02, B03). |
| FR-030 — persisted mailbox evidence | Not implemented | No required flag provenance, identity-safe refresh, or sticky evidence model (T02–T03). |
| FR-031 — automatic fresh detection | Not implemented | No automatic fresh IMAP/Sent evidence enforcement before generation/send (T04–T05). |
| FR-032 — diagnostic reply-check tool | Not implemented | No shared detector/tool and complete exposure path (T06). |
| FR-033 — structured results | Partial | Some service/tool codes exist; IPC discards typed outcomes and wrappers parse error text (B12, T06, T10). |
| FR-034 — audit and user feedback | Partial | Narrow skip auditing added; reuse/audit failure behavior and request correlation incomplete; translated end-to-end feedback missing (B09–B11, T10). |
| FR-035 — persistent generation reservation | Not implemented | No owner-fenced reservation or atomic draft/revision/message/audit commit (T07). |
| FR-036 — message-level send claim and recovery | Not implemented | Existing draft-level claim is insufficient across siblings; replay, failure retry, and authoritative evidence need fixes (B02, B04, B08, T08). |
| FR-037 — detection cache | Not implemented | No context-bound cache, sticky positives, or forced-send freshness contract (T05). |
| FR-038 — legacy conflicts and upgrade | Partial | Some multiple-draft conflict checks exist; canonical duplicates, populated upgrades, and recovery guarantees unverified (B03, T02, T11). |
| FR-039 — budgets, metrics, rollout | Not implemented | No complete deadline/probe budget, required measurements, or provider pilot/rollback acceptance (B13, T09, T12). |

## Confirmed defects and unsafe paths

Priorities: **P1** should be fixed before enabling this guarded workflow; **P2** affects correctness, diagnosability, or compatibility and should be addressed before declaring the corresponding requirement complete. File references and line numbers below refer to the reviewed implementation revision and may move after edits.

### B01 — Classification calls the model before local denial or reuse [P2]

- [ ] **Fix.** Run authoritative local duplicate eligibility and eligible-draft reuse before classification. Use the injected AI transport for classification too.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:148–165,194–205,229`; `buildLlmClassifier` at `872–887` constructs a real `AiChatApi` rather than using the generation transport factory.
- Trigger: an already-sent message or a message with an eligible draft has an absent/unknown classification.
- Current result: classification can make an AI request before the subsequent guard refuses or returns the existing draft. That violates the zero-classification/zero-generation requirement and can turn a cheap local outcome into a provider failure or delay.
- Acceptance: seed unknown classification plus sent evidence or a reusable draft; assert no classifier or generator call and the correct denial/reuse result. Current zero-call coverage seeds an already-known classification and misses this path.

### B02 — Guard ignores authoritative send-attempt evidence [P1]

- [ ] **Fix.** Inspect attempts for every row representing the canonical inbound identity, including orphan/stale attempts, before allowing generation or send. Apply sent, unknown-delivery, and in-flight precedence.
- Evidence: `src/service/emailReply/EmailReplyPolicyOrchestrator.ts:105–134` bases eligibility on message/draft projections without reading delivery attempts.
- Trigger: an attempt is sent, unresolved, claimed, or submitted, but the linked draft is missing/stale and message `replyStatus` still looks unanswered.
- Current result: the policy can allow another draft or send despite stronger delivery evidence. Existing atomic finalization helps ordinary success, but does not make missing/stale projections safe.
- Acceptance: independently seed each authoritative attempt state with stale message/draft state; both draft and send stages must deny before AI/SMTP work. Include missing draft and equivalent duplicate inbound rows.

### B03 — Post-generation recheck bypasses denial precedence [P1]

- [ ] **Fix.** Re-run the full authoritative eligibility policy using freshly read state before reusing or persisting a draft. Do not substitute a live-draft filter for the guard. Also implement T07 to close the remaining check/write race.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:437–487`; `recheckLive` at `452–454` excludes `sent` and `delivery_unknown`. `pickReusableDraft` at `src/service/emailReply/EmailReplyPolicyOrchestrator.ts:434–449` requires the full guard to have cleared unsafe/conflicting states first.
- Trigger: while generation awaits the model, a sibling becomes sent or delivery-unknown and the message projection remains stale.
- Current result: if that is the only sibling, generation persists another draft. With an editable sibling plus sent/unknown/sending evidence, it can return that editable draft as `allowed`. Multiple editable siblings also return the newest instead of a conflict.
- Acceptance: introduce each sibling state during the awaited model call. Assert the appropriate sent/unknown/in-flight/conflict denial and no newly persisted draft. Test mixed-state siblings as well as one sibling. This omission exists even before considering a change occurring after the final recheck.

### B04 — Same-attempt send replay returns the wrong outcome [P2]

- [ ] **Fix.** After validating authorization and bindings, recognize an exact replay of the same approved attempt before generic sibling/in-flight denial. Preserve refusal for other attempts and drafts.
- Evidence: `src/service/emailReply/EmailReplyDeliveryService.ts:245–271` runs policy before the idempotency lookup at `273–285`.
- Trigger: the first invocation claims the attempt and waits in SMTP; a second invocation reuses the same valid approval/binding after the first claim is visible.
- Current result: the second invocation gets `reply_in_progress`, rather than the original attempt's idempotent `already_processed` outcome. This finding does not imply a duplicate SMTP submission.
- Acceptance: hold fake SMTP after claim, replay the same approval, and assert the original attempt is returned with one SMTP submission. A simultaneous `Promise.all` test without controlled claim timing is insufficient. Add a separate other-approval/sibling denial case.

### B05 — Actual refusal and tool-call payloads are discarded [P1]

- [ ] **Fix.** Carry provider refusal/tool-call fields into the raw completion contract and reject them before parsing content, independently of `finish_reason`.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:627–633` retains content, reason, model, and usage but drops message refusal/tool calls; checks at `801–812` inspect selected finish-reason strings only.
- Trigger: a response contains valid reply JSON together with a refusal or actual tool calls, but reports `stop` or no finish reason.
- Current result: the content can be accepted as a draft. Checking a `tool_calls` finish reason alone does not inspect the actual payload required by FR-027.
- Acceptance: valid JSON plus nonempty refusal; valid JSON plus actual tool calls with `stop`; and missing finish reason plus prohibited payload must all fail without a draft. Verify ordinary content-only replies remain accepted.

### B06 — JSON hint incompatibility becomes an unconditional failure [P2]

- [ ] **Fix.** Support the explicit provider-capability/unsupported-parameter fallback described in FR-026, once without the hint, while preserving local validation and the aggregate request ceiling.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:617–625` always requests `response_format: { type: 'json_object' }` and wraps exceptions as transport failures. Existing API retries do not implement this feature's capability fallback.
- Trigger: an otherwise compatible hosted/local provider explicitly rejects `response_format`.
- Current result: generation fails even if that provider could return locally valid JSON without the hint.
- Acceptance: explicit unsupported-parameter response triggers one no-hint retry; authentication, throttling, generic network, and server errors do not. Count actual transport submissions across wrapper retries and correction, with a maximum of four.

### B07 — Generated intent replaces authoritative classification [P1, retained defect]

- [ ] **Fix.** Persist the model's `intentSuggestion` as suggestion metadata while preserving the existing authoritative classification, confidence, and provenance.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:423–426,557–560`; the comment says the suggestion is metadata only, but the assignment is later persisted as classification.
- Trigger: deterministic/stored classification disagrees with generated `intentSuggestion`, for example a support request versus `interested`.
- Current result: generation can change later policy behavior by overwriting authoritative classification. This behavior predates the phase-1 changes and remains relevant to the revised contract.
- Acceptance: generate a disagreeing suggestion and assert the authoritative fields remain unchanged while the suggestion remains visible as metadata.

### B08 — Definitely failed drafts cannot be reused safely [P2]

- [ ] **Fix.** Distinguish definite delivery rejection from ambiguous delivery. Reuse an eligible definitely-failed draft by its existing ID; unknown delivery must remain blocked.
- Evidence: `src/service/emailReply/EmailReplyPolicyOrchestrator.ts:154–158,425–449`; failed drafts are excluded from live-state and reusable-state checks.
- Trigger/result: `message.replyStatus = failed` with a definitely-failed draft produces generic unknown-state refusal. If the message projection remains `draft_created`, the same failed draft is ignored and another draft may be generated.
- Impact: legitimate retry is stranded or creates an unnecessary sibling, depending on projection state.
- Acceptance: definite SMTP rejection followed by create-draft returns the same draft, without AI work; stale projection behaves consistently. An ambiguous failure must never become reusable merely because it is labeled failed.

### B09 — Reused drafts lose warnings and audit/provenance [P2]

- [ ] **Fix.** Decode persisted warning/source metadata into the safe reuse result and record the reuse decision consistently, with persistence failure reported to the caller.
- Evidence: initial reuse at `src/service/emailReply/EmailReplyDraftGenerationService.ts:245–259` swallows audit errors and returns empty warnings/sources. Race reuse at `459–474` returns empty metadata without a reuse audit. The original draft writes `knowledgeSourcesJson`/`warningsJson` at `501,511`.
- Trigger: a draft with safety/review warnings or source provenance is reused; alternatively, the reuse audit write fails.
- Current result: the response hides stored review signals, and may report success without the required audit. Reconstruct only metadata that was actually stored; do not invent source excerpts.
- Acceptance: both initial and post-generation reuse preserve stored warnings/provenance and record exactly one decision event. Audit failure must not return a successful audited outcome.

### B10 — Audit failures are misreported as model failures [P2]

- [ ] **Fix.** Keep provider/validation exception handling separate from persistence failures. Attempt the required failure audit once and propagate its failure clearly.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:340–389`; validation failure auditing at `356–363` runs inside a catch scope that interprets the thrown audit error as an LLM failure and invokes failure auditing again.
- Trigger: invalid generated output followed by an audit write that rejects once.
- Current result: a second audit may be attempted and the returned reason becomes a generic provider failure, hiding the actual persistence error and losing the intended stage/code.
- Acceptance: reject the audit write and assert one attempted failure-event write, no fabricated model-error classification, and persistence failure propagated. Test permanent failure and a reject-once stub.

### B11 — Correlation identifies the message, not the request [P2]

- [ ] **Fix.** Allocate a request correlation ID at the entry boundary and carry it through results/events. Keep the deterministic message/workflow identifier as a separate field if useful.
- Evidence: `src/service/emailReply/EmailReplyCorrelation.ts:13–21` hashes message identity; generation failure/refusal audit uses it at `EmailReplyDraftGenerationService.ts:740,774`, and delivery at `EmailReplyDeliveryService.ts:433`.
- Trigger: independent invocations for the same inbound message.
- Current result: unrelated requests have the same correlation ID, preventing reliable grouping of one invocation's classification, fallback, correction, denial, and audit events.
- Acceptance: two invocations have distinct request IDs; all events within either invocation and its returned result retain that invocation's ID.

### B12 — IPC removes structured refusal details [P2]

- [ ] **Fix.** Preserve a typed result union through service, IPC, renderer API, and AI-tool wrappers; retain legacy envelope fields additively where needed. Do not recover policy codes by parsing English error text.
- Evidence: `src/main-process/communication/emailReceive-ipc.ts:305–307,438–442` converts results/typed policy errors to plain errors. `_shared/registerValidatedHandler.ts:51–54` returns only failure status/message/null data; `src/views/utils/apirequest.ts:23–24` throws a plain error. `EmailReceiveAiTools.ts` also extracts bracketed codes from error strings.
- Trigger: a service refuses because of an existing draft, in-flight send, or unknown delivery.
- Current result: callers lose machine-readable code, existing draft/attempt ID, next action, and request correlation; UI/tool behavior depends on wording.
- Acceptance: exercise the actual IPC wrapper and renderer API, not only a mocked service. Verify stable codes and safe fields survive unchanged, including translated display text and unexpected internal exceptions.

### B13 — Response-body and aggregate deadlines are absent [P2, retained gap]

- [ ] **Fix.** Keep cancellation active through non-streaming body consumption, and enforce each call against the remaining overall generation budget. Coordinate this with reservation expiry/fencing in T07.
- Evidence: `src/service/aiProvider/OpenAICompatibleProviderClient.ts:95–137` clears the fetch timeout after response headers; completion awaits `res.json()` around `207`. The generation workflow lacks the revised aggregate deadline.
- Trigger: a local provider returns headers but never finishes its body, or nested classification/retry/correction consumes the overall budget.
- Current result: completion can remain pending beyond the intended deadline. A header-only fetch timeout does not bound a non-streaming completion.
- Acceptance: a stalled body aborts within the budget; correction cannot start after expiry; late output cannot persist under an expired owner. Preserve separately configured streaming behavior rather than imposing a short completion timeout on all streams.

## Remaining implementation tasks

### T01 — Synchronize the implementation contract

- [ ] Bring the revised PRD/design from `fd23dd5582fed48d9635f6e109c0139efa7051cd` into this branch using the normal integration workflow.
- [ ] Record phase boundaries explicitly: phase-1 progress must not be presented as full-feature completion. Use FR IDs in implementation/test mapping.

### T02 — Canonical inbound identity and legacy conflicts (FR-029, FR-038)

- [ ] Define one identity helper scoped to configured email service plus normalized RFC Message-ID hash, with receive-row fallback when unavailable.
- [ ] Inspect equivalent receive rows, drafts, and attempts together. Do not use subject or the entire conversation as the duplicate key.
- [ ] Namespace provider UIDs by mailbox/folder and UIDVALIDITY; safely handle folder/UID namespace changes.
- [ ] Block conflicting legacy live drafts instead of silently choosing one; preserve historical sent protection and expose a safe remediation path.
- [ ] Test same Message-ID in different configured services, duplicate rows in one service, missing IDs, changed UIDVALIDITY, and a new inbound message in an already-answered conversation.

### T03 — Persist trustworthy reply evidence (FR-030)

- [ ] Add the required flag/provenance/observation fields and source identity, separating legacy sent state, app delivery, provider Answered flags, and Sent evidence.
- [ ] Preserve sticky positive evidence and local delivery state during sync; a cleared flag or empty search must not reset a protected message.
- [ ] Refresh selected source messages even when ordinary sync is unread-only. Parse/strip mailbox flags consistently.
- [ ] Persist through main-process Modules/Models with TypeORM; avoid direct database work in IPC or workers.

### T04 — Shared automatic mailbox detector (FR-031)

- [ ] Implement the same detector for draft generation, send enforcement, and the diagnostic tool. Tool invocation must not be a prerequisite for safety.
- [ ] Read current source flags and every relevant verified Sent folder, including special-use discovery and configured fallbacks under the PRD bounds.
- [ ] Match exact normalized reply identifiers and a verified sender identity; distinguish direct In-Reply-To evidence from References ancestry so an old ancestor reply does not block a new inbound message.
- [ ] Return `replied`, `not_replied`, or `unknown` with safe evidence and observation context. Unsupported POP3, missing identity, partial/error searches, or malformed evidence must not become a negative result.
- [ ] Use header-only/PEEK access that does not mark messages read; never use POP3 configuration as IMAP credentials.
- [ ] Add fake IMAP acceptance coverage for answered flags, multiple Sent folders, aliases, missing Sent folder, permission/network errors, malformed headers, and exact versus ancestor matching.

### T05 — Cache and forced-send freshness (FR-031, FR-037)

- [ ] Bind cached evidence to mailbox/source identity, configuration and parser/context versions, and required search coverage.
- [ ] Negative evidence expires within 60 seconds; positive evidence remains sticky. Errors/partial scans must not be cached as negatives.
- [ ] Force fresh detection before send; evidence used for SMTP must be no older than five seconds. If a delay invalidates it, refresh under the remaining budget or refuse.
- [ ] Invalidate on relevant account/folder/sender configuration changes and test expiry, delayed sends, configuration changes, and concurrent checks.

### T06 — Diagnostic tool and safe result contracts (FR-032, FR-033)

- [ ] Implement/register `check_email_replied`, its catalog metadata, IPC channel, preload exposure, API wrapper, and typed DTO.
- [ ] Check `Token` / `USER_AI_ENABLED` first in AI IPC handlers. Use `requiresConfirmation: false` for the diagnostic tool as specified; local evidence/cache/audit writes do not confer send authority.
- [ ] Expose safe snake_case fields, explicit nullable values, bounded evidence, stable code, next action, and request correlation. Do not leak credentials/raw bodies/internal exception details.
- [ ] Update tool summaries/examples to explain unknown and reuse results. Integrate with B12 rather than adding another string-parsing layer.

### T07 — Persistent, fenced generation reservation (FR-035)

- [ ] Add a database-backed unique reservation for canonical inbound identity, owner token, lease, and recovery state; an in-memory mutex is insufficient.
- [ ] Atomically inspect local evidence and acquire the reservation before any classification/generation call. Losing invocations return `generation_in_progress` or the committed eligible draft.
- [ ] Keep model/mailbox network work outside database transactions. Enforce the five-minute overall generation limit and owner/lease checks on every completion write.
- [ ] Commit draft, revision, message projection, reservation transition, and required audit together. Existing best-effort helpers around generation lines `654–711` do not satisfy this contract.
- [ ] Implement crash/restart recovery and fenced late-result rejection. Expired generation ownership must never release an unresolved send.
- [ ] Test concurrent manual/tool/automatic generation, failure between each persistence step, process restart, lease expiry, and a stale owner's late model result.

### T08 — Atomic message-level send claim and recovery (FR-036)

- [ ] In the model transaction, check canonical message and all sibling draft/attempt evidence together with claiming the approved revision. Existing per-draft claim alone leaves sibling sends possible.
- [ ] Apply the same identity/guard invariants to finalize, discard, retry, and recovery paths. Implement B02/B04/B08 regression cases.
- [ ] Reconcile unknown delivery only through conditional transitions with qualifying positive evidence and no active submission/owner; a timeout or expired lease alone must not permit another send.
- [ ] Ensure late SMTP success/failure cannot overwrite a newer authoritative sent state or reopen the message. Preserve exact-attempt replay semantics.
- [ ] Test two approved siblings, stale projection, orphan attempts, unknown delivery across restart, discard/recovery races, and late transport completion.

### T09 — Provider budgets and completion telemetry (FR-026, FR-027, FR-035)

- [ ] Implement B05/B06/B13 and a model-aware output budget with supported-parameter handling, rather than treating hardcoded `max_tokens: 1500` as universally sufficient.
- [ ] Persist actual model, usage, completion reason, and reason-unavailable metadata. The raw response captures some fields but the draft writes literal `openai-compatible` around generation line `498`; revision metadata around `541–548` omits them.
- [ ] Bound each provider call to 120 seconds or the smaller remaining aggregate budget; include classification, wrapper retries, fallback, and correction in accounting.
- [ ] Preserve original email/retrieved context in correction while maintaining strict validation. Test truncation, prohibited payloads, unavailable metadata, provider capability differences, and total submission limits.

### T10 — Required audit and complete user feedback (FR-033, FR-034)

- [ ] Fix B09–B12 and centralize event semantics: one decision/refusal event per invocation with stage, code, safe evidence, and distinct request correlation.
- [ ] Make required persistence failure visible; no successful draft/reuse should be reported as audited after a failed required write.
- [ ] Add actionable UI states for reuse, generation in progress, already replied, unknown evidence, unresolved delivery, conflict, and transient check failure.
- [ ] Update translations for all six languages: English, Chinese, Spanish, French, German, Japanese.
- [ ] Add component tests with loading/error/disabled/reuse behavior and critical Electron E2E flows. Existing source changes introduce no renderer components; UI acceptance is still pending.

### T11 — Populated database upgrade and rollback (FR-038)

- [ ] Implement/test the actual deployed schema-upgrade path for new evidence, cache, guard, and indexes. A clean database or assumed `synchronize`/initialization behavior is insufficient evidence.
- [ ] Upgrade a populated old-schema database twice without losing drafts/revisions/approvals/attempts/audit or historical sent protection.
- [ ] Seed legacy conflicting/canonical duplicate rows; verify safe blocking and operator remediation.
- [ ] Verify forward-compatible rollback behavior and that rollout disabling cannot remove mandatory local duplicate protection.

### T12 — Operational limits, measurements, and rollout (FR-039)

- [ ] Enforce a 15-second total detection budget, at most five Sent folders and 200 candidate headers, and one active probe per mailbox with single-flight sharing.
- [ ] Exhausted/partial probe budgets return unknown, not negative. Include queued-wait time and cancellation in deadline accounting.
- [ ] Measure generation/validation/truncation/correction/fallback outcomes, duplicate denials/reuse, detection latency/unknown rate/cache outcomes, reservation conflicts, and audit failures without logging private message content.
- [ ] Run hosted and local provider compatibility pilots and define unknown-rate baselines, rollout thresholds, and rollback controls from the revised design.

## Phase boundaries (recorded 2026-10-05, after T01 contract sync)

The revised PRD (`fd23dd55`) raises the bar beyond the original Phase-1 plan
(`glowing-frolicking-deer.md`, written against the older PRD covering only
FR-025–FR-034). To prevent Phase-1 progress from being presented as full-feature
completion, FR IDs are mapped to phase and current status below. A requirement
is "complete" only when its entire revised acceptance contract has
implementation evidence and passing acceptance tests (including adversarial
concurrency and stale-state cases).

| FR | Phase | Status | Notes |
|---|---|---|---|
| FR-025 — generation contract | 1 | Partial | Field alignment + correction context improved; authoritative classification can still be overwritten (B07). |
| FR-026 — JSON hints | 1 | Partial | Request forwarding exists; unsupported-parameter fallback + bounded transport budget missing (B06, T09). |
| FR-027 — output budget + completion checks | 1 | Partial | Larger budget + selected finish reasons checked; refusal/tool-call payloads + persisted completion metadata missing (B05, T09). |
| FR-028 — existing-draft reuse | 1 | Partial | Reuse exists; classification runs first, failed drafts mishandled, warnings disappear, race reuse unsafe (B01, B03, B08, B09). |
| FR-029 — local duplicate eligibility | 1 | Partial | Draft/message projections checked at entry; authoritative attempts + complete post-generation recheck missing (B02, B03). |
| FR-030 — persisted mailbox evidence | 2 | Not started | T03. |
| FR-031 — automatic fresh detection | 2 | Not started | T04–T05. |
| FR-032 — diagnostic reply-check tool | 2 | Not started | T06. |
| FR-033 — structured results | 1→2 | Partial | Some service/tool codes; IPC discards typed outcomes, wrappers parse error text (B12, T06, T10). |
| FR-034 — audit + user feedback | 1→2 | Partial | Narrow skip auditing added; reuse/audit failure + request correlation incomplete; translated end-to-end feedback missing (B09–B11, T10). |
| FR-035 — persistent generation reservation | 2 | Not started | T07. |
| FR-036 — message-level send claim + recovery | 2 | Not started | T08. |
| FR-037 — detection cache | 2 | Not started | T05. |
| FR-038 — legacy conflicts + upgrade | 2 | Partial | Some multi-draft conflict checks; canonical duplicates, populated upgrades, recovery guarantees unverified (B03, T02, T11). |
| FR-039 — budgets, metrics, rollout | 2 | Not started | T09, T12. |

Phase-1 scope (this branch, in progress): FR-025, FR-026, FR-027, FR-028, FR-029,
and the Phase-1 slices of FR-033/FR-034 (stable codes + one refusal audit per
invocation). These remain Partial until their P1/P2 defects are fixed. The
Phase-2 scope (FR-030–FR-032, FR-035–FR-039, and the full FR-033/FR-034 UI
slice) is NOT implemented on this branch and must not be claimed as complete.

## Suggested execution order and completion gate

1. Synchronize the contract (T01), fix unsafe local-state handling (B02/B03/B05/B07), and make canonical identity explicit (T02).
2. Correct reuse/retry/replay behavior and structured audit results (B01/B04/B08–B12).
3. Add persistent generation reservation and atomic send invariants (T07–T08), with crash/race regression tests.
4. Implement evidence persistence, automatic detection, freshness/cache, and diagnostic exposure (T03–T06).
5. Finish provider budgets/metadata, translations/UI acceptance, populated upgrades, and rollout checks (T09–T12).

Do not mark the full PRD complete until each matrix row has implementation evidence and passing acceptance tests, including adversarial concurrency and stale-state cases. Re-run the focused suites after changes, add the missing cases above, then run the required component/E2E and migration checks for their respective changes. Passing the current 119 tests establishes the covered behavior only.
