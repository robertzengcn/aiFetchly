# Phase 17: Hooks - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 15 (NEW: 6, MODIFIED: 9)
**Analogs found:** 15 / 15 (every file has a verified in-repo analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/entity/AIFetchlyWorkspaceTrust.entity.ts` (NEW) | model/entity | CRUD | `src/entity/AgentDefinition.entity.ts` + `src/entity/Auditable.entity.ts` + `src/entity/Workspace.entity.ts` | exact |
| `src/model/AIFetchlyWorkspaceTrust.model.ts` (NEW) | model/repository | CRUD | `src/model/AgentDefinition.model.ts` | exact |
| `src/modules/AIFetchlyWorkspaceTrustModule.ts` (NEW) | module/service | CRUD | `src/modules/AgentDefinitionModule.ts` | exact |
| `src/service/hooks/HookRegistry.ts` (MODIFY) | service/registry | in-memory reconcile | `src/service/AgentDefinitionRegistry.ts:145-270` (`AgentDefinitionRegistryImpl`) | exact |
| `src/service/hooks/executors/CommandHookExecutor.ts` (REUSE-in-worker) | service/executor | request-response | (self) — reused as-is inside worker | exact |
| `src/service/hooks/HookDispatcher.ts` (MODIFY) | service/dispatcher | event-driven | (self) + command-hook branch routes to worker | exact (self) |
| `src/service/hooks/hookExecutionClient.ts` (NEW) | service/IPC-client | request-response | `src/service/workspaceWatch/WorkspaceWatchManager.ts` (fork+message round-trip) | role-match |
| `src/service/hooks/hookFileFrontmatter.ts` (NEW) | utility/validator | transform | `src/service/slashCommands/agentFrontmatter.ts` (`buildAgentDefinition`) | exact (role) |
| `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` (MODIFY) | service/loader | file-I/O | (self) `tryReadAgentFiles` L466-612 | exact (self) |
| `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` (MODIFY) | config | config | (self) — add `maxHooksPerSource` | exact (self) |
| `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` (MODIFY) | service/sync | event-driven | (self) `applyWorkspaceSnapshot` L151-168 | exact (self) |
| `src/service/workspaceWatch/WorkspaceConfigScanner.ts` (MODIFY) | service/scanner (worker) | file-I/O | (self) `tryReadAgentFiles` L596-727 | exact (self) |
| `src/service/workspaceWatch/WorkspaceTrustFilter.ts` (MODIFY) | service/utility | transform | (self) `derivePhase14Trust` L35-45 | exact (self) |
| `src/service/workspaceWatch/buildWorkspaceHookDefinitions.ts` (NEW) | utility/transform | transform | `src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts` | exact |
| `src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts` (MODIFY) | service/singleton | event-driven | (self) `approvalCache` L45 + `markWorkspaceApproved` L86-88 | exact (self) |
| `src/childprocess/hook-execution/HookExecutionWorker.ts` (NEW) | childprocess/worker-entry | request-response | `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts` | exact (role+flow) |
| `src/childprocess/hook-execution/workerProtocol.ts` (NEW) | config/protocol | request-response | `src/service/workspaceWatch/WorkspaceWatchProtocol.ts` | exact |
| `src/entityTypes/aifetchlyConfigTypes.ts` (CONFIRM-ONLY) | types | n/a | (self) — `AIFetchlySourceTrust.hooks` + `snapshot.hooks[]` already present | exact (self) |
| `forge.config.js` (MODIFY) | config/build | config | `forge.config.js` aifetchly-config worker entry | role-match |
| `vite.hookExecutionWorker.config.mjs` (NEW) | config/build | config | `vite.aifetchlyConfigWorker.config.mjs` | exact |

## Pattern Assignments

### `src/service/hooks/HookRegistry.ts` (service/registry, in-memory reconcile)

**Analog:** `src/service/AgentDefinitionRegistry.ts:145-270` (`AgentDefinitionRegistryImpl`) — VERIFIED.

**Delta from analog:** Hooks key on `event+matcher` (NOT by name), so there is NO `byName` index and NO `rebuildNameIndex()`. `getMatchingHooks` already re-sorts on every read (HookRegistry.ts:81-110). The new `sourceIndex: Map<sourceId, Set<id>>` keys on the full sourceId string ("user", "workspace:<id>"); `SOURCE_PRIORITY` lookup uses the hook's `source` enum field (`HookSource` — note `"project"` is the workspace-scoped enum value; see RESEARCH Pitfall 4/A3).

**Additions to existing class (`HookRegistryImpl` lines 54-139):**

Current state (verified lines 55-56):
```typescript
private readonly byEvent = new Map<HookEventName, RegistryEntry[]>();
private seq = 0;
```

Add `sourceIndex` field (clone from AgentDefinitionRegistry.ts:149):
```typescript
private readonly sourceIndex = new Map<string, Set<string>>();
```

**Core `replaceSource` pattern** (clone shape from `AgentDefinitionRegistry.ts:219-243`, adapted for byEvent map):
```typescript
replaceSource(sourceId: string, hooks: readonly HookDefinition[]): void {
  // 1. Remove old entries for this sourceId from byEvent.
  const existing = this.sourceIndex.get(sourceId);
  if (existing) {
    for (const id of existing) {
      for (const list of this.byEvent.values()) {
        const idx = list.findIndex((e) => e.hook.id === id);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
  }
  // 2. Insert fresh defensive copies of the new hooks. Reuse existing push().
  const next = new Set<string>();
  for (const h of hooks) {
    const copy: HookDefinition = { ...h };
    this.push(copy);
    next.add(copy.id);
  }
  this.sourceIndex.set(sourceId, next);
  // 3. NO rebuildNameIndex() — hooks have no byName index (delta from agent analog).
}

unregisterSource(sourceId: string): void {
  this.replaceSource(sourceId, []);
}
```

**Existing helpers to reuse unchanged:** `push()` (HookRegistry.ts:117-123) already updates `byEvent` + assigns `seq`; `getMatchingHooks()` (lines 81-110) already sorts by `SOURCE_PRIORITY` + `seq` and returns `matched.map((e) => e.hook)` (defensive array but shallow — mirror agent's `{...d}` if deeper copy needed).

---

### `src/entity/AIFetchlyWorkspaceTrust.entity.ts` (model/entity, CRUD)

**Analog:** `src/entity/AgentDefinition.entity.ts` + `src/entity/Auditable.entity.ts` + `src/entity/Workspace.entity.ts` — VERIFIED. Column spec from tech-design §13.2.

**Imports pattern** (clone from AgentDefinition.entity.ts:1-3):
```typescript
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
```

**Core entity pattern** (from AgentDefinition.entity.ts:6-9 + Workspace.entity.ts unique index convention):
```typescript
@Entity("aifetchly_workspace_trust")
@Index(["workspaceRootHash"], { unique: true })
export class AIFetchlyWorkspaceTrustEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 128, nullable: false, unique: true })
  workspaceRootHash: string;   // SHA-256 of normalized root path (stable across moves)

  @Order(2)
  @Column("varchar", { length: 1024, nullable: false })
  workspaceRootPath: string;

  @Order(3)
  @Column("varchar", { length: 64, nullable: true })
  conversationId: string | null;

  // 5 per-capability flags (TRS-02 / tech-design §13.2). v2.0 writes all-as-block (D-TrustUX).
  @Order(4)
  @Column("boolean", { default: false, nullable: false })
  trustInstructions: boolean;
  @Order(5)
  @Column("boolean", { default: false, nullable: false })
  trustCommands: boolean;
  @Order(6)
  @Column("boolean", { default: false, nullable: false })
  trustAgents: boolean;
  @Order(7)
  @Column("boolean", { default: false, nullable: false })
  trustHooks: boolean;
  @Order(8)
  @Column("boolean", { default: false, nullable: false })
  trustSkills: boolean;
}
```
`AuditableEntity` (src/entity/Auditable.entity.ts) already supplies `createdAt`/`updatedAt` via `@Order(9999)` columns — do NOT redeclare them.

---

### `src/model/AIFetchlyWorkspaceTrust.model.ts` (model/repository, CRUD)

**Analog:** `src/model/AgentDefinition.model.ts` — VERIFIED (lines 1-76).

**Imports + class shape** (clone from AgentDefinition.model.ts:1-32):
```typescript
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AIFetchlyWorkspaceTrustEntity } from "@/entity/AIFetchlyWorkspaceTrust.entity";
import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";

