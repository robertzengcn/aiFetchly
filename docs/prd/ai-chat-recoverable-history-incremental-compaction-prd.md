# PRD: Recoverable Conversation History and Incremental Compaction

**Date:** 2026-09-11  
**Status:** Draft for product and engineering review  
**Technical design:** [Implementation architecture and contracts](ai-chat-recoverable-history-incremental-compaction-technical-design.md)  
**Owner:** AiFetchly AI Chat  
**Scope:** AI Chat V2, interactive continuation, and existing engine consumers  
**Priority:** Required reliability improvement

## 1. Executive summary

AiFetchly must support conversations longer than a model's context window without losing access to earlier details or eventually exceeding the summarizer's own context window.

Compaction must change what is loaded into the next model request while retaining the original stored conversation as the source of truth. The assistant must be able to search earlier messages and retrieve exact passages. Users must be able to inspect earlier messages and select passages for their next request.

The current full-compaction implementation reads all stored text messages and sends them to the summarizer in one request. Repeating this operation as a conversation grows is not sustainable. This PRD requires bounded, incremental, resumable compaction as part of the initial release, alongside history retrieval. It is not deferred to a future optimization.

The target design has four cooperating parts:

1. Original stored history, accessible through bounded database queries.
2. Versioned summaries of bounded sections, retaining original-message references.
3. A small active overview and structured continuation state.
4. Recent complete turns and selectively retrieved original passages in the active context.

Summaries are navigation and continuation aids. They are not a reversible encoding of the original conversation.

## 2. Existing behavior and evidence

The following observations are based on the repository inspected for this PRD, not runtime verification:

| Area | Existing behavior | Consequence |
| --- | --- | --- |
| `src/service/AIChatCompactAgentService.ts`, `runFullCompact` | Loads conversation rows, filters ordinary messages, and sends all resulting text to one summarization request | Summarization input grows with the lifetime conversation and can exceed the model window |
| Same service, session memory updates | Summarizes new ordinary messages plus existing memory | Already incremental in principle, but a large unsummarized delta still needs explicit request budgeting |
| `src/service/AIChatContextAssembler.ts` | Selects a recent text window, then removes messages at or before the active compaction timestamp | Recent conversational detail can disappear immediately after full compaction |
| Same assembler | Excludes tool pairs before the active compaction boundary from automatic tool context | Prior tool evidence becomes less discoverable after compaction |
| `src/service/AIChatCompactPromptBuilder.ts` | Requests structured Markdown headings, without per-fact source references | A summary cannot direct the assistant reliably to exact supporting messages |
| `src/model/AIChatCompactSummary.model.ts` | Stores ranges and supersedes prior active summaries transactionally | Useful foundation for versioned compaction; original messages are not deleted by this save path |
| `src/service/agentTools/conversationToolHistoryTool.ts` | Exposes on-demand tool history lookup | Reuse this capability and improve its archive integration |
| `src/service/ConversationToolHistoryService.ts` | Lookup loads the conversation before pairing/filtering results | Retrieval scalability also requires bounded data access |

Related documents:

- [Original agent memory and compact PRD](../superpowers/specs/2026-06-15-agent-memory-compact-prd.md)
- [Original compact technical design](../superpowers/specs/2026-06-15-agent-memory-compact-technical-design.md)
- [AI Chat V2 goal and loop PRD](ai-chat-goal-loop-prd.md)

This PRD extends the original requirements for history preservation, recent turns, and recovery. Where the older design assumes a single all-history summarization call, this PRD supersedes that assumption. Existing AI entitlement and provider-routing policies remain authoritative; this feature must not redefine them.

## 3. Problems to solve

### 3.1 Details disappear from working context

A summary can omit exact wording, a numeric limit, a rejected alternative, or why a decision was made. Without retrieval, the assistant may guess or ask the user to repeat information that is still stored locally.

### 3.2 The summarizer eventually encounters the same limit

Sending all historical messages on every full compact creates growing request sizes and repeated processing of unchanged content. A conversation can continue to grow in storage even when its active prompt is small.

