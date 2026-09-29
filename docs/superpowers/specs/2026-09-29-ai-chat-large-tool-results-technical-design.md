# Technical Design: Recoverable Large Tool Results

**Date:** 2026-09-29  
**Status:** Proposed design for review; no feature implementation is claimed  
**PRD:** [Recoverable large tool results](2026-09-29-ai-chat-large-tool-results-prd.md)  
**Scope:** Local tool-output capture, result preparation, provider budgeting, scoped retrieval, history, and renderer integration

## 1. Decisions and invariants

1. Store oversized output once in application-managed files; keep a TypeORM registry and bounded receipts in conversation messages.
2. Prepare results before ordinary message persistence, renderer events, and model continuation. Do not make the event sink responsible for asynchronous externalization after an event has already escaped.
3. Keep operation outcome, producer completeness, capture preservation, and preview completeness as independent facts.
4. Make `tool_result_read` and `tool_result_search` built-in scoped tools with bounded outputs. They never recursively externalize their own output.
5. Enforce both serialized-byte and token budgets. Allocate tool-result space from the selected model's actual usable input capacity, then validate the final request.
6. Preserve assistant tool-call IDs, result pairing, exact original arguments, and execution identity. Context reduction must not replace executed arguments with fabricated `{}`.
7. Use the same services for normal V2, permission resume, scheduled turns, child-agent results, and legacy client-side execution. Certify legacy remote retrieval separately.
8. New large results contain no raw bulk output in message metadata. Existing historical source is immutable; migration adds bounded derived projections.
9. Every output access validates active profile, owner conversation/agent, conversation epoch, artifact state, and any explicit delegation grant. IDs are not authorization.
10. Full-output preservation is conditional on producer and storage caps. On failure, publish a bounded truthful receipt, not an oversized fallback or a false success.

## 2. Source baseline and integration map

The baseline is source inspection on 2026-09-29 at HEAD `9fc0322a`, including the working tree's existing chat/archive changes. Findings are not runtime reproductions. Recheck integration symbols against the implementation branch before editing; line numbers are intentionally not used as contracts.

| Existing file / symbol | Current responsibility or gap | Design integration |
| --- | --- | --- |
| `src/service/AIChatQueryLoop.ts`: `normalizeToolResult`, result emission, preflight | Full payload normalization/emission; late lossy fallback | Await preparation; use model projection; run aggregate budget every round |
| `src/service/AIChatQueryEngine.ts`: permission resume, persisting sink | Separate result serialization on resume; event saves are queued and errors logged | Shared publisher on resume; await terminal receipt publication before model continuation |
| `src/service/AIChatQueryEvents.ts` | Carries `fullContent` plus `toolResult` | Bounded compatible payload plus versioned output descriptor |
| `src/modules/AIChatV2Module.ts`: `saveToolResultMessage` | Raw result in content and metadata | Store receipt once as content and bounded control/display metadata |
| `src/service/StreamEventProcessor.ts` | Legacy local execution, permission resume, retries, remote results | Same preparation boundary and bounded compatibility adapter |
| `src/service/ToolExecutionService.ts` | Legacy result persistence | Persist bounded receipt; no independent full-result serialization |
| `src/api/aiChatApi.ts`: `streamContinueWithToolResults` | Sends legacy results to remote continuation | Send bounded provider projection; advertise retrieval only after capability certification |
| `src/service/AgentRuntime.ts`, `src/service/AgentTranscriptService.ts` | Agent execution, summaries, isolated loop | Trusted agent scope; bounded summaries; explicit parent export grants |
| `src/service/MCPToolService.ts`: `executeMCPTool` | Returns received MCP result without a general result-size policy | Normalize blocks; route output through common preparation; add supported ingress caps |
| `src/service/ShellToolService.ts`, `src/service/BackgroundShellRegistry.ts` | Output buffered and capped independently | Shared streaming capture handle across foreground/background handoff |
| `src/service/FileToolService.ts`: `executeFileRead` | Reads whole file; rejects above 2 MB before paging; long first line can exceed output cap | Do not depend on it for artifact retrieval; bound its model result or return a scoped source descriptor |
| `src/service/AIChatRequestBudgetService.ts` | Preflight based partly on UTF-8 bytes divided by four | Reuse limit resolution; introduce common counting contract and serialized-body cap |
| `src/service/AIChatContextAssembler.ts` | Live tail retained and rejected if bounded reads incomplete | Resolve receipt projections before sizing/loading live tail |
| `src/service/AIChatSectionPacker.ts`, archive services/models | History references, exact source reads, compaction coverage | Compact bounded receipts; keep artifact references; make legacy source reads actually bounded |
| `src/config/skillsRegistry.ts`, `src/service/ToolLoadPolicyService.ts` | Tool registration and deferred catalog | Register retrieval tools as core helpers while references may be emitted |
| `src/service/PlanModeToolPolicy.ts`, `src/service/AgentToolPolicyService.ts` | Mode and agent restrictions | Treat retrieval as scoped read-only; retain owner/grant checks |
| `src/views/components/aiChatV2/AiChatV2Message.vue` | Renders full result text in details | Show receipt and open paged viewer |
| `src/config/SqliteDb.ts` | Entity registry; `synchronize: true`, empty migration list | Register additive entities and a versioned data-bootstrap marker |