export class AIFetchlyWorkspaceTrustModel extends BaseDb {
  public repository: Repository<AIFetchlyWorkspaceTrustEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIFetchlyWorkspaceTrustEntity);
  }
  // upsert / getByRootHash / listAll — mirror AgentDefinitionModel.upsert/getActiveById
}
```
`BaseDb` (src/model/Basedb.ts:3-36) provides `this.sqliteDb` + `ensureConnection()`. Worker-no-DB is enforced by the repository guard convention (CLAUDE.md) — the model is main-process only.

**Key method signatures** (mirror AgentDefinitionModel.upsert/getActiveById pattern):
```typescript
async upsert(rootHash: string, rootPath: string, flags: AIFetchlySourceTrust, conversationId?: string | null): Promise<void>
async getByRootHash(rootHash: string): Promise<AIFetchlyWorkspaceTrustEntity | null>
async listApproved(): Promise<AIFetchlyWorkspaceTrustEntity[]>  // for migration seed source
```

---

### `src/modules/AIFetchlyWorkspaceTrustModule.ts` (module/service, CRUD)

**Analog:** `src/modules/AgentDefinitionModule.ts` — VERIFIED (lines 1-31).

**Imports + class shape** (clone from AgentDefinitionModule.ts:1-14):
```typescript
import { BaseModule } from "@/modules/baseModule";
import { AIFetchlyWorkspaceTrustModel } from "@/model/AIFetchlyWorkspaceTrust.model";
import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";

