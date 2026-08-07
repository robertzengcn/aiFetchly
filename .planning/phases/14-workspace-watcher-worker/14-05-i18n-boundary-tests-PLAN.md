---
phase: 14-workspace-watcher-worker
plan: 05
slug: i18n-boundary-tests
type: execute
wave: 5
depends_on: [14-04-renderer-trust-card]
files_modified:
  - src/views/lang/en.ts
  - src/views/lang/zh.ts
  - src/views/lang/es.ts
  - src/views/lang/fr.ts
  - src/views/lang/de.ts
  - src/views/lang/ja.ts
  - src/views/lang/index.ts
  - test/vitest/main/i18n/workspaceTrust.i18n.parity.test.ts
  - test/vitest/main/rendererNoFsAccessToWorkspaceConfig.test.ts
  - test/vitest/main/childprocess/rescanSlaBackstop.test.ts
autonomous: true
requirements: [TRS-03, TRS-04, CTX-02]
tags: [i18n, translations, boundary-test, perf-backstop, trs-07, sc5]

must_haves:
  truths:
    - "All 6 language files (en/zh/es/fr/de/ja) contain a workspaceTrust i18n group with the 7 keys: title, body, preview, trustInstructions, trustAll, keepDisabled, previewEmpty (I18-01 + D-03)"
    - "WorkspaceTrustCard.vue's user-facing strings ALL flow through t('workspaceTrust.x') with `|| 'English fallback'` — no hardcoded user-facing text in the component"
    - "i18n parity test asserts key-set equality across all 6 lang files (no missing translations for the workspaceTrust group)"
    - "TRS-07 renderer boundary test walks src/views/** and asserts NO file reads the literals `.aifetchly` or `AGENTS.md` via fs/path/os — preview content reaches the renderer ONLY through the IPC invoke channel"
    - "SC5 perf-backstop test runs a LARGER fixture (50 files / 2MB total — well above the typical 10/512KB) and asserts scan completes under 2 seconds (regression guard, not the 500ms SLA — the SLA is enforced in Plan 14-01's rescanSla.test.ts)"
    - "All new translations follow the existing lang file shape (object exported under the workspaceTrust key, nested under the top-level export, consistent with Phase 13's aifetchlyConfig + slashCommands groups)"
  artifacts:
    - "workspaceTrust i18n group in src/views/lang/{en,zh,es,fr,de,ja}.ts (7 keys each)"
    - "test/vitest/main/i18n/workspaceTrust.i18n.parity.test.ts — 6-lang key-set parity assertion"
    - "test/vitest/main/rendererNoFsAccessToWorkspaceConfig.test.ts — TRS-07 boundary (extends Phase 13's renderer-no-fs test to workspace-config literals)"
    - "test/vitest/main/childprocess/rescanSlaBackstop.test.ts — SC5 regression backstop (larger fixture, 2s ceiling)"
  prohibitions:
    - "MUST NOT add the workspaceTrust group to only some lang files — all 6 (en/zh/es/fr/de/ja) must be updated atomically (CLAUDE.md i18n rule)"
    - "MUST NOT hardcode English text in WorkspaceTrustCard.vue — all user-facing strings via t() with fallback (CLAUDE.md i18n rule)"
    - "MUST NOT relax the TRS-07 boundary — the test must FAIL if any src/views/** file reads `.aifetchly` or `AGENTS.md` via fs/path/os"
    - "MUST NOT make the SC5 backstop test the primary SLA enforcement — it's a regression guard; the 500ms SLA lives in Plan 14-01's rescanSla.test.ts (the backstop's 2s ceiling is for drift detection on a larger fixture, not the user-visible SLA)"
  key_links:
    - "WorkspaceTrustCard.vue t('workspaceTrust.title') → src/views/lang/en.ts workspaceTrust.title (fallback) / zh.ts (Chinese) / etc."
    - "TRS-07 boundary test → src/views/** → asserts no fs/path/os import touches the workspace-config literals"
---

