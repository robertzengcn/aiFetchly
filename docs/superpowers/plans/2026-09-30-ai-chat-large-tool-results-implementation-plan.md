# Implementation Plan: Recoverable Large Tool Results

**Date:** 2026-09-30
**PRD:** [Recoverable large tool results](../specs/2026-09-29-ai-chat-large-tool-results-prd.md)
**Technical design:** [Technical design](../specs/2026-09-29-ai-chat-large-tool-results-technical-design.md)
**Branch:** `feature/large-tool-results`
**Worktree:** `/Users/cengjianze/project/aiFetchly-large-tool-results`

## 1. Goal

Preserve oversized tool output in application-managed local storage, put a bounded structured
receipt in the conversation, and expose authorized bounded `tool_result_read` / `tool_result_search`
retrieval. Execution outcome, producer completeness, capture preservation, and preview completeness
stay independent facts. A storage failure must never be reported as a tool failure and must never
cause a side-effecting tool to re-run.

## 2. Repository constraints that shape the implementation

- **Database access only in Model/Module layers** (AGENTS.md "Database Access Architecture"). IPC
  handlers validate and delegate. All new SQL lives in `src/model/` + `src/modules/`.
- **AI-feature IPC handlers check `USER_AI_ENABLED` first** via `ensureHostedAiEnabled()` before
  parsing payloads (`src/service/AiFeatureGate.ts`).
- **Renderer IPC requires a preload `invoke` allowlist entry** (`src/preload.ts`) or calls silently
  return `undefined` (regression class pinned by `test/vitest/main/preloadInvokeAllowlist.test.ts`).
- **Every user-facing string needs all six languages** (`en/zh/es/fr/de/ja`) plus English fallback in
  the component; `test/vitest/main/i18nKeysPresent.test.ts` locks key parity.
- **UI changes require component tests** in `test/vitest/main/components/` under the dedicated
  happy-dom config, and UI + tests commit together.
- **No `any`**, explicit return types, `unknown` at untrusted boundaries (AGENTS.md TypeScript rules).
- **Auto-commit each logical unit** with a conventional-commit message.

## 3. Work breakdown (dependency order from technical design §16.2)

### Unit 1 — Contracts, config, schemas

| File | Purpose |
| --- | --- |
| `src/entityTypes/toolResultTypes.ts` | §4.2 contracts: `ToolOperationStatus`, `SourceCompleteness`, `OutputPreservation`, `StoredToolOutputRef`, `ToolResultReceipt`, `PreparedToolResult`, `TrustedToolOutputContext`, failure codes |

### Unit 2 — Durable storage (entities, model, module)

Entities (all additive; registered in `src/config/SqliteDb.ts`):

- `ai_tool_output_scopes` — profile/conversation scope holding the current output epoch + deletion
  fence. Exists independently of the archive feature flag.
- `ai_tool_outputs` — artifact registry row keyed by `outputId`; stores scope, execution identity,
  stream key, revision, state, backend, format, relative storage key, captured/original bytes,
  SHA-256, source completeness, preservation, failure code, policy version, lease fence, and the
  bounded terminal receipt needed for recovery.
- `ai_tool_output_reservations` — reserved/used bytes with lease expiry per execution.
- `ai_tool_output_grants` — durable parent↔child delegation grants.
- `ai_tool_output_retrieval_budgets` — per (profile, conversation, epoch, agent, turn) call/token
  counters with conditional version updates.
- `ai_tool_result_projections` — versioned bounded projections over legacy source rows.

Model/Module:
- `src/model/ToolResult.model.ts` — artifact rows, quota accounting, grants, keyset lists, and
  conditional (fenced) state updates. No service logic.
- `src/modules/ToolResultModule.ts` — ownership/epoch validation, quota reservation, state
  transitions, and coordination. Owns the epoch fence that all late commits compare against.

Artifact identity is `(profileId, conversationId, epoch, executionId, streamKey)`. Same identity +
same source hash is idempotent; same identity + different bytes is a conflict and never overwrites
committed evidence (AC-25).

### Unit 3 — Storage service (bounded, atomic, checksummed)

`src/service/ToolResultStorageService.ts`:

- Single-pass yielding JSON/text serializer writing to a sink that holds at most the inline-byte
  allowance and spills to a temp file. Computes byte count and SHA-256 once. Rejects cycles,
  BigInt, accessors, unsupported prototypes, and depth > 128 with typed errors. Never invokes
  producer `toJSON`/getters.
- Publication protocol: write temp payload + bounded manifest → flush/fsync → atomic rename within
  the same filesystem → fenced registry commit. Tolerates "file promoted before DB commit" by
  recording publication status for startup reconciliation.
