# Phase 5: Types and Tracker Foundation - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the FileOperationRecord type definition, FileOperationTracker static service, and AI_FILE_OPERATION IPC channel constant. This is the foundation every downstream layer (ToolExecutor integration, frontend badges, translations) depends on. No UI, no ToolExecutor changes, no frontend work in this phase.

</domain>

<decisions>
## Implementation Decisions

### ID Generation
- **D-01:** Use the `uuid` package (already in dependencies as `^9.0.1`) to generate record IDs. Generate v4 UUIDs via `v4()` from the `uuid` package. Consistent with existing codebase usage.

### Type File Location
- **D-02:** Create a new file `src/entityTypes/fileOperationTypes.ts` for `FileOperationRecord` and `FileOperationType`. Separate from existing `fileToolTypes.ts` — file operation recording is its own feature, not an extension of file tool types.

### Tracker Lifecycle
- **D-03:** FileOperationTracker is window-scoped. `setWebContents()` called after BrowserWindow creation in `background.ts`. WebContents reference cleared on window `closed` event. In-memory store (Map keyed by conversationId) persists across page navigations within the same window session.
- **D-04:** Memory cap at 500 records per conversation, evicting oldest-first when exceeded.

### Architecture (from prior planning — locked)
- **D-05:** Static class pattern for `FileOperationTracker` (matches `RateLimiterManager` pattern already in codebase)
- **D-06:** `emit()` wraps IPC send in try/catch — failures never propagate to caller or break tool execution
- **D-07:** `emit()` checks `webContents` is not destroyed before calling `send()`
- **D-08:** All `FileOperationRecord` fields are `readonly` (immutable pattern per project coding standards)
- **D-09:** `FileOperationType` union: `"create" | "overwrite" | "edit"`
- **D-10:** IPC channel constant: `AI_FILE_OPERATION = "ai-chat:file-operation"` in `src/config/channellist.ts`
- **D-11:** Auto-generate `timestamp` as `Date.now()` (number, not Date object) for clean IPC serialization

### Claude's Discretion
- Exact method signatures and internal Map structure
- Error logging within emit() (console.warn vs debug)
- Whether to expose `getRecords(conversationId)` method on tracker (likely useful for Phase 7)

</decisions>

<specifics>
## Specific Ideas

- PRD doc at `docs/README.md` provides the full feature spec with data model, IPC channel design, and FileOperationTracker class sketch. Follow its architecture closely.
- Research findings confirm zero new npm dependencies needed.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Feature Specification
- `docs/README.md` — Full PRD for AI Chat File Operation Recording: data model (FileOperationRecord), IPC channel design, FileOperationTracker class sketch, security requirements, error handling, testing strategy, rollout plan

### Research
- `.planning/research/SUMMARY.md` — Synthesized research: stack, features, architecture, pitfalls
- `.planning/research/ARCHITECTURE.md` — Integration points, data flow, build order (14 files: 2 new, 12 modified)
- `.planning/research/PITFALLS.md` — 7 critical pitfalls with prevention strategies

### Requirements
- `.planning/REQUIREMENTS.md` — v1.1 requirements with REQ-IDs (TYPE-01..03, TRAK-01..05, IPC-01 for this phase)
- `.planning/ROADMAP.md` — Phase 5 goal, success criteria, dependency chain

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `uuid` package (`^9.0.1`): Already in dependencies, used across codebase for ID generation
- `src/config/channellist.ts`: IPC channel constant pattern — add new constant following existing naming convention (`ai-chat:*` prefix)
- `src/entityTypes/fileToolTypes.ts`: Existing file tool types (FileReadResult, FileWriteResult, FileEditResult, FileSearchResult) — reference for type patterns but don't extend
- `src/service/RateLimiterManager.ts`: Static class pattern reference for FileOperationTracker

### Established Patterns
- Static service classes: RateLimiterManager, ToolExecutor — FileOperationTracker follows same pattern
- IPC channel constants: All defined as `export const NAME = "namespace:action"` in channellist.ts
- Type definitions: All in `src/entityTypes/` with explicit interfaces, `readonly` fields
- Error isolation: try/catch wrapping for non-critical paths (file operation tracking must never break tool execution)

### Integration Points
- `src/background.ts`: Window creation flow — insert `FileOperationTracker.setWebContents(mainWindow.webContents)` after BrowserWindow creation, add `closed` event handler
- `src/config/channellist.ts`: Add `AI_FILE_OPERATION` constant alongside existing `AI_CHAT_*` channels
- Phase 6 will connect `ToolExecutor.executeFileTool()` (line 1319) to `FileOperationTracker.emit()`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-types-and-tracker-foundation*
*Context gathered: 2026-05-25*
