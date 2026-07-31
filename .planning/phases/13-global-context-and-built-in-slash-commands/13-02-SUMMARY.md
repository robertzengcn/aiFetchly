---
phase: 13-global-context-and-built-in-slash-commands
plan: 13-02-command-registry-parser
subsystem: slash-commands
tags: [typescript, slash-commands, registry, parser, immutability, tdd]

requires: []
provides:
  - CommandRegistry — class with register/unregister/replaceSource/getByName/getById/list/listViews + rankSuggestions helper (CMD-01, CMD-07)
  - parseSlashCommandInput — pure input classifier for composer text (CMD-02)
  - slashCommandTypes — SlashCommandDefinition, SlashCommandView (renderer-safe), SlashCommandSource, SlashCommandType, ParsedSlashCommandInput, BUILTIN_SOURCE, USER_SOURCE
affects: [13-03a-context-pipeline, 13-03b-commands-dispatcher-ipc, 13-05-i18n-boundary-tests]

tech-stack:
  added: []
  patterns:
    - Registry with defensive copies + atomic source replacement (mirrors AgentDefinitionRegistry, adds replaceSource per design §7.3)
    - Pure table-driven input classifier (no registry/IPC dependency — dispatcher composes the two in Plan 03)
    - SOURCE_RANK map enforcing deterministic lookup order built-in > workspace > user > plugin
    - Stable sort with score-bucket ranking (exact name > exact alias > prefix name > prefix alias > substring desc)

key-files:
  created:
    - src/entityTypes/slashCommandTypes.ts
    - src/service/slashCommands/CommandRegistry.ts
    - src/service/slashCommands/SlashCommandParser.ts
    - test/vitest/main/service/CommandRegistry.test.ts
    - test/vitest/main/service/SlashCommandParser.test.ts
  modified: []

key-decisions:
  - "Lookup order enforced via a SOURCE_RANK record (built-in=0 < workspace=1 < user=2 < plugin=3); rebuildNameIndex re-applies it on every mutation so built-ins can never be shadowed (CMD-01)."
  - "Tie-break is first-registered, achieved by relying on Map insertion-order iteration and only replacing the current winner on strictly-lower rank (no separate counter needed)."
  - "replaceSource stores defensive copies AND stamps the sourceId arg as the index key, so unregister() and future re-registrations stay consistent even if a caller passes mismatched sourceId fields."
  - "listViews strips both `body` and arbitrary `metadata` from the renderer projection (T-13-Leak mitigation, design §5.5/§14.2). The test asserts `'body' in view === false`."
  - "Parser is permissive on invalid name patterns: invalid tokens still return isCommand:true with the raw name so the dispatcher produces the not-found message (CMD-08). Keeps parser's contract narrow."
  - "rankSuggestions exposed as a standalone exported function (not a static method) so it can be unit-tested in isolation and reused by Plan 03's IPC layer without a registry instance."
  - "Phase-15 boundary (TRS-06/CMD-06) marked in the parser source via a 'Phase-15 boundary' comment; the literal argument-token syntax does NOT appear anywhere under src/service/slashCommands/ (verified by grep)."

patterns-established:
  - "Pattern: every registry mutator ends with rebuildNameIndex() — name lookups are always consistent with the lookup order, no stale entries survive."
  - "Pattern: pure classifier functions import only the shared type, never the registry — keeps the parser testable in isolation and reusable across dispatcher implementations."

requirements-completed: [CMD-01, CMD-02, CMD-07]

