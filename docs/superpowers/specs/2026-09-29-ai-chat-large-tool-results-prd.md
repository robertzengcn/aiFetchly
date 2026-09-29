# PRD: Recoverable Large Tool Results

**Date:** 2026-09-29  
**Status:** Proposed design for review; not implemented  
**Owner:** AiFetchly AI Chat  
**Technical design:** [Recoverable large tool results](2026-09-29-ai-chat-large-tool-results-technical-design.md)  
**Primary scope:** AI Chat V2, scheduled chat, agent runtime, tool-result storage and retrieval, conversation history, and result display

## 1. Product decision

AiFetchly will preserve oversized tool output in application-managed local storage and put a bounded, structured receipt in the conversation. The receipt identifies the operation outcome, provides a useful preview, and exposes an authorized reference through which the assistant or user can read additional portions.

Individual-result limits, aggregate result budgets, and final request validation will operate together. Conversation compaction remains responsible for long-running conversation history; result preparation prevents a single tool or a batch of tools from overwhelming that system.

This is a reliability feature. It must preserve evidence of completed actions, avoid unnecessary tool re-execution, and make incomplete output explicit. It does not promise unlimited output, unlimited disk space, or complete analysis based on a preview.

## 2. Problem and evidence

The user reports repeated failures when function tools return large results. The particular production error has not been supplied or reproduced. The following observations come from source inspection of the working tree on 2026-09-29, whose HEAD was `9fc0322a`; some chat/archive files also contained unrelated uncommitted work.

| Observed behavior | Product impact |
| --- | --- |
| `AIChatQueryLoop` serializes full results, emits them, and appends them to model messages before the next request preflight | Large output reaches several resource-sensitive boundaries before being reduced |
| `shrinkLiveTurnToolPayloads` cuts older results to 400 characters and the latest to 12,000; older large arguments become `{}` | The model may lose important evidence and the replacement has no direct output reference |
| `AIChatV2Module.saveToolResultMessage` includes the result in both content and metadata | Large results are duplicated in persistence and ordinary message payloads |
| Current-turn content is retained during compaction; bounded live-tail loading can reject it | Compacting previous turns cannot reliably rescue an oversized current turn |
| `FileToolService` rejects a file over 2,000,000 bytes before applying line offset/limit | The existing reader cannot implement reliable recovery from arbitrarily large saved outputs |
| Foreground and background shell collectors cap their accumulated output | Storage added only after execution cannot recover bytes already discarded |
| The result-details component contains the full message text in a `<pre>` | A collapsed panel does not remove the payload from renderer memory or the DOM |

These are design gaps, not proof that every reported failure has the same cause. Implementation must capture enough size and failure-stage telemetry to distinguish context rejection, transport rejection, serialization failure, storage failure, and renderer pressure.

## 3. Users and desired outcomes

| User | Scenario | Desired outcome |
| --- | --- | --- |
| Marketing operator | A scraper returns thousands of businesses, contacts, or long website descriptions | The assistant continues, can inspect later records, and does not rerun the scrape merely because the output was large |
| Email operator | A mailbox, campaign, or email-body tool returns a large payload | IDs, delivery status, and counts remain visible; bodies are retrieved selectively |
| Developer or power user | A command or MCP tool returns a long log or JSON document | The assistant can find an error near the end without injecting the whole log into context |
| Scheduled workflow owner | An unattended run processes several large tool responses | Budget handling and retrieval work without permission-dialog deadlocks |
| Returning user | A conversation is reopened after restart or compaction | Saved references still resolve, and reopening does not reload all raw output |

### Example journey

1. The user requests a business search.
2. The tool completes and returns a 10 MiB JSON result.
3. AiFetchly saves the complete supported output and displays a small result card with its actual completion state and size.
4. The assistant receives counts, selected complete records, and an output reference.
5. The assistant searches the saved output for the relevant business and reads the matching portion.
6. The assistant answers using that evidence. It does not claim that the preview represents a review of all records.
7. After restart, the user can reopen the result and export the preserved output.

## 4. Goals, non-goals, and release boundaries

### 4.1 Goals

