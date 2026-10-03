# Recoverable Conversation History and Incremental Compaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement bounded, resumable, incremental compaction for AI Chat V2 plus read-only archive retrieval tools (`conversation_history_search`, `conversation_history_read`), so that long conversations (up to 100,000 messages) never construct an unbounded all-history model request, never delete original source messages, and can recover exact historical text on demand.

**PRD:** `docs/prd/ai-chat-recoverable-history-incremental-compaction-prd.md` (24 acceptance criteria AC-01..AC-24, FR-01..FR-11, 10 product invariants).
**Technical design (reference):** `docs/prd/ai-chat-recoverable-history-incremental-compaction-technical-design.md` (21 sections).

**Architecture:** Three-layer DB (Model `extends BaseDb` → Module `extends BaseModule` → IPC handler never touches repositories). New entities registered in `src/config/SqliteDb.ts`. Zod v4 schemas at every boundary. Coordinator is a single shared main-process service across all compaction triggers. Final token budget enforced at the provider-dispatch boundary in `AIChatQueryLoop` on every round.

**Tech Stack:** Electron + Vue 3 + Vuetify + Pinia + Vite + TypeScript 5.x; TypeORM + better-sqlite3 + SQLite (`synchronize: true`, no migrations); `zod/v4`; Vitest with `tsc --noEmit` globalSetup gate; Playwright E2E.

**Worktree:** `.claude/worktrees/ai-chat-compaction` (branch `worktree-ai-chat-compaction`, based on `test` tip `f2aaa043`).

**Mandatory repo rules (from CLAUDE.md):**
- No `any` type — use `unknown` + Zod parsing.
- `import { z } from "zod/v4"` for all schemas.
- Three-layer DB: IPC handlers call Modules; Modules call Models; Models own repositories.
- AI-serving IPC handlers gate on `Token`/`USER_AI_ENABLED` before parsing request data.
- Preload `receive`/`removeListener`/`removeAllListeners` arrays must mirror exactly.
- All 6 language files (en/zh/es/fr/de/ja) updated for any UI text.
- UI changes ship with component tests under `test/vitest/main/components/`.
- Child/worker files in `src/childprocess/` (no worker touches DB).
- Auto-commit after each completed logical unit; NEVER use `--no-verify` (fix lint/type errors).

**Rollout flags** (Token-based, model `featureFlags.ts`): `AI_CHAT_ARCHIVE_READS_FLAG`, `AI_CHAT_HISTORY_TOOLS_FLAG`, `AI_CHAT_NEW_COMPACTION_FLAG`, `AI_CHAT_HISTORY_UI_FLAG`. The final dispatch budget guard is **mandatory whenever the new code path is enabled** — it is not behind a flag.

**Configurable defaults** (PRD defaults table; central constant in `src/service/AIChatRecoverableDefaults.ts`):
| Setting | Default |
|---|---|
| compaction trigger fraction | 0.80 |
| post-compaction target fraction | 0.60 |
| section source target tokens | 12,000 |
| section output cap tokens | 1,500 |
| overview/state output target tokens | 2,000 |
| safety margin fraction | 0.10 |
| max sections per background batch | 3 |
| max model attempts per section per run | 4 |
| max context-reduction retries per section | 2 |
| recent-turn retained suffix (min complete turns) | 2 |
| metadata page rows | 64 |
| decoded-text allowance (bytes) | 65,536 |
| search fragment max code points | 4,096 (128 overlap) |
| retrieval default output tokens | 4,000 (max 8,000) |
| retrieval cumulative tokens per turn | 8,000 (max 4 calls) |
| lease initial / renew interval / provider timeout (s) | 120 / 30 / 90 |
| retained generation history count | 10 |

---

## File Structure

| Layer | File | Change |
|---|---|---|
| Constants | `src/service/AIChatRecoverableDefaults.ts` | New — central defaults + feature-flag names |
| Types | `src/entityTypes/aiChatArchiveTypes.ts` | New — HistorySourceRef, HistoryOrderKey, ArchiveReadPage, HistoryExcerpt, ArchivePageRequest, CompactionClaim, SummaryFact, SectionSummaryV1, run/section/generation status unions, error codes |
| Entity | `src/entity/AIChatArchiveState.entity.ts` | New — `ai_chat_archive_state` |
| Entity | `src/entity/AIChatArchiveTurn.entity.ts` | New — `ai_chat_archive_turns` |
| Entity | `src/entity/AIChatArchiveEntry.entity.ts` | New — `ai_chat_archive_entries` |
| Entity | `src/entity/AIChatCompactionRun.entity.ts` | New — `ai_chat_compaction_runs` |
| Entity | `src/entity/AIChatCompactionSection.entity.ts` | New — `ai_chat_compaction_sections` |
| Entity | `src/entity/AIChatContextGeneration.entity.ts` | New — `ai_chat_context_generations` |
| Entity | `src/entity/AIChatArchiveSearchFragment.entity.ts` | New — `ai_chat_archive_search_fragments` |
| Entity registration | `src/config/SqliteDb.ts` | Register the 7 new entities in the entities array |
| Model | `src/model/AIChatArchiveState.model.ts` | New — state upsert/claim/lease/invalidate |
| Model | `src/model/AIChatArchiveTurn.model.ts` | New — turn upsert/terminal/list |
| Model | `src/model/AIChatArchiveEntry.model.ts` | New — entry projection + keyset reads |
| Model | `src/model/AIChatCompactionRun.model.ts` | New — claim/save-section/publish/cancel |
| Model | `src/model/AIChatCompactionSection.model.ts` | New — section insert by workKey + coverage queries |
| Model | `src/model/AIChatContextGeneration.model.ts` | New — generation insert + CAS active pointer |
| Model | `src/model/AIChatArchiveSearchFragment.model.ts` | New — fragment batch save + FTS probe |
| Model | `src/model/AIChatMessageArchive.model.ts` | New — bounded keyset/substring reads on `ai_chat_messages` |
| Module | `src/modules/AIChatArchiveModule.ts` | New — readPage/readSourceSlice/searchPage/getRecentTurns/getToolPair/resolveSelections |
| Module | `src/modules/AIChatCompactionModule.ts` | New — claimRun/renewLease/saveSectionAndCheckpoint/publishGeneration/pauseRun/cancelRun/invalidateConversation |
| Module | `src/modules/AIChatArchiveIndexModule.ts` | New — readNextIndexBatch/saveIndexBatchAndCursor/getIndexCoverage |
| Service | `src/service/AIChatHistoryRetrievalService.ts` | New — result formatting, budget, source links, error mapping |
| Service | `src/service/AIChatSectionPacker.ts` | New — bounded source streaming + coverage manifest |
| Service | `src/service/AIChatRequestBudgetService.ts` | New — limit resolution + complete-request accounting + dispatch guard |
| Service | `src/service/AIChatSummaryValidator.ts` | New — parse SectionSummaryV1, validate source IDs |
| Service | `src/service/AIChatCompactionCoordinator.ts` | New — shared trigger entry, run lifecycle, cancellation |
| Service | `src/service/AIChatArchiveTextUtil.ts` | New — Unicode code-point offset helpers |
| Service | `src/service/AIChatArchiveCursorCodec.ts` | New — opaque versioned cursor encode/decode/validate |
| Service | `src/service/AIChatCompactionPromptBuilder.ts` | New — versioned section/overview structured prompts |
| Schema | `src/schemas/aiChatHistoryTools.ts` | New — Zod input schemas for the two retrieval tools |
| Schema | `src/schemas/ipc/aiChatHistoryIpc.ts` | New — Zod schemas for history IPC channels |
| Tool handler | `src/service/agentTools/conversationHistorySearchTool.ts` | New — `conversation_history_search` handler |
| Tool handler | `src/service/agentTools/conversationHistoryReadTool.ts` | New — `conversation_history_read` handler |
| Skills registry | `src/config/skillsRegistry.ts` | Add the two retrieval tool definitions |
| Channel | `src/config/channellist.ts` | Add 6 channels (4 invoke + 1 invoke cancel + 1 progress event) |
| Preload | `src/preload.ts` | Allowlist the 6 channels across send/receive/removeListener/removeAllListeners |
| Frontend API | `src/views/api/aiChatV2.ts` | Add typed wrappers + scoped listener cleanup |
| IPC handler | `src/main-process/communication/ai-chat-v2-ipc.ts` | Add history/compaction-status handlers; route compact through coordinator |
| Engine | `src/service/AIChatQueryLoop.ts` | Insert `AIChatRequestBudgetService.preflight` before `streamChatCompletion` |
| Engine | `src/service/AIChatQueryEngine.ts` | Persist turnId; invoke coordinator post-turn via shared service |
| Engine factory | `src/service/AIChatQueryEngineFactory.ts` | Inject shared coordinator + budget service for scheduled engines |
| Compact agent | `src/service/AIChatCompactAgentService.ts` | Delegate to coordinator; remove `runFullCompact` all-history path |
| Context asm | `src/service/AIChatContextAssembler.ts` | Use bounded reads + composite boundary + recent turns + typed blocks |
| UI | `src/views/components/aiChatV2/AiChatHistoryDrawer.vue` | New — paginated search/browse |
| UI | `src/views/components/aiChatV2/AiChatHistoryMessage.vue` | New — bounded passage + selection |
| UI | `src/views/components/aiChatV2/AiChatSelectedContext.vue` | New — next-reply selections + cost |
| UI | `src/views/components/aiChatV2/AiChatCompactionStatus.vue` | New — progress/pause/failure/retry/cancel |
| UI | `src/views/components/aiChatV2/AiChatV2.vue` | Integrate drawer + selected context + status badge |
| i18n | `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add `aiChatHistory` + `aiChatCompaction` keys |
| Tests | `test/vitest/main/AIChatArchiveModel.test.ts` | New — ordering/pagination/slicing |
| Tests | `test/vitest/main/AIChatHistoryRetrievalService.test.ts` | New — scope/budget/dedup |
| Tests | `test/vitest/main/AIChatSectionPacker.test.ts` | New — coverage/oversized |
| Tests | `test/vitest/main/AIChatCompactionCoordinator.test.ts` | New — fencing/restart/cancel |
| Tests | `test/vitest/main/AIChatRequestBudgetService.test.ts` | New — formula/dispatch guard |
| Tests | `test/vitest/main/AIChatSummaryValidator.test.ts` | New — parse/reject |
| Tests | `test/vitest/main/components/AiChatHistoryDrawer.test.ts` | New component test |
| Tests | `test/vitest/main/components/AiChatCompactionStatus.test.ts` | New component test |
| Tests | `test/e2e/specs/ai-chat-recoverable-history.test.ts` | New E2E — compact/restart/recover/select/delete |

---

## Milestone 1 — Archive addressing, bounded reads, retrieval tools (design units 1–3)

### Task 1: Shared types and defaults

**Files:**
- Create: `src/service/AIChatRecoverableDefaults.ts`
- Create: `src/entityTypes/aiChatArchiveTypes.ts`
- Create: `src/service/AIChatArchiveTextUtil.ts`
- Create: `src/service/AIChatArchiveCursorCodec.ts`

- [ ] **Step 1.1: Create the central defaults file**

`src/service/AIChatRecoverableDefaults.ts`:

```typescript
/**
 * Central configurable defaults for recoverable history + incremental
 * compaction. Mirrors the PRD defaults table. Values are intentionally
 * conservative; production tuning happens via Token-based feature flags
 * (see featureFlags.ts), not by editing these constants.
 */
