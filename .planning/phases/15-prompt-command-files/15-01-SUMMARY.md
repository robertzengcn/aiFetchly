---
phase: 15-prompt-command-files
plan: 15-01-expansion-validator-dispatcher
subsystem: slash-commands
tags: [typescript, slash-commands, prompt-commands, pure-functions, tdd, cmd-06]

requires: []
provides:
  - expandPrompt(body, args) — pure, zero-import argument-token substitution (D-01 all-occurrences + D-02 append-when-absent). Consumed by SlashCommandDispatcher.
  - buildPromptCommandDefinition(draft, sourceMeta) — pure CMD-06 frontmatter validator/builder returning {ok, definition | diagnostic}. Consumed by Plan 15-02 global loader and workspace conversion.
  - CMD-06 frontmatter constants in AIFetchlyConfigConstants (commandDescriptionLength=500, commandAliases=10, commandArgumentHintLength=100) + COMMAND_NAME_PATTERN string and COMMAND_NAME_REGEX compiled.
  - SlashCommandDispatcher case "prompt" branch — now returns submit_prompt with expandPrompt(body, args).
affects: [15-02-global-workspace-command-loaders]

tech-stack:
  added: []
  patterns:
    - Pure leaf module (expandPrompt.ts) — zero imports, no fs/Electron/TypeORM/Vue/service; mirrors Phase 13-02 "parser is pure" boundary.
    - Discriminated-union validator result {ok: true; definition} | {ok: false; diagnostic} — single owner of the CMD-06 schema reused by global + workspace paths in Plan 02.
    - Literal split-and-join replace-all for the argument token — avoids dollar-sign regex-meta escaping pitfalls, robust to mid-word and multiple occurrences (T-15-03 mitigation).
    - Defensive copies (Array.from) on every returned SlashCommandDefinition field; mutating the input draft or returned definition after the call is a no-op.

key-files:
  created:
    - src/service/slashCommands/expandPrompt.ts
    - src/service/slashCommands/promptCommandFrontmatter.ts
    - test/vitest/main/service/expandPrompt.test.ts
    - test/vitest/main/service/promptCommandFrontmatter.test.ts
  modified:
    - src/service/slashCommands/SlashCommandDispatcher.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
    - test/vitest/main/service/SlashCommandDispatcher.test.ts

key-decisions:
  - "expandPrompt uses literal split(token).join(args) replace-all instead of a regex — sidesteps dollar-sign metacharacter escaping entirely and is robust to the token appearing mid-word, multiple times, or adjacent to itself. Verified by the mid-word + empty-args behavior cases."
  - "expandPrompt is a TRUE pure leaf: ZERO imports (verified grep -c '^import' = 0). It accepts (body: string, args: string) with explicit return type, performs runtime type guards on the inputs (defensive against adversarial callers passing undefined through loosened types), and never throws — every branch returns a string."
  - "D-02 fail-safe append fires ONLY when the body contains no token AND args are non-empty. When the token IS present, args are substituted only at the token positions — they are NOT also appended at the end (explicit test guards against the double-insertion bug)."
  - "buildPromptCommandDefinition is the SINGLE owner of the CMD-06 schema. The validation order is fixed (name -> description presence -> description length -> argumentHint length -> aliases count+pattern -> type === 'prompt' -> body non-empty) and the FIRST violation wins. Plan 15-02 routes both the global and workspace drafts through this function so there is no duplicate schema logic."
  - "The id format ${sourceMeta.sourceId}:command:${name} is stable per source+name, mirroring the existing workspace id convention workspace:<id>:command:<name> and the user-owned user:command:<name>."
  - "The dispatcher's case 'prompt' branch now returns {status:true, action:'submit_prompt', prompt, commandId}. cmd.body is defensively coerced to '' via cmd.body ?? '' — the validator rejects empty bodies, but a defensively-registered prompt command must not crash the dispatch path with a TypeError."
  - "Phase-15 boundary marker in the dispatcher is CROSSED for the dispatcher ONLY; SlashCommandParser.ts still has ZERO occurrences of the argument-token literal (region-scoped invariant preserved — verified by grep). The Phase-13 boundary comment was updated to reflect this."

patterns-established:
  - "Pattern: pure-leaf functions with zero imports + runtime type guards (typeof checks) — defensive against adversarial callers passing loosened types through unknown casts, while still never throwing."
  - "Pattern: discriminated-union validator result {ok: true; definition} | {ok: false; diagnostic} reusing the project's existing diagnostic shape (severity=warning, recoverable=true, code from AIFETCHLY_DIAGNOSTIC_CODES)."