export class AIFetchlyWorkspaceTrustModule extends BaseModule {
  private readonly model: AIFetchlyWorkspaceTrustModel;

  constructor() {
    super();                 // BaseModule resolves dbpath from Token service
    this.model = new AIFetchlyWorkspaceTrustModel(this.dbpath);
  }

  async getTrust(rootHash: string): Promise<AIFetchlySourceTrust | null> {
    await this.ensureConnection();
    return this.model.getByRootHash(rootHash) /* → map entity → AIFetchlySourceTrust */;
  }

  async setTrust(rootHash: string, rootPath: string, flags: AIFetchlySourceTrust): Promise<void> { ... }

  // D-Migration (CONTEXT.md): one-time idempotent seed — see "Migration seed" below.
  async ensureMigrationSeed(): Promise<void> { ... }
}
```
`BaseModule` provides `this.dbpath` + `ensureConnection()` (same path-resolution contract every Module uses — never `app.getPath()` directly).

---

### `src/childprocess/hook-execution/HookExecutionWorker.ts` (childprocess/worker-entry, request-response)

**Analog:** `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts` — VERIFIED (lines 1-243).

**Delta from analog:** The watcher worker is long-lived + scan-only (watch/unwatch/rescan/shutdown). The hook-execution worker is request/response per firing (`execute-hook` → `hook-result`), long-lived singleton (lazy spawn on first command-hook dispatch — Pitfall 1). It imports the existing `executeCommand` from `src/service/hooks/executors/CommandHookExecutor.ts` (pure stdlib — verified) and runs it in-process.

**Worker entry-point pattern** (clone from WorkspaceConfigWatchWorker.ts:196-243):
```typescript
import { executeCommand } from "@/service/hooks/executors/CommandHookExecutor";
import { workerCommandSchema, type HookExecutionCommand, type HookExecutionEvent } from "./workerProtocol";

function emit(event: HookExecutionEvent): void {
  if (process.send) process.send(event);
}

async function handleCommand(cmd: HookExecutionCommand): Promise<void> {
  switch (cmd.type) {
    case "execute-hook": {
      // Reuse executeCommand() — spawn(shell:false), env allowlist, timeout, caps.
      // The worker NEVER imports DB/TypeORM/Electron/modules (WAT-02 grep gate).
      const result = await executeCommand({ /* map cmd → CommandHookExecutionInput */ });
      emit({ type: "hook-result", hookRunId: cmd.hookRunId, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, error: /* optional */ });
      return;
    }
    case "shutdown": { return; }
    default: { const _exhaustive: never = cmd; void _exhaustive; return; }
  }
}