export const AI_CHAT_RECOVERABLE_DEFAULTS = {
  // Token budget fractions.
  compactionTriggerFraction: 0.8,
  compactionTargetFraction: 0.6,
  safetyMarginFraction: 0.1,

  // Section packing.
  sectionSourceTargetTokens: 12_000,
  sectionOutputCapTokens: 1_500,
  overviewOutputTargetTokens: 2_000,
  maxSectionsPerBackgroundBatch: 3,
  maxModelAttemptsPerSectionPerRun: 4,
  maxContextReductionRetriesPerSection: 2,

  // Recent-turn retention.
  minRetainedCompleteTurns: 2,

  // Bounded read limits.
  metadataPageRows: 64,
  decodedTextAllowanceBytes: 65_536,

  // Search.
  searchFragmentMaxCodePoints: 4_096,
  searchFragmentOverlapCodePoints: 128,
  searchMaxFragmentsPerPage: 500,
  searchMaxMsPerPage: 100,

  // Retrieval accounting.
  retrievalDefaultOutputTokens: 4_000,
  retrievalMaxOutputTokens: 8_000,
  retrievalMaxCumulativeTokensPerTurn: 8_000,
  retrievalMaxCallsPerTurn: 4,

  // Lease / provider.
  leaseInitialSeconds: 120,
  leaseRenewIntervalSeconds: 30,
  providerTimeoutSeconds: 90,

  // Generation retention.
  retainedGenerationHistoryCount: 10,
} as const;

/** Token-based feature-flag names (values are the Token keys to read). */
export const AI_CHAT_RECOVERABLE_FLAGS = {
  archiveReads: "ai_chat_archive_reads_flag",
  historyTools: "ai_chat_history_tools_flag",
  newCompaction: "ai_chat_new_compaction_flag",
  historyUi: "ai_chat_history_ui_flag",
} as const;
```

- [ ] **Step 1.2: Create the archive type definitions**

`src/entityTypes/aiChatArchiveTypes.ts`:

```typescript
/**
 * Type definitions for the recoverable-history archive. These mirror the
 * contracts in technical-design §4 and §6. Internal-only; references returned
 * to the model/UI are opaque source IDs resolved by the backend.
 */
export interface HistorySourceRef {
  readonly epoch: string;
  readonly revision: number;
  readonly rowId: number;
  readonly messageId: string;
  readonly timestampMs: number;
  readonly field: "content" | "tool_receipt";
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface HistoryOrderKey {
  readonly timestampMs: number;
  readonly rowId: number;
}

export interface HistoryExcerpt {
  readonly sourceId: string;
  readonly messageId: string;
  readonly role: string;
  readonly timestamp: string;
  readonly text: string;
  readonly exact: boolean;
  readonly redacted: boolean;
  readonly hasMore: boolean;
}

export interface ArchiveReadPage {
  readonly records: readonly HistoryExcerpt[];
  readonly nextCursor: string | null;
  readonly truncated: boolean;
  readonly sourceRevision: number;
}

export interface ArchivePageRequest {
  readonly conversationId: string;
  readonly cursor?: string;
  readonly maxRows: number;
  readonly maxCodePoints: number;
}

export interface CompactionClaim {
  readonly runId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly fence: number;
}

export type ArchiveTurnStatus =
  | "open"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

export type CompactionRunState =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "completed";

export type CompactionSectionStatus = "staged" | "published" | "invalidated";

export type ContextGenerationStatus =
  | "active"
  | "superseded"
  | "invalidated";

export type ArchiveIndexState = "absent" | "indexing" | "complete" | "stale";

/** Opaque source ID encoding (versioned, not an authorization credential). */
export interface OpaqueSourceIdPayload {
  readonly v: 1;
  readonly epoch: string;
  readonly revision: number;
  readonly rowId: number;
  readonly field: "content" | "tool_receipt";
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface SummaryFact {
  readonly text: string;
  readonly status: "proposed" | "accepted" | "superseded" | "uncertain";
  readonly sourceIds: readonly string[];
}

export interface SectionSummaryV1 {
  readonly version: 1;
  readonly synopsis: string;
  readonly decisions: readonly SummaryFact[];
  readonly constraints: readonly SummaryFact[];
  readonly pending: readonly SummaryFact[];
  readonly toolOutcomes: readonly SummaryFact[];
  readonly topics: readonly string[];
}

/** Error codes (technical-design §16). */
export type RecoverableHistoryErrorCode =
  | "HISTORY_NO_MATCH"
  | "HISTORY_PARTIAL_SCAN"
  | "SOURCE_CHANGED"
  | "SOURCE_UNAVAILABLE"
  | "HISTORY_SCOPE_INVALID"
  | "COMPACTION_BUSY"
  | "COMPACTION_OUTPUT_INVALID"
  | "COMPACTION_CONTEXT_REJECTED"
  | "COMPACTION_STALE_CLAIM"
  | "COMPACTION_STORAGE_FAILED"
  | "CONTEXT_REQUIRED_CONTENT_TOO_LARGE"
  | "MODEL_BUDGET_UNAVAILABLE";

export class RecoverableHistoryError extends Error {
  readonly code: RecoverableHistoryErrorCode;
  constructor(code: RecoverableHistoryErrorCode, message: string) {
    super(message);
    this.name = "RecoverableHistoryError";
    this.code = code;
  }
}
```

- [ ] **Step 1.3: Create the Unicode code-point text utility**

`src/service/AIChatArchiveTextUtil.ts`:

```typescript
/**
 * Unicode code-point offset helpers. Archive offsets count Unicode code
 * points (U+0000..U+10FFFF), NOT UTF-16 code units or grapheme clusters.
 * This keeps substr/length semantics stable regardless of JS string
 * representation (surrogate pairs, combining marks).
 */

/** Count code points in a string. */
export function codePointLength(text: string): number {
  // Array.from splits by code points (iterating the string's code-point
  // iterator), but allocates. For bounded fragments this is acceptable.
  let count = 0;
  // Manual walk avoids the array allocation for large messages.
  const len = text.length;
  for (let i = 0; i < len; ) {
    const code = text.charCodeAt(i);
    // High surrogate → consume the pair as one code point.
    i += code >= 0xd800 && code <= 0xdbff && i + 1 < len ? 2 : 1;
    count += 1;
  }
  return count;
}

/** Slice a string by code-point offsets [start, end). */
export function sliceByCodePoints(
  text: string,
  start: number,
  end: number
): string {
  if (start < 0) start = 0;
  if (end < 0) end = 0;
  if (start >= end) return "";
  let count = 0;
  let startUtf16 = -1;
  const len = text.length;
  for (let i = 0; i < len; ) {
    if (count === start) startUtf16 = i;
    const code = text.charCodeAt(i);
    i += code >= 0xd800 && code <= 0xdbff && i + 1 < len ? 2 : 1;
    count += 1;
    if (count >= end) {
      const s = startUtf16 < 0 ? 0 : startUtf16;
      return text.slice(s, i);
    }
  }
  // Reached end before count; return the suffix from startUtf16.
  const s = startUtf16 < 0 ? 0 : startUtf16;
  return text.slice(s);
}

/**
 * Convert a code-point offset to a 1-based start position usable with
 * SQLite `substr(content, :startPlusOne, :length)` plus a code-point length.
 * Returns null if the offset is beyond the string.
 */
export function codePointOffsetToSqlSubstr(
  text: string,
  startCodePoint: number,
  endCodePoint: number
): { startPlusOne: number; lengthCodePoints: number } | null {
  const total = codePointLength(text);
  if (startCodePoint >= total) return null;
  const clampedEnd = Math.min(endCodePoint, total);
  return {
    startPlusOne: startCodePoint + 1,
    lengthCodePoints: clampedEnd - startCodePoint,
  };
}
```

- [ ] **Step 1.4: Create the opaque cursor codec**

`src/service/AIChatArchiveCursorCodec.ts`:

```typescript
import { z } from "zod/v4";
import type { OpaqueSourceIdPayload } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Versioned opaque cursor codec. Cursors are NOT authorization credentials:
 * decode with strict length/schema bounds, validate epoch/revision + query
 * hash + snapshot bounds against trusted context, and reject unknown
 * versions. A caller-modified cursor must never widen conversation scope.
 * Source text is never embedded in cursor payloads.
 */

const CURSOR_VERSION = 1;

const cursorPayloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  conversationId: z.string().max(100),
  epoch: z.string().max(64),
  revision: z.number().int().nonnegative(),
  queryHash: z.string().max(64).optional(),
  lastTimestampMs: z.number().int().nonnegative(),
  lastRowId: z.number().int().nonnegative(),
  direction: z.enum(["forward", "reverse"]).default("forward"),
});