requirements-completed: [CMD-06]

coverage:
  - id: D1
    description: "expandPrompt substitutes EVERY occurrence of the argument token (D-01 all-occurrences); robust to mid-word placement and multiple occurrences."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "test/vitest/main/service/expandPrompt.test.ts#expandPrompt (CMD-06 / Phase 15 — D-01 + D-02) (7 it.each cases incl. mid-word + multiple-occurrence)"
        status: pass
    human_judgment: false
  - id: D2
    description: "expandPrompt appends args after a blank line when the body has no token AND args are non-empty (D-02 fail-safe); does NOT double-append when the token IS present."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "test/vitest/main/service/expandPrompt.test.ts#D-02 does NOT append when the token is present (substitution only)"
        status: pass
    human_judgment: false
  - id: D3
    description: "expandPrompt is a pure leaf module — ZERO imports (no fs/Electron/TypeORM/Vue/service); never throws."
    requirement: TRS-06
    verification:
      - kind: unit
        ref: "grep -c '^import' src/service/slashCommands/expandPrompt.ts == 0; grep -E fs|electron|typeorm|getRepository == CLEAN"
        status: pass
    human_judgment: false
  - id: D4
    description: "buildPromptCommandDefinition encodes the full CMD-06 schema once — name pattern, description cap (500), aliases cap (10), argumentHint cap (100), type===prompt, non-empty body; first violation wins."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "test/vitest/main/service/promptCommandFrontmatter.test.ts#buildPromptCommandDefinition — invalid CMD-06 drafts (9+ cases covering each constraint)"
        status: pass
    human_judgment: false
  - id: D5
    description: "buildPromptCommandDefinition returns defensive copies — mutating the input draft or returned definition after the call does not affect the snapshot; never throws on malformed drafts."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "test/vitest/main/service/promptCommandFrontmatter.test.ts#buildPromptCommandDefinition — invariants (4 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The dispatcher's prompt branch calls expandPrompt(cmd.body ?? '', parsed.args ?? '') and returns {status:true, action:'submit_prompt', prompt, commandId} — the Phase-13 submit_prompt contract (SC2)."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "test/vitest/main/service/SlashCommandDispatcher.test.ts#SlashCommandDispatcher prompt commands (Phase 15 / SC2) (5 cases incl. token-subst, D-02 append, no-args, defensive undefined body)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The dispatcher continues to perform NO dynamic code execution; expansion is string-only. SlashCommandParser.ts and CommandRegistry.ts UNCHANGED (no expansion logic leaked — region-scoped invariant)."
    requirement: TRS-06
    verification:
      - kind: unit
        ref: "git diff 426835d9..HEAD -- src/service/slashCommands/{CommandRegistry,SlashCommandParser}.ts == empty; grep -E 'new Function|[^_]eval\\(' SlashCommandDispatcher.ts == CLEAN"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-07
status: complete
---

# Phase 15 Plan 01: Expansion + Validator + Dispatcher Summary

**Wave-1 pure-logic core of CMD-06 — argument-token expander, CMD-06 frontmatter validator/builder, and dispatcher wiring that flips the prompt branch from not-yet-supported to live submit_prompt**

## Performance

- **Tasks:** 3 (all TDD: RED -> GREEN)
- **Files created:** 4 (2 source + 2 test)
- **Files modified:** 3 (dispatcher, constants, dispatcher test)
- **Tests:** 60 passing (9 expandPrompt + 25 promptCommandFrontmatter + 26 SlashCommandDispatcher)

## Accomplishments

