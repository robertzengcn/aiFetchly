# Recoverable History and Incremental Compaction — Remaining TODO

Date: 2026-09-16

Reviewed worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`

Reviewed HEAD: `b188a6b6`

Status: Partial implementation; completion is not confirmed.

References:

- [PRD](ai-chat-recoverable-history-incremental-compaction-prd.md)
- [Technical design](ai-chat-recoverable-history-incremental-compaction-technical-design.md)

This checklist records gaps from the implementation review. Code locations below are repository-relative and line numbers refer to the reviewed snapshot. “Verification outstanding” means the review did not establish the acceptance condition; it does not by itself mean the feature is absent. Passing existing tests does not close the implementation gaps below.

## Request budgets and bounded data access

- [ ] **Wire mandatory final request preflight into every engine consumer.**
  - Reason: Interactive `createQueryLoop()` omits `requestBudgetService`, while the query loop only applies the new guard when that dependency exists. Budget-service unit tests therefore do not establish that production interactive requests are checked.
  - Evidence: `src/main-process/communication/ai-chat-v2-ipc.ts:129`; `src/service/AIChatQueryLoop.ts:1137`.
  - Work: Wire the interactive dependency, audit AgentRuntime and other isolated consumers, and enforce preflight after retrieval, tool rounds, and model fallback. Include system/tool framing, attachments, output reserve, and safety margin.
  - Done when: Production-wiring tests prove every dispatch is checked and oversized mandatory input fails without truncation.
  - Requirements: FR-04, FR-08; AC-11, AC-16; design §§8–9, 14.

- [ ] **Remove reachable all-history summarization and unchecked session-memory paths.**
  - Reason: `runFullCompact()` retains an all-history fallback when the coordinator is absent. Session memory independently loads and summarizes an unbounded delta. Disabling new publication must not restore the old unsafe path.
  - Evidence: `src/service/AIChatCompactAgentService.ts:483` and `:339`.
  - Work: Route automatic, manual, reactive-overflow, session-memory, and compatibility triggers through shared bounded budgets and checkpoints. Provide a budget-checked limitation when compaction is unavailable.
  - Done when: Captured requests for every trigger and rollback mode remain bounded on histories larger than ten model windows.
  - Requirements: FR-07, FR-08; AC-04, AC-23; design §§14–15, 21.

- [ ] **Replace full-conversation loads in context assembly, auto-compaction checks, and tool-history lookup.**
  - Reason: These paths still load full conversations before filtering or slicing, so archive size continues to determine memory and query cost.
  - Evidence: `src/service/AIChatContextAssembler.ts:245`; `src/service/AIChatCompactAgentService.ts:226`; `ConversationToolHistoryService.lookup()` in `src/service/ConversationToolHistoryService.ts`.
  - Work: Use bounded Model queries for recent complete turns, coverage checks, tool receipts, and stored result lookup. Bound decoded payload size at the database read boundary; row-count limits alone do not bound oversized message payloads.
  - Done when: Large-history tests establish bounded reads, including oversized individual messages and tool payloads, without full-conversation materialization.
  - Requirements: FR-01, FR-03, FR-07; AC-10; PRD §10; design §§5–7, 12.

## Incremental compaction and continuity

- [ ] **Resume from committed coverage and persisted staged checkpoints.**
  - Reason: Each coordinator run initializes `cursor` to undefined and `ordinal` to zero, rather than continuing saved work. Section work keys use ordinal/fragment count instead of the complete deterministic source identity; section starts are recorded as zero.
  - Evidence: `src/service/AIChatCompactionCoordinator.ts:234`, `:289`, and `:343`.
  - Work: Load contiguous committed/staged coverage, reuse saved sections, and identify work by epoch/revision, source range and fragments, and schema version. Persist accurate range boundaries.
  - Done when: Adding one eligible turn processes only new sources, and a restart after section save reuses that section without duplicate coverage.
  - Requirements: FR-07, FR-09; AC-05, AC-07, AC-08; design §11.

- [ ] **Build and publish a validated cumulative overview.**
  - Reason: Publication serializes only `lastSummary`; it does not merge the previous published overview with consecutive new sections. Earlier continuation facts can disappear from the active overview even though the generation claims broader coverage.
  - Evidence: `src/service/AIChatCompactionCoordinator.ts:369`.
  - Work: Synthesize a bounded overview plus source-linked continuation state, validate references and represented coverage, and publish atomically. Preserve the prior active generation when synthesis or publication fails.
  - Done when: Multiple-section and repeated-run tests retain required continuation state, preserve source navigation, and never publish coverage beyond represented terminal turns.
  - Requirements: FR-06, FR-07; AC-03, AC-14, AC-21; design §§10–12.

- [ ] **Yield resumably at the batch limit and report accurate run states.**
  - Reason: After the bounded section loop, the coordinator publishes and returns `completed` even when a continuation remains. Joining another owner's active run also returns `completed`.
  - Evidence: `src/service/AIChatCompactionCoordinator.ts:222`, `:242`, and `:412`.
  - Work: Distinguish joined/running, paused/yielded, and completed states. Schedule further bounded batches when appropriate without tight retries, preserving checkpoints and respecting cancellation.
  - Done when: A history requiring more than three sections continues or pauses resumably and is not reported complete prematurely.
  - Requirements: FR-07, FR-09, FR-10; AC-04, AC-07, AC-08; design §11.2.

- [ ] **Capture a terminal-turn snapshot that excludes the retained recent suffix.**
  - Reason: The coordinator sets retained start equal to the archive high-water boundary instead of computing the latest two complete turns. The assembler selects a text-message window rather than allocating complete turns by token cost.
  - Evidence: `src/service/AIChatCompactionCoordinator.ts:196`; `src/service/AIChatContextAssembler.ts:252`.
  - Work: Use authoritative turn projections, retain two completed turns when they fit plus the in-progress turn, and preserve tool exchanges. Handle oversized turns with explicit receipts and source references.
  - Done when: “Continue” retains the right context; equal timestamps, unresolved tools, and messages appended during compaction cannot cause omissions or partial-turn exclusion.
  - Requirements: FR-05, FR-09; AC-03, AC-06, AC-09; design §§4.3, 11–12.

- [ ] **Implement and verify bounded repair/reduction retries.**
  - Reason: The reviewed coordinator directly invokes the summarizer and cancels on error. It does not implement the specified structured-output repair and context-size reduction policy. Its provider adapter also omits an explicit summary output cap.
  - Evidence: `src/service/AIChatCompactionCoordinator.ts:301`, `:313`, and `:418`; `src/service/AIChatCompactAgentService.ts:448`.
  - Work: Apply complete compaction/overview preflight, provider output caps, at most two source-size reductions, one structured-output repair within the shared four-attempt ceiling, and persisted failure/backoff state.
  - Done when: Fake-provider rejection and malformed-output tests prove bounded attempts, unchanged valid coverage, and no all-history fallback.
  - Requirements: FR-08, FR-11; AC-14, AC-15; design §§8, 16.

## Retrieval correctness and selected context

- [ ] **Preserve exact source offsets throughout search, read, and selection resolution.**
  - Reason: Search fragments and selected slices are converted to source IDs beginning at offset zero. A hit later in a message can subsequently resolve to the message prefix instead of the displayed passage.
  - Evidence: `src/modules/AIChatArchiveModule.ts:140` and `:493`; `src/service/AIChatHistoryRetrievalService.ts:718`.
  - Work: Carry original field and code-point intervals through every excerpt conversion. Verify the returned fragment itself against current stored content; a match elsewhere in the message is insufficient.
  - Done when: Nonzero-offset and multilingual search → read → select round trips return the same exact text and valid provenance.
  - Requirements: FR-01–03, FR-10; AC-01, AC-18, AC-21; design §§4, 7, 13.3.

- [ ] **Validate cursor bindings and enforce source ownership at lookup time.**
  - Reason: Search cursors contain a query hash and revision but decoding does not compare those with the active query/revision. Source IDs are editable base64 data; resolving a row by ID after checking only the supplied epoch does not independently verify that the row belongs to the active conversation.
  - Evidence: `decodeScanCursor()` and `resolveOne()` in `src/modules/AIChatArchiveModule.ts`; `src/model/AIChatMessageArchive.model.ts:220`.
  - Work: Validate query/filter/revision bindings and source ranges against trusted context. Scope every row lookup by conversation as well as ID. Reject modified references to another conversation even if they carry the current conversation's epoch.
  - Done when: Forged row IDs, changed queries, stale cursors, and cross-conversation selections fail without exposing foreign content.
  - Requirements: FR-01–03; AC-12; design §§4.2, 7.

- [ ] **Enforce retrieval response budgets, continuation, and actual deduplication.**
  - Reason: Single-source/message reads return entire selected content with `truncated: false` and no continuation. Search records are appended before over-budget detection. Recorded overlap intervals do not prevent duplicate passages from being returned. Range reads fetch an initial page and filter it, rather than starting at the requested range; the supplied read continuation is not applied.
  - Evidence: `src/service/AIChatHistoryRetrievalService.ts`, especially `search()`, `readBySourceId()` at line 383, `readByMessageId()` at line 411, and `readRange()` at line 431.
  - Work: Allocate serialized output within per-call, cumulative-turn, and remaining-request limits before returning records. Implement stable offset continuation, proper range pagination, and overlap/recent-context deduplication.
  - Done when: Oversized reads can recover every fragment across bounded calls, later ranges are reachable, repeated reads do not duplicate evidence, and downstream requests remain within budget.
  - Requirements: FR-03, FR-04; AC-11, AC-18; design §§6–9.

- [ ] **Reject oversized or changed selections before acceptance instead of silently narrowing them.**
  - Reason: `resolveSelections()` caps excerpts to prefixes, while the PRD requires users to narrow selections that do not fit. Archive resolution refreshes changed revisions and reapplies offsets without requiring the user to confirm the changed source.
  - Evidence: `resolveSelections()` in `src/service/AIChatHistoryRetrievalService.ts` and `src/modules/AIChatArchiveModule.ts`.
  - Work: Resolve trusted intervals, reject stale/oversized selections with actionable feedback, and retain the draft on rejection. Validate final request capacity before accepting the turn.
  - Done when: The model receives precisely the accepted passage once; changed sources or insufficient capacity cannot silently alter or omit it.
  - Requirements: FR-10; AC-18; design §13.3.

- [ ] **Preserve per-conversation drafts and stable submission identity across retries.**
  - Reason: Switching conversations clears selections, and every send generates a fresh submission ID. This does not implement the specified retry lifecycle for an already accepted turn.
  - Evidence: `src/views/components/aiChatV2/AiChatV2.vue:1846` and `:3769`.
  - Work: Store draft references per conversation, keep the submission ID until acceptance is resolved, reuse accepted user-turn metadata on execution retry, and clear only accepted selections.
  - Done when: Conversation switching preserves drafts; transport and provider-failure retries do not duplicate the user message or selected context.
  - Requirements: FR-10; AC-18; design §13.3.

## UI and release verification

- [ ] **Complete history browsing, source navigation, and accessible controls.**
  - Reason: The drawer only searches and initially claims no archived history without loading it. “Read more” is inert text. The icon-only close button lacks an accessible name.
  - Evidence: `src/views/components/aiChatV2/AiChatHistoryDrawer.vue:15`, `:65`, and `:151`; `src/views/components/aiChatV2/AiChatHistoryMessage.vue:20`.
  - Work: Add paginated browsing, working passage expansion/source navigation, keyboard operation, and focus restoration. Keep viewing independent of model-context selection. Update all six translations and corresponding component tests.
  - Done when: Users can browse and read complete original passages using only the keyboard without changing the next model request unless they select context.
  - Requirements: FR-10; AC-17, AC-24; design §13.2.

- [ ] **Complete compaction status and user recovery actions.**
  - Reason: The status chip only displays a label. It has no history-navigation, retry, or cancel action, and manual IPC broadcasts completion/failure after waiting for the compact operation.
  - Evidence: `src/views/components/aiChatV2/AiChatCompactionStatus.vue:1`; `src/main-process/communication/ai-chat-v2-ipc.ts:1332`.
  - Work: Provide a bounded start/status flow, meaningful progress events, section counts or indeterminate progress, retry/cancel controls, and a link to earlier messages. Explain that originals remain searchable after completion.
  - Done when: Running, paused, cancelled, failed, and completed states are accurate and actionable, including during long compaction and after restart.
  - Requirements: FR-09–11; design §13.

- [ ] **Finish acceptance and release qualification — verification outstanding.**
  - Reason: Existing passing tests do not establish all 24 acceptance criteria. The reviewed E2E scenario compacts once with a small conversation; selected-context assertions inspect persisted references rather than the exact provider passage. Deletion occurs after completion rather than during in-flight compaction. Full Electron E2E was not run during this audit.
  - Evidence: `test/e2e/specs/ai-chat-recoverable-history.test.ts`; PRD §§10–13; design §17.
  - Work: Add/run repeated-compaction and restart flows, exact provider-input selection assertions, in-flight deletion, concurrent triggers, legacy migration/rollback, and all-language keyboard checks. Verify oversized fragments and no gaps before publication with production Model/Module integration tests. Run applicable E2E, lint, and both type checks after implementation.
  - Work: Locate or produce the documented 100,000-message performance measurements and versioned 50-case six-language recall evaluation. Record p95 latency, model/provider settings, source-backed answer accuracy, and fabricated-quote count. These qualification results were not established by this review.
  - Done when: Each AC-01 through AC-24 has linked passing evidence and the PRD's performance/recall release targets are measured and satisfied.

## Verification baseline from the review

The following checks passed against the reviewed worktree:

| Check | Result |
| --- | --- |
| Eight archive/retrieval/packing/coordinator/budget/indexer/startup/append main test files | 64 tests passed |
| Full component suite | 51 files, 308 tests passed |
| `yarn typecheck` | Passed |
| `yarn vue-typecheck` | Passed |
| Electron E2E | Not run in this audit |
| Lint | Not run in this audit |
| Performance and live-model recall qualification | Not established in this audit |

The E2E file was already present as a user change and became staged during the review. It is not part of this TODO document's commit. This document records remaining work; it does not mark any implementation task complete.
