---
phase: 13-global-context-and-built-in-slash-commands
plan: 05
type: execute
wave: 5
depends_on: [03b, 04]
files_modified:
  - src/views/lang/en.ts
  - src/views/lang/zh.ts
  - src/views/lang/es.ts
  - src/views/lang/fr.ts
  - src/views/lang/de.ts
  - src/views/lang/ja.ts
  - test/vitest/main/rendererNoFsAccessToAifetchly.test.ts
  - test/vitest/main/i18nKeysPresent.test.ts
autonomous: true
requirements: [TRS-07, I18-01]
must_haves:
  truths:
    - "All six language files (en, zh, es, fr, de, ja) export the two new top-level groups 'aifetchlyConfig' and 'slashCommands' with identical key structures (I18-01)"
    - "Every user-facing string introduced in Plans 03-04 has a translation in all six languages, with English fallback available in components via t('group.key') || 'English Text' (I18-01, CLAUDE.md i18n rule)"
    - "No source file under src/views/** imports fs, path, os, or references the config-root path literal (TRS-07 — verified by a static boundary test that scans the renderer tree)"
    - "The boundary test passes deterministically regardless of which files exist in src/views/ (walks the tree, asserts no forbidden tokens)"
    - "The i18n static test passes deterministically by importing all six lang files and asserting both groups exist with the required keys"
  artifacts:
    - "Two new top-level i18n groups in each of {en,zh,es,fr,de,ja}.ts: 'aifetchlyConfig' (reload/status/diagnostics strings) and 'slashCommands' (help/clear/reloadConfig/status/noMatches/unknownCommand/source badges/argumentHint)"
    - "test/vitest/main/rendererNoFsAccessToAifetchly.test.ts — walks src/views/** and asserts no forbidden tokens"
    - "test/vitest/main/i18nKeysPresent.test.ts — imports all six lang files and asserts both groups + required keys exist"
  key_links:
    - "Components (Plan 04) call t('slashCommands.help') || 'Help' — the key MUST exist in all six lang files or the fallback fires (I18-01 wants real translations, not fallback reliance)"
    - "Boundary test scans src/views/** — covers everything Plan 04 added (AiChatV2SlashSuggestions.vue, slashCommands.ts, AiChatV2Composer.vue, AiChatV2.vue) plus all pre-existing renderer files"
  prohibitions:
    - "No renderer file may import 'fs', 'path', 'os', or reference the config-root folder literal (TRS-07)"
    - "No hardcoded English strings in components WITHOUT a t() fallback (CLAUDE.md i18n rule — all new UI text must use t() with English fallback)"
    - "No use of google-translate or other auto-translation services at runtime — translations are static in the lang files (CLAUDE.md)"
    - "Do NOT modify the legacy src/views/components/aiChat/AiChatBox.vue (Pitfall 7 — the boundary test scans it too; if it has pre-existing forbidden tokens, that is a pre-existing finding to surface, not a regression to fix in this phase)"
---

<objective>
Close out Phase 13 with full 6-language i18n coverage for every user-facing string the feature adds (I18-01), plus the two cross-cutting boundary/static tests that enforce TRS-07 (renderer never reads the config folder) and I18-01 (all six lang files have both groups).