- Private app-managed root resolved in the main process and injectable for tests. All path segments
  are generated internally (no producer names, titles, or requested filenames). Path resolution
  rejects traversal/symlink escape and opens regular files only.
- Quotas: 64 MiB per artifact, 1 GiB per conversation, 5 GiB per profile, 128 MiB free-disk
  reserve. Reserves in 1 MiB increments for unknown-length streams, grows atomically before writes,
  releases unused reservations on failure. Refuses rather than evicting committed referenced output.

### Unit 4 — Preview service

`src/service/ToolResultPreviewService.ts` — deterministic, no provider calls:


### Unit 6 — Cursor codec + retrieval service

- `src/service/ToolResultCursorCodec.ts` — versioned base64url payload authenticated with an
  app-managed persistent key (HMAC). Fields: outputId/revision, mode, byte position, search-query
  digest, overlap state, policy version. Validated against trusted owner/grant/epoch on every use.
  Cursor integrity supplements authorization, never replaces it. A search cursor cannot be used as
  a read cursor.
- `src/service/ToolResultRetrievalService.ts` — bounded read (8 KiB / 2000 tokens incl. envelope) and
  bounded literal search (8 MiB or 100 ms per call, yielding; carries `queryByteLength − 1`
  overlapping bytes; suppresses duplicate boundary matches by committed match-end position).
  `scan_complete: true` means every captured byte was examined — never that the producer's own
  output was complete. Readers never call `FileToolService.executeFileRead`.
- Retrieval-work accounting: shared durable per-turn allowance (32 calls / 32,000 returned tokens);
  reserve before concurrent work, settle actual tokens. Duplicate calls are charged as work.

### Unit 7 — Preparation + publisher (the shared pipeline)

- `src/service/ToolResultPreparationService.ts` — the single boundary every execution path calls
  before persistence, model dispatch, and renderer publication. Validates and bounds the `control`
  object (never an unchecked spread of the result), keeps outer trusted status authoritative,
  selects inline vs external representation, and produces
  `{ receipt, canonicalMessageContent, modelContent, uiMetadata, serializedBytes, accountedTokens }`.
- `src/service/ToolResultPublisher.ts` — idempotent terminal receipt persistence keyed by
  execution/phase identity, then renderer delivery. Delivery failure retries delivery from the saved
  receipt and never re-executes the tool. Publication failure stops model continuation instead of
  asserting a saved result.

### Unit 8 — Recovery service

`src/service/ToolResultRecoveryService.ts` — startup sweep in bounded keyset batches: reclaim
expired writing leases, inspect staged manifests, validate size/checksum before promoting a
recoverable artifact, complete idempotent pending receipt publication for still-valid epochs, sweep
unregistered files past the 24h grace, and rate-limit I/O so a large orphan directory cannot block
startup. Never infers operation success from a payload file alone.


### Unit 11 — IPC surface

`src/main-process/communication/tool-result-ipc.ts` with channels `AI_TOOL_RESULT_GET`,
`AI_TOOL_RESULT_READ`, `AI_TOOL_RESULT_SEARCH`, `AI_TOOL_RESULT_EXPORT` in `channellist.ts`, all four
allowlisted in `src/preload.ts`. Handlers check `ensureHostedAiEnabled()` first, validate with Zod,
delegate to the Module/Services, and return plain serializable DTOs with bounded error strings and
no raw storage paths. Read/search responses are capped at 32 KiB serialized. Export streams from
the main process through a native save dialog and never returns bytes to the renderer.

### Unit 12 — Renderer viewer + i18n

- `src/views/components/aiChatV2/AiChatToolResultViewer.vue` — lazy initial page, next/previous
  visited-page navigation, literal search, loading/error states, copy-current-page. Holds at most
  five recent pages, cancels stale requests on close/conversation change, renders escaped text (never
  `v-html`), and stays usable while an agent runs.
- `AiChatV2Message.vue` — result card shows "full output saved" / precise partial / unavailable
  state, captured size, a preview explicitly labeled as a preview, and View/Export actions. A
  storage failure is never rendered as "tool execution failed".
- `aiChatV2.toolOutput.*` keys added to all six language files with English fallbacks in components.
  Copy is labeled as copying the displayed page, never "copy full result".

### Unit 13 — Tests