- Preserve complete supported tool output within documented capture and storage limits.
- Keep ordinary model messages, database metadata, and renderer events bounded.
- Provide selective, exact retrieval with deterministic continuation.
- Preserve operation status, tool-call pairing, permission state, and side-effect receipts.
- Apply consistent handling to every supported result-delivery path.
- Keep saved results accessible across compaction, restart, and model changes.
- Make quota limits, upstream truncation, and unavailable output understandable.

### 4.2 Non-goals

- Replacing the conversation archive or incremental-compaction subsystem.
- Replacing all file tools, changing workspace trust, or granting broad filesystem access.
- Using an AI summary as the only surviving copy of a tool result.
- Automatically uploading full outputs to a remote server.
- Building a general data warehouse, arbitrary JSON query engine, or semantic-search service.
- Guaranteeing that an unmodified third-party MCP transport never allocates a large response in memory.
- Rewriting historical tool arguments or deleting historical source messages to save context.
- Automatically executing shell commands to analyze saved output.

### 4.3 Release boundaries

The first complete V2 release includes storage, read/search tools, aggregate budgeting, all V2 execution paths, saved-history handling, and a paged result viewer. Delivering references without working retrieval is not a complete release.

Foreground and background shell capture form a separately testable producer upgrade, required before claiming that shell output is fully preserved. Other producers must advertise whether the captured result was already incomplete.

Legacy hosted chat uses the same bounded preparation and UI representation. Model retrieval through its remote continuation endpoint requires a compatibility test demonstrating that the server routes both new client tools back to the desktop. Until verified, legacy output is explicitly marked as limited for the model; the user may still inspect its local saved copy. Do not advertise V2-equivalent recoverability for that lane.

## 5. Product principles

1. **Execution and preservation are separate outcomes.** An email may have been sent successfully even if saving its response fails.
2. **A preview is visibly partial.** Do not imply complete coverage from a small sample.
3. **A reference is a promise only after storage succeeds.** Never claim that a file was saved before durable publication.
4. **Retrieval must fit too.** Reading a result must not create an endless save/read/save loop.
5. **Existing evidence remains evidence.** Compaction, projection, and migration do not fabricate or silently rewrite the original operation.
6. **Access stays scoped.** Knowing an output ID does not authorize access to another user's or agent's data.
7. **Reduction happens before distribution.** Hiding a large result in the UI does not solve payload size.

## 6. Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-01 | Prepare all completed, failed, partial, cancelled, blocked, and permission-deferred results before ordinary persistence, model dispatch, or renderer publication | P0 |
| FR-02 | Externalize results that exceed either the serialized-byte limit or the available model-output allocation | P0 |
| FR-03 | Preserve the full supported text/JSON representation within capture limits; keep checksum, size, format, producer completeness, and storage status | P0 |
| FR-04 | Preserve original operation outcome and bounded control fields independently of storage success; never automatically repeat a side-effecting tool because storage failed | P0 |
| FR-05 | Return a useful deterministic preview and stable output reference, with no raw filesystem path required by the model | P0 |
| FR-06 | Supply bounded `tool_result_read` and `tool_result_search` tools that are available whenever model-visible references are present | P0 |
| FR-07 | Support retrieval after restart, permission resume, compaction, and model fallback without re-executing the original tool | P0 |
| FR-08 | Enforce a combined tool-result budget and a complete-request budget before every provider request, including scheduled and subagent requests | P0 |
| FR-09 | Persist bounded receipt metadata for newly externalized results; do not duplicate raw output in message content, metadata, stream events, or debug logs | P0 |
| FR-10 | Show a result preview with size, operation outcome, and preservation state; load full-result details in bounded pages | P0 |
| FR-11 | Allow user-initiated export of preserved output through a validated save flow without reading the whole file into the renderer | P1 |
| FR-12 | Integrate references with conversation archive receipts, history reads, and summaries; distinguish original stored evidence from derived summaries | P0 |
| FR-13 | Apply conversation/account deletion and epoch invalidation to outputs, cursors, active readers, and in-flight writers | P0 |
| FR-14 | Handle disk-full, quota, serialization, corruption, missing-file, and unsupported-format failures with bounded truthful receipts | P0 |
| FR-15 | Preserve existing image-artifact behavior; externalize large text alongside images without placing base64 binaries into previews | P0 |
| FR-16 | Stream foreground/background shell output into bounded local capture and preserve capture completeness explicitly | P1 |
| FR-17 | Adapt existing conversations through bounded projections without destructively rewriting their original message source | P0 |
| FR-18 | Apply current AI-enable, permission, workspace, scheduling, and agent-isolation rules; retrieval must not grant new capabilities | P0 |
| FR-19 | Add translated UI text for English, Chinese, Spanish, French, German, and Japanese, with component and critical-flow tests | P0 |
| FR-20 | Record size, latency, budget, and failure-stage metrics without tool content or sensitive identifiers in general logs | P0 |

