---
phase: 13-global-context-and-built-in-slash-commands
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/entityTypes/slashCommandTypes.ts
  - src/service/slashCommands/CommandRegistry.ts
  - src/service/slashCommands/SlashCommandParser.ts
  - test/vitest/main/service/CommandRegistry.test.ts
  - test/vitest/main/service/SlashCommandParser.test.ts
autonomous: true
requirements: [CMD-01, CMD-02, CMD-07]
must_haves:
  truths:
    - "CommandRegistry enforces the deterministic lookup order built-in > workspace > user > plugin for duplicate names (CMD-01)"
    - "replaceSource(sourceId, commands) atomically reconciles add/change/delete/rename and rebuilds the name index so stale entries never survive (CMD-01)"
    - "Built-in command IDs cannot be shadowed by user/workspace/plugin registrations of the same name (CMD-01)"
    - "SlashCommandParser correctly classifies '/review src' as a command, left-trimmed ' /review' as a command, '//review' as NOT a command, bare '/' as suggest-only (not dispatchable), and '/unknown args' as a parsed command that the dispatcher treats as not-found (CMD-02)"
    - "listViews() returns renderer-safe SlashCommandView objects that OMIT the full prompt body (only metadata) (CMD-07)"
    - "Suggestion ranking is deterministic: exact name > exact alias > prefix name > prefix alias > substring in description (CMD-07)"
  artifacts:
    - "src/entityTypes/slashCommandTypes.ts — SlashCommandDefinition, SlashCommandView, SlashCommandSource, SlashCommandType, ParsedSlashCommandInput"
    - "src/service/slashCommands/CommandRegistry.ts — class CommandRegistry with register/unregister/replaceSource/getByName/getById/list/listViews"
    - "src/service/slashCommands/SlashCommandParser.ts — parseSlashCommandInput function"
  key_links:
    - "CommandRegistry.getByName(name) -> rebuildNameIndex() applies lookup order built-in > workspace > user > plugin"
    - "SlashCommandParser is a pure function (no registry/IPC dependencies) — Plan 03's SlashCommandDispatcher composes parser + registry"
  prohibitions:
    - "No $ARGUMENTS substitution logic in the parser or registry (TRS-06 / CMD-06 — phase 15 boundary; add a code comment in SlashCommandParser marking the phase-15 expansion point)"
    - "No IPC imports, no Module imports, no Electron imports — registry and parser are pure in-memory logic"
    - "listViews MUST NOT include the prompt body (security: renderer never sees raw prompt content except via explicit preview API — design §5.5, §14.2)"
---

<objective>
Build the slash command registry (with source replacement and deterministic lookup order) and the pure slash command parser. These are the two pure-logic foundations that Plan 03's dispatcher and IPC layer compose with.

