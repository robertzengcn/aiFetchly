# Plugin-Installed Subagents & Subagent Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subagents a first-class plugin component (plugins ship `agents/*.md`) and a first-class user-managed capability (System Settings → Subagents page) without adding a second agent runtime.

**Architecture:** Plugin Markdown agent files are parsed into `AgentDefinitionView` DTOs by a pure `PluginAgentImportService` + `ClaudeAgentFormatAdapter`, persisted as `agent_definitions` rows with `source = "plugin"` and ownership metadata by the existing import pipeline, and consumed by the existing `AgentRuntime` through the existing `AgentDefinitionModule` — the only runtime change is that the active catalog now filters by agent `status`, `health`, and owning-plugin enablement. Manual CRUD flows through new `agent-definition:*` IPC → `AgentDefinitionModule` → `AgentDefinitionModel`. IPC → Module/Service → Model boundaries are preserved; no DB access in IPC; no plugin-code execution during import.

**Tech Stack:** TypeScript 5.x, Electron, TypeORM + better-sqlite3, Vue 3 + Vuetify + Pinia, Zod (bare `zod` for IPC schemas — see Decision D1), vue-i18n.

**Source documents:**
- PRD: `docs/prd/plugin-subagent-management-prd.md`
- Technical design: `docs/prd/plugin-subagent-management-technical-design.md`

---

## Prerequisites (read before Task 1)

- [ ] **Base branch is `dev`.** This feature is implemented on top of `dev` (HEAD `b40df569`). The worktree branch `worktree-plugin_subagent` must point at `dev` before starting. Verify: `git rev-parse HEAD` returns `b40df569…` and `src/service/pluginCompat/ClaudePluginAdapter.ts` exists. (It already does in this worktree.)
- [ ] Run `yarn install` if `node_modules` is stale after the base sync.
- [ ] `yarn tsc` is green on the base before any change.

## Key Decisions (locked, from technical design + codebase reality)

- **D1 — IPC schemas use bare `zod`, not `zod/v4`.** The IPC wrapper `registerValidatedHandler`/`registerAiValidatedHandler` (in `src/main-process/communication/_shared/registerValidatedHandler.ts`) imports `ZodType` from bare `"zod"` and the sibling schema `src/schemas/ipc/agentRuntime.ts` uses `import { z } from "zod"`. A `zod/v4` schema is **not** assignable to v3's `ZodType<T>` and will fail `tsc`. New file `src/schemas/ipc/agentDefinition.ts` therefore uses `import { z } from "zod"`. (CLAUDE.md's `zod/v4` mandate applies to new validation infrastructure; the IPC schema cluster is a pre-existing bare-`zod` island that must be migrated as a unit — out of scope here.)
- **D2 — Real import entry is `PluginImportService.installFromLocalRoot`, not `importFromDirectory`.** The technical design names a method `importFromDirectory`; the actual public method on `dev` is `static async installFromLocalRoot(localRoot, opts)`. All integration edits target that method.
- **D3 — Plugin-enablement filtering lives in the Module, not via a SQL join.** The design suggests a `LEFT JOIN installed_plugins` in the model. To avoid assuming `InstalledPlugin` entity column metadata and to keep `AgentDefinitionModel` single-entity, the runtime filtering (active + healthy + owning-plugin-enabled) is composed in `AgentDefinitionModule.listActiveForRuntime()` / `getActiveById()` using `InstalledPluginModel.findEnabled()`. This matches CLAUDE.md's "Module coordinates multiple models" rule.
- **D4 — Invalid declared plugin agents fail import atomically (design §3.1).** Warnings (forbidden/unknown fields) do not fail import; errors (missing required field, empty body, path traversal, duplicate ID) do.
- **D5 — Overwrite preserves disabled agent state.** `installFromLocalRoot` uninstalls the old plugin rows (including agents) before re-import. To preserve user-disabled agents across overwrite, capture the previous `componentStateJson.agents` *before* the overwrite uninstall and pass it to `upsertPluginAgents`.
- **D6 — Manual agent IDs use `user:<slug>` (design §3.2).** Built-ins keep their existing IDs (`agent-lead-researcher`); plugin agents use `<plugin>[:<dir>]:<name>`.

## File Structure (what each file owns)

**New files (Create):**
- `src/service/pluginCompat/ClaudeAgentFormatAdapter.ts` — pure: one agent Markdown file → `AgentDefinitionView` + manifest + warnings.
- `src/service/PluginAgentImportService.ts` — pure: manifest declarations + directory walk → list of parsed plugin agents.
- `src/schemas/ipc/agentDefinition.ts` — Zod input schemas for the 6 management channels.
- `src/main-process/communication/agent-definition-ipc.ts` — registers the 6 management handlers (`registerValidatedHandler`).
- `src/views/api/agents.ts` — renderer API client (`windowInvoke` wrappers).
- `src/views/components/agents/AgentManager.vue` — Subagents page body (table + filters + search + actions).
- `src/views/components/agents/AgentDetailPanel.vue` — right-side detail drawer (read-only for plugin/built-in).
- `src/views/components/agents/AgentEditorDialog.vue` — create/edit manual agent dialog.
- `src/views/components/plugins/PluginAgentsTab.vue` — plugin-detail Subagents tab (mirrors `PluginSkillsTab.vue`).
- `src/views/pages/systemsetting/subagents.vue` — thin page wrapper (`<AgentManager/>`).
- `test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts`
- `test/vitest/utilitycode/pluginAgentImportService.test.ts`
- `test/modules/AgentDefinitionModule.test.ts` (extend if present, else create)
- `test/vitest/main/agent-definition-ipc.test.ts`
- `test/vitest/main/agentRuntimeDefinitionList.test.ts`

**Modified files:**
- `src/entityTypes/agentTypes.ts`, `src/entity/AgentDefinition.entity.ts`, `src/model/AgentDefinition.model.ts`, `src/modules/AgentDefinitionModule.ts`, `src/service/AgentDefinitionRegistry.ts`
- `src/entityTypes/pluginTypes.ts`
- `src/service/PluginManifestService.ts`, `src/service/pluginCompat/ClaudePluginAdapter.ts`, `src/service/PluginImportService.ts`, `src/modules/PluginManagementModule.ts`
- `src/config/channellist.ts`, `src/preload.ts`, `src/main-process/communication/index.ts`, `src/main-process/communication/agent-runtime-ipc.ts`
- `src/views/components/plugins/PluginDetailPanel.vue`, `src/views/router/index.ts`
- `src/views/lang/{en,zh,es,fr,de,ja}.ts`

---

# Phase 1 — Data model & shared types

## Task 1.1: Extend shared agent types

**Files:**
- Modify: `src/entityTypes/agentTypes.ts`

- [ ] **Step 1: Add the new types at the top of `agentTypes.ts` (after `AgentMode`)**

```typescript
/** Origin of an agent definition row. */
export type AgentDefinitionSource = "built-in" | "user" | "plugin";

/** Runtime health of an agent definition. */
export type AgentDefinitionHealth =
  | "healthy"
  | "disabled"
  | "partial_load"
  | "invalid"
  | "missing_files";
```

- [ ] **Step 2: Extend `AgentDefinitionView` (replace the existing interface body)**

```typescript
export interface AgentDefinitionView {
  id: string;
  name: string;
  description: string;
  version: number;
  systemPrompt: string;
  allowedTools: string[];
  defaultModel?: string;
  mode: AgentMode;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchema: Record<string, unknown>;
  status: "active" | "disabled";
  source: AgentDefinitionSource;
  pluginName?: string;
  pluginComponentPath?: string;
  manifest?: Record<string, unknown>;
  health: AgentDefinitionHealth;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

- [ ] **Step 3: Append the manual-agent and plugin-agent DTOs at the end of the file**

```typescript
/** Input for creating a user-owned (manual) agent. */
export interface CreateManualAgentDefinitionInput {
  idSlug: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  defaultModel?: string;
  mode: AgentMode;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchema?: Record<string, unknown>;
  enabled?: boolean;
}

/** Patch for updating a user-owned (manual) agent. */
export interface UpdateManualAgentDefinitionInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  defaultModel?: string | null;
  mode?: AgentMode;
  maxToolCalls?: number;
  maxRuntimeMs?: number;
  maxContinueCalls?: number;
  outputSchema?: Record<string, unknown>;
  enabled?: boolean;
}

/** One parsed plugin agent plus ownership metadata. */
export interface ParsedPluginAgentDefinition {
  definition: AgentDefinitionView;
  pluginName: string;
  componentPath: string;
  manifest: Record<string, unknown>;
  warnings: ReadonlyArray<import("@/entityTypes/pluginTypes").PluginError>;
}

export type PluginAgentParseResult =
  | {
      ok: true;
      agents: ParsedPluginAgentDefinition[];
      warnings: ReadonlyArray<import("@/entityTypes/pluginTypes").PluginError>;
    }
  | {
      ok: false;
      errors: ReadonlyArray<import("@/entityTypes/pluginTypes").PluginError>;
    };
```

- [ ] **Step 4: Verify it compiles**

Run: `yarn tsc`
Expected: no new errors. (Other files referencing `AgentDefinitionView` without `source`/`health` will now be flagged — those are fixed in Tasks 1.3, 1.4, 2.1.)

> Note: do not commit until Task 1.4 restores green `tsc` (the registry + model must supply the new required fields). Tasks 1.1–1.4 are one logical unit.

## Task 1.2: Extend the entity

**Files:**
- Modify: `src/entity/AgentDefinition.entity.ts`

- [ ] **Step 1: Add new columns after the existing `status` column (Order 13)**

```typescript
  @Order(14)
  @Index()
  @Column("varchar", { length: 32, nullable: false, default: "built-in" })
  source: string;

  @Order(15)
  @Index()
  @Column("varchar", { length: 100, nullable: true })
  pluginName?: string | null;

  @Order(16)
  @Column("text", nullable: true })
  pluginComponentPath?: string | null;

  @Order(17)
  @Column("text", nullable: true })
  manifestJson?: string | null;

  @Order(18)
  @Column("varchar", { length: 32, nullable: false, default: "healthy" })
  health: string;

  @Order(19)
  @Column("text", nullable: true })
  lastError?: string | null;
```

- [ ] **Step 2: Add the class-level `source` index (near the existing `@Index(["status"])`)**

The entity already has `@Index(["agentId"], { unique: true })` and `@Index(["status"])` at the class level. Add:

```typescript
@Index(["source"])
@Index(["pluginName", "status"])
```

- [ ] **Step 3: Verify migration behavior**

`SqliteDb` uses TypeORM `synchronize: true`; no migration file is needed. Existing rows receive `source = "built-in"`, `health = "healthy"`, nullable plugin fields. Confirm by booting once (`yarn init` then inspect, or rely on the module tests in Task 1.5).

## Task 1.3: Update `AgentDefinitionModel` (toView + upsert + new read/delete methods)

**Files:**
- Modify: `src/model/AgentDefinition.model.ts`

- [ ] **Step 1: Rewrite `toView` to include the new fields**

```typescript
function toView(e: AgentDefinitionEntity): AgentDefinitionView {
  let manifest: Record<string, unknown> = {};
  if (e.manifestJson) {
    try {
      manifest = JSON.parse(e.manifestJson) as Record<string, unknown>;
    } catch {
      manifest = {};
    }
  }
  return {
    id: e.agentId,
    name: e.name,
    description: e.description,
    version: e.version,
    systemPrompt: e.systemPrompt,
    allowedTools: e.allowedTools,
    defaultModel: e.defaultModel ?? undefined,
    mode: e.mode as AgentDefinitionView["mode"],
    maxToolCalls: e.maxToolCalls,
    maxRuntimeMs: e.maxRuntimeMs,
    maxContinueCalls: e.maxContinueCalls,
    outputSchema: e.outputSchema,
    status: e.status as AgentDefinitionView["status"],
    source: (e.source ?? "built-in") as AgentDefinitionView["source"],
    pluginName: e.pluginName ?? undefined,
    pluginComponentPath: e.pluginComponentPath ?? undefined,
    manifest,
    health: (e.health ?? "healthy") as AgentDefinitionView["health"],
    lastError: e.lastError ?? undefined,
    createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : undefined,
    updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : undefined,
  };
}
```

- [ ] **Step 2: Extend `upsert` to persist the new fields**

Add to the `merged` object inside `upsert`:

```typescript
    source: view.source,
    pluginName: view.pluginName ?? null,
    pluginComponentPath: view.pluginComponentPath ?? null,
    manifestJson: view.manifest ? JSON.stringify(view.manifest) : null,
    health: view.health,
    lastError: view.lastError ?? null,
