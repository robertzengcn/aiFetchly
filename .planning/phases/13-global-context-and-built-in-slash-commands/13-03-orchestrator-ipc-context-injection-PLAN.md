---
phase: 13-global-context-and-built-in-slash-commands
plan: 03
type: execute
wave: 2
depends_on: [01, 02]
files_modified:
  - src/service/aifetchlyConfig/AIFetchlyContextStore.ts
  - src/service/aifetchlyConfig/AIFetchlyContextLoader.ts
  - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
  - src/service/slashCommands/builtinSlashCommands.ts
  - src/service/slashCommands/SlashCommandDispatcher.ts
  - src/modules/SlashCommandModule.ts
  - src/main-process/communication/slash-command-ipc.ts
  - src/config/channellist.ts
  - src/main-process/communication/index.ts
  - src/background.ts
  - src/service/AIChatContextAssembler.ts
  - test/vitest/main/service/AIFetchlyContextLoader.test.ts
  - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts
  - test/vitest/main/service/SlashCommandDispatcher.test.ts
  - test/vitest/main/ipc/slash-command-ipc.test.ts
autonomous: true
requirements: [CTX-01, CTX-03, CMD-03, CMD-04, CMD-08, TRS-05, TRS-06, DX-02]
must_haves:
  truths:
    - "Global AGENTS.md content appears in AIChatContextAssembler.assemble() output as a system message AFTER the base system prompt + custom directive and BEFORE durable memory (CTX-01)"
    - "The injected block is labeled clearly (e.g. 'User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:') without implying priority over the app system prompt (CTX-01, CTX-03 — prompt-injection resistance)"
    - "An in-memory context cache (AIFetchlyContextStore) avoids per-request file reads; a cache miss returns an empty list, never blocks chat (CTX-03)"
    - "Read failures in the injection path degrade to no-injection + console.error, never throw or break chat (CTX-03 — mirror the existing custom-directive try/catch at AIChatContextAssembler lines 116-128)"
    - "Built-in commands /help, /clear, /status, /reload-config are registered at startup and appear in registry.list() (CMD-03)"
    - "SlashCommandDispatcher returns the discriminated union: built-ins -> show_result; prompt commands -> submit_prompt; unknown/disabled/invalid -> {status:false,msg} (CMD-04, CMD-08)"
    - "The dispatcher contains NO $ARGUMENTS substitution and NO eval/exec/spawn/child_process (TRS-06 — phase 13 built-ins are text/local only)"
    - "slash-command:dispatch uses registerValidatedHandler (NOT the AI-gated wrapper); prompt commands return submit_prompt and the renderer submits via the existing AI_CHAT_V2_STREAM path which already gates USER_AI_ENABLED (TRS-05 Strategy A — VERIFIED: ai-chat-v2-ipc.ts handleStream line 385-394 calls isAIEnabled() FIRST)"
    - "list/status/reload IPC handlers are NOT AI-gated (TRS-05 matrix)"
    - "/status returns counts (commands, agents, hooks, skills, diagnostics), last reload time, and watcher state reported as 'not started (phase 14)' (DX-02)"
    - "Startup fires AIFetchlyConfigManager.initialize() as fire-and-forget alongside SkillImportService.loadPersistedSkills() in background.ts; app launch never blocks on the scan (Pitfall 6)"
  artifacts:
    - "src/service/aifetchlyConfig/AIFetchlyContextStore.ts — class with replaceInstructions/removeSource/getGlobalInstructions"
    - "src/service/aifetchlyConfig/AIFetchlyContextLoader.ts — getInstructionBlocks() consumed by AIChatContextAssembler"
    - "src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts — applySnapshot/removeSource wiring loader->registry->cache"
    - "src/service/aifetchlyConfig/AIFetchlyConfigManager.ts — singleton orchestrator (initialize/reload/getStatus)"
    - "src/service/slashCommands/builtinSlashCommands.ts — registerBuiltInSlashCommands(registry) for help/clear/status/reload-config"
    - "src/service/slashCommands/SlashCommandDispatcher.ts — class with dispatch(input) returning SlashCommandDispatchResponse"
    - "src/modules/SlashCommandModule.ts — business logic called by IPC (listCommands/dispatch/reload/status)"
    - "src/main-process/communication/slash-command-ipc.ts — registerSlashCommandHandlers(win)"
    - "Five new channel constants in src/config/channellist.ts: SLASH_COMMAND_LIST, SLASH_COMMAND_DISPATCH, AIFETCHLY_CONFIG_RELOAD, AIFETCHLY_CONFIG_STATUS, AIFETCHLY_CONFIG_CHANGED"
    - "background.ts calls registerSlashCommandHandlers + registerBuiltInSlashCommands + AIFetchlyConfigManager.initialize() at startup"
    - "src/main-process/communication/index.ts registers the slash command handlers"
    - "AIChatContextAssembler.assemble() injects global AGENTS.md block between the active-workspace block and durable memory"
  key_links:
    - "AIFetchlyConfigManager.initialize() -> AIFetchlyConfigLoader.scanGlobalRoot() -> AIFetchlyRuntimeRegistrySync.applySnapshot() -> CommandRegistry.replaceSource() + AIFetchlyContextStore.replaceInstructions()"
    - "AIChatContextAssembler.assemble() -> AIFetchlyContextLoader.getInstructionBlocks() -> AIFetchlyContextStore.getGlobalInstructions() (cached, no fs read per request)"
    - "slash-command:dispatch handler -> SlashCommandModule.dispatch() -> SlashCommandDispatcher.dispatch() -> CommandRegistry.getByName() + built-in handlers"
    - "/reload-config -> AIFetchlyConfigManager.reload() -> re-scan -> applySnapshot -> AIFETCHLY_CONFIG_CHANGED event to renderer"
    - "TRS-05 Strategy A: dispatch is NOT AI-gated at the IPC layer; prompt commands return submit_prompt and the renderer submits via AI_CHAT_V2_STREAM which gates USER_AI_ENABLED (VERIFIED at ai-chat-v2-ipc.ts:385-394)"
  prohibitions:
    - "No $ARGUMENTS substitution in the dispatcher (TRS-06 / CMD-06 — phase 15 boundary; mark with a code comment)"
    - "No AI-enable gate on list/status/reload handlers (TRS-05 — they are not AI-serving)"
    - "No AI-enable gate on the dispatch handler itself (TRS-05 Strategy A — prompt commands are gated downstream by AI_CHAT_V2_STREAM)"
    - "No direct DB access in IPC handlers — the SlashCommandModule calls services, never TypeORM (CLAUDE.md three-layer rule; phase 13 has zero DB anyway)"
    - "No worker/childprocess files (phase 14 boundary — the watcher worker does not exist yet)"
    - "No synchronous fs in the startup scan path (Pitfall 6 — fire-and-forget with .catch logging)"
    - "The dispatcher MUST NOT import child_process, eval, or Function() (TRS-06 — phase 13 built-ins are local text only)"
