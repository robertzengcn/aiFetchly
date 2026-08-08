# Phase 16: Dynamic Agents - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 14 new/modified + 12 test files
**Analogs found:** 14 / 14 (every file has an in-tree analog from Phase 13/14/15)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/service/AgentDefinitionRegistry.ts` (REFACTOR) | service / in-memory registry | CRUD + source-replace | `src/service/slashCommands/CommandRegistry.ts` | exact (structural clone; only rank order + entry type differ) |
| `src/service/slashCommands/agentFrontmatter.ts` (NEW) | utility / pure validator | transform (draft → definition) | `src/service/slashCommands/promptCommandFrontmatter.ts:97-242` (`buildPromptCommandDefinition`) | exact |
| `src/service/aifetchlyConfig/availableAgentsBlock.ts` (NEW, optional) | utility / pure assembler | transform (registry list → system-message block) | `AIChatContextAssembler` instruction-block formatting (`formatInstructionBlock`) | role-match |
| `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` (MODIFY — add `tryReadAgentFiles`) | service / global scanner | file-I/O + transform | same file `tryReadCommandFiles` (lines 270-408) | exact (self-mirror) |
| `src/service/workspaceWatch/WorkspaceConfigScanner.ts` (MODIFY — add `tryReadAgentFiles`) | service / worker scanner | file-I/O + snapshot | same file `tryReadCommandFiles` (lines 410-521) | exact (self-mirror) |
| `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` (MODIFY) | service / trust-filter apply | event-driven (snapshot → registry) | same file `applyWorkspaceSnapshot` (lines 103-116) | exact (self-mirror) |
| `src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` (MODIFY — own `AgentDefinitionRegistry` + `getAgentRegistry()`) | service / owner | lifecycle | same file `getCommandRegistry()` (line 225) | exact (self-mirror) |
| `src/service/AgentRuntime.ts` (MODIFY — line 71 resolution swap) | service / runtime | request-response (dispatch) | same line (`defModule.getActiveById` → registry-first + DB fallback) | exact (self-mirror, in-place) |
| `src/service/agentTools/runSubagentTool.ts` (MODIFY) | service / tool def | request-response | same file `PARAMETERS.properties.agentId` (lines 52-56) + `execute` (line 127) | exact (self-mirror) |
| `src/service/AIChatContextAssembler.ts` (MODIFY) | service / context assembler | streaming / message injection | same file AGENTS.md injection try/catch (lines 163-179) | exact (self-mirror) |
| `src/service/slashCommands/SlashCommandDispatcher.ts` (MODIFY — add `built-in:command:agents` case) | service / dispatcher | request-response | same file `built-in:command:status` branch (lines 174-182) | exact (self-mirror) |
| `src/service/slashCommands/builtinSlashCommands.ts` (MODIFY — register `/agents`) | config / registration | static | same file `/status` definition (lines 52-63) | exact (self-mirror) |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` (MODIFY — chrome strings only if needed) | config / i18n | static | existing `slashCommands`/`aifetchlyConfig` groups | role-match |
| `src/service/AgentToolPolicyService.ts` (NO CHANGE — verify dynamic defs flow through) | service / runtime policy | transform (allowlist intersection) | itself (unchanged, fed dynamic definitions) | exact (verify-only) |

### Test files (mirror library)

| New/Modified Test | Mirrors | Match |
|-------------------|---------|-------|
| `test/vitest/main/service/AgentDefinitionRegistry.test.ts` (NEW) | `test/vitest/main/service/CommandRegistry.test.ts` | exact |
| `test/vitest/main/service/agentFrontmatter.test.ts` (NEW) | `test/vitest/main/service/promptCommandFrontmatter.test.ts` | exact |
| `test/vitest/main/service/AIFetchlyConfigLoader.agents.test.ts` (NEW) | `test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts` | exact |
| `test/vitest/main/service/buildWorkspaceAgentDefinitions.test.ts` (NEW) | `test/vitest/main/service/workspaceWatch/buildWorkspaceCommandDefinitions.test.ts` | exact |
| `test/vitest/utilitycode/agentDefinitionRegistry.test.ts` (REWRITE) | itself + `CommandRegistry.test.ts` shape | exact |
| `test/vitest/utilitycode/agentToolPolicyService.test.ts` (EXTEND) | itself | exact |
| `test/vitest/main/service/WorkspaceConfigScanner.test.ts` (EXTEND) | itself — add agent cases mirroring command cases | exact |
| `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts` (EXTEND) | itself — add `agents: true/false` cases a–d | exact |
| `test/vitest/main/service/SlashCommandDispatcher.test.ts` (EXTEND) | itself — add `/agents` branch test | exact |
| `test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts` (EXTEND) | itself — add available-agents block injection + ordinal test | exact |
| `test/vitest/main/service/runSubagentTool.test.ts` (EXTEND) | itself — assert updated `agentId` description + scoped-ID resolution | exact |
| `test/vitest/main/service/AgentRuntime.test.ts` (EXTEND) | itself — registry-first with DB fallback stays green | exact |
| `test/vitest/main/service/WorkerNoDbBoundary.test.ts` (RE-RUN) | itself — grep gate must pass after `WorkspaceConfigScanner.tryReadAgentFiles` | exact |