<objective>
Close out Phase 14 with the three cross-cutting quality gates: (1) the `workspaceTrust` i18n group in all 6 supported languages (en/zh/es/fr/de/ja) consumed by `WorkspaceTrustCard.vue` (I18-01 + D-03); (2) the TRS-07 renderer boundary test that proves the renderer NEVER reads workspace config files directly — preview content reaches it only through the main-process IPC channel; (3) the SC5 perf-test backstop — a larger-fixture regression guard complementing Plan 14-01's per-commit log+assert SLA test.

Purpose: Satisfy the project-wide i18n discipline (CLAUDE.md mandate — failure here breaks the user experience in 5 of 6 locales), preserve the Phase 13 TRS-07 boundary invariant against the new workspace-config surface, and lock in SC5 against drift on larger workspaces.

Output: 6 updated lang files, 3 new test files. After this plan, Phase 14 is fully validated and ready for `/gsd-verify-work 14`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/14-workspace-watcher-worker/14-CONTEXT.md
@.planning/phases/14-workspace-watcher-worker/14-RESEARCH.md
@.planning/phases/14-workspace-watcher-worker/14-04-SUMMARY.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-05-SUMMARY.md

# Existing lang file shape (mirror the aifetchlyConfig + slashCommands groups from Phase 13)
@src/views/lang/en.ts
@src/views/lang/index.ts

# Component consuming the keys (verify the fallback strings match the keys)
@src/views/components/aiChatV2/WorkspaceTrustCard.vue

# Existing TRS-07 boundary test from Phase 13-05 (extend, do not duplicate)
@test/vitest/main/rendererNoFsAccessToAifetchly.test.ts

