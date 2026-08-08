---
phase: 18-skills-and-plugin-integration
plan: 01
subsystem: local-skills-discovery
tags: [skills, skillregistry, trust-filter, worker-scanner, execution-boundary]
requires:
  - "Phase 13 AIFetchlyConfigLoader (scan pipeline)"
  - "Phase 17 tryReadHookFiles + AIFetchlyRuntimeRegistrySync trust filter"
  - "Existing SkillRegistry + SkillImportService + SkillExecutor + SkillPermissionService"
provides:
  - "buildLocalSkillDraft pure validator (LocalSkillDraft + WorkspaceSkillDraft types)"
  - "tryReadSkillFiles on AIFetchlyConfigLoader (global) + WorkspaceConfigScanner (worker raw draft)"
  - "buildWorkspaceSkillDefinitions main-side converter"
  - "LocalSkillSourceAdapter (source reconciliation bridging SkillRegistry's missing replaceSource)"
  - "skills: trust-filter line in applyWorkspaceSnapshot"
affects:
  - "src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (scan method + buildSnapshot)"
  - "src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts (apply/applyWorkspace/removeSource)"
  - "src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts (limits + diagnostic codes)"
  - "src/service/SkillImportService.ts (registerImportedSkill now exported)"
  - "src/service/workspaceWatch/WorkspaceConfigScanner.ts (worker raw-draft scan)"
tech-stack:
  added: []
  patterns:
    - "Pure single-owner validator delegating to existing SkillImportService.validateManifest (no schema duplication)"
    - "Source-reconciliation adapter bridging a registry's missing replaceSource (unregister-then-register)"
    - "Worker scan-only raw drafts (WAT-02) validated main-side via a pure converter"
    - "Trust-filter line mirroring the Phase-17 hooks: pattern"
key-files:
  created:
    - "src/service/aifetchlyConfig/buildLocalSkillDraft.ts"
    - "src/service/LocalSkillSourceAdapter.ts"
    - "src/service/workspaceWatch/buildWorkspaceSkillDefinitions.ts"
    - "test/vitest/main/service/buildLocalSkillDraft.test.ts"
    - "test/vitest/main/service/AIFetchlyConfigLoader.skills.test.ts"
    - "test/vitest/main/service/LocalSkillSourceAdapter.test.ts"
    - "test/vitest/main/service/AIFetchlyRuntimeRegistrySync.skills.test.ts"
    - "test/vitest/main/service/SkillImportService.local.test.ts"
    - "test/vitest/main/service/SkillPermissionService.local.test.ts"
    - "test/vitest/utilitycode/workspaceWatch/WorkspaceConfigScanner.skills.test.ts"
  modified:
    - "src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts"
    - "src/entityTypes/aifetchlyConfigTypes.ts"
    - "src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts"
    - "src/service/workspaceWatch/WorkspaceConfigScanner.ts"
    - "src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts"
    - "src/service/SkillImportService.ts"
decisions:
  - "Reuse existing SkillImportService.validateManifest as the single manifest schema owner (no validation rule duplication)"
  - "Add CFG-05 entry path-traversal check in buildLocalSkillDraft (validateManifest does not itself check entry traversal)"
  - "LocalSkillSourceAdapter bridges SkillRegistry's missing replaceSource via unregister-then-register (CONTEXT.md locks 'do not rewrite SkillRegistry')"
  - "Auto-register + gate-at-call (D-SkillEnable) - no per-skill enable flag"
  - "Workspace skills included this phase (worker ships raw drafts; trust.skills gates main-side registration)"
metrics:
  duration: 25m
  completed: 2026-07-13
  tasks: 3
  files: 16
  tests-added: 43
status: complete
---

# Phase 18 Plan 01: Local Skills Discovery + Registration Summary

Pure integration that discovers `~/.aifetchly/skills/<name>/manifest.json` (and trusted-workspace `<ws>/.aifetchly/skills/`) and feeds validated manifests INTO the EXISTING `SkillRegistry` -> `SkillExecutor` -> `SkillPermissionService` pipeline via a source-reconciliation adapter, with a `skills:` trust-filter line mirroring Phase 17's `hooks:` line.

## What Was Built