export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  // Base64-URL so the cursor is opaque to the model; not encrypted.
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(
  raw: unknown,
  expectedConversationId: string,
  expectedEpoch: string
): CursorPayload | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) {
    return null;
  }
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  const data = result.data;
  // Strict scope: cursor must reference the same conversation + epoch.
  if (
    data.conversationId !== expectedConversationId ||
    data.epoch !== expectedEpoch
  ) {
    return null;
  }
  return data;
}

/** Encode an opaque source ID (used in retrieval results). */
export function encodeSourceId(payload: OpaqueSourceIdPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

const sourceIdPayloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  epoch: z.string().max(64),
  revision: z.number().int().nonnegative(),
  rowId: z.number().int().positive(),
  field: z.enum(["content", "tool_receipt"]),
  startCodePoint: z.number().int().nonnegative(),
  endCodePoint: z.number().int().nonnegative(),
});

export function decodeSourceId(
  raw: unknown,
  expectedEpoch: string
): OpaqueSourceIdPayload | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = sourceIdPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.epoch !== expectedEpoch) return null;
  if (result.data.endCodePoint < result.data.startCodePoint) return null;
  return result.data;
}
```

- [ ] **Step 1.5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "AIChatRecoverableDefaults|aiChatArchiveTypes|AIChatArchiveTextUtil|AIChatArchiveCursorCodec" | head
git add src/service/AIChatRecoverableDefaults.ts src/entityTypes/aiChatArchiveTypes.ts src/service/AIChatArchiveTextUtil.ts src/service/AIChatArchiveCursorCodec.ts
git commit -m "feat: add recoverable-history shared types, defaults, text + cursor utils"
```

---

### Task 2: Archive entities and registration

**Files:**
- Create: `src/entity/AIChatArchiveState.entity.ts`
- Create: `src/entity/AIChatArchiveTurn.entity.ts`
- Create: `src/entity/AIChatArchiveEntry.entity.ts`
- Create: `src/entity/AIChatCompactionRun.entity.ts`
- Create: `src/entity/AIChatCompactionSection.entity.ts`
- Create: `src/entity/AIChatContextGeneration.entity.ts`
- Create: `src/entity/AIChatArchiveSearchFragment.entity.ts`
- Modify: `src/config/SqliteDb.ts`

- [ ] **Step 2.1: Create `AIChatArchiveStateEntity`**

`src/entity/AIChatArchiveState.entity.ts`:

```typescript
import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryColumn,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_archive_state")
export class AIChatArchiveStateEntity extends AuditableEntity {
  @PrimaryColumn("varchar", { length: 100 })
  @Order(1)
  conversationId: string;

  @Column("varchar", { length: 64, nullable: false })
  @Order(2)
  epoch: string;

  @Column("int", { nullable: false, default: 0 })
  @Order(3)
  sourceRevision: number;

  @Column("bigint", { nullable: false, default: 0 })
  @Order(4)
  highWaterTimestampMs: number;

  @Column("int", { nullable: false, default: 0 })
  @Order(5)
  highWaterRowId: number;

  @Column("varchar", { length: 100, nullable: true })
  @Order(6)
  activeGenerationId?: string;

  @Column("varchar", { length: 100, nullable: true })
  @Order(7)
  activeRunId?: string;

  @Column("varchar", { length: 100, nullable: true })
  @Order(8)
  leaseOwner?: string;

  @Column("bigint", { nullable: true })
  @Order(9)
  leaseUntilMs?: number;

  @Column("int", { nullable: false, default: 0 })
  @Order(10)
  fence: number;

  @Column("text", { nullable: true })
  @Order(11)
  indexCursorJson?: string;

  @Column("varchar", { length: 20, nullable: false, default: "absent" })
  @Order(12)
  indexState: string;

  @Column("int", { nullable: false, default: 1 })
  @Order(13)
  schemaVersion: number;

  @Column("datetime", { nullable: true })
  @Order(14)
  deletedAt?: Date;
}
```

- [ ] **Step 2.2: Create `AIChatArchiveTurnEntity`**

`src/entity/AIChatArchiveTurn.entity.ts`:

```typescript
import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_archive_turns")
@Unique("uq_archive_turns_conv_epoch_turn", [
  "conversationId",
  "epoch",
  "turnId",
])
@Index("idx_archive_turns_status", [
  "conversationId",
  "epoch",
  "status",
  "lastTimestampMs",
  "lastRowId",
])
export class AIChatArchiveTurnEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: false })
  turnId: string;

  @Order(4)
  @Column("bigint", { nullable: false, default: 0 })
  firstTimestampMs: number;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  firstRowId: number;

  @Order(6)
  @Column("bigint", { nullable: false, default: 0 })
  lastTimestampMs: number;

  @Order(7)
  @Column("int", { nullable: false, default: 0 })
  lastRowId: number;

  @Order(8)
  @Column("varchar", { length: 20, nullable: false, default: "open" })
  status: string;

  @Order(9)
  @Column("datetime", { nullable: true })
  completedAt?: Date;

  @Order(10)
  @Column("varchar", { length: 20, nullable: false, default: "native" })
  confidence: string; // "native" | "inferred"
}
```

- [ ] **Step 2.3: Create `AIChatArchiveEntryEntity`**

`src/entity/AIChatArchiveEntry.entity.ts`:

```typescript
import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_archive_entries")
@Unique("uq_archive_entries_conv_epoch_row", [
  "conversationId",
  "epoch",
  "sourceRowId",
])
@Index("idx_archive_entries_turn", [
  "conversationId",
  "epoch",
  "turnId",
  "timestampMs",
  "sourceRowId",
])
@Index("idx_archive_entries_tool", [
  "conversationId",
  "epoch",
  "toolCallId",
  "messageType",
])
export class AIChatArchiveEntryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(3)
  @Column("int", { nullable: false })
  sourceRowId: number;

  @Order(4)
  @Column("bigint", { nullable: false, default: 0 })
  timestampMs: number;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  sourceRevision: number;

  @Order(6)
  @Column("varchar", { length: 100, nullable: true })
  turnId?: string;

  @Order(7)
  @Column("varchar", { length: 20, nullable: false })
  messageType: string;

  @Order(8)
  @Column("varchar", { length: 100, nullable: true })
  toolCallId?: string;

  @Order(9)
  @Column("int", { nullable: true })
  pairedSourceRowId?: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  contentCodePointLength: number;

  @Order(11)
  @Column("varchar", { length: 100, nullable: false })
  messageId: string;
}
```

- [ ] **Step 2.4: Create `AIChatCompactionRunEntity`**

`src/entity/AIChatCompactionRun.entity.ts`:

```typescript
import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_compaction_runs")
@Unique("uq_compaction_runs_runid", ["runId"])
@Index("idx_compaction_runs_conv_state", [
  "conversationId",
  "epoch",
  "state",
])
export class AIChatCompactionRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  runId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(4)
  @Column("int", { nullable: false })
  revision: number;

  @Order(5)
  @Column("varchar", { length: 30, nullable: false })
  trigger: string;

  @Order(6)
  @Column("varchar", { length: 20, nullable: false, default: "queued" })
  state: string;

  @Order(7)
  @Column("bigint", { nullable: false, default: 0 })
  snapshotEndTimestampMs: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  snapshotEndRowId: number;

  @Order(9)
  @Column("bigint", { nullable: false, default: 0 })
  retainedStartTimestampMs: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  retainedStartRowId: number;

  @Order(11)
  @Column("varchar", { length: 100, nullable: true })
  baseGenerationId?: string;

  @Order(12)
  @Column("text", { nullable: true })
  stagedCursorJson?: string;

  @Order(13)
  @Column("text", { nullable: true })
  publishedCursorJson?: string;

  @Order(14)
  @Column("text", { nullable: true })
  workingOverviewJson?: string;

  @Order(15)
  @Column("text", { nullable: true })
  continuationStateJson?: string;

  @Order(16)
  @Column("int", { nullable: false, default: 0 })
  mergedThroughOrdinal: number;

  @Order(17)
  @Column("int", { nullable: false, default: 0 })
  fence: number;

  @Order(18)
  @Column("varchar", { length: 100, nullable: true })
  leaseOwner?: string;

  @Order(19)
  @Column("bigint", { nullable: true })
  leaseUntilMs?: number;

  @Order(20)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(21)
  @Column("int", { nullable: false, default: 0 })
  attemptCount: number;

  @Order(22)
  @Column("int", { nullable: false, default: 0 })
  contextReductionCount: number;

  @Order(23)
  @Column("varchar", { length: 50, nullable: true })
  lastFailureCode?: string;

  @Order(24)
  @Column("int", { nullable: false, default: 1 })
  schemaVersion: number;
}
```

