---
phase: 17-hooks
plan: "01"
subsystem: database
tags: [typeorm, sqlite, better-sqlite3, sha-256, trust, hooks, registry, diagnostics]

requires:
  - phase: 14-dynamic-agents-approval
    provides: in-memory approvalCache that this plan's persisted entity replaces
  - phase: 13-config-loader-stack
    provides: AIFetchlyConfigConstants closed-set diagnostic vocabulary + config limits
provides:
  - "AIFetchlyWorkspaceTrust entity/model/module — persisted per-capability trust (TRS-02)"
  - "ensureMigrationSeed() — idempotent backfill of approved workspaces to all-true (D-Migration)"
  - "computeWorkspaceRootHash / normalizeWorkspaceRoot — stable SHA-256 keying (A1)"
  - "HookRegistry.replaceSource / unregisterSource + sourceIndex — atomic source reconciliation (HOK-01)"
  - "maxHooksPerSource cap + 4 hook diagnostic codes (CFG-06 / DX-01)"
affects: [17-02, 17-03, workspace-trust-cache, hook-dispatch, aifetchly-status-ui]

tech-stack:
  added: []
  patterns:
    - "Three-layer DB triplet (entity/model/module) mirroring AgentDefinition"
    - "sourceIndex Map<sourceId,Set<id>> removal bookkeeping (mirror AgentDefinitionRegistry)"
    - "SHA-256 dedup keying of a normalized path, stable across path moves"
    - "Defensive shallow-copy on registry insert (CLAUDE.md immutability)"

key-files:
  created:
    - src/entity/AIFetchlyWorkspaceTrust.entity.ts
    - src/model/AIFetchlyWorkspaceTrust.model.ts
    - src/modules/AIFetchlyWorkspaceTrustModule.ts
    - test/modules/AIFetchlyWorkspaceTrustModule.test.ts
  modified:
    - src/config/SqliteDb.ts
    - src/service/hooks/HookRegistry.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
    - test/vitest/utilitycode/hooks/HookRegistry.test.ts

key-decisions:
  - "workspaceRootHash = SHA-256 of normalizeWorkspaceRoot(rootPath); symlink resolution intentionally skipped because WorkspaceResolver stores the canonical path verbatim (A1)."
  - "normalizeWorkspaceRoot strips trailing separators (preserving root '/') so '/x' and '/x/' hash identically — path.normalize alone does not."
  - "HookSource enum has no 'workspace' value; workspace-sourced hooks carry source 'project' (SOURCE_PRIORITY project:3 < user:5). Applied by Plan 02's buildHookDefinition."
  - "replaceSource does NOT add a name index — hooks key on event+matcher and getMatchingHooks re-sorts by (SOURCE_PRIORITY, seq) on every read."

patterns-established:
  - "Defensive copy on config-source insert via { ...hook } as HookDefinition."
  - "removeHookIdFromAllEvents: reverse-iterate + splice to delete every entry for an id across the byEvent map."

requirements-completed: [TRS-02, HOK-01]

coverage:
  - id: D1
    description: "AIFetchlyWorkspaceTrust entity + Model + Module persist 5 independent per-capability booleans, restart-safe (SC3), with an idempotent migration seed that backfills approved workspaces (TRS-02)."
    requirement: TRS-02
    verification:
      - kind: unit
        ref: "test/modules/AIFetchlyWorkspaceTrustModule.test.ts#AIFetchlyWorkspaceTrustModule (8 cases)"
        status: pass
      - kind: integration
        ref: "schema-apply — AIFetchlyWorkspaceTrustEntity registered in src/config/SqliteDb.ts:503; live table created via synchronize:true"
        status: pass
    human_judgment: false
  - id: D2
    description: "HookRegistry.replaceSource / unregisterSource atomically reconcile a config source (add/change/delete/rename) via a sourceIndex; stale entries never survive a rescan (HOK-01)."
    requirement: HOK-01
    verification:
      - kind: unit
        ref: "test/vitest/utilitycode/hooks/HookRegistry.test.ts#replaceSource / unregisterSource (HOK-01) (9 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AIFetchlyConfigConstants exposes maxHooksPerSource:100 plus 4 closed-set hook diagnostic codes for Plans 02/03 to consume with no further edits."
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (0 errors — AIFetchlyDiagnosticCode type auto-extends from the tuple)"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-07-10
status: complete
---

# Phase 17-01 Summary: Trust Entity + HookRegistry + Config Constants

Foundation plan shipped: the durable per-capability trust store that replaces Phase 14's in-memory approval cache, the registry mutation primitive every config-sourced hook reconciliation needs, and the closed-set diagnostic vocabulary Plans 02/03 consume — all with zero new dependencies.

## Accomplishments

- TRS-02 (durable trust): AIFetchlyWorkspaceTrustEntity persists 5 independent per-capability booleans keyed by a stable SHA-256 root hash, fail-closed on a missing row. Survives DB reload (SC3).
- D-Migration: ensureMigrationSeed() idempotently backfills approved workspaces to all-true and never seeds a pending/revoked workspace (no trust escalation on re-run).
- HOK-01 (registry primitive): HookRegistry.replaceSource/unregisterSource atomically reconcile a whole config source via sourceIndex; both are on the HookRegistryApi interface for Plan 02.
- Foundation constants: maxHooksPerSource:100 + 4 diagnostic codes; Plans 02/03 need no further edits to AIFetchlyConfigConstants.ts (enables Wave 2 parallelism).

## Task Commits

1. Task 1 (trust entity/model/module + migration seed + schema-apply): 0eeaa2a1 (test RED), c4779ed7 (entity), 69c23ead (model+hash), 6389bb6f (module+seed), 38d9e769 (fix trailing-sep normalization).
2. Task 2 (HookRegistry HOK-01): b384acf2 (test RED), 9749fa60 (feat).
3. Task 3 (config constants): 5d03bb51 (feat).

## Decisions Made

- Trailing-separator stripping in normalizeWorkspaceRoot (path.normalize keeps a single trailing sep).
- replaceSource defensive copy uses { ...hook } as HookDefinition (safe cast — spread widens the discriminated-union type).
- Worker guard on the Model (assertNotWorker) — main-process only.

## Deviations from Plan

- Auto-fixed (correctness): normalizeWorkspaceRoot now strips trailing separators so '/x' and '/x/' hash identically (A1). Committed in 38d9e769. Necessary; no scope creep.

## Issues Encountered

- better-sqlite3 native binding flagged by an interrupted run as a Node 23-vs-22 ABI mismatch — verified false alarm (N-API loads cleanly on v22.19.0).
- yarn test <file> hardcodes a glob pulling in SystemDependencyModule.test.ts (require()s vitest, incompatible under mocha+tsx); ran the targeted suite via direct mocha.
- Plan's HookRegistry verify -x vitest flag unsupported in this version; dropped.

## Next Phase Readiness

- Plan 17-02 can call hookRegistry.replaceSource, read persisted trust via AIFetchlyWorkspaceTrustModule.getTrust(hash), and emit the 4 new diagnostic codes.
- Plan 17-03 can emit skill-registry-not-available for its skill-ref no-op.
- computeWorkspaceRootHash/normalizeWorkspaceRoot exported for Plan 02's entity-backed cache (reuse exactly so hashes agree). No blockers.