The old `shrinkLiveTurnToolPayloads` implementation is retired from the new path. Its broad string slicing and argument replacement are not acceptable substitutes for preservation. Large argument/history pressure that remains after result preparation still requires a truthful budget failure or legitimate whole-turn compaction.

## 3. Architecture and responsibilities

```mermaid
flowchart TD
    Tool[Tool execution or producer stream] --> Prepare[ToolResultPreparationService]
    Prepare --> Store[ToolResultStorageService]
    Store --> Files[Private output files]
    Store --> Module[ToolResultModule]
    Module --> Model[TypeORM Models]
    Model --> DB[(Existing user SQLite database)]
    Prepare --> Publish[ToolResultPublisher]
    Publish --> Messages[Bounded persisted receipt]
    Publish --> UI[Bounded renderer event]
    Publish --> Budget[ToolResultBudgetService]
    Budget --> Preflight[Complete request preflight]
    Preflight --> Provider[Existing provider adapter]
    Provider --> Retrieve[Read and search tools]
    Viewer[Paged result viewer] --> IPC[Validated IPC]
    IPC --> Retrieve
    Retrieve --> Module
    Retrieve --> Files
```

| Proposed component | Responsibility |
| --- | --- |
| `ToolResultPreparationService` | Normalize supported result data, preserve control fields, build preview, select inline/external representation, handle preparation failures |
| `ToolResultStorageService` | Bounded serialization/spooling, atomic publication, checksums, private paths, cleanup; no direct repository access |
| `ToolResultModule` | Ownership, epochs, quotas, state transitions, publication and projection coordination through Models |
| `ToolResultModel` | Artifact rows, quota reservations, durable access grants, keyset lists and conditional updates |
| `ToolResultProjectionModel` | Versioned bounded projections over existing source message rows |
| `ToolResultPublisher` | Idempotent terminal receipt persistence and renderer delivery; used by all execution adapters |
| `ToolResultBudgetService` | Model projections, aggregate reduction, read-page allocation, token/byte accounting |
| `ToolResultRetrievalService` | Authorized incremental read/search, cursor validation, retrieval-work accounting |
| `ToolResultRecoveryService` | Reconcile interrupted writes, publish-pending records, tombstones and orphan files |
| `ToolResultPreviewService` | Deterministic bounded text/JSON/log previews; no provider calls |

Database code stays in Models/Modules and uses the existing `Token`/`USERSDBPATH` resolution through `BaseDb`/`BaseModule`. IPC handlers validate and call services/modules; they do not query repositories. File-root resolution is separate from database-path resolution.

No new worker is necessary for the initial design. Incremental file I/O and yielding serialization/search run in main-process services. If performance measurements require a parsing worker, its entry point and worker-only code belong under `src/childprocess/`; it receives bounded chunks and never accesses the database.

## 4. Representation and contracts

### 4.1 Terminology

| Term | Meaning |
| --- | --- |
| Source result | Supported data supplied by a producer after existing normalization/redaction rules |
| Captured output | Bytes successfully saved; may be all or a prefix of the source result |
| Receipt | Bounded immutable description of operation outcome, preserved output, and retrieval options |
| Model projection | Budget-adjusted representation of an inline result or receipt for one provider request |
| UI projection | Bounded display/control metadata, with no bulk source data |
| Execution ID | Trusted identity of one actual attempt; different from a permission placeholder or model-generated call ID |
| Conversation epoch | Durable generation invalidated when a conversation is cleared/deleted |

For supported JSON, “exact” means preservation of the normalized JSON data serialized with the documented encoder, not original upstream whitespace or object identity. For text/log streams, exact retrieval preserves captured UTF-8 bytes. Bytes lost upstream cannot be recovered and must not be represented as captured.

### 4.2 Internal TypeScript contracts

These are proposed interfaces, not existing exports. Implementations use explicit return types, `unknown` for untrusted data, and schema validation at boundaries.

```typescript
export type ToolOperationStatus =
  | "success" | "error" | "partial" | "cancelled"
  | "blocked" | "pending" | "permission_required" | "unknown";

export type SourceCompleteness = "complete" | "partial" | "unknown";
export type OutputPreservation = "complete" | "partial" | "unavailable";

export interface TrustedToolOutputContext {
  readonly profileId: string;
  readonly conversationId: string;
  readonly conversationEpoch: string;
  readonly turnId: string;
  readonly executionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly ownerAgentId?: string;
  readonly signal: AbortSignal;
}

export interface StoredToolOutputRef {
  readonly outputId: string;
  readonly revision: number;
  readonly format: "text" | "json" | "jsonl" | "binary";
  readonly mediaType: string;
  readonly capturedBytes: number;
  readonly originalBytes?: number;
  readonly sha256: string;
  readonly preservation: "complete" | "partial";
  readonly sourceCompleteness: SourceCompleteness;
  readonly incompleteReason?: string;
}

export interface ToolResultReceipt {
  readonly schemaVersion: 1;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly operationStatus: ToolOperationStatus;
  readonly success: boolean;
  readonly executionTimeMs: number;
  readonly summary?: string;
  readonly control: Readonly<Record<string, unknown>>;
  readonly outputs: readonly StoredToolOutputRef[];
  readonly preview: string;
  readonly previewComplete: boolean;
  readonly storageErrorCode?: string;
}

export interface PreparedToolResult {
  readonly receipt?: ToolResultReceipt;
  readonly canonicalMessageContent: string;
  readonly modelContent: string;
  readonly uiMetadata: Readonly<Record<string, unknown>>;
  readonly serializedBytes: number;
  readonly accountedTokens: number;
}

export interface ToolResultOutputPolicy {
  readonly maxInlineBytes: number;
  readonly maxInlineTokens: number;
  readonly previewKind: "text" | "records" | "head_tail";
  readonly delivery: "normal" | "bounded_reader" | "source_reference";
}
```

