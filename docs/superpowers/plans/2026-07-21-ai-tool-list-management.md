# AI Tool List Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the LLM tool payload in AI Chat V2 by introducing a deferred tool catalog, a `tool_catalog_search` discovery tool, per-round filtering, in-memory discovered-tool state, MCP description/schema caps, stable ordering, metrics, and an `AI_TOOL_SEARCH=off|on|auto` feature flag (default `off`).

**Architecture:** Layered, local-first, OpenAI-compatible. A `ToolCatalogService` normalizes every enabled tool into a compact entry with source/load-policy/size/hash. `ToolPromptBudgetService` decides standard-vs-deferred mode from the feature flag + a context-window threshold. The `AIChatQueryLoop` filters the exposed tool set per model round (always-loaded + `tool_catalog_search` + discovered), intercepts `tool_catalog_search` locally, and carries discovered state through permission/plan-question pauses. Tool execution, permissions, MCP trust, and plan policy remain unchanged — discovery only controls prompt exposure.

**Tech Stack:** TypeScript 5.x, Vitest (`vite.main.config.mjs`), existing `OpenAITool`/`ToolFunction` types from `@/api/aiChatApi`.

**Source docs:** `docs/prd/ai-tool-list-management-prd.md`, `docs/prd/ai-tool-list-management-technical-design.md`.

**Scope:** MVP = PRD §19 = design Phase 1 + Phase 2 (in-memory state). Post-MVP (persistence/entity, agent runtime, hosted `client_tools`) is explicitly out of scope for this plan.

**Feature-flag safety:** Default `AI_TOOL_SEARCH=off`. With `off`, the loop sends the full tool list exactly as today. All new code paths are no-ops unless the flag enables deferred mode.

---

## File Structure

**New files (services — pure, unit-tested):**
- `src/config/toolCatalogConfig.ts` — constants + env parsing.
- `src/entityTypes/toolCatalogTypes.ts` — catalog/search/metrics types.
- `src/service/ToolSchemaSanitizer.ts` — description truncation + JSON-schema pruning.
- `src/service/ToolPromptBudgetService.ts` — token estimation + mode decision.
- `src/service/ToolLoadPolicyService.ts` — always/deferred/contextual classification.
- `src/service/ToolCatalogService.ts` — build catalog + filter per round.
- `src/service/ToolCatalogSearchService.ts` — discovery search + selection.
- `src/service/ToolCatalogMetricsService.ts` — structured logging.

**New test files:**
- `test/vitest/main/service/ToolSchemaSanitizer.test.ts`
- `test/vitest/main/service/ToolPromptBudgetService.test.ts`
- `test/vitest/main/service/ToolLoadPolicyService.test.ts`
- `test/vitest/main/service/ToolCatalogService.test.ts`
- `test/vitest/main/service/ToolCatalogSearchService.test.ts`
- `test/vitest/main/service/AIChatQueryLoop.toolCatalog.test.ts`

**Modified files:**
- `src/service/MCPToolService.ts` — cap descriptions/schemas at discovery + conversion (defense in depth).
- `src/service/AIChatQueryEvents.ts` — add optional catalog fields to loop input + pending snapshots.
- `src/service/AIChatQueryLoop.ts` — per-round filtering + intercept + carry-forward.
- `src/service/AIChatQueryEngine.ts` — build catalog/decision, inject announcement, thread state on resume.

---

## Task 1: Config constants

**Files:** Create `src/config/toolCatalogConfig.ts`.

- [ ] **Step 1: Write the config file**

