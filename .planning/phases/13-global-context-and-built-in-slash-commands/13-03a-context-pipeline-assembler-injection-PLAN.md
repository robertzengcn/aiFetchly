---
phase: 13-global-context-and-built-in-slash-commands
plan: 03a
type: execute
wave: 2
depends_on: [01, 02]
files_modified:
  - src/service/aifetchlyConfig/AIFetchlyContextStore.ts
  - src/service/aifetchlyConfig/AIFetchlyContextLoader.ts
  - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
  - src/service/AIChatContextAssembler.ts
  - test/vitest/main/service/AIFetchlyContextLoader.test.ts
  - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts
autonomous: true
requirements: [CTX-01, CTX-03]
must_haves:
  truths:
    - "Global AGENTS.md content appears in AIChatContextAssembler.assemble() output as a system message AFTER the base system prompt + custom directive and BEFORE durable memory (CTX-01)"
    - "The injected block is labeled clearly (e.g. 'User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:') without implying priority over the app system prompt (CTX-01, CTX-03 — prompt-injection resistance)"
    - "An in-memory context cache (AIFetchlyContextStore) avoids per-request file reads; a cache miss returns an empty list, never blocks chat (CTX-03)"
    - "Read failures in the injection path degrade to no-injection + console.error, never throw or break chat (CTX-03 — mirror the existing custom-directive try/catch at AIChatContextAssembler lines 116-128)"
    - "AIFetchlyConfigManager.getStatus() returns watcherState reported as 'not started (phase 14)' (DX-02 placeholder — the watcher is phase 14)"
  artifacts:
    - "src/service/aifetchlyConfig/AIFetchlyContextStore.ts — class with replaceInstructions/removeSource/getGlobalInstructions/getWorkspaceInstructions"
    - "src/service/aifetchlyConfig/AIFetchlyContextLoader.ts — getInstructionBlocks() + formatInstructionBlock() consumed by AIChatContextAssembler"
    - "src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts — applySnapshot/removeSource wiring loader->registry->cache"
    - "src/service/aifetchlyConfig/AIFetchlyConfigManager.ts — singleton orchestrator (initialize/reload/getStatus/getInstructionBlocks)"
    - "AIChatContextAssembler.assemble() injects global AGENTS.md block between the active-workspace block and durable memory"
  key_links:
    - "AIFetchlyConfigManager.initialize() -> AIFetchlyConfigLoader.scanGlobalRoot() -> AIFetchlyRuntimeRegistrySync.applySnapshot() -> CommandRegistry.replaceSource() + AIFetchlyContextStore.replaceInstructions()"
    - "AIChatContextAssembler.assemble() -> AIFetchlyContextLoader.getInstructionBlocks() -> AIFetchlyContextStore.getGlobalInstructions() (cached, no fs read per request)"
  prohibitions:
    - "No direct DB access (CLAUDE.md three-layer rule; phase 13 has zero DB)"
    - "No worker/childprocess files (phase 14 boundary — the watcher worker does not exist yet)"
    - "No synchronous fs in the initialize path (Pitfall 6 — fire-and-forget with .catch logging; the background.ts .catch wiring lives in Plan 03b Task 2)"
    - "The injected label MUST NOT use wording that claims priority over the app system prompt (anti-prompt-injection, design §12.2)"
---

<objective>
Build the context-pipeline half of the orchestrator wave: the in-memory context cache, the assembler-facing context loader, the runtime registry sync, and the singleton config manager. Then wire global AGENTS.md injection into AIChatContextAssembler at the correct position with graceful degradation.