## 7. Result semantics and user experience

### 7.1 Result card

The existing tool card retains the tool name and operation status. Externalized output adds:

- “Full output saved” or a precise partial/unavailable state.
- Captured output size and, when known, record count.
- A bounded preview labeled as a preview.
- “View full result”; “Export result” when available.
- A notice when the producer truncated output before AiFetchly received it.

Do not show a storage failure as “tool execution failed” when execution succeeded. An example is: “The command completed. Its full output could not be saved; only this preview is available.” A partial capture must not use “Full output saved.”

### 7.2 Result viewer

The viewer loads an initial page only when opened. It supports next/previous visited pages, literal search, loading/error states, and copying the currently displayed portion. Export is the explicit way to obtain the saved whole. No hidden component should retain all pages indefinitely.

Text and JSON are rendered as escaped text. HTML output is not executed. Keyboard focus, screen-reader labels, status announcements, and long unbroken lines must be handled. The viewer remains usable while an agent is running.

### 7.3 Assistant behavior

The model receives an instruction that the receipt is incomplete, explains read/search, and preserves relevant totals and identifiers. It should retrieve the portions necessary for the task. Exhaustive review requires evidence of complete traversal or a separate approved processing tool; the model must qualify conclusions if retrieval stops early.

For large structured datasets, complete-record samples and useful field names are preferred to a raw prefix of minified JSON. For shell logs, bounded beginning/end previews may be used. Preview construction is deterministic and does not require an additional AI request.

### 7.4 Search completeness

A search can stop because it found enough matches or reached a scan/time budget. It must return whether it scanned the entire captured output and a continuation cursor when it did not. “No matches in this page” is not “No matches in the output.” An incomplete original capture cannot establish absence from the original producer output, even after all captured bytes are scanned.

## 8. Default operating limits

These are proposed initial engineering defaults, not measured provider guarantees. The technical design defines units, adaptive allocation, and failure behavior.

| Setting | Proposed default | Product meaning |
| --- | --- | --- |
| Inline text/JSON | At most 16 KiB and 2,000 allocated tokens, reduced for the selected context | Larger output becomes a saved result |
| Stored-result preview | At most 2 KiB and 512 tokens, reduced to fit the receipt | The preview stays small |
| Retrieval page | At most 8 KiB and 2,000 tokens including its envelope | One read/search remains bounded |
| Combined model result allocation | At most 25% of usable input capacity and the actual remaining capacity | Many medium results cannot bypass individual limits |
| Capture size | 64 MiB per output stream/artifact | Excess is explicitly incomplete; the result remains bounded |
| Conversation/profile quotas | 1 GiB / 5 GiB including sidecars and reserved writes | Storage growth is finite |
| UI page | 32 KiB maximum serialized response | Viewing does not load the whole result |
| Retrieval work per assistant turn | 32 calls or 32,000 returned tokens, whichever is reached first | Runaway retrieval is bounded and reported |
| Temporary/orphan grace | 24 hours, excluding active leases | Crash residue can be reclaimed safely |

KiB and MiB mean powers of 1,024. The token limits use a common budget service and are not derived by assuming all languages have four characters per token. The retrieval-work allowance is cumulative work, not permission to retain 32,000 tokens simultaneously in context.

Referenced committed output has no automatic age-based expiry in the first release. Conversation deletion, explicit deletion, or quota refusal controls its lifecycle. Do not silently evict referenced evidence to accommodate new writes.