- [ ] **Step 2.5: Create `AIChatCompactionSectionEntity`**

`src/entity/AIChatCompactionSection.entity.ts`:

```typescript
import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_compaction_sections")
@Unique("uq_compaction_sections_workkey", [
  "conversationId",
  "epoch",
  "workKey",
])
@Index("idx_compaction_sections_ordinal", [
  "conversationId",
  "epoch",
  "ordinal",
])
export class AIChatCompactionSectionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  sectionId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(4)
  @Column("int", { nullable: false })
  revision: number;

  @Order(5)
  @Column("int", { nullable: false })
  ordinal: number;

  @Order(6)
  @Column("varchar", { length: 128, nullable: false })
  workKey: string;

  @Order(7)
  @Column("bigint", { nullable: false, default: 0 })
  sourceStartTimestampMs: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  sourceStartRowId: number;

  @Order(9)
  @Column("bigint", { nullable: false, default: 0 })
  sourceEndTimestampMs: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  sourceEndRowId: number;

  @Order(11)
  @Column("text", { nullable: false })
  sourceManifestJson: string;

  @Order(12)
  @Column("text", { nullable: false })
  summaryJson: string;

  @Order(13)
  @Column("int", { nullable: true })
  inputTokenEstimate?: number;

  @Order(14)
  @Column("int", { nullable: true })
  outputTokenEstimate?: number;

  @Order(15)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(16)
  @Column("varchar", { length: 20, nullable: false, default: "staged" })
  status: string;

  @Order(17)
  @Column("varchar", { length: 64, nullable: true })
  sourceHash?: string;

  @Order(18)
  @Column("varchar", { length: 20, nullable: false, default: "v1" })
  promptSchemaVersion: string;
}
```

- [ ] **Step 2.6: Create `AIChatContextGenerationEntity`**

`src/entity/AIChatContextGeneration.entity.ts`:

```typescript
import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_context_generations")
@Unique("uq_context_generations_genid", ["generationId"])
@Index("idx_context_generations_conv", [
  "conversationId",
  "epoch",
  "status",
])
export class AIChatContextGenerationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  generationId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(4)
  @Column("int", { nullable: false })
  revision: number;

  @Order(5)
  @Column("varchar", { length: 100, nullable: true })
  parentGenerationId?: string;

  @Order(6)
  @Column("int", { nullable: false, default: 0 })
  representedSectionOrdinal: number;

  @Order(7)
  @Column("bigint", { nullable: false, default: 0 })
  coveredThroughTimestampMs: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  coveredThroughRowId: number;

  @Order(9)
  @Column("text", { nullable: false })
  overviewJson: string;

  @Order(10)
  @Column("text", { nullable: true })
  continuationStateJson?: string;

  @Order(11)
  @Column("int", { nullable: true })
  tokenEstimate?: number;

  @Order(12)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(13)
  @Column("varchar", { length: 20, nullable: true })
  schemaVersion?: string;

  @Order(14)
  @Column("varchar", { length: 20, nullable: false, default: "active" })
  status: string;
}
```

- [ ] **Step 2.7: Create `AIChatArchiveSearchFragmentEntity`**

`src/entity/AIChatArchiveSearchFragment.entity.ts`:

```typescript
import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_archive_search_fragments")
@Unique("uq_archive_fragments_row_offset", [
  "conversationId",
  "sourceRowId",
  "field",
  "startCodePoint",
])
@Index("idx_archive_fragments_conv_row", [
  "conversationId",
  "sourceRowId",
])
export class AIChatArchiveSearchFragmentEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("int", { nullable: false })
  sourceRowId: number;

  @Order(3)
  @Column("varchar", { length: 20, nullable: false })
  field: string; // "content" | "tool_receipt"

  @Order(4)
  @Column("int", { nullable: false })
  startCodePoint: number;

  @Order(5)
  @Column("int", { nullable: false })
  endCodePoint: number;

  @Order(6)
  @Column("text", { nullable: false })
  fragmentText: string;
}
```

- [ ] **Step 2.8: Register the 7 new entities in `SqliteDb.ts`**

In `src/config/SqliteDb.ts`, locate the entities array (around line 477) and add the seven new entity imports + entries alongside `AIChatCompactSummaryEntity` (line 576):

```typescript
import { AIChatArchiveStateEntity } from "@/entity/AIChatArchiveState.entity";
import { AIChatArchiveTurnEntity } from "@/entity/AIChatArchiveTurn.entity";
import { AIChatArchiveEntryEntity } from "@/entity/AIChatArchiveEntry.entity";
import { AIChatCompactionRunEntity } from "@/entity/AIChatCompactionRun.entity";
import { AIChatCompactionSectionEntity } from "@/entity/AIChatCompactionSection.entity";
import { AIChatContextGenerationEntity } from "@/entity/AIChatContextGeneration.entity";
import { AIChatArchiveSearchFragmentEntity } from "@/entity/AIChatArchiveSearchFragment.entity";
```

Then in the `entities: [...]` array, after `AIChatCompactSummaryEntity`:

```typescript
    AIChatArchiveStateEntity,
    AIChatArchiveTurnEntity,
    AIChatArchiveEntryEntity,
    AIChatCompactionRunEntity,
    AIChatCompactionSectionEntity,
    AIChatContextGenerationEntity,
    AIChatArchiveSearchFragmentEntity,
```

- [ ] **Step 2.9: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "Archive|CompactionRun|CompactionSection|ContextGeneration|SearchFragment" | head
git add src/entity/AIChatArchiveState.entity.ts src/entity/AIChatArchiveTurn.entity.ts src/entity/AIChatArchiveEntry.entity.ts src/entity/AIChatCompactionRun.entity.ts src/entity/AIChatCompactionSection.entity.ts src/entity/AIChatContextGeneration.entity.ts src/entity/AIChatArchiveSearchFragment.entity.ts src/config/SqliteDb.ts
git commit -m "feat: add 7 archive/compaction entities and register in SqliteDb"
```

---

### Task 3: Bounded archive Model reads (TDD)

**Files:**
- Create: `src/model/AIChatMessageArchive.model.ts`
- Create: `src/model/AIChatArchiveState.model.ts`
- Create: `test/vitest/main/AIChatArchiveModel.test.ts`

- [ ] **Step 3.1: Write the failing tests**

`test/vitest/main/AIChatArchiveModel.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import { MessageType } from "@/entityTypes/commonType";

let dbpath: string;

