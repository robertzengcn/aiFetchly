---
phase: 15-prompt-command-files
plan: 01
name: expansion-validator-dispatcher
type: execute
wave: 1
depends_on: []
files_modified:
  - src/service/slashCommands/expandPrompt.ts
  - src/service/slashCommands/promptCommandFrontmatter.ts
  - src/service/slashCommands/SlashCommandDispatcher.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
  - test/vitest/main/service/expandPrompt.test.ts
  - test/vitest/main/service/promptCommandFrontmatter.test.ts
  - test/vitest/main/service/SlashCommandDispatcher.test.ts
requirements: [CMD-06]
autonomous: true
user_setup: []

must_haves:
  truths:
    - "expandPrompt substitutes EVERY occurrence of the argument token in the body with the full args string the user typed after the command name (D-01 minimal whole-string substitution)."
    - "expandPrompt appends the raw args after the body separated by a blank line when the body contains NO argument token AND args are non-empty (D-02 fail-safe append)."
    - "expandPrompt returns the body unchanged when the body has no argument token AND args are empty."
    - "expandPrompt is a pure function: no Electron/TypeORM/Vue/fs imports, no side effects, and no dynamic code execution primitives (TRS-06 invariant)."
    - "The frontmatter validator accepts a command draft whose name matches the CMD-06 name pattern, description is present and within the cap, alias count is within the cap and each alias matches the name pattern, argumentHint is within its cap, type is prompt, and body is non-empty — producing a SlashCommandDefinition with type 'prompt'."
    - "The frontmatter validator REJECTS (returning a diagnostic + no definition) any draft that violates a CMD-06 constraint: name not matching the pattern, missing description, description over the cap, argumentHint over the cap, more than the cap of aliases, any alias not matching the pattern, type other than prompt, or empty body (SC4)."
    - "The dispatcher's prompt branch calls expandPrompt(cmd.body, parsed.args ?? '') and returns {status:true, action:'submit_prompt', prompt:<rendered>, commandId:<id>} — the Phase-13 submit_prompt contract (SC2)."
    - "The dispatcher continues to perform NO dynamic code execution; expansion is string-only."
  prohibitions:
    - "expandPrompt MUST NOT support positional tokens, context tokens, or escaping (D-01 locked minimal). The literal tokens for those are out of scope."
    - "The validator MUST NOT accept the empty body as a prompt command (CMD-06 non-empty body)."
    - "No new IPC channels, no new preload whitelist entries, no DB/entity changes (Phase 13 IPC reused; no schema push)."
  artifacts:
    - "src/service/slashCommands/expandPrompt.ts — exported expandPrompt(body: string, args: string): string"
    - "src/service/slashCommands/promptCommandFrontmatter.ts — exported buildPromptCommandDefinition(draft, sourceMeta): { ok: true; definition } | { ok: false; diagnostic }"
    - "CMD-06 frontmatter limit constants added to AIFetchlyConfigConstants.AIFETCHLY_CONFIG_LIMITS (commandDescription / commandAliases / commandArgumentHint caps) plus an exported compiled name-pattern."
  key_links:
    - "SlashCommandDispatcher case 'prompt' -> expandPrompt(cmd.body, parsed.args ?? '') -> submit_prompt response (wiring in Task 3)."
    - "buildPromptCommandDefinition reused by BOTH the global loader and the workspace path in Plan 02 — single owner of the CMD-06 schema (no duplicate validation logic)."
---

<objective>
Plan 01 (Wave 1) delivers the pure-logic core of CMD-06: the argument-token expander (D-01 minimal whole-string substitution of every occurrence + D-02 append-when-absent) and the CMD-06 frontmatter validator/builder. Both are pure functions with zero Electron/TypeORM/Vue/fs dependencies — mirroring Phase 13's "parser is pure" boundary (Plan 13-02). The plan then wires the expander into the SlashCommandDispatcher's `case "prompt":` branch so `/review src/service` returns a `{action: "submit_prompt"}` response carrying the expanded body.