Purpose: Establish the command-resolution data structure (CMD-01) and the input-classification rules (CMD-02) before any dispatch or UI layer exists. Both are pure logic with well-defined I/O contracts — ideal for table-driven TDD.
Output: Two new source files + two Vitest test files, plus the shared slashCommandTypes.
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
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Slash command types + CommandRegistry with source replacement and lookup order (CMD-01, CMD-07)</name>
  <files>
    src/entityTypes/slashCommandTypes.ts,
    src/service/slashCommands/CommandRegistry.ts,
    test/vitest/main/service/CommandRegistry.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §5.5 (SlashCommandDefinition + SlashCommandView), §7.1 (CommandRegistry API + lookup order), §7.3 (replaceSource atomic semantics), §11.2 (list request/response + ranking)
    - src/service/AgentDefinitionRegistry.ts — the structural analog: a registry over a built-in array. Read it to mirror the defensive-copy pattern (it returns {...d} clones) and to understand what it LACKS (replaceSource) so you add it correctly.
    - src/entityTypes/agentTypes.ts — sibling pure-types file to mirror export style for SlashCommandDefinition
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Pattern 3 (Registry with Defensive Copies + Source Replacement) for the code structure sketch
  </read_first>
  <behavior>
    - Registry lookup order is built-in > workspace > user > plugin: registering builtinReview then userReview then re-querying "review" returns the built-in
    - Registering workspaceReview then userReview and querying "review" returns the workspace one
    - Registering userReview then pluginReview and querying "review" returns the user one
    - replaceSource("user", [reviewCmd, leadCmd]) then replaceSource("user", [reviewCmd]) removes leadCmd: getById("user:command:lead-research") returns null and list() has zero "lead-research"
    - replaceSource atomically handles rename: old name disappears, new name appears, no stale leftover
    - register() stores a defensive copy; mutating the original input after registration does NOT affect the stored command (immutability rule from CLAUDE.md)
    - list() returns defensive copies
    - listViews() returns objects WITHOUT the `body` field (renderer-safe)
    - getByName returns null for unknown names
    - getById returns null for unknown ids
  </behavior>
  <action>
    File 1 — src/entityTypes/slashCommandTypes.ts: pure types module. NO Electron/TypeORM/Vue/service imports. Export per design §5.5:
      - SlashCommandSource = "built-in" | "user" | "workspace" | "plugin"
      - SlashCommandType = "prompt" | "local" | "skill"
      - SlashCommandDefinition (id, name, description, aliases readonly array, type, source, sourceId, sourceLabel, optional argumentHint, requiresTrust boolean, enabled boolean, optional body string, optional metadata Record<string,unknown>)
      - SlashCommandView (id, name, description, aliases, source, sourceLabel, optional argumentHint, enabled, optional disabledReason — NO body field; this is the renderer-safe projection)
      - ParsedSlashCommandInput (isCommand boolean, optional name, optional args, raw string) — used by the parser in Task 2 but defined here so both the parser and dispatcher share it.
      - Source-id format helper constants: BUILTIN_SOURCE = "built-in", USER_SOURCE = "user". Workspace source IDs are `workspace:<id>`, plugin are `plugin:<name>` — document these in JSDoc on SlashCommandDefinition.id.

    File 2 — src/service/slashCommands/CommandRegistry.ts: a class. Mirror AgentDefinitionRegistry's defensive-copy discipline but ADD replaceSource (which AgentDefinitionRegistry lacks).
      - Private state: byId Map<string, SlashCommandDefinition>; byName Map<string, SlashCommandDefinition> (first-enabled-wins per lookup order after rebuild); sourceIndex Map<string, Set<string>> (sourceId -> set of command IDs).
      - Define a SOURCE_RANK record: { "built-in": 0, "workspace": 1, "user": 2, "plugin": 3 } (lower wins). Used by rebuildNameIndex.
      - register(cmd): store {...cmd} (defensive copy) in byId; call rebuildNameIndex().
      - unregister(id): delete from byId; rebuildNameIndex().
      - replaceSource(sourceId, commands): delete all existing byId entries listed in sourceIndex.get(sourceId); then insert {...c} for each new command; update sourceIndex; rebuildNameIndex(). Atomic — handles delete/rename/missed-events (design §7.3, §10.1).
      - rebuildNameIndex(): clear byName; iterate byId values grouped by name; for each name group, pick the winner by min SOURCE_RANK (tie-break: first-registered). Store winner in byName.
      - getByName(name): return defensive copy of byName entry or null.
      - getById(id): return defensive copy of byId entry or null.
      - list(): return [...byId.values()].map(c => ({...c})).
      - listViews(): return list().map(c => strip body field -> SlashCommandView). Use object destructuring to omit `body` and `metadata` (renderer never sees raw body — design §5.5, §14.2).
      - rankSuggestions(query, commands): pure helper that sorts a SlashCommandView[] by the ranking rules: exact name > exact alias > prefix name > prefix alias > substring in description. Stable sort. (Can be a separate exported function or a static method; design §11.2.)

    File 3 — test/vitest/main/service/CommandRegistry.test.ts: table-driven per the <behavior> list. Use vitest's it.each for the lookup-order matrix and the replaceSource reconciliation cases. Verify immutability by mutating an input after register() and asserting the stored command is unchanged.
  </action>
  <verify>
    <automated>yarn testmain -- CommandRegistry</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/CommandRegistry.test.ts exits 0
    - `grep -c "export class CommandRegistry" src/service/slashCommands/CommandRegistry.ts` returns 1
    - `grep -c "replaceSource" src/service/slashCommands/CommandRegistry.ts` returns at least 2 (method definition + sourceIndex usage)
    - `grep -c "rebuildNameIndex" src/service/slashCommands/CommandRegistry.ts` returns at least 2
    - `grep -c "SOURCE_RANK\|source.*rank" src/service/slashCommands/CommandRegistry.ts` returns at least 1 (lookup order enforced via rank map)
    - listViews strips body: the test asserts no element in the listViews() output has a `body` property (use expect.objectContaining({ body: expect.anything() }) to FAIL if present, or assert `('body' in view) === false`)
    - No IPC/Electron/Module imports: `! grep -E "from ['\"]electron|from ['\"]@/main-process|from ['\"]@/modules" src/service/slashCommands/CommandRegistry.ts` exits 0
  </acceptance_criteria>
  <done>
    CommandRegistry enforces built-in > workspace > user > plugin lookup with defensive copies and atomic source replacement. listViews() omits the prompt body. Suggestion ranking is deterministic.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: SlashCommandParser — pure input classification rules (CMD-02)</name>
  <files>
    src/service/slashCommands/SlashCommandParser.ts,
    test/vitest/main/service/SlashCommandParser.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md section §11.1 (Parser rules + ParsedSlashCommandInput shape)
    - src/service/slashCommands/CommandRegistry.ts — the registry from Task 1 (read AFTER Task 1 lands; the parser does NOT depend on the registry, but both share ParsedSlashCommandInput from slashCommandTypes.ts — confirm the type is used consistently)
    - src/entityTypes/slashCommandTypes.ts — confirm ParsedSlashCommandInput is exported (Task 1 defines it)
  </read_first>
  <behavior>
    - parseSlashCommandInput("/review src") returns {isCommand:true, name:"review", args:"src", raw:"/review src"}
    - parseSlashCommandInput(" /review") (leading space) returns {isCommand:true, name:"review"} after left-trim
    - parseSlashCommandInput("//review") returns {isCommand:false} (double slash is NOT a command)
    - parseSlashCommandInput("/") returns {isCommand:true, name:undefined, args:undefined, raw:"/"} — suggest-only, NOT dispatchable (caller checks !name)
    - parseSlashCommandInput("/unknown args here") returns {isCommand:true, name:"unknown", args:"args here"} — dispatcher will return not-found
    - parseSlashCommandInput("hello /world") returns {isCommand:false} — slash not at start
    - parseSlashCommandInput("") returns {isCommand:false}
    - parseSlashCommandInput("/review   multiple   spaces") returns {isCommand:true, name:"review", args:"multiple   spaces"} — args preserve internal whitespace, only the split between name and args is on the FIRST run of whitespace
  </behavior>
  <action>
    Create src/service/slashCommands/SlashCommandParser.ts: a PURE module. No imports except the ParsedSlashCommandInput type from src/entityTypes/slashCommandTypes.ts. Export `function parseSlashCommandInput(raw: string): ParsedSlashCommandInput`.

    Algorithm (design §11.1):
      1. left-trim the input.
      2. If empty OR does not start with "/": return {isCommand:false, raw}.
      3. If it starts with "//": return {isCommand:false, raw} (escaped or comment — not a command).
      4. Set isCommand=true.
      5. After the leading "/", if the remainder is empty or all whitespace: return {isCommand:true, name:undefined, args:undefined, raw} (suggest-only — bare "/").
      6. Otherwise: split on the FIRST run of whitespace. name = the token before; args = everything after (preserving internal whitespace). If no whitespace, name = entire remainder, args = undefined.
      7. Validate name matches ^[a-zA-Z][a-zA-Z0-9_-]*$ — if NOT, still return isCommand:true with the name as-is (the dispatcher will return not-found for invalid names; this keeps the parser permissive and lets the dispatcher produce the right "Unknown slash command" message per CMD-08).

    Add a code comment at the top: "Phase 15 will add $ARGUMENTS expansion in the DISPATCHER (PromptCommand expansion), NOT here. This parser only classifies input." (TRS-06 boundary marker — phase 13 built-ins take no arguments.)

    Test file — table-driven per the <behavior> list using vitest's it.each.
  </action>
  <verify>
    <automated>yarn testmain -- SlashCommandParser</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/SlashCommandParser.test.ts exits 0
    - `grep -c "export function parseSlashCommandInput" src/service/slashCommands/SlashCommandParser.ts` returns 1
    - `grep -c "isCommand" src/service/slashCommands/SlashCommandParser.ts` returns at least 3 (the boolean is set in multiple branches)
    - The parser does NOT reference the registry: `! grep -E "CommandRegistry|registry" src/service/slashCommands/SlashCommandParser.ts` exits 0 (pure function, no registry dependency)
    - The parser has a phase-15 boundary comment: `grep -c "phase 15\|Phase 15" src/service/slashCommands/SlashCommandParser.ts` returns at least 1 (TRS-06 marker)
    - No $ARGUMENTS substitution exists in the parser: `! grep -n '\$ARGUMENTS' src/service/slashCommands/SlashCommandParser.ts` exits 0 (TRS-06 enforced — the literal does not appear in the file)
  </acceptance_criteria>
  <done>
    SlashCommandParser is a pure function that classifies input per CMD-02's five rules. The $ARGUMENTS phase-15 boundary is marked. No registry/IPC/Electron imports.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer input → parser | User-typed composer text crosses into the parser. Malicious/odd input (control chars, unicode, very long strings) must not crash or inject. |
