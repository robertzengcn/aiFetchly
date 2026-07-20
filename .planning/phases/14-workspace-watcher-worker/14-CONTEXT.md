# Phase 14: Workspace Watcher Worker - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Add the **workspace config watcher child process** with:
- Reference-counted lifecycle (one worker for all acquired workspaces; 0 watched → no worker).
- Workspace `AGENTS.md` / `commands/*.md` / `settings.json` scanning (explicit paths, NOT whole-workspace).
- Binary trust gating (workspace `.aifetchly` untrusted until approved; trust enforced in `AIFetchlyRuntimeRegistrySync` before registry mutation — TRS-01).
- Live-update renderer events (workspace config changes refresh AiChatV2 context without app restart).
- Debounced (500ms) + scan-generation-reconciled rescans that self-heal missed file events.
- Crash handling (max 3 restarts / 60s, full rescan on restart, `/reload-config` manual retry).

**Out of scope (locked boundaries — do NOT pull in):**
- Dynamic agents (Phase 16), hooks (Phase 17), skills/plugins (Phase 18).
- `AIFetchlyWorkspaceTrust` per-capability trust entity (Phase 17). Phase 14 reuses the existing workspace approval state.
- `$ARGUMENTS` expansion / prompt-command files (Phase 15).
- Whole-workspace recursive watch.

</domain>

<decisions>
## Implementation Decisions