## 9. Nonfunctional requirements and measurement

| ID | Requirement / proposed release target |
| --- | --- |
| NFR-01 | For an eligible 10 MiB result, model and ordinary renderer payload size is bounded by configured receipt limits, independent of raw output size |
| NFR-02 | A 64 MiB paged read/search does not allocate a complete copy of the artifact; buffers and decoded windows have explicit bounds |
| NFR-03 | Additional resident memory for one streamed 64 MiB capture/read stays below 16 MiB on the documented test host; pre-existing materialized producer objects are measured separately |
| NFR-04 | On a documented local-SSD test host, first-page read p95 is at most 200 ms after warmup; capture/serialization p95 and cancellation latency are recorded for 1/10/64 MiB fixtures |
| NFR-05 | Main-process storage/search work yields regularly; targeted operation produces no single event-loop stall over 50 ms in the benchmark fixture |
| NFR-06 | Checksums and page concatenation demonstrate exact recovery of supported complete fixtures, including CJK, emoji, and long lines |
| NFR-07 | Repeated processing of the same execution result creates one published artifact identity and one terminal receipt |
| NFR-08 | Opening/closing the viewer repeatedly does not retain unbounded page data; keyboard interactions remain responsive |
| NFR-09 | Storage or request-budget recovery never repeats a recorded successful side-effecting tool |

Timing and memory numbers are acceptance targets that require measurement. If a target is not met, report the measured result and revise the design or explicitly revise the target before release; do not claim compliance from code inspection.

## 10. Acceptance criteria

| ID | Scenario | Required outcome |
| --- | --- | --- |
| AC-01 | A small result below both limits | Existing semantics remain intact; no unnecessary output artifact |
| AC-02 | A 10 MiB supported JSON result | Complete artifact saved; model/history/UI receive a receipt; a later record can be retrieved |
| AC-03 | Twenty individually acceptable results exceed the combined allocation | Larger inline results become references; final request passes budget or returns an explicit remaining-capacity error |
| AC-04 | A fact exists beyond the preview | The assistant retrieves it and answers without rerunning the producer |
| AC-05 | A large minified JSON document has one line | Bounded retrieval advances by cursor without oversized pages or a line-based dead end |
| AC-06 | CJK text and emoji cross page boundaries | No broken characters, dropped bytes, or repeated text when pages are assembled |
| AC-07 | A saved result is reopened after application restart | Its identity and captured content remain available |
| AC-08 | Context is compacted or a smaller model is selected | References survive; pages and receipts are re-budgeted before dispatch |
| AC-09 | Execution completes after a permission grant | The resumed result uses exactly the same preparation/storage policy |
| AC-10 | Scheduled and child-agent execution produces large output | No interactive retrieval permission prompt; scope and budget checks remain effective |
| AC-11 | Another conversation or sibling agent submits an output ID/cursor | Access is rejected without exposing its existence or content |
| AC-12 | Disk is full or a quota is reached after the tool succeeds | Receipt distinguishes execution success from unavailable/partial preservation; no automatic tool retry |
| AC-13 | Process crashes during writing or publication | No unreadable output is presented as complete; restart reconciles staged/orphan state |
| AC-14 | Conversation is cleared while capture is active | Epoch fence prevents publication or later retrieval of deleted output |
| AC-15 | A producer reports its own truncation | Stored output may be complete as received, but original completeness is explicitly false/unknown |
| AC-16 | Reader/search output reaches its budget | It returns a continuation/reason and is never externalized into a recursive reference |
| AC-17 | Search stops before EOF without a match | `scan_complete` is false and continuation is usable |
| AC-18 | Retrieval reaches its per-turn work allowance | The assistant gets a bounded limit result; it does not claim exhaustive analysis |
| AC-19 | Existing large history is reopened | Bounded projections are loaded without rewriting original source or fetching raw metadata into the UI |
| AC-20 | A result includes large text and image artifacts | Text is bounded; the existing image handoff and image accounting remain correct |
| AC-21 | Legacy server cannot route the retrieval tools | Model limitation is explicit; no misleading model-retrievable reference is emitted |
| AC-22 | User opens, searches, copies a page, and exports output | Each interaction works without transferring the whole artifact through the renderer |
| AC-23 | UI language changes among all six supported languages | New states/actions have translations and accessible labels |
| AC-24 | Shell emits more than its former memory cap | Upgraded capture preserves bytes through the artifact cap, including before background handoff |
| AC-25 | A completed tool or result event is delivered twice | Stable execution identity deduplicates storage and terminal publication |
| AC-26 | Provider rejects a request despite estimated fit | At most one size-reduction retry of the model request occurs; executed tools are not rerun |
| AC-27 | Writer flag is disabled after results were stored | Existing results remain readable; bounded fallback remains active for new large output |