## Pattern Assignments

### `src/service/AgentDefinitionRegistry.ts` (REFACTOR — object literal → class)

**Analog:** `src/service/slashCommands/CommandRegistry.ts` (lines 26-158). Class with three indexes (`byId`, `byName`, `sourceIndex`); every mutator ends with `rebuildNameIndex()`; `replaceSource(sourceId, entries)` atomically reconciles add/change/delete/rename.

**Imports pattern** (CommandRegistry.ts:16-20):
```typescript
import type {
  AgentDefinitionView,
  AgentSource,        // NEW — define alongside (union: "built-in" | "user" | "workspace" | "plugin")
} from "@/entityTypes/agentTypes";
```

**SOURCE_RANK — D-Precedence (load-bearing comment REQUIRED)** (clone of CommandRegistry.ts:26-31 with divergent order):
```typescript
// Lookup-order ranks. Lower rank wins. Enforces AGT-01:
//   built-in (0) > user (1) > workspace (2) > plugin (3).
// DELIBERATELY DIVERGES from CommandRegistry.SOURCE_RANK (commands are
// built-in > workspace > user > plugin). Agents follow AGT-01 / tech-design
// §7.4. DO NOT "normalize" this to match commands — agent tests assert the
// user-wins-over-workspace order.
const SOURCE_RANK: Readonly<Record<AgentSource, number>> = Object.freeze({
  "built-in": 0,
  user: 1,
  workspace: 2,
  plugin: 3, // reserved for Phase 18 (PRD §7.4)
});
```

**Core: `replaceSource` atomic reconciliation** (clone of CommandRegistry.ts:83-105, substitute `agents: readonly AgentDefinitionView[]`):
```typescript
replaceSource(sourceId: string, agents: readonly AgentDefinitionView[]): void {
  const existing = this.sourceIndex.get(sourceId);
  if (existing) {
    for (const id of existing) this.byId.delete(id);
  }
  const next = new Set<string>();
  for (const a of agents) {
    const copy: AgentDefinitionView = { ...a };   // defensive copy (immutability)
    this.byId.set(copy.id, copy);
    next.add(copy.id);
  }
  this.sourceIndex.set(sourceId, next);
  this.rebuildNameIndex();
}
```

**Built-in seeding must stay** (preserve the existing `listBuiltIns()` shape — `AgentDefinitionModule.ensureBuiltIns` calls it once at startup):
```typescript
listBuiltIns(): AgentDefinitionView[] {
  return BUILT_INS.map((d) => ({ ...d }));   // keep — consumed by ensureBuiltIns
}
```
The class must ALSO register built-ins into itself at construction (or via `registerBuiltIns()` called by the manager before `ensureBuiltIns()`) so the registry-first lookup in `AgentRuntime.runSync` can find `agent-lead-researcher` (RESEARCH Pitfall 1).

**Core: precedence-aware `getById` + `rebuildNameIndex`** (clone CommandRegistry.ts:108-151; agents resolve by ID, not by name, but the name index is still needed for shadowing semantics in `/agents` listing). Defensive copies on every accessor (CLAUDE.md immutability rule).

**Delta for THIS phase:** (1) Rank order diverges (D-Precedence). (2) Entry type is `AgentDefinitionView` not `SlashCommandDefinition`. (3) No `getByName`/`listViews` (agents are dispatched by ID, not invoked by name; `/agents` lists from `list()` directly). (4) Reserve the `plugin` rank so Phase 18 just fills it in.