`control` is not an unchecked copy of the result. Each adapter supplies a validated bounded schema. Examples include `needsPermissionPrompt`, permission category/preview, `executionPending`, `job_id`, `shell_id`, exit code, batch IDs/statuses, retryability, totals, pagination cursors, and partial-result counts. Strings, arrays, and nested fields each have limits, and the whole control object is accounted in the envelope. If essential control data cannot fit, return an explicit bounded preparation error rather than silently omitting a permission or outcome field.

Outer trusted execution status is authoritative; spreading producer properties after `success` must not allow a producer's nested `success` key to overwrite it. Preserve top-level partial/count/timeout fields from `ToolExecutionResult`, which are not all retained by the existing normalizer.

`modelArtifacts` stays on its existing transient channel. It is not serialized into a receipt, output text, metadata, or logs. Persist only existing safe image descriptors where appropriate. Text size rules do not grant images a budget bypass.

### 4.3 Example model-facing result

```json
{
  "schema_version": 1,
  "success": true,
  "operation_status": "success",
  "summary": "Search returned 2400 businesses.",
  "total": 2400,
  "output": {
    "output_id": "out_7e21d8f4_example",
    "format": "json",
    "captured_bytes": 10485760,
    "preservation": "complete",
    "source_completeness": "complete"
  },
  "preview": "Sample records and available field names...",
  "preview_complete": false,
  "read_tool": "tool_result_read",
  "search_tool": "tool_result_search"
}
```

IDs above are illustrative. Real IDs use cryptographically random UUIDs or equivalent entropy and contain no raw user, tool, or filesystem names. The instruction to use the reader lives in the trusted tool/prompt contract; producer text is never promoted to a system instruction.

Small results can preserve their existing wire shape. New typed metadata differentiates inline data from receipts; do not detect externalization by searching text for tags. Empty results receive a small explicit empty-output representation without inventing an error. Nonempty error results follow the same preservation policy as successful results.

## 5. Storage data model and lifecycle

### 5.1 Additive TypeORM records

| Record | Required fields / indexes |
| --- | --- |
| `ai_tool_outputs` | `outputId` primary key; profile, conversation, epoch, owner agent, turn, execution, tool-call ID, tool name; stream key; revision; state; format/media type; relative storage key; captured/original bytes; SHA-256; source completeness; preservation; bounded failure code; policy version; lease/fence; timestamps |
| `ai_tool_output_reservations` | Reservation ID, profile/conversation/epoch, execution ID, reserved/used bytes, lease expiry, fence; indexes for profile and conversation accounting |
| `ai_tool_output_grants` | Output ID, grantee conversation/epoch/agent, grant reason, revocation time; unique owner-approved grant key |
| `ai_tool_result_projections` | Profile/conversation/epoch, source row ID, source revision/hash, policy version, bounded content/metadata, output references; unique source identity and policy version |
| Versioned bootstrap marker | Schema/data-bootstrap version and last bounded legacy backfill position; resume after interruption |

Unique artifact identity is `(profile, conversation, epoch, executionId, streamKey)`. A tool call producing text plus stderr can have multiple bounded descriptors. Cap descriptors per receipt at 8; excess attachments belong to an indexed manifest artifact. Same identity plus same source hash is idempotent. Same identity plus different bytes is a conflict, not permission to overwrite committed evidence.

Capture the result's execution ID before tool execution and carry it through async jobs/resume. A permission placeholder has a different phase and cannot consume the terminal result's artifact key. A deliberate new tool execution gets a new execution ID even if a caller reused a tool-call ID.

### 5.2 Paths and ownership

Use a private app-managed root, resolved in the main process and injected for tests:

```text
<app-managed-root>/tool-results/<profile-key>/<conversation-epoch>/<output-id>/
    payload.txt | payload.json | payload.jsonl | payload.bin
    manifest.json
    optional bounded-index sidecar
```

All path segments are generated internally. Never interpolate producer names, model arguments, raw conversation titles, or requested filenames into storage paths. Model/UI access uses IDs. Resolve paths under the fixed root, reject traversal/symlink escape, and open regular files only. Use restrictive permissions supported by the platform; this design does not claim encrypted-at-rest storage.