function initializeWorker(): void {
  process.on("message", (raw: unknown) => {
    const parsed = workerCommandSchema.safeParse(raw);  // WAT-06 zod both directions
    if (!parsed.success) { console.warn("[HookExecutionWorker] dropped malformed:", parsed.error.message); return; }
    void handleCommand(parsed.data).catch((err: unknown) => {
      emit({ type: "hook-result", hookRunId: "__unknown__", stdout: "", stderr: String(err), durationMs: 0, error: { message: String(err) } });
    });
  });
  process.on("uncaughtException", (e) => { /* emit error + exit(1) — mirror lines 219-225 */ });
  process.on("unhandledRejection", (r) => { /* mirror lines 227-231 */ });
}

if (require.main === module || process.env.WORKER_TYPE === "hook-execution") {
  initializeWorker();
}
export { initializeWorker };
```

**Bootstrap guard** (clone WorkspaceConfigWatchWorker.ts:236-241 — `WORKER_TYPE` env marker convention).

---

### `src/childprocess/hook-execution/workerProtocol.ts` (config/protocol, request-response)

**Analog:** `src/service/workspaceWatch/WorkspaceWatchProtocol.ts` — VERIFIED (lines 1-145).

**Core zod discriminated-union pattern** (clone shape from WorkspaceWatchProtocol.ts:78-100 + 111-142):
```typescript
import { z } from "zod";

const executeHookCommandSchema = z.object({
  type: z.literal("execute-hook"),
  hookRunId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  envAllowlist: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
  stdinPayload: z.string(),             // JSON.stringify(input)
}).strict();

const shutdownCommandSchema = z.object({ type: z.literal("shutdown") }).strict();

export const workerCommandSchema = z.discriminatedUnion("type", [
  executeHookCommandSchema, shutdownCommandSchema,
]);
export type HookExecutionCommand = z.infer<typeof workerCommandSchema>;

const hookResultEventSchema = z.object({
  type: z.literal("hook-result"),
  hookRunId: z.string().min(1),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
  error: z.object({ message: z.string(), timedOut: z.boolean().optional() }).optional(),
}).strict();

export const workerEventSchema = z.discriminatedUnion("type", [ hookResultEventSchema ]);
export type HookExecutionEvent = z.infer<typeof workerEventSchema>;
```
`strict()` on every object (rejects smuggled fields — mirror WorkspaceWatchProtocol.ts:85,89,92,99). Both directions safeParse'd; malformed → non-fatal diagnostic (HOK-02 SC4).

---

### `src/service/hooks/hookExecutionClient.ts` (service/IPC-client, request-response)

**Analog:** `src/service/workspaceWatch/WorkspaceWatchManager.ts` (fork + `workerCommandSchema`/`workerEventSchema` round-trip + `hookRunId` correlation). For the fork/lifecycle mirror, the watcher worker spawn path in `WorkspaceWatchManager` is the structural template.

**Delta from analog:** Request/response per firing (correlate by `hookRunId`), long-lived singleton (Pitfall 1). Enforces `timeoutMs` + `abortSignal` (kill worker child on timeout — mirror CommandHookExecutor.ts:144-151 timer). On malformed `hook-result` → synthesize non-fatal failure result (never throw into the stream).

---

### `src/service/hooks/hookFileFrontmatter.ts` (utility/validator, transform)

**Analog:** `src/service/slashCommands/agentFrontmatter.ts` (`buildAgentDefinition`) — referenced via `buildWorkspaceAgentDefinitions.ts:26`. Plus RESEARCH §Code Examples L438-489.

**Core pure-validator pattern** (from RESEARCH L461-489 — mirrors `buildAgentDefinition`'s `{ok:true, definition} | {ok:false, diagnostic}` shape):
```typescript
import { z } from "zod";
import type { CommandHookDefinition, HookEventName } from "@/entityTypes/hookTypes";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";

const hookEntrySchema = z.object({
  event: z.enum(["PreToolUse", "PostToolUse", "SessionStart", "Stop"]),
  matcher: z.string().max(128).optional(),
  command: z.string().min(1).optional(),
  skill: z.string().min(1).optional(),       // D-Vocabulary (no-op this phase)
  timeoutMs: z.number().int().positive().max(60_000).optional(),
  cwd: z.string().optional(),
  envAllowlist: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  failureMode: z.enum(["warn", "block"]).optional(),
}).refine((d) => d.command || d.skill, { message: "hook entry must declare either 'command' or 'skill'" });