---

### `src/service/slashCommands/agentFrontmatter.ts` (NEW — `buildAgentDefinition`)

**Analog:** `src/service/slashCommands/promptCommandFrontmatter.ts:97-242` (`buildPromptCommandDefinition`). Pure function, never throws, fixed-order validation (first violation wins), returns discriminated union.

**Result union pattern** (clone promptCommandFrontmatter.ts:97-116 fail shape):
```typescript
export type AgentDefinitionBuildResult =
  | { readonly ok: true; readonly definition: AgentDefinitionView }
  | { readonly ok: false; readonly diagnostic: AIFetchlyConfigDiagnostic };

// fail() helper identical to promptCommandFrontmatter.ts:105-116
const fail = (code: string, message: string): AgentDefinitionBuildResult => ({
  ok: false,
  diagnostic: {
    severity: "warning",
    source: sourceMeta.source,
    sourceId: sourceMeta.sourceId,
    filePath,
    code,
    message,
    recoverable: true,
  },
});
```

**Validation order (clone promptCommandFrontmatter.ts:126-224 with agent fields):**
1. `name` present + matches `COMMAND_NAME_REGEX` (`AIFetchlyConfigConstants`) → else `agent-name-invalid`
2. `description` present + non-empty
3. `description.length <= AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength` (500) → else `frontmatter-invalid`
4. `tools` optional, default `[]`; must be string array; each entry non-empty string → else `frontmatter-invalid` (mirror aliases handling at promptCommandFrontmatter.ts:168-204)
5. `maxToolCalls` (optional) parses as positive int → else `frontmatter-invalid`
6. `maxRuntimeMs` (optional) parses as positive int → else `frontmatter-invalid`
7. body non-empty after trim → else `frontmatter-invalid`

**Success- shape (clone promptCommandFrontmatter.ts:226-241):**
```typescript
const definition: AgentDefinitionView = {
  id: `${sourceMeta.sourceId}:agent:${name}`,   // stable scoped ID — mirrors `${sourceMeta.sourceId}:command:${name}`
  name,
  description,
  version: 1,
  systemPrompt: body,
  allowedTools: Array.from(tools),
  mode: "specialist",          // dynamic agents are specialists
  maxToolCalls: maxToolCalls ?? 8,      // built-in default
  maxRuntimeMs: maxRuntimeMs ?? 180000, // built-in default
  maxContinueCalls: 8,
  outputSchema: {},            // EMPTY — structured authoring deferred (Pitfall 4)
  status: "active",
};
return { ok: true, definition };
```

**D-ToolDiagnostic integration (non-fatal warning)** — keep validator pure; emit warnings from the LOADER (RESEARCH Pattern 2 recommendation):
```typescript
// In the loader, AFTER result.ok:
const result = buildAgentDefinition(draft, sourceMeta);
if (result.ok) {
  definitions.push(result.definition);
  for (const warn of detectUnknownTools(result.definition, registeredToolNames)) {
    diagnostics.push(warn);   // severity: "warning", code: "agent-tool-invalid", recoverable: true
  }
} else {
  diagnostics.push(result.diagnostic);
}
```
Pass `registeredToolNames: ReadonlySet<string>` from `SkillRegistry.getAllToolFunctions()` at the call site — keeps the validator pure (pitfall: late-loaded MCP/skill tools produce stale warnings until next rescan; explicitly accepted by D-ToolDiagnostic).

**Delta for THIS phase:** adds `tools` string-array + `maxToolCalls`/`maxRuntimeMs` numeric bounds on top of the Phase 15 validator shape; adds the `detectUnknownTools` warning emitter (loader-side, not validator-side).

---

### `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` (MODIFY — add `tryReadAgentFiles`)

**Analog:** same file `tryReadCommandFiles` (lines 270-408). Same structure: readdir → per-file path-safety (`resolveConfigRelativePath`, CFG-05) → count cap (`maxAgentsPerSource`) → size cap (`agentMdBytes` = 128 * 1024 per CFG-04) → restricted-frontmatter parse (`parseRestrictedFrontmatter` — NO parser change; `tools` rides the existing `arrays` Map) → validator (`buildAgentDefinition`) → push into `agents`/`diagnostics`.