### 3.3 Immediate continuity and tool evidence are weakened

Compacting through the latest message can remove the context needed for “continue” or “change the second option.” Separate tool rows may be omitted from the summarization source, and repeated summarization can lose operational evidence.

### 3.4 Users cannot clearly inspect or restore selected context

Users need to distinguish stored conversation history from the smaller set of content currently available to the model. Restoring everything would reproduce the original token problem.

## 4. Goals and non-goals

### Goals

- G1: Recover exact previously stored text through search and bounded reads after repeated compaction and restart.
- G2: Bound every summarization request independently of total conversation length.
- G3: Process newly eligible history incrementally and resume interrupted work without duplicate active coverage.
- G4: Preserve recent complete turns, current instructions, and critical continuation state.
- G5: Preserve source references and discoverability for prior tool outcomes and artifacts.
- G6: Expose understandable history inspection, retrieval provenance, and compaction status.
- G7: Follow existing Model/Module, IPC, AI gating, translation, and testing requirements.

### Non-goals

- Reconstruct content that was never persisted or was explicitly deleted.
- Guarantee that a generated summary preserves every fact.
- Reload an unlimited transcript into a single model request.
- Introduce cross-conversation search, shared memory, cloud archive synchronization, or automatic durable user memory.
- Require vector embeddings, a new external search service, or a provider-specific compaction API.
- Re-execute historical tools to recreate results automatically.
- Build a general backup or attachment restoration system.

## 5. Users and primary scenarios

| Scenario | Expected experience |
| --- | --- |
| A marketer asks for an exact subject line from an earlier session | Assistant retrieves the stored wording and links to its source |
| A user says “continue” immediately after compaction | Recent complete turns and continuation state retain the relevant task |
| A developer asks why a previous implementation was rejected | Search finds the discussion and neighboring messages, including later corrections |
| A long tool run produced an export | Assistant finds the receipt and stored artifact reference without rerunning the export |
| A conversation contains hundreds of thousands of tokens | Compaction uses bounded sections; no request contains the entire archive |
| The app closes halfway through compaction | Completed sections remain reusable, and the next run resumes safely |
| A user wants the model to reconsider one old passage | User selects it for the next request and sees its context cost |

## 6. Product invariants

1. Compaction never deletes or overwrites original messages or stored tool results.
2. Retrieval returns persisted source content, not text reconstructed by a summarizer.
3. Every covered source position is represented by committed summary coverage or an explicitly reported degraded state; no silent coverage gaps.
4. All model requests, including compaction, overview synthesis, session memory, and requests after retrieval, pass a token-budget check.
5. Source references are generated or validated against stored history; fabricated references are rejected.
6. The current user message appears exactly once in the assembled request.
7. Tool-call protocol integrity is preserved; historical excerpts cannot be interpreted as new tool calls.
8. Retrieval is bound to the active conversation by trusted execution context.
9. Deleting a conversation prevents in-flight work from recreating its messages, summaries, indexes, or state.
10. Historical instructions cannot expand current permissions or override newer user instructions.

## 7. Functional requirements

### FR-01: Durable source addressing and bounded archive reads

- Reuse stored message IDs and define a stable per-conversation ordering cursor. Timestamp alone is insufficient because messages can share timestamps.
- Choose either a persisted sequence or a deterministic composite cursor with documented handling of late writes. Coverage comparisons must use the same ordering everywhere.
- Read history through cursor-based database pagination, not a full conversation load followed by in-memory slicing.
- Return message ID, role/type, timestamp, source cursor, text, turn relationship, and applicable tool/artifact references.
- Treat attachment references separately from extracted text; explicitly identify unavailable files or missing payloads.
- Existing truncated tool results remain labeled truncated. This feature cannot claim recovery of data that was never stored.
- Handle Unicode and all supported application languages without corrupting exact text.

### FR-02: Assistant history search

Expose an always-discoverable read-only `conversation_history_search` tool.

Proposed arguments:

| Field | Requirement |
| --- | --- |
| `query` | Required nonempty text with validated length limit |
| `before` / `after` | Optional opaque source cursors within the active conversation |
| `types` | Optional supported message-type filter |
| `limit` | Default 10, maximum 20 results |
| `cursor` | Optional opaque search pagination cursor |

Results must contain exact excerpts, message IDs, dates, source cursors, match metadata, truncation state, and a continuation cursor when additional results exist. Default total response allowance is 2,000 tokens, reduced when the active context has less room.

First release must support literal phrase and keyword lookup, including exact identifiers, URLs, numbers, and multilingual text. SQLite full-text search is an implementation option, not a dependency assumption: verify deployed tokenizer support and Chinese/Japanese behavior. Provide a bounded literal-search fallback where necessary.

Search must include compacted history. It must not treat compaction boundaries as access restrictions. A no-match result must be distinguishable from an unavailable index or storage failure. An unavailable index should fall back to bounded source lookup where feasible.

### FR-03: Assistant history reads

Expose an always-discoverable read-only `conversation_history_read` tool.

- Accept a message ID or validated source range, optional neighboring-turn count, and continuation cursor.
- Default output allowance: 4,000 tokens; hard tool allowance: 8,000 tokens, further limited by the current request budget.
- Return exact stored passages with provenance and explicit continuation information.
- Use stable text offsets for oversized individual messages; do not silently truncate them or replace them with a summary.
- Preserve context around a match sufficiently to distinguish proposals from accepted decisions.
- Reject IDs or cursors from another conversation without exposing its content.
- Coordinate with existing `conversation_tool_history` for full stored tool results; do not create conflicting lookup semantics.
- Retrieval must never execute the referenced tool or acquire new permissions.

### FR-04: Retrieval behavior and budget

The assistant must be instructed to retrieve sources before claiming exact wording or uncertain historical details. Explicit requests such as “what did I say earlier?” or “use the original values” are primary retrieval triggers.

- Search first when the location is unknown; read directly when a valid source reference is available.
- Show source links for recovered quotes, values, and decisions where practical.
- Prefer later explicit corrections over earlier decisions while retaining their history.
- Never claim content was recovered when the source cannot be found.
- Keep retrieved passages in a distinct historical-evidence block with original roles and dates.
- Default cumulative retrieval allowance per assistant turn: 8,000 tokens, reduced to available capacity. Default maximum: four retrieval calls before a bounded partial response or request for a narrower query.
- Deduplicate passages across repeated reads and overlap with recent history.
- Treat automatic relevance retrieval as optional future enhancement; explicit tool retrieval is required in this release.

### FR-05: Preserve recent complete turns

- Preserve the latest two completed user/assistant turns by default when they fit, plus the current in-progress turn.
- Use token cost, not a fixed message count alone, to choose the retained suffix.
- Prefer retaining additional recent turns when capacity permits.
- Never place the compaction boundary inside an in-progress turn or unresolved tool exchange.
- A completed turn includes its associated tool calls and outcomes, not only ordinary text rows.
- For a single oversized completed turn, retain a bounded receipt and retrievable references, visibly marking that raw content is not fully loaded.
- If the current user input and mandatory context alone cannot fit, report the limitation and offer narrowing or a compatible larger model. Do not silently truncate the current request.

### FR-06: Source-linked continuation state

Maintain bounded continuation state containing:

- Current goal and active task.
- Explicit user constraints and accepted decisions.
- Pending actions, blockers, and latest verified status.
- Relevant artifact references and significant tool outcomes.
- A useful next step.

Each factual item should carry validated source message references. Differentiate proposed, accepted, superseded, and uncertain items where applicable. Summarizer inference must not be presented as a user-approved decision.

Reuse canonical plan/goal/tool state where already available instead of maintaining a competing source of truth. Historical state must not resurrect completed tasks or grant approvals. The active overview should point to deeper section summaries or original sources for omitted detail.

### FR-07: Bounded incremental compaction — required for initial release

All automatic, manual, reactive-overflow, and session-memory paths must use the same budget policy and serialization rules.

