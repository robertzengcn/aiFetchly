# Phase 14: Workspace Watcher Worker - Discussion Log

**Date:** 2026-07-05
**Mode:** default (interactive)
**Participant:** user (visionary) + Claude (builder)

## Areas Discussed

The tech design §9 locks most of the worker architecture (process model, entry point, `WorkspaceWatchManager` types, worker protocol, watch paths, 500ms debounce + scan generations, scanner, crash handling, lifecycle). Four implementation decisions were genuinely open and were discussed:

### 1. File-Watch Mechanism
**Options presented:**
- chokidar (NEW dep, robust against delete/rename/atomic-save/git-checkout/missed events; ~1 runtime dep, binary-free transitive deps incl. picomatch)
- fs.watch + fallback rescan (no dep; relies on §9.6 generation + snapshot-diff to self-heal misses; weaker on atomic-save + recursive watch on older Linux)
- fs.watchFile polling (no dep, reliable; CPU cost scales with watched file count)

**Selected:** chokidar
**Notes:** Breaks Phase 13's "zero new packages" streak, accepted as well-justified (watchers are genuinely hard). §9.6 generation + snapshot-diff remains the runtime-correctness backstop; chokidar only triggers debounced rescans.

### 2. Worker Spawn API
**Options presented:**
- `child_process.fork()` (pure-Node worker; CANNOT import electron/TypeORM/registries → WAT-02 enforced by construction; matches repo's child_process family)
- `utilityProcess.fork()` (Electron-native, cleaner app-quit lifecycle; but worker CAN import electron → WAT-02 becomes discipline-enforced; overkill since worker needs no Electron APIs)

**Selected:** `child_process.fork()`
**Notes:** Strongest rationale is architectural: WAT-02 sandboxing is structural, not test-only. Planner to encode as a grep-gate prohibition (no electron/typeorm/modules/model imports under `src/childprocess/aifetchly-config/`).

### 3. Trust Prompt UX (TRS-03)
**Options presented:**
- Inline card mirroring `WorkspaceRequiredCard.vue` (non-blocking, persistent, "Preview" expands to show AGENTS.md; consistent with existing card pattern)
- Modal VDialog (blocking, forces immediate decision; intrusive)
- Banner/snackbar (transient; not appropriate — trust decisions must persist)

**Selected:** Inline card (`WorkspaceTrustCard.vue`)
**Notes:** 4 TRS-03 options (Preview / Trust instructions only / Trust all workspace AI config / Keep disabled) render as card actions. "Preview" content is main-process-supplied (renderer never reads the file — TRS-07 boundary test from Phase 13-05 still holds).

### 4. Renderer Event Routing
**Options presented:**
- Global `AIFETCHLY_CONFIG_CHANGED` + `workspaceId` in payload (reuse Phase 13 channel; extend event with optional `workspaceId` + `source`; renderer filters by active workspace; preload-friendly)
- Two channels: global-changed + workspace-changed (two preload entries + two subscribers; no functional gain)
- Per-workspace channels `aifetchly-config:changed:<id>` (impractical with static preload whitelist — needs wildcard (security hole) or a relay that re-introduces option 1)

**Selected:** Global channel + workspaceId in payload
**Notes:** Preload constraint is decisive — static whitelist rules out dynamic per-workspace channels. D-04 adds NO new channels (Phase 13's Pitfall 3 preserved).

## Deferred Ideas
- Whole-workspace watch — out of scope (§9.5).
- Per-capability trust entity (`AIFetchlyWorkspaceTrust`) — Phase 17.
- `$ARGUMENTS` expansion through workspace scanning — Phase 15.
- Performance budget beyond the <500ms rescan SLA — defer unless profiling reveals a need.

## Claude's Discretion Items
- Exact chokidar options (ignoreInitial, awaitWriteFinish, recursive per-platform).
- zod schemas for the §9.4 worker protocol (repo standard).
- <500ms SLA verification approach.
- Trust-card trigger timing (recommend push on chat open, SC1).