**Per-file scaffold** (clone tryReadCommandFiles:296-407, swap capability + caps):
```typescript
private async tryReadAgentFiles(
  files: AIFetchlyConfigFileSnapshot[],
  agents: AgentDefinitionView[],
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<void> {
  const source = "user" as const;
  const sourceId = "user";
  const agentsDir = path.join(this.rootPath, AGENTS_DIR);
  // ... readdir with ENOENT-as-happy-path (line 280-287)
  // ... sourceMeta = { source, sourceId, sourceLabel: "User", requiresTrust: false }
  // ... for each entry: path-safety → count cap (maxAgentsPerSource) →
  //     size cap (agentMdBytes) → parseRestrictedFrontmatter →
  //     buildAgentDefinition({...scalars, ...arrays}, body, relativePath, sourceMeta)
}
```

**Constants to use (already defined — verify, do NOT redefine):**
- `AIFETCHLY_CONFIG_LIMITS.agentMdBytes = 128 * 1024` (CFG-04, AIFetchlyConfigConstants.ts:36)
- `AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource = 100` (line 44)
- `COMMAND_NAME_REGEX` (for agent name validation inside the validator)
- `AGENTS_DIR` constant — define if not present (mirror `COMMANDS_DIR`)

**Delta for THIS phase:** new private method + an `agents: AgentDefinitionView[]` accumulator threaded into `scanGlobalRoot` and returned in the snapshot (the snapshot type already has `agents: readonly unknown[]` — aifetchlyConfigTypes.ts:99).

---

### `src/service/workspaceWatch/WorkspaceConfigScanner.ts` (MODIFY — add `tryReadAgentFiles`)

**Analog:** same file `tryReadCommandFiles` (lines 410-521). CRITICAL: this runs in the WORKER process — worker-no-DB rule (CLAUDE.md, WAT-02). Produces RAW drafts only (frontmatter + body + hash); validation happens in main process.

**Worker draft shape** (mirror `WorkspaceCommandDraft` at line 506-515):
```typescript
// Worker produces this; main-process loader converts via buildAgentDefinition
commands.push({
  id: `workspace:${workspaceId}:command:${name.replace(/\.md$/i, "")}`,
  source: "workspace",
  sourceId,
  relativePath,
  frontmatter: { ...scalars, ...arrays },
  body: parsed ? parsed.body : text,
  contentHash,
});
// → Phase 16: introduce an analogous WorkspaceAgentDraft type, push to an
//   agents: WorkspaceAgentDraft[] accumulator, return in snapshot.agents
```

**The `agents: []` slot already exists** (line 166 — `agents: []` in the returned snapshot). Phase 16 populates it instead of hardcoding empty.

**Worker-no-DB guard (Pitfall 6):** keep `tryReadAgentFiles` self-contained — import ONLY `parseRestrictedFrontmatter`, `resolveConfigRelativePath`, `AIFETCHLY_CONFIG_LIMITS`, `diagnostic`, `ioDiagnostic`. NO `@/modules`, `@/model`, `@/service/AgentDefinitionRegistry`, or Electron imports. The `WorkerNoDbBoundary.test.ts` grep gate MUST still pass.

**Delta for THIS phase:** new `tryReadAgentFiles` private method + `WorkspaceAgentDraft` type + thread an `agents` accumulator through `scanAifetchlyRoot` → return in snapshot. NO validation, NO registry mutation in the worker. The main-process loader (`AIFetchlyConfigLoader` or a new main-side workspace-agent validator) runs `buildAgentDefinition` on the drafts before calling `replaceSource`.

---

### `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` (MODIFY — extend trust filter)

**Analog:** same file `applyWorkspaceSnapshot` (lines 103-116). One-line filter widening.

**Current shape (verified):**
```typescript
applyWorkspaceSnapshot(
  snapshot: AIFetchlyConfigSnapshot,
  trust: AIFetchlySourceTrust
): AIFetchlySnapshotApplyResult {
  const filtered: AIFetchlyConfigSnapshot = {
    ...snapshot,
    instructions: trust.instructions ? snapshot.instructions : [],
    commands: trust.commands ? snapshot.commands : [],
  };
  return this.applySnapshot(filtered);
}
```