coverage:
  - id: D1
    description: "Registry enforces built-in > workspace > user > plugin lookup order across all source combinations"
    requirement: CMD-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/CommandRegistry.test.ts#CommandRegistry lookup order (CMD-01) (5 it.each cases + 3 supplementary)"
        status: pass
    human_judgment: false
  - id: D2
    description: "replaceSource atomically reconciles delete/rename/missed-events and rebuilds the name index; stale entries never survive"
    requirement: CMD-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/CommandRegistry.test.ts#replaceSource atomic reconciliation (CMD-01) (6 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "register/list/getByName/getById return defensive copies (input mutation and output mutation are no-ops on registry state)"
    requirement: CMD-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/CommandRegistry.test.ts#CommandRegistry defensive copies (4 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Parser classifies all five CMD-02 input shapes: /review src=cmd, ' /review'=cmd after trim, //review!=, bare '/'=suggest-only, /unknown parses"
    requirement: CMD-02
    verification:
      - kind: unit
        ref: "test/vitest/main/service/SlashCommandParser.test.ts#parseSlashCommandInput (CMD-02) (16 it.each cases + 3 supplementary)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Parser is pure — no registry/IPC/Electron/Module imports; only the shared ParsedSlashCommandInput type"
    requirement: CMD-02
    verification:
      - kind: unit
        ref: "grep -E \"CommandRegistry|registry\" src/service/slashCommands/SlashCommandParser.ts exits 1 (no matches)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Ranking deterministic: exact name > exact alias > prefix name > prefix alias > substring in description; stable on ties"
    requirement: CMD-07
    verification:
      - kind: unit
        ref: "test/vitest/main/service/CommandRegistry.test.ts#rankSuggestions (CMD-07) (8 cases incl. case-insensitivity + stability)"
        status: pass
    human_judgment: false
  - id: D7
    description: "listViews omits body and arbitrary metadata (T-13-Leak mitigation, design §5.5/§14.2)"
    requirement: CMD-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/CommandRegistry.test.ts#listViews() (T-13-Leak mitigation) (4 cases)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Phase-15 boundary marked in parser; no argument-token literal anywhere under src/service/slashCommands/ (TRS-06/CMD-06)"
    requirement: TRS-06
    verification:
      - kind: unit
        ref: "grep -rn '\\$ARGUMENTS' src/service/slashCommands/ exits 1 (no matches); 'Phase-15 boundary' comment present in SlashCommandParser.ts"
        status: pass
    human_judgment: false

duration: ~12min
completed: 2026-07-05
status: complete
---

# Plan 13-02: Command Registry + Parser Summary

**Pure-logic foundation for slash commands — registry with atomic source replacement and deterministic lookup order, plus the pure input classifier that the Plan 03 dispatcher composes with**

## Performance

- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files created:** 5 (3 source + 2 test)
- **Tests:** 52 passing (33 CommandRegistry + 19 SlashCommandParser)

## Accomplishments

- `CommandRegistry` enforces CMD-01 lookup order (built-in > workspace > user > plugin) via a SOURCE_RANK map applied in `rebuildNameIndex()` on every mutation. Built-ins cannot be shadowed.
- `replaceSource(sourceId, commands)` atomically reconciles add/change/delete/rename so stale entries never survive (design §7.3, §10.1) — handles missed-events by always working from a fresh full list.
- All public accessors return defensive copies (CLAUDE.md immutability rule). Mutating inputs after registration or outputs after retrieval is a no-op.
- `listViews()` produces a renderer-safe `SlashCommandView` projection that strips both `body` and arbitrary `metadata` (T-13-Leak mitigation, design §5.5/§14.2).
- `rankSuggestions(query, commands)` implements CMD-07 ranking as a standalone pure function with a stable sort: exact name > exact alias > prefix name > prefix alias > substring in description.
- `parseSlashCommandInput(raw)` is a pure function implementing all five CMD-02 rules: left-trim, `//`-escape guard, suggest-only on bare `/`, first-whitespace-run name/args split (preserving internal whitespace), and permissive handling of invalid names (dispatcher returns not-found, CMD-08).
- Phase-15 boundary (TRS-06/CMD-06) marked in the parser source; the literal argument-token syntax does NOT appear anywhere under `src/service/slashCommands/` (verified by grep).

## Task Commits

1. **Task 1 — Types + CommandRegistry (CMD-01, CMD-07)**
   - `583f45b7` (RED) — failing table-driven tests for lookup order, replaceSource, defensive copies, listViews, and rankSuggestions
   - `54a57ab8` (GREEN) — `slashCommandTypes.ts` + `CommandRegistry.ts` (33/33 tests pass)
2. **Task 2 — SlashCommandParser (CMD-02)**
   - `a16d5dba` (RED) — failing table-driven tests for all five parser rules + edge cases
   - `9be9018d` (GREEN) — `SlashCommandParser.ts` (19/19 tests pass)

## Decisions Made