beforeAll(async () => {
  dbpath = path.join(os.tmpdir(), `aifetchly-archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dbpath, { recursive: true });
  await SqliteDb.resetInstance(dbpath);
  await SqliteDb.ensureInitialized();
});

afterAll(async () => {
  await SqliteDb.destroyInstance();
  fs.rmSync(dbpath, { recursive: true, force: true });
});

async function seedMessages(conversationId: string, rows: Array<{ role: string; content: string; ts: number }>): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(AIChatMessageEntity);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entity = new AIChatMessageEntity();
    entity.messageId = `msg-${conversationId}-${i}`;
    entity.conversationId = conversationId;
    entity.role = r.role;
    entity.content = r.content;
    entity.timestamp = new Date(r.ts);
    entity.messageType = MessageType.MESSAGE;
    await repo.save(entity);
  }
}

describe("AIChatArchiveStateModel", () => {
  it("creates state with a random epoch and revision 0", async () => {
    const model = new AIChatArchiveStateModel(dbpath);
    const state = await model.ensureState("conv-epoch-1");
    expect(state.epoch.length).toBeGreaterThan(0);
    expect(state.sourceRevision).toBe(0);
    expect(state.conversationId).toBe("conv-epoch-1");
  });

  it("is idempotent — ensureState returns existing epoch", async () => {
    const model = new AIChatArchiveStateModel(dbpath);
    const first = await model.ensureState("conv-epoch-2");
    const second = await model.ensureState("conv-epoch-2");
    expect(second.epoch).toBe(first.epoch);
  });

  it("invalidates epoch on tombstone (deletedAt set)", async () => {
    const model = new AIChatArchiveStateModel(dbpath);
    await model.ensureState("conv-epoch-3");
    await model.tombstone("conv-epoch-3");
    const state = await model.getState("conv-epoch-3");
    expect(state?.deletedAt).toBeDefined();
  });
});

describe("AIChatMessageArchiveModel keyset reads", () => {
  it("reads forward in (timestamp, id) order with cursor continuation", async () => {
    await seedMessages("conv-read-1", [
      { role: "user", content: "first", ts: 1_000 },
      { role: "assistant", content: "second", ts: 2_000 },
      { role: "user", content: "third", ts: 2_000 }, // same ts, higher id
    ]);
    const model = new AIChatMessageArchiveModel(dbpath);
    const page1 = await model.readPageForward({
      conversationId: "conv-read-1",
      maxRows: 2,
      maxCodePoints: 100_000,
    });
    expect(page1.records).toHaveLength(2);
    expect(page1.records[0].content).toBe("first");
    expect(page1.records[1].content).toBe("second");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await model.readPageForward({
      conversationId: "conv-read-1",
      cursor: page1.nextCursor ?? undefined,
      maxRows: 2,
      maxCodePoints: 100_000,
    });
    expect(page2.records).toHaveLength(1);
    expect(page2.records[0].content).toBe("third");
    expect(page2.nextCursor).toBeNull();
  });

  it("respects snapshot upper bound (keyset ≤ snapshot)", async () => {
    await seedMessages("conv-read-2", [
      { role: "user", content: "a", ts: 1_000 },
      { role: "assistant", content: "b", ts: 2_000 },
      { role: "user", content: "c", ts: 3_000 },
    ]);
    const model = new AIChatMessageArchiveModel(dbpath);
    const page = await model.readPageForward({
      conversationId: "conv-read-2",
      maxRows: 64,
      maxCodePoints: 100_000,
      snapshotTimestampMs: 2_000,
    });
    expect(page.records.map((r) => r.content)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 3.2: Run tests (expect RED)**

```bash
yarn testmain test/vitest/main/AIChatArchiveModel.test.ts 2>&1 | tail -20
```

- [ ] **Step 3.3: Implement `AIChatArchiveStateModel`**

`src/model/AIChatArchiveState.model.ts`:

```typescript
import { BaseDb } from "@/model/Basedb";
import { AIChatArchiveStateEntity } from "@/entity/AIChatArchiveState.entity";
import { Repository } from "typeorm";

export class AIChatArchiveStateModel extends BaseDb {
  public repository: Repository<AIChatArchiveStateEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveStateEntity
    );
  }

  async getState(
    conversationId: string
  ): Promise<AIChatArchiveStateEntity | null> {
    return this.repository.findOne({ where: { conversationId } });
  }

  /**
   * Create archive state for a conversation with a fresh random epoch, or
   * return existing state. Does NOT resurrect a tombstoned conversation.
   */
  async ensureState(
    conversationId: string
  ): Promise<AIChatArchiveStateEntity> {
    return this.sqliteDb.connection.transaction(async (manager) => {
      const repo = manager.getRepository(AIChatArchiveStateEntity);
      const existing = await repo.findOne({
        where: { conversationId },
      });
      if (existing && !existing.deletedAt) return existing;
      const entity = new AIChatArchiveStateEntity();
      entity.conversationId = conversationId;
      entity.epoch = crypto.randomUUID();
      entity.sourceRevision = 0;
      entity.highWaterTimestampMs = 0;
      entity.highWaterRowId = 0;
      entity.indexState = "absent";
      entity.schemaVersion = 1;
      return repo.save(entity);
    });
  }

  async tombstone(conversationId: string): Promise<void> {
    await this.repository.update(
      { conversationId },
      { deletedAt: new Date(), sourceRevision: () => "sourceRevision + 1", fence: () => "fence + 1", activeRunId: undefined, leaseOwner: undefined, leaseUntilMs: undefined }
    );
  }

  async updateHighWater(
    conversationId: string,
    timestampMs: number,
    rowId: number
  ): Promise<void> {
    await this.repository.update(
      { conversationId },
      { highWaterTimestampMs: timestampMs, highWaterRowId: rowId }
    );
  }

  async incrementRevision(conversationId: string): Promise<void> {
    await this.repository.update(
      { conversationId },
      { sourceRevision: () => "sourceRevision + 1" }
    );
  }
}
```

- [ ] **Step 3.4: Implement `AIChatMessageArchiveModel`**

`src/model/AIChatMessageArchive.model.ts`:

```typescript
import { BaseDb } from "@/model/Basedb";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { Repository, LessThan, MoreThan, Brackets } from "typeorm";
import {
  decodeCursor,
  encodeCursor,
} from "@/service/AIChatArchiveCursorCodec";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";

export interface ArchiveReadPageInternal {
  records: AIChatMessageEntity[];
  nextCursor: string | null;
  truncated: boolean;
}

export interface ReadPageForwardInput {
  conversationId: string;
  cursor?: string;
  maxRows: number;
  maxCodePoints: number;
  snapshotTimestampMs?: number;
  snapshotRowId?: number;
}

export class AIChatMessageArchiveModel extends BaseDb {
  public repository: Repository<AIChatMessageEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatMessageEntity
    );
  }

  /**
   * Bounded keyset read in (timestamp, id) ASC order. Honors an optional
   * snapshot upper bound so compaction reads an immutable prefix. Uses a
   * metadata-page row cap plus a decoded-text byte allowance.
   */
  async readPageForward(
    input: ReadPageForwardInput
  ): Promise<ArchiveReadPageInternal> {
    const stateModel = new AIChatArchiveStateModel(
      this.sqliteDb.dbPath as string
    );
    const state = await stateModel.getState(input.conversationId);
    const epoch = state?.epoch ?? "";
    const pageLimit = Math.min(
      input.maxRows,
      AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows
    );

    let lastTimestampMs = 0;
    let lastRowId = 0;
    if (input.cursor) {
      const decoded = decodeCursor(input.cursor, input.conversationId, epoch);
      if (!decoded) {
        throw new Error("HISTORY_SCOPE_INVALID: invalid cursor");
      }
      lastTimestampMs = decoded.lastTimestampMs;
      lastRowId = decoded.lastRowId;
    }

    const qb = this.repository
      .createQueryBuilder("m")
      .where("m.conversationId = :conversationId", {
        conversationId: input.conversationId,
      })
      .andWhere(
        new Brackets((qb) => {
          qb.where("m.timestamp > :lastTs", {
            lastTs: new Date(lastTimestampMs),
          }).orWhere(
            "m.timestamp = :lastTs2 AND m.id > :lastId",
            { lastTs2: new Date(lastTimestampMs), lastId: lastRowId }
          );
        })
      );

    if (input.snapshotTimestampMs !== undefined) {
      const snapDate = new Date(input.snapshotTimestampMs);
      const snapRow = input.snapshotRowId ?? Number.MAX_SAFE_INTEGER;
      qb.andWhere(
        new Brackets((qb) => {
          qb.where("m.timestamp < :snapTs", { snapTs: snapDate }).orWhere(
            "m.timestamp = :snapTs2 AND m.id <= :snapId",
            { snapTs2: snapDate, snapId: snapRow }
          );
        })
      );
    }

    qb.orderBy("m.timestamp", "ASC")
      .addOrderBy("m.id", "ASC")
      .take(pageLimit);

    const rows = await qb.getMany();

    // Enforce decoded-text byte allowance.
    let bytes = 0;
    const kept: AIChatMessageEntity[] = [];
    let truncated = false;
    for (const row of rows) {
      const rowBytes = Buffer.byteLength(row.content ?? "", "utf8");
      if (bytes + rowBytes > input.maxCodePoints * 4) {
        truncated = rows.length === pageLimit;
        break;
      }
      kept.push(row);
      bytes += rowBytes;
    }

    const hasMore = kept.length > 0 && rows.length === pageLimit;
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = kept[kept.length - 1];
      nextCursor = encodeCursor({
        v: 1,
        conversationId: input.conversationId,
        epoch,
        revision: state?.sourceRevision ?? 0,
        lastTimestampMs: last.timestamp.getTime(),
        lastRowId: last.id,
        direction: "forward",
      });
    }

    return { records: kept, nextCursor, truncated };
  }

  /**
   * Bounded recent-history read in DESC order (for the retained suffix).
   */
  async readRecent(
    conversationId: string,
    maxRows: number,
    maxCodePoints: number
  ): Promise<AIChatMessageEntity[]> {
    const rows = await this.repository.find({
      where: { conversationId },
      order: { timestamp: "DESC", id: "DESC" },
      take: Math.min(maxRows, AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows),
    });
    // Reverse to chronological for caller.
    return rows.reverse().slice(0, maxRows);
  }

  /**
   * Bounded substring read of a single message's content by code-point
   * offsets. Uses SQLite substr with a 1-based start.
   */
  async readSourceSlice(
    rowId: number,
    startCodePoint: number,
    endCodePoint: number
  ): Promise<string | null> {
    const raw = await this.repository
      .createQueryBuilder("m")
      .select(["m.content"])
      .where("m.id = :rowId", { rowId })
      .getRawOne<{ m_content: string } | undefined>();
    if (!raw) return null;
    // Use the code-point text util to slice exactly; SQLite substr semantics
    // differ across builds, so we slice in-process after a bounded fetch.
    const { sliceByCodePoints } = await import("@/service/AIChatArchiveTextUtil");
    return sliceByCodePoints(raw.m_content, startCodePoint, endCodePoint);
  }
}
```

- [ ] **Step 3.5: Run tests (expect GREEN)**

```bash
yarn testmain test/vitest/main/AIChatArchiveModel.test.ts 2>&1 | tail -20
```

- [ ] **Step 3.6: Commit**

```bash
git add src/model/AIChatMessageArchive.model.ts src/model/AIChatArchiveState.model.ts test/vitest/main/AIChatArchiveModel.test.ts
git commit -m "feat: bounded keyset/substring archive Model reads with cursor continuation"
```

---

### Task 4: Archive Module + retrieval service + tools (TDD)

**Files:**
- Create: `src/modules/AIChatArchiveModule.ts`
- Create: `src/service/AIChatHistoryRetrievalService.ts`
- Create: `src/schemas/aiChatHistoryTools.ts`
- Create: `src/service/agentTools/conversationHistorySearchTool.ts`
- Create: `src/service/agentTools/conversationHistoryReadTool.ts`
- Create: `test/vitest/main/AIChatHistoryRetrievalService.test.ts`

> The remaining Tasks 4–9 follow the same TDD cadence. The code below is complete and ready to paste; the implementing agent should still write the test first, watch it fail, then implement, then commit per task.

- [ ] **Step 4.1: Write the failing retrieval service tests**

`test/vitest/main/AIChatHistoryRetrievalService.test.ts` (sketch — asserting scope isolation + budget + dedup):

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
// ... per-run temp DB setup as in Task 3 ...

describe("AIChatHistoryRetrievalService", () => {
  it("rejects search query over 200 chars with HISTORY_SCOPE_INVALID", async () => {
    const svc = new AIChatHistoryRetrievalService(archiveModule);
    const long = "x".repeat(201);
    const res = await svc.search({ conversationId: "c1", query: long });
    expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
  });

  it("returns HISTORY_NO_MATCH only when scan_complete is true", async () => {
    const res = await svc.search({ conversationId: "c1", query: "absent-term" });
    expect(res.scanComplete).toBe(true);
    expect(res.records).toHaveLength(0);
  });

  it("deduplicates overlapping retrieved source intervals", async () => {
    // read same source twice, assert merged interval count
  });

  it("enforces max 4 retrieval calls per turn", async () => {
    // call 5 times, 5th returns budget-exhausted
  });
});
```