**Delta for THIS phase (one line — Pattern 4):**
```typescript
const filtered: AIFetchlyConfigSnapshot = {
  ...snapshot,
  instructions: trust.instructions ? snapshot.instructions : [],
  commands: trust.commands ? snapshot.commands : [],
  agents: trust.agents ? snapshot.agents : [],   // ← Phase 16 adds this
};
```

**Constructor widening:** accept an `AgentDefinitionRegistry` alongside the existing `CommandRegistry`. `applySnapshot` gains `this.agentRegistry.replaceSource(snapshot.sourceId, agents)` (cast through `unknown` to `readonly AgentDefinitionView[]` — mirror how commands are cast at line 165 of WorkspaceConfigScanner).

**`AIFetchlySourceTrust.agents` already exists** (aifetchlyConfigTypes.ts:141) — no type change needed.

---

### `src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` (MODIFY — own + expose agent registry)

**Analog:** same file `getCommandRegistry()` (line 225).

**Current pattern (verified):**
```typescript
getCommandRegistry(): CommandRegistry {
  return this.registry;
}
```

**Delta for THIS phase:** add a private `agentRegistry: AgentDefinitionRegistry` field (instantiated alongside `this.registry`), call `agentRegistry.registerBuiltIns()` (or equivalent) at startup, expose via:
```typescript
getAgentRegistry(): AgentDefinitionRegistry {
  return this.agentRegistry;
}
```
Also bump `agentCount` in the status result (line 162 currently hardcodes `agentCount: 0` — wire it to `this.agentRegistry.list().length`).

---

### `src/service/AgentRuntime.ts` (MODIFY — line 71 resolution swap)

**Analog:** same line (the DB-backed lookup being replaced). RESEARCH Recommendation (a): registry-first with DB fallback.

**Current (verified at lines 63, 67-77):**
```typescript
private readonly defModule = new AgentDefinitionModule();

async runSync(request: RunAgentRequest, deps?: AgentRuntimeDeps): Promise<AgentResult> {
  const definition = await this.defModule.getActiveById(request.agentId);
  if (!definition) {
    return this.fail(request, `Unknown or disabled agent: ${request.agentId}`);
  }
  // ... runtime loop consumes definition via narrow interface
}
```

**Delta for THIS phase (Pattern from RESEARCH Code Examples:508-525):**
```typescript
async runSync(request: RunAgentRequest, deps?: AgentRuntimeDeps): Promise<AgentResult> {
  let definition: AgentDefinitionView | null =
    this.agentRegistry.getById(request.agentId);   // in-memory, precedence-aware, scoped IDs
  if (!definition) {
    // Built-in execution metadata path (DB seeded by ensureBuiltIns) + test-mock path.
    definition = await this.defModule.getActiveById(request.agentId);
  }
  if (!definition) {
    return this.fail(request, `Unknown or disabled agent: ${request.agentId}`);
  }
  // ... rest unchanged — definition is the same AgentDefinitionView shape
}
```
`this.agentRegistry` must be injected (singleton from `AIFetchlyConfigManager.getAgentRegistry()` or via `AgentRuntimeRegistry` wiring). Pitfall 1: the registry MUST contain built-ins (registered at startup) or this lookup misses them — DB fallback is belt-and-suspenders, not the primary path.

---

### `src/service/agentTools/runSubagentTool.ts` (MODIFY)

**Analog:** same file `PARAMETERS.properties.agentId` (lines 52-56) and `execute` (line 127).

**Current description (verified — the text to replace per D-AgentIDs):**
```typescript
agentId: {
  type: "string",
  description: "Built-in agent ID to run, e.g. 'agent-lead-researcher'. Must be active.",
},
```

**Delta for THIS phase:** update the description to describe BOTH ID forms + point to the context block (D-AgentIDs / Pitfall 5). Drop "Built-in agent ID" wording. Example replacement text:
```typescript
description:
  "Agent ID to run, exactly as it appears in the 'Available agents' block of the system message. " +
  "Bare built-in IDs (e.g. 'agent-lead-researcher') or scoped dynamic IDs " +
  "('user:agent:<name>' or 'workspace:<workspaceId>:agent:<name>') are accepted. " +
  "Unknown IDs return an error — do not guess or abbreviate.",
```
Optional: tighten the `args.agentId as string` cast on line 127 to a typeof-string guard (mirrors promptCommandFrontmatter.ts:121-124 `asString` helper).

