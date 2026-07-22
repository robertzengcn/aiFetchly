---
phase: 17-hooks
plan: "02"
subsystem: config
tags: [hooks, zod, trust, workspace-watch, registry-sync, diagnostics]

requires:
  - phase: 17-hooks
    provides: AIFetchlyWorkspaceTrust entity/model/module + HookRegistry.replaceSource + config constants (Plan 01)
  - phase: 14-dynamic-agents-approval
    provides: in-memory approvalCache that this plan replaces with an entity-backed cache
  - phase: 16-dynamic-agents
    provides: buildAgentDefinition + buildWorkspaceAgentDefinitions templates (mirrored for hooks)
provides:
  - "buildHookDefinition pure zod validator + hookEntrySchema (HOK-01 schema owner)"
  - "AIFetchlyConfigLoader.tryReadHookFiles (global hooks.json -> CommandHookDefinition[])"
  - "WorkspaceConfigScanner.tryReadHookFiles + WorkspaceHookDraft (worker scan-only, WAT-02)"
  - "buildWorkspaceHookDefinitions main-side converter"
  - "AIFetchlyRuntimeRegistrySync hooks wiring (trust filter + replaceSource + hookRegistry injection)"
  - "entity-backed sync trust cache + revokeWorkspaceTrust (Pitfall 2) + derivePhase14Trust flows hooks"
affects: [17-03, hook-dispatch, aifetchly-status-ui, workspace-trust-card]

tech-stack:
  added: []
  patterns:
    - "Pure zod validator returning {ok,definition}|{ok,diagnostic} (mirrors agentFrontmatter)"
    - "Worker scan-only raw draft -> main-side converter validation (WAT-02)"
    - "Entity-backed sync trust cache bridging async DB -> sync trustResolver (Pitfall 5)"

key-files:
  created:
    - src/service/hooks/hookFileFrontmatter.ts
    - src/service/workspaceWatch/buildWorkspaceHookDefinitions.ts
    - test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts
    - test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts
    - test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts
  modified:
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
    - src/service/workspaceWatch/WorkspaceConfigScanner.ts
    - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
    - src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts
    - src/service/workspaceWatch/WorkspaceTrustFilter.ts

key-decisions:
  - "trusted=true for all built command hooks: buildHookDefinition runs only for sources trusted at the call site (user-owned globally; workspace post-trust-filter), so the registry's getMatchingHooks defense-in-depth skip does not starve trusted workspace hooks (SC1)."
  - "Skill-ref entries register as command with a `skill:<name>` sentinel (D-Vocabulary no-op); Plan 03 detects the prefix and emits skill-registry-not-available at fire time."
  - "WorkspaceHookDraft carries the whole JSON-parsed blob as opaque raw; the main-side converter splits + validates (maximally WAT-02 — worker only does stat+size+read+JSON.parse)."
  - "hookRegistry constructor param defaults to the HookRegistry singleton so existing test call sites keep working; the production caller (AIFetchlyConfigManager) passes it explicitly."
  - "trustResolver stays synchronous and boolean (manager signature preserved); derivePhase14Trust now propagates the boolean to ALL five flags (D-TrustUX), unblocking SC1."
  - "Cross-restart trust durability is owned by WorkspaceModule.approveWorkspace + the Plan 01 migration seed; the sync cache covers the current session; revoke sets ALL_FALSE + manager.rescan (Pitfall 2)."

requirements-completed: [HOK-01, TRS-02]