The manifest contains only versioned bounded metadata and integrity information. It is not an alternate copy of the full payload. File storage and quotas are separate from the `USERSDBPATH` database location; changing profiles must select the corresponding root and registry scope.

### 5.3 State transitions

```mermaid
stateDiagram-v2
    [*] --> writing: reserve quota and claim execution
    writing --> staged: close and sync temporary files
    staged --> committed: atomic rename and registry commit
    writing --> failed: capture or serialization failure
    staged --> failed: publication failure
    committed --> unavailable: file missing or integrity failure
    committed --> deleting: epoch invalidated or explicit deletion
    unavailable --> deleting
    failed --> deleting
    deleting --> deleted: unlink and release quota
```

`committed` does not mean original output was complete: preservation and source completeness are separate fields. A valid partial prefix may be committed with `preservation: partial`. The registry is authoritative for authorization and publication; a file merely existing does not make it readable through the tools.

Publication protocol:

1. Validate trusted scope and epoch; create a conditional writing claim and reserve quota through the Module.
2. Write a temporary payload with bounded buffers while computing byte counts and a streaming checksum. Write a bounded manifest.
3. Flush/close and sync files; sync the containing directory where supported. Promote by atomic rename within the same filesystem.
4. Commit artifact registry state with the expected epoch, lease fence, checksum, and sizes. Reject stale writers.
5. Persist the bounded terminal receipt and its artifact references before model continuation. Make terminal receipt writes idempotent by execution/phase identity.
6. Emit the renderer result and append the model projection. If delivery fails, retry delivery using the saved receipt, never execution.

Filesystem operations and SQLite transactions are not one atomic transaction. The protocol explicitly tolerates a file promoted before its DB commit or a committed artifact whose message publication is pending. Record publication status or an equivalent durable outbox field; startup reconciliation completes safe publication or marks the result unavailable. Do not mark a terminal tool result saved merely because its save Promise was queued.

### 5.4 Quotas and cleanup

- Default cap: 64 MiB per artifact/stream; 1 GiB per conversation; 5 GiB per profile. Account for payloads, sidecars, temporary files, and outstanding reservations.
- Reserve in bounded increments, initially 1 MiB for unknown-length streams; grow atomically before writes. Known sizes can reserve once. Failed writes release unused reservations.
- Keep a default free-disk reserve of 128 MiB. Refuse further preservation when quota or free-space checks fail; handle actual write failures even after a successful check.
- Limit concurrent heavy captures to 2 per profile. Apply backpressure to streams; do not build an unbounded memory queue of producer chunks.
- Reclaim abandoned temporary files and unreferenced unpublished artifacts only after a 24-hour grace period and an expired lease. Keep active leases protected.
- Do not automatically evict committed referenced output by age or least-recently-used policy in v1. Refuse new preservation when required.
- Clear/delete/profile removal invalidates the relevant epoch first, revokes grants, cancels readers/writers, then schedules idempotent file deletion. All late commits compare the epoch fence. Bulk-clear paths receive the same treatment.

## 6. Serialization, previews, and producer limits

### 6.1 Materialized results

Do not stringify an arbitrary large object repeatedly to discover whether it is too large. A yielding JSON walker streams one normalized representation to a sink that initially holds at most the inline-byte allowance and spills to a temporary file when necessary. It updates checksum and counters once. Release source-object references as early as the caller permits.

Support ordinary JSON primitives, plain records, and arrays. Use documented JSON semantics for missing/undefined object properties; reject cycles, BigInt, unsupported prototypes/accessors, invalid text encoding, and excessive nesting with typed serialization errors. Do not invoke arbitrary producer getters or `toJSON` methods as part of preview generation. Default traversal depth is 128; bound node work and yield after at most 64 KiB emitted or 10 ms elapsed, whichever occurs first.

This bounds additional serialization buffers, not the memory of an already allocated producer object. MCP transports and HTTP clients need their own receive-size limits. For adapters that support an ingress byte cap, start with 64 MiB and reject before constructing larger objects. An SDK without such a hook is an explicit coverage limitation and cannot claim bounded ingress memory.

If the artifact cap interrupts JSON serialization, do not label an invalid JSON prefix as valid JSON. Store a UTF-8 text fragment with `preservation: partial`, original media type metadata, and `ARTIFACT_LIMIT_REACHED`. Alternatively, for an upgraded record producer, write complete JSONL records and mark the record set partial.

### 6.2 Preview construction

- Text: a UTF-8-safe prefix, preferably ending at a newline when this fits.
- Logs: bounded head and tail with explicit omitted-region markers; no claim of continuity.
- Known record tools: counts, field names, and a bounded sample of complete records. Source order is preserved.
- Unknown JSON: top-level keys plus bounded primitive values/complete sampled items; never emit malformed JSON as a structured envelope.
- Errors: preserve the error code and concise message; full stack/log details become output when available.
- Images/binary: use existing supported artifact descriptors and media handling; no base64 payloads in text previews. Reader returns an unsupported-text response for binary output; user export remains possible.

Do not perform AI summarization before the result is safe to send. A producer-provided summary is also untrusted data and subject to byte/token limits.

### 6.3 Foreground/background shell capture