**No execute-logic change required** — dispatch-time `getById` returning null is the rejection mechanism (D-AgentIDs). No parameter-level zod regex (RESEARCH Open Question 2 — resolved NO).

---

### `src/service/slashCommands/SlashCommandDispatcher.ts` (MODIFY — add `/agents` case)

**Analog:** same file `built-in:command:status` branch (lines 174-182).

**Verified template (lines 174-182):**
```typescript
case "built-in:command:status": {
  const s = this.manager.getStatus();
  return {
    status: true,
    action: "show_result",
    commandId,
    content: renderStatus(s),
  };
}
```

**Delta for THIS phase (clone the shape):**
```typescript
case "built-in:command:agents": {
  const agents = this.manager.getAgentRegistry().list();
  return {
    status: true,
    action: "show_result",
    commandId,
    content: renderAgentsList(agents),   // pure helper, sorted by precedence
  };
}
```
`renderAgentsList` sorts built-in → user → workspace → plugin and formats `<id> — <name>: <description> [<source badge>]`. Source badges reuse Phase 13 `slashCommands` i18n keys (no new badge strings).

---

### `src/service/slashCommands/builtinSlashCommands.ts` (MODIFY — register `/agents`)

**Analog:** same file `/status` definition (lines 52-63).

**Verified template:**
```typescript
{
  id: "built-in:command:status",
  name: "status",
  description: "Show AiFetchly configuration status, counts, and diagnostics.",
  aliases: [],
  type: "local",
  source: "built-in",
  sourceId: "built-in",
  sourceLabel: "Built-in",
  requiresTrust: false,
  enabled: true,
},
```

**Delta for THIS phase (append to `BUILT_IN_COMMANDS`):**
```typescript
{
  id: "built-in:command:agents",
  name: "agents",
  description: "List available AiFetchly agents (built-in and dynamic).",
  aliases: [],
  type: "local",
  source: "built-in",
  sourceId: "built-in",
  sourceLabel: "Built-in",
  requiresTrust: false,
  enabled: true,
},
```

---

### `src/service/AIChatContextAssembler.ts` (MODIFY — inject "Available agents" block)

**Analog:** same file AGENTS.md injection try/catch (lines 163-179).

**Verified template (lines 163-179):**
```typescript
try {
  const blocks = await this.aifetchlyContext.getInstructionBlocks({
    conversationId: input.conversationId,
    mode: input.mode,
  });
  for (const block of blocks) {
    messages.push({
      role: "system",
      content: AIFetchlyContextLoader.formatInstructionBlock(block),
    });
  }
} catch (err) {
  console.error("[ai-chat-context] aifetchly instructions injection failed:", err);
}
```

**Delta for THIS phase (Pattern 5 — graceful degradation, inject immediately AFTER the AGENTS.md block, before durable memory):**
```typescript
try {
  const agents = this.manager.getAgentRegistry().list();
  if (agents.length > 0) {
    messages.push({
      role: "system",
      content: buildAvailableAgentsBlock(agents),  // pure helper — recommend src/service/aifetchlyConfig/availableAgentsBlock.ts
    });
  }
} catch (err) {
  console.error("[ai-chat-context] available agents injection failed:", err);
}
```
Cache the block; rebuild on `AIFETCHLY_CONFIG_CHANGED` (mirror the instruction-cache pattern from Phase 13-03a). The block format mirrors slash-suggestions metadata: ID + one-line description + source (so the model can copy the exact ID into `run_subagent` — ties to D-AgentIDs).

---

### `src/views/lang/{en,zh,es,fr,de,ja}.ts` (MODIFY — only if a new chrome string is needed)

**Analog:** existing `slashCommands`/`aifetchlyConfig` i18n groups.

**Delta for THIS phase:** agent `name`/`description`/prompt body are author DATA (not app strings). The ONLY chrome strings that might need adding: a `/agents` list header IF the renderer renders one. If added, mirror the existing `slashCommands.*` keys across ALL 6 lang files (en, zh, es, fr, de, ja). Prefer reusing Phase 13 source-badge keys (`Built-in`/`User`/`Workspace`) — D-AgentsList says no new badge strings.

---

## Shared Patterns