| Area | Files |
| --- | --- |
| Preparation boundaries | `test/vitest/main/service/ToolResultPreparationService.test.ts` (below/at/above limits, empty output, long error, control-field survival) |
| Serialization fidelity | `test/vitest/main/service/ToolResultStorageService.test.ts` (nested JSON, Unicode/CJK/emoji, cycles, BigInt, depth; reconstructed content + hash match) |
| Quota / epoch / lifecycle | `test/vitest/main/modules/ToolResultModule.quotaEpoch.test.ts` |
| Read / search / cursors | `test/vitest/main/service/ToolResultRetrievalService.test.ts` (EOF facts, minified one-line JSON, cross-boundary matches, tampered cursor, scope isolation) |
| Aggregate budget | `test/vitest/main/service/ToolResultBudgetService.test.ts` (twenty medium results, 8k/32k/128k contexts) |
| Config validation | `test/vitest/main/config/toolResultConfig.test.ts` |
| Tool registration + bounded envelope | `test/vitest/main/ToolResultTools.test.ts` |
| UI | `test/vitest/main/components/AiChatToolResultViewer.test.ts` + extension of `AiChatV2Message` coverage |
| i18n | extension of `test/vitest/main/i18nKeysPresent.test.ts` |

## 4. Explicitly out of scope for this change (and why)

These remain PRD/technical-design work but are sequenced later in the design's own delivery plan
(phases 4–5) and are not silently skipped:

- **Foreground/background shell spooling** (FR-16, AC-24) — requires reworking spawn-time capture
  handles and `BackgroundShellRegistry` handoff; it is a separately testable producer upgrade.
- **Legacy hosted-continuation server certification** (AC-21) — requires a live `/api/ai/ask/continue`
  contract fixture against the server. Until certified, the legacy lane keeps the bounded
  limited-output fallback with `RETRIEVAL_UNSUPPORTED_BY_HOST` and never advertises retrieval tools.
- **Legacy source-row backfill/migration** (§10.2) — requires bounded `substr` SQL reads replacing
  `readSourceSlice*`; original message source stays immutable in the meantime.
- **Performance benchmark harness and NFR-01–09 measurement** — timing/memory numbers are measured
  targets, not code-inspection claims.

Every one of these has its public contract, error code, and config flag defined now, so the
remainder integrates without changing the contracts built here.

## 5. Validation

```text
yarn exec tsc --noEmit
yarn exec vue-tsc --noEmit
yarn testmain
yarn test:components
```

Non-watch invocations are used because `yarn tsc` / `yarn vue-check` enable watch mode. Unrelated
baseline failures are recorded separately; a suite is not reported as passing when it did not.

### Unit 9 — Retrieval tools

- `src/service/agentTools/toolResultReadTool.ts`, `toolResultSearchTool.ts` — lazy-loaded handlers
  following the `conversation_history_*` pattern. They never externalize their own output (no
  `file_read → externalize → file_read` recursion) and return bounded envelopes.
- Registered in `src/config/skillsRegistry.ts` as `pure` / read-only / `tier: "main"`, available
  whenever model-visible references are present. Active conversation, agent, and epoch come from
  trusted `SkillExecutionContext`, never from model arguments. Plan mode and scheduled mode allow
  them; agent policy still enforces ownership or an explicit export grant.

### Unit 10 — Execution-path wiring

- `src/service/AIChatQueryLoop.ts` — await preparation before `eventSink.emit` and `messages.push`;
  use the model projection; run the aggregate budget every round. `shrinkLiveTurnToolPayloads` is
  no longer the mechanism for oversized results; pressure that remains after preparation yields a
  truthful budget error rather than fabricated `{}` arguments.
- `src/modules/AIChatV2Module.ts` — `saveToolResultMessage` stores the receipt **once** as content
  and only bounded control/display metadata in the row metadata (no second copy of the payload).
- `src/service/AIChatQueryEngine.ts` — permission-resume path uses the same preparer/publisher
  before model continuation, with a new execution identity for the resumed attempt.

- Text → UTF-8-safe prefix ending at a newline when it fits.
- Logs → bounded head+tail with explicit omitted-region markers.
- Record-shaped JSON → counts, field names, bounded sample of **complete** records in source order.
- Unknown JSON → top-level keys plus bounded primitive values; never emits malformed JSON as a
  structured envelope.
- Errors → code + concise message preserved; full detail becomes captured output.
- Binary/image → existing artifact descriptors only, never base64 in text previews.

### Unit 5 — Budget service

`src/service/ToolResultBudgetService.ts` implements §7:

- One counting adapter used by preparation, retrieval pages, aggregate reduction, and final
  preflight. Conservative fallback charges 1 token per UTF-8 byte (deliberately stricter than
  `bytes / 4`); image accounting stays separate and nonzero.
- Allocation: `U = max(0, C − O − M)`, `R = max(0, U − I_fixed)`,
  `B_results = min(floor(0.25 × U), R)`, `T_inline = min(2000, floor(0.10 × U), allocated)`.