- Lookup order is enforced via a `SOURCE_RANK` record (built-in=0 < workspace=1 < user=2 < plugin=3) applied in `rebuildNameIndex()`; ties are broken by first-registered, achieved by relying on Map insertion-order iteration and only replacing the current winner on strictly-lower rank. No separate insertion counter is needed for the registry's currently-tested behaviors.
- `replaceSource` indexes by the **sourceId argument** (not by stamping sourceId back onto each command). Stored entries retain whatever sourceId the caller passed in their definition; the index trusts the explicit argument. This avoids silent data drift if a future caller passes mismatched sourceId fields.
- `rankSuggestions` is a standalone exported function (not a static method on the registry). This makes it trivially unit-testable and lets Plan 03's IPC layer reuse it without instantiating a registry.
- Parser is permissive on invalid name patterns — returns `isCommand:true` with the raw name token so the dispatcher can produce the correct "Unknown slash command" message (CMD-08). Keeps the parser's contract narrow (classification only, no validation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two CMD-07 test fixtures had unintended exact-name matches**
- **Found during:** Task 1 GREEN phase
- **Issue:** The "ranks prefix name higher than prefix alias" fixture used query "alpha" against a command literally named "alpha" — that triggered an exact-name match (score 100) instead of the intended prefix-alias comparison. The "ranks substring description above non-matches" fixture used a `view()` helper that ignored `extras.description`, so the override never reached the command and both candidates scored 0.
- **Fix:** Reworded the prefix-name fixture to query "alph" (a prefix of "alphabet" name and "alphax" alias, but not an exact match for either); fixed the `view()` helper to spread `extras` last so any base field can be overridden.
- **Files modified:** `test/vitest/main/service/CommandRegistry.test.ts`
- **Verification:** All 33 tests pass; the remaining 8 rankSuggestions cases already covered the intended ranking order.
- **Committed in:** `54a57ab8`

**2. [Rule 3 - Blocking] Parser comments leaked forbidden literals**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The plan forbids the literal argument-token syntax anywhere under `src/service/slashCommands/` (TRS-06 verification via grep) and requires `! grep -E "CommandRegistry|registry" SlashCommandParser.ts` to exit 0. My initial parser-header comment mentioned the registry by name and used the literal argument-token syntax in the phase-15 boundary marker.
- **Fix:** Reworded the parser comments to say "command store" instead of "registry" and "argument-token substitution" instead of the literal. The phase-15 boundary marker is still clear and the comment intent is preserved.
- **Files modified:** `src/service/slashCommands/SlashCommandParser.ts`
- **Verification:** All acceptance-criteria greps now exit clean (no forbidden literal or word anywhere under `src/service/slashCommands/`).
- **Committed in:** `9be9018d`

**Total deviations:** 2 auto-fixed (1 test-fixture bug, 1 acceptance-criteria comment wording)
**Impact on plan:** Minimal — implementation conforms to the locked design; neither deviation changed public API or behavior.

## Issues Encountered

None — clean execution. Both tasks went RED → GREEN on the first implementation pass after the two auto-fixes above.

## User Setup Required

None — pure-logic plan with no external service configuration.

## Next Phase Readiness

- `CommandRegistry` and `parseSlashCommandInput` are ready for Plan 13-03b (dispatcher + IPC layer). The dispatcher will compose the parser (to classify input) with the registry (to resolve names) and produce the `SlashCommandDispatchResponse` discriminated union.
- Built-in commands (`/help`, `/clear`, `/status`, `/reload-config`) register via `registry.register(cmd)` at startup — Plan 13-03b's `builtinSlashCommands.ts` will provide the `registerBuiltInSlashCommands(registry)` helper.
- `listViews()` is ready to feed the renderer suggestions dropdown (Plan 13-04 UI).
- Phase-15 boundary (TRS-06/CMD-06) clearly marked: argument-token substitution will land in the dispatcher, NOT in the parser. Phase 13 built-ins take no arguments.

## Self-Check: PASSED

**File existence (5/5 FOUND):**
- `src/entityTypes/slashCommandTypes.ts`
- `src/service/slashCommands/CommandRegistry.ts`
- `src/service/slashCommands/SlashCommandParser.ts`
- `test/vitest/main/service/CommandRegistry.test.ts`
- `test/vitest/main/service/SlashCommandParser.test.ts`

**Commit existence (4/4 FOUND):**
- `583f45b7` — test(13-02): add failing CommandRegistry tests
- `54a57ab8` — feat(13-02): implement CommandRegistry with lookup order + replaceSource
- `a16d5dba` — test(13-02): add failing SlashCommandParser tests
- `9be9018d` — feat(13-02): implement pure SlashCommandParser (CMD-02)

**Final verification:**
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs CommandRegistry SlashCommandParser` → 52/52 pass
- `npx tsc --noEmit` → 0 errors

---
*Phase: 13-global-context-and-built-in-slash-commands*
*Completed: 2026-07-05*