## 11. Delivery sequence

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| 1 | Typed receipts, artifact registry/storage, read/search contracts, quota and crash reconciliation | Storage/retrieval/isolation tests pass; no production references emitted yet |
| 2 | Shared result preparation, V2 normal/resume/async/agent/scheduled wiring, aggregate budget | AC-01–18, AC-20, AC-25–26 pass on local integration fixtures |
| 3 | Archive/history projections, paged UI, translations, deletion and export | Restart/history/UI acceptance criteria pass; complete V2 rollout may begin |
| 4 | Foreground/background shell spooling and other high-volume producer adapters | Capture completeness is verified for each upgraded producer |
| 5 | Legacy hosted continuation certification and broader rollout | Server-side client-tool routing verified; lane-specific limitations documented |

Phases are implementation sequencing, not permission to claim the full feature early. Export is P1 and may follow initial V2 release if the release notes explicitly identify that omission.

## 12. Metrics, rollout, and rollback

Track externalized-result count, original/captured bytes, receipt bytes, per-round tool-result allocation, budget rejections by stage, read/search usage, incomplete captures, unavailable outputs, storage latency, reader latency, and prevented duplicate publication. Record producer type and model-limit provenance without raw arguments, output, paths, addresses, or credentials in general logs.

Begin with deterministic fixtures and developer enablement, then a limited V2 rollout. Compare failures per large-result turn with the measured pre-feature baseline. No baseline reduction percentage is asserted before that baseline exists.

Separate write and read compatibility. Disabling new capture must not disable reading already committed output. If an environment cannot preserve or retrieve a large result, return a bounded truthful fallback; never revert to sending the full result unconditionally.

## 13. Risks and decisions

| Risk | Decision |
| --- | --- |
| The model repeatedly reads irrelevant pages | Bounded search, useful previews, cumulative work allowance, and clear continuation guidance |
| Saved output is treated as executable instructions | Treat previews and pages as untrusted tool data; preserve existing permission checks |
| References disappear during compaction | Include identity and outcome in receipts; maintain durable authorized references outside summary prose |
| Storage failure leads to duplicate external actions | Track execution outcome separately; retry publication/model continuation only |
| Token heuristics underestimate a language or payload | Use shared model-aware accounting and a conservative fallback; retain final request and transport limits |
| Existing archive sources are invalidated by migration | Keep original source immutable; use a separate bounded projection |
| Legacy server support is assumed | Make server routing certification an explicit lane-specific gate |
| An upstream library allocates excessive memory before preparation | Capture at the producer boundary when supported; document the remaining transport limit |

The exact production failure signature, measured performance baseline, and legacy-server routing support remain validation inputs. The defaults and implementation choices above are concrete proposals so implementation planning can proceed without unspecified core contracts.

## 14. References

- [Technical design](2026-09-29-ai-chat-large-tool-results-technical-design.md)
- [Recoverable history PRD](../../prd/ai-chat-recoverable-history-incremental-compaction-prd.md)
- [Recoverable history technical design](../../prd/ai-chat-recoverable-history-incremental-compaction-technical-design.md)
- [Tool catalog technical design](../../prd/ai-tool-list-management-technical-design.md)
- User-supplied reference snapshot: `/Users/cengjianze/project/github/claude-code/docs/large-tool-result-handling.md`. Used for the persistence/preview/retrieval pattern, not as an assertion about every Claude Code release. Its introductory no-truncation statement is qualified by its later producer caps and fallback truncation paths.