### File-Watch Mechanism
- **D-01: chokidar.** The worker uses `chokidar` to watch `<workspace>/.aifetchly/**` + `<workspace>/AGENTS.md`. Justified: WAT-05 demands robust handling of delete/rename/atomic-save/git-checkout/missed events across Linux/macOS/Windows — chokidar is the industry standard for this. This is a **new runtime dependency** (breaks Phase 13's "zero new packages" streak, accepted as well-justified: watchers are genuinely hard). chokidar's transitive deps are binary-free and `picomatch` (already present) is among them.
  - NOTE: §9.6's debounce (500ms) + scan-generations + full-snapshot-reconciliation layer remains the source of truth for runtime correctness — chokidar only triggers debounced rescans; the snapshot diff catches actual state. Configure chokidar with `ignoreInitial: true` and `awaitWriteFinish` (researcher/planner to pin exact options).

### Worker Spawn API
- **D-02: `child_process.fork()`.** Spawn `WorkspaceConfigWatchWorker.ts` via Node's `child_process.fork()`, NOT Electron's `utilityProcess.fork()`. Rationale: the worker is pure-Node (fs watch + parse + IPC) — under `child_process.fork` it **cannot** `require('electron')` or import TypeORM/registries, so **WAT-02 (worker sandboxing: no DB, no registry mutation, no trust decisions, no renderer IPC) is enforced by construction, not merely by tests**. This aligns with the design's principle that the worker "only watches files, parses bounded input, returns typed snapshots." Worker↔main IPC via `process.send()` / `process.on('message')`.
  - Existing repo workers (e.g., `PythonRuntimeWorker.ts`) use `child_process.spawn` for non-Node subprocesses — `child_process.fork` is the same-family choice for a Node worker.

### Trust Prompt UX (TRS-03)
- **D-03: Inline card.** Create a new `WorkspaceTrustCard.vue` mirroring the existing `WorkspaceRequiredCard.vue` surface. Appears inline in the AiChatV2 panel when an active workspace contains `.aifetchly` but is untrusted. Non-blocking (user can dismiss → "Keep disabled") but persistent. The 4 TRS-03 options (Preview / Trust instructions only / Trust all workspace AI config / Keep disabled) render as card actions; **"Preview" expands the card to show the workspace's `AGENTS.md` content** (read-only, main-process-supplied — renderer never reads the file directly, TRS-07). Reuses Vuetify styling + the WorkspaceBadge/WorkspaceRequiredCard card pattern from earlier phases. NOT a modal (too intrusive) and NOT a banner (trust decisions must persist).

### Renderer Event Routing
- **D-04: Global `AIFETCHLY_CONFIG_CHANGED` channel + `workspaceId` in the payload.** Reuse Phase 13's existing global channel. Extend `AIFetchlyConfigChangedEvent` with an optional `workspaceId?: string` and `source: "global" | "workspace"`. Main forwards worker `changed` events with the originating `workspaceId`; the AiChatV2 subscriber filters by its active workspace. One channel, preload-friendly (static whitelist — Pitfall 3 from Phase 13 preserved).
  - Rationale: per-workspace dynamic channels (`aifetchly-config:changed:<id>`) are impractical with the static preload whitelist — they'd require a wildcard entry (security hole) or a relay that re-introduces this design. The two-channel variant adds a second preload entry + subscriber for no functional gain.

### Carry-Forward from Prior Phases (locked, do not re-litigate)
- **Three-layer DB architecture** (Model → Module → IPC handler); IPC handlers never touch DB directly. (CLAUDE.md)
- **Worker processes must NOT access the DB** — they IPC to main. Phase 14 doubly enforces this via D-02 (pure-Node worker). (CLAUDE.md + WAT-02)
- **Child/worker files in `src/childprocess/`** — `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts` per design §9.2. (CLAUDE.md)
- **AI-feature IPC checks `USER_AI_ENABLED` first** — N/A for the watcher (it's not AI-serving), but the dispatcher path from Phase 13 remains the single AI gate (TRS-05 Strategy A).
- **i18n: all new user-facing strings in all 6 languages** (`aifetchlyConfig` / `slashCommands` groups already exist from Phase 13; add a `workspaceTrust` group for the trust-card strings). (I18-01)
- **Preload dual whitelists** — any new channel touches all 4 whitelists (invoke + receive + removeListener + removeAllListeners). D-04 adds NO new channels (reuses Phase 13's). (Pitfall 3)
- **NEVER use `any`**; immutability; explicit error handling; zod at boundaries (worker messages validated with zod in main before use — WAT-06).

### Claude's Discretion
- Exact chokidar options (`ignoreInitial`, `awaitWriteFinish.stabilityThreshold`, `recursive` per-platform) — researcher/planner to pin.
- Worker message validation: zod schemas for the §9.4 discriminated unions (repo standard, consistent with Phase 13's `registerValidatedHandler`).
- `<500ms` rescan SLA (WAT-05/SC5) verification approach — researcher to propose (targeted performance test or log+assert).
- Trust-card trigger timing (on chat open with untrusted-`.aifetchly` workspace vs. on first config-change event) — planner to decide; recommend on chat open (push), matching SC1.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked design (authoritative — the equivalent of CONTEXT.md USER DECISIONS)
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §9 (Workspace Watcher Worker) — process model, entry point, `WorkspaceWatchManager` types, worker protocol (command/event discriminated unions), watch paths, debounce + generations, scanner, crash handling. **This is the primary source.**
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §10 (Workspace Lifecycle Integration) — chat-open acquire flow, consumer IDs, main-process authority.
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §8 (AIFetchlyRuntimeRegistrySync) — trust filtering before registry mutation (TRS-01).
- `docs/prd/aifetchly-local-extensibility-prd.md` — Phase 14 requirements source.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — Phase 14 req IDs: CFG-02, CTX-02, WAT-01..07, TRS-01, TRS-03, TRS-04.
- `.planning/ROADMAP.md` §Phase 14 — goal + 5 success criteria.

### Phase 13 surfaces this phase consumes (read the SUMMARYs)
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-01-SUMMARY.md` — `AIFetchlyConfigLoader`, `AIFetchlyConfigSnapshotDiff` (reused by the workspace scanner), restricted frontmatter parser.
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md` — `AIFetchlyContextStore`, `AIFetchlyRuntimeRegistrySync` (the trust-filtered apply target), `AIFetchlyConfigManager` singleton.
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-03b-SUMMARY.md` — IPC channels incl. `AIFETCHLY_CONFIG_CHANGED` (reused by D-04), `SlashCommandModule`.
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md` — pitfalls (preload dual whitelists, renderer isolation), patterns.

### Project rules
- `./CLAUDE.md` — three-layer DB, worker-no-DB, childprocess placement, i18n, no `any`, zod at boundaries.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`AIFetchlyConfigLoader`** (Phase 13-01) — the workspace scanner reuses the restricted frontmatter parser, `resolveConfigRelativePath`, and snapshot-diff logic. The worker's `WorkspaceConfigScanner.scan()` (§9.7) is a workspace-rooted variant of the global loader.
- **`AIFetchlyRuntimeRegistrySync.applySnapshot(snapshot, trust)`** (Phase 13-03a) — the trust-filtered apply target for workspace snapshots (TRS-01 enforced here, NOT in the worker).
- **`AIFetchlyConfigManager`** singleton (Phase 13-03a) — coordinates global + workspace sources; the watch manager plugs workspace snapshots into it.
- **`WorkspaceRequiredCard.vue` + `WorkspaceBadge.vue`** — the structural template for the new `WorkspaceTrustCard.vue` (D-03).
- **`onAifetchlyConfigChanged`** subscriber (Phase 13-04 renderer API) — already wired in `AiChatV2.vue`; D-04 extends its event payload, no new subscriber needed.

### Established Patterns
- **Preload dual whitelists** (Phase 13 Pitfall 3) — D-04 adds no new channels, so no whitelist changes.
- **`registerValidatedHandler` / zod** (Phase 13-03b) — worker→main messages validated with zod before use (WAT-06); malformed → terminate + restart worker.
- **`child_process` workers** (`PythonRuntimeWorker.ts`, `YellowPagesScraperProcess.ts`) — same-family spawn pattern (D-02 uses `fork` for a Node worker).
- **Generation/snapshot reconciliation** (Phase 13-01 `AIFetchlyConfigSnapshotDiff` + §9.6 generations) — the runtime-correctness backstop for missed file events.

### Integration Points
- `AiChatV2.vue` `onMounted` (chat open) → main-process workspace resolve → `WorkspaceWatchManager.acquire({ consumerId: "chat:<id>", ... })` (§10.1).
- `AIFETCHLY_CONFIG_CHANGED` (Phase 13 channel) — main forwards worker `changed` events with `workspaceId`; renderer filters by active workspace (D-04).
- Worker entry: `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts`, registered in `forge.config.js` build section (§9.2).

</code_context>

<specifics>
## Specific Ideas

- **WAT-02 by construction (D-02 rationale):** the strongest reason to choose `child_process.fork` over `utilityProcess.fork` is architectural — a pure-Node worker physically cannot import Electron/TypeORM, making the WAT-02 sandbox invariant structural rather than test-only. The researcher/planner should encode this in the plan's `must_haves.prohibitions` as a grep gate (no `require('electron')` / no `typeorm` / no `@/modules` / no `@/model` imports under `src/childprocess/aifetchly-config/`).
- **Preview before trust (D-03):** "Preview" in the trust card should show the workspace's `AGENTS.md` content supplied by the main process (via the existing list/preview IPC) — the renderer never reads the file directly (TRS-07 boundary test from Phase 13-05 still holds).
- **chokidar config intent (D-01):** watcher only triggers rescans; the §9.6 generation mechanism is the correctness backstop. Prefer chokidar options that minimize spurious events (`ignoreInitial`, `awaitWriteFinish`, scoped globs to the explicit file set in §9.7).

</specifics>

<deferred>
## Deferred Ideas

- **Whole-workspace watch** (e.g., watching all of `<workspace>/**` for arbitrary file changes) — explicitly out of scope per §9.5; belongs in a future capability phase if ever needed.
- **Per-capability trust entity** (`AIFetchlyWorkspaceTrust`) — Phase 17. Phase 14 uses the existing workspace approval state.
- **Prompt-command `$ARGUMENTS` expansion surfaced through workspace scanning** — Phase 15.
- **Performance budget beyond the <500ms rescan SLA** (e.g., worker memory ceiling, event-throughput caps) — not in requirements; defer unless profiling reveals a need.

</deferred>

---

*Phase: 14-workspace-watcher-worker*
*Context gathered: 2026-07-05*