---

<objective>
Wire the config loader (Plan 01) and command registry (Plan 02) into a runtime: build the context cache + loader that AGENTS.md flows through, the registry-sync + singleton orchestrator that owns lifecycle, the four built-in commands, the dispatcher with its discriminated-union response, the SlashCommandModule + IPC handlers (TRS-05 Strategy A), the channel constants + startup hook, and the AIChatContextAssembler injection point.

Purpose: This is the backend wiring wave — it connects Plan 01's loader to Plan 02's registry and exposes both via IPC so Plan 04's renderer can call them. It also fulfills CTX-01 (AGENTS.md injection) and TRS-05 (correct AI-gate placement) — the two trickiest requirements.
Output: Seven new main-process files, modifications to four existing files (channellist, communication/index, background, AIChatContextAssembler), and four Vitest test files.
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
@src/main-process/communication/ai-chat-v2-ipc.ts
@src/main-process/communication/_shared/registerValidatedHandler.ts
@src/service/AIChatContextAssembler.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Context store + context loader + runtime registry sync + config manager singleton (CTX-01, CTX-03)</name>
  <files>
    src/service/aifetchlyConfig/AIFetchlyContextStore.ts,
    src/service/aifetchlyConfig/AIFetchlyContextLoader.ts,
    src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts,
    src/service/aifetchlyConfig/AIFetchlyConfigManager.ts,
    src/service/AIChatContextAssembler.ts,
    test/vitest/main/service/AIFetchlyContextLoader.test.ts,
    test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §8.1 (RuntimeRegistrySync responsibilities), §8.2 (trust filtering — phase 13 is global-only so trust=true always), §8.3 (AIFetchlyContextStore shape), §12.1 (injection point + formatInstructionBlock), §12.2 (label wording — anti-prompt-injection), §12.3 (cache miss -> empty list, never block), §19.1 (startup sequence)
    - src/service/AIChatContextAssembler.ts — the FULL file (read it to find the exact insertion point between the active-workspace try/catch ending at line ~150 and the durable-memory block starting at line ~155). Mirror the existing try/catch + console.error degradation pattern.
    - test/vitest/main/service/AIChatContextAssembler.test.ts — the existing assembler test header (mock pattern for systemSettings + durableMemory; add AIFetchlyContextLoader mock the same way)
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (from Plan 01) — confirm scanGlobalRoot() signature and AIFetchlyConfigSnapshot shape
    - src/service/slashCommands/CommandRegistry.ts (from Plan 02) — confirm replaceSource signature for the sync layer
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Pattern 2 (Graceful Degradation) and Code Examples (AGENTS.md injection point) — verbatim try/catch shape to replicate
  </read_first>
  <behavior>
    - AIFetchlyContextStore.replaceInstructions("user", [blockA]) then getGlobalInstructions() returns [blockA]
    - AIFetchlyContextStore.replaceInstructions("user", [blockB]) replaces (not appends) — getGlobalInstructions() returns [blockB] only
    - AIFetchlyContextStore.removeSource("user") -> getGlobalInstructions() returns []
    - AIFetchlyContextLoader.getInstructionBlocks() BEFORE manager.initialize() returns [] (cache miss, never throws — CTX-03)
    - AIFetchlyContextLoader.getInstructionBlocks() AFTER a snapshot with AGENTS.md returns exactly one block with label starting "User global AiFetchly instructions"
    - AIChatContextAssembler.assemble() with a populated AGENTS.md block produces a messages array where the AGENTS.md system message comes AFTER the base system prompt and the custom directive, and BEFORE the durable-memory system message (CTX-01 ordering)
    - AIChatContextAssembler.assemble() with AIFetchlyContextLoader throwing still returns a valid messages array (the AGENTS.md try/catch degrades to no-injection — CTX-03)
    - AIFetchlyConfigManager.initialize() called twice in a row does not crash (idempotent or guarded)
    - AIFetchlyConfigManager.reload() re-scans and the next getInstructionBlocks() reflects the new content
    - AIFetchlyConfigManager.getStatus() returns an object with commandCount, diagnosticCount, lastReloadAt, and watcherState === "not-started" (phase 14 placeholder — DX-02)
  </behavior>
  <action>
    Create four new service files, then modify AIChatContextAssembler. All in the main-process layer.

    File 1 — src/service/aifetchlyConfig/AIFetchlyContextStore.ts: in-memory instruction cache. Export `class AIFetchlyContextStore`.
      - Private state: a Map<sourceId, AIFetchlyInstructionBlock[]>.
      - replaceInstructions(sourceId, blocks): defensive-copy the blocks array; store.
      - removeSource(sourceId): delete.
      - getGlobalInstructions(): return the "user" sourceId's blocks (defensive copy), or [] if absent.
      - getWorkspaceInstructions(workspaceId): return the `workspace:<id>` sourceId's blocks (defensive copy), or []. (Phase 14 populates this; phase 13 always returns [] but the method exists for the assembler contract.)
      - All returns are defensive copies (immutability rule).

    File 2 — src/service/aifetchlyConfig/AIFetchlyContextLoader.ts: the assembler-facing façade. Export `class AIFetchlyContextLoader`.
      - Holds a reference to the AIFetchlyContextStore (injected or singleton-backed).
      - Async getInstructionBlocks(input: { conversationId: string; mode: "chat"|"plan" }): Promise<AIFetchlyInstructionBlock[]>. Returns the store's global + workspace (empty in phase 13) blocks. NEVER throws — wraps everything in try/catch and returns [] on any error (CTX-03).
      - formatInstructionBlock(block): builds the labeled system-message content per design §12.2. Global label EXACTLY: "User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:\n\n" + block.content. CRITICAL anti-prompt-injection rule: do NOT use wording that tells the model these instructions are higher-priority than the app's own system prompt (design §12.2 last paragraph). For workspace blocks (phase 14): "Trusted workspace AiFetchly instructions for <path> from .aifetchly/AGENTS.md:\n\n" + content.

    File 3 — src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts: wires snapshots to registries/cache. Export `class AIFetchlyRuntimeRegistrySync`.
      - Constructor takes the CommandRegistry and AIFetchlyContextStore (dependency injection — testable).
      - applySnapshot(snapshot): calls commandRegistry.replaceSource(snapshot.sourceId, snapshot.commands); contextStore.replaceInstructions(snapshot.sourceId, snapshot.instructions). Returns an apply result {commandsChanged, instructionsChanged, diagnosticCount} derived from the snapshot. Phase 13 snapshots have empty commands/agents/hooks/skills; only instructions are non-empty (from AGENTS.md).
      - removeSource(sourceId): calls commandRegistry.replaceSource(sourceId, []); contextStore.removeSource(sourceId).
      - Phase 14+ adds trust filtering here (design §8.2); phase 13 trust is always "all-enabled" for the global source.

    File 4 — src/service/aifetchlyConfig/AIFetchlyConfigManager.ts: singleton orchestrator. Export `class AIFetchlyConfigManager` and a `getAIFetchlyConfigManager()` accessor (or a module-level singleton instance).
      - Constructor wires AIFetchlyConfigLoader (Plan 01), AIFetchlyRuntimeRegistrySync (with the singleton CommandRegistry from Plan 02 and AIFetchlyContextStore), and AIFetchlyContextStore.
      - async initialize(): if already initialized, return immediately (idempotent). Otherwise call loader.scanGlobalRoot(), then sync.applySnapshot(snapshot), record lastReloadAt = Date.now(), store lastSnapshot + lastSummary. Fire-and-forget safe (caller does .catch). NEVER throws synchronously.
      - async reload(): re-scan + re-apply. Returns a summary {commandCount, diagnosticCount, lastReloadAt, diff}. Emits AIFETCHLY_CONFIG_CHANGED via a registered callback (the IPC layer in Task 3 wires the actual BrowserWindow.send; here just expose an onConfigChanged callback registration).
      - getStatus(): synchronous, returns {commandCount, agentCount, hookCount, skillCount, diagnosticCount, lastReloadAt, watcherState: "not-started", source: "user"}. watcherState is hardcoded "not-started" in phase 13 (the watcher is phase 14 — assumption A1).
      - getInstructionBlocks(input): delegates to contextLoader.getInstructionBlocks (so the assembler only depends on the loader, not the manager).

    Modify — src/service/AIChatContextAssembler.ts: inject the AGENTS.md block.
      - Add a private collaborator: `private readonly aifetchlyContext = new AIFetchlyContextLoader();` near the other collaborators (line ~58-63). (Constructor injection is fine too if it improves testability — match the existing style which uses field initializers.)
      - Inside assemble(), between the active-workspace try/catch (ends line ~150) and the durable-memory block (starts line ~155 with `let injectionEnabled = true`), insert a new try/catch block (mirror lines 116-128 exactly):
        - try: const blocks = await this.aifetchlyContext.getInstructionBlocks({ conversationId, mode }); for each block, messages.push({ role: "system", content: AIFetchlyContextLoader.formatInstructionBlock(block) }).
        - catch (err): console.error("[ai-chat-context] aifetchly instructions injection failed:", err); do NOT push, do NOT rethrow (CTX-03 graceful degradation).
      - This places global AGENTS.md AFTER the base prompt + custom directive + active workspace, and BEFORE durable memory + compact + recent history — exactly the CTX-01 ordering.

    Tests:
      - test/vitest/main/service/AIFetchlyContextLoader.test.ts: covers the <behavior> bullets (cache miss, populated block, label format, try/catch degradation by injecting a throwing store).
      - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts: extends the existing assembler test mock pattern. Stub AIFetchlyContextLoader.getInstructionBlocks to return a known block; call assemble(); assert the AGENTS.md system message exists AND its index in messages is > base-system-prompt index AND < durable-memory index (CTX-01 ordering). Add a second case where the loader throws and assert assemble() still returns a valid result with no AGENTS.md message.
  </action>
  <verify>
    <automated>yarn testmain -- AIFetchlyContextLoader && yarn testmain -- AIChatContextAssembler.aifetchly</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/AIFetchlyContextLoader.test.ts exits 0
    - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts exits 0
    - `grep -c "class AIFetchlyContextStore" src/service/aifetchlyConfig/AIFetchlyContextStore.ts` returns 1
    - `grep -c "class AIFetchlyContextLoader" src/service/aifetchlyConfig/AIFetchlyContextLoader.ts` returns 1
    - `grep -c "class AIFetchlyRuntimeRegistrySync" src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` returns 1
    - `grep -c "class AIFetchlyConfigManager\|getAIFetchlyConfigManager" src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` returns at least 1
    - AIChatContextAssembler has the injection: `grep -c "aifetchlyContext\|AIFetchlyContextLoader" src/service/AIChatContextAssembler.ts` returns at least 2 (field + usage)
    - The injection try/catch degrades gracefully: `grep -c "aifetchly instructions injection failed" src/service/AIChatContextAssembler.ts` returns at least 1 (CTX-03 console.error marker)
    - The label does NOT claim priority: `! grep -i "higher priority\|override system\|above all" src/service/aifetchlyConfig/AIFetchlyContextLoader.ts` exits 0 (anti-prompt-injection wording)
    - The manager is fire-and-forget safe: the initialize method body contains a try/catch OR the caller (background.ts) uses .catch — verified in Task 3
    - getStatus watcher placeholder: `grep -c "not-started" src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` returns at least 1 (DX-02 phase-14 boundary)
  </acceptance_criteria>
  <done>
    AGENTS.md content flows from the loader snapshot -> context store -> context loader -> AIChatContextAssembler system message, in the correct order (CTX-01), with graceful degradation (CTX-03). The manager singleton owns lifecycle and exposes reload + status (DX-02 counts + watcher placeholder).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Built-in slash commands + dispatcher + SlashCommandModule (CMD-03, CMD-04, CMD-08, TRS-06, DX-02)</name>
  <files>
    src/service/slashCommands/builtinSlashCommands.ts,
    src/service/slashCommands/SlashCommandDispatcher.ts,
    src/modules/SlashCommandModule.ts,
    test/vitest/main/service/SlashCommandDispatcher.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §7.2 (built-in registration), §11.3 (dispatch discriminated union), §11.4 (each built-in's behavior), §15.3 (dispatch failure messages — exact strings), §14.1 (AI-enable gating matrix — which handlers need the gate)
    - src/service/slashCommands/CommandRegistry.ts (from Plan 02) — confirm register/getByName/listViews signatures
    - src/service/slashCommands/SlashCommandParser.ts (from Plan 02) — confirm parseSlashCommandInput signature
    - src/entityTypes/slashCommandTypes.ts (from Plan 02) — confirm SlashCommandDefinition + SlashCommandDispatchResponse type location (define the DispatchResponse HERE if not already in slashCommandTypes — design §11.3)
    - src/modules/AIChatV2Module.ts — sibling Module to mirror for SlashCommandModule structure (Modules sit between IPC handlers and services per CLAUDE.md three-layer rule)
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts (from Task 1 of this plan) — confirm getStatus() and reload() signatures that /status and /reload-config call
    - src/main-process/communication/ai-workspace-ipc.ts — the closest IPC analog (do NOT copy its per-handler Token check; TRS-05 Strategy A says dispatch is NOT gated at the IPC layer)
  </read_first>
  <behavior>
    - registerBuiltInSlashCommands(registry) registers exactly four commands: id "built-in:command:help", "built-in:command:clear", "built-in:command:status", "built-in:command:reload-config" with type "local" and enabled true
    - SlashCommandDispatcher.dispatch({rawInput:"/status"}) returns {status:true, action:"show_result", commandId:"built-in:command:status", content: <string containing command/diagnostic counts>}
    - SlashCommandDispatcher.dispatch({rawInput:"/help"}) returns {status:true, action:"show_result", content: <string listing command names>}
    - SlashCommandDispatcher.dispatch({rawInput:"/reload-config"}) triggers manager.reload() and returns {status:true, action:"show_result", content: <string with reloaded counts>}
    - SlashCommandDispatcher.dispatch({rawInput:"/clear"}) returns {status:true, action:"show_result", content:<guidance>} — phase 13 implementation returns a clear-guidance result; the renderer is responsible for the actual conversation clear via the EXISTING AI_CHAT_V2_CLEAR_CONVERSATION channel (do NOT duplicate clear logic)
    - SlashCommandDispatcher.dispatch({rawInput:"/unknown"}) returns {status:false, msg: <localized "Unknown slash command" string>} (CMD-08)
    - SlashCommandDispatcher.dispatch({rawInput:"/"}) returns {status:false, msg: <not-dispatchable hint>} (bare slash is suggest-only per CMD-02)
    - SlashCommandDispatcher.dispatch({rawInput:"hello"}) returns {status:false, msg: <not-a-command hint>} (not a command)
  </behavior>
  <action>
    Define SlashCommandDispatchResponse FIRST (add to src/entityTypes/slashCommandTypes.ts from Plan 02 via a small Edit — design §11.3): the discriminated union with submit_prompt / show_result / {status:false,msg} variants. Also add SlashCommandDispatchRequest { conversationId, rawInput }. (This Edit to slashCommandTypes.ts is the one file this task modifies that Plan 02 created — use Edit not Write.)

    File 1 — src/service/slashCommands/builtinSlashCommands.ts: export `function registerBuiltInSlashCommands(registry: CommandRegistry): void`.
      - Define the four SlashCommandDefinition objects per design §7.2 + §11.4 (id, name, description, aliases [], type "local", source "built-in", sourceId "built-in", sourceLabel "Built-in", requiresTrust false, enabled true).
      - /help description: "List available slash commands and their sources."
      - /clear description: "Clear the current conversation." (Renderer does the actual clear; the built-in returns guidance.)
      - /status description: "Show AiFetchly configuration status, counts, and diagnostics."
      - /reload-config description: "Rescan ~/.aifetchly and reload configuration."
      - Iterate and call registry.register(cmd) for each.

    File 2 — src/service/slashCommands/SlashCommandDispatcher.ts: export `class SlashCommandDispatcher`.
      - Constructor takes CommandRegistry + AIFetchlyConfigManager (dependency injection).
      - Async dispatch(input: { conversationId: string; rawInput: string }): Promise<SlashCommandDispatchResponse>.
      - Algorithm:
        1. parsed = parseSlashCommandInput(input.rawInput) (from Plan 02).
        2. If !parsed.isCommand: return {status:false, msg: <not-a-command>}.
        3. If parsed.isCommand && !parsed.name (bare "/"): return {status:false, msg: <suggest-only hint>}.
        4. cmd = registry.getByName(parsed.name). If null: return {status:false, msg: `Unknown slash command: /${parsed.name}`} (CMD-08 — use i18n key slashCommands.unknownCommand with {name} interpolation; the dispatcher reads the localized string via an injected i18n lookup or returns the English literal and the renderer localizes — pick English-literal here for simplicity and let Plan 05/04 handle UI localization; document the choice).
        5. If !cmd.enabled: return {status:false, msg: <disabled/trust hint>} (CMD-08).
        6. Switch on cmd.type:
           - "local": execute the built-in handler (a switch on cmd.id). Each handler returns a content string. Wrap in show_result. NO $ARGUMENTS substitution (phase 15 boundary — add a code comment here).
           - "prompt" (phase 15+): return {status:true, action:"submit_prompt", prompt: <body>, commandId: cmd.id}. Phase 13 has NO prompt commands registered, so this branch is unreachable in practice but must exist for the type contract. Include a comment: "Phase 15 expands prompt commands with $ARGUMENTS — not implemented in phase 13 per TRS-06." The literal $ARGUMENTS must NOT appear in any code path that runs — only in this boundary comment.
           - "skill" (phase 18): return {status:false, msg:"Skill commands are not yet supported."} (future).
      - Built-in handlers:
        - help: registry.listViews() -> format a human-readable list "Available commands:\n/help — ...\n/clear — ..." (renderer may also render this richly later).
        - status: manager.getStatus() -> format "AiFetchly configuration status:\nCommands: N\nDiagnostics: N\nLast reload: <timestamp>\nWatcher: not started (phase 14)" (DX-02).
        - reload-config: await manager.reload() -> format "Reloaded AiFetchly config:\nCommands: N\nDiagnostics: N" (DX-02 + success criterion 3).
        - clear: return a guidance content telling the renderer to invoke AI_CHAT_V2_CLEAR_CONVERSATION (do NOT clear here — the clear path lives in the existing module and is AI-gated downstream). The renderer intercepts show_result for /clear and performs the clear via the existing channel.
      - CRITICAL security: this file MUST NOT import child_process, MUST NOT call eval, MUST NOT call new Function(), MUST NOT spawn anything (TRS-06). The dispatch path is pure logic + registry + manager calls.

    File 3 — src/modules/SlashCommandModule.ts: business-logic Module per CLAUDE.md three-layer rule.
      - Holds dispatcher + registry + manager collaborators.
      - async listCommands(req: { conversationId?; query? }): returns SlashCommandListResponse = { status:true, commands: registry.listViews() filtered+ranked by query, diagnostics: manager.getStatus().diagnostics (or empty), msg:"" }. (Ranking uses CommandRegistry.rankSuggestions.)
      - async dispatch(req: SlashCommandDispatchRequest): returns SlashCommandDispatchResponse — delegates to dispatcher.dispatch.
      - async reloadConfig(req?: { conversationId? }): returns the reload summary.
      - async getStatus(req?: { conversationId? }): returns manager.getStatus().
      - NO direct DB access (CLAUDE.md rule — phase 13 has no DB anyway).

    Test — test/vitest/main/service/SlashCommandDispatcher.test.ts: table-driven per the <behavior> list. Mock the registry + manager (vitest mocks). Verify the discriminated union variant for each case. Verify unknown/disabled/not-a-command return {status:false,msg}.
  </action>
  <verify>
    <automated>yarn testmain -- SlashCommandDispatcher</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/SlashCommandDispatcher.test.ts exits 0
    - `grep -c "registerBuiltInSlashCommands" src/service/slashCommands/builtinSlashCommands.ts` returns at least 1
    - `grep -c "built-in:command:help\|built-in:command:clear\|built-in:command:status\|built-in:command:reload-config" src/service/slashCommands/builtinSlashCommands.ts` returns at least 4 (CMD-03 all four built-ins)
    - `grep -c "class SlashCommandDispatcher" src/service/slashCommands/SlashCommandDispatcher.ts` returns 1
    - `grep -c "show_result\|submit_prompt" src/service/slashCommands/SlashCommandDispatcher.ts` returns at least 2 (CMD-04 discriminated union)
    - `grep -c "Unknown slash command" src/service/slashCommands/SlashCommandDispatcher.ts` returns at least 1 (CMD-08 unknown message)
    - No $ARGUMENTS substitution logic in the dispatcher: `! grep -n '\$ARGUMENTS.*=' src/service/slashCommands/SlashCommandDispatcher.ts` exits 0 — the literal may appear ONLY in a boundary comment, never as an assignment or interpolation (TRS-06). More precisely: `grep -c '\$ARGUMENTS' src/service/slashCommands/SlashCommandDispatcher.ts` is at most 1 AND that single occurrence is inside a comment line starting with // or inside /* */.
    - No child_process / eval / Function() in dispatcher: `! grep -E "child_process|require\(['\"]child_process|new Function\(|[^_]eval\(" src/service/slashCommands/SlashCommandDispatcher.ts` exits 0 (TRS-06 — no execution path)
    - `grep -c "class SlashCommandModule" src/modules/SlashCommandModule.ts` returns 1 (three-layer Module exists)
    - SlashCommandModule does not import TypeORM: `! grep -E "typeorm|getRepository|DataSource" src/modules/SlashCommandModule.ts` exits 0 (CLAUDE.md three-layer rule)
  </acceptance_criteria>
  <done>
    Four built-in commands registered (CMD-03). Dispatcher returns the correct discriminated-union variant for built-in/unknown/not-a-command (CMD-04, CMD-08). /status and /reload-config surface counts and diagnostics (DX-02). SlashCommandModule sits between IPC and services per the three-layer rule. No execution path exists (TRS-06).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: IPC channels + slash-command-ipc handlers + startup hook (TRS-05 Strategy A)</name>
  <files>
    src/config/channellist.ts,
    src/main-process/communication/slash-command-ipc.ts,
    src/main-process/communication/index.ts,
    src/background.ts,
    test/vitest/main/ipc/slash-command-ipc.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §11.3 (channel constants list), §14.1 (AI-gating matrix — TRS-05), §17.1 (channel constants), §19.1 (startup sequence)
    - src/config/channellist.ts lines 260-290 (the AI Chat V2 channel block — mirror naming convention: "slash-command:*" and "aifetchly-config:*")
    - src/main-process/communication/_shared/registerValidatedHandler.ts — the FULL file. Confirm registerValidatedHandler (NOT registerAiValidatedHandler) is the wrapper for ALL phase 13 channels. The AI-gate matrix: list/dispatch/status/reload are ALL non-AI-gated at the IPC layer (TRS-05 Strategy A — verified A2: ai-chat-v2-ipc.ts handleStream gates USER_AI_ENABLED first, so prompt commands submitted via submit_prompt are gated downstream).
    - src/main-process/communication/ai-workspace-ipc.ts — the closest IPC analog for structure (ok()/denied() helpers, BrowserWindow param, registerXxxHandlers(win) export)
    - src/main-process/communication/index.ts — the handler aggregator; find where registerAIWorkspaceIpcHandlers(win) is called and add registerSlashCommandHandlers(win) adjacent
    - src/background.ts lines 350-360 — the SkillImportService.loadPersistedSkills() fire-and-forget pattern; add AIFetchlyConfigManager.initialize() alongside it
    - src/modules/SlashCommandModule.ts (from Task 2) — confirm method signatures the IPC layer calls
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Pitfall 1 (TRS-05 Strategy A vs B) and Pitfall 3 (preload dual whitelists — handled in Plan 04 but the channel NAMES originate here)
  </read_first>
  <behavior>
    - All five channel constants exist in channellist.ts with the exact string values from design §17.1
    - registerSlashCommandHandlers(win) registers FOUR handlers: list, dispatch, reload, status (the fifth channel AIFETCHLY_CONFIG_CHANGED is a main->renderer EVENT, not an invoke handler — it's sent via win.webContents.send, not ipcMain.handle)
    - list/dispatch/reload/status ALL use registerValidatedHandler (NOT registerAiValidatedHandler) — TRS-05 Strategy A
    - When USER_AI_ENABLED is "false", list/dispatch-of-built-in/status/reload STILL return status:true (NOT AI-gated) — TRS-05 matrix
    - Malformed request payloads return status:false with a zod-validation message (registerValidatedHandler does this automatically)
    - On a successful /reload-config via the IPC, the handler calls module.reloadConfig() AND emits AIFETCHLY_CONFIG_CHANGED via win.webContents.send so the renderer refreshes
    - background.ts calls registerBuiltInSlashCommands(registry) + registerSlashCommandHandlers(win) + AIFetchlyConfigManager.initialize().catch(...) at startup, non-blocking
  </behavior>
  <action>
    Modify src/config/channellist.ts (Edit — add after the AI_CHAT_V2 block around line 288):
      - export const SLASH_COMMAND_LIST = "slash-command:list";
      - export const SLASH_COMMAND_DISPATCH = "slash-command:dispatch";
      - export const AIFETCHLY_CONFIG_RELOAD = "aifetchly-config:reload";
      - export const AIFETCHLY_CONFIG_STATUS = "aifetchly-config:status";
      - export const AIFETCHLY_CONFIG_CHANGED = "aifetchly-config:changed";
      (Exact string values per design §17.1.)

    Create src/main-process/communication/slash-command-ipc.ts: export `function registerSlashCommandHandlers(win: BrowserWindow): void`.
      - Import registerValidatedHandler from _shared/registerValidatedHandler, lazySchema from utils/lazySchema, z from zod, the channel constants, SlashCommandModule, AIFetchlyConfigManager (or getAIFetchlyConfigManager), AIFETCHLY_CONFIG_CHANGED.
      - Define four lazySchema-wrapped zod schemas:
        - listSchema = z.object({ conversationId: z.string().optional(), query: z.string().optional() })
        - dispatchSchema = z.object({ conversationId: z.string(), rawInput: z.string() })
        - reloadSchema = z.object({ conversationId: z.string().optional() })
        - statusSchema = z.object({ conversationId: z.string().optional() })
      - registerValidatedHandler(SLASH_COMMAND_LIST, () => listSchema, async (input) => new SlashCommandModule().listCommands(input)) — wrap the schema factory per the existing pattern (the second arg is a factory `() => ZodType`, see registerValidatedHandler signature).
      - registerValidatedHandler(SLASH_COMMAND_DISPATCH, () => dispatchSchema, async (input) => new SlashCommandModule().dispatch(input)).
      - registerValidatedHandler(AIFETCHLY_CONFIG_RELOAD, () => reloadSchema, async (input) => { const result = await new SlashCommandModule().reloadConfig(input); win.webContents.send(AIFETCHLY_CONFIG_CHANGED, JSON.stringify({ source:"user", summary: result })); return result; }).
      - registerValidatedHandler(AIFETCHLY_CONFIG_STATUS, () => statusSchema, async (input) => new SlashCommandModule().getStatus(input)).
      - Add a header JSDoc: "TRS-05 Strategy A: NONE of these handlers use registerAiValidatedHandler. Dispatch returns submit_prompt for prompt commands; the renderer submits via AI_CHAT_V2_STREAM which already enforces USER_AI_ENABLED (verified at ai-chat-v2-ipc.ts handleStream line 385-394). List/status/reload are not AI-serving and must NOT be gated."
      - Guard against win being destroyed before sending (if (win && !win.isDestroyed()) win.webContents.send(...)).

    Modify src/main-process/communication/index.ts (Edit — add inside registerCommunicationIpcHandlers(win), adjacent to registerAIWorkspaceIpcHandlers(win)):
      - Import registerSlashCommandHandlers.
      - Call registerSlashCommandHandlers(win); after the workspace handlers.
      - Also call registerBuiltInSlashCommands on the singleton CommandRegistry here (or inside registerSlashCommandHandlers — pick one place; recommend inside registerSlashCommandHandlers so the IPC file owns all slash-command setup).

    Modify src/background.ts (Edit — around line 357, alongside SkillImportService.loadPersistedSkills()):
      - Import getAIFetchlyConfigManager from the Plan 01 manager file.
      - After registerCommunicationIpcHandlers(win), add: getAIFetchlyConfigManager().initialize().catch((err: unknown) => console.warn("[Startup] AIFetchly config scan failed:", err));
      - Fire-and-forget, never blocks app launch (Pitfall 6).

    Test — test/vitest/main/ipc/slash-command-ipc.test.ts:
      - Mirror the registerValidatedHandler.test.ts mock pattern.
      - Mock SlashCommandModule methods + Token.getValue (for the TRS-05 matrix).
      - Cases:
        1. list with USER_AI_ENABLED="false" returns status:true (NOT gated).
        2. dispatch /status with USER_AI_ENABLED="false" returns status:true + action show_result (built-in not gated).
        3. dispatch /help with USER_AI_ENABLED="false" returns status:true + action show_result.
        4. reload with USER_AI_ENABLED="false" returns status:true.
        5. status with USER_AI_ENABLED="false" returns status:true.
        6. Malformed dispatch payload (missing rawInput) returns status:false (zod validation).
      - Mock BrowserWindow.webContents.send to verify AIFETCHLY_CONFIG_CHANGED is emitted on reload.
  </action>
  <verify>
    <automated>yarn testmain -- slash-command-ipc</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/ipc/slash-command-ipc.test.ts exits 0
    - `grep -c "SLASH_COMMAND_LIST\|SLASH_COMMAND_DISPATCH\|AIFETCHLY_CONFIG_RELOAD\|AIFETCHLY_CONFIG_STATUS\|AIFETCHLY_CONFIG_CHANGED" src/config/channellist.ts` returns at least 5 (all five channels defined)
    - `grep -c "registerValidatedHandler" src/main-process/communication/slash-command-ipc.ts` returns at least 4 (four handlers using the non-AI wrapper — TRS-05 Strategy A)
    - `grep -c "registerAiValidatedHandler" src/main-process/communication/slash-command-ipc.ts` returns 0 (CRITICAL — TRS-05: NONE of the slash/config handlers use the AI-gated wrapper)
    - `grep -c "registerSlashCommandHandlers" src/main-process/communication/index.ts` returns at least 1 (handler registered in the aggregator)
    - `grep -c "AIFetchlyConfigManager\|getAIFetchlyConfigManager" src/background.ts` returns at least 1 (startup hook present)
    - Startup is fire-and-forget: `grep -c "\.catch" src/background.ts` is >= the count before this task (the .catch is added on the initialize() call — Pitfall 6)
    - The TRS-05 IPC test explicitly asserts USER_AI_ENABLED="false" + status:true for list/dispatch-builtin/status/reload (the test encodes the gating matrix)
  </acceptance_criteria>
  <done>
    Five IPC channels exist; four invoke handlers + one main->renderer event. ALL use registerValidatedHandler (TRS-05 Strategy A — no AI gate at the IPC layer). Startup fires the config scan fire-and-forget. The TRS-05 gating matrix is encoded as a passing test.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → slash-command:dispatch | Raw user text (composer input) crosses into main process. The parser + registry + dispatcher validate and classify it. |
| Disk (~/.aifetchly) → main process (via Plan 01 loader → manager) | User-authored AGENTS.md content becomes a system message in the AI request. |
| Main process → renderer (AIFETCHLY_CONFIG_CHANGED) | Config-change notifications carry counts + diffs (metadata only, no raw file bodies). |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-13-03 | Spoofing (prompt injection) | AIChatContextAssembler AGENTS.md injection (CTX-01) | high | mitigate | Label injected blocks as "User global AiFetchly instructions..." — NEVER word as higher-priority than the app system prompt (design §12.2). Verified by grep gate on the label wording. |
| T-13-04 | Abuse (AI-feature bypass) | slash-command IPC handlers (TRS-05) | high | mitigate | Strategy A: dispatch uses registerValidatedHandler (NOT registerAiValidatedHandler); prompt commands return submit_prompt and the renderer submits via AI_CHAT_V2_STREAM which gates USER_AI_ENABLED (verified at ai-chat-v2-ipc.ts:385-394). list/status/reload intentionally NOT gated. TRS-05 matrix encoded as test. |
| T-13-05 | Code Execution | SlashCommandDispatcher (TRS-06) | high | mitigate | No $ARGUMENTS substitution (phase 15 boundary comment). No child_process/eval/Function() imports. Phase 13 built-ins are local text only. Verified by grep. |
| T-13-Block | Denial of Service | background.ts startup scan (Pitfall 6) | medium | mitigate | AIFetchlyConfigManager.initialize() called fire-and-forget with .catch logging. App launch never awaits it. Assembler tolerates empty cache (returns []). |
| T-13-Leak | Info Disclosure | AIFETCHLY_CONFIG_CHANGED event payload | low | mitigate | Payload carries counts + diff metadata only (commandCount, diagnosticCount, etc.); never raw file bodies or prompt content. SlashCommandView already strips body. |
| T-13-SC | Tampering | Package installs | n/a | accept | Zero new packages. |
</threat_model>

<verification>
- yarn testmain -- AIFetchlyContextLoader exits 0 (CTX-01 cache + CTX-03 degradation)
- yarn testmain -- AIChatContextAssembler.aifetchly exits 0 (CTX-01 ordering)
- yarn testmain -- SlashCommandDispatcher exits 0 (CMD-03, CMD-04, CMD-08, DX-02)
- yarn testmain -- slash-command-ipc exits 0 (TRS-05 matrix, zod validation)
- yarn testmain (full suite, typecheck-gated) — run before handing off to Plan 04
- tsc --noEmit passes
- No registerAiValidatedHandler in slash-command-ipc.ts (TRS-05 grep gate)
- No child_process/eval in SlashCommandDispatcher.ts (TRS-06 grep gate)
</verification>

<success_criteria>
- AGENTS.md is injected into the assembled AI message array at the correct position with the correct label, and degrades gracefully on failure.
- The config manager singleton owns scan/apply/reload/status; startup is fire-and-forget.
- Four built-in commands are registered and dispatch correctly via the discriminated union.
- /status and /reload-config surface the right counts (DX-02).
- TRS-05 Strategy A is implemented and verified — no AI gate on list/dispatch/status/reload at the IPC layer; prompt commands gated downstream by AI_CHAT_V2_STREAM.
- TRS-06 is maintained — no execution path, no $ARGUMENTS substitution, boundary comment marks phase 15.
</success_criteria>

<output>
Create `.planning/phases/13-global-context-and-built-in-slash-commands/13-03-SUMMARY.md` when done.

## Artifacts this phase produces (Plan 03 contribution)

**New services (src/service/aifetchlyConfig/):**
- AIFetchlyContextStore class (replaceInstructions/removeSource/getGlobalInstructions/getWorkspaceInstructions)
- AIFetchlyContextLoader class (getInstructionBlocks + formatInstructionBlock)
- AIFetchlyRuntimeRegistrySync class (applySnapshot/removeSource)
- AIFetchlyConfigManager singleton (initialize/reload/getStatus/getInstructionBlocks)

**New services (src/service/slashCommands/):**
- registerBuiltInSlashCommands function (builtinSlashCommands.ts)
- SlashCommandDispatcher class (dispatch -> SlashCommandDispatchResponse)

**New Module:**
- SlashCommandModule (src/modules/SlashCommandModule.ts) — listCommands/dispatch/reloadConfig/getStatus

**New IPC:**
- registerSlashCommandHandlers(win) (src/main-process/communication/slash-command-ipc.ts)
- Five channel constants in src/config/channellist.ts: SLASH_COMMAND_LIST, SLASH_COMMAND_DISPATCH, AIFETCHLY_CONFIG_RELOAD, AIFETCHLY_CONFIG_STATUS, AIFETCHLY_CONFIG_CHANGED

**Type additions (src/entityTypes/slashCommandTypes.ts — via Edit):**
- SlashCommandDispatchRequest, SlashCommandDispatchResponse (the discriminated union)

**Modified files:**
- src/main-process/communication/index.ts (registerSlashCommandHandlers call)
- src/background.ts (startup initialize() fire-and-forget)
- src/service/AIChatContextAssembler.ts (AGENTS.md injection try/catch)

**Tests:**
- AIFetchlyContextLoader.test.ts
- AIChatContextAssembler.aifetchly.test.ts (extends existing assembler test)
- SlashCommandDispatcher.test.ts
- slash-command-ipc.test.ts (TRS-05 gating matrix)
</output>