Create capture handles for stdout and stderr at process spawn, before any output is collected. Decode UTF-8 with an incremental decoder; keep a small head/tail ring for display. Pipe raw supported bytes into the same handles for the entire process lifetime.

When a command becomes a background job, transfer ownership of the handles and counters to `BackgroundShellRegistry`; do not start a second collector that loses or duplicates the foreground prefix. Polling returns a bounded status/preview and a stable execution identity. Only sealed output gets an immutable artifact revision; growing live-output cursors are deferred from v1.

At cap/quota failure, stop saving additional bytes, continue draining pipes to prevent child-process deadlock, and mark preservation partial. Do not kill or repeat a side-effecting process solely because output storage reached its cap. Existing cancellation and timeout policy still controls process termination.

### 6.4 Existing file and resource readers

The dedicated artifact reader does not call `FileToolService.executeFileRead`. Ordinary `file_read` must still produce bounded output: use its existing authorized source plus continuation information or externalize the returned text once. Do not grant all filesystem reads an `Infinity` exemption; the current reader is not guaranteed to self-bound a single oversized line.

Only trusted built-in retrieval implementations with verified byte/token ceilings receive `delivery: bounded_reader`. Third-party tools cannot declare themselves exempt from policy. Large resource URLs or binary blocks must preserve existing permissions and must not trigger automatic remote downloads merely to build a preview.

## 7. Model and transport budgets

### 7.1 Common accounting contract

Use one counting adapter for result preparation, retrieval pages, aggregate reduction, and final request preflight. Resolve model context/output limits through the existing catalog with provenance. Prefer a locally available tokenizer that matches the provider's serialization; use provider token counts when already available, without requiring a remote count call for every result.

When exact counting is unavailable, the initial fallback charges one token per UTF-8 byte of text/serialized tool definitions plus explicit framing overhead, with the existing safety reserve. This is intentionally more conservative than `bytes / 4`; it is not a claim of exact token usage for every possible provider. Existing image accounting remains separate and nonzero. A provider's actual usage or rejection can tighten the request profile but must not justify silently expanding an unverified limit.

Count complete response envelopes, tool schemas, tool-call arguments, system text, role/call framing, and multimodal parts. Do not count only the preview field. The implementation must reconcile existing `AIChatTokenEstimator`, retrieval estimators, and `ToolPromptBudgetService` in budget-sensitive paths so one layer cannot approve data that another omits.

Also check actual UTF-8 bytes of the final serialized HTTP request. Use a configured/provider request-body ceiling when known; proposed unknown-transport fallback is 8 MiB. A model's context size is not a transport-size limit. Check existing image handoff fixtures against this added cap before enabling it; return a specific transport-budget error when they exceed it, without silently dropping images.

### 7.2 Allocation formulas

Let:

```text
C = resolved model context capacity
O = effective output reservation, capped by model output limit
M = ceil(0.10 × C), existing safety allowance
U = max(0, C - O - M), usable input capacity
I_fixed = accounted request input excluding tool-result content bodies
          but including their framing, calls, schemas, user/system content and images
R = max(0, U - I_fixed)
B_results = min(floor(0.25 × U), R)
T_inline = min(2000, floor(0.10 × U), currently allocated result capacity)
```

An inline result is eligible only if its final model representation is at most 16 KiB **and** at most `T_inline` tokens. It may still be externalized later by aggregate policy. Per-tool policies can lower global ceilings; they cannot raise them or bypass the aggregate/final checks.

Canonical saved receipt size is at most 4 KiB. Its preview is at most 2 KiB/512 tokens and is shortened further to fit the whole receipt. Its validated control payload has a default 1 KiB ceiling. All output descriptors and wrapper fields count toward the 4 KiB ceiling; descriptor manifests are used when necessary.

Model projections may be smaller than the canonical receipt. Preserve identity, execution outcome, preservation/completeness, essential control fields, and retrieval method first. Allocate optional preview last. There is no universal assumption that a minimal receipt costs a fixed number of tokens: count the actual serialized receipt. If even required paired receipts cannot fit, return an explicit budget error instead of removing a result, altering call IDs, or inventing argument history.

Example: with `C=8192`, `O=1024`, and `M=820`, `U=6348` and `B_results` is at most 1587 tokens before considering `R`. A fixed 50,000-character per-result ceiling would be inappropriate. If `I_fixed` alone exceeds `U`, externalizing output cannot solve the request; use legitimate history compaction or stop with the specific remaining-capacity error.

### 7.3 Aggregate reduction algorithm

Before each provider call:

1. Freeze the effective model, actual exposed tools, output reservation, and image handoff for this dispatch attempt.
2. Resolve any legacy/history projections before loading bulky fields into the request.
3. Compute `B_results` and account every tool-result body, including reader/search results.
4. Replace eligible inline results in descending size order; tie-break by original message order. Save each source first, then replace its model body with a receipt. Persist the derived projection so rebuilding does not restore the bulk body.
5. Reduce optional previews of receipts when needed. For prior retrieval pages, keep a bounded range receipt identifying the already existing output and exact returned span; do not create another artifact. Prefer retaining the newest useful retrieval page while removing older page text, subject to the budget.
6. If still needed, invoke the existing bounded compaction coordinator for eligible completed history, then rebuild and repeat allocation once for that rebuild.
7. Run complete-request token and serialized-byte preflight. Dispatch only when both pass.