1. Capture a stable snapshot of eligible completed history, excluding the retained recent suffix.
2. Find the latest committed contiguous source coverage.
3. Read only the next unsummarized section using bounded database pagination.
4. Pack complete turns and bounded tool receipts within the summarization request budget.
5. Summarize the section with source references and structured continuation changes.
6. Validate response structure, source references, output budget, and source coverage.
7. Persist a completed section summary atomically and advance its coverage checkpoint.
8. Update a bounded overall overview using the previous bounded overview plus new section summaries. Never concatenate every historical section summary into one request.
9. Publish an active context generation that consistently identifies its overview, represented sections, and boundary.
10. Continue in bounded batches or yield and resume later.

Unchanged raw history must not be resent during normal incremental compaction. Explicit repair or rebuild may revisit source history, but must use the same bounded section algorithm.

A section summary is preserved independently of the rolling overview. Repeated overview updates therefore cannot remove access to prior section summaries or original evidence. Deeper summary trees are optional; they must not become a prerequisite for delivering bounded processing.

If overview synthesis fails, keep the last valid active generation. Completed sections may remain staged for reuse. The system must not advance the active exclusion boundary past content the active generation does not represent. A bounded set of staged section summaries may be included only when the generation explicitly accounts for them and the final prompt fits.

### FR-08: Budget calculation and oversized sources

For each model call, enforce:

`estimated_input_tokens + reserved_output_tokens + safety_margin <= model_context_window`

The input estimate includes system instructions, tool schemas, provider message framing, summary/state blocks, retrieved passages, attachments where applicable, and the current request. Compaction has its own prompt overhead and output reservation; it does not reuse an unchecked chat-input allowance.

Proposed configurable defaults:

| Setting | Initial default |
| --- | --- |
| Automatic compaction trigger | 80% of usable input capacity, assessed before dispatch and after actual usage updates |
| Desired active prompt after compaction | At most 60% of usable input capacity, when mandatory content allows |
| Raw section source target | At most 12,000 estimated tokens and never above calculated available source capacity |
| Section summary output cap | 1,500 tokens, reduced to provider/model allowance |
| Overview plus continuation state target | 2,000 tokens, reduced for small models |
| Safety margin | 10% of model context by default; configurable and calibrated using usage data |
| Background batch | At most three completed sections before yielding |

These are starting defaults, not claims about model accuracy. Configure output caps in provider requests and validate returned content. Resolve context/output limits through the existing model catalog. If limits are unknown, use a documented conservative fallback and surface uncertainty; do not assume every unknown model supports 128,000 tokens.

For an oversized source message, split text into stable, bounded fragments with message ID and offsets. Every fragment must be accounted for before its source message is considered covered. Do not advance coverage after summarizing only its first fragment. Tool payloads may use bounded receipts plus original payload references. Native tool-call pairs must remain structurally valid in chat replay; summarizer fragments are historical data, not protocol messages.

Provider context-length rejection must trigger a smaller bounded attempt, with at most two reduction retries for a section in one run. Persist failure state and preserve valid coverage when retries are exhausted. Never fall back to an all-history request.

### FR-09: Concurrency, cancellation, and recovery

- Use one per-conversation compaction coordinator shared by every trigger, with an atomic in-flight claim before asynchronous work can race.
- Persist run/generation identity and checkpoints so restart does not rely on an in-memory lock.
- New messages after the snapshot remain outside that run's coverage.
- Use compare-and-swap or equivalent transactional checks when publishing a new generation.
- Identify section work deterministically by conversation generation, source range, and schema version; retrying a saved section must not duplicate it.
- Do not hold database transactions open while awaiting an AI response.
- Resume staged sections after restart rather than reprocessing the entire archive. An interrupted unsaved request may be repeated.
- Cancellation preserves committed work, stops new requests, and keeps the last valid active generation.
- Conversation deletion invalidates the generation; a late AI response cannot recreate deleted records.
- If history can be edited or late-written, invalidate affected coverage and rebuild from the earliest affected section using bounded reads.

### FR-10: UI and user control

History inspection:

- Provide “View earlier messages” from the compaction indicator and existing conversation history surface.
- Browse/search original messages with pagination, dates, and source links.
- Display a compaction marker without hiding access to originals.
- Expanding earlier history affects the UI only; it does not load the entire archive into the model.

Selective context restoration:

- Provide “Use in next reply” for selected messages or passages.
- Show selected excerpts, estimated context cost, removal controls, and clear unavailable/oversized states.
- Resolve selections from trusted stored IDs and offsets, not renderer-supplied replacement text.
- Treat selections as explicit context for the next submitted turn; consume them on successful submission and allow retry after a failed submission.
- If selected passages do not fit, ask the user to narrow the selection before sending. Do not silently omit selected content.

Compaction status:

- Show idle, preparing, compacting, paused/cancelled, complete, and failed states.
- Use section counts or indeterminate progress until a reliable total exists; do not invent a percentage.
- Explain completion in plain language: earlier messages remain searchable.
- Failure must preserve conversation access and expose retry when appropriate.
- Avoid repeated notifications for ordinary successful background work.

All new UI text must include English, Chinese, Spanish, French, German, and Japanese translations. Controls must be keyboard accessible and have meaningful accessible labels and focus behavior.

### FR-11: Failure and degraded behavior

| Failure | Required behavior |
| --- | --- |
| Empty or malformed summary | Reject it; do not advance represented coverage |
| Invalid source references | Reject or repair from verified source metadata before publication |
| Search index missing | Use bounded fallback or clearly report temporary unavailability |
| Storage read fails | Report retrieval failure distinctly from no match |
| Tool payload/artifact missing | Show available receipt and explicit missing-content state |
| Current context still too large | Reduce optional retrieval/history within policy; preserve explicit current input; return actionable failure if still oversized |
| AI unavailable or disabled | Preserve local history browsing; do not perform unauthorized summarization |
| Repeated compaction failure | Bound retries, retain valid state, and surface a recoverable error |
| Database write fails | Keep prior active generation; retry from persisted checkpoint |

## 8. Data and architecture requirements

Logical records below describe responsibilities, not mandatory final table names:

| Record | Required information |
| --- | --- |
| Original message | Existing identity, conversation, stable order, role/type, content, turn/tool associations |
| Section summary | ID, conversation generation, source start/end, fragment coverage if applicable, summary, validated references, token estimates, model, schema version, state |
| Active generation | Version, represented boundary, overview, continuation state, section references, created time |
| Compaction run | Snapshot boundary, checkpoint, staged sections, run state, failure/retry metadata, cancellation marker |
| Search index | Rebuildable message-to-search mapping; never sole storage of original content |

Requirements:

- Index source range reads by conversation and ordering cursor.
- Store bounded derived summaries; archive growth may be proportional to original history, but active model context must remain bounded.
- Use Model classes for TypeORM access and Module classes for business rules. IPC handles validation and communication only.
- Resolve database location through `Token` and `USERSDBPATH` using existing base classes.
- Do not introduce direct worker database access. If a worker is used, place its entry point in `src/childprocess/` and communicate with the main process.
- Apply AI feature gating at the start of AI-serving IPC paths, before request parsing or model work, using the project's existing policy. Local archive viewing must not require an AI call.
- Keep original role/permission boundaries in prompts. Do not inject retrieved text as privileged system instructions.
- Apply existing sensitive-content rules to derived summaries and model-bound excerpts. Any required redaction must be explicitly labeled; do not call redacted output an exact original quote.
- Scope opaque cursors, source links, and tool calls to the current conversation and validate every lookup.
- Clearing conversation/all-history must clear derived records and indexes through coordinated Module operations and prevent subsequent resurrection.
- Telemetry must not contain conversation text, tool payloads, credentials, or full user queries.

## 9. Compatibility and migration