### Task 1 - Pure buildLocalSkillDraft validator + skill constants
- `buildLocalSkillDraft.ts`: pure leaf validator returning `{ ok: true, draft } | { ok: false, diagnostic }`. Delegates the manifest schema check (name regex, semver, runtime, parameters type:object, permissions) to the EXISTING `SkillImportService.validateManifest` and adds the CFG-05 entry path-traversal check that `validateManifest` does not itself perform.
- `LocalSkillDraft` + `WorkspaceSkillDraft` types defined (with `id` for snapshot diff).
- `skillManifestBytes` (64 KiB), `maxSkillsPerSource` (100) limits + `manifest-invalid` diagnostic code added to the closed set.

### Task 2 - Discovery wiring
- `AIFetchlyConfigLoader.tryReadSkillFiles` (global): readdir `skills/`, per-dir `manifest.json` stat/read/hash/parse/validate -> `LocalSkillDraft[]` (source "user").
- `WorkspaceConfigScanner.tryReadSkillFiles` (worker): raw-draft scan - readdir `skills/`, read manifest.json ONLY (never the entry .js/.py), ship opaque `WorkspaceSkillDraft[]` (WAT-02 scan-only).
- `buildWorkspaceSkillDefinitions.ts`: main-side converter raw drafts -> validated `LocalSkillDraft[]` via `buildLocalSkillDraft`.

### Task 3 - Source adapter + trust-filter + boundary contract tests
- `LocalSkillSourceAdapter.ts`: bridges SkillRegistry's missing `replaceSource` via unregister-then-register reconciliation (sourceId -> Set<skillName>). Built-in name collisions caught -> manifest-invalid diagnostic, never throws (T-spoof-builtin).
- `AIFetchlyRuntimeRegistrySync`: `skills:` trust-filter line (TRS-01), skills block in `applySnapshot` (global + workspace conversion), skills clear in `removeSource`, `skillsChanged` in result.
- `SkillImportService.registerImportedSkill` exported (minimal additive - existing function surfaced).
- Execution-boundary + permission-gate contract tests prove the existing `SkillWorkerClient`/`SkillPermissionService` boundary holds for local skills (T-arbitrary-exec / D-SkillEnable).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] buildLocalSkillDraft must add CFG-05 entry path-traversal check**
- **Found during:** Task 1
- **Issue:** The plan stated "CFG-05 path safety on the entry field is already inside validateManifest - do not re-check." Reading the actual source, `validateManifest` (lines 572-681) does NOT check entry path traversal - that check lives in `importFromZip` (line 769) for the zip path. The local-discovery path needs the check at its own boundary.
- **Fix:** Added a path-traversal + absolute-path check on `manifest.entry` inside `buildLocalSkillDraft`, after `validateManifest` succeeds. The acceptance criterion "entry with traversal -> { ok: false, diagnostic.code === manifest-invalid }" is satisfied; a dedicated test covers `../` and absolute paths.
- **Files modified:** `src/service/aifetchlyConfig/buildLocalSkillDraft.ts`
- **Commit:** 013eb70a

**2. [Rule 3 - Blocking] registerImportedSkill was not exported**
- **Found during:** Task 3
- **Issue:** `LocalSkillSourceAdapter` needs to call `SkillImportService.registerImportedSkill(manifest, skillDir)`, but the function was module-private (only `validateManifest`/`importFromZip`/`loadPersistedSkills`/`validatePythonSkillZip` were in the export object).
- **Fix:** Added `registerImportedSkill` to the `SkillImportService` export object (one-line additive change; the function body is unchanged). Documented with a Phase-18 comment.
- **Files modified:** `src/service/SkillImportService.ts`
- **Commit:** 0c18f4ee

**3. [Rule 2 - Critical Functionality] LocalSkillDraft + WorkspaceSkillDraft need `id` for snapshot diff**
- **Found during:** Task 2
- **Issue:** `AIFetchlyConfigSnapshotDiff.capabilityChanged` keys capability arrays (commands/agents/hooks/skills) by `id`. Without an `id` field, all skill drafts would collapse to `id=undefined` and the diff would miss renames/changes.
- **Fix:** Added `id` (`${sourceId}:skill:${name}` / `workspace:<wsId>:skill:<name>`) to both draft types. Also added `source` to `WorkspaceSkillDraft` for consistency with `WorkspaceHookDraft`.
- **Files modified:** `src/service/aifetchlyConfig/buildLocalSkillDraft.ts`, `src/entityTypes/aifetchlyConfigTypes.ts`
- **Commit:** 5959bc29