- expandPrompt(body, args) is a pure, zero-import leaf function implementing D-01 (literal split-and-join replace-all of EVERY argument-token occurrence — robust to mid-word and multiple occurrences) and D-02 (append args after a blank line when the body has no token AND args are non-empty — fail-safe so author-omitted tokens don't drop the user's input). Never throws; total over (string, string) inputs.
- buildPromptCommandDefinition(draft, sourceMeta) is the SINGLE owner of the CMD-06 schema. Returns {ok: true; definition: SlashCommandDefinition} on success or {ok: false; diagnostic: AIFetchlyConfigDiagnostic} on the FIRST violation. Validates name pattern (^[a-z][a-z0-9_-]*$), description presence + length (<=500), argumentHint length (<=100), aliases count (<=10) + per-element pattern, type === "prompt" (required), and body non-empty after trim. Never throws — non-string scalar values, wrong-shape aliases, and other malformed inputs all return {ok: false, diagnostic}. Plan 15-02 will route both the global loader and the workspace conversion path through this function so the schema is encoded exactly once.
- AIFetchlyConfigConstants.AIFETCHLY_CONFIG_LIMITS now exposes commandDescriptionLength=500, commandAliases=10, commandArgumentHintLength=100. The file also exports COMMAND_NAME_PATTERN (the string ^[a-z][a-z0-9_-]*$) and COMMAND_NAME_REGEX (the compiled RegExp) so callers can .test() and embed the literal in error messages without re-compiling.
- SlashCommandDispatcher case "prompt" branch now calls expandPrompt(cmd.body ?? "", parsed.args ?? "") and returns {status: true, action: "submit_prompt", prompt: <rendered>, commandId: cmd.id} — the Phase-13 submit_prompt contract (SC2 at the unit level). The Phase-13 "not yet supported" placeholder is GONE; the Phase-15 boundary comment was updated to reflect that the dispatcher now legitimately crosses it. cmd.body is defensively coerced to "" (the validator rejects empty bodies, but a defensive fallback prevents runtime TypeError).
- TRS-06 invariant preserved: the dispatcher imports NO process-spawning module, calls NO eval-like or new Function() constructors (negative grep clean). The parser (SlashCommandParser.ts) and registry (CommandRegistry.ts) are UNCHANGED — no expansion logic leaked into them (region-scoped invariant verified by git diff).
- Phase-13 boundary marker updated in source: the dispatcher header comment now says "argument-token substitution NOW lives in the DISPATCHER for prompt-type commands (Plan 15-01, SC2)" and explicitly notes the parser stays pure.

## Task Commits

1. **Task 1 — expandPrompt (D-01 + D-02, pure leaf)**
   - ee19e054 (RED) — failing 9-case test covering all 7 behavior cases + purity + no-double-append invariants
   - 6e69f248 (GREEN) — expandPrompt.ts with literal split-and-join; ZERO imports; 9/9 tests pass
2. **Task 2 — buildPromptCommandDefinition + CMD-06 constants (SC4)**
   - ca7253b6 (RED) — failing 25-case test covering constants sanity + 4 valid + 9 invalid + 4 invariants
   - aee96429 (GREEN) — promptCommandFrontmatter.ts + constants additions; 25/25 tests pass; tsc clean
3. **Task 3 — dispatcher wiring (SC2)**
   - aa3fd6b0 (RED) — failing 5-case describe block + superseded Phase-13 placeholder test
   - 9d23ee9a (GREEN) — case "prompt" branch flipped to live submit_prompt via expandPrompt; 26/26 dispatcher tests pass

## Decisions Made

- **Replace strategy: literal split-and-join.** Chose body.split(token).join(args) over a regex with the token unescaped. JavaScript's String.prototype.replace with a string pattern replaces only the first occurrence (insufficient for D-01 all-occurrences), and a global regex requires escaping the dollar sign (regex end-of-string meta). Split-and-join is the standard regex-free replace-all and handles the literal token verbatim regardless of meta characters.
- **Runtime type guards on pure function inputs.** Although the public signature is (body: string, args: string): string, expandPrompt performs typeof checks that coerce non-string values to "" rather than throwing. This is defense-in-depth: TypeScript's type system is erased at runtime, and adversarial callers (or future code paths through unknown casts) could pass undefined. The contract is "never throws, always returns a string" — the guards make that provably true.
- **Validation order in buildPromptCommandDefinition.** Fixed order: name -> description presence -> description length -> argumentHint length -> aliases count+pattern -> type -> body. First violation wins. Rationale: structural identity (name) before content checks; the cheapest checks (presence/length) before the more expensive pattern checks; type near the end because it's a categorical check; body last because the body is the largest payload and least likely to be malformed.
- **Stable id format.** ${sourceMeta.sourceId}:command:${name} mirrors the existing convention exactly — user:command:review, workspace:<id>:command:review, plugin:<name>:command:review. Plan 15-02's source loaders will produce the same ids whether they go through this validator or hand-construct definitions.
- **Defensive cmd.body coercion in the dispatcher.** The validator rejects empty bodies, but cmd.body ?? "" is a one-line insurance policy against a future code path that bypasses validation (e.g. a test fixture, a programmatic registration). The cost is one nullish-coalesce; the benefit is no TypeError: Cannot read properties of undefined in production dispatch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug] Defensive-copy test violated the readonly contract on PromptCommandDraft.body**
- **Found during:** Task 2 GREEN phase (tsc gate)
- **Issue:** The defensive-copy test mutated d.body = "TAMPERED" after calling buildPromptCommandDefinition. The draft type declares readonly body: string, so TypeScript correctly rejected the assignment (TS2540: Cannot assign to 'body' because it is a read-only property). The test passed under vitest's esbuild transpile-only mode but failed the project's tsc --noEmit gate that runs as a vitest globalSetup.
- **Fix:** Cast through (d as { body: string }).body = "TAMPERED" — explicitly sidesteps the readonly contract. This is legitimate for a test that verifies the immutability defense against an adversarial caller who DOES mutate the input. Documented inline with a comment explaining why the cast is intentional.
- **Files modified:** test/vitest/main/service/promptCommandFrontmatter.test.ts
- **Verification:** tsc clean; 25/25 tests still pass; defensive-copy invariant still asserted.
- **Committed in:** aee96429