Do not evict mandatory current tool call/result pairing. Do not rewrite source messages or original arguments. An inline result saved because of aggregate pressure uses the same storage semantics as a result saved immediately after execution.

Memoize replacement decisions by execution/source identity, content hash, policy version, and effective budget profile. Repeated preparation of unchanged content reuses the same artifact and receipt. Within an unchanged profile, reduction is monotonic during a turn; switching to a smaller model permits further projection reduction. Preserve stable canonical receipts across restarts; model-specific projection is derived.

### 7.4 Provider rejection recovery

For a provider context-size or HTTP body-size rejection despite successful preflight, permit one additional **model-request** retry with optional previews removed and smaller retained retrieval pages. Recalculate both budgets. Do not execute previously completed tools again. If the reduced request still fails, surface the classified error with the original result references intact. This retry is separate from transport retries and must not multiply existing retry loops.

## 8. Retrieval tools and cursors

### 8.1 Registration and trusted context

Register `tool_result_read` and `tool_result_search` in `src/config/skillsRegistry.ts`. Both are local, read-only, `delivery: bounded_reader`, and available in the core tool set while new reference delivery is enabled or existing references are present. Include their schema cost in `I_fixed` before selecting output thresholds.

Use trusted execution context for profile, conversation epoch, agent, and turn. Model arguments never select those identities or a filesystem path. Scoped access to previously generated output needs no new broad filesystem permission prompt. Plan mode and scheduled mode explicitly allow these read-only operations; agent policy still checks ownership or a durable export grant.

The parent can read a child artifact only after the child runtime explicitly exports that artifact through its bounded terminal result and records a grant. Sibling agents receive no implicit access. Revoked/deleted owners invalidate associated grants. Do not infer authorization merely from the fact that an output ID appeared in a prompt.

### 8.2 Read request and response

```json
{
  "output_id": "out_example",
  "cursor": "optional opaque continuation",
  "max_tokens": 1200
}
```

Validate `max_tokens` as a positive integer and clamp to the runtime's allocated capacity. The normal first call omits `cursor` and begins at byte zero. A search match returns a `read_cursor` positioned near that match. Arbitrary raw offsets and JSON-path evaluation are not part of the first public contract.

```json
{
  "success": true,
  "output_id": "out_example",
  "revision": 1,
  "format": "json",
  "content_kind": "text_fragment",
  "content": "an exact bounded fragment of the saved representation",
  "range": { "start_byte": 8192, "end_byte": 10240 },
  "exact": true,
  "has_more": true,
  "next_cursor": "opaque_next_page",
  "preservation": "complete",
  "source_completeness": "complete"
}
```

Ranges are `[start_byte, end_byte)` in captured UTF-8 bytes, with valid code-point boundaries. Pages of a JSON artifact are explicitly text fragments and need not be independently parseable JSON; the enclosing response always is valid JSON. This makes minified single-line output pageable.

The serialized tool response, including wrapper and cursor, must fit both 8 KiB and the allocated maximum of 2,000 tokens. Decode incrementally from a bounded buffer, cut at safe boundaries, and fit the actual serialized envelope. An empty artifact returns `has_more: false`. If the minimum envelope plus one code point cannot fit, return a bounded `MODEL_BUDGET_UNAVAILABLE` result without advancing the cursor. Never return a successful zero-progress page with `has_more: true`.

### 8.3 Search request and response

```json
{
  "output_id": "out_example",
  "query": "example.org",
  "cursor": "optional search continuation",
  "max_matches": 10,
  "max_tokens": 1200
}
```

V1 search is case-sensitive literal UTF-8 text matching. Empty queries, NUL-containing queries, and queries over 256 Unicode code points or 1 KiB are rejected. No arbitrary regular expressions. `max_matches` defaults to 10 and is capped at 20; each snippet and the whole envelope are bounded.

```json
{
  "success": true,
  "output_id": "out_example",
  "matches": [
    {
      "start_byte": 900120,
      "end_byte": 900131,
      "excerpt": "bounded matching context",
      "read_cursor": "opaque_cursor_for_match_context"
    }
  ],
  "scan_complete": false,
  "next_cursor": "opaque_search_continuation",
  "source_completeness": "complete"
}
```

Scan at most 8 MiB or 100 ms per call, whichever occurs first, yielding during the scan. Carry up to `queryByteLength - 1` overlapping bytes across internal buffers; suppress duplicate boundary matches by committed match-end position. A continuation identifies the first unexamined start position so a query crossing page boundaries is not lost. Snippet byte ranges and read cursors use safe text boundaries even when matching operates on bytes.

If the match-count or response budget is reached, stop and return a cursor. `scan_complete: true` means every position in the captured representation was examined, not that an upstream partial result was complete. `scan_complete: false` with no matches is a valid partial search.

### 8.4 Cursor format and validation

Use an opaque versioned encoding authenticated with an app-managed persistent key. Internal fields include output ID/revision, mode, byte position, search-query digest and overlap state when applicable, and policy version. A search cursor cannot be used as a read cursor except through the explicitly generated `read_cursor`.