export function buildHookDefinition(
  raw: unknown,
  sourceMeta: { source: "user" | "workspace"; sourceId: string; relativePath: string },
  index: number
): { ok: true; definition: CommandHookDefinition } | { ok: false; diagnostic: AIFetchlyConfigDiagnostic } { /* ... */ }
```
Pure module: NO fs/DB/Electron (mirror agentFrontmatter contract). Never throws — invalid → diagnostic.

---

### `src/service/workspaceWatch/buildWorkspaceHookDefinitions.ts` (utility/transform, transform)

**Analog:** `src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts` — VERIFIED (lines 1-116).

**Core pattern** (clone shape from buildWorkspaceAgentDefinitions.ts:59-116):
```typescript
export function buildWorkspaceHookDefinitions(
  drafts: readonly WorkspaceHookDraft[],
  workspaceId: string
): { definitions: CommandHookDefinition[]; diagnostics: AIFetchlyConfigDiagnostic[] } {
  const definitions: CommandHookDefinition[] = [];
  const diagnostics: AIFetchlyConfigDiagnostic[] = [];
  const sourceMeta = { source: "workspace" as const, sourceId: `workspace:${workspaceId}`, sourceLabel: "Workspace", requiresTrust: true };
  for (const draft of drafts) {
    try {
      const result = buildHookDefinition(draft.raw, sourceMeta, draft.index);
      if (result.ok) definitions.push(result.definition);
      else diagnostics.push(result.diagnostic);
    } catch (err) {
      // defense-in-depth — never abort the batch (mirror lines 84-98)
      diagnostics.push(/* scanner-io-error diagnostic */);
    }
  }
  return { definitions, diagnostics };
}
```
**Delta from analog:** No `detectUnknownTools` equivalent (hooks have no tool-allowlist). Skill-ref hooks register but resolve to no-op diagnostic at fire time (D-Vocabulary).

---

### `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` (service/sync, event-driven)

**Analog:** (self) `applyWorkspaceSnapshot` — VERIFIED (lines 151-168).

**Trust filter line pattern** (add ONE line mirroring the `agents:` line at L165):
```typescript
const filtered: AIFetchlyConfigSnapshot = {
  ...snapshot,
  instructions: trust.instructions ? snapshot.instructions : [],
  commands: trust.commands ? snapshot.commands : [],
  agents: trust.agents ? snapshot.agents : [],
  hooks: trust.hooks ? snapshot.hooks : [],   // <- Phase 17 NEW LINE (mirror L165)
};
```
Also wire `HookRegistry.replaceSource(sourceId, definitions)` in `applySnapshot` mirroring the agents apply path, and add `hookRegistry.replaceSource(sourceId, [])` to `removeSource` (L175-179). Verify `snapshot.hooks[]` slot already exists (CONFIRMED — aifetchlyConfigTypes.ts:100).

---

### `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` (service/loader, file-I/O)

**Analog:** (self) `tryReadAgentFiles` — VERIFIED (lines 466-612).

**Delta from analog:** Hooks read a SINGLE `hooks/hooks.json` file (NOT a directory of `.md`). Drop frontmatter parsing (parseRestrictedFrontmatter L566) — use `JSON.parse` + zod (`hookEntrySchema`). Keep CFG-04 size cap (`hooksJsonBytes` 128KB — AIFetchlyConfigConstants.ts:38, already defined) + CFG-06 count cap (`maxHooksPerSource` — ADD it). Keep CFG-05 path safety (`resolveConfigRelativePath` L496) + diagnostic shape (`{severity, source, sourceId, filePath, code, message, recoverable}`).

Skeleton (mirror tryReadAgentFiles L466-612):
```typescript
private async tryReadHookFiles(
  files: AIFetchlyConfigFileSnapshot[],
  hooks: CommandHookDefinition[],
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<void> {
  const source = "user" as const;
  const sourceId = "user";
  const hooksJsonPath = path.join(this.rootPath, HOOKS_DIR, HOOKS_JSON_FILE); // hooks/hooks.json
  // stat → CFG-04 size check (hooksJsonBytes) → readFile → file snapshot push
  // JSON.parse → zod array(hookEntrySchema) → for each: buildHookDefinition(...) with index
  // count cap: maxHooksPerSource → file-too-large diagnostic + break (mirror L522-533)
}
```

---

### `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` (config, config)

**Analog:** (self) `AIFETCHLY_CONFIG_LIMITS` — VERIFIED (lines 30-51).

**Delta:** Add ONE constant inside `AIFETCHLY_CONFIG_LIMITS` (CFG-06):
```typescript
/** Cap on hooks accepted from a single source (DoS hygiene) — Phase 17. */
maxHooksPerSource: 100,
```
`hooksJsonBytes` (L38) already exists (128KB) — no change. Optionally extend `AIFETCHLY_DIAGNOSTIC_CODES` (L89-102) with `"hooks-json-invalid"` + `"unsupported-event"` + `"skill-registry-not-available"` codes (the closed-set diagnostic-code convention — DX-01).

---

### `src/service/workspaceWatch/WorkspaceConfigScanner.ts` (service/scanner worker, file-I/O)

**Analog:** (self) `tryReadAgentFiles` — VERIFIED (lines 596-727).

**Delta from analog:** Scan a SINGLE `hooks/hooks.json` file → push raw `WorkspaceHookDraft[]` (bytes + hash + parsed-JSON-as-unknown). Worker does NOT validate against the zod schema (WAT-02: validation is main-side via `buildWorkspaceHookDefinitions`). Push `kind: "hook"` to `files[]` (aifetchlyConfigTypes.ts:35 confirms `"hook"` is a valid `AIFetchlyConfigFileKind`). Mirror CFG-04 size + path-safety + `ioDiagnostic`/`diagnostic` helpers (L613, L622-634).

---

### `src/service/workspaceWatch/WorkspaceTrustFilter.ts` (service/utility, transform)

**Analog:** (self) `derivePhase14Trust` — VERIFIED (lines 35-45).

**Delta:** Replace the BODY (keep the export signature so callers don't change — L14-18 comment explicitly foreshadows this). v2.0 under D-TrustUX: all flags track the same binary approval, but the read path now consults an entity-backed sync cache (Pitfall 5). Either (a) accept an `AIFetchlySourceTrust` param the caller pre-resolved, or (b) become a thin pass-through to a sync cache hydrated by the Module. Keep `hooks`/`skills` flags flowing (no longer hardcoded `false`).

---

### `src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts` (service/singleton, event-driven)

**Analog:** (self) `approvalCache` — VERIFIED (line 45) + `markWorkspaceApproved` (lines 86-88).

**Delta (D-Migration / Pitfall 5):** Replace the write-only in-memory `approvalCache: Map<string, boolean>` with an entity-backed `Map<workspaceRootHash, AIFetchlySourceTrust>` sync-read cache, hydrated at `initWorkspaceWatchManager` startup (after `ensureMigrationSeed`) + on every `markWorkspaceApproved`/revoke write. The `trustResolver` closure (L67-69) reads this map sync; the entity is the durable source. `markWorkspaceApproved(id)` becomes a thin wrapper that calls the Module to write all-flags-true + rehydrates the map. Revoke (Pitfall 2) must now reflect immediately: set flags false + trigger rescan → `applyWorkspaceSnapshot` drops hooks → `HookRegistry.replaceSource(sourceId, [])`.

---

### `forge.config.js` + `vite.hookExecutionWorker.config.mjs` (config/build)

**Analog:** the aifetchly-config worker registration — RESEARCH cites `forge.config.js:401-411` + `vite.aifetchlyConfigWorker.config.mjs`.

**Pattern:** add a new entry to `forge.config.js` `build` section with `entry: 'src/childprocess/hook-execution/HookExecutionWorker.ts'` + `config: 'vite.hookExecutionWorker.config.mjs'`. Clone the vite config file verbatim, swapping the entry + output names.

---

## Shared Patterns

### Source-Replacement (Atomic Reconcile)
**Source:** `src/service/AgentDefinitionRegistry.ts:219-243` (`replaceSource`)
**Apply to:** `HookRegistry.replaceSource` / `unregisterSource`
```typescript
// 1. Delete all old entries for sourceId via sourceIndex: Map<sourceId, Set<id>>
// 2. Insert defensive copies ({...h}) of new entries
// 3. Rebuild dependent indexes (agents: byName; hooks: NONE — keyed by event+matcher)
```

### Trust Filter (Drop Before Mutation)
**Source:** `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:155-167`
**Apply to:** the `hooks:` line addition (one-liner, mirrors `agents:` at L165)
```typescript
hooks: trust.hooks ? snapshot.hooks : [],
```

### Three-Layer DB (Entity + Model + Module)
**Source:** `AgentDefinition.entity.ts` + `AgentDefinition.model.ts` + `AgentDefinitionModule.ts`
**Apply to:** `AIFetchlyWorkspaceTrust.entity.ts` + `.model.ts` + `Module.ts`
- Entity: `extends AuditableEntity`, `@PrimaryGeneratedColumn`, `@Index([...], {unique:true})`, `@Order(n)` + `@Column`
- Model: `extends BaseDb`, `public repository = this.sqliteDb.connection.getRepository(Entity)`, `async upsert/get...`
- Module: `extends BaseModule`, `super()` resolves `this.dbpath`, `await this.ensureConnection()` before every model call. IPC handlers call the Module, NEVER the repository (CLAUDE.md mandatory rule).

### Worker IPC Protocol (zod both directions)
**Source:** `src/service/workspaceWatch/WorkspaceWatchProtocol.ts:78-142`
**Apply to:** `src/childprocess/hook-execution/workerProtocol.ts`
```typescript
export const workerCommandSchema = z.discriminatedUnion("type", [ /* strict() objects */ ]);
export const workerEventSchema  = z.discriminatedUnion("type", [ /* strict() objects */ ]);
// safeParse both directions; malformed → non-fatal diagnostic, never crash
```

### Worker Entry-Point Lifecycle
**Source:** `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts:196-243`
**Apply to:** `src/childprocess/hook-execution/HookExecutionWorker.ts`
```typescript
function initializeWorker(): void {
  process.on("message", (raw) => { /* safeParse → handleCommand → catch→emitError */ });
  process.on("uncaughtException", ...);  process.on("unhandledRejection", ...);
}
if (require.main === module || process.env.WORKER_TYPE === "hook-execution") initializeWorker();
```

### Diagnostic Shape (Phase 13–16 closed-set codes)
**Source:** `AIFetchlyConfigConstants.ts:89-102` (`AIFETCHLY_DIAGNOSTIC_CODES`) + diagnostic objects in `AIFetchlyConfigLoader.ts:499-507`
**Apply to:** all new hook diagnostics
```typescript
{ severity: "warning", source: "user"|"workspace", sourceId, filePath, code: "<from AIFETCHLY_DIAGNOSTIC_CODES>", message, recoverable: true }
```

### Command Execution (`spawn` shell:false)
**Source:** `src/service/hooks/executors/CommandHookExecutor.ts:76-271`
**Apply to:** reused as-is INSIDE the new worker (pure stdlib — verified). Do NOT rewrite. Delta: invocation now routes through worker IPC (D-Vocabulary), never spawned from main for config-sourced hooks (HOK-02 SC2).

### PreToolUse DENY precedent (in-repo)
**Source:** `src/service/hooks/builtinHooks.ts:25-38` (`builtin-block-dangerous-shell` — `continue:false` + reason)
**Apply to:** config-sourced command hooks deny by writing `{"continue": false, "reason": "..."}` to stdout → `HookResultAggregator` (L77-80) → `StreamEventProcessor` (L504-506) → `buildHookBlockedToolResult`. Phase 17 FEEDS this path; does NOT rewrite it.

## No Analog Found

None. Every NEW file has a verified in-repo analog (worker entry, worker protocol, validator, transform converter, entity/model/module triplet, registry source-replacement). Every MODIFIED file is self-analogous (extend an existing method/line). The riskiest new code per RESEARCH (worker IPC round-trip + entity migration seed) both have direct templates (SkillWorker/WorkspaceConfigWatchWorker + AgentDefinitionModel.upsert).

## Metadata

**Analog search scope:** `src/service/hooks/`, `src/service/aifetchlyConfig/`, `src/service/workspaceWatch/`, `src/service/AgentDefinitionRegistry.ts`, `src/entity/`, `src/model/`, `src/modules/`, `src/childprocess/aifetchly-config/`, `src/entityTypes/`, `forge.config.js`.
**Files scanned:** 17 (read this session); several targeted greps.
**Pattern extraction date:** 2026-07-10
