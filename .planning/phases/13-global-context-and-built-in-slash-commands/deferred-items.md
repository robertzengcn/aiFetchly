# Phase 13 — Deferred Items (out-of-scope discoveries)

Pre-existing failures logged per the GSD SCOPE BOUNDARY rule. Do NOT fix
in phase 13; surface for the user / a future cleanup phase.

## Pre-existing vitest failures (DB-backed + unrelated suites)

Discovered while running the full vitest suite after Plan 13-03b Task 2.
**68 tests fail across 16 files** — ALL unrelated to phase 13 work.

Verified pre-existing by spot-checking `task-ipc.test.ts` on the baseline
(stashing Plan 03b's changes leaves the same 17 failures). The DB-backed
failures share the `ERR_DLOPEN_FAILED` pattern from `better-sqlite3` that
Plan 13-03a's SUMMARY already documented.

### Failing files (representative — full list in vitest output)

- `test/vitest/main/ipc/task-ipc.test.ts` (17 failures)
- `test/vitest/main/FileToolPermission.test.ts` (4 failures)
- `test/vitest/main/modules/AIChatCompactModule.test.ts` (2 failures)
- `test/vitest/main/modules/AIChatCompactSummaryModel.test.ts` (3 failures)
- `test/vitest/main/modules/AIChatSessionMemoryModel.test.ts` (4 failures)
- `test/vitest/main/modules/AIChatSessionMemoryModule.test.ts` (3 failures)
- `test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts` (4 failures)
- `test/vitest/main/modules/AIUserMemoryModel.test.ts` (6 failures)
- `test/vitest/main/modules/AIUserMemoryModule.test.ts` (7 failures)
- `test/vitest/main/modules/platforms/USonarYellowPageAdapter.test.ts` (3 failures)
- `test/vitest/main/plugin-ipc.test.ts` (1 failure)
- `test/vitest/main/service/ErrorClassification.test.ts` (5 failures)
- `test/vitest/main/service/RateLimiter.test.ts` (2 failures)
- `test/vitest/main/service/ValidationUtils.test.ts` (1 failure)
- `test/vitest/main/workspace.model.test.ts` (4 failures)
- `test/vitest/main/workspace.model.test.ts` (2 failures in counts above)

### Phase 13 tests that DO pass (no regressions)

- `test/vitest/main/service/CommandRegistry.test.ts` (33/33)
- `test/vitest/main/service/SlashCommandParser.test.ts` (19/19)
- `test/vitest/main/service/SlashCommandDispatcher.test.ts` (22/22)
- `test/vitest/main/service/AIFetchlyContextLoader.test.ts` (32/32)
- `test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts` (6/6)
- `test/vitest/main/ipc/slash-command-ipc.test.ts` (11/11)

### Recommended follow-up

A separate cleanup phase should triage these. They are NOT blockers for
phase 13 hand-off (Plan 13-04 only consumes the slash-command + config
IPC channels, which are green).