### Source-aware registry with atomic `replaceSource`
**Source:** `src/service/slashCommands/CommandRegistry.ts:26-158`
**Apply to:** `AgentDefinitionRegistry.ts` (refactor), `AIFetchlyRuntimeRegistrySync.ts` (applySnapshot), `AIFetchlyConfigManager.ts` (ownership).
Clone the three-index + rebuildNameIndex + replaceSource shape. The ONLY intentional divergence is `SOURCE_RANK` (D-Precedence: user=1, workspace=2 — opposite of commands). A load-bearing comment on the rank map is REQUIRED (a future reader WILL try to "fix" it).

### Trust filter at the apply boundary
**Source:** `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:103-116`
**Apply to:** all workspace-sourced capabilities (agents here, hooks Phase 17, skills Phase 18).
```typescript
agents: trust.agents ? snapshot.agents : [],
```
One line, atomic, BEFORE `applySnapshot` mutates any registry.

### Restricted frontmatter parse (CFG-07 — security-critical)
**Source:** `src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts:56-146` (`parseRestrictedFrontmatter`)
**Apply to:** every `*.md` capability file (commands Phase 15, agents Phase 16, hooks Phase 17).
NO parser change for Phase 16 — the `tools` field rides the existing `arrays: Map<string, readonly string[]>` return. The parser already rejects `!` tag directives, nested maps, quoted multiline, and stray list items (RCE mitigation).

### Diagnostic shape
**Source:** `AIFetchlyConfigDiagnostic` + `AIFETCHLY_DIAGNOSTIC_CODES` (`AIFetchlyConfigConstants.ts:89-106`)
**Apply to:** every loader/scanner failure path.
Codes already reserved: `agent-name-invalid`, `agent-tool-invalid`. Use `severity: "warning", recoverable: true` for non-fatal cases (oversized file, unknown tool). Mirror the `fail()` helper at promptCommandFrontmatter.ts:105-116.

### Single-owner validator (first-violation-wins)
**Source:** `src/service/slashCommands/promptCommandFrontmatter.ts:97-242`
**Apply to:** `agentFrontmatter.ts` (`buildAgentDefinition`).
Pure function, never throws, fixed-order checks, discriminated-union return. The schema is encoded exactly once and consumed by both global and workspace loaders.

### Built-in local command dispatch
**Source:** `src/service/slashCommands/SlashCommandDispatcher.ts:152-202` (`dispatchLocal` switch on `commandId`, returns `action: "show_result"`)
**Apply to:** `/agents` branch.
Non-AI-gated (uses `SLASH_COMMAND_DISPATCH` channel via `registerValidatedHandler`, NOT `registerAiValidatedHandler` — TRS-05). No new IPC channel, no new preload whitelist.

### Graceful-degradation context injection
**Source:** `src/service/AIChatContextAssembler.ts:163-179` (try/catch + `console.error`)
**Apply to:** "Available agents" block.
Failure to assemble the block MUST NEVER break the AI chat — degrade to no-injection + `console.error`. Mirrors the AGENTS.md injection pattern.

### Immutability / defensive copies
**Source:** `CommandRegistry.ts:55-122` (every accessor returns `{ ...found }` or `.map((c) => ({ ...c }))`)
**Apply to:** `AgentDefinitionRegistry` (all accessors), validator return shape, loader accumulator.
The existing `listBuiltIns().map((d) => ({ ...d }))` pattern is preserved (AgentDefinitionRegistry.ts:63).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every file has an exact in-tree analog from Phase 13/14/15. Phase 16 is pure pattern-cloning — no new architectural surfaces. |

The planner can rely entirely on the analogs above. RESEARCH.md §Code Examples and §Architecture Patterns remain authoritative for any shape question not answered here.

## Metadata

**Analog search scope:** `src/service/slashCommands/`, `src/service/aifetchlyConfig/`, `src/service/workspaceWatch/`, `src/service/`, `src/service/agentTools/`, `src/entityTypes/`, `test/vitest/main/service/`, `test/vitest/utilitycode/`
**Files scanned (analog verification):** 11 source files + 3 type/constants files read in their relevant ranges; 0 re-reads.
**Pattern extraction date:** 2026-07-08
**Research provenance:** RESEARCH.md §Architectural Responsibility Map (lines 77-91), §Architecture Patterns (lines 189-422), §Code Examples (lines 487-595), §Validation Architecture (lines 673-688) — all analog file:line references verified against live source in this pass.