Purpose: Fulfill CTX-01 (AGENTS.md injected after base prompt, before durable memory) and CTX-03 (cache miss / read failure never blocks chat). This is split out from the former Plan 03 so the delicate assembler insertion lands in a focused, low-file-count plan. Plan 03b consumes this plan's AIFetchlyConfigManager singleton.
Output: Four new main-process service files, one edit to AIChatContextAssembler.ts, and two Vitest test files.
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
@src/service/AIChatContextAssembler.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Context store + context loader + runtime registry sync + config manager singleton (CTX-03, DX-02 placeholder)</name>
  <files>
    src/service/aifetchlyConfig/AIFetchlyContextStore.ts,
    src/service/aifetchlyConfig/AIFetchlyContextLoader.ts,
    src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts,
    src/service/aifetchlyConfig/AIFetchlyConfigManager.ts,
    test/vitest/main/service/AIFetchlyContextLoader.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §8.1 (RuntimeRegistrySync responsibilities), §8.2 (trust filtering — phase 13 is global-only so trust=true always), §8.3 (AIFetchlyContextStore shape), §12.1 (injection point + formatInstructionBlock), §12.2 (label wording — anti-prompt-injection), §12.3 (cache miss -> empty list, never block), §19.1 (startup sequence)
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (from Plan 01) — confirm scanGlobalRoot() signature and AIFetchlyConfigSnapshot shape
    - src/service/slashCommands/CommandRegistry.ts (from Plan 02) — confirm replaceSource signature for the sync layer
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Pattern 2 (Graceful Degradation)
  </read_first>
  <behavior>
    - AIFetchlyContextStore.replaceInstructions("user", [blockA]) then getGlobalInstructions() returns [blockA]
    - AIFetchlyContextStore.replaceInstructions("user", [blockB]) replaces (not appends) — getGlobalInstructions() returns [blockB] only
    - AIFetchlyContextStore.removeSource("user") -> getGlobalInstructions() returns []
    - AIFetchlyContextLoader.getInstructionBlocks() BEFORE manager.initialize() returns [] (cache miss, never throws — CTX-03)
    - AIFetchlyContextLoader.getInstructionBlocks() AFTER a snapshot with AGENTS.md returns exactly one block with label starting "User global AiFetchly instructions"
    - AIFetchlyConfigManager.initialize() called twice in a row does not crash (idempotent or guarded)
    - AIFetchlyConfigManager.reload() re-scans and the next getInstructionBlocks() reflects the new content
    - AIFetchlyConfigManager.getStatus() returns an object with commandCount, diagnosticCount, lastReloadAt, and watcherState === "not-started" (phase 14 placeholder — DX-02)
  </behavior>
  <action>
    Create four new service files. All in the main-process layer.

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
      - async reload(): re-scan + re-apply. Returns a summary {commandCount, diagnosticCount, lastReloadAt, diff}. Emits AIFETCHLY_CONFIG_CHANGED via a registered callback (the IPC layer in Plan 03b wires the actual BrowserWindow.send; here just expose an onConfigChanged callback registration).
      - getStatus(): synchronous, returns {commandCount, agentCount, hookCount, skillCount, diagnosticCount, lastReloadAt, watcherState: "not-started", source: "user"}. watcherState is hardcoded "not-started" in phase 13 (the watcher is phase 14 — assumption A1).
      - getInstructionBlocks(input): delegates to contextLoader.getInstructionBlocks (so the assembler only depends on the loader, not the manager).

    Test — test/vitest/main/service/AIFetchlyContextLoader.test.ts: covers the <behavior> bullets (cache miss, populated block, label format, try/catch degradation by injecting a throwing store, idempotent initialize, reload reflects new content, getStatus watcher placeholder).
  </action>
  <verify>
    <automated>yarn testmain -- AIFetchlyContextLoader</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/AIFetchlyContextLoader.test.ts exits 0
    - `grep -c "class AIFetchlyContextStore" src/service/aifetchlyConfig/AIFetchlyContextStore.ts` returns 1
    - `grep -c "class AIFetchlyContextLoader" src/service/aifetchlyConfig/AIFetchlyContextLoader.ts` returns 1
    - `grep -c "class AIFetchlyRuntimeRegistrySync" src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` returns 1
    - `grep -c "class AIFetchlyConfigManager\|getAIFetchlyConfigManager" src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` returns at least 1
    - getStatus watcher placeholder: `grep -c "not-started" src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` returns at least 1 (DX-02 phase-14 boundary)
    - The label does NOT claim priority: `! grep -i "higher priority\|override system\|above all" src/service/aifetchlyConfig/AIFetchlyContextLoader.ts` exits 0 (anti-prompt-injection wording)
    - The manager initialize() body is fire-and-forget safe (try/catch OR documented caller .catch — Plan 03b wires the actual .catch in background.ts)
  </acceptance_criteria>
  <done>
    Context store caches instructions per source; context loader exposes a never-throwing getInstructionBlocks; runtime registry sync wires snapshots to the registry + cache; the manager singleton owns idempotent initialize/reload/getStatus with the phase-14 watcher placeholder. Plan 03b consumes the manager for /status, /reload-config, and the startup hook.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: AIChatContextAssembler AGENTS.md injection (CTX-01 ordering, CTX-03 graceful degradation)</name>
  <files>
    src/service/AIChatContextAssembler.ts,
    test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts
  </files>
  <read_first>
    - src/service/AIChatContextAssembler.ts — the FULL file (read it to find the exact insertion point between the active-workspace try/catch ending at line ~150 and the durable-memory block starting at line ~155). Mirror the existing try/catch + console.error degradation pattern.
    - test/vitest/main/service/AIChatContextAssembler.test.ts — the existing assembler test header (mock pattern for systemSettings + durableMemory; add AIFetchlyContextLoader mock the same way)
    - src/service/aifetchlyConfig/AIFetchlyContextLoader.ts (from Task 1 of this plan) — confirm getInstructionBlocks + formatInstructionBlock signatures
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Code Examples (AGENTS.md injection point) — verbatim try/catch shape to replicate
  </read_first>
  <behavior>
    - AIChatContextAssembler.assemble() with a populated AGENTS.md block produces a messages array where the AGENTS.md system message comes AFTER the base system prompt and the custom directive, and BEFORE the durable-memory system message (CTX-01 ordering)
    - AIChatContextAssembler.assemble() with AIFetchlyContextLoader throwing still returns a valid messages array (the AGENTS.md try/catch degrades to no-injection — CTX-03)
    - AIChatContextAssembler.assemble() with an empty AGENTS.md cache (no global instructions) returns the same messages array as before this change (no spurious system message added)
  </behavior>
  <action>
    Modify src/service/AIChatContextAssembler.ts: inject the AGENTS.md block.
      - Add a private collaborator: `private readonly aifetchlyContext = new AIFetchlyContextLoader();` near the other collaborators (line ~58-63). (Constructor injection is fine too if it improves testability — match the existing style which uses field initializers.)
      - Inside assemble(), between the active-workspace try/catch (ends line ~150) and the durable-memory block (starts line ~155 with `let injectionEnabled = true`), insert a new try/catch block (mirror lines 116-128 exactly):
        - try: const blocks = await this.aifetchlyContext.getInstructionBlocks({ conversationId, mode }); for each block, messages.push({ role: "system", content: AIFetchlyContextLoader.formatInstructionBlock(block) }).
        - catch (err): console.error("[ai-chat-context] aifetchly instructions injection failed:", err); do NOT push, do NOT rethrow (CTX-03 graceful degradation).
      - This places global AGENTS.md AFTER the base prompt + custom directive + active workspace, and BEFORE durable memory + compact + recent history — exactly the CTX-01 ordering.

    Test — test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts: extends the existing assembler test mock pattern. Stub AIFetchlyContextLoader.getInstructionBlocks to return a known block; call assemble(); assert the AGENTS.md system message exists AND its index in messages is > base-system-prompt index AND < durable-memory index (CTX-01 ordering). Add a second case where the loader throws and assert assemble() still returns a valid result with no AGENTS.md message. Add a third case where getInstructionBlocks returns [] and assert no AGENTS.md system message is present (no regression on the empty path).
  </action>
  <verify>
    <automated>yarn testmain -- AIChatContextAssembler.aifetchly</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts exits 0
    - AIChatContextAssembler has the injection: `grep -c "aifetchlyContext\|AIFetchlyContextLoader" src/service/AIChatContextAssembler.ts` returns at least 2 (field + usage)
    - The injection try/catch degrades gracefully: `grep -c "aifetchly instructions injection failed" src/service/AIChatContextAssembler.ts` returns at least 1 (CTX-03 console.error marker)
  </acceptance_criteria>
  <done>
    AGENTS.md content flows from the context loader into the assembled AI message array at the correct position (CTX-01), with graceful degradation on failure (CTX-03). The empty-cache path is a no-op (no regression).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Disk (~/.aifetchly) → main process (via Plan 01 loader → manager) | User-authored AGENTS.md content becomes a system message in the AI request. |