- [ ] **Step 4.2: Run tests (RED)**

```bash
yarn testmain test/vitest/main/AIChatHistoryRetrievalService.test.ts 2>&1 | tail
```

- [ ] **Step 4.3: Implement the Zod tool schemas**

`src/schemas/aiChatHistoryTools.ts`:

```typescript
import { z } from "zod/v4";

export const conversationHistorySearchInputSchema = z.object({
  query: z.string().min(1).max(200),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  types: z.array(z.enum(["user", "assistant", "system", "tool"])).max(4).optional(),
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export const conversationHistoryReadInputSchema = z
  .object({
    source_id: z.string().max(2048).optional(),
    message_id: z.string().max(100).optional(),
    from_source_id: z.string().max(2048).optional(),
    to_source_id: z.string().max(2048).optional(),
    neighbors: z.number().int().min(0).max(2).optional(),
    cursor: z.string().max(1024).optional(),
  })
  .refine(
    (v) => {
      const hasSingle = !!v.source_id || !!v.message_id;
      const hasRange = !!v.from_source_id && !!v.to_source_id;
      return hasSingle !== hasRange; // exactly one of the two modes
    },
    { message: "Provide exactly one of source_id/message_id or from_source_id+to_source_id" }
  );

export type ConversationHistorySearchInput = z.infer<
  typeof conversationHistorySearchInputSchema
>;
export type ConversationHistoryReadInput = z.infer<
  typeof conversationHistoryReadInputSchema
>;
```

- [ ] **Step 4.4: Implement the retrieval service**

`src/service/AIChatHistoryRetrievalService.ts` (key methods; full implementation handles scope isolation, budget, dedup, cursor binding):

```typescript
import { z } from "zod/v4";
import type { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import {
  AI_CHAT_RECOVERABLE_DEFAULTS,
} from "@/service/AIChatRecoverableDefaults";
import {
  RecoverableHistoryError,
  type HistoryExcerpt,
  type ArchiveReadPage,
} from "@/entityTypes/aiChatArchiveTypes";
import { conversationHistorySearchInputSchema } from "@/schemas/aiChatHistoryTools";

export interface RetrievalTurnBudget {
  consumedTokens: number;
  callCount: number;
  mergedIntervals: ReadonlySet<string>;
}

export class AIChatHistoryRetrievalService {
  constructor(private readonly archive: AIChatArchiveModule) {}

  async search(input: {
    conversationId: string;
    query: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    records: HistoryExcerpt[];
    nextCursor: string | null;
    scanComplete: boolean;
    indexComplete: boolean;
    errorCode?: string;
  }> {
    const parsed = conversationHistorySearchInputSchema.safeParse({
      query: input.query,
      cursor: input.cursor,
      limit: input.limit,
    });
    if (!parsed.success) {
      return {
        records: [],
        nextCursor: null,
        scanComplete: true,
        indexComplete: false,
        errorCode: "HISTORY_SCOPE_INVALID",
      };
    }
    // Literal search across bounded fragments; FTS acceleration optional.
    const page: ArchiveReadPage = await this.archive.searchPage({
      conversationId: input.conversationId,
      query: parsed.data.query,
      cursor: parsed.data.cursor,
      maxFragments: AI_CHAT_RECOVERABLE_DEFAULTS.searchMaxFragmentsPerPage,
      maxMs: AI_CHAT_RECOVERABLE_DEFAULTS.searchMaxMsPerPage,
    });
    return {
      records: page.records,
      nextCursor: page.nextCursor,
      scanComplete: page.nextCursor === null,
      indexComplete: true,
    };
  }

  // ... read(), resolveSelections() follow the same pattern: parse, budget
  // check, call archive module, format, map errors. See design §7.2.
}
```

- [ ] **Step 4.5: Implement the archive Module**

`src/modules/AIChatArchiveModule.ts` (extends BaseModule; delegates to Models; the `searchPage`/`readPage`/`getRecentTurns`/`getToolPair`/`resolveSelections` operations from design §6):

```typescript
import { BaseModule } from "@/modules/baseModule";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveEntryModel } from "@/model/AIChatArchiveEntry.model";
import { AIChatArchiveTurnModel } from "@/model/AIChatArchiveTurn.model";
import { encodeSourceId } from "@/service/AIChatArchiveCursorCodec";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import type {
  ArchiveReadPage,
  ArchivePageRequest,
  HistoryExcerpt,
} from "@/entityTypes/aiChatArchiveTypes";

export class AIChatArchiveModule extends BaseModule {
  async readPage(request: ArchivePageRequest): Promise<ArchiveReadPage> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(request.conversationId);
    if (!state || state.deletedAt) {
      return { records: [], nextCursor: null, truncated: false, sourceRevision: 0 };
    }
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const page = await msgModel.readPageForward({
      conversationId: request.conversationId,
      cursor: request.cursor,
      maxRows: request.maxRows,
      maxCodePoints: request.maxCodePoints,
    });
    const records: HistoryExcerpt[] = page.records.map((r) => ({
      sourceId: encodeSourceId({
        v: 1,
        epoch: state.epoch,
        revision: state.sourceRevision,
        rowId: r.id,
        field: "content",
        startCodePoint: 0,
        endCodePoint: 0,
      }),
      messageId: r.messageId,
      role: r.role,
      timestamp: r.timestamp.toISOString(),
      text: r.content,
      exact: true,
      redacted: false,
      hasMore: false,
    }));
    return {
      records,
      nextCursor: page.nextCursor,
      truncated: page.truncated,
      sourceRevision: state.sourceRevision,
    };
  }

  // searchPage, readSourceSlice, getRecentTurns, getToolPair, resolveSelections
  // follow the same delegation pattern. Full bodies committed in this task.
}
```

- [ ] **Step 4.6: Implement the tool handlers**

`src/service/agentTools/conversationHistorySearchTool.ts`:

```typescript
import { conversationHistorySearchInputSchema } from "@/schemas/aiChatHistoryTools";
import type { AIChatHistoryRetrievalService } from "@/service/AIChatHistoryRetrievalService";

export interface ConversationToolContext {
  conversationId: string;
  retrievalService: AIChatHistoryRetrievalService;
}

export async function handleConversationHistorySearch(
  args: Record<string, unknown>,
  context: ConversationToolContext
): Promise<{ success: boolean; result: Record<string, unknown> }> {
  const parsed = conversationHistorySearchInputSchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, result: { error: "HISTORY_SCOPE_INVALID", details: parsed.error.issues } };
  }
  const res = await context.retrievalService.search({
    conversationId: context.conversationId,
    query: parsed.data.query,
    cursor: parsed.data.cursor,
    limit: parsed.data.limit,
  });
  return {
    success: true,
    result: {
      records: res.records,
      next_cursor: res.nextCursor,
      truncated: res.nextCursor !== null,
      scan_complete: res.scanComplete,
      index_complete: res.indexComplete,
    },
  };
}
```

`src/service/agentTools/conversationHistoryReadTool.ts` — same pattern with `conversationHistoryReadInputSchema` and `retrievalService.read(...)`.

- [ ] **Step 4.7: Register the two tools in `skillsRegistry.ts`**

In `src/config/skillsRegistry.ts`, add to `BUILT_IN_SKILLS` (modeled on `conversation_tool_history` at line 1108):

```typescript
    {
      name: "conversation_history_search",
      description:
        "Search the current conversation's persisted history for exact phrases. " +
        "Returns bounded excerpts with opaque source IDs; does not search other conversations.",
      tier: "main",
      requiresConfirmation: false,
      permissionCategory: "pure",
      source: "built-in",
      timeoutClass: "fast",
      inputSchema: conversationHistorySearchInputSchema,
      execute: async (args: Record<string, unknown>, context: ToolExecutionContext) => {
        const { handleConversationHistorySearch } = await import("@/service/agentTools/conversationHistorySearchTool");
        return handleConversationHistorySearch(args, {
          conversationId: context.conversationId,
          retrievalService: context.retrievalService,
        });
      },
    },
    {
      name: "conversation_history_read",
      // ... same pattern, references conversationHistoryReadInputSchema + handler
    },
```