```typescript
/**
 * Configuration for the deferred tool catalog (AI Tool List Management).
 *
 * Feature flag `AI_TOOL_SEARCH` controls rollout:
 *   off  -> current behavior (full tool list every round)
 *   on   -> always deferred catalog filtering
 *   auto -> deferred only when estimated deferred payload exceeds threshold
 *
 * Default is `off` so the first merge changes no model behavior.
 */

export const TOOL_CATALOG_SEARCH_TOOL_NAME = "tool_catalog_search";

export const TOOL_CATALOG_ENV = {
  mode: "AI_TOOL_SEARCH",
  thresholdPercent: "AI_TOOL_SEARCH_THRESHOLD_PERCENT",
  fallbackContextWindow: "AI_TOOL_FALLBACK_CONTEXT_WINDOW",
} as const;

export const TOOL_CATALOG_DEFAULTS = {
  mode: "off" as const,
  autoThresholdPercent: 10,
  charsPerToken: 4,
  shortDescriptionChars: 240,
  mcpDescriptionChars: 2048,
  schemaMaxChars: 12000,
  searchDefaultMaxResults: 5,
  searchMaxResults: 10,
  largestToolMetricCount: 10,
  fallbackContextWindowTokens: 128_000,
} as const;

export type ToolCatalogMode = "off" | "on" | "auto";

/** Parse AI_TOOL_SEARCH into a normalized mode; invalid/unset -> default. */
export function resolveToolCatalogMode(
  raw: string | undefined
): { mode: ToolCatalogMode; fallbackUsed: boolean } {
  if (raw === undefined || raw === "") {
    return { mode: TOOL_CATALOG_DEFAULTS.mode, fallbackUsed: false };
  }
  const v = raw.trim().toLowerCase();
  if (v === "off" || v === "on" || v === "auto") {
    return { mode: v, fallbackUsed: false };
  }
  console.warn(
    `[tool-catalog] invalid AI_TOOL_SEARCH="${raw}", falling back to auto`
  );
  return { mode: "auto", fallbackUsed: true };
}

/** Read a positive integer env override, or `undefined`. */
export function resolvePositiveIntEnv(
  raw: string | undefined
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/toolCatalogConfig.ts
git commit -m "feat: add tool catalog config constants and env parsing"
```

---

## Task 2: Catalog types

**Files:** Create `src/entityTypes/toolCatalogTypes.ts`.

- [ ] **Step 1: Write the types**

(Full type block from design §7.1/§7.2 — `ToolCatalogSource`, `ToolLoadPolicy`, `ToolCatalogEntry`, `ToolCatalog`, `ToolCatalogRuntimeContext`, `ToolCatalogState`, `ToolCatalogModeDecision`, `ToolCatalogFilterResult`, `ToolCatalogMetrics`, `ToolCatalogLargestTool`, `ToolCatalogSearchArgs`, `ToolCatalogSearchMatch`, `ToolCatalogSearchResult`, `ToolCatalogStateSnapshot`. Import `OpenAITool`/`ToolFunction` from `@/api/aiChatApi` and `ToolCatalogMode` from `@/config/toolCatalogConfig`. Note `ToolCatalogSource` adds `"system"`; `ToolLoadPolicy = "always"|"deferred"|"contextual"`.)

- [ ] **Step 2: Commit**

```bash
git add src/entityTypes/toolCatalogTypes.ts
git commit -m "feat: add tool catalog type system"
```

---

## Task 3: ToolSchemaSanitizer (TDD)

**Files:** Test `test/vitest/main/service/ToolSchemaSanitizer.test.ts`; create `src/service/ToolSchemaSanitizer.ts`.

