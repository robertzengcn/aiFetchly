---
phase: 13-global-context-and-built-in-slash-commands
plan: 13-05-i18n-boundary-tests
subsystem: testing
tags: [i18n, vue-i18n, boundary-test, trs-07, renderer-isolation, static-analysis]

requires:
  - phase: 13-03b
    provides: "Config-status / reload strings rendered by the dispatcher"
  - phase: 13-04
    provides: "Renderer files (AiChatV2.vue, AiChatV2SlashSuggestions.vue, slashCommands.ts) scanned by the TRS-07 boundary test; t() keys referenced by components"
provides:
  - aifetchlyConfig + slashCommands i18n groups in all 6 lang files (en/zh/es/fr/de/ja)
  - rendererNoFsAccessToAifetchly.test.ts — executable TRS-07 boundary (scans src/views/**)
  - i18nKeysPresent.test.ts — executable I18-01 static check (6-lang key parity)
affects: []

tech-stack:
  added: []
  patterns: [static boundary test walking the renderer tree, i18n key-set parity test, interpolation-token preservation]

key-files:
  created:
    - test/vitest/main/rendererNoFsAccessToAifetchly.test.ts
    - test/vitest/main/i18nKeysPresent.test.ts
  modified:
    - src/views/lang/en.ts
    - src/views/lang/zh.ts
    - src/views/lang/es.ts
    - src/views/lang/fr.ts
    - src/views/lang/de.ts
    - src/views/lang/ja.ts
    - src/views/components/aiChatV2/AiChatV2.vue

key-decisions:
  - "TRS-07 boundary test scans ALL of src/views/** for the config-root folder literal AND direct fs/path/os/child_process imports — strict rule, no auto-exempt. A LEGACY_ALLOWLIST array exists for documented exceptions (currently empty)."
  - "i18n test asserts key-SET parity (not value parity) across the 6 files — translations differ, key structure must not."
  - "The forbidden folder literal is spelled as '.' + 'aifetchly' inside the test to avoid the test file itself tripping grep-based audits (the test lives under test/, not src/views/, so its own walk does not scan it)."

patterns-established:
  - "Pattern 1: Renderer isolation (TRS-07) is an executable test, not a code-review convention — future phases cannot regress it without failing the build."
  - "Pattern 2: i18n key-set parity (I18-01) is an executable test — adding a key to one lang file without the other 5 fails the build."

requirements-completed: [TRS-07, I18-01]

coverage:
  - id: D1
    description: "All 6 lang files have aifetchlyConfig + slashCommands groups with identical key sets (I18-01)"
    requirement: I18-01
    verification:
      - kind: unit
        ref: "test/vitest/main/i18nKeysPresent.test.ts (236 tests: per-lang groups + key-set parity)"
        status: pass
    human_judgment: true
    rationale: "Automated test proves key presence + parity; translation quality/accuracy in zh/es/fr/de/ja needs visual locale QA."
  - id: D2
    description: "Renderer never reads the config folder directly — no fs/path/os/child_process imports, no config-root literal in src/views/** (TRS-07)"
    requirement: TRS-07
    verification:
      - kind: unit
        ref: "test/vitest/main/rendererNoFsAccessToAifetchly.test.ts (3 tests: walk + literal + imports)"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-05
status: complete
---

# Plan 13-05: i18n + Boundary Tests Summary

**Full 6-language i18n coverage for phase-13 strings + executable TRS-07 renderer-isolation boundary test + I18-01 key-parity static test**

## Performance

- **Tasks:** 2/2 complete
- **Files created:** 2 (tests)
- **Files modified:** 7 (6 lang files + AiChatV2.vue comment fix)
- **Tests:** 239 new (236 i18n + 3 boundary)

## Accomplishments
- `aifetchlyConfig` (16 keys) + `slashCommands` (16 keys) groups added to all 6 lang files with identical key sets and preserved `{commandCount}`/`{diagnosticCount}`/`{agentCount}`/`{hookCount}`/`{skillCount}`/`{lastReloadAt}`/`{watcherState}`/`{name}` interpolation tokens
- `rendererNoFsAccessToAifetchly.test.ts` — walks `src/views/**`, asserts no config-root folder literal + no direct `fs`/`path`/`os`/`child_process` imports (TRS-07 locked in as executable test)
- `i18nKeysPresent.test.ts` — imports all 6 lang files, asserts both groups + required keys + key-set parity + interpolation tokens (I18-01 locked in)
- **Caught a real TRS-07 leak:** AiChatV2.vue had a code comment referencing the config-root folder literal (`~/.aifetchly`); reworded to "the global config" so the boundary test passes (the literal belongs only in main-process `AIFetchlyConfigConstants`)

## Task Commits

1. **Task 1 — i18n groups in 6 lang files** — (this commit)
2. **Task 2 — TRS-07 boundary + i18n parity tests** — (this commit)
3. **AiChatV2.vue comment fix** — (this commit, bundled — the boundary test surfaced it)

## Decisions Made
- TRS-07 test is strict: no auto-exempt for legacy files. `LEGACY_ALLOWLIST` array exists for documented exceptions (currently empty).
- i18n test asserts key-SET parity (translations differ, key structure must not).
- Forbidden folder literal spelled as `"." + "aifetchly"` inside the test file to avoid tripping grep audits.

## Deviations from Plan

### Auto-fixed Issues

**1. AiChatV2.vue comment contained the config-root folder literal**
- **Found during:** Task 2 (the TRS-07 boundary test failed on first run)
- **Issue:** Plan 13-04's AiChatV2.vue onMounted comment said `// ~/.aifetchly (design §16.3, §18.2)` — a renderer file referencing the config folder path, which violates the strict TRS-07 invariant.
- **Fix:** Reworded to `// the global config (design §16.3, §18.2)`.
- **Verification:** `grep -rln '\.aifetchly' src/views/` returns nothing; boundary test passes.
- **Committed in:** (this commit)

**2. i18nKeysPresent.test.ts type fix**
- **Found during:** Task 2 (tsc gate)
- **Issue:** `ReturnType<typeof en>` is invalid (en is an object, not a function); then `typeof en` made the Record too strict (the 6 lang files' `common` key sets differ slightly).
- **Fix:** Loosened to `Record<string, Record<string, unknown>>` indexed per lang.
- **Verification:** `npx tsc --noEmit` 0 errors; 236/236 tests pass.
- **Committed in:** (this commit)

**Total deviations:** 2 auto-fixed (1 boundary-test finding + 1 type fix)
**Impact on plan:** Minimal — both fixes increase correctness; no scope creep.

## Issues Encountered
None beyond the two auto-fixes above.

## User Setup Required
None.

## Next Phase Readiness
- Phase 13 is fully implemented: 5 plans complete, 433+ tests passing across config loader, registry/parser, context pipeline, dispatcher/IPC, renderer UI, i18n, and boundary tests.
- TRS-07 and I18-01 are locked in as executable tests — future phases cannot regress them.
- Ready for the post-merge test gate, goal verification, and phase completion.

---
*Phase: 13-global-context-and-built-in-slash-commands*
*Completed: 2026-07-05*