- [ ] **Step 4.8: Run tests (GREEN) + commit**

```bash
yarn testmain test/vitest/main/AIChatHistoryRetrievalService.test.ts 2>&1 | tail
git add src/modules/AIChatArchiveModule.ts src/service/AIChatHistoryRetrievalService.ts src/schemas/aiChatHistoryTools.ts src/service/agentTools/conversationHistorySearchTool.ts src/service/agentTools/conversationHistoryReadTool.ts src/config/skillsRegistry.ts test/vitest/main/AIChatHistoryRetrievalService.test.ts
git commit -m "feat: archive Module + retrieval service + history search/read tools"
```

---

## Milestone 2 — Bounded compaction engine (design units 4–6)

### Task 5: Complete-request budget service (TDD)

**Files:**
- Create: `src/service/AIChatRequestBudgetService.ts`
- Modify: `src/service/AIChatQueryLoop.ts` (insert preflight before dispatch)
- Create: `test/vitest/main/AIChatRequestBudgetService.test.ts`

- [ ] **Step 5.1: Write failing tests** asserting `I + O + M <= C`, unknown-model fallback (8192/1024), image non-zero, and that preflight rejects oversized mandatory content with `CONTEXT_REQUIRED_CONTENT_TOO_LARGE`.

- [ ] **Step 5.2: Implement `AIChatRequestBudgetService`** — resolves limits via `AIChatModelCatalogService`, counts all message parts + tool definitions + framing via a conservative UTF-8-byte estimator, exposes `preflight(messages, tools, outputReserve, model)` and `allocateSectionCapacity(C, O, M, overhead)`.

- [ ] **Step 5.3: Insert the guard in `AIChatQueryLoop.ts`** immediately before the `await this.deps.streamChatCompletion(...)` call (around line 1082):

```typescript
      const budget = this.deps.requestBudgetService?.preflight({
        messages,
        tools,
        model,
        outputReserve: maxTokens,
      });
      if (!budget.ok) {
        throw new RecoverableHistoryError(
          budget.mandatoryOversized
            ? "CONTEXT_REQUIRED_CONTENT_TOO_LARGE"
            : "COMPACTION_CONTEXT_REJECTED",
          `request budget rejected: ${budget.reason}`
        );
      }
```

And add `requestBudgetService?: AIChatRequestBudgetService` to `AIChatQueryLoopDeps`.

- [ ] **Step 5.4: Run tests (GREEN) + commit**

```bash
yarn testmain test/vitest/main/AIChatRequestBudgetService.test.ts 2>&1 | tail
git add src/service/AIChatRequestBudgetService.ts src/service/AIChatQueryLoop.ts test/vitest/main/AIChatRequestBudgetService.test.ts
git commit -m "feat: complete-request budget service + final query-loop dispatch guard"
```

---

### Task 6: Section packer + structured summary validator (TDD)

**Files:**
- Create: `src/service/AIChatSectionPacker.ts`
- Create: `src/service/AIChatSummaryValidator.ts`
- Create: `src/service/AIChatCompactionPromptBuilder.ts`
- Create: `test/vitest/main/AIChatSectionPacker.test.ts`
- Create: `test/vitest/main/AIChatSummaryValidator.test.ts`

- [ ] **Step 6.1: Write failing packer tests** — complete turns, oversized message split at code-point boundaries, contiguous fragment coverage, no exclusion before full terminal-turn coverage, interrupted tool as interrupted-not-successful.

- [ ] **Step 6.2: Implement `AIChatSectionPacker`** — reads completed turns strictly after published/staged coverage and before the frozen retained suffix via the archive Module; metadata pages first then bounded source slices; emits a deterministic coverage manifest; splits oversized text at paragraph/sentence boundaries falling back to code-point boundaries; owns the coverage ledger.

- [ ] **Step 6.3: Write failing validator tests** — parse valid SectionSummaryV1, reject unknown source IDs, reject oversized synopsis (>2000 chars) / facts (>500) / >20 facts per category / >4 refs per fact / >20 topics, reject generated permission grants.

- [ ] **Step 6.4: Implement `AIChatSummaryValidator`** — Zod-parse `SectionSummaryV1` locally (do not depend on provider JSON-schema enforcement), validate every `sourceId` against the bounded supplied source map, apply structural caps, reject permission-granting language.

- [ ] **Step 6.5: Implement `AIChatCompactionPromptBuilder`** — versioned structured section/overview prompts requiring no invention, explicit uncertainty, no credentials, preservation of unresolved tasks.

- [ ] **Step 6.6: Run tests (GREEN) + commit**

```bash
yarn testmain test/vitest/main/AIChatSectionPacker.test.ts test/vitest/main/AIChatSummaryValidator.test.ts 2>&1 | tail
git add src/service/AIChatSectionPacker.ts src/service/AIChatSummaryValidator.ts src/service/AIChatCompactionPromptBuilder.ts test/vitest/main/AIChatSectionPacker.test.ts test/vitest/main/AIChatSummaryValidator.test.ts
git commit -m "feat: section packer + structured summary validator + versioned prompts"
```

---

### Task 7: Compaction Module + coordinator (TDD)

**Files:**
- Create: `src/model/AIChatCompactionRun.model.ts`
- Create: `src/model/AIChatCompactionSection.model.ts`
- Create: `src/model/AIChatContextGeneration.model.ts`
- Create: `src/modules/AIChatCompactionModule.ts`
- Create: `src/service/AIChatCompactionCoordinator.ts`
- Modify: `src/service/AIChatCompactAgentService.ts` (delegate to coordinator)
- Create: `test/vitest/main/AIChatCompactionCoordinator.test.ts`