- [ ] **Step 1: Write failing tests** — `truncateDescription` leaves short text unchanged / truncates long text with `... [truncated]`; `pruneJsonSchema` removes `examples`, drops long `default`, truncates nested `description`, keeps `type/properties/required/items/enum`, reports `changed` + size delta + actions.
- [ ] **Step 2: Run, verify FAIL.** `AIFETCHLY_SKIP_TSC=1 npx vitest --config vite.main.config.mjs run test/vitest/main/service/ToolSchemaSanitizer.test.ts`
- [ ] **Step 3: Implement** — pure functions. `truncateDescription(value, maxChars=2048)`. `pruneJsonSchema(schema, maxChars=12000)`: no-op when under budget; else iteratively remove examples → long defaults → truncate long descriptions (recursively) → strip titles → cap long enums; re-measure; return `{schema, changed, originalChars, sanitizedChars, actions}`. Never throw; return input unchanged on non-object.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat: add ToolSchemaSanitizer for MCP description/schema caps`.

---

## Task 4: ToolPromptBudgetService (TDD)

**Files:** Test `test/vitest/main/service/ToolPromptBudgetService.test.ts`; create `src/service/ToolPromptBudgetService.ts`.

- [ ] **Step 1: Write failing tests** — `off`→standard always; `on`→deferred always; `auto`→deferred when `deferredEstimatedTokens >= contextWindow * pct/100`; `auto`→standard below threshold; invalid env → auto + warning; returns `{mode, configuredMode, reason, estimatedDeferredTokens, thresholdTokens?, contextWindowTokens?}`.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — `estimateToolTokens(tool) = ceil(JSON.stringify(tool).length / charsPerToken)`. `resolveMode({configuredMode, deferredEstimatedTokens, contextWindowTokens?, contextChars?})`. Threshold from env override or default 10%. When no context window, fall back to a character-based comparison against `fallbackContextWindowTokens * charsPerToken`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat: add ToolPromptBudgetService for deferred-mode decision`.

---

## Task 5: MCP sanitization integration (TDD)

**Files:** Modify `src/service/MCPToolService.ts`; test `test/vitest/main/service/MCPToolService.sanitizer.test.ts`.

- [ ] **Step 1: Write failing tests** — a discover-shaped flow caps a 30 KB description to 2048 chars before metadata persistence (mock `mcpToolModule` + `MCPClient`); `getEnabledMCPToolsAsFunctions` re-caps an oversized stored description (defense in depth). Use vitest mocks for the module/client; assert stored `metadata` JSON has truncated description and `inputSchema` under budget.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — in `discoverTools`, when building `toolSchemas`, run each `tool.description` through `truncateDescription` and each `tool.inputSchema` through `pruneJsonSchema` (keep raw for none; store sanitized in metadata). In `getEnabledMCPToolsAsFunctions`, re-run `truncateDescription` + `pruneJsonSchema.schema` on the values read from metadata before producing the `ToolFunction`. Count truncations via a module-level counter exposed for metrics (optional: console.log structured line).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat: cap MCP descriptions and schemas at discovery and conversion`.

---

## Task 6: ToolLoadPolicyService (TDD)

**Files:** Test `test/vitest/main/service/ToolLoadPolicyService.test.ts`; create `src/service/ToolLoadPolicyService.ts`.

- [ ] **Step 1: Write failing tests** — `tool_catalog_search`→always; `file_read`/`glob_files`/`grep_files`/`check_tool_job_status`→always; mcp names (`mcp__x__y`, `mcp_42_z`)→deferred; plan tool names→always only when plan mode active else contextual; plugin/imported source→deferred; exact user-message mention of a deferred tool name→contextual; deterministic rule order.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — pure `classify({tool, source, context})`. Rule order: system/search→always; plan tools (use `isPlanToolName`/`isEnterPlanModeToolName`) → `isPlanMode?always:contextual`; core always-list by name; user-mention match → contextual; source mcp/plugin/imported → deferred; builtin default → always. Never inspect arguments.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat: add ToolLoadPolicyService classification`.

---

## Task 7: ToolCatalogService (TDD)

**Files:** Test `test/vitest/main/service/ToolCatalogService.test.ts`; create `src/service/ToolCatalogService.ts`.

- [ ] **Step 1: Write failing tests** — dedupe by name (builtin wins over mcp collision); stable ordering (system→plan→builtin→imported/plugin→mcp, each by name); consistent schema hashes; estimated token counts; `filterForRound` standard→all; deferred→always+search+discovered only; missing discovered name dropped gracefully.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — `buildFromOpenAITools({tools, context})`: normalize, detect source (search→system; `mcp__`/`/^mcp_\d+_/`→mcp; skill source via injected resolver mapping built-in→builtin, user/marketplace→imported, pluginOwner→plugin; plan tool names→plan; else builtin), classify via `ToolLoadPolicyService`, compute `shortDescription` (≤240 chars), `estimatedTokens`, `schemaHash` (stable sha-ish hash over JSON; use node `crypto.createHash('sha256')`), build `byName` map + always/deferred/contextual lists + totals. `filterForRound({catalog, state, modeDecision, forcedToolNames?})`: standard→all entries' openAITools; deferred→ always + contextual + discovered-from-deferred + search tool, minus names not present; compute metrics via `ToolCatalogMetricsService`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat: add ToolCatalogService build + filter`.