coverage:
  - id: D1
    description: "hooks.json parsed from global + workspace sources with CFG-04 size + CFG-06 count caps; invalid/unsupported/oversized/too-many produce the correct closed-set codes; skill-ref entries register as no-ops (HOK-01 parse)."
    requirement: HOK-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts (8 cases)"
        status: pass
      - kind: unit
        ref: "buildHookDefinition purity grep (no fs/DB/Electron) + worker scan-only grep (no validator in scanner)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AIFetchlyRuntimeRegistrySync applies the hooks trust-filter line and reconciles hooks via hookRegistry.replaceSource for both global and workspace paths; removeSource clears hooks (HOK-01 / SC1 wiring)."
    requirement: HOK-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts (5 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Phase 14 approvalCache replaced by an entity-backed sync trust cache; revoke reflects on the next read without restart (Pitfall 2); trustResolver stays synchronous (Pitfall 5); derivePhase14Trust flows hooks (TRS-02)."
    requirement: TRS-02
    verification:
      - kind: unit
        ref: "test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts (7 cases)"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-07-11
status: complete
---

# Phase 17-02 Summary: hooks.json Parse + Trust-Wiring + Entity-Backed Cache

Wired config-sourced hooks end-to-end through the snapshot -> trust -> registry pipeline: a pure zod parse layer, global + worker scanners, main-side conversion, the one-line trust filter + HookRegistry.replaceSource wiring, and an entity-backed sync trust cache replacing Phase 14's in-memory binary approval map.

## Accomplishments

- HOK-01 parse: buildHookDefinition (pure zod) is the single schema owner; global loader reads the single hooks/hooks.json; worker scans raw drafts only (WAT-02); buildWorkspaceHookDefinitions validates main-side. CFG-04 size + CFG-06 count caps + closed-set diagnostics (hooks-json-invalid / unsupported-event / count-cap / file-too-large).
- HOK-01 wiring: AIFetchlyRuntimeRegistrySync adds `hooks: trust.hooks ? snapshot.hooks : []` (drops untrusted workspace hooks before mutation) + hookRegistry.replaceSource for both sources + removeSource clears. hookRegistry constructor-injected (default singleton; production caller passes it).
- TRS-02 cache: approvalCache -> entity-backed trustCache; revokeWorkspaceTrust (ALL_FALSE + rescan) removes Phase 14's stale-until-restart limitation (Pitfall 2); trustResolver stays sync (Pitfall 5); derivePhase14Trust now flows all five capabilities so trusted workspace hooks fire (SC1).

## Task Commits

- Task 1 (parse layer): 9258bbd4 (feat validator+loader+scanner+converter), ae6da7f6 (test).
- Task 2a (sync wiring): 48783d4a (feat), 17feaa79 (test).
- Task 2b (entity cache): cf7ec235 (feat), 96b19a06 (test).

## Decisions Made

See key-decisions frontmatter. Notably trusted=true for built hooks (SC1 correctness over the plan's literal "trusted === source==='user'"), skill-ref sentinel command, and boolean trustResolver preserved with derivePhase14Trust flowing all flags.

## Deviations from Plan

- trusted=true for all built command hooks (plan literal: trusted === source==='user'). Necessary so trusted workspace hooks fire via getMatchingHooks (SC1); the trust filter remains the gate.
- Skill-ref command sentinel is `skill:<name>` (plan example: "true") to preserve the skill name for Plan 03.
- markWorkspaceApproved writes the cache only (plan: write the Module). Cross-restart durability is already owned by approveWorkspace + the Plan 01 migration seed, so same-session cache suffices; avoids a rootPath lookup at the sync call site.
- hydrate test mocks AIFetchlyWorkspaceTrustModule because better-sqlite3 cannot dlopen under vitest's loader (mocha 17-01 ran the real entity fine).

All deviations necessary for correctness/environment; no scope creep.

## Issues Encountered

- tsc: entry.command was string|undefined after the refine; fixed with explicit if/else narrowing (no cast).
- Worker scan-only grep initially flagged a comment naming buildWorkspaceHookDefinitions (substring of buildHookDefinition); reworded.
- vitest: -x flag unsupported in this version (dropped); better-sqlite3 ERR_DLOPEN_FAILED under vitest (worked around with a mock for the hydrate entity-read test).

## Next Phase Readiness

- Plan 17-03 consumes the `skill:<name>` sentinel to emit skill-registry-not-available at fire time, and routes command-hook execution through the new dedicated worker. The trust filter + replaceSource wiring from Task 2a is the foundation 17-03's dispatcher builds on. No blockers.