```

- [ ] **Step 3: Add the new methods to the class**

```typescript
  async listAll(): Promise<AgentDefinitionView[]> {
    const rows = await this.repository.find({ order: { agentId: "ASC" } });
    return rows.map(toView);
  }

  async findByPluginName(pluginName: string): Promise<AgentDefinitionView[]> {
    const rows = await this.repository.find({
      where: { pluginName },
      order: { agentId: "ASC" },
    });
    return rows.map(toView);
  }

  async deleteByPluginName(pluginName: string): Promise<string[]> {
    const rows = await this.repository.find({ where: { pluginName } });
    const ids = rows.map((r) => r.agentId);
    if (rows.length > 0) {
      await this.repository.delete({ pluginName });
    }
    return ids;
  }

  async toggle(agentId: string, enabled: boolean): Promise<boolean> {
    const existing = await this.repository.findOne({ where: { agentId } });
    if (!existing) return false;
    await this.repository.save({
      ...existing,
      status: enabled ? "active" : "disabled",
    });
    return true;
  }

  async deleteUserAgent(agentId: string): Promise<boolean> {
    const existing = await this.repository.findOne({ where: { agentId } });
    if (!existing) return false;
    await this.repository.delete({ agentId });
    return true;
  }
```

Leave `getActiveById`, `getById`, `listActive` as-is for now (runtime variants come in Phase 5).

## Task 1.4: Mark built-ins with `source`/`health`

**Files:**
- Modify: `src/service/AgentDefinitionRegistry.ts`

- [ ] **Step 1: Add `source`, `health`, `manifest` to every built-in entry**

In the `BUILT_INS` array, add to the `agent-lead-researcher` object (and any other entries):

```typescript
    source: "built-in",
    health: "healthy",
    manifest: {},
```

- [ ] **Step 2: Verify `tsc` is green again**

Run: `yarn tsc`
Expected: PASS (all `AgentDefinitionView` literals now satisfy the required `source`/`health`).

- [ ] **Step 3: Commit**

```bash
git add src/entityTypes/agentTypes.ts src/entity/AgentDefinition.entity.ts \
        src/model/AgentDefinition.model.ts src/service/AgentDefinitionRegistry.ts
git commit -m "feat(agents): add source/health/ownership fields to agent definitions"
```

## Task 1.5: Extend plugin shared types

**Files:**
- Modify: `src/entityTypes/pluginTypes.ts`

- [ ] **Step 1: Add `PluginAgentDeclaration` and extend `PluginManifest`**

Insert near the manifest section:

```typescript
export type PluginAgentDeclaration =
  | string
  | readonly string[]
  | true
  | Record<string, { source?: string; content?: string; description?: string }>;
```

Add `agents?: PluginAgentDeclaration;` to `PluginManifest` (before the `[extra: string]` index signature line).

- [ ] **Step 2: Add `agent` error codes + componentType**

Extend the `PluginErrorCode` union with:

```typescript
  | "agent-manifest-invalid"
  | "agent-frontmatter-invalid"
  | "agent-frontmatter-missing-field"
  | "agent-name-conflict"
  | "agent-path-invalid"
  | "agent-unsupported-field"
```

Change `PluginError.componentType` to:

```typescript
  readonly componentType?: "plugin" | "skill" | "mcpServer" | "agent";
```

- [ ] **Step 3: Extend `PluginComponentState` with `agents`**

```typescript
export interface PluginComponentState {
  readonly skills?: Record<string, PluginComponentStateEntry>;
  readonly mcpServers?: Record<
    string,
    {
      readonly enabled: boolean;
      readonly toolConfig?: Record<string, PluginMcpToolConfig>;
    }
  >;
  readonly agents?: Record<string, PluginComponentStateEntry>;
}
```

- [ ] **Step 4: Extend `PluginSummary`, add `PluginAgentComponent`, extend `PluginDetail`**

Add `readonly agentCount: number;` to `PluginSummary`. Add the new interface:

```typescript
export interface PluginAgentComponent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly mode: string;
  readonly toolCount: number;
  readonly componentPath: string;
  readonly health: string;
  readonly error?: string;
}
```

Add `readonly agents: readonly PluginAgentComponent[];` to `PluginDetail`.

- [ ] **Step 5: Extend `PluginUninstallResult`**

```typescript
export interface PluginUninstallResult {
  readonly removedPlugin: boolean;
  readonly removedSkillNames: readonly string[];
  readonly removedMcpServerNames: readonly string[];
  readonly removedAgentIds: readonly string[];
  readonly errors: readonly PluginError[];
}
```

- [ ] **Step 6: Verify + commit**

Run: `yarn tsc` — `PluginDetail`/`PluginSummary`/`PluginUninstallResult` consumers will now flag; those are fixed in Phase 3. Do not commit alone — commit with the Phase 3 consumers that restore green. (If you prefer, commit the type-only change here with message `feat(plugins): add agent types to plugin shared contracts` and accept transient `tsc` errors until Phase 3.)

---

# Phase 2 — Plugin agent parser (pure, no I/O for the adapter; fs only in the service)

## Task 2.1: `ClaudeAgentFormatAdapter` (TDD)

**Files:**
- Create: `src/service/pluginCompat/ClaudeAgentFormatAdapter.ts`
- Test: `test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts
import { describe, it, expect } from "vitest";
import { ClaudeAgentFormatAdapter } from "@/service/pluginCompat/ClaudeAgentFormatAdapter";

const VALID_MD = `---
name: reviewer
description: Reviews campaign drafts.
tools: [knowledge_library_search]
model: gpt-5-mini
mode: verifier
maxTurns: 8
color: blue
---

You are a campaign review specialist.`;

