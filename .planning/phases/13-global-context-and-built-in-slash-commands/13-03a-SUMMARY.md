---
phase: 13-global-context-and-built-in-slash-commands
plan: 13-03a-context-pipeline-assembler-injection
subsystem: infra
tags: [typescript, electron, context-assembly, cache, singleton, tdd, prompt-injection-resistance]

requires:
  - 13-01-config-loader-stack (AIFetchlyConfigLoader, AIFetchlyConfigSnapshot, AIFetchlyInstructionBlock)
  - 13-02-command-registry-parser (CommandRegistry.replaceSource — sync layer consumer)
provides:
  - AIFetchlyContextStore — per-sourceId in-memory instruction cache with defensive copies; module-level singleton shared with the assembler-facing loader
  - AIFetchlyContextLoader — assembler-facing façade with never-throwing getInstructionBlocks and the static anti-prompt-injection label builder (formatInstructionBlock)
  - AIFetchlyRuntimeRegistrySync — snapshot -> CommandRegistry + cache reconciliation with atomic replace semantics
  - AIFetchlyConfigManager — singleton orchestrator (idempotent initialize, reload-fires-listeners, getStatus with DX-02 watcher placeholder, getInstructionBlocks delegation, getCommandRegistry for Plan 03b built-in registration)
  - AIChatContextAssembler.assemble() AGENTS.md injection (CTX-01 ordinal, CTX-03 graceful degradation)