---

## Task 8: ToolCatalogSearchService (TDD)

**Files:** Test `test/vitest/main/service/ToolCatalogSearchService.test.ts`; create `src/service/ToolCatalogSearchService.ts`.

- [ ] **Step 1: Write failing tests** — `select` resolves exact names (known/missing reported); exact name query wins; mcp prefix/name-part ranking; required `+term` filters candidates; disabled/blocked (via `allowedToolNames`/`blockedToolNames`) absent; max_results cap (default 5, ≤10); discovered-already flag; returns `selectedToolNames` for matched+selected.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — pure `search({args, catalog, state, context})`. Honor `context.allowedToolNames`/`blockedToolNames` as candidate filters (agent allowlist enforcement). Tokenize tool-name parts (`mcp__plugin__server__tool`, `mcp_42_tool`, `snake_case`, `CamelCase`). Score per design §13.2 table. Sort desc, take `max_results` (clamp to `[1,10]`, default 5). `selectedToolNames` = exact selects (validated against catalog+policy) ∪ matched names. Return compact `ToolCatalogSearchResult`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat: add ToolCatalogSearchService discovery ranking`.

---

## Task 9: ToolCatalogMetricsService

**Files:** Create `src/service/ToolCatalogMetricsService.ts`.

- [ ] **Step 1: Implement** — `buildMetrics(catalog, {discoveredCount, exposedTools})` returns `ToolCatalogMetrics` (counts + estimated tokens + top-N largest by estimatedTokens). `logFilter({conversationId, result})` emits one structured `console.log` line `event=tool_catalog_filter ...` (names+sizes only, no schemas/args). No secrets.
- [ ] **Step 2: Commit** `feat: add ToolCatalogMetricsService logging`.

---

## Task 10: Extend loop input + pending snapshots

**Files:** Modify `src/service/AIChatQueryEvents.ts`.

- [ ] **Step 1: Edit** — add to `AIChatQueryLoopInput`: optional `toolCatalog?: ToolCatalog`, `toolCatalogState?: ToolCatalogStateSnapshot`, `toolCatalogModeDecision?: ToolCatalogModeDecision`. Add `ToolCatalogStateSnapshot { discoveredToolNames: string[]; announcedDeferredNames: string[] }` (define in `toolCatalogTypes.ts`). Add optional `toolCatalogState?: ToolCatalogStateSnapshot` to `PendingPermissionTurn` and `PendingPlanQuestionTurn`.
- [ ] **Step 2: Typecheck** `npx tsc --noEmit` (or rely on vitest globalSetup).
- [ ] **Step 3: Commit** `feat: add tool catalog fields to loop input and pending turns`.

---

## Task 11: AIChatQueryLoop integration (TDD)

**Files:** Test `test/vitest/main/service/AIChatQueryLoop.toolCatalog.test.ts`; modify `src/service/AIChatQueryLoop.ts`.

- [ ] **Step 1: Write failing tests** (fake `streamChatCompletion` + `executeTool`): standard mode (no catalog) sends all tools; deferred first request excludes deferred mcp tool and includes `tool_catalog_search`; a `tool_catalog_search` call that selects a deferred tool → that tool's full schema appears in the next request's tools; permission pause includes `toolCatalogState` snapshot; fallback: if catalog throws, full tool list still sent.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** in `run()`:
  - Init mutable `discoveredSet` from `input.toolCatalogState?.discoveredToolNames ?? []`.
  - Compute `catalogActive = input.toolCatalog && input.toolCatalogModeDecision?.mode === "deferred"`.
  - Replace the per-round `tools:` arg: when `catalogActive`, compute `exposedTools` via `ToolCatalogService.filterForRound` wrapped in try/catch (fallback → `currentTools`); else `currentTools`. Keep `currentTools` as the full executable set (unchanged). Also use `exposedTools.length` for `hasTools` in `resolveToolChoiceForRound` and the round log.
  - In the parsed tool-call loop, before plan-tool handling and before `executeToolWithTimeout`: if `call.name === TOOL_CATALOG_SEARCH_TOOL_NAME`, run `ToolCatalogSearchService.search`, add `selectedToolNames` to `discoveredSet`, emit `tool_result`, push tool message, `continue`.
  - Unknown-deferred-tool recovery (§14.4): if `catalogActive` and `call.name` is in catalog deferred set but not exposed, add to discovered and push a `success:false` "loaded, retry" tool result, `continue`.
  - In `paused_for_permission` and the plan-question pause return, add `toolCatalogState: snapshotToolCatalogState(discoveredSet)`.
  - Log metrics each round when `catalogActive`.
- [ ] **Step 4: Run, verify PASS.** Also run `AIChatQueryLoop.test.ts` to confirm no regression.
- [ ] **Step 5: Commit** `feat: integrate deferred tool catalog into AI Chat V2 loop`.

---

## Task 12: AIChatQueryEngine integration

**Files:** Modify `src/service/AIChatQueryEngine.ts`; smoke test via existing `AIChatQueryEngine.test.ts`.

- [ ] **Step 1: Implement** in `submitMessage` (after `allOpenAITools` is assembled):
  - Read `AI_TOOL_SEARCH` env via `resolveToolCatalogMode`.
  - Build catalog: `ToolCatalogService.buildFromOpenAITools({tools: allOpenAITools, context})` (try/catch → undefined on failure).
  - Compute deferred token estimate; `ToolPromptBudgetService.resolveMode(...)`.
  - Build `loopInput.toolCatalog/...` only when built without throwing.
  - Thread the snapshot back on resume paths (`resumeToolAfterPermission`, `answerPlanQuestion`) from the pending turn's `toolCatalogState`.
  - MVP announcement: when deferred active, it is sufficient that `tool_catalog_search` is exposed with its description; no extra system message required for MVP (design §15.2 allows compact-only). Add a one-line system note only if trivially injectable; otherwise skip to keep the change minimal.
- [ ] **Step 2: Run** `AIFETCHLY_SKIP_TSC=1 npx vitest --config vite.main.config.mjs run test/vitest/main/service/AIChatQueryEngine.test.ts` → existing tests must still pass (flag defaults `off`).
- [ ] **Step 3: Commit** `feat: wire tool catalog into AIChatQueryEngine with off-by-default flag`.

---

## Task 13: Full suite + typecheck gate

- [ ] **Step 1:** `npx tsc --noEmit` (no `AIFETCHLY_SKIP_TSC`) — must be clean.
- [ ] **Step 2:** `npx vitest --config vite.main.config.mjs run test/vitest/main/service/` (all service tests) → green.
- [ ] **Step 3:** If anything regresses, fix; do not commit broken code.
- [ ] **Step 4: Commit** any final fixes (`test: ...` or `fix: ...`).

---

## Self-Review notes

- **Spec coverage:** FR-1/2 (catalog+policy) → Tasks 6,7. FR-3 (search) → Task 8. FR-4 (per-round filter) → Task 11. FR-5 (state survives round/permission/plan-question within a turn) → Task 11 (in-memory + snapshot). FR-6 (announcement) → Task 12 (compact). FR-7 (MCP caps) → Tasks 3,5. FR-8 (auto mode) → Tasks 1,4. FR-9 (local discovery) → Task 11. FR-10 (diagnostics) → Task 9. AC-1..AC-10 covered by MVP tasks; AC-8 (resume across turns) covered via snapshot threading in Task 11/12. Post-MVP persistence/agent/hosted explicitly deferred.
- **Safety:** flag default `off`; every new path no-ops when catalog inactive; catalog build/filter wrapped in try/catch with full-list fallback (TR-5, AC-10).