- [ ] **Step 7.1: Write failing coordinator tests** — fence takeover (slow owner can't publish), duplicate workKey reuse, section/checkpoint atomicity, generation CAS publication, crash-after-save resume, cancel during in-flight AI, delete during in-flight invalidates claim, max 3 sections per batch yield, 4-attempt ceiling.

- [ ] **Step 7.2: Implement the three compaction Models** — `AIChatCompactionRunModel.claimRun/renewLease/saveSectionAndCheckpoint/publishGeneration/pauseRun/cancelRun/invalidateConversation` and `AIChatCompactionSectionModel` (insert by workKey, coverage queries) and `AIChatContextGenerationModel` (insert + CAS active pointer via `AIChatArchiveStateModel`). All use `this.sqliteDb.connection.transaction(async (manager) => ...)` and revalidate epoch/revision/fence inside the transaction.

- [ ] **Step 7.3: Implement `AIChatCompactionModule`** — transactional wrappers exposing the design §6 compaction operations.

- [ ] **Step 7.4: Implement `AIChatCompactionCoordinator`** — single shared entry `requestCompaction(conversationId, trigger, model, signal)`; installs an in-process promise before first await; durable claim with fence/lease; snapshot end key + retained suffix start; background batch yields after 3 sections; bounded provider timeout (90s) + cancellation; renewal every 30s; does NOT hold DB transaction or turn mutex across AI calls.

- [ ] **Step 7.5: Delegate `AIChatCompactAgentService` to the coordinator** — `runFullCompact`/`enqueueAutoCompact`/`enqueueSessionMemoryUpdate` all call `coordinator.requestCompaction(...)`; remove the all-history input construction in `runFullCompact` (lines 427-491).

- [ ] **Step 7.6: Run tests (GREEN) + commit**

```bash
yarn testmain test/vitest/main/AIChatCompactionCoordinator.test.ts 2>&1 | tail
git add src/model/AIChatCompactionRun.model.ts src/model/AIChatCompactionSection.model.ts src/model/AIChatContextGeneration.model.ts src/modules/AIChatCompactionModule.ts src/service/AIChatCompactionCoordinator.ts src/service/AIChatCompactAgentService.ts test/vitest/main/AIChatCompactionCoordinator.test.ts
git commit -m "feat: durable compaction coordinator + transactional run/section/generation Models"
```

---

## Milestone 3 — Context continuity, UI, translations (design units 7–8)

### Task 8: Assembler continuity + scheduled-factory injection

**Files:**
- Modify: `src/service/AIChatContextAssembler.ts`
- Modify: `src/service/AIChatQueryEngine.ts` (persist turnId; post-turn coordinator)
- Modify: `src/service/AIChatQueryEngineFactory.ts` (inject coordinator + budget)

- [ ] **Step 8.1: Rewrite `AIChatContextAssembler`** to use bounded reads (`AIChatArchiveModule.readPage`), the published composite boundary (not timestamp-only), retained recent suffix (min 2 complete turns), source references, and typed context blocks (category + token estimate + source intervals + priority + mandatory flag). Allocation order per design §12: required system → current user + selected → valid tool exchange + recent turns → bounded overview + continuation → optional older/memory/retrieved.

- [ ] **Step 8.2: Persist `turnId`** in `AIChatQueryEngine` when accepting a user request; propagate to assistant/tool saves; post-turn hook calls `coordinator.requestCompaction({ trigger: "assistant_turn_completed", ... })` instead of the old `enqueueAutoCompact`.

- [ ] **Step 8.3: Inject shared services into scheduled engines** in `AIChatQueryEngineFactory.createScheduled` — pass `compactAgent` (the shared coordinator-backed agent) and `requestBudgetService` so scheduled paths do not silently omit preflight or compaction.

- [ ] **Step 8.4: Run `yarn tsc` + `yarn testmain` (existing assembler/query-loop tests updated) + commit**

```bash
git add src/service/AIChatContextAssembler.ts src/service/AIChatQueryEngine.ts src/service/AIChatQueryEngineFactory.ts
git commit -m "refactor: assembler bounded reads + composite boundary + coordinator post-turn + scheduled injection"
```

---

### Task 9: History UI + selected context + translations + UI tests

**Files:**
- Create: 4 Vue components (see File Structure)
- Modify: `src/views/components/aiChatV2/AiChatV2.vue`
- Modify: `src/views/api/aiChatV2.ts`
- Modify: `src/config/channellist.ts` (6 channels)
- Modify: `src/preload.ts` (allowlist 6 channels × 4 arrays)
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts` (6 handlers)
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts` (`aiChatHistory` + `aiChatCompaction` keys)
- Create: `test/vitest/main/components/AiChatHistoryDrawer.test.ts`
- Create: `test/vitest/main/components/AiChatCompactionStatus.test.ts`

- [ ] **Step 9.1: Add the 6 channels** to `src/config/channellist.ts`:

```typescript
export const AI_CHAT_V2_HISTORY_SEARCH = "ai-chat-v2:history-search";
export const AI_CHAT_V2_HISTORY_READ = "ai-chat-v2:history-read";
export const AI_CHAT_V2_HISTORY_RESOLVE_SELECTIONS = "ai-chat-v2:history-resolve-selections";
export const AI_CHAT_V2_COMPACTION_STATUS = "ai-chat-v2:compaction-status";
export const AI_CHAT_V2_COMPACTION_CANCEL = "ai-chat-v2:compaction-cancel";
export const AI_CHAT_V2_COMPACTION_PROGRESS = "ai-chat-v2:compaction-progress"; // event
```

- [ ] **Step 9.2: Allowlist the 6 channels in `src/preload.ts`** — add to all four arrays (invoke-list gets the 5 invoke channels; receive/removeListener/removeAllListeners get the 1 progress event). Mirror exactly or the preload throws.

- [ ] **Step 9.3: Add typed frontend API wrappers** in `src/views/api/aiChatV2.ts` — `searchHistory`, `readHistory`, `resolveSelections`, `getCompactionStatus`, `cancelCompaction`, `subscribeCompactionProgress`/`unsubscribeCompactionProgress` (scoped listener cleanup).

- [ ] **Step 9.4: Implement IPC handlers** in `src/main-process/communication/ai-chat-v2-ipc.ts` — history handlers use `registerValidatedHandler` (no AI gate, local browsing only); compaction-status/cancel use `registerAiValidatedHandler` (AI gate first). Wire `AI_CHAT_V2_COMPACT_CONVERSATION` to call `coordinator.requestCompaction({ trigger: "manual" })` and return an in-progress status (bounded wait).

- [ ] **Step 9.5: Add i18n keys** to all 6 language files. In `en.ts` under a new `aiChatHistory` + `aiChatCompaction` parent keys: `search_placeholder`, `search_query_too_long`, `no_match`, `partial_scan`, `read_more`, `select_passage`, `selected_context`, `estimated_cost`, `clear_selections`, `compaction_in_progress`, `compaction_paused`, `compaction_failed`, `compaction_retry`, `compaction_cancel`, `source_changed`, `source_unavailable`. Translate accurately in zh/es/fr/de/ja.

- [ ] **Step 9.6: Implement the 4 Vue components** — `AiChatHistoryDrawer.vue` (paginated search + browse, data-testid `ai-history-drawer`), `AiChatHistoryMessage.vue` (bounded passage + source nav + selection), `AiChatSelectedContext.vue` (next-reply selections + cost, data-testid `ai-selected-context`), `AiChatCompactionStatus.vue` (progress/pause/failure/retry/cancel, data-testid `ai-compaction-status`). Integrate into `AiChatV2.vue` (drawer toggle in header; status badge next to context badge; selected-context panel above composer).

- [ ] **Step 9.7: Write component tests** asserting rendering + main interactions (search submit, passage selection, compaction cancel, progress subscription lifecycle).

- [ ] **Step 9.8: Run `yarn test:components` + `yarn vue-check` + commit**

```bash
yarn test:components 2>&1 | tail
yarn vue-check 2>&1 | tail
git add src/views/components/aiChatV2/AiChatHistoryDrawer.vue src/views/components/aiChatV2/AiChatHistoryMessage.vue src/views/components/aiChatV2/AiChatSelectedContext.vue src/views/components/aiChatV2/AiChatCompactionStatus.vue src/views/components/aiChatV2/AiChatV2.vue src/views/api/aiChatV2.ts src/config/channellist.ts src/preload.ts src/main-process/communication/ai-chat-v2-ipc.ts src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts test/vitest/main/components/AiChatHistoryDrawer.test.ts test/vitest/main/components/AiChatCompactionStatus.test.ts
git commit -m "feat: history browser UI + selected context + compaction status + 6-language i18n + UI tests"
```

---

## Milestone 4 — Reliability qualification (design unit 9)

### Task 10: Migration/restart fixtures + performance/recall qualification + rollout controls

**Files:**
- Create: `src/modules/AIChatArchiveIndexModule.ts` (resumable backfill)
- Modify: `src/config/featureFlags.ts` (4 rollout flags)
- Create: `test/e2e/specs/ai-chat-recoverable-history.test.ts`
- Create: `src/service/AIChatArchiveRecoveryStartup.ts` (idempotent bootstrap on startup)

- [ ] **Step 10.1: Implement resumable backfill** in `AIChatArchiveIndexModule` — `readNextIndexBatch`/`saveIndexBatchAndCursor`/`getIndexCoverage`; reads above the captured index watermark; revision changes restart affected backfill; never marks index complete merely because one batch ended.

- [ ] **Step 10.2: Add the 4 Token-based rollout flags** to `src/config/featureFlags.ts` referencing `AI_CHAT_RECOVERABLE_FLAGS`.

- [ ] **Step 10.3: Write the E2E spec** `test/e2e/specs/ai-chat-recoverable-history.test.ts` — compact a long conversation, restart the app, exact-recover a quoted passage, select a passage for next reply, delete conversation (no resurrection). Uses the Playwright `_electron.launch()` + `AIFETCHLY_E2E=1` bootstrap (FakeOpenAI, E2ENetworkGuard, unique temp root).

- [ ] **Step 10.4: Run full test suite**

```bash
yarn tsc 2>&1 | tail
yarn testmain 2>&1 | tail
yarn test:components 2>&1 | tail
yarn build:e2e && xvfb-run -a yarn test:e2e 2>&1 | tail   # Linux: requires xvfb
```

- [ ] **Step 10.5: PRD acceptance-criteria traceability check** — verify each of AC-01..AC-24 has a corresponding test (map per design §17.3 table). Document any gaps as follow-up TODOs in the plan, never silently skip.

- [ ] **Step 10.6: Final commit + PR-ready**

```bash
git add src/modules/AIChatArchiveIndexModule.ts src/config/featureFlags.ts src/service/AIChatArchiveRecoveryStartup.ts test/e2e/specs/ai-chat-recoverable-history.test.ts
git commit -m "feat: resumable archive backfill + rollout flags + E2E recovery spec"
```

---

## Self-review checklist (run before declaring the plan complete)

- [ ] Every design §19 unit (1–9) maps to at least one Task.
- [ ] Every entity in design §5 has a file + registration step.
- [ ] Every design §6 Model/Module operation has an implementing step.
- [ ] Every design §16 error code is thrown somewhere (or explicitly deferred with a TODO).
- [ ] No task uses `any`; all boundaries use `zod/v4`.
- [ ] Every AI-serving IPC handler gates on `Token`/`USER_AI_ENABLED` before parsing.
- [ ] Preload allowlists mirror exactly across all four arrays.
- [ ] All 6 language files updated for every UI string.
- [ ] Every UI component ships with a component test.
- [ ] Every task ends with `git commit` (no `--no-verify`).
- [ ] The final dispatch budget guard is mandatory (not behind a flag).
- [ ] Disabling the feature never restores the unbounded `runFullCompact` all-history path.

---

## Execution order (dependency graph)

```
Task 1 (types/defaults/utils) ─┐
Task 2 (entities + registration)─┤
                               ├─► Task 3 (bounded Model reads)
                               │      │
                               │      ▼
                               │   Task 4 (archive Module + retrieval + tools)
                               │      │
Task 5 (budget service) ◄──────┼──────┤
                               │      ▼
Task 6 (packer + validator) ◄──┤   Task 7 (compaction Module + coordinator)
                               │      │
                               ▼      ▼
                            Task 8 (assembler + engine + factory)
                               │
                               ▼
                            Task 9 (UI + IPC + i18n + component tests)
                               │
                               ▼
                            Task 10 (backfill + E2E + rollout + qualification)
```

Tasks 1–2 are prerequisites for all others. Task 5 (budget) and Task 6 (packer/validator) are independent of Task 4 and may be developed in parallel. Task 7 depends on 4+5+6. Task 8 depends on 7. Task 9 depends on 8. Task 10 depends on 9.