affects:
  - 13-03b-commands-dispatcher-ipc (consumes AIFetchlyConfigManager singleton for /status, /reload-config, startup hook, and built-in registration via getCommandRegistry())
  - 13-04-renderer-suggestions-ui (no direct dependency; reads command list via the IPC layer Plan 03b exposes)
  - 13-05-i18n-boundary-tests (asserts no fs/.aifetchly literals under src/views/**)

tech-stack:
  added: []
  patterns:
    - Assembler-facing context façade over a module-level singleton cache (no per-request filesystem reads — T-13-Cache mitigation)
    - Graceful degradation via try/catch + console.error mirroring the existing custom-directive block (CTX-03)
    - Anti-prompt-injection label wording: descriptive, not authoritative (design §12.2 last paragraph — never claims priority over the app system prompt)
    - Snapshot -> registry/cache atomic replace (forward-compat typed-array cast at the phase-13 boundary; phase 15+ tightens the snapshot type)
    - Singleton orchestrator with dependency-injectable constructor (real ~/.aifetchly root in prod, tmpdir + fresh store in tests)

key-files:
  created:
    - src/service/aifetchlyConfig/AIFetchlyContextStore.ts
    - src/service/aifetchlyConfig/AIFetchlyContextLoader.ts
    - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
    - test/vitest/main/service/AIFetchlyContextLoader.test.ts
    - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts
  modified:
    - src/service/AIChatContextAssembler.ts (AGENTS.md injection between active-workspace and durable-memory)

key-decisions:
  - "Module-level singleton AIFetchlyContextStore shared between the assembler (which does `new AIFetchlyContextLoader()` with no DI) and the config manager. Tests inject a fresh store to isolate state. This is the only way the assembler's field-initialized collaborator can see the cache the manager populates without breaking the assembler's existing constructor-less pattern."
  - "formatInstructionBlock is a static method on AIFetchlyContextLoader so the assembler can call it without an instance lookup beyond the loader it already holds. Global label is exactly 'User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:\\n\\n<content>' (anti-prompt-injection wording verified by grep gate)."
  - "AIFetchlyRuntimeRegistrySync casts snapshot.commands (typed `readonly unknown[]` for forward-compat) to `readonly SlashCommandDefinition[]` at the boundary. Safe in phase 13 because commands are always empty; phase 15 will tighten the snapshot type and remove the cast. Documented inline."
  - "AIFetchlyConfigManager.initialize() is fire-and-forget safe (never throws synchronously) and idempotent (returns immediately on second call). Pitfall 6 mitigation: the actual background.ts .catch wiring lives in Plan 03b Task 2."
  - "getStatus() watcherState is hardcoded 'not-started' (DX-02 phase-14 placeholder). The watcher worker is phase 14 — no worker/childprocess files exist in this plan (CLAUDE.md boundary)."
  - "Injection lands AFTER the active-workspace block and BEFORE durable memory — verified by the assembler test's index ordering assertion (agentsIdx > baseIdx && agentsIdx < durableIdx)."

patterns-established:
  - "Pattern: every external-data injection into AIChatContextAssembler mirrors the existing try/catch + console.error graceful-degradation shape (custom-directive at lines 116-128 → AGENTS.md at the new block). Read failures degrade to no-injection, never break chat."
  - "Pattern: assembler-facing context sources read from in-memory caches populated by singleton orchestrators; the assembler never touches the filesystem per request (CTX-03)."

requirements-completed: [CTX-01, CTX-03]

coverage:
  - id: D1
    description: "Global AGENTS.md content injected as a system message AFTER base prompt + custom directive + active workspace, BEFORE durable memory (CTX-01 ordinal)"
    requirement: CTX-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts#injects AGENTS.md AFTER base prompt and BEFORE durable memory"
        status: pass
    human_judgment: false
  - id: D2
    description: "Injected block carries the labeled prefix ('User global AiFetchly instructions...') without claiming priority over the app system prompt (anti-prompt-injection)"
    requirement: CTX-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyContextLoader.test.ts#formatInstructionBlock does NOT claim priority over the app system prompt"
        status: pass
    human_judgment: false
  - id: D3
    description: "In-memory cache avoids per-request file reads; cache miss returns [] (CTX-03, T-13-Cache mitigation)"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyContextLoader.test.ts#returns an empty list before any replaceInstructions + getInstructionBlocks returns [] when the store is empty"
        status: pass
    human_judgment: false
  - id: D4
    description: "Read failures in the injection path degrade to no-injection + console.error, never throw or break chat (CTX-03)"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyContextLoader.test.ts#getInstructionBlocks NEVER throws + AIChatContextAssembler.aifetchly.test.ts#loader throwing degrades to no-injection"
        status: pass
    human_judgment: false
  - id: D5
    description: "AIFetchlyConfigManager.getStatus() returns watcherState 'not-started' (DX-02 phase-14 placeholder)"
    requirement: DX-02
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyContextLoader.test.ts#getStatus() returns watcherState 'not-started'"
        status: pass
    human_judgment: false
  - id: D6
    description: "AIFetchlyConfigManager.initialize() is idempotent (second call does not crash or duplicate blocks)"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyContextLoader.test.ts#initialize() is idempotent"
        status: pass
    human_judgment: false
  - id: D7
    description: "reload() reflects new AGENTS.md content after the file changes; next getInstructionBlocks sees the new block"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyContextLoader.test.ts#reload() reflects new content after the file changes"
        status: pass
    human_judgment: false

duration: ~7min
completed: 2026-07-05
status: complete
---

# Plan 13-03a: Context Pipeline + Assembler Injection Summary

**In-memory instruction cache, assembler-facing loader, snapshot sync, config-manager singleton, and the AIChatContextAssembler AGENTS.md injection — CTX-01 ordinal + CTX-03 graceful degradation wired end-to-end**

## Performance

- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files created:** 6 (4 source + 2 test)
- **Files modified:** 1 (AIChatContextAssembler.ts)
- **Tests:** 38 new tests passing (32 in AIFetchlyContextLoader.test.ts, 6 in AIChatContextAssembler.aifetchly.test.ts); 50/50 total pass across the assembler + context pipeline; tsc --noEmit clean (0 errors)

## Task Commits

1. **Task 1 — Context store + loader + sync + manager singleton** — `faa013b6` (test RED) → `cfc5c1df` (feat GREEN)
2. **Task 2 — AIChatContextAssembler AGENTS.md injection** — `eee9f1e0` (test RED) → `82c11e02` (feat GREEN)

## Accomplishments

- **AIFetchlyContextStore** — per-sourceId instruction cache with defensive copies on read and write; module-level singleton shared with the assembler-facing loader so `new AIFetchlyContextLoader()` in the assembler sees the same cache the manager populates.
- **AIFetchlyContextLoader** — never-throwing `getInstructionBlocks()` wrapping every read in try/catch and degrading to `[]` on any failure; static `formatInstructionBlock()` building the labeled CTX-01 system-message content with the anti-prompt-injection wording mandated by design §12.2.
- **AIFetchlyRuntimeRegistrySync** — atomic `applySnapshot()` wiring commands into the registry and instructions into the cache via `replaceSource` semantics; `removeSource()` clears both sides.
- **AIFetchlyConfigManager** — singleton orchestrator with idempotent `initialize()`, listener-firing `reload()`, `getStatus()` carrying the phase-14 watcher placeholder, `getInstructionBlocks()` delegation, and `getCommandRegistry()` exposing the registry for Plan 03b's built-in registration.
- **AIChatContextAssembler** — new AGENTS.md injection block between the active-workspace try/catch and the durable-memory block, mirroring the existing custom-directive graceful-degradation pattern (try/catch + console.error, never rethrow).

## Decisions Made

- The assembler's field-initialized `new AIFetchlyContextLoader()` collaborator shares state with the config manager via a module-level singleton store. This avoids touching the assembler's existing constructor-less pattern (which every other collaborator uses) while still allowing tests to inject fresh stores for isolation.
- `formatInstructionBlock` is a static method on the loader so the assembler calls `AIFetchlyContextLoader.formatInstructionBlock(block)` directly — no second instance, no static-class lookup ambiguity. The label wording is verified by a grep gate (`! grep -iE 'higher priority|override system|above all|more important than'`).
- The sync layer casts `snapshot.commands` (typed `readonly unknown[]` for Plan-15 forward-compat) to `readonly SlashCommandDefinition[]` at the boundary, with an inline comment explaining the phase-13 safety (commands always empty) and the phase-15 cleanup. The alternative — a runtime type guard — is overkill for a perpetually-empty array.
- `AIFetchlyConfigManager.initialize()` is fire-and-forget safe (never throws synchronously, idempotent). The actual `background.ts` `.catch()` logging wiring is deferred to Plan 03b Task 2 per Pitfall 6 — this plan only owns the never-throw-sync contract.

## Deviations from Plan

None — plan executed exactly as written. The cast at the sync boundary is documented in the plan's `<action>` File 3 description ("calls commandRegistry.replaceSource(snapshot.sourceId, snapshot.commands)"), and the phase-13 forward-compat boundary is consistent with Plan 01's snapshot type design.

## Issues Encountered

- The vitest run logs `ERR_DLOPEN_FAILED` from `better-sqlite3` in the WorkspaceResolver path — this is the **pre-existing** graceful-degradation path (the existing assembler catches it and continues). Unrelated to Plan 13-03a; no action taken (out of scope per the SCOPE BOUNDARY rule).
- The vitest `--config vite.main.config.mjs` script defaults to watch mode (no `run` subcommand) — same gotcha documented in Plan 13-01's SUMMARY. Used `npx vitest run --config vite.main.config.mjs <filter>` for one-shot inner loops after `npx tsc --noEmit` was clean.

## User Setup Required

None — no external service configuration required. Plan 03b will wire the manager's `initialize()` call into `background.ts` startup alongside `SkillImportService.loadPersistedSkills()`.

## Next Phase Readiness

- AIFetchlyConfigManager singleton ready for Plan 03b's `/status`, `/reload-config`, and startup-hook consumption.
- CommandRegistry exposed via `manager.getCommandRegistry()` for Plan 03b's `registerBuiltInSlashCommands()`.
- `onConfigChanged(callback)` registration surface ready for Plan 03b to wire the `AIFETCHLY_CONFIG_CHANGED` BrowserWindow.send emission.
- AIChatContextAssembler now injects global AGENTS.md end-to-end; adding `~/.aifetchly/AGENTS.md` changes the next AiChatV2 response without app restart (UC-1 verified by the interop test in AIFetchlyContextLoader.test.ts).

## Self-Check: PASSED

- Created files exist: `src/service/aifetchlyConfig/AIFetchlyContextStore.ts`, `AIFetchlyContextLoader.ts`, `AIFetchlyRuntimeRegistrySync.ts`, `AIFetchlyConfigManager.ts`, `test/vitest/main/service/AIFetchlyContextLoader.test.ts`, `test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts` — all FOUND.
- Modified file: `src/service/AIChatContextAssembler.ts` — FOUND with the injection block at the correct ordinal position.
- Commits `faa013b6`, `cfc5c1df`, `eee9f1e0`, `82c11e02` — all FOUND in `git log --oneline`.
- `npx tsc --noEmit` exits 0; `AIFetchlyContextLoader AIChatContextAssembler` test filter exits 0 (50/50 pass).

---
*Phase: 13-global-context-and-built-in-slash-commands*
*Completed: 2026-07-05*