## Verification

- **43 new tests pass** (35 main config + 8 utilitycode config):
  - `buildLocalSkillDraft.test.ts` (11) - valid/invalid manifests, path traversal, source attribution
  - `AIFetchlyConfigLoader.skills.test.ts` (8) - global discovery, missing dir, oversized, count cap, sibling continuation
  - `WorkspaceConfigScanner.skills.test.ts` (8, utilitycode) - raw drafts, scan-only, no entry-file read, malformed blob pass-through
  - `LocalSkillSourceAdapter.test.ts` (6) - register, rescan reconcile, collision, per-source isolation
  - `AIFetchlyRuntimeRegistrySync.skills.test.ts` (6) - trust filter, apply, removeSource, rescan
  - `SkillImportService.local.test.ts` (2) - execution routes through SkillWorkerClient (not main-thread load)
  - `SkillPermissionService.local.test.ts` (2) - checkPermission fires before skill.execute (D-SkillEnable)
- **Phase-17 regression:** `AIFetchlyRuntimeRegistrySync.hooks.test.ts` (8 tests) green - adding the skills line/block did not regress hooks.
- **Standalone `npx tsc --noEmit`:** 0 errors.
- **WAT-02 grep gate:** worker scanner has zero DB/registry/Electron/validator IMPORT statements (the only grep match is a pre-existing doc comment documenting the WAT-02 boundary itself; `git diff` confirms I added none of the forbidden tokens).
- **SC1 no-main-load grep gate:** no dynamic `import()` of skill entry files under `src/service/aifetchlyConfig/` or `LocalSkillSourceAdapter.ts`.
- **TRS-05 grep gate:** no NEW skill-execution IPC added this plan (execution rides the existing AI tool-invocation path).

## Threat Mitigations Verified

| Threat | Mitigation | Test |
|--------|-----------|------|
| T-18-01 (EoP - arbitrary exec in main) | Local JS skills route through SkillWorkerClient utility process; entry code NEVER loaded on main thread | SkillImportService.local.test.ts asserts SkillWorkerClient.execute receives the entry code |
| T-18-02 (Spoofing - built-in name collision) | registerSkill throws on duplicate; adapter catches -> manifest-invalid diagnostic; built-in always wins | LocalSkillSourceAdapter.test.ts collision case |
| T-18-03 (Tampering - entry path traversal) | buildLocalSkillDraft rejects entries with `..` or absolute paths | buildLocalSkillDraft.test.ts traversal cases |
| T-18-04 (EoP - untrusted-workspace skill registration) | `skills: trust.skills ? snapshot.skills : []` drops untrusted before registry mutation | AIFetchlyRuntimeRegistrySync.skills.test.ts trust=false case |
| T-18-06 (Info Disclosure - sensitive args) | SkillPermissionService.checkPermission fires per-call (D-SkillEnable gate-at-call) | SkillPermissionService.local.test.ts |

## Deferred / Out-of-Scope Items

- **Pre-existing `registerAiValidatedHandler` in `src/main-process/communication/skills-ipc.ts:11`** - a TRS-05 observation: skill MANAGEMENT IPCs (list/import/toggle/uninstall) use the AI-gated registrar variant. These are non-AI-serving per TRS-05 Strategy A and arguably should use `registerValidatedHandler`. This is a PRE-EXISTING issue (empty `git diff HEAD` confirms Plan 18-01 did not touch the file) and out of the plan's scope (Plan 18-01 adds NO skill-execution IPC). Best handled in a dedicated cleanup change. (Could not be written to `deferred-items.md` because a project PreToolUse hook blocks `.md` creation outside `/docs/`.)

## Self-Check: PASSED

- All 10 created/modified source files exist on disk (9 source + 7 test files verified FOUND).
- All 3 task commits exist in git log: `013eb70a` (Task 1), `5959bc29` (Task 2), `0c18f4ee` (Task 3).
- Standalone `npx tsc --noEmit` reports 0 errors.
- 43 new tests pass (35 main config + 8 utilitycode config) + Phase-17 hooks regression green.