| Manager → assembler → AI request | The injected system message is untrusted-as-model-input; labeling must not imply it overrides the app system prompt. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-13-03 | Spoofing (prompt injection) | AIChatContextAssembler AGENTS.md injection (CTX-01) | high | mitigate | Label injected blocks as "User global AiFetchly instructions..." — NEVER word as higher-priority than the app system prompt (design §12.2). Verified by grep gate on the label wording in Task 1 acceptance criteria. |
| T-13-Cache | Denial of Service | AIFetchlyContextLoader per-request file reads | medium | mitigate | In-memory AIFetchlyContextStore caches instructions; assembler reads from cache, never fs. Cache miss returns [] (CTX-03). Read failures degrade to no-injection + console.error, never throw. |
| T-13-SC | Tampering | Package installs | n/a | accept | Zero new packages. |
</threat_model>

<verification>
- yarn testmain -- AIFetchlyContextLoader exits 0 (CTX-03 cache + degradation + DX-02 watcher placeholder)
- yarn testmain -- AIChatContextAssembler.aifetchly exits 0 (CTX-01 ordering + CTX-03 degradation + empty-cache no-op)
- tsc --noEmit passes (the vitest typecheck gate runs it automatically)
</verification>

<success_criteria>
- AGENTS.md is injected into the assembled AI message array at the correct position with the correct label, and degrades gracefully on failure (CTX-01, CTX-03).
- The config manager singleton owns scan/apply/reload/status and is fire-and-forget safe for the background.ts wiring Plan 03b adds.
- The anti-prompt-injection label wording is verified by grep.
</success_criteria>

<output>
Create `.planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md` when done.

## Artifacts this plan produces (Plan 03a contribution)

**New services (src/service/aifetchlyConfig/):**
- AIFetchlyContextStore class (replaceInstructions/removeSource/getGlobalInstructions/getWorkspaceInstructions)
- AIFetchlyContextLoader class (getInstructionBlocks + formatInstructionBlock)
- AIFetchlyRuntimeRegistrySync class (applySnapshot/removeSource)
- AIFetchlyConfigManager singleton (initialize/reload/getStatus/getInstructionBlocks)

**Modified files:**
- src/service/AIChatContextAssembler.ts (AGENTS.md injection try/catch between active-workspace and durable-memory)

**Tests:**
- AIFetchlyContextLoader.test.ts
- AIChatContextAssembler.aifetchly.test.ts (extends existing assembler test)
</output>