Purpose: Land the two reusable pure functions and the dispatcher wiring BEFORE Plan 02 attaches the global + workspace file sources. This keeps the trusted substitution logic in one testable place and lets Plan 02 focus purely on file I/O, source reconciliation, and the renderer hint. The Phase-13 "Phase-15 boundary (TRS-06/CMD-06)" markers in SlashCommandDispatcher.ts and SlashCommandParser.ts are now crossed intentionally for the DISPATCHER ONLY — the parser stays pure (expansion is downstream, as designed).

Output: expandPrompt.ts, promptCommandFrontmatter.ts, updated SlashCommandDispatcher.ts + AIFetchlyConfigConstants.ts, three unit-test files GREEN; tsc clean.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/15-prompt-command-files/15-CONTEXT.md
@.planning/REQUIREMENTS.md
@docs/prd/aifetchly-local-extensibility-technical-design.md

# Phase-13 surfaces this plan consumes (read the SUMMARYs before editing)
@.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-03b-SUMMARY.md

# Source files being modified — read BEFORE editing
@src/service/slashCommands/SlashCommandDispatcher.ts
@src/entityTypes/slashCommandTypes.ts
@src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
@src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts
@src/service/slashCommands/SlashCommandParser.ts
@src/service/slashCommands/CommandRegistry.ts
</context>

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: expandPrompt — pure argument-token substitution (D-01 + D-02)</name>
  <files>src/service/slashCommands/expandPrompt.ts, test/vitest/main/service/expandPrompt.test.ts</files>
  <read_first>
    - .planning/phases/15-prompt-command-files/15-CONTEXT.md (D-01 minimal whole-string substitution, D-02 append-when-absent — both locked)
    - docs/prd/aifetchly-local-extensibility-technical-design.md §11.3 (submit_prompt shape returned downstream by the dispatcher)
    - src/service/slashCommands/SlashCommandParser.ts (the parser — confirm it produces `args` as the post-name substring; do NOT add expansion here)
    - src/service/slashCommands/SlashCommandDispatcher.ts (the dispatcher branch that will CALL expandPrompt in Task 3 — read to understand the contract, do not edit yet)
  </read_first>
  <behavior>
    - Single-occurrence: body "Review $ARGUMENTS please" + args "src/service" -> "Review src/service please".
    - Multiple-occurrence (D-01 ALL occurrences): body "Review $ARGUMENTS and again $ARGUMENTS" + args "x" -> both tokens become "x".
    - Token-absent + non-empty args (D-02 append): body "Review this" + args "src/a" -> "Review this\n\nsrc/a" (body, blank line, args).
    - Token-absent + empty args: body "Review this" + args "" -> "Review this" (unchanged).
    - Token-present + empty args: body "Review $ARGUMENTS now" + args "" -> "Review  now" (token replaced with empty string; NO append).
    - Token mid-word: body "pre$ARGUMENTS post" + args "X" -> "preX post" (robust to token appearing inside a line, not only standalone).
    - Empty body + empty args: "" + "" -> "" (returns empty string; the validator in Task 2 rejects empty bodies so this never reaches dispatch, but expandPrompt itself must not throw).
  </behavior>
  <action>
    Create `src/service/slashCommands/expandPrompt.ts` exporting a pure function with the signature `expandPrompt(body: string, args: string): string`. Implementation: detect whether the body contains the argument token (the exact literal the user locked in D-01, uppercase with a dollar-sign prefix). If present, replace EVERY occurrence with `args` using a literal replace-all that is robust to the token appearing mid-word (a global string split-and-join or `String.prototype.split(token).join(args)` is preferred over a regex — avoids `$`-meta escaping pitfalls; do NOT use a regex with `$` unescaped). If the body contains NO token AND `args` is non-empty, return `body + "\n\n" + args`. If no token AND `args` is empty, return `body` unchanged. If no token AND `args` is empty AND body is empty, return "". NEVER throw — all branches return a string. The function MUST NOT import anything (pure leaf module — no fs, no Electron, no TypeORM, no other service imports; only the function + its types). Add a concise JSDoc citing D-01 and D-02. The argument-token literal MUST appear in this file (it is the feature, not a forbidden literal here). Write the test file FIRST (RED), run it to confirm failure, then implement (GREEN). Commit RED then GREEN as separate commits per the TDD workflow.
  </action>
  <verify>
    <automated>AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs expandPrompt</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "from ['\"]fs['\"]|from ['\"]electron['\"]|typeorm|getRepository" src/service/slashCommands/expandPrompt.ts</automated>
  </verify>
  <acceptance_criteria>
    - The file `src/service/slashCommands/expandPrompt.ts` exists and exports `expandPrompt(body: string, args: string): string` with an explicit return type.
    - `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs expandPrompt` passes all 7 behavior cases listed in `<behavior>` (minimum 7 tests).
    - `npx tsc --noEmit` reports 0 errors.
    - expandPrompt.ts imports nothing (pure leaf) — `grep -c "^import" src/service/slashCommands/expandPrompt.ts` returns 0.
    - The argument-token literal appears at least once in expandPrompt.ts (it is the feature being implemented).
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>expandPrompt is a pure, zero-dependency function; all 7 behavior cases pass; tsc clean; RED then GREEN commits landed.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: CMD-06 frontmatter validator/builder + constants (CMD-06 schema, SC4)</name>
  <files>src/service/slashCommands/promptCommandFrontmatter.ts, src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts, test/vitest/main/service/promptCommandFrontmatter.test.ts</files>
  <read_first>
    - .planning/phases/15-prompt-command-files/15-CONTEXT.md ("Carry-Forward" — CMD-06 schema: name pattern, description cap, alias count cap, argumentHint cap, type prompt, non-empty body)
    - .planning/REQUIREMENTS.md (CMD-06 row — the single requirement for this phase)
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts (existing AIFETCHLY_CONFIG_LIMITS pattern — extend it; existing AIFETCHLY_DIAGNOSTIC_CODES — reuse codes)
    - src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts (the restricted frontmatter parser — understand its scalar/array output shape; the validator consumes already-parsed frontmatter records, it does NOT re-parse bytes)
    - src/service/workspaceWatch/WorkspaceConfigScanner.ts lines 44-57 (WorkspaceCommandDraft.frontmatter shape — Record<string, string | readonly string[]>; this is what the validator consumes for workspace drafts)
    - src/entityTypes/slashCommandTypes.ts (SlashCommandDefinition — the output shape; the validator produces one with type 'prompt')
  </read_first>
  <behavior>
    Valid cases (return {ok:true, definition}):
    - Minimal valid: name "review", description "Review code", body "Review this", type "prompt" -> SlashCommandDefinition with type 'prompt', source/sourceId from sourceMeta, enabled true, requiresTrust per sourceMeta, aliases [], argumentHint undefined.
    - With aliases + hint: name "review", description "Review", aliases ["rev","r"], argumentHint "<path>", type "prompt", body non-empty -> definition carries aliases and argumentHint verbatim (defensive copy).
    - Name with digits/hyphens/underscores: "review-v2", "code_review", "review2" all accepted (pattern allows [a-z][a-z0-9_-]*).
    Invalid cases (return {ok:false, diagnostic}):
    - Name starting uppercase / digit / containing invalid char: "Review", "2review", "re view!", "re.view" -> rejected with command-name-invalid diagnostic.
    - Description missing (empty/undefined) -> command-description-missing diagnostic.
    - Description over the cap (501 chars when cap is 500) -> frontmatter-invalid diagnostic.
    - argumentHint over the cap (101 chars when cap is 100) -> frontmatter-invalid diagnostic.
    - More than 10 aliases -> frontmatter-invalid diagnostic.
    - Any alias not matching the name pattern -> frontmatter-invalid diagnostic.
    - type field present but not "prompt" -> frontmatter-invalid diagnostic (Phase 15 handles prompt only).
    - type field absent -> frontmatter-invalid diagnostic (type is required).
    - Empty body (whitespace-only or zero-length) -> frontmatter-invalid diagnostic.
  </behavior>
  <action>
    Step 1 — extend `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts`: add three numeric caps to `AIFETCHLY_CONFIG_LIMITS` — commandDescriptionLength (500), commandAliases (10), commandArgumentHintLength (100) — and export a compiled name-pattern constant (e.g. `COMMAND_NAME_PATTERN` / `COMMAND_NAME_REGEX`) implementing the CMD-06 rule: lowercase letter first, then any number of lowercase letters, digits, hyphens, or underscores. Reuse the existing `as const` style. Do NOT duplicate the diagnostic-code literals — `command-name-invalid` and `command-description-missing` already exist in AIFETCHLY_DIAGNOSTIC_CODES; `frontmatter-invalid` already exists. No new diagnostic codes needed.

    Step 2 — create `src/service/slashCommands/promptCommandFrontmatter.ts` exporting `buildPromptCommandDefinition(draft, sourceMeta)` where `draft` carries the parsed frontmatter (a Record<string, string | readonly string[]> mirroring WorkspaceCommandDraft.frontmatter) + body + relativePath, and `sourceMeta` carries {source, sourceId, sourceLabel, requiresTrust}. The function returns a discriminated result: `{ok: true; definition: SlashCommandDefinition}` or `{ok: false; diagnostic: AIFetchlyConfigDiagnostic}`. Implementation: read name, description, aliases (default []), argumentHint (optional), type (required), body from the draft; validate each against the constants added in Step 1; on the FIRST violation, construct a diagnostic (reuse the `diagnostic(...)` shape — severity 'warning', recoverable true, the appropriate DX-01 code, source/sourceId from sourceMeta, filePath from draft.relativePath, a concise message naming the violated constraint) and return {ok:false}. If all checks pass, construct a `SlashCommandDefinition` with type 'prompt', enabled true, a stable id derived from sourceMeta.sourceId + the name (e.g. `${sourceMeta.sourceId}:command:${name}`), and defensive copies of aliases (Array.from). NEVER mutate the input draft. NEVER throw — all paths return a result. Pure module: import only types + the constants file; no fs/Electron/TypeORM/Vue.

    Write the test file FIRST (RED) covering every behavior case, run to confirm failure, then implement (GREEN). RED then GREEN commits.
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs promptCommandFrontmatter</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `src/service/slashCommands/promptCommandFrontmatter.ts` exports `buildPromptCommandDefinition` with an explicit return type union.
    - `AIFETCHLY_CONFIG_LIMITS` in AIFetchlyConfigConstants.ts now contains `commandDescriptionLength: 500`, `commandAliases: 10`, `commandArgumentHintLength: 100`, and a compiled name-pattern is exported.
    - The 4 valid behavior cases + 9 invalid behavior cases (minimum 13 tests) all pass.
    - `npx tsc --noEmit` reports 0 errors.
    - promptCommandFrontmatter.ts imports only types + AIFetchlyConfigConstants — `grep -cE "from ['\"]fs['\"]|from ['\"]electron['\"]|typeorm|getRepository" src/service/slashCommands/promptCommandFrontmatter.ts` returns 0.
    - buildPromptCommandDefinition returns defensive copies — mutating the input draft after calling the function does not change a previously-returned definition (one test asserts this).
    - The function never throws — a malformed draft (e.g. frontmatter with non-string scalar values) returns {ok:false, diagnostic} rather than throwing.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>CMD-06 schema is encoded once in a pure validator; 13+ tests pass; constants added; tsc clean; the validator is ready for Plan 02 to call from both the global loader and the workspace conversion path.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 3: Wire expandPrompt into the dispatcher prompt branch (SC2, CMD-04 submit_prompt)</name>
  <files>src/service/slashCommands/SlashCommandDispatcher.ts, test/vitest/main/service/SlashCommandDispatcher.test.ts</files>
  <read_first>
    - src/service/slashCommands/SlashCommandDispatcher.ts (the current `case "prompt":` branch returns not-yet-supported; lines 100-108. This is THE branch Phase 15 flips.)
    - src/service/slashCommands/expandPrompt.ts (the function from Task 1 — import and call it here)
    - src/entityTypes/slashCommandTypes.ts (SlashCommandDispatchResponse — the submit_prompt variant shape: {status:true, action:'submit_prompt', prompt, commandId})
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-03b-SUMMARY.md (the dispatcher's existing TDD test structure — extend it with a prompt case)
    - test/vitest/main/service/SlashCommandDispatcher.test.ts (existing test harness — how it constructs a registry + manager + dispatcher; mirror that for the new prompt test)
  </read_first>
  <behavior>
    - A registry with a registered prompt-type command (type 'prompt', body containing the argument token, id 'user:command:review', name 'review'); dispatching rawInput '/review src/service' returns {status:true, action:'submit_prompt', prompt: <body with token replaced by 'src/service'>, commandId:'user:command:review'}.
    - A prompt command whose body has NO token, dispatched with args 'src/a' returns submit_prompt with prompt = body + '\n\n' + 'src/a' (D-02 append path).
    - A prompt command dispatched with NO args (rawInput '/review') returns submit_prompt with prompt = body (token replaced with empty string, or body unchanged if no token).
    - The prompt is NEVER submitted to the AI by the dispatcher — the response is returned to the renderer; the downstream AI_CHAT_V2_STREAM IPC (unchanged) gates USER_AI_ENABLED (TRS-05 Strategy A — verified, no change here).
  </behavior>
  <action>
    Modify `src/service/slashCommands/SlashCommandDispatcher.ts`: import `expandPrompt` from './expandPrompt'. Replace the body of the `case "prompt":` branch (currently returning the not-yet-supported message) with a call to `expandPrompt(cmd.body ?? '', parsed.args ?? '')` and return `{status: true, action: "submit_prompt", prompt: <rendered>, commandId: cmd.id}`. Handle the case where `cmd.body` is undefined defensively (treat as empty string — though the validator rejects empty bodies, a defensive fallback prevents runtime TypeError). Update the Phase-15 boundary comment at the top of the file and at the former branch to reflect that prompt dispatch is now LIVE in Phase 15 (the boundary markers from Phase 13 are superseded for the dispatcher ONLY — the parser stays pure). The dispatcher MUST NOT gain any dynamic-code-execution import (no process-spawning module, no eval-like or dynamic-function-constructor calls) — expansion is string-only.

    Extend `test/vitest/main/service/SlashCommandDispatcher.test.ts` with a new `describe` block "SlashCommandDispatcher prompt commands (Phase 15 / SC2)" covering the 3 behavior cases above. Construct a fresh CommandRegistry per test, register a prompt-type SlashCommandDefinition directly via registry.register (mirroring how Plan 13-03b registered built-ins in tests — no loader dependency), instantiate SlashCommandDispatcher with the registry + a stub manager, and assert the submit_prompt response shape. Write/extend the tests FIRST (RED — the current not-yet-supported branch makes them fail), then make the branch change (GREEN). RED then GREEN commits.
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs SlashCommandDispatcher</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "new Function\(|[^_]eval\(" src/service/slashCommands/SlashCommandDispatcher.ts</automated>
  </verify>
  <acceptance_criteria>
    - The `case "prompt":` branch in SlashCommandDispatcher.ts calls expandPrompt and returns the submit_prompt variant; the literal not-yet-supported prompt message is GONE.
    - The new prompt-commands describe block passes all 3 behavior cases (plus the existing 22 Phase-13 cases still pass — 25+ total in the file).
    - `npx tsc --noEmit` reports 0 errors.
    - SlashCommandDispatcher.ts contains the argument-token literal (it now legitimately references it via expandPrompt — the Phase-13 grep gate that asserted 0 hits is superseded for the dispatcher; the PARSER file SlashCommandParser.ts still has 0 hits — region-scoped, verified separately).
    - The dispatcher imports NO process-spawning or dynamic-evaluation primitive — verified by the negative grep in `<verify>`.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>`/review src/service` dispatched against a registered prompt command returns {action:'submit_prompt', prompt:<expanded>} (SC2 at the unit level); Phase-13 built-in dispatch unchanged; tsc clean; the Phase-15 boundary in the dispatcher is crossed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| workspace-file -> worker -> main registry | Untrusted workspace command files cross here (mitigated at Plan 02 via the Phase-14 trust filter — this plan does not touch file loading) |
| dispatcher input -> expanded prompt -> AI_CHAT_V2_STREAM | Expanded prompt text crosses into the AI session; the dispatcher itself is NOT AI-serving (returns a prompt; the stream IPC gates USER_AI_ENABLED) |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-15-01 | Information Disclosure / Spoofing | expandPrompt (prompt injection via command body) | medium | mitigate | Expansion is pure text substitution; the body is author-supplied text that becomes a prompt — inherent to the feature. Global commands are user-owned (the user can already type anything into the AI); workspace commands require Phase-14 trust before registration (Plan 02 enforces). The expanded prompt is returned to the renderer and submitted via the existing AI_CHAT_V2_STREAM which gates USER_AI_ENABLED (TRS-05 Strategy A — unchanged). |
| T-15-03 | Elevation of Privilege | expandPrompt / dispatcher (code execution via expansion) | high | mitigate | Expansion uses ONLY literal string split-and-join (no dynamic code execution primitive, no regex with unescaped metacharacters, no template-string eval). Verified by negative grep in Task 1 and Task 3 acceptance criteria. This preserves the TRS-06 invariant that prompt commands are text-expansion only. |
| T-15-07 | Tampering | buildPromptCommandDefinition (validator bypass) | medium | mitigate | The validator is the SINGLE owner of the CMD-06 schema; both global and workspace paths in Plan 02 route through it. A draft that fails any check produces a diagnostic and no definition — the command never reaches the registry (SC4). Defensive copies prevent post-validation mutation of returned definitions. |
| T-15-SC | Supply Chain | package installs | low | accept | Phase 15 adds ZERO new npm/pip/cargo packages — it reuses the Phase 13/14 stack (zod already in tree; no new deps). No legitimacy checkpoint needed. |
</threat_model>

<verification>
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs expandPrompt promptCommandFrontmatter SlashCommandDispatcher` -> all GREEN (40+ tests).
- `npx tsc --noEmit` -> 0 errors.
- `grep -c '^import' src/service/slashCommands/expandPrompt.ts` -> 0 (pure leaf).
- SlashCommandParser.ts and CommandRegistry.ts UNCHANGED (no expansion logic leaked into the parser or registry — they remain pure).
</verification>

<success_criteria>
- expandPrompt implements D-01 (all occurrences) + D-02 (append-when-absent) as a pure function — SC2 supported at the substitution layer.
- buildPromptCommandDefinition encodes the full CMD-06 schema once — SC4 supported at the validation layer.
- The dispatcher's prompt branch returns submit_prompt with the expanded body — SC2 wired end-to-end at the main-process level (Plan 02 attaches real file sources).
- No new IPC channels, no DB changes, no new packages — Phase 13 contracts preserved.
</success_criteria>

<output>
Create `.planning/phases/15-prompt-command-files/15-01-SUMMARY.md` when done.
</output>

## Artifacts this plan produces

- **`expandPrompt(body, args): string`** — pure, zero-import argument-token substitution (D-01 all-occurrences + D-02 append-when-absent). Consumed by the dispatcher (this plan) and unit-testable in isolation.
- **`buildPromptCommandDefinition(draft, sourceMeta)`** — pure CMD-06 frontmatter validator/builder returning `{ok, definition | diagnostic}`. Consumed by Plan 02's global loader and workspace conversion path (single schema owner).
- **CMD-06 limit constants** added to `AIFetchlyConfigConstants.AIFETCHLY_CONFIG_LIMITS` (commandDescriptionLength=500, commandAliases=10, commandArgumentHintLength=100) + an exported compiled command-name pattern.
- **SlashCommandDispatcher `case "prompt":` branch** flipped from not-yet-supported to live `expandPrompt` -> `submit_prompt` (the Phase-13 boundary marker is crossed for the dispatcher only; the parser stays pure).
- **Three unit-test files** (expandPrompt, promptCommandFrontmatter, SlashCommandDispatcher prompt cases) — RED then GREEN commits.