On every use, validate signature, schema, numeric ranges, version, file identity, and current owner/grant/epoch. Cursor integrity supplements authorization; it does not replace it. Do not bind cursors to a transient turn, so restart/next-turn reads remain possible. Accounting is charged to the current trusted turn. Key rotation invalidates old cursors gracefully; output IDs remain usable from the beginning.

If the artifact is missing, changed, or corrupt, do not serve different bytes under an old revision. Return a stable unavailable/changed error. Local application-managed files are immutable after commit. Check file identity/size against the manifest on open; verify full checksum during sealing, recovery suspicion checks, and export. Do not claim full cryptographic revalidation from a single paged read.

### 8.5 Retrieval-work accounting and availability

Maintain a durable bounded counter keyed by profile, conversation epoch, agent, and trusted turn ID. Default allowance is 32 read/search calls and 32,000 returned tokens per assistant turn; read and search share it. Persist counters so permission pauses or crash resume cannot reset the allowance. A new explicit user/scheduled turn receives a new allowance.

Reserve calls and prospective output atomically before concurrent retrieval, then settle actual returned tokens. Charge repeated reads as work; do not let duplicate calls bypass the guard. Cumulative allowance is distinct from live context allocation. Older retrieved pages can be reduced to range receipts under §7 without changing the source output.

Return `RETRIEVAL_BUDGET_EXHAUSTED` when no further work is allowed, with the saved ID and continuation when available. The agent should report incomplete review or use a separately authorized bulk-processing capability. It must not silently create new autonomous turns merely to reset this limit. Future tuning may increase the allowance based on measured tasks; v1 does not promise exhaustive model review of a 64 MiB artifact in one turn.

## 9. Execution-path integration and publication ordering

### 9.1 Shared result pipeline

```text
execute tool under existing permission/timeout/cancellation policy
  -> capture trusted outcome and transient image handoff
  -> apply existing post-tool hook transformations
  -> await shared result preparation and required storage commit
  -> await idempotent bounded terminal receipt publication
  -> emit bounded UI result
  -> append paired model projection
  -> allocate aggregate budget and complete-request preflight
  -> continue model
```

Hooks that need the produced object run before final preparation, but their serialized input/output must also be bounded. For external-process hooks, send a bounded outcome/preview and scoped reference or reject an unsupported oversized hook request; do not move the raw-payload problem into hook IPC. Any hook transformation is subject to preparation again. Bounded audit fields identify the final representation's provenance without recording raw secrets.

All early/synthetic branches use the same bounded serializer, including malformed arguments, deferred tool discovery, policy denial, permission prompts, and cancellation receipts. Small synthetic results normally stay inline. Keep permission/control decisions outside the preview.

### 9.2 Adapter coverage

| Path | Required action |
| --- | --- |
| Normal V2 execution | Prepare after hooks and before current `eventSink.emit`/`messages.push` |
| Permission resume | Call the same preparer/publisher in `AIChatQueryEngine`; replace placeholder phase safely |
| Async job completion | Normalize returned `ToolExecutionResult`; use original execution identity; prevent repeated polling from publishing multiple artifacts |
| Scheduled loops | Inject storage/budget/retrieval dependencies through the engine factory; no interactive retrieval prompt |
| Agent runtime | Use agent-scoped context and bounded transcript summaries; grant parent access only to explicitly exported artifacts |
| MCP | Normalize text and structured content without serializing the same data twice; preserve `isError` and upstream completeness |
| Legacy local tool execution/retry/resume | Common preparation in `StreamEventProcessor` and `ToolExecutionService`; compatibility projection for remote continuation |
| Legacy server-originated result events | Bound local persistence/UI on receipt; do not claim prevention of upstream remote processing/transport failures |
| Shell polling | Bounded progress with execution identity; final sealed result references existing capture handles |

### 9.3 Persistence failures after execution

Artifact publication and receipt publication have distinct recovery states. If output storage fails but message storage works, save an unavailable/partial-preservation receipt with the actual operation outcome. If the message database itself fails, emit a bounded user-visible persistence error and stop continuation; retain any durable staged artifact/manifest for reconciliation. Do not assert that history is saved.

If the process crashes before the execution outcome is durably recorded, outcome may remain unknown. This feature cannot make arbitrary remote side effects transactional. Reconcile through existing operation/job IDs when possible; never automatically classify an unknown operation as safe to repeat.

## 10. History, compaction, and existing data

### 10.1 New messages

For a newly externalized result, `ai_chat_messages.content` is the canonical receipt. Metadata contains bounded display/control fields and output references; it does not contain the full original object or a second receipt text copy. Existing `fullContent` event naming can remain temporarily for compatibility, but its contract changes to bounded display content and must be documented/tested.

The archive's original source for this new message is the receipt. The output is a separate referenced source, not imaginary hidden text inside the message. History search indexes receipt summaries/control fields; searching inside a saved payload uses `tool_result_search`. History read returns the receipt plus output descriptors and must not silently expand the payload.