1. Add required schema/index support without rewriting or deleting original history.
2. Keep existing summaries readable during migration. Label them as legacy summaries with limited provenance.
3. Resolve legacy timestamp boundaries against stored IDs/order; ambiguous boundaries must not silently exclude messages.
4. Enable archive retrieval for legacy conversations immediately where original messages exist.
5. Backfill source indexes in bounded resumable batches, lazily or in background.
6. Rebuild detailed section coverage for legacy conversations using bounded source sections. Do not send legacy all-history input to a model.
7. Keep the existing active summary until a consistent replacement generation is ready; show preparation state when rebuilding is necessary.
8. Review engine consumers including scheduled/goal/subagent flows so they inherit safe budget behavior or explicitly fail within budget when compaction services are unavailable.
9. Roll back by disabling new generation publication while preserving stored history and new derived records. Compatibility fallback must not re-enable unbounded summarization.

## 10. Quality, performance, and observability

Release targets, to be measured rather than assumed:

- No compaction request exceeds the locally calculated input/output budget in the deterministic test suite.
- No normal incremental compaction request resends a previously committed raw section unless repair/rebuild is explicitly required.
- No full-conversation in-memory load in the new search/read/compaction path, including overview assembly and tool lookup integration.
- Search first-page p95 target: under one second on an indexed 100,000-message local fixture on the documented reference machine.
- Source read p95 target: under 500 ms on the same fixture, excluding rendering and AI latency.
- Bounded pagination and provider waits must not block renderer interaction or hold long database transactions.
- Exact stored text is returned byte-for-byte at the text-content level, except explicitly labeled policy redaction; formatting must not alter selected text.

Record model/window, estimated and actual usage where available, section/range IDs, checkpoint age, active generation, request counts, retries, duration, retrieval counts, truncation, and failure category. Use these to detect growing request sizes, repeated work, stalled coverage, and summary/retrieval budget pressure.

For model-assisted quality evaluation, maintain a versioned dataset of at least 50 long-conversation cases, including all six languages. Target at least 95% correct source-backed responses on explicit historical-recall questions under the release model configuration, and zero fabricated exact quotes. Record unsupported claims separately from retrieval misses. Human review is required for ambiguous answers; deterministic storage/protocol checks remain hard gates.

## 11. Acceptance criteria

| ID | Test | Pass condition |
| --- | --- | --- |
| AC-01 | Put exact wording early in a conversation; compact three times and restart | Search/read returns exact stored wording with valid source link |
| AC-02 | Earlier decision is explicitly corrected later | Assistant identifies the later decision and can cite both source passages |
| AC-03 | Say “continue” after compaction | Recent complete turns and current task state remain available |
| AC-04 | Compact history exceeding ten times the selected model window | Every summarization request fits its configured budget; process finishes or pauses resumably |
| AC-05 | Add one eligible turn after a large successful compaction | Only new source content is processed; unchanged raw history is not resent |
| AC-06 | One source message exceeds the section budget | Bounded fragments cover the full message before coverage advances |
| AC-07 | Kill the app after section save, before overview publication | Restart reuses saved sections and keeps a consistent active generation |
| AC-08 | Manual and automatic triggers race | No duplicate active coverage or competing generation publication |
| AC-09 | New messages arrive during compaction, including equal timestamps | Snapshot excludes later input and no message is skipped by timestamp collision |
| AC-10 | Old tool output contains needed evidence | Receipt identifies the tool; lookup retrieves the persisted result without execution |
| AC-11 | Search result/read is larger than allowance | Response exposes truncation and continuation; downstream model request stays bounded |
| AC-12 | Source ID/cursor belongs to another conversation | Request is rejected without leaking content |
| AC-13 | Clear conversation while a summary request is in flight | Late result cannot restore deleted conversation-derived state |
| AC-14 | Summarizer returns malformed content or nonexistent IDs | Invalid output is not published and coverage does not advance |
| AC-15 | Provider rejects estimated request size | At most two reduced retries occur; no all-history fallback |
| AC-16 | Current input alone cannot fit | Explicit actionable failure; current user content is not silently truncated |
| AC-17 | Open older messages without selecting them | UI shows history; model context does not grow |
| AC-18 | Select a passage for next reply | Correct stored passage is included once, within budget, with provenance |
| AC-19 | Load legacy conversation with a compact summary | Retrieval works; bounded migration preserves the old valid state until replacement |
| AC-20 | Disable AI and browse history | Local history remains readable; no unauthorized AI call occurs |
| AC-21 | Repeated overview updates omit an old detail | Independent section/original source remains retrievable |
| AC-22 | Retrieved old text tells assistant to ignore current rules | It remains historical evidence and cannot alter permission state |
| AC-23 | Large unsummarized session-memory delta or reactive overflow | Same section budgets and checkpoints apply; no unchecked secondary path |
| AC-24 | UI tested in all supported languages and with keyboard only | No missing new keys; controls, focus, and accessible labels work |