Purpose: Satisfy the global milestone's i18n mandate (CLAUDE.md) and lock in the renderer/process-isolation security invariant as an executable test so future phases cannot regress it.
Output: Modifications to six language files (adding two groups each) + two new Vitest test files.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md
@docs/prd/aifetchly-local-extensibility-technical-design.md
@src/views/lang/en.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add aifetchlyConfig + slashCommands i18n groups to all six language files (I18-01)</name>
  <files>
    src/views/lang/en.ts,
    src/views/lang/zh.ts,
    src/views/lang/es.ts,
    src/views/lang/fr.ts,
    src/views/lang/de.ts,
    src/views/lang/ja.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md section §18.4 (i18n key groups + example structure)
    - src/views/lang/en.ts lines 1826-1903 — the existing 'aiChatV2' group. This is the structural template: a top-level key with nested camelCase / snake_case keys. Read enough to match the file's conventions (trailing commas, quoting style, indentation).
    - src/views/lang/index.ts — the language registry; confirm all six files are wired (they should be — CLAUDE.md lists them).
    - All Plan 03 + Plan 04 component/service files — extract every t('slashCommands.*') and t('aifetchlyConfig.*') call to build the complete key list. The keys MUST match across all six files.
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Code Examples (Existing i18n Group Shape) — the recommended key structure for both groups
  </read_first>
  <action>
    Edit each of the six files to add TWO new top-level groups. Place them adjacent to the existing 'aiChatV2' group (after it) for discoverability. Use the EXACT same key structure in all six files — only the values differ (translated).

    Group 1 — aifetchlyConfig (strings used by /status, /reload-config rendering, and any config-status UI):
      - title: "AiFetchly Configuration"
      - reload: "Reload configuration"
      - reloadStarted: "Reloading AiFetchly configuration..."
      - reloadResult: "Reloaded AiFetchly config:\n- Commands: {commandCount}\n- Diagnostics: {diagnosticCount}"
      - reloadFailed: "Failed to reload AiFetchly configuration."
      - status: "Configuration status"
      - statusResult: "AiFetchly configuration status:\n- Commands: {commandCount}\n- Agents: {agentCount}\n- Hooks: {hookCount}\n- Skills: {skillCount}\n- Diagnostics: {diagnosticCount}\n- Last reload: {lastReloadAt}\n- Watcher: {watcherState}"
      - statusEmpty: "No global config loaded."
      - watcherNotStarted: "not started (phase 14)"
      - diagnosticWarning: "Warning"
      - diagnosticError: "Error"
      - diagnosticInfo: "Info"
      - workspaceTrustTitle: "Workspace AiFetchly config"
      - workspaceTrustBody: "This workspace defines AiFetchly configuration. Review and trust it before enabling commands."
      - commandDisabledUntrusted: "Command {name} is disabled because workspace config is not trusted."

    Group 2 — slashCommands (strings used by the suggestions dropdown + dispatcher messages):
      - help: "Help"
      - clear: "Clear conversation"
      - reloadConfig: "Reload config"
      - status: "Status"
      - helpResultTitle: "Available commands"
      - noMatches: "No matching commands"
      - unknownCommand: "Unknown slash command: /{name}"
      - notDispatchable: "Type a command name after / to run it."
      - notACommand: "This message is not a slash command."
      - disabledCommand: "Command /{name} is disabled."
      - sourceBuiltin: "Built-in"
      - sourceUser: "User"
      - sourceWorkspace: "Workspace"
      - sourcePlugin: "Plugin"
      - argumentHint: "Arguments"
      - argumentHintNone: "none"

    Translations:
      - en.ts: the values above (English is the source/fallback).
      - zh.ts: accurate Chinese (Simplified) translations. Mirror the existing zh.ts tone.
      - es.ts: Spanish translations.
      - fr.ts: French translations.
      - de.ts: German translations.
      - ja.ts: Japanese translations.
      - {commandCount}, {diagnosticCount}, {agentCount}, {hookCount}, {skillCount}, {lastReloadAt}, {watcherState}, {name} placeholders are interpolation tokens — keep them as {token} verbatim in all six files (the i18n library or t() fallback replaces them).

    IMPORTANT: do NOT introduce string literals that contain the config-root folder name (the dot-aifetchly literal) into the lang files. The phrase "AiFetchly configuration" uses the product name, not the folder path — that is fine. The folder-path literal belongs only in main-process source (Plan 01 constant AIFETCHLY_CONFIG_DIR_NAME). The boundary test in Task 2 scans src/views/** and would flag the folder literal if it appeared here.
  </action>
  <verify>
    <automated>yarn vue-check 2>&1 | tail -10 && yarn testmain -- i18nKeysPresent</automated>
  </verify>
  <acceptance_criteria>
    - yarn vue-check exits 0 (all six lang files parse + type-check)
    - yarn testmain -- i18nKeysPresent exits 0 (the static test from Task 2 passes)
    - All six files have the aifetchlyConfig group: `for f in en zh es fr de ja; do grep -c "aifetchlyConfig:" src/views/lang/$f.ts; done` — each returns at least 1
    - All six files have the slashCommands group: `for f in en zh es fr de ja; do grep -c "slashCommands:" src/views/lang/$f.ts; done` — each returns at least 1
    - The interpolation tokens are preserved in all six files: `grep -c "{commandCount}" src/views/lang/en.ts` returns at least 1 (and the same for the other tokens; spot-check at least one non-English file)
    - No config-root folder literal in any lang file: `! grep -rE "\.aifetchly" src/views/lang/` exits 0 (TRS-07 — the folder literal is main-process-only)
  </acceptance_criteria>
  <done>
    All six language files have both groups with identical key structures and accurate translations. Every Plan 03/04 user-facing string has a translation. No config-root folder literal leaks into the renderer i18n files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: TRS-07 renderer boundary test + I18-01 keys-present static test</name>
  <files>
    test/vitest/main/rendererNoFsAccessToAifetchly.test.ts,
    test/vitest/main/i18nKeysPresent.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md section §13.1 (TRS-07 boundary — renderer isolation) and §22 (manual QA checklist boundary items)
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Validation Architecture — Boundary Tests subsection (the TRS-07 test sketch with walk() + FORBIDDEN_TOKENS)
    - test/vitest/main/registerValidatedHandler.test.ts header — the vitest mock + describe/it pattern used in this repo
    - test/vitest/_typecheck/globalSetup.ts — confirm the typecheck gate runs (these test files must pass tsc --noEmit)
    - src/views/lang/index.ts — the lang registry, to import all six files programmatically in the i18n test
    - vite.main.config.mjs test block — confirm test/vitest/main/**/*.test.ts is picked up by the glob (it should be; no config change needed)
  </read_first>
  <behavior>
    - rendererNoFsAccessToAifetchly: walks src/views/**, asserts no .ts or .vue file contains the config-root folder literal token
    - rendererNoFsAccessToAifetchly: asserts no .ts or .vue file under src/views/ imports 'fs', 'path', or 'os' in a way that touches config (allow path/fs imports that are clearly unrelated — but the simplest correct rule is: assert NO direct import of node 'fs', 'path', or 'os' modules from ANY renderer file, since renderer should only use IPC; flag this as a strict rule and surface any pre-existing violations as findings)
    - i18nKeysPresent: imports en/zh/es/fr/de/ja, asserts each has a non-empty aifetchlyConfig group AND a non-empty slashCommands group
    - i18nKeysPresent: asserts the key SETS match across all six files (no missing keys in any language)
    - i18nKeysPresent: asserts interpolation tokens ({commandCount}, {name}, etc.) are present in the values that need them, in all six files
  </behavior>
  <action>
    Create two test files.

    File 1 — test/vitest/main/rendererNoFsAccessToAifetchly.test.ts (TRS-07 boundary):
      - Import describe, it, expect from vitest; readFileSync, readdirSync, statSync from fs; join, extname, relative from path.
      - Define RENDERER_ROOT = "src/views" (resolve from project root — vitest runs from project root).
      - Define FORBIDDEN_TOKENS as the config-root folder literal (a single dot-prefixed lowercase entry — spell it as the join of "." + "aifetchly" to avoid this TEST file itself containing the literal in a way that confuses readers; OR just use the constant string — the test file is under test/, not src/views/, so it is NOT scanned by itself).
      - Define walk(dir): recursive .ts/.vue collector (skip node_modules, skip .d.ts).
      - Test "no renderer file references the config-root folder literal": for each walked file, read source, assert it does NOT contain the forbidden token. On failure, the assertion message includes the offending file path + line context so the developer can fix it.
      - Test "no renderer file imports node fs/path/os directly": for each walked file, assert the source does not match /(^|\s)import\s+.*from\s+['"](fs|path|os|child_process)['"]/ and does not match /require\(['"](fs|path|os|child_process)['"]\)/. (Strict rule — surface pre-existing violations as findings the developer can triage; do NOT auto-exempt them. If the legacy code has legitimate renderer fs usage that cannot be removed, the developer adds an allowlist array of file paths to this test with a comment explaining why.)
      - If a pre-existing violation in legacy code (e.g., AiChatBox.vue) is found when this test first runs, document it as a KNOWN finding in the test file's header comment + surface it in the Plan 05 SUMMARY — do NOT silently exclude.

    File 2 — test/vitest/main/i18nKeysPresent.test.ts (I18-01 static check):
      - Import all six lang default exports: `import en from "@/views/lang/en"` etc. (Use the @ alias that vitest resolves via vite.main.config.mjs — confirm the alias works for this import path; if not, use a relative path ../../../src/views/lang/{en,zh,es,fr,de,ja}.)
      - Define REQUIRED_AIFETCHLY_CONFIG_KEYS = ["title","reload","reloadStarted","reloadResult","reloadFailed","status","statusResult","statusEmpty","watcherNotStarted","diagnosticWarning","diagnosticError","diagnosticInfo","workspaceTrustTitle","workspaceTrustBody","commandDisabledUntrusted"] as const.
      - Define REQUIRED_SLASH_COMMANDS_KEYS = ["help","clear","reloadConfig","status","helpResultTitle","noMatches","unknownCommand","notDispatchable","notACommand","disabledCommand","sourceBuiltin","sourceUser","sourceWorkspace","sourcePlugin","argumentHint","argumentHintNone"] as const.
      - Test "all six lang files have the aifetchlyConfig group with required keys": for each lang, assert typeof lang.aifetchlyConfig === "object"; for each key in REQUIRED_AIFETCHLY_CONFIG_KEYS assert typeof lang.aifetchlyConfig[key] === "string" && lang.aifetchlyConfig[key].length > 0.
      - Test "all six lang files have the slashCommands group with required keys": same shape for REQUIRED_SLASH_COMMANDS_KEYS.
      - Test "key sets are identical across all six files": compute Object.keys(lang.aifetchlyConfig).sort() for each lang; assert all six produce the same array. Same for slashCommands.
      - Test "interpolation tokens preserved": for the reloadResult/statusResult/unknownCommand/commandDisabledUntrusted values, assert they contain the expected {token} placeholders. Run this assertion across all six files.
  </action>
  <verify>
    <automated>yarn testmain -- rendererNoFsAccessToAifetchly && yarn testmain -- i18nKeysPresent</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/rendererNoFsAccessToAifetchly.test.ts exits 0
    - test/vitest/main/i18nKeysPresent.test.ts exits 0
    - The boundary test would FAIL if any renderer file added the config-root literal: verified by temporarily adding the literal to a scratch renderer file (or by code review of the assertion logic — the test reads files dynamically so it MUST catch new violations)
    - `grep -c "FORBIDDEN_TOKENS\|walk" test/vitest/main/rendererNoFsAccessToAifetchly.test.ts` returns at least 2 (the walk + token-check structure exists)
    - `grep -c "REQUIRED_AIFETCHLY_CONFIG_KEYS\|REQUIRED_SLASH_COMMANDS_KEYS" test/vitest/main/i18nKeysPresent.test.ts` returns at least 2
    - Full phase suite green: `yarn testmain` exits 0 (all Wave 0 + new tests pass together, typecheck gate passes)
  </acceptance_criteria>
  <done>
    TRS-07 is enforced as an executable boundary test (renderer never imports fs/path/os or references the config-root literal). I18-01 is enforced as a static test (all six lang files have both groups with identical key sets). The full phase 13 test suite is green.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Static test boundary (src/views/**) | The boundary test treats the entire renderer source tree as untrusted: any file that gains a forbidden import or token fails the build. |
| i18n contract boundary | The static test treats the six lang files as a contract: all must expose the same key set, so a developer cannot add a key to one language and forget the other five. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-13-06 | Info Disclosure | Renderer source tree (TRS-07) | high | mitigate | Boundary test scans src/views/** for the config-root folder literal + direct fs/path/os/child_process imports. Any addition fails the build. This is the executable enforcement of the design's renderer-isolation rule. |
| T-13-i18n | Tampering (consistency) | Six lang files (I18-01) | low | mitigate | Static test asserts key-set parity across all six files. A developer adding a key to en.ts without updating zh/es/fr/de/ja fails the build. |
| T-13-SC | Tampering | Package installs | n/a | accept | Zero new packages. |
</threat_model>

<verification>
- yarn testmain -- rendererNoFsAccessToAifetchly exits 0 (TRS-07)
- yarn testmain -- i18nKeysPresent exits 0 (I18-01)
- yarn testmain (full suite + typecheck gate) exits 0 — the phase-13 gate before /gsd-verify-work
- yarn vue-check exits 0 (all six lang files type-check)
- Manual locale QA: switch the app language to each of the six; verify aifetchlyConfig/slashCommands strings read correctly (design §22 item: visual locale QA)
</verification>

<success_criteria>
- All six language files have the aifetchlyConfig + slashCommands groups with identical key sets and accurate translations.
- TRS-07 is locked in as a boundary test — future phases cannot regress renderer isolation without failing the build.
- I18-01 is locked in as a static test — future phases cannot add a key to one language and miss the others.
- The full phase 13 vitest suite is green and the typecheck gate passes.
</success_criteria>

<output>
Create `.planning/phases/13-global-context-and-built-in-slash-commands/13-05-SUMMARY.md` when done.

## Artifacts this phase produces (Plan 05 contribution)

**i18n groups (added to src/views/lang/{en,zh,es,fr,de,ja}.ts):**
- aifetchlyConfig group (16 keys: title, reload, reloadStarted, reloadResult, reloadFailed, status, statusResult, statusEmpty, watcherNotStarted, diagnosticWarning/Error/Info, workspaceTrustTitle/Body, commandDisabledUntrusted)
- slashCommands group (16 keys: help, clear, reloadConfig, status, helpResultTitle, noMatches, unknownCommand, notDispatchable, notACommand, disabledCommand, sourceBuiltin/User/Workspace/Plugin, argumentHint, argumentHintNone)

**Tests (test/vitest/main/):**
- rendererNoFsAccessToAifetchly.test.ts (TRS-07 boundary — scans src/views/** for forbidden tokens + imports)
- i18nKeysPresent.test.ts (I18-01 static — asserts both groups + key parity across all six lang files)
</output>