# Plan 14-01's per-commit SLA test (the backstop complements this, not replaces it)
@test/vitest/main/childprocess/rescanSla.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: workspaceTrust i18n group in all 6 lang files + parity test</name>
  <files>src/views/lang/en.ts, src/views/lang/zh.ts, src/views/lang/es.ts, src/views/lang/fr.ts, src/views/lang/de.ts, src/views/lang/ja.ts, test/vitest/main/i18n/workspaceTrust.i18n.parity.test.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-CONTEXT.md (carry-forward i18n rule: 6 languages, add workspaceTrust group)
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Code Examples → i18n keys for the workspaceTrust group — 7 keys listed)
    - src/views/lang/en.ts (find the existing aifetchlyConfig + slashCommands groups from Phase 13 — add workspaceTrust as a sibling group with the same indentation/key style)
    - src/views/lang/index.ts (confirm how lang files are registered — ensure the new keys flow through vue-i18n createI18n)
    - src/views/components/aiChatV2/WorkspaceTrustCard.vue (from Plan 14-04 — confirm the exact t('workspaceTrust.x') keys used + the English fallbacks so the en.ts values match)
    - CLAUDE.md (i18n MANDATORY RULE section — 6 languages, t() with || fallback)
  </read_first>
  <action>
    Add a `workspaceTrust` group with exactly 7 keys to EACH of the 6 lang files: `title`, `body`, `preview`, `trustInstructions`, `trustAll`, `keepDisabled`, `previewEmpty`. Place it adjacent to the existing `aifetchlyConfig` and `slashCommands` groups (Phase 13) — same nesting level, same indentation. The English values from Plan 14-04's WorkspaceTrustCard.vue fallbacks are the canonical source — match them exactly in en.ts:
    - title: "Workspace AiFetchly config"
    - body: "This workspace defines AiFetchly configuration. Review and trust it before enabling its instructions and commands."
    - preview: "Preview"
    - trustInstructions: "Trust instructions only"
    - trustAll: "Trust all workspace AI config"
    - keepDisabled: "Keep disabled"
    - previewEmpty: "No AGENTS.md content to preview."

    For zh/es/fr/de/ja: provide accurate translations of each of the 7 keys in the target language. Use the appropriate register (informal "you" for user-facing UI in es/fr/de, polite form in ja, simplified Chinese in zh). Match the tone of the existing Phase 13 translations in those files (i.e., read the existing aifetchlyConfig group in zh.ts to calibrate tone before translating).

    Verify src/views/lang/index.ts registers the updated lang files (it likely re-exports them as-is — no change needed unless the file explicitly enumerates groups).

    Write `test/vitest/main/i18n/workspaceTrust.i18n.parity.test.ts` that imports all 6 lang files, extracts the workspaceTrust group from each, and asserts: (a) all 6 groups have exactly the same key set (deep-equal on Object.keys); (b) every key has a non-empty string value in every language; (c) the key set matches the expected 7 keys (title/body/preview/trustInstructions/trustAll/keepDisabled/previewEmpty). Use the existing Phase 13 i18n parity test as the structural template (if one exists in test/vitest/main/i18n/).
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs workspaceTrust.i18n.parity && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "workspaceTrust:" src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts` returns 1 for EACH file
    - `grep -c "trustInstructions\|trustAll\|keepDisabled\|previewEmpty" src/views/lang/en.ts` returns at least 4 (all keys present in en)
    - The i18n parity test passes: 6 lang files have identical workspaceTrust key sets, all non-empty
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>workspaceTrust i18n group lives in all 6 lang files with accurate translations; parity test guarantees no missing keys across languages.</done>
</task>

<task type="auto">
  <name>Task 2: TRS-07 renderer boundary test (workspace-config literals) + SC5 perf-backstop test (larger fixture)</name>
  <files>test/vitest/main/rendererNoFsAccessToWorkspaceConfig.test.ts, test/vitest/main/childprocess/rescanSlaBackstop.test.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Validation Architecture → "TRS-07 — renderer never reads workspace files directly" + "SC5 <500ms Rescan SLA Verification" sections)
    - .planning/phases/14-workspace-watcher-worker/14-VALIDATION.md (manual-only verifications + boundary test rows)
    - test/vitest/main/rendererNoFsAccessToAifetchly.test.ts (Phase 13's TRS-07 boundary test — extend the existing pattern; do NOT duplicate the Phase 13 assertion, add a workspace-config-specific one)
    - test/vitest/main/childprocess/rescanSla.test.ts (Plan 14-01's per-commit SLA test — the backstop uses a larger fixture and a looser time ceiling; do NOT duplicate the typical-assertion)
    - test/vitest/main/childprocess/_fixtures/workspaceTmpdir.ts (the fixture helper from Plan 14-01 — reuse for the backstop)
    - src/service/workspaceWatch/WorkspaceConfigScanner.ts (the scanner under test for the backstop)
  </read_first>
  <action>
    Create `test/vitest/main/rendererNoFsAccessToWorkspaceConfig.test.ts` extending Phase 13's TRS-07 boundary. Walk `src/views/**` recursively, read each `.ts`/`.vue` file, and assert NONE contains a filesystem read (via `fs`, `fs/promises`, `path.join`, `readFileSync`, `readFile`, or `os.homedir`) of the workspace-config literals `.aifetchly` or `AGENTS.md`. The forbidden-token list is `{".aifetchly", "AGENTS.md"}` matched against any line that ALSO contains a fs/path/os call. Reference the canonical forbidden-token list by name ("the TRS-07 workspace-config boundary token set") in plan prose — do NOT inline the literal tokens in worker source or worker source comments beyond this test file. Use `describe`/`it` consistent with Phase 13's test. The test FAILS if any src/views/** file violates the boundary (e.g., a renderer module reading `.aifetchly/AGENTS.md` directly instead of going through the AIFETCHLY_WORKSPACE_TRUST_PREVIEW invoke channel).

    Create `test/vitest/main/childprocess/rescanSlaBackstop.test.ts` as a regression guard COMPLEMENTING (not replacing) Plan 14-01's rescanSla.test.ts. Fixture: 50 files / ~2MB total — generate `.aifetchly/AGENTS.md` at 256KB (the CFG-04 cap), `.aifetchly/settings.json` at 32KB (cap), and 48× `.aifetchly/commands/cmdN.md` at ~36KB each (well under the 64KB command cap, totaling ~1.7MB+). Measure `performance.now()` around `scanner.scan(...)`; log `[SC5-backstop] rescan elapsed: ${elapsed.toFixed(1)}ms (files=${snap.files.length})`; assert `elapsed < 2000` (2 seconds — the regression ceiling, NOT the 500ms user-visible SLA). The 500ms SLA is enforced by Plan 14-01's rescanSla.test.ts on the typical fixture; this backstop catches drift on larger workspaces via the CI/verify-work path.

    Run both tests; both MUST pass. If the TRS-07 test fails, a renderer file is reading workspace config directly — fix the violation by routing through the IPC channel. If the backstop fails, profile the scanner hotspot (likely hashing or frontmatter parse on the larger file count).
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs rendererNoFsAccessToWorkspaceConfig rescanSlaBackstop && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `test/vitest/main/rendererNoFsAccessToWorkspaceConfig.test.ts` exists and passes
    - The TRS-07 test walks `src/views/**` and asserts no file matches the forbidden-token+fs-call combination
    - `test/vitest/main/childprocess/rescanSlaBackstop.test.ts` exists and passes; log line `[SC5-backstop] rescan elapsed:` appears in test output
    - The backstop fixture creates at least 50 files and asserts `<2000` ms (regression ceiling, distinct from the 500ms typical-case SLA in Plan 14-01)
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>TRS-07 renderer boundary enforced for workspace-config files (renderer cannot read `.aifetchly`/`AGENTS.md` directly); SC5 regression backstop in place for larger workspaces; Phase 14 ready for `/gsd-verify-work 14`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → filesystem (workspace config) | HARD BOUNDARY enforced by the TRS-07 test — renderer must NOT read `.aifetchly` or `AGENTS.md` via fs/path/os. |
| i18n key set → 6 lang files | The parity test enforces key-set equality across all 6 supported locales. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-14-07 | Info Disclosure | Renderer filesystem access to workspace config | medium | mitigate | TRS-07 boundary test fails CI if any src/views/** file reads the workspace-config literals via fs/path/os. Preview content reaches renderer only via the IPC channel (Plan 14-04). |
| T-14-i18n | Availability | Missing translations in 5 of 6 locales | low | accept | Parity test enforces 6-lang key-set equality; missing keys would show English fallback (degraded UX, not a security issue). |
| T-14-SC5-drift | Availability | Performance regression on larger workspaces | low | mitigate | SC5 backstop test catches drift at 50 files / 2MB with a 2s ceiling; complements the per-commit 500ms SLA test. |
</threat_model>

<verification>
- `npx vitest run --config vite.main.config.mjs workspaceTrust.i18n.parity rendererNoFsAccessToWorkspaceConfig rescanSlaBackstop` green
- `yarn tsc --noEmit` clean
- Manual: switch the app locale to each of zh/es/fr/de/ja and confirm the WorkspaceTrustCard text renders in the selected language
</verification>

<success_criteria>
- I18-01: workspaceTrust group in all 6 lang files, parity enforced
- TRS-07: renderer boundary enforced for workspace-config files
- SC5: regression backstop in place for larger workspaces
</success_criteria>

<output>
Create `.planning/phases/14-workspace-watcher-worker/14-05-SUMMARY.md` when done
</output>

## Artifacts this plan produces

**Modified files:**
- `src/views/lang/en.ts` — workspaceTrust group (7 keys, canonical English)
- `src/views/lang/zh.ts` — workspaceTrust group (Simplified Chinese translations)
- `src/views/lang/es.ts` — workspaceTrust group (Spanish translations)
- `src/views/lang/fr.ts` — workspaceTrust group (French translations)
- `src/views/lang/de.ts` — workspaceTrust group (German translations)
- `src/views/lang/ja.ts` — workspaceTrust group (Japanese translations)
- `src/views/lang/index.ts` — registration (only if it enumerates groups)

**New files:**
- `test/vitest/main/i18n/workspaceTrust.i18n.parity.test.ts` — 6-lang key-set parity assertion
- `test/vitest/main/rendererNoFsAccessToWorkspaceConfig.test.ts` — TRS-07 boundary (workspace-config literals)
- `test/vitest/main/childprocess/rescanSlaBackstop.test.ts` — SC5 regression backstop (50 files / 2MB, 2s ceiling)

**New i18n keys (in all 6 lang files):**
- `workspaceTrust.title`, `workspaceTrust.body`, `workspaceTrust.preview`, `workspaceTrust.trustInstructions`, `workspaceTrust.trustAll`, `workspaceTrust.keepDisabled`, `workspaceTrust.previewEmpty`