Compaction packs tool receipts with operation identity, outcome, important IDs/counts, output IDs, and completeness. Derived summaries may mention results but must not claim full output coverage when only a preview was examined. Keep an authorized output reference index in the durable conversation state so a later assistant can rediscover output even if a prose summary omits its ID.

### 10.2 Legacy source projections

Do not overwrite old message `content` or metadata to make old rows smaller. They remain original evidence under the recoverable-history contract. Add `ai_tool_result_projections` keyed by source row identity, epoch, revision/hash, and policy version. Store a receipt projection after preserving the old result into an artifact. An existing small row can use an inline projection.

Read metadata-only pages first: row identity, ordering, type, source byte lengths, revision, and projection availability. Do not `SELECT` the full content/metadata for a large row and then claim the query was bounded because it returned only one row. Use bounded SQL text slices with tested Unicode semantics or another bounded export path through Models.

The current `AIChatMessageArchiveModel.readSourceSlice*` methods retrieve a full content field and slice it in JavaScript. They need a bounded database read implementation before being used for large-source migration/retrieval. Original code-point offsets remain the archive contract; output readers use bytes. Conversion must be explicit and tested, never inferred by treating the two units as equal.

Integrate projection lookup before `AIChatContextAssembler`'s live-tail byte allowance and completeness decision. Otherwise a large legacy row can fail bounded loading before the result preparer gets a chance to reduce it. UI/history adapters also load projections before materializing raw metadata.

Backfill is resumable, keyset-paged, and bounded by bytes/time as well as row count. It may temporarily retain both the original database source and a file; charge file quota and report that historical DB storage is not reclaimed in this release. If quota prevents backfill, retain the original source and serve bounded legacy pages through Models; do not make a false file reference. Any new result receipt derived from this fallback names the supported legacy-source reader through the common output abstraction.

To support that fallback, registry records may use a tagged backend `file` or `legacy_message`, with validated source-row identity/revision for the latter. Both readers enforce the same scope/page/budget contract. A source mutation invalidates the derived projection and cursor; it does not overwrite an existing committed file artifact under the same revision.

### 10.3 Reload and compaction invariants

- Rebuild from canonical bounded projections, never from raw payload expansion.
- Preserve tool-call/result pairing and source order.
- New message receipt offsets and legacy source offsets are distinct; label retrieved source kind.
- Archive revision changes invalidate affected derived projections using existing bookkeeping.
- Clear/delete invalidates output epochs even when an archive feature flag is off.
- Compaction does not delete output artifacts or reset retrieval authorization.
- Existing references remain supported when new capture is disabled.

## 11. IPC, renderer, and export

### 11.1 Proposed IPC surface

| Channel | Validated input | Output |
| --- | --- | --- |
| `AI_TOOL_RESULT_GET` | Active conversation and output ID | Bounded authorized descriptor |
| `AI_TOOL_RESULT_READ` | Output ID, cursor, requested page size | Escaped text data and cursor; at most 32 KiB serialized |
| `AI_TOOL_RESULT_SEARCH` | Output ID, bounded literal query, cursor | Bounded snippets and read cursors |
| `AI_TOOL_RESULT_EXPORT` | Output ID and user save-dialog interaction | Completion/cancellation/failure status; no full payload in IPC |

All handlers authenticate the renderer/request scope and delegate to Modules/Services. Per repository policy, AI-feature handlers check `Token`/`USER_AI_ENABLED` before parsing request data or doing work and return the standard disabled response when necessary. Saved data remains durable when AI is disabled, but this initial AI UI surface follows that gate; a separate general data-export surface would need its own approved product scope.

Use contextBridge APIs, Zod schemas, plain serializable DTOs, bounded error strings, and no raw storage paths. A model-triggered read uses the stricter model page budget; the user viewer uses the 32 KiB UI page budget and does not consume model retrieval-work tokens.

### 11.2 Components and translations

Modify `AiChatV2Message.vue` to display preservation metadata and open a proposed `AiChatToolResultViewer.vue`. The viewer holds at most five recent pages, supports visited-page back navigation, cancels stale requests on close/conversation change, and never appends all pages into one growing string. Search results and selections also have bounded caches.

Proposed translation namespace: `aiChatV2.toolOutput`. Keys include `saved`, `partial`, `unavailable`, `preview`, `view`, `export`, `size`, `search`, `search_incomplete`, `next_page`, `previous_page`, `copy_page`, `loading`, `source_incomplete`, `quota_reached`, `deleted`, and `export_failed`. Add accurate values to `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts` and English fallbacks in components.

Copy copies only the currently displayed text unless the UI explicitly labels another bounded selection. Never describe that action as copying the full result. Use text rendering, not `v-html`. Provide keyboard focus management, labeled controls, accessible loading/error announcements, and wrapping/scrolling for long lines.

### 11.3 Export

Export requires an explicit user action and a native save dialog. Main-process code streams the authorized artifact to the selected destination with bounded buffers; it does not return bytes to the renderer. Show cancellation and I/O errors without exposing internal paths. Check epoch during export and stop on deletion. Export includes the captured representation; for partial output use a truthful filename/manifest or visible warning. It does not reconstruct data the producer or capture layer never preserved.
