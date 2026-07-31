---
phase: 18-skills-and-plugin-integration
status: clean
depth: standard
reviewed: 2026-07-13
reviewer: orchestrator-inline
files_reviewed: 21
critical: 0
warning: 0
info: 7
total: 7
independence: inline (orchestrator-model) review — see Reviewer Note
---

# Phase 18 Code Review — Skills and Plugin Integration

## Verdict: CLEAN (ship-able; no critical/warning issues)

Standard-depth review of all 21 source/test files changed in Phase 18 (both
plans). **No bugs, no security vulnerabilities, no quality defects requiring
fixes.** Seven non-blocking Info-level observations follow. The security model
is sound and the implementation follows project conventions (immutability, no
`any`, comprehensive error handling, TDD).

## Severity Summary

| Severity | Count |
|----------|-------|
| Critical / Blocker | 0 |
| Warning | 0 |
| Info | 7 |
| **Total** | **7** |

## Security & Boundary Verification (all PASS)

- **CFG-05 path traversal** — `buildLocalSkillDraft` rejects `manifest.entry`
  containing `..` or absolute paths (`includes("..")` + `path.isAbsolute`). The
  check is sound for JSON-parsed manifests (no URL-encoding vector) and catches
  backslash variants on Windows (`"..\x".includes("..")` is true).
- **T-plugin-poison** — plugin commands/agents register at `SOURCE_RANK` 3
  (lowest) on both `CommandRegistry` and `AgentDefinitionRegistryImpl`; built-in
  /workspace/user always win name collisions. Structural — no extra code. Covered
  by `PluginComponentRegistryService.promotion.test.ts` (T-plugin-poison case).
- **CFG-07 safe-schema** — plugin `.md` files route through the EXISTING
  `parseRestrictedFrontmatter` + `buildPromptCommandDefinition` /
  `buildAgentDefinition` (single CMD-06/AGT-02 owners). No new parser; no YAML-lib
  RCE surface.
- **WAT-02 worker scan-only** — `WorkspaceConfigScanner.tryReadSkillFiles` reads
  `manifest.json` ONLY (never the entry `.js`/`py`); zero DB/Electron/registry
  imports (the sole grep match is a doc comment, line 663).
- **SC1 no in-process skill execution** — config loader + `LocalSkillSourceAdapter`
  have no `import()`/`child_process` of skill entry files; execution is delegated
  to `SkillExecutor` → existing `SkillWorkerClient` utility-process boundary.
- **TRS-05** — Phase 18 added zero new IPC handlers; pre-existing `skills-ipc.ts`
  untouched.
- **T-spoof-builtin** — `LocalSkillSourceAdapter` catches duplicate-name
  collisions and surfaces `manifest-invalid` diagnostics; built-ins always win.

## Observations (Info — non-blocking, no action required)

### IF-01 — `reload()` loads plugins twice (minor redundancy)
`PluginComponentRegistryService.reload()` calls `loadAllPlugins()` (cold load
after `clearCache`), then `applyLoadedPlugins()` which calls `loadAllPlugins()`
again (cache hit). Functionally correct (memoized), but the second call is
redundant. Could pass the already-loaded result through. Perf impact: negligible
(cache hit). **File:** `src/service/PluginComponentRegistryService.ts`.

### IF-02 — Singleton lifecycle coupling in plugin service
`applyLoadedPlugins` / `unregisterPluginCapabilities` / `reload` obtain the
registries via `getAIFetchlyConfigManager()`, which constructs the manager
(registries + loader + store) on first call. If a plugin IPC fires before the
config manager's normal startup init, the manager constructs early. **Benign
today** (construction is side-effect-free; no scan until `initialize()`), but it
is a hidden coupling worth a one-line comment. **File:**
`src/service/PluginComponentRegistryService.ts`.

### IF-03 — `LocalSkillSourceAdapter` source-kind inferred from sourceId prefix
The collision diagnostic infers `source` via `sourceId.startsWith("workspace:")
? "workspace" : "user"` (line 94). Exhaustive for the current user/workspace
skill namespaces (plugin skills don't flow through this adapter), but brittle if
a new namespace is added. **File:** `src/service/LocalSkillSourceAdapter.ts`.

### IF-04 — `readComponentFiles` sequential IO
Each plugin's `commands/*.md` + `agents/*.md` are read sequentially (`await` in a
for-loop). Fine for small plugin dirs (the common case); could be parallelized
with `Promise.all` if large plugin dirs become common. Avoids fd pressure today.
**File:** `src/service/PluginComponentRegistryService.ts`.

### IF-05 — `replaceSource` batch is best-effort, not atomic
`LocalSkillSourceAdapter.replaceSource` unregisters the old set, then registers
each new draft; a mid-batch collision leaves earlier drafts registered (documented
behavior). Correct for the infrequent-rescan model; non-atomic by design.
**File:** `src/service/LocalSkillSourceAdapter.ts`.

### IF-06 — `dispatchSkillRef` uses module-level mutable test seam
`injectedResolver` is module-level mutable state (the `setSkillRefResolverForTests`
seam). Test isolation depends on resetting it in `afterEach`. Conventional, but a
forgotten reset would leak across tests. **File:** `src/service/hooks/HookDispatcher.ts`.

### IF-07 — TOCTOU between `existsSync` and `readdir` (already defended)
`readComponentFiles` does `fs.existsSync(dir)` then `fs.promises.readdir(dir)`; a
race could remove the dir between calls. **Already handled** — the `readdir`
catch returns empty on `ENOENT`. Defense-in-depth is in place; non-issue. **File:**
`src/service/PluginComponentRegistryService.ts`.

## Reviewer Note (independence caveat)

This review was performed **inline by the orchestrator model (glm-5.2)**, not by
an independent `gsd-code-reviewer` sonnet pass. The sonnet reviewer was spawned
but hit the Anthropic 5-hour usage limit (4th quota death this session; reset
pending). To deliver a review without further quota-blocked delays, the
orchestrator performed the standard-depth analysis directly.

Implications:
- The Task 2 code (`PluginComponentRegistryService.ts`) was written by this same
  orchestrator session, so that portion is a **self-review** (adversarial, but not
  independent). The Task 1 / 18-01 code (`LocalSkillSourceAdapter`,
  `HookDispatcher` skill-ref, `buildLocalSkillDraft`, `buildWorkspaceSkillDefinitions`,
  `WorkspaceConfigScanner` skill scan) was written by a prior sonnet executor and
  reviewed here independently.
- For a fully independent pass, re-run `/gsd-code-review 18` when the sonnet quota
  window is fresh. The findings above are a faithful standard-depth review; the
  independence caveat is the only material limitation.

## Conclusion

Phase 18 code is **ship-quality**. No critical or warning findings. The seven
Info observations are documentation-grade notes, not defects. Security boundaries
(path traversal, plugin poisoning, worker isolation, safe-schema parsing) are all
verified. Recommend proceeding to manual UAT (`/gsd-verify-work 18`).