- Aggregate reduction before every provider call: replace the largest inline results with receipts
  (persist the derived projection so a rebuild does not restore the bulk body), reduce optional
  previews last, never break tool-call/result pairing, never rewrite original arguments.
- Serialized-body cap in addition to the token preflight (`REQUEST_BODY_TOO_LARGE`).

| `src/config/toolResultConfig.ts` | §13.1 immutable defaults, validated overrides, policy-version identity, rollout flags (capture / model-refs / UI) |
| `src/schemas/toolResult.ts` | Zod validation boundary for model tool input and IPC payloads |

Key decisions:
- Config exposes `resolveToolResultConfig(overrides)` that rejects invalid values and falls back to
  the safe default rather than throwing; third-party policy may only lower ceilings.
- `policyVersion` is recorded on receipts and included in artifact identity so stale projections
  are invalidated rather than silently reused.
- Rollout flags read live from `Token`, fail closed on store error, mirroring `featureFlags.ts`.

## 6. Implementation status

Delivered on `feature/large-tool-results`, in the dependency order above.

| Unit | Status | Notes |
| --- | --- | --- |
| 1 — contracts, config, schemas | Done | `toolResultTypes.ts`, `toolResultConfig.ts`, `schemas/toolResult.ts`, `schemas/ipc/toolResult.ts` |
| 2 — registry, epoch fence, quota | Done | 6 entities, `ToolResult.model.ts`, `ToolResultModule.ts` |
| 3 — serializer + atomic storage | Done | `ToolResultSerializer.ts`, `ToolResultStorageService.ts`, `ToolResultPaths.ts` |
| 4 — preview service | Done | `ToolResultPreviewService.ts` |
| 5 — aggregate budget | Done | `ToolResultBudgetService.ts` |
| 6 — cursors + retrieval | Done | `ToolResultCursorCodec.ts`, `ToolResultRetrievalService.ts` |
| 7 — preparation + publication | Done | `ToolResultPreparationService.ts`, `ToolResultPublisher.ts` |
| 8 — recovery | Done | `ToolResultRecoveryService.ts` |
| 9 — retrieval tools | Done | `toolResultReadTool.ts`, `toolResultSearchTool.ts`, registered in `skillsRegistry.ts` |
| 10 — execution-path wiring | **Partial — see below** | Contracts and boundary exist and are tested; not yet called from `AIChatQueryLoop` / `AIChatQueryEngine` |
| 11 — IPC | Done | `tool-result-ipc.ts` + 4 allowlisted channels + `views/api/aiToolResult.ts` |
| 12 — viewer + i18n | Done | `AiChatToolResultViewer.vue`, result card, `aiChatV2.toolOutput.*` in all six languages |
| 13 — tests | Done | service / module / config / component suites, i18n parity, preload allowlist guard |

### Why Unit 10 is deliberately partial

Every other execution path still calls `normalizeToolResult` and serializes the
raw result. Switching the live V2 loop over is a separate, reviewable step
because it changes what is written into existing conversation history, and it
must land together with the retrieval tools being enabled — otherwise a
conversation would start containing references that nothing can yet resolve,
which is the "references without working retrieval" state the design explicitly
says is not a complete release.

The rollout flags therefore default OFF. With them off, behavior is unchanged;
enabling `ai_tool_output_capture_enabled` + `ai_tool_output_model_refs_enabled`
without the loop wiring is safe because nothing emits a reference yet.

### Bugs the new tests caught

Recorded because each was a real defect that code inspection had missed:

1. File-spooled writes were fire-and-forget, so a large artifact could be
   renamed into place with writes still pending — publishing a corrupt payload
   whose byte counter already looked correct.
2. Search excerpts were sliced with an absolute offset against a
   window-relative buffer, so every match beyond the first window returned an
   empty excerpt.
3. The search continuation cursor was dropped when the match budget filled up,
   telling the model "no more matches" about a region never examined.
4. Head/tail previews reused the prefix truncation helper for the tail, so the
   "tail" was a second copy of the head.
5. The preparer generated its own output id while the Module mints the id when
   claiming the writing slot, so every large result silently degraded to
   `unavailable`.
6. TypeORM returns `null` for nullable columns but the receipt schema declares
   those fields as optional, so a valid artifact's descriptor failed validation
   and the receipt lost its entire output list.
7. `boundUntrustedValue` read properties directly, invoking producer getters
   while merely shaping a value for a receipt.
8. The result card claimed "the tool itself stopped early" when no descriptor
   existed at all — inventing a fact about the producer.

### Known unrelated baseline failure

`test/vitest/main/service/HookDispatcher.skillRef.test.ts` fails on the base
branch `test` as well, before any of this work. It is not caused by this change.