**Total deviations:** 1 auto-fixed (test-only bug; no impact on production code or public API).
**Impact on plan:** Minimal — implementation conforms to the locked design; the deviation changed only the test's casting strategy, not its semantic assertion.

## Issues Encountered

None — clean execution. All three tasks went RED -> GREEN on the first implementation pass after the single test-cast auto-fix in Task 2.

## User Setup Required

None — pure-logic plan with no external configuration, IPC channels, DB schema, packages, or runtime dependencies.

## Next Phase Readiness

- **Plan 15-02 (Wave 2)** depends on this plan's output. It will:
  - Call buildPromptCommandDefinition(draft, sourceMeta) from the global loader (reading ~/.aifetchly/commands/*.md) AND from the workspace conversion path (Phase 14 WorkspaceCommandDraft[] -> SlashCommandDefinition[]). The validator's signature is stable and exported.
  - Route trusted workspace command entries through CommandRegistry.replaceSource("workspace:<id>", entries) exactly as Phase 13 did for global commands.
  - Surface argumentHint in the renderer dropdown (AiChatV2SlashSuggestions) — the validator already carries argumentHint through to the definition; the existing SlashCommandView projection (Phase 13-02 listViews) already exposes it.
- The dispatcher's case "prompt" branch is LIVE — any prompt-type command registered in the registry will dispatch through expandPrompt and return submit_prompt. Plan 15-02 attaches real file sources to populate that registry.
- No new IPC channels, no DB changes, no new packages. Phase-13 contracts preserved; TRS-05 Strategy A unchanged (the dispatcher returns a prompt; the existing AI_CHAT_V2_STREAM IPC gates USER_AI_ENABLED before the model sees it).

## TDD Gate Compliance

All three tasks followed the mandatory RED -> GREEN cycle. Verified in git log:

| Task | RED commit | GREEN commit | Status |
|------|-----------|-------------|--------|
| 1 — expandPrompt | ee19e054 (test) | 6e69f248 (feat) | OK |
| 2 — validator + constants | ca7253b6 (test) | aee96429 (feat) | OK |
| 3 — dispatcher wiring | aa3fd6b0 (test) | 9d23ee9a (feat) | OK |

No REFACTOR commits — both pure functions and the dispatcher branch were clean on first GREEN; no behavior-preserving cleanup was warranted.

## Self-Check: PASSED

**File existence (7/7 FOUND):**
- src/service/slashCommands/expandPrompt.ts
- src/service/slashCommands/promptCommandFrontmatter.ts
- src/service/slashCommands/SlashCommandDispatcher.ts (modified)
- src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts (modified)
- test/vitest/main/service/expandPrompt.test.ts
- test/vitest/main/service/promptCommandFrontmatter.test.ts
- test/vitest/main/service/SlashCommandDispatcher.test.ts (extended)

**Commit existence (6/6 FOUND):**
- ee19e054 — test(15-01): add failing expandPrompt argument-token tests
- 6e69f248 — feat(15-01): implement expandPrompt argument-token expander
- ca7253b6 — test(15-01): add failing buildPromptCommandDefinition tests
- aee96429 — feat(15-01): implement buildPromptCommandDefinition + CMD-06 constants
- aa3fd6b0 — test(15-01): add failing submit_prompt tests for dispatcher prompt branch
- 9d23ee9a — feat(15-01): wire expandPrompt into dispatcher prompt branch (SC2)

**Final verification:**
- AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs expandPrompt promptCommandFrontmatter SlashCommandDispatcher -> 60/60 pass
- npx tsc --noEmit -> 0 errors
- grep -c '^import' src/service/slashCommands/expandPrompt.ts -> 0 (pure leaf)
- git diff 426835d9..HEAD -- src/service/slashCommands/{CommandRegistry,SlashCommandParser}.ts -> empty (no expansion leaked)

---
*Phase: 15-prompt-command-files*
*Completed: 2026-07-07*