| Registry mutation → registry consumers | replaceSource mutates shared in-memory state; concurrent reads during a rebuild could see inconsistent state. Mitigated by synchronous JS single-thread + defensive copies. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-13-05 | Code Execution (future) | SlashCommandParser / CommandRegistry (TRS-06) | medium | mitigate | Phase 13 has NO $ARGUMENTS substitution (boundary comment in parser). Registry stores definitions, never executes them. listViews() omits prompt body so renderer cannot be tricked into displaying/executing raw prompt content. |
| T-13-Inject | Tampering | SlashCommandParser input handling | low | mitigate | Parser is pure, never evals, never imports child_process. Permissive name validation delegates "not found" to dispatcher (CMD-08). Bounded by the raw string length naturally (no unbounded loops). |
| T-13-Leak | Info Disclosure | listViews() (design §14.2) | medium | mitigate | listViews() strips body + metadata from SlashCommandView; renderer only sees name/description/aliases/source/argumentHint/enabled/disabledReason. Verified by test. |
| T-13-SC | Tampering | Package installs | n/a | accept | Zero new packages. |
</threat_model>

<verification>
- yarn testmain -- CommandRegistry exits 0 (CMD-01, CMD-07)
- yarn testmain -- SlashCommandParser exits 0 (CMD-02)
- tsc --noEmit passes (typecheck gate)
- listViews() body-stripping verified by test assertion
- No $ARGUMENTS literal anywhere in src/service/slashCommands/ (TRS-06)
</verification>

<success_criteria>
- CommandRegistry enforces built-in > workspace > user > plugin lookup with atomic source replacement and defensive copies.
- SlashCommandView (renderer projection) never carries the prompt body.
- SlashCommandParser implements all five CMD-02 rules and is a pure function with no registry dependency.
- $ARGUMENTS expansion is explicitly out of scope (phase 15 boundary marked).
</success_criteria>

<output>
Create `.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md` when done.

## Artifacts this phase produces (Plan 02 contribution)

**Types (src/entityTypes/slashCommandTypes.ts):**
- SlashCommandSource, SlashCommandType
- SlashCommandDefinition (full, with body — main-process only)
- SlashCommandView (renderer-safe, no body)
- ParsedSlashCommandInput
- BUILTIN_SOURCE, USER_SOURCE constants

**Services (src/service/slashCommands/):**
- CommandRegistry class: register, unregister, replaceSource, getByName, getById, list, listViews, rankSuggestions
- parseSlashCommandInput function (SlashCommandParser.ts)

**Tests (test/vitest/main/service/):**
- CommandRegistry.test.ts (CMD-01 lookup order + replaceSource + CMD-07 ranking)
- SlashCommandParser.test.ts (CMD-02 input classification)
</output>