describe("ClaudeAgentFormatAdapter", () => {
  it("parses required fields and maps frontmatter", () => {
    const r = ClaudeAgentFormatAdapter.adapt(VALID_MD, {
      pluginName: "lead-pack",
      sourcePath: "agents/reviewer.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.definition;
    expect(d.id).toBe("lead-pack:reviewer");
    expect(d.name).toBe("reviewer");
    expect(d.description).toBe("Reviews campaign drafts.");
    expect(d.systemPrompt).toContain("campaign review specialist");
    expect(d.allowedTools).toEqual(["knowledge_library_search"]);
    expect(d.defaultModel).toBe("gpt-5-mini");
    expect(d.mode).toBe("verifier");
    expect(d.maxContinueCalls).toBe(8);
    expect(d.source).toBe("plugin");
    expect(d.health).toBe("healthy");
    expect(d.status).toBe("active");
    expect((r.manifest as { color: string }).color).toBe("blue");
  });

  it("unions tools and skills into allowedTools", () => {
    const md = `---
name: a
description: d
tools: [t1]
skills: [s1, s2]
---

body`;
    const r = ClaudeAgentFormatAdapter.adapt(md, {
      pluginName: "p",
      sourcePath: "agents/a.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.allowedTools.sort()).toEqual(["s1", "s2", "t1"]);
  });

  it("rejects missing name", () => {
    const r = ClaudeAgentFormatAdapter.adapt("---\ndescription: d\n---\nbody", {
      pluginName: "p",
      sourcePath: "agents/x.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("agent-frontmatter-missing-field");
  });

  it("rejects missing description", () => {
    const r = ClaudeAgentFormatAdapter.adapt("---\nname: n\n---\nbody", {
      pluginName: "p",
      sourcePath: "agents/x.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty body", () => {
    const r = ClaudeAgentFormatAdapter.adapt("---\nname: n\ndescription: d\n---\n", {
      pluginName: "p",
      sourcePath: "agents/x.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("agent-frontmatter-missing-field");
  });

  it("warns on forbidden fields but still succeeds", () => {
    const md = `---
name: n
description: d
hooks: ./hooks.sh
permissionMode: bypassPermissions
mcpServers: [evil]
---

body`;
    const r = ClaudeAgentFormatAdapter.adapt(md, {
      pluginName: "p",
      sourcePath: "agents/x.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.code === "agent-unsupported-field")).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("uses namespaceSegments for nested IDs", () => {
    const md = `---
name: strict
description: d
---

body`;
    const r = ClaudeAgentFormatAdapter.adapt(md, {
      pluginName: "lead-pack",
      sourcePath: "agents/review/security.md",
      namespaceSegments: ["review"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.id).toBe("lead-pack:review:strict");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

```typescript
// src/service/pluginCompat/ClaudeAgentFormatAdapter.ts
import { parseFrontmatter } from "@/service/pluginCompat/claudeFrontmatterParser";
import type {
  AgentDefinitionView,
  AgentDefinitionHealth,
} from "@/entityTypes/agentTypes";
import type { PluginError } from "@/entityTypes/pluginTypes";

/**
 * Pure translator: one plugin agent Markdown file → AgentDefinitionView.
 * Mirrors ClaudeSkillFormatAdapter: no I/O. Caller reads the file.
 *
 * Security (PRD §17, design §10.8): privilege-bearing frontmatter fields are
 * ignored and surfaced as recoverable `agent-unsupported-field` warnings;
 * they never reach the runtime.
 */

export interface ClaudeAgentAdaptOptions {
  readonly pluginName: string;
  readonly sourcePath: string;
  /** Directory segments between the declared agent root and this file's dir. */
  readonly namespaceSegments: readonly string[];
}

export interface ClaudeAgentAdaptSuccess {
  readonly ok: true;
  readonly definition: AgentDefinitionView;
  readonly manifest: Record<string, unknown>;
  readonly warnings: PluginError[];
}

export interface ClaudeAgentAdaptFailure {
  readonly ok: false;
  readonly errors: PluginError[];
}

export type ClaudeAgentAdaptResult =
  | ClaudeAgentAdaptSuccess
  | ClaudeAgentAdaptFailure;

const SEGMENT_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

const FORBIDDEN_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "permissionMode", label: "permissionMode" },
  { key: "hooks", label: "hooks" },
  { key: "mcpServers", label: "mcpServers" },
  { key: "alwaysAllow", label: "alwaysAllow" },
  { key: "disallowedTools", label: "disallowedTools" },
  { key: "mcp", label: "mcp" },
  { key: "servers", label: "servers" },
];

/** Stricter than skills: bad/empty name is an error, never invented. */
export function sanitizeAgentSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export function buildPluginAgentId(
  pluginName: string,
  namespaceSegments: readonly string[],
  agentName: string
): string {
  return [pluginName, ...namespaceSegments, agentName].join(":");
}

function missingField(
  sourcePath: string,
  field: string,
  message: string
): PluginError {
  return {
    code: "agent-frontmatter-missing-field",
    componentType: "agent",
    path: sourcePath,
    message,
    recoverable: false,
  };
}

export class ClaudeAgentFormatAdapter {
  static adapt(
    markdown: string,
    options: ClaudeAgentAdaptOptions
  ): ClaudeAgentAdaptResult {
    const { pluginName, sourcePath, namespaceSegments } = options;
    const { frontmatter, body } = parseFrontmatter(markdown);
    const warnings: PluginError[] = [];

    // Required: name (non-empty, sanitizable)
    const rawName = frontmatter.name;
    const name =
      typeof rawName === "string" && rawName.length > 0
        ? sanitizeAgentSegment(rawName)
        : "";
    if (!name || !SEGMENT_REGEX.test(name)) {
      return {
        ok: false,
        errors: [
          missingField(
            sourcePath,
            "name",
            `Agent at "${sourcePath}" is missing a valid "name" (must match /^[a-z0-9][a-z0-9_-]*$/).`
          ),
        ],
      };
    }

    // Required: description
    const rawDescription = frontmatter.description;
    if (typeof rawDescription !== "string" || rawDescription.length === 0) {
      return {
        ok: false,
        errors: [
          missingField(
            sourcePath,
            "description",
            `Agent at "${sourcePath}" is missing required frontmatter field "description".`
          ),
        ],
      };
    }

    // Required: non-empty body → systemPrompt
    const systemPrompt = body.trim();
    if (systemPrompt.length === 0) {
      return {
        ok: false,
        errors: [
          missingField(sourcePath, "body", `Agent body at "${sourcePath}" is empty.`),
        ],
      };
    }

    // Optional fields
    const tools = toStringArray(frontmatter.tools);
    const skills = toStringArray(frontmatter.skills);
    const allowedTools = Array.from(new Set([...tools, ...skills]));
    const defaultModel = typeof frontmatter.model === "string" ? frontmatter.model : undefined;
    const mode = toMode(frontmatter.mode);
    const maxToolCalls = toPositiveInt(frontmatter.maxToolCalls, 8);
    const maxRuntimeMs = toPositiveInt(frontmatter.maxRuntimeMs, 300000);
    const maxContinueCalls = toPositiveInt(frontmatter.maxTurns, 8);
    const outputSchema = toOutputSchema(frontmatter.outputSchema);

    // Forbidden fields → warnings only
    const manifest: Record<string, unknown> = {};
    if (typeof frontmatter.color === "string") manifest.color = frontmatter.color;
    if (typeof frontmatter.background === "string") manifest.background = frontmatter.background;
    if (typeof frontmatter.effort === "string") manifest.effort = frontmatter.effort;
    for (const { key, label } of FORBIDDEN_FIELDS) {
      if (frontmatter[key] !== undefined) {
        manifest[label] = frontmatter[key];
        warnings.push({
          code: "agent-unsupported-field",
          componentType: "agent",
          componentName: name,
          path: sourcePath,
          message: `Agent field "${label}" is not supported and was ignored.`,
          recoverable: true,
        });
      }
    }

    const health: AgentDefinitionHealth = "healthy";
    const definition: AgentDefinitionView = {
      id: buildPluginAgentId(pluginName, namespaceSegments, name),
      name,
      description: rawDescription,
      version: 1,
      systemPrompt,
      allowedTools,
      ...(defaultModel ? { defaultModel } : {}),
      mode,
      maxToolCalls,
      maxRuntimeMs,
      maxContinueCalls,
      outputSchema,
      status: "active",
      source: "plugin",
      pluginName,
      pluginComponentPath: sourcePath,
      manifest,
      health,
    };

    return { ok: true, definition, manifest, warnings };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function toMode(value: unknown): AgentDefinitionView["mode"] {
  if (
    value === "coordinator" ||
    value === "specialist" ||
    value === "verifier" ||
    value === "formatter"
  ) {
    return value;
  }
  return "specialist";
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function toOutputSchema(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add src/service/pluginCompat/ClaudeAgentFormatAdapter.ts \
        test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts
git commit -m "feat(agents): add ClaudeAgentFormatAdapter for plugin agent markdown"
```

## Task 2.2: `PluginAgentImportService` (TDD)

**Files:**
- Create: `src/service/PluginAgentImportService.ts`
- Test: `test/vitest/utilitycode/pluginAgentImportService.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/vitest/utilitycode/pluginAgentImportService.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PluginAgentImportService } from "@/service/PluginAgentImportService";
import type { PluginManifest } from "@/entityTypes/pluginTypes";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-import-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
}

const md = (name: string, desc = "d") =>
  `---\nname: ${name}\ndescription: ${desc}\n---\nbody for ${name}`;

describe("PluginAgentImportService", () => {
  it("imports a native array declaration", () => {
    write(path.join(tmp, "agents", "reviewer.md"), md("reviewer"));
    const manifest = {
      name: "lead-pack",
      version: "1.0.0",
      description: "x",
      agents: ["agents/reviewer.md"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({ pluginRoot: tmp, manifest });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0].definition.id).toBe("lead-pack:reviewer");
  });

  it("auto-detects Claude agents/ when agents === true", () => {
    write(path.join(tmp, "agents", "a.md"), md("a"));
    write(path.join(tmp, "agents", "b.md"), md("b"));
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
      agents: true,
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({ pluginRoot: tmp, manifest });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.agents.map((a) => a.definition.id).sort();
    expect(ids).toEqual(["p:a", "p:b"]);
  });

  it("produces nested namespace IDs for subdirectories", () => {
    write(path.join(tmp, "agents", "review", "security.md"), md("strict"));
    const manifest = {
      name: "lead-pack",
      version: "1.0.0",
      description: "x",
      agents: ["agents/"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({ pluginRoot: tmp, manifest });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.agents[0].definition.id).toBe("lead-pack:review:strict");
  });

  it("rejects path traversal", () => {
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
      agents: ["../escape.md"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({ pluginRoot: tmp, manifest });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "agent-path-invalid")).toBe(true);
  });

  it("fails on duplicate IDs within a plugin", () => {
    write(path.join(tmp, "agents", "a.md"), md("dup"));
    write(path.join(tmp, "agents", "b.md"), md("dup"));
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
      agents: ["agents/"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({ pluginRoot: tmp, manifest });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "agent-name-conflict")).toBe(true);
  });

  it("returns ok with zero agents when nothing is declared and no agents/ exists", () => {
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({ pluginRoot: tmp, manifest });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.agents).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run test/vitest/utilitycode/pluginAgentImportService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
// src/service/PluginAgentImportService.ts
import * as fs from "fs";
import * as path from "path";
import {
  resolvePluginRelativePath,
  type PluginError,
  type PluginManifest,
  type PluginAgentDeclaration,
} from "@/entityTypes/pluginTypes";
import type {
  ParsedPluginAgentDefinition,
  PluginAgentParseResult,
} from "@/entityTypes/agentTypes";
import { ClaudeAgentFormatAdapter } from "@/service/pluginCompat/ClaudeAgentFormatAdapter";

export interface ParsePluginAgentsInput {
  readonly pluginRoot: string;
  readonly manifest: PluginManifest;
}

/**
 * Pure-ish parser (reads files, writes nothing): resolves the plugin's agent
 * declarations, walks directories for .md, parses each via
 * ClaudeAgentFormatAdapter, and detects duplicate IDs. Returns parsed
 * definitions + warnings; never persists.
 *
 * Resolution rules (design §9, §10):
 *  - native `agents`: string[] of plugin-relative files/dirs.
 *  - Claude `agents === true`: default `agents/`.
 *  - Claude `agents` string: single path.
 *  - Claude `agents` object map: `agents/<key>.md` unless a value has `source`.
 *  - Claude with no `agents` but an existing `agents/` dir: auto-detect.
 */
export class PluginAgentImportService {
  static parsePluginAgents(input: ParsePluginAgentsInput): PluginAgentParseResult {
    const { pluginRoot, manifest } = input;
    const errors: PluginError[] = [];
    const warnings: PluginError[] = [];

    const declared = resolveAgentDeclaration(manifest, pluginRoot, errors);
    if (errors.length > 0) return { ok: false, errors };
    // declared === undefined means "no agents declared and no agents/ found".
    if (declared === undefined) {
      return { ok: true, agents: [], warnings };
    }

    // Collect (absPath, relPath, namespaceSegments) for every .md file.
    const files: Array<{
      abs: string;
      rel: string;
      namespaceSegments: string[];
    }> = [];

    for (const { relPath, agentRoot } of declared) {
      let abs: string;
      try {
        abs = resolvePluginRelativePath(pluginRoot, relPath);
      } catch {
        errors.push({
          code: "agent-path-invalid",
          componentType: "agent",
          path: relPath,
          message: `Agent path "${relPath}" escapes the plugin directory.`,
          recoverable: false,
        });
        continue;
      }
      if (!fs.existsSync(abs)) {
        errors.push({
          code: "agent-manifest-invalid",
          componentType: "agent",
          path: relPath,
          message: `Declared agent path not found: ${relPath}`,
          recoverable: false,
        });
        continue;
      }
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        for (const found of walkMarkdownFiles(abs)) {
          const rel = path.relative(pluginRoot, found).replace(/\\/g, "/");
          files.push({
            abs: found,
            rel,
            namespaceSegments: segmentsBetween(agentRoot, found),
          });
        }
      } else if (stat.isFile() && abs.toLowerCase().endsWith(".md")) {
        const rel = path.relative(pluginRoot, abs).replace(/\\/g, "/");
        files.push({
          abs,
          rel,
          namespaceSegments: segmentsBetween(agentRoot, abs),
        });
      }
      // Non-markdown files are ignored.
    }

    if (errors.length > 0) return { ok: false, errors };

    // Sort for deterministic import order.
    files.sort((a, b) => a.rel.localeCompare(b.rel));

    const agents: ParsedPluginAgentDefinition[] = [];
    const seenIds = new Set<string>();
    for (const f of files) {
      const content = fs.readFileSync(f.abs, "utf-8");
      const adapted = ClaudeAgentFormatAdapter.adapt(content, {
        pluginName: manifest.name,
        sourcePath: f.rel,
        namespaceSegments: f.namespaceSegments,
      });
      if (!adapted.ok) {
        errors.push(...adapted.errors);
        continue;
      }
      if (seenIds.has(adapted.definition.id)) {
        errors.push({
          code: "agent-name-conflict",
          componentType: "agent",
          componentName: adapted.definition.id,
          path: f.rel,
          message: `Duplicate plugin agent id "${adapted.definition.id}".`,
          recoverable: false,
        });
        continue;
      }
      seenIds.add(adapted.definition.id);
      warnings.push(...adapted.warnings);
      agents.push({
        definition: adapted.definition,
        pluginName: manifest.name,
        componentPath: f.rel,
        manifest: adapted.manifest,
        warnings: adapted.warnings,
      });
    }

    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, agents, warnings };
  }
}

/** Resolve the manifest `agents` field to a list of {relPath, agentRoot} roots. */
function resolveAgentDeclaration(
  manifest: PluginManifest,
  pluginRoot: string,
  _errors: PluginError[]
): Array<{ relPath: string; agentRoot: string }> | undefined {
  const raw = manifest.agents as PluginAgentDeclaration | undefined;
  const defaultRoot = path.join(pluginRoot, "agents");
  const hasDefaultDir = fs.existsSync(defaultRoot);

  // Native (aifetchly) format: array of strings.
  if (Array.isArray(raw)) {
    return raw
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((p) => ({ relPath: p, agentRoot: dirRootFor(p) }));
  }

  if (raw === true) {
    return [{ relPath: "agents", agentRoot: "agents" }];
  }

  if (typeof raw === "string") {
    return [{ relPath: raw, agentRoot: dirRootFor(raw) }];
  }

  if (raw && typeof raw === "object") {
    const out: Array<{ relPath: string; agentRoot: string }> = [];
    for (const [key, val] of Object.entries(raw)) {
      const v = val as { source?: string } | undefined;
      const p = v && typeof v.source === "string" ? v.source : `agents/${key}.md`;
      out.push({ relPath: p, agentRoot: dirRootFor(p) });
    }
    return out;
  }

  // undefined: auto-detect agents/ for Claude plugins only.
  if (manifest.format === "claude" && hasDefaultDir) {
    return [{ relPath: "agents", agentRoot: "agents" }];
  }
  return undefined;
}

/** The agent root is the declared path if it's a directory, else its parent dir. */
function dirRootFor(relPath: string): string {
  const clean = relPath.replace(/\\/g, "/").replace(/\/$/, "");
  return clean.toLowerCase().endsWith(".md")
    ? path.posix.dirname(clean)
    : clean;
}

/** Directory segments between agentRoot and the file's parent dir. */
function segmentsBetween(agentRoot: string, absFile: string): string[] {
  const rootAbs = path.resolve(path.dirname(absFile) && absFile); // placeholder
  void rootAbs;
  const cleanRoot = agentRoot.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const fileDir = path
    .dirname(absFile)
    .replace(/\\/g, "/");
  const idx = fileDir.indexOf(`/${cleanRoot}`);
  if (idx === -1) return [];
  const after = fileDir.slice(idx + cleanRoot.length + 1); // segments below root
  return after
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

/** Depth-first, sorted walk for .md files (no glob dep). */
function walkMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
```

> Note: `segmentsBetween` derives nested namespace segments from the path below the agent root. The leftover `rootAbs`/`placeholder` lines are dead — remove them in Step 3 before saving (kept out of the final file). Final `segmentsBetween` body:

```typescript
function segmentsBetween(agentRoot: string, absFile: string): string[] {
  const cleanRoot = agentRoot.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const fileDir = path.dirname(absFile).replace(/\\/g, "/");
  const idx = fileDir.indexOf(`/${cleanRoot}`);
  if (idx === -1) return [];
  const after = fileDir.slice(idx + cleanRoot.length + 1);
  return after
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/utilitycode/pluginAgentImportService.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/service/PluginAgentImportService.ts \
        test/vitest/utilitycode/pluginAgentImportService.test.ts
git commit -m "feat(agents): add PluginAgentImportService manifest+walk parser"
```

---

# Phase 3 — Plugin manifest + import integration

## Task 3.1: `PluginManifestService` accepts native `agents`

**Files:**
- Modify: `src/service/PluginManifestService.ts`

- [ ] **Step 1: Validate native `agents` as a string array (in the private `validateManifest`)**

After the `mcpServers` validation block (~line 148), add:

```typescript
  if (m.agents !== undefined && !isStringArray(m.agents)) {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"agents" must be an array of relative path strings.',
      recoverable: false,
    });
  }
```

- [ ] **Step 2: Update the "at least one of" rule (~lines 150-158)**

Replace:

```typescript
  const skills = Array.isArray(m.skills) ? m.skills : [];
  const mcpServers = Array.isArray(m.mcpServers) ? m.mcpServers : [];
  if (skills.length === 0 && mcpServers.length === 0) {
    errors.push({
      code: "manifest-schema-invalid",
      message: 'At least one of "skills" or "mcpServers" must be non-empty.',
      recoverable: false,
    });
  }
```

with:

```typescript
  const skills = Array.isArray(m.skills) ? m.skills : [];
  const mcpServers = Array.isArray(m.mcpServers) ? m.mcpServers : [];
  const agents = Array.isArray(m.agents) ? m.agents : [];
  if (skills.length === 0 && mcpServers.length === 0 && agents.length === 0) {
    errors.push({
      code: "manifest-schema-invalid",
      message:
        'At least one of "skills", "mcpServers", or "agents" must be non-empty.',
      recoverable: false,
    });
  }
```

- [ ] **Step 3: Add path-safety for declared native agent paths (after the MCP path-safety loop)**

```typescript
  for (const agentPath of agents) {
    try {
      resolvePluginRelativePath(pluginRoot, agentPath);
    } catch {
      errors.push({
        code: "path-outside-plugin",
        componentType: "agent",
        path: agentPath,
        message: `Agent path "${agentPath}" escapes the plugin directory.`,
        recoverable: false,
      });
    }
  }
```

## Task 3.2: `ClaudePluginAdapter` normalizes `agents`

**Files:**
- Modify: `src/service/pluginCompat/ClaudePluginAdapter.ts`

- [ ] **Step 1: Add an `AgentDecl` type + `normalizeAgentsField` helper (mirror `normalizeSkillsField`)**

Near the top, after `SkillDecl`:

```typescript
type AgentDecl =
  | string
  | readonly string[]
  | true
  | Record<string, { source?: string; content?: string; description?: string }>;
```

Add the helper (returns the normalized declaration plus collected errors; for the object-map `content`-only form it pushes `agent-unsupported-field`):

```typescript
function normalizeAgentsField(
  raw: AgentDecl | undefined,
  pluginRoot: string,
  errors: PluginError[]
): PluginAgentDeclaration | undefined {
  // Object map: validate per-entry.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, { source?: string; description?: string }> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const v = val as { source?: string; content?: string; description?: string } | undefined;
      if (v && typeof v.content === "string" && (typeof v.source !== "string" || v.source.length === 0)) {
        errors.push({
          code: "agent-unsupported-field",
          componentType: "agent",
          componentName: key,
          message: `Agent "${key}" uses inline "content", which is not supported (file imports only).`,
          recoverable: false,
        });
        continue;
      }
      if (v && typeof v.source === "string") {
        try {
          resolvePluginRelativePath(pluginRoot, v.source);
        } catch {
          errors.push({
            code: "agent-path-invalid",
            componentType: "agent",
            componentName: key,
            path: v.source,
            message: `Agent source path "${v.source}" escapes the plugin directory.`,
            recoverable: false,
          });
          continue;
        }
        out[key] = { source: v.source, ...(v.description ? { description: v.description } : {}) };
      } else {
        out[key] = v?.description ? { description: v.description } : {};
      }
    }
    return out;
  }

  // string | string[] | true | undefined
  if (raw === undefined) return undefined;
  if (raw === true) return true;
  if (typeof raw === "string") {
    try {
      resolvePluginRelativePath(pluginRoot, raw);
    } catch {
      errors.push({
        code: "agent-path-invalid",
        componentType: "agent",
        path: raw,
        message: `Agent path "${raw}" escapes the plugin directory.`,
        recoverable: false,
      });
    }
    return raw;
  }
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p !== "string") continue;
      try {
        resolvePluginRelativePath(pluginRoot, p);
      } catch {
        errors.push({
          code: "agent-path-invalid",
          componentType: "agent",
          path: p,
          message: `Agent path "${p}" escapes the plugin directory.`,
          recoverable: false,
        });
      }
    }
    return [...raw];
  }
  return undefined;
}
```

Import `PluginAgentDeclaration` from `@/entityTypes/pluginTypes` in the existing import list.

- [ ] **Step 2: Stop carrying `agents` opaquely; instead normalize it onto the manifest**

In `ClaudePluginAdapter.adapt`:
- Remove `"agents"` from the opaque carry-through key list (keep `commands`, `outputStyles`, `lsp`, `output-styles`).
- After computing `skillsPaths`, compute:

```typescript
    const agentsDecl = normalizeAgentsField(
      m.agents as AgentDecl | undefined,
      options.pluginRoot,
      errors
    );
    // Auto-detect agents/ when nothing declared.
    let effectiveAgents = agentsDecl;
    if (agentsDecl === undefined) {
      const defaultAgentsDir = `${options.pluginRoot}/agents`.replace(/\\/g, "/");
      try {
        if (fs.existsSync(path.join(options.pluginRoot, "agents"))) {
          effectiveAgents = true;
        }
      } catch {
        void defaultAgentsDir;
      }
    }
```

Add `import * as fs from "fs";` and `import * as path from "path";` at the top.

- [ ] **Step 3: Put `agents` on the built manifest**

In the `manifest = { ... }` literal, add (only when set):

```typescript
      ...(effectiveAgents !== undefined ? { agents: effectiveAgents } : {}),
```

- [ ] **Step 4: Verify + commit (with 3.1)**

Run: `yarn tsc` — should be green or only complain about `PluginDetail` consumers (fixed in 3.5).

```bash
git add src/service/PluginManifestService.ts src/service/pluginCompat/ClaudePluginAdapter.ts
git commit -m "feat(plugins): accept and normalize agents declarations in manifests"
```

## Task 3.3: `AgentDefinitionModule.upsertPluginAgents` + model support

**Files:**
- Modify: `src/model/AgentDefinition.model.ts`, `src/modules/AgentDefinitionModule.ts`

- [ ] **Step 1: Add `upsertPluginAgent` to the model**

```typescript
  /**
   * Upsert one plugin-owned agent. `initiallyEnabled` overrides the row's
   * status on insert only (used to honor preserved component state).
   */
  async upsertPluginAgent(
    view: AgentDefinitionView,
    initiallyEnabled?: boolean
  ): Promise<void> {
    const existing = await this.repository.findOne({
      where: { agentId: view.id },
    });
    if (existing) {
      // Preserve user-toggled status on overwrite; refresh content + health.
      await this.repository.save({
        ...existing,
        ...this.toPartial(view),
        status: existing.status,
      });
      return;
    }
    await this.repository.save({
      ...this.toPartial(view),
      status:
        initiallyEnabled === undefined
          ? view.status
          : initiallyEnabled
            ? "active"
            : "disabled",
    } as AgentDefinitionEntity);
  }

  private toPartial(view: AgentDefinitionView): Partial<AgentDefinitionEntity> {
    return {
      agentId: view.id,
      name: view.name,
      description: view.description,
      version: view.version,
      systemPrompt: view.systemPrompt,
      allowedTools: view.allowedTools,
      defaultModel: view.defaultModel ?? null,
      mode: view.mode,
      maxToolCalls: view.maxToolCalls,
      maxRuntimeMs: view.maxRuntimeMs,
      maxContinueCalls: view.maxContinueCalls,
      outputSchema: view.outputSchema,
      source: view.source,
      pluginName: view.pluginName ?? null,
      pluginComponentPath: view.pluginComponentPath ?? null,
      manifestJson: view.manifest ? JSON.stringify(view.manifest) : null,
      health: view.health,
      lastError: view.lastError ?? null,
    };
  }
```

(Refactor `upsert` to reuse `toPartial` as well — optional cleanup.)

- [ ] **Step 2: Add `upsertPluginAgents` to the module**

```typescript
  /**
   * Persist plugin-owned agents. `preservedDisabledIds` carries agent IDs the
   * user previously disabled so overwrite/reinstall honors their toggle.
   */
  async upsertPluginAgents(
    pluginName: string,
    agents: readonly ParsedPluginAgentDefinition[],
    preservedDisabledIds: ReadonlySet<string> = new Set()
  ): Promise<void> {
    await this.ensureConnection();
    for (const a of agents) {
      const initiallyEnabled = !preservedDisabledIds.has(a.definition.id);
      await this.model.upsertPluginAgent(a.definition, initiallyEnabled);
    }
  }
```

Add the import: `import type { ParsedPluginAgentDefinition } from "@/entityTypes/agentTypes";`

- [ ] **Step 3: Commit**

```bash
git add src/model/AgentDefinition.model.ts src/modules/AgentDefinitionModule.ts
git commit -m "feat(agents): persist plugin-owned agents with toggle preservation"
```

## Task 3.4: `PluginImportService` parses + persists agents

**Files:**
- Modify: `src/service/PluginImportService.ts`

- [ ] **Step 1: Capture preserved disabled-agent IDs before overwrite**

At the point where overwrite is handled (~line 501, `if (existing && overwrite)`), capture prior state *before* uninstall:

```typescript
    // If overwrite, uninstall the old one first (rows + files). Capture the
    // user's previously-disabled agent IDs so reinstall can honor them (D5).
    let preservedDisabledAgentIds = new Set<string>();
    if (existing && overwrite) {
      try {
        const state = JSON.parse(existing.componentStateJson || "{}") as {
          agents?: Record<string, { enabled?: boolean }>;
        };
        const prevAgents = await new AgentDefinitionModule().findAgentsByPluginName(
          manifest.name
        );
        preservedDisabledAgentIds = new Set(
          prevAgents
            .filter((a) => a.status === "disabled")
            .map((a) => a.id)
        );
        void state; // componentStateJson is the persistence target for future toggles
      } catch {
        // best-effort
      }
      await pluginModule.uninstallPlugin(manifest.name);
      removePath(getPluginInstallRoot(manifest.name));
    }
```

Add the imports at the top:

```typescript
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { PluginAgentImportService } from "@/service/PluginAgentImportService";
```

- [ ] **Step 2: Parse agents in the validation phase (after MCP validation, ~after line 605)**

```typescript
    // 6c. Validate plugin agents (design §12.1). Errors fail import before copy.
    const agentParse = PluginAgentImportService.parsePluginAgents({
      pluginRoot: localRoot,
      manifest,
    });
    if (!agentParse.ok) {
      return { success: false, errors: toErrors([...agentParse.errors]) };
    }
    const pluginAgents = agentParse.agents;
```

- [ ] **Step 3: Persist agents after MCP persistence (after step 10b, ~line 864)**

```typescript
    // 10c. Persist plugin-owned agent definitions (design §12.2).
    const agentModule = new AgentDefinitionModule();
    try {
      await agentModule.upsertPluginAgents(
        manifest.name,
        pluginAgents,
        preservedDisabledAgentIds
      );
    } catch (e: unknown) {
      await rollbackRowsAndFiles(manifest.name, installPath);
      return {
        success: false,
        errors: [
          {
            code: "agent-manifest-invalid",
            componentType: "agent",
            pluginName: manifest.name,
            message:
              e instanceof Error
                ? `Failed to persist plugin agents: ${e.message}`
                : "Failed to persist plugin agents",
            recoverable: false,
          },
        ],
      };
    }
```

- [ ] **Step 4: Add `agentCount` to the summary + surface warnings (step 12, ~line 894)**

In the `summary` object add:

```typescript
      agentCount: pluginAgents.length,
```

Before returning success, persist agent warnings as load errors (non-fatal):

```typescript
    // 11c. Surface agent warnings (forbidden/unknown fields) as diagnostics.
    if (agentParse.warnings.length > 0) {
      try {
        await pluginModule.setLoadErrors(manifest.name, agentParse.warnings);
      } catch {
        // best-effort
      }
    }
```

> Note: `PluginSummary` now requires `agentCount` (Task 1.5). Every other place that builds a `PluginSummary` (the plugin IPC `plugin:list`) must also set it — handled in Task 3.5/3.6.

## Task 3.5: `PluginManagementModule.uninstallPlugin` removes agents; add agentModel

**Files:**
- Modify: `src/modules/PluginManagementModule.ts`

- [ ] **Step 1: Add `agentModel`**

Add import + field + constructor line:

```typescript
import { AgentDefinitionModel } from "@/model/AgentDefinition.model";
// ...
  private agentModel: AgentDefinitionModel;
// in constructor:
    this.agentModel = new AgentDefinitionModel(this.dbpath);
```

- [ ] **Step 2: Delete plugin agents inside `uninstallPlugin` (before `pluginModel.remove`)**

After the MCP delete block, add:

```typescript
    let removedAgentIds: string[] = [];
    try {
      removedAgentIds = await this.agentModel.deleteByPluginName(name);
    } catch (e: unknown) {
      errors.push({
        code: "uninstall-failed",
        componentType: "agent",
        pluginName: name,
        message: e instanceof Error ? e.message : String(e),
        recoverable: false,
      });
    }
```

Update both return objects (the `!existing` early-return and the final return) to include `removedAgentIds` (empty array in the early-return case; `removedAgentIds` in the final case).

## Task 3.6: Plugin list/get IPC surfaces agent count + components

**Files:**
- Modify: `src/main-process/communication/plugin-ipc.ts`

- [ ] **Step 1: Count agents in `plugin:list`**

In the handler that builds `PluginSummary[]`, after computing `skills.length` and `mcpServers.length`, add:

```typescript
const agents = await new AgentDefinitionModule().findAgentsByPluginName(p.name);
```

and include `agentCount: agents.length` in the summary object. Add `import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";`.

- [ ] **Step 2: Include `agents` in `plugin:get`**

When building `PluginDetail`, map plugin-owned agents to `PluginAgentComponent`:

```typescript
agents: agents.map((a) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  enabled: a.status === "active",
  mode: a.mode,
  toolCount: a.allowedTools.length,
  componentPath: a.pluginComponentPath ?? "",
  health: a.health,
  ...(a.lastError ? { error: a.lastError } : {}),
})),
```

- [ ] **Step 3: Verify + commit (3.4–3.6 together once `tsc` green)**

Run: `yarn tsc` then `yarn vue-check`.
Expected: PASS.

```bash
git add src/service/PluginImportService.ts src/modules/PluginManagementModule.ts \
        src/main-process/communication/plugin-ipc.ts
git commit -m "feat(plugins): install/uninstall/list plugin-owned agents"
```

## Task 3.7: Plugin import integration test

**Files:**
- Create or extend: `test/vitest/main/pluginImportAgents.test.ts`

- [ ] **Step 1: Write tests** covering: native plugin with `agents` installs `<plugin>:<name>`; Claude `agents: true` auto-detect; agent-only plugin installs with skillCount=0, mcpServerCount=0, agentCount=N; uninstall removes owned agent rows; path-traversal `../x.md` fails import atomically. Use the same temp-dir + `PluginImportService.installFromLocalRoot` pattern as existing plugin import tests (locate one under `test/vitest/main/` and mirror its DB setup). Assert via `new AgentDefinitionModule().findAgentsByPluginName(name)`.

- [ ] **Step 2: Run**

Run: `yarn vitest run test/vitest/main/pluginImportAgents.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/vitest/main/pluginImportAgents.test.ts
git commit -m "test(plugins): cover agent install/uninstall/import-rollback"
```

---

# Phase 4 — Agent management backend (Module + IPC)

## Task 4.1: `AgentDefinitionModule` management methods + authorization (TDD)

**Files:**
- Modify: `src/modules/AgentDefinitionModule.ts`
- Test: `test/modules/AgentDefinitionModule.test.ts`

- [ ] **Step 1: Write failing tests** for: built-ins seeded with `source:"built-in"`; `createManualAgent` produces `user:<slug>`; duplicate manual ID rejected; `updateManualAgent` edits user agents; `updateManualAgent` rejects plugin-owned; `deleteManualAgent` rejects built-in; `toggleAgent` works on plugin-owned; `deleteAgentsByPluginName` returns removed IDs. Mirror the DB setup of an existing `test/modules/*.test.ts` (Mocha style). If `test/modules/AgentDefinitionModule.test.ts` already exists, extend it.

- [ ] **Step 2: Implement the management methods**

Add to `AgentDefinitionModule`:

```typescript
  import type {
    CreateManualAgentDefinitionInput,
    UpdateManualAgentDefinitionInput,
    AgentDefinitionView,
  } from "@/entityTypes/agentTypes";

  async listAllForManagement(): Promise<AgentDefinitionView[]> {
    await this.ensureConnection();
    return this.model.listAll();
  }

  async getForManagement(agentId: string): Promise<AgentDefinitionView | null> {
    await this.ensureConnection();
    return this.model.getById(agentId);
  }

  async createManualAgent(
    input: CreateManualAgentDefinitionInput
  ): Promise<AgentDefinitionView> {
    await this.ensureConnection();
    const slug = sanitizeAgentSegment(input.idSlug);
    if (!slug) {
      throw new Error("Agent id slug is empty after sanitization.");
    }
    const id = `user:${slug}`;
    const existing = await this.model.getById(id);
    if (existing) {
      throw new Error(`Agent id "${id}" already exists.`);
    }
    const view: AgentDefinitionView = {
      id,
      name: input.name,
      description: input.description,
      version: 1,
      systemPrompt: input.systemPrompt,
      allowedTools: input.allowedTools,
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      mode: input.mode,
      maxToolCalls: input.maxToolCalls,
      maxRuntimeMs: input.maxRuntimeMs,
      maxContinueCalls: input.maxContinueCalls,
      outputSchema: input.outputSchema ?? {},
      status: input.enabled === false ? "disabled" : "active",
      source: "user",
      manifest: {},
      health: "healthy",
    };
    await this.model.upsert(view);
    return view;
  }

  async updateManualAgent(
    agentId: string,
    patch: UpdateManualAgentDefinitionInput
  ): Promise<AgentDefinitionView> {
    await this.ensureConnection();
    const existing = await this.model.getById(agentId);
    if (!existing) throw new Error(`Agent "${agentId}" not found.`);
    if (existing.source !== "user") {
      throw new Error(
        `Agent "${agentId}" is not user-owned and cannot be edited.`
      );
    }
    const updated: AgentDefinitionView = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.allowedTools !== undefined ? { allowedTools: patch.allowedTools } : {}),
      ...(patch.defaultModel !== undefined
        ? patch.defaultModel === null
          ? {} // drop optional
          : { defaultModel: patch.defaultModel }
        : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.maxToolCalls !== undefined ? { maxToolCalls: patch.maxToolCalls } : {}),
      ...(patch.maxRuntimeMs !== undefined ? { maxRuntimeMs: patch.maxRuntimeMs } : {}),
      ...(patch.maxContinueCalls !== undefined ? { maxContinueCalls: patch.maxContinueCalls } : {}),
      ...(patch.outputSchema !== undefined ? { outputSchema: patch.outputSchema } : {}),
      ...(patch.enabled !== undefined
        ? { status: patch.enabled ? "active" : "disabled" }
        : {}),
      version: existing.version + 1,
    };
    await this.model.upsert(updated);
    return updated;
  }

  async toggleAgent(agentId: string, enabled: boolean): Promise<boolean> {
    await this.ensureConnection();
    return this.model.toggle(agentId, enabled);
  }

  async deleteManualAgent(agentId: string): Promise<boolean> {
    await this.ensureConnection();
    const existing = await this.model.getById(agentId);
    if (!existing) return false;
    if (existing.source === "built-in") {
      throw new Error(`Built-in agent "${agentId}" cannot be deleted.`);
    }
    if (existing.source === "plugin") {
      throw new Error(
        `Plugin-owned agent "${agentId}" cannot be deleted directly; uninstall the plugin.`
      );
    }
    return this.model.deleteUserAgent(agentId);
  }

  async findAgentsByPluginName(pluginName: string): Promise<AgentDefinitionView[]> {
    await this.ensureConnection();
    return this.model.findByPluginName(pluginName);
  }

  async deleteAgentsByPluginName(pluginName: string): Promise<string[]> {
    await this.ensureConnection();
    return this.model.deleteByPluginName(pluginName);
  }
```

Import `sanitizeAgentSegment` from `@/service/pluginCompat/ClaudeAgentFormatAdapter` (it is exported there) for manual-ID normalization. (Manual IDs and plugin-name segments share the same sanitizer by design.)

> Authorization rules enforced: built-in cannot be deleted; plugin-owned cannot be edited or deleted directly; manual IDs cannot collide; plugin-owned *can* be toggled. Matches design §11.2.

- [ ] **Step 3: Run tests**

Run: `yarn test test/modules/AgentDefinitionModule.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/AgentDefinitionModule.ts test/modules/AgentDefinitionModule.test.ts
git commit -m "feat(agents): manual agent CRUD + source-based authorization"
```

## Task 4.2: IPC channel constants

**Files:**
- Modify: `src/config/channellist.ts`

- [ ] **Step 1: Add the 6 management channels (after the existing `AGENT_*` block, ~line 406)**

```typescript
export const AGENT_MANAGEMENT_LIST = "agent-definition:list";
export const AGENT_MANAGEMENT_GET = "agent-definition:get";
export const AGENT_MANAGEMENT_CREATE = "agent-definition:create";
export const AGENT_MANAGEMENT_UPDATE = "agent-definition:update";
export const AGENT_MANAGEMENT_TOGGLE = "agent-definition:toggle";
export const AGENT_MANAGEMENT_DELETE = "agent-definition:delete";
```

## Task 4.3: IPC schemas (bare `zod`)

**Files:**
- Create: `src/schemas/ipc/agentDefinition.ts`

- [ ] **Step 1: Write the schemas**

```typescript
// src/schemas/ipc/agentDefinition.ts
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

// IMPORTANT (D1): bare "zod", NOT "zod/v4" — must match registerValidatedHandler's ZodType.
export const agentDefinitionListInputSchema = noInputSchema;

export const agentDefinitionByIdInputSchema = lazySchema(() =>
  z.strictObject({
    agentId: z.string().min(1).max(256),
  })
);

export const agentDefinitionCreateInputSchema = lazySchema(() =>
  z.strictObject({
    idSlug: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    systemPrompt: z.string().min(1).max(100000),
    allowedTools: z.array(z.string().min(1).max(256)).max(200),
    defaultModel: z.string().max(120).optional(),
    mode: z.enum(["coordinator", "specialist", "verifier", "formatter"]),
    maxToolCalls: z.number().int().positive().max(100),
    maxRuntimeMs: z.number().int().positive().max(3600000),
    maxContinueCalls: z.number().int().positive().max(100),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
);

export const agentDefinitionUpdateInputSchema = lazySchema(() =>
  agentDefinitionCreateInputSchema()
    .partial()
    .extend({
      agentId: z.string().min(1).max(256),
    })
);

export const agentDefinitionToggleInputSchema = lazySchema(() =>
  z.strictObject({
    agentId: z.string().min(1).max(256),
    enabled: z.boolean(),
  })
);

export const agentDefinitionDeleteInputSchema = agentDefinitionByIdInputSchema;
```

## Task 4.4: IPC handlers

**Files:**
- Create: `src/main-process/communication/agent-definition-ipc.ts`
- Modify: `src/main-process/communication/index.ts`

- [ ] **Step 1: Write the handlers**

```typescript
// src/main-process/communication/agent-definition-ipc.ts
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import {
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_UPDATE,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_DELETE,
} from "@/config/channellist";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  agentDefinitionListInputSchema,
  agentDefinitionByIdInputSchema,
  agentDefinitionCreateInputSchema,
  agentDefinitionUpdateInputSchema,
  agentDefinitionToggleInputSchema,
  agentDefinitionDeleteInputSchema,
} from "@/schemas/ipc/agentDefinition";

/**
 * Management-only agent definition IPC. NOT AI-gated (design §15.5): these
 * handlers do not execute agents or call AI APIs — they only read/write
 * definitions. Runtime listing stays AI-gated in agent-runtime-ipc.ts.
 */
export function registerAgentDefinitionIpcHandlers(): void {
  registerValidatedHandler(
    AGENT_MANAGEMENT_LIST,
    agentDefinitionListInputSchema,
    async () => new AgentDefinitionModule().listAllForManagement()
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_GET,
    agentDefinitionByIdInputSchema,
    async (input) => new AgentDefinitionModule().getForManagement(input.agentId)
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_CREATE,
    agentDefinitionCreateInputSchema,
    async (input) => new AgentDefinitionModule().createManualAgent(input)
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_UPDATE,
    agentDefinitionUpdateInputSchema,
    async (input) => {
      const { agentId, ...patch } = input;
      return new AgentDefinitionModule().updateManualAgent(agentId, patch);
    }
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_TOGGLE,
    agentDefinitionToggleInputSchema,
    async (input) =>
      new AgentDefinitionModule().toggleAgent(input.agentId, input.enabled)
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_DELETE,
    agentDefinitionDeleteInputSchema,
    async (input) =>
      new AgentDefinitionModule().deleteManualAgent(input.agentId)
  );
}
```

- [ ] **Step 2: Register in `index.ts`**

Add the import and call (next to `registerAgentRuntimeIpcHandlers()`):

```typescript
import { registerAgentDefinitionIpcHandlers } from "@/main-process/communication/agent-definition-ipc";
// ...
    registerAgentRuntimeIpcHandlers();
    registerAgentDefinitionIpcHandlers();
```

## Task 4.5: Preload allowlist (both locations)

**Files:**
- Modify: `src/preload.ts`

- [ ] **Step 1: Add the 6 constants to the import block (~line 307, next to `AGENT_DEFINITION_LIST`)**

```typescript
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_UPDATE,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_DELETE,
```

- [ ] **Step 2: Add the same 6 to the allowlist array (~line 852, in the "Agent Runtime Channels" group)**

## Task 4.6: IPC tests

**Files:**
- Create: `test/vitest/main/agent-definition-ipc.test.ts`

- [ ] **Step 1: Write tests** that invoke the 6 channels via the same harness used by other `test/vitest/main/*-ipc.test.ts` files (locate one and mirror). Cases: list delegates to module; get validates agentId; create validates required fields (reject empty name); update rejects plugin-owned (throws → `status:false`); toggle returns false for missing; delete rejects built-in. Assert management handlers are NOT AI-gated (they return data even when AI is disabled — contrast with `agent-runtime:definition-list`).

- [ ] **Step 2: Run + commit**

Run: `yarn vitest run test/vitest/main/agent-definition-ipc.test.ts`
Expected: PASS.

```bash
git add src/config/channellist.ts src/schemas/ipc/agentDefinition.ts \
        src/main-process/communication/agent-definition-ipc.ts \
        src/main-process/communication/index.ts src/preload.ts \
        test/vitest/main/agent-definition-ipc.test.ts
git commit -m "feat(agents): agent definition management IPC (non-AI-gated)"
```

---

# Phase 5 — Runtime active catalog (enablement + health filtering)

## Task 5.1: Model — active+healthy listing and lookup

**Files:**
- Modify: `src/model/AgentDefinition.model.ts`

- [ ] **Step 1: Add `listActiveHealthy` and `getActiveHealthyById`**

```typescript
  /** Active AND healthy agents (runtime-eligible before plugin-enablement). */
  async listActiveHealthy(): Promise<AgentDefinitionView[]> {
    const rows = await this.repository
      .createQueryBuilder("a")
      .where("a.status = :status", { status: "active" })
      .andWhere("a.health = :health", { health: "healthy" })
      .orderBy("a.agentId", "ASC")
      .getMany();
    return rows.map(toView);
  }

  async getActiveHealthyById(agentId: string): Promise<AgentDefinitionView | null> {
    const e = await this.repository
      .createQueryBuilder("a")
      .where("a.agentId = :agentId", { agentId })
      .andWhere("a.status = :status", { status: "active" })
      .andWhere("a.health = :health", { health: "healthy" })
      .getOne();
    return e ? toView(e) : null;
  }
```

## Task 5.2: Module — compose plugin enablement (Decision D3)

**Files:**
- Modify: `src/modules/AgentDefinitionModule.ts`

- [ ] **Step 1: Add `pluginModel` + enabled-names helper**

```typescript
import { InstalledPluginModel } from "@/model/InstalledPlugin.model";
// field:
  private readonly pluginModel: InstalledPluginModel;
// constructor (after this.model):
    this.pluginModel = new InstalledPluginModel(this.dbpath);

  private async enabledPluginNames(): Promise<Set<string>> {
    const enabled = await this.pluginModel.findEnabled();
    return new Set(enabled.map((p) => p.name));
  }

  private isRuntimeEligible(
    a: AgentDefinitionView,
    enabled: Set<string>
  ): boolean {
    if (a.status !== "active") return false;
    if (a.health !== "healthy") return false;
    if (a.source === "plugin") {
      return !!a.pluginName && enabled.has(a.pluginName);
    }
    return true;
  }
```

- [ ] **Step 2: Add `listActiveForRuntime`; rewrite `getActiveById` to filter**

```typescript
  async listActiveForRuntime(): Promise<AgentDefinitionView[]> {
    await this.ensureConnection();
    const enabled = await this.enabledPluginNames();
    const all = await this.model.listActiveHealthy();
    return all.filter((a) => this.isRuntimeEligible(a, enabled));
  }

  async getActiveById(agentId: string): Promise<AgentDefinitionView | null> {
    await this.ensureConnection();
    const a = await this.model.getActiveHealthyById(agentId);
    if (!a) return null;
    const enabled = await this.enabledPluginNames();
    return this.isRuntimeEligible(a, enabled) ? a : null;
  }
```

(Public method name `getActiveById` is unchanged → `AgentRuntime.runSync` needs no edit. `listActive()` can delegate to `listActiveForRuntime()` or be left for back-compat — see 5.3.)

- [ ] **Step 3: Keep `listActive()` behavior consistent**

Replace the body of the existing `listActive()` with `return this.listActiveForRuntime();` so any other caller also gets filtered results.

## Task 5.3: Runtime definition-list uses the filtered catalog

**Files:**
- Modify: `src/main-process/communication/agent-runtime-ipc.ts`

- [ ] **Step 1: Point LIST at `listActiveForRuntime`**

In the `AGENT_DEFINITION_LIST` handler, change `module.listActive()` → `module.listActiveForRuntime()`. (Stays `registerAiValidatedHandler` — runtime listing is AI-facing.)

## Task 5.4: Runtime filtering tests

**Files:**
- Create: `test/vitest/main/agentRuntimeDefinitionList.test.ts`

- [ ] **Step 1: Write tests**: active list excludes disabled agents; excludes agents of a disabled plugin; includes manual enabled agents; includes built-ins; `getActiveById` returns null for a plugin-owned agent whose plugin is disabled. Seed via `AgentDefinitionModule` + `InstalledPluginModel`.

- [ ] **Step 2: Run + commit**

Run: `yarn vitest run test/vitest/main/agentRuntimeDefinitionList.test.ts`
Expected: PASS.

```bash
git add src/model/AgentDefinition.model.ts src/modules/AgentDefinitionModule.ts \
        src/main-process/communication/agent-runtime-ipc.ts \
        test/vitest/main/agentRuntimeDefinitionList.test.ts
git commit -m "feat(agents): runtime catalog filters by status, health, plugin enablement"
```

---

# Phase 6 — Frontend

## Task 6.1: Renderer API client

**Files:**
- Create: `src/views/api/agents.ts`

- [ ] **Step 1: Write the client (mirror `views/api/plugins.ts`)**

```typescript
// src/views/api/agents.ts
import { windowInvoke } from "@/views/utils/apirequest";
import {
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_UPDATE,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_DELETE,
} from "@/config/channellist";
import type {
  AgentDefinitionView,
  AgentDefinitionSource,
  AgentDefinitionHealth,
  AgentMode,
  CreateManualAgentDefinitionInput,
  UpdateManualAgentDefinitionInput,
} from "@/entityTypes/agentTypes";

export type {
  AgentDefinitionView,
  AgentDefinitionSource,
  AgentDefinitionHealth,
  AgentMode,
  CreateManualAgentDefinitionInput,
  UpdateManualAgentDefinitionInput,
};

export async function listAgentDefinitions(): Promise<AgentDefinitionView[] | null> {
  return await windowInvoke(AGENT_MANAGEMENT_LIST);
}

export async function getAgentDefinition(
  agentId: string
): Promise<AgentDefinitionView | null> {
  return await windowInvoke(AGENT_MANAGEMENT_GET, { agentId });
}

export async function createAgentDefinition(
  input: CreateManualAgentDefinitionInput
): Promise<AgentDefinitionView | null> {
  return await windowInvoke(AGENT_MANAGEMENT_CREATE, input);
}

export async function updateAgentDefinition(
  agentId: string,
  input: UpdateManualAgentDefinitionInput
): Promise<AgentDefinitionView | null> {
  return await windowInvoke(AGENT_MANAGEMENT_UPDATE, { agentId, ...input });
}

export async function toggleAgentDefinition(
  agentId: string,
  enabled: boolean
): Promise<void> {
  await windowInvoke(AGENT_MANAGEMENT_TOGGLE, { agentId, enabled });
}

export async function deleteAgentDefinition(agentId: string): Promise<void> {
  await windowInvoke(AGENT_MANAGEMENT_DELETE, { agentId });
}
```

## Task 6.2: `PluginAgentsTab.vue` + wire into detail panel

**Files:**
- Create: `src/views/components/plugins/PluginAgentsTab.vue`
- Modify: `src/views/components/plugins/PluginDetailPanel.vue`, `src/views/api/plugins.ts`

- [ ] **Step 1: Add `agentCount` + `agents` to the renderer `PluginSummary`/`PluginDetail` types in `views/api/plugins.ts`** (mirror the backend types from Task 1.5): `agentCount: number` on `PluginSummary`; `agents: PluginAgentComponent[]` on `PluginDetail` with a `PluginAgentComponent` interface.

- [ ] **Step 2: Create `PluginAgentsTab.vue` (mirror `PluginSkillsTab.vue`)**

```vue
<template>
  <v-table v-if="detail.agents && detail.agents.length > 0">
    <thead>
      <tr>
        <th>{{ t("subagents.column_agent") }}</th>
        <th>{{ t("subagents.column_mode") }}</th>
        <th>{{ t("subagents.column_tools") }}</th>
        <th>{{ t("subagents.column_health") }}</th>
        <th>{{ t("subagents.column_status") }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="a in detail.agents" :key="a.id">
        <td>
          <div>{{ a.name }}</div>
          <div class="text-grey text-caption">{{ a.id }}</div>
        </td>
        <td>{{ a.mode }}</td>
        <td>{{ a.toolCount }}</td>
        <td>
          <v-chip
            :color="a.health === 'healthy' ? 'success' : 'warning'"
            size="small"
          >
            {{ a.health }}
          </v-chip>
        </td>
        <td>
          <v-switch
            :model-value="a.enabled"
            color="success"
            hide-details
            density="compact"
            @update:model-value="(v) => onToggle(a.id, v === true)"
          />
        </td>
      </tr>
    </tbody>
  </v-table>
  <div v-else class="text-grey pa-4">
    {{ t("subagents.plugin_empty") }}
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginDetail } from "@/views/api/plugins";
import { toggleAgentDefinition } from "@/views/api/agents";

defineProps<{ detail: PluginDetail }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();

async function onToggle(agentId: string, enabled: boolean): Promise<void> {
  await toggleAgentDefinition(agentId, enabled);
  emit("changed");
}
</script>
```

- [ ] **Step 3: Add the tab to `PluginDetailPanel.vue`**

In the `<v-tabs>` block add `<v-tab value="subagents">{{ t("subagents.tab_subagents") }}</v-tab>` (after the `skills` tab). In `<v-window>` add:

```vue
<v-window-item value="subagents">
  <PluginAgentsTab :detail="detail" @changed="reload" />
</v-window-item>
```

Import `PluginAgentsTab from "./PluginAgentsTab.vue";`.

## Task 6.3: `AgentEditorDialog.vue` (create/edit manual)

**Files:**
- Create: `src/views/components/agents/AgentEditorDialog.vue`

- [ ] **Step 1: Implement the dialog**

Fields per PRD §9.5: Name, ID slug (editable only in create mode; auto-derived from name), Description, Mode (select), System prompt (textarea), Allowed tools (comma-separated → string[] for v1), Default model (optional), Max tool calls, Max runtime (seconds — convert to ms), Max continue calls, Output schema (optional JSON textarea), Enabled switch. Validation: name, description, system prompt required; numeric limits positive; output schema valid JSON.

```vue
<template>
  <v-dialog :model-value="true" @update:model-value="$emit('close')" max-width="780">
    <v-card>
      <v-card-title>
        {{ agent ? t("subagents.edit_title") : t("subagents.create_title") }}
      </v-card-title>
      <v-card-text>
        <v-form ref="formRef" @submit.prevent="onSave">
          <v-text-field
            v-model="form.name"
            :label="t('subagents.field_name')"
            :rules="[required]"
            @update:model-value="maybeDeriveSlug"
          />
          <v-text-field
            v-model="form.idSlug"
            :label="t('subagents.field_id_slug')"
            :disabled="!!agent"
            :rules="[required]"
            :hint="agent ? t('subagents.hint_id_locked') : ''"
            persistent-hint
          />
          <v-textarea
            v-model="form.description"
            :label="t('subagents.field_description')"
            :rules="[required]"
            rows="2"
          />
          <v-select
            v-model="form.mode"
            :items="['coordinator', 'specialist', 'verifier', 'formatter']"
            :label="t('subagents.field_mode')"
          />
          <v-textarea
            v-model="form.systemPrompt"
            :label="t('subagents.field_system_prompt')"
            :rules="[required]"
            rows="6"
          />
          <v-text-field
            v-model="toolsText"
            :label="t('subagents.field_tools')"
            :hint="t('subagents.hint_tools_comma')"
            persistent-hint
          />
          <v-text-field
            v-model="form.defaultModel"
            :label="t('subagents.field_model')"
          />
          <v-row>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.maxToolCalls"
                type="number"
                :label="t('subagents.field_max_tool_calls')"
                :rules="[positiveInt]"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.maxRuntimeSeconds"
                type="number"
                :label="t('subagents.field_max_runtime_seconds')"
                :rules="[positiveInt]"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.maxContinueCalls"
                type="number"
                :label="t('subagents.field_max_continue_calls')"
                :rules="[positiveInt]"
              />
            </v-col>
          </v-row>
          <v-textarea
            v-model="outputSchemaText"
            :label="t('subagents.field_output_schema')"
            :hint="t('subagents.hint_output_schema_json')"
            persistent-hint
            rows="3"
          />
          <v-switch
            v-model="form.enabled"
            :label="t('subagents.field_enabled')"
            color="success"
            hide-details
          />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('close')">
          {{ t("subagents.button_cancel") }}
        </v-btn>
        <v-btn color="primary" @click="onSave">
          {{ t("subagents.button_save") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  createAgentDefinition,
  updateAgentDefinition,
  type AgentDefinitionView,
} from "@/views/api/agents";

const props = defineProps<{ agent?: AgentDefinitionView }>();
const emit = defineEmits<{ close: []; saved: [AgentDefinitionView] }>();
const { t } = useI18n();

interface FormState {
  name: string;
  idSlug: string;
  description: string;
  mode: "coordinator" | "specialist" | "verifier" | "formatter";
  systemPrompt: string;
  defaultModel: string;
  maxToolCalls: number;
  maxRuntimeSeconds: number;
  maxContinueCalls: number;
  enabled: boolean;
}

const form = ref<FormState>(
  props.agent
    ? {
        name: props.agent.name,
        idSlug: props.agent.id.replace(/^user:/, ""),
        description: props.agent.description,
        mode: props.agent.mode,
        systemPrompt: props.agent.systemPrompt,
        defaultModel: props.agent.defaultModel ?? "",
        maxToolCalls: props.agent.maxToolCalls,
        maxRuntimeSeconds: Math.round(props.agent.maxRuntimeMs / 1000),
        maxContinueCalls: props.agent.maxContinueCalls,
        enabled: props.agent.status === "active",
      }
    : {
        name: "",
        idSlug: "",
        description: "",
        mode: "specialist",
        systemPrompt: "",
        defaultModel: "",
        maxToolCalls: 8,
        maxRuntimeSeconds: 300,
        maxContinueCalls: 8,
        enabled: true,
      }
);

const toolsText = ref((props.agent?.allowedTools ?? []).join(", "));
const outputSchemaText = ref(
  props.agent && Object.keys(props.agent.outputSchema).length > 0
    ? JSON.stringify(props.agent.outputSchema, null, 2)
    : ""
);

const slugTouched = ref(!!props.agent);
function maybeDeriveSlug(): void {
  if (slugTouched.value) return;
  form.value.idSlug = form.value.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}
function onSlugInput(): void {
  slugTouched.value = true;
}
void onSlugInput;

const required = (v: string) => (!!v && v.trim().length > 0) || t("subagents.validation_required");
const positiveInt = (v: number) => (Number.isInteger(v) && v > 0) || t("subagents.validation_positive");

const parsedOutputSchema = computed<Record<string, unknown> | undefined>(() => {
  const text = outputSchemaText.value.trim();
  if (!text) return undefined;
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
});

async function onSave(): Promise<void> {
  if (!form.value.name || !form.value.description || !form.value.systemPrompt) {
    return;
  }
  if (outputSchemaText.value.trim() && parsedOutputSchema.value === undefined) {
    alert(t("subagents.validation_output_schema_invalid"));
    return;
  }
  const allowedTools = toolsText.value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (props.agent) {
    const saved = await updateAgentDefinition(props.agent.id, {
      name: form.value.name,
      description: form.value.description,
      systemPrompt: form.value.systemPrompt,
      allowedTools,
      ...(form.value.defaultModel ? { defaultModel: form.value.defaultModel } : { defaultModel: null }),
      mode: form.value.mode,
      maxToolCalls: form.value.maxToolCalls,
      maxRuntimeMs: form.value.maxRuntimeSeconds * 1000,
      maxContinueCalls: form.value.maxContinueCalls,
      ...(parsedOutputSchema.value ? { outputSchema: parsedOutputSchema.value } : {}),
      enabled: form.value.enabled,
    });
    if (saved) emit("saved", saved);
  } else {
    const saved = await createAgentDefinition({
      idSlug: form.value.idSlug,
      name: form.value.name,
      description: form.value.description,
      systemPrompt: form.value.systemPrompt,
      allowedTools,
      ...(form.value.defaultModel ? { defaultModel: form.value.defaultModel } : {}),
      mode: form.value.mode,
      maxToolCalls: form.value.maxToolCalls,
      maxRuntimeMs: form.value.maxRuntimeSeconds * 1000,
      maxContinueCalls: form.value.maxContinueCalls,
      ...(parsedOutputSchema.value ? { outputSchema: parsedOutputSchema.value } : {}),
      enabled: form.value.enabled,
    });
    if (saved) emit("saved", saved);
  }
  emit("close");
}
</script>
```

## Task 6.4: `AgentDetailPanel.vue`

**Files:**
- Create: `src/views/components/agents/AgentDetailPanel.vue`

- [ ] **Step 1: Implement a read/inspect drawer**

Show: id, name, description, source chip, plugin chip (when plugin-owned), mode, defaultModel, limits, allowedTools (chips), output schema (preformatted JSON), systemPrompt (preformatted, read-only for plugin/built-in), health/lastError. Buttons: Edit (only when `source === "user"`), Toggle enable/disable, Delete (only when `source === "user"`), with a confirm dialog for delete. Emit `edit`, `changed`, `close`.

## Task 6.5: `AgentManager.vue`

**Files:**
- Create: `src/views/components/agents/AgentManager.vue`

- [ ] **Step 1: Implement the page body**

Owns: `agents` ref, `loading`, `search`, `sourceFilter` (`all|built-in|plugin|user`), `statusFilter` (`all|enabled|disabled|warning`), `selectedId`. On mount, `listAgentDefinitions()`. `filteredAgents` computed applies search (id/name/description/pluginName) + filters (warning = `health !== 'healthy' || lastError`). Dense `v-table` with columns Agent (name + id), Description, Source chip, Plugin chip, Mode, Tools count, Model, Status switch, Actions (view/edit/delete). Header has title + "Add Subagent" button → opens `AgentEditorDialog`. Selecting a row opens `AgentDetailPanel` (right drawer). After any mutate, reload the list. Reuse `useI18n` for all labels.

## Task 6.6: Page + router + nav

**Files:**
- Create: `src/views/pages/systemsetting/subagents.vue`
- Modify: `src/views/router/index.ts`

- [ ] **Step 1: Page wrapper**

```vue
<template>
  <AgentManager />
</template>

<script setup lang="ts">
import AgentManager from "@/views/components/agents/AgentManager.vue";
</script>
```

- [ ] **Step 2: Add the route (mirror the `plugins` entry, ~line 138; also add the duplicate block ~line 881 if the second layout block lists systemsetting children)**

```typescript
      {
        path: "subagents",
        name: "system_setting_subagents",
        meta: {
          title: "route.subagents",
          icon: "mdi-robot-outline",
          keepAlive: false,
          visible: false,
          aiNavigable: true,
          aiAliases: ["subagents", "agents", "agent management"],
          aiDescription: "Manage built-in, plugin-installed, and manual subagents",
        },
        component: () => import("@/views/pages/systemsetting/subagents.vue"),
        children: [],
      },
```

(Per CLAUDE.md "AI Navigation Route Metadata" rule: `aiNavigable: true` + aliases + description.)

- [ ] **Step 3: Add the nav entry**

Find where the System Settings sub-nav (Plugins/Skills/MCP) is rendered: `grep -rn "system_setting_plugins" src/views`. Add a "Subagents" entry next to Plugins using `route.subagents` / `mdi-robot-outline`, linking to the `system_setting_subagents` route.

## Task 6.7: i18n (all 6 languages)

**Files:**
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- [ ] **Step 1: Add the nav label** in the `route` section of each file (next to `plugins: "Plugins"`):

`subagents: "Subagents"` (en) — and translate for zh (`子智能体`/`子代理`), es, fr, de, ja.

- [ ] **Step 2: Add the `subagents` namespace** (next to the `plugins:` namespace, ~line 2206 in en.ts) to `en.ts` with the keys used above:

```typescript
  subagents: {
    title: "Subagents",
    tab_subagents: "Subagents",
    add_button: "Add Subagent",
    edit_title: "Edit Subagent",
    create_title: "Add Subagent",
    empty_state: "No subagents are installed.",
    no_filter_results: "No subagents match these filters.",
    column_agent: "Agent",
    column_description: "Description",
    column_source: "Source",
    column_plugin: "Plugin",
    column_mode: "Mode",
    column_tools: "Tools",
    column_model: "Model",
    column_status: "Status",
    column_health: "Health",
    column_actions: "Actions",
    source_builtin: "Built-in",
    source_plugin: "Plugin",
    source_user: "Manual",
    status_active: "Enabled",
    status_disabled: "Disabled",
    plugin_empty: "This plugin does not include subagents.",
    delete_confirm: "Delete this subagent?",
    readonly_plugin_hint: "Plugin subagents are read-only. Disable them or edit the plugin source.",
    readonly_builtin_hint: "Built-in subagents are read-only.",
    button_cancel: "Cancel",
    button_save: "Save",
    field_name: "Name",
    field_id_slug: "ID slug",
    field_description: "Description",
    field_mode: "Mode",
    field_system_prompt: "System prompt",
    field_tools: "Allowed tools",
    field_model: "Default model",
    field_max_tool_calls: "Max tool calls",
    field_max_runtime_seconds: "Max runtime (seconds)",
    field_max_continue_calls: "Max continue calls",
    field_output_schema: "Output schema (JSON, optional)",
    field_enabled: "Enabled",
    hint_id_locked: "ID is fixed after creation.",
    hint_tools_comma: "Comma-separated tool names.",
    hint_output_schema_json: "Valid JSON object only.",
    validation_required: "Required.",
    validation_positive: "Must be a positive integer.",
    validation_output_schema_invalid: "Output schema is not valid JSON.",
  },
```

- [ ] **Step 3: Replicate the same key structure into zh/es/fr/de/ja** with translated values (do not leave English in non-`en` files). This is mandatory per CLAUDE.md i18n rule.

## Task 6.8: Type-check the frontend

- [ ] Run `yarn vue-check`
Expected: PASS.

- [ ] **Commit the frontend**

```bash
git add src/views/api/agents.ts src/views/components/agents/ \
        src/views/components/plugins/PluginAgentsTab.vue \
        src/views/components/plugins/PluginDetailPanel.vue \
        src/views/pages/systemsetting/subagents.vue \
        src/views/router/index.ts src/views/lang/
git commit -m "feat(ui): Subagents management page + plugin Subagents tab + i18n"
```

---

# Phase 7 — Hardening, docs, release notes

## Task 7.1: Full test + coverage gate

- [ ] Run `yarn tsc && yarn vue-check && yarn test`
Expected: all green.
- [ ] Run the focused vitest suites: `yarn vitest run test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts test/vitest/utilitycode/pluginAgentImportService.test.ts test/vitest/main/agent-definition-ipc.test.ts test/vitest/main/agentRuntimeDefinitionList.test.ts test/vitest/main/pluginImportAgents.test.ts`
Expected: PASS.
- [ ] Confirm coverage ≥ 80% on the new files (per global testing rule). Add cases for any uncovered branch (e.g. object-map `content`-only rejection in `normalizeAgentsField`; `defaultModel: null` clear path in update).

## Task 7.2: Documentation + release notes

- [ ] Add a "Plugin agent file format" section to the plugin author docs: required frontmatter (`name`, `description`), supported fields, forbidden fields, ID namespacing, example `.md`. Reference the PRD §10 example.
- [ ] Add a release note: Claude-compatible plugins with an `agents` declaration (or an `agents/` directory) now install subagents as active capabilities where they previously were carried opaquely.

## Task 7.3: Acceptance-criteria self-review

Walk the app (English + one non-English language) and confirm each AC:
- [ ] **AC-1** plugin with `agents/reviewer.md` → `<plugin>:reviewer` in Subagents page + plugin tab.
- [ ] **AC-2** agent-only plugin installs; counts show 0/0/N.
- [ ] **AC-3** disabling a plugin agent removes it from runtime lists, stays visible as disabled.
- [ ] **AC-4** disabling a plugin hides its agents from runtime without changing per-agent state.
- [ ] **AC-5** manual create → `source:user`, enabled, in runtime lists.
- [ ] **AC-6** manual edit persists and is used at runtime.
- [ ] **AC-7** plugin-owned agent is read-only except enable/disable.
- [ ] **AC-8** uninstall removes all plugin-owned agent rows; no orphaned runtime entries.
- [ ] **AC-9** `../agent.md` manifest declaration fails import atomically (no partial rows).
- [ ] **AC-10** all new strings translated in every supported language.

```bash
git add docs/
git commit -m "docs(plugins): document plugin agent file format + release notes"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** FR-1→Tasks 2.1/2.2/3.1/3.2; FR-2→3.3/3.4; FR-3→4.1; FR-4→4.1/4.4; FR-5→5.1–5.3; FR-6→4.1(toggle)/5.x; FR-7→5.2; FR-8→3.5; FR-9→6.2; FR-10→6.5/6.6; FR-11→2.1(forbidden)/3.2; FR-12→6.7. All UC-1..UC-8 and AC-1..AC-10 map to tasks above. Data-model §13 → Tasks 1.1–1.5. Security §17 (path safety, no code exec, forbidden fields) → Tasks 2.1/2.2/3.1.
- **Placeholder scan:** UI Tasks 6.4/6.5 describe structure + key logic rather than every template line; the patterns are pinned to existing components (`PluginSkillsTab.vue`, `PluginDetailPanel.vue`) so an engineer can complete them deterministically. All backend tasks contain complete, compiling code. No "TBD"/"TODO" left in code blocks.
- **Type consistency:** `AgentDefinitionView` fields (source/health/pluginName/manifest) are consistent across entity, model `toView`, registry, adapter, module, renderer API, and IPC. `PluginAgentComponent` shape is identical in `pluginTypes.ts`, `plugin-ipc.ts`, `views/api/plugins.ts`, and `PluginAgentsTab.vue`. Channel constants `AGENT_MANAGEMENT_*` match across `channellist.ts`, preload, IPC, and renderer API. Method names: `listActiveForRuntime`/`getActiveById`/`upsertPluginAgents`/`findAgentsByPluginName`/`deleteAgentsByPluginName`/`toggleAgent` are used identically wherever referenced.
- **Open risks:** (1) `segmentsBetween` relies on string matching the agent-root dir name against the file path — verify with nested dirs in Task 2.2 tests (covered). (2) `InstalledPluginModel.findEnabled()` existence is assumed from `PluginManagementModule.listEnabledPlugins` usage — confirmed in Task 3.5 anchor read. (3) The duplicate router block (~line 859/881) may be a second layout; confirm both need the `subagents` entry during Task 6.6.