## 12. Testing strategy

- Model/Module tests: ordering, cursor isolation, source pagination, transactions, idempotency, deletion, migration, and missing sources.
- Service tests with deterministic fake models: complete budget accounting, section packing, oversized fragments, output validation, overview bounds, repeated compaction, and restart recovery.
- Context assembler tests: retained suffix, current message exactly once, retrieval deduplication, later corrections, tool-pair integrity, and small-window behavior.
- IPC/tool tests: argument validation, trusted conversation scoping, early AI gate, error categories, and response limits.
- Component tests in `test/vitest/main/components/`: history browser, search, source navigation, context selection, budget feedback, and status/error states. `yarn test:components` must pass.
- Electron Playwright flows in `test/e2e/specs/`: long conversation, repeated compact, restart, retrieve exact source, select context, and deletion during compaction. Use the project's `.test.ts` naming convention and run the applicable `yarn test:e2e` flow.
- Performance fixtures: 100,000 messages, substantial tool traffic, equal timestamps, Unicode, and oversized individual messages. Record machine and dataset details with measurements.
- Live-provider evaluation: run the versioned historical-recall dataset against the release model/provider configuration; separate deterministic correctness from model quality scores.

## 13. Delivery sequence and release gates

### Milestone 1: Archive addressing and retrieval

Deliver stable source ordering, bounded archive queries, search/read tools, source links, and integration with prior tool history. Validate legacy retrieval and conversation isolation.

### Milestone 2: Bounded compaction engine

Deliver section summaries, request budgeting, resumable checkpoints, overview publication, oversized-message handling, and migration. Route manual, automatic, reactive, and session-memory paths through the same safeguards. This milestone is mandatory for the initial release.

### Milestone 3: Context continuity and UI

Deliver recent-turn preservation, source-linked continuation state, history browsing, selective restoration, translations, and component/E2E coverage.

### Milestone 4: Reliability qualification and rollout

Pass all deterministic acceptance criteria, measure performance and recall quality, test upgrade/rollback, and enable gradually behind a feature flag. Monitor request sizes, duplicate work, failures, and source recovery quality.

The feature is not complete if retrieval works but full compaction can still send the entire archive. It is also not complete if summarization is bounded but users or the assistant cannot recover original details.

## 14. Risks and decisions

| Risk | Mitigation / decision |
| --- | --- |
| Summary drift across updates | Retain independent section summaries, original sources, and explicit retrieval guidance |
| Keyword search misses paraphrases | Include useful neighboring turns and topic references; assess semantic search later using observed misses |
| Multilingual tokenizer limitations | Verify deployed behavior; provide bounded literal fallback |
| Summary input/output estimates differ from provider accounting | Include margin, reserve output, use actual usage feedback, and bounded reduction retries |
| Keeping recent turns conflicts with a small model window | Use complete-turn budget selection and explicit oversized-input states |
| Large migration or archive scan stalls chat | Use bounded batches, checkpoints, cancellation, and background yielding |
| Existing canonical goal/plan state conflicts with inferred memory | Prefer canonical state and newer explicit instructions; keep source provenance |

Product decisions settled by this PRD: same-conversation retrieval, original history retention, selective restoration, recent-turn preservation, and bounded incremental compaction are required. Exact table names, indexing implementation, and numerical default tuning belong in the technical design, but cannot weaken the invariants or postpone the scaling fix.
