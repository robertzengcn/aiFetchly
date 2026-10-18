# Yellow Pages Scraper Plugin — Implementation Plan (Phases 1–3 core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic host async-MCP foundation (PRD §22 HOST-01..HOST-17 subset, design TD-01..TD-08) and the independent `yellow-pages-scraper-plugin` package so a plugin MCP tool can run >4 minutes with progress, cancellation, deadlines, structured failures, recovery budgets, and file artifacts.

**Architecture:** The desktop host owns jobs/policy/runtime/browser/artifacts/recovery; the plugin process owns Puppeteer scraping behind one MCP tool. Plugin declares `runtime: "aifetchly-node"` + `entry`; host launches `process.execPath` with `ELECTRON_RUN_AS_NODE=1` injected after env sanitization. Async policy routes the tool through `ToolJobRegistry` with one authoritative deadline propagated to the SDK call.

**Tech Stack:** TypeScript, Zod v3, MCP SDK (`@modelcontextprotocol/sdk`), TypeORM (host artifacts metadata only in files for v1), puppeteer-core (plugin), esbuild (plugin bundle), Vitest.

**Execution location:** Desktop work in git worktree `.worktrees/yellow-pages-plugin` (branch `yellow-pages-plugin`, off `dev`). Plugin work in the **independent** repository `/home/robertzeng/project/yellow-pages-scraper-plugin` (own git repo, own node_modules — never the desktop's, per PRD §19.9/§19.11).

**Explicitly deferred (documented, not silently dropped):**
- HUB-01/HUB-02 Hub publication + managed/ticket install (PRD Phase 3b) — needs Hub deployment + release infra.
- Legacy removal (PRD Phase 4 / AC-18) — gated on Hub delivery acceptance by PRD §27.
- In-session AI recovery broker (HOST-12, Phase 5) — optional phase per PRD §15.
- Renderer artifact UI (design §13.4 frontend + i18n) — IPC layer ships; UI wiring follows.
- Plugin full 11-adapter migration matrix — v1 ships `yellowpages-com` adapter + catalog; others staged as fixture-driven follow-ups (design §11.3).
- Playwright E2E for the plugin flow.

---

## Current-state facts (verified on dev @ 0df1366e)

- `ToolJobRegistry.start()` allocates `jobId` internally; spawn callback gets `ToolJobSpawnHandle` **without** `jobId`; `cancel()` aborts `handle.signal` + runs handlers, relabels to `cancelled` immediately; no cleanup-settlement wait exists.
- `AIChatQueryLoop.executePreparedToolWithTimeout` resolves timeout class ONLY from `skillRegistry.getSkill(name)` then `inferTimeoutClassByName` → plugin MCP tools (not skills) get `"network"` (90s foreground).
- `executeAsyncTool` → `deps.executeTool` (SkillExecutor → `executeViaToolExecutor` → `ToolExecutor.execute` → static `executeMCPTool(toolName, params)` — **context dropped** → `MCPToolService.executeMCPTool` (fixed 240s race, no signal/deadline, `client.callTool` which THROWS on `isError`) → `MCPClient.callToolContent` (SDK, `resetTimeoutOnProgress: true`, no onprogress).
- `ToolExecutor.executeMCPTool` wraps ANY returned value as `{ success: true, result }`; `SkillExecutor.executeViaToolExecutor` sets `success: true` whenever executor returns → nested `{success:false}` invisible (PRD §21.7).
- `pollAsyncJobToCompletion` 30-min cap returns a failure **without cancelling** the job (PRD §0 row 5).
- `SupervisedStdioTransport` spawns with `buildSanitizedChildEnv` (denies `ELECTRON_*`/`AIFETCHLY_*` from declarations). No runtime/entry launch variant.
- `PluginMcpServerDeclaration` (pluginTypes.ts:104) has no `runtime`/`entry`. `normalizeMcpDeclaration` requires non-empty `command` for stdio.
- `PluginImportService` persists MCP rows (command/argsJson/envJson, origin "plugin", auto-trust + discover at import) — needs runtime-descriptor persistence via `metadata._aifetchlyRuntimeV1`.
- `BrowserExecutableResolver` exists (`src/childprocess/managed-browser/`), consumed by `ManagedBrowserModule` (line 306).
- Existing test homes: `test/vitest/utilitycode/pluginMcpDeclaration.test.ts`, `test/vitest/main/MCPToolServiceTimeout.test.ts`, `test/vitest/main/service/ToolJobRegistry.signal.test.ts`.

---

### Task 1: TD-01 — Plugin execution contracts

**Files:**
- Create: `src/entityTypes/pluginExecutionTypes.ts`
- Modify: `src/entityTypes/pluginTypes.ts` (PluginMcpServerDeclaration + PluginManifest)
- Modify: `src/service/PluginMcpDeclaration.ts` (runtime/entry normalization)
- Test: `test/vitest/utilitycode/pluginExecutionTypes.test.ts`, extend `test/vitest/utilitycode/pluginMcpDeclaration.test.ts`

`pluginExecutionTypes.ts` contents (complete contract):

```typescript
import { z } from "zod";
import type { ToolTimeoutClass } from "@/service/ToolTimeoutPolicy";

/** Reserved host-owned MCP metadata key for the normalized runtime descriptor. */
export const HOST_RUNTIME_METADATA_FIELD = "_aifetchlyRuntimeV1" as const;

export const PLUGIN_MCP_HOST_RUNTIME = "aifetchly-node" as const;
export type PluginMcpHostRuntime = typeof PLUGIN_MCP_HOST_RUNTIME;

export const PLUGIN_TOOL_POLICY_RESULT_CONTRACT = "aifetchly.plugin-result.v1" as const;

export const pluginToolPolicySchema = z.object({
  contractVersion: z.literal(1),
  timeoutClass: z.enum(["fast", "network", "browser", "async"]),
  maxRunMs: z.number().int().min(1_000).max(60 * 60_000),
  supportsProgress: z.boolean(),
  supportsPartialResult: z.boolean(),
  cancellable: z.boolean(),
  maxConcurrentPerConversation: z.number().int().min(1).max(4),
  resultContract: z.literal("aifetchly.plugin-result.v1").optional(),
});

export const pluginHostRequirementsSchema = z.object({
  contractVersion: z.literal(1),
  capabilities: z.record(z.number().int().min(1)),
});

export const pluginCapabilitiesSchema = z.object({
  browserExecutable: z.boolean().optional(),
  fileArtifacts: z.array(z.enum(["json", "csv"])).optional(),
});

export type PluginToolPolicy = z.infer<typeof pluginToolPolicySchema>;
export type PluginHostRequirements = z.infer<typeof pluginHostRequirementsSchema>;
export type PluginCapabilities = z.infer<typeof pluginCapabilitiesSchema>;

/** Persisted runtime descriptor (host-owned, inside MCP metadata under HOST_RUNTIME_METADATA_FIELD). */
export interface PluginRuntimeDescriptorV1 {
  readonly contractVersion: 1;
  readonly runtime: PluginMcpHostRuntime;
  /** Plugin-relative entry path, lexically validated at persist + launch. */
  readonly entry: string;
}

/** Host capabilities this build actually implements (version = contract version). */
export const HOST_CAPABILITY_VERSIONS: Readonly<Record<string, number>> = {
  "mcp-host-node": 1,
  "mcp-managed-async": 1,
  "browser-executable": 1,
  "plugin-file-artifacts": 1,
};

export const HOST_MAX_RUN_MS = 30 * 60_000;
export const HOST_MAX_CONCURRENT_PER_CONVERSATION = 1;

/** Clamp a validated plugin policy to host maxima. */
export function clampPluginToolPolicy(policy: PluginToolPolicy): PluginToolPolicy {
  return {
    ...policy,
    maxRunMs: Math.min(policy.maxRunMs, HOST_MAX_RUN_MS),
    maxConcurrentPerConversation: Math.min(
      policy.maxConcurrentPerConversation,
      HOST_MAX_CONCURRENT_PER_CONVERSATION
    ),
  };
}

export function evaluateHostRequirements(req: PluginHostRequirements): {
  readonly ok: boolean;
  readonly missing: readonly string[];
} {
  const missing: string[] = [];
  for (const [name, version] of Object.entries(req.capabilities)) {
    const have = HOST_CAPABILITY_VERSIONS[name];
    if (have === undefined || have < version) missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}

/** Execution options threaded host→service→client for managed-async MCP calls. */
export interface PluginToolExecutionOptions {
  readonly deadlineEpochMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    readonly phase: "queued" | "running" | "fetching" | "extracting" | "finalizing";
    readonly message: string;
    readonly progress: number | null;
    readonly partialCount: number | null;
    readonly expectedCount: number | null;
  }) => void;
}

/** Host context file v1 written by the resolver, read by the plugin entry. */
export interface PluginHostContextV1 {
  readonly version: 1;
  readonly mode: "discovery" | "execute";
  readonly executionId: string;
  readonly pluginName: string;
  readonly pluginVersion: string;
  readonly outputDirectory?: string;
  readonly browser?: { readonly executablePath: string; readonly version: string };
  readonly deadlineEpochMs?: number;
}

export const pluginRuntimeDescriptorSchema = z.object({
  contractVersion: z.literal(1),
  runtime: z.literal(PLUGIN_MCP_HOST_RUNTIME),
  entry: z.string().min(1).max(512),
});
```

`pluginTypes.ts` changes:
- `PluginMcpServerDeclaration` gains `readonly runtime?: "aifetchly-node";` and `readonly entry?: string;`.
- `PluginManifest` gains optional typed extras (validated by manifest service later): `hostRequirements?`, `capabilities?`, `toolPolicies?: Record<string, PluginToolPolicy>` — but keep index signature; typed validation happens in `PluginToolPolicyRegistry` load, not the base manifest parse (older code must keep accepting unknown extras).

`normalizeMcpDeclaration` changes (PluginMcpDeclaration.ts): before the stdio command check —
```typescript
if (decl.runtime !== undefined) {
  // Host-runtime variant: runtime + entry, mutually exclusive with command/args.
  if (decl.runtime !== "aifetchly-node") { /* mcp-config-invalid: unknown runtime */ }
  if (decl.command !== undefined || (decl.args ?? []).length > 0) {
    /* mcp-config-invalid: runtime and command are mutually exclusive */
  }
  if (typeof decl.entry !== "string" || decl.entry.length === 0) {
    /* mcp-config-invalid: runtime server requires entry */
  }
  if (decl.entry.includes("..") || path.isAbsolute(decl.entry)) {
    /* path-outside-plugin */
  }
  // normalized.command stays undefined; runtime descriptor rides in metadata.
  const normalized: NormalizedMcpServer = { ...base, transport: "stdio",
    metadata: { ...base.metadata, [HOST_RUNTIME_METADATA_FIELD]: { contractVersion: 1, runtime: decl.runtime, entry: decl.entry } } };
}
```
`NormalizedMcpServer` gains `readonly runtime?: "aifetchly-node"; readonly entry?: string;`.

Steps: write failing tests (schema accepts valid policy/requirements; rejects unknown timeoutClass; runtime+command conflict; entry traversal; unknown runtime) → implement → `yarn vitest run test/vitest/utilitycode/pluginExecutionTypes.test.ts --config vite.utilityCode.config.mjs` → commit `feat(plugin-exec): typed tool policy, host requirements, and runtime contracts`.

### Task 2: TD-02 — Host runtime resolver + trusted launch

**Files:**
- Create: `src/service/PluginMcpRuntimeResolver.ts`
- Modify: `src/modules/mcp/SupervisedStdioTransport.ts`
- Modify: `src/service/MCPToolService.ts` (`buildClientConfig` runtime branch)
- Test: `test/vitest/main/service/PluginMcpRuntimeResolver.test.ts`, extend `test/vitest/main/modules/mcp/SupervisedStdioTransport.test.ts`

`SupervisedStdioTransport` new option + start() branch:

```typescript
export interface TrustedNodeLaunch {
  /** Host executable (process.execPath) — never taken from plugin data. */
  readonly executable: string;
  /** Absolute, host-validated entry file inside the plugin install root. */
  readonly entryFile: string;
}
// options: trustedNodeLaunch?: TrustedNodeLaunch
// start(): when trustedNodeLaunch is set,
//   argv = [entryFile, ...args]; command = trustedNodeLaunch.executable;
//   env = { ...buildSanitizedChildEnv(this.options.env), ELECTRON_RUN_AS_NODE: "1" }  // AFTER sanitization
```
`buildSanitizedChildEnv` continues to reject plugin-supplied `ELECTRON_*`; the injection is trusted-host code, applied after, and cannot be overridden (spread order).

`PluginMcpRuntimeResolver`:
```typescript
export interface ResolvedPluginLaunch {
  readonly pluginName: string;
  readonly runtime: "aifetchly-node";
  readonly executable: string;      // process.execPath
  readonly entryFile: string;       // realpath-validated inside install root
  readonly cwd: string;             // plugin install root
  readonly ownerId: string;         // owned-process family id
  readonly hostContextFile: string; // absolute path of written context
}
export class PluginMcpRuntimeResolver {
  constructor(deps?: { execPath?: string; fs?: {...}; tmpRoot?: string; now?: () => number })
  resolveForDiscovery(pluginName: string, entry: string): Result<ResolvedPluginLaunch, PluginError>
  resolveForExecute(pluginName: string, entry: string, context: PluginHostContextV1): Result<...>
  release(launch: ResolvedPluginLaunch): void  // delete context file (idempotent)
}
```
- Entry validation: `resolvePluginRelativePath(installRoot, entry)` (existing helper), then `realpathSync` containment + `isFileSync`.
- Context file: `writeFileSync(tmp + ".tmp")` then rename (atomic), mode 0600, in `path.join(os.tmpdir(), "aifetchly-plugin-ctx", executionId + ".json")`.
- `MCPToolService.buildClientConfig`: when `metadata[HOST_RUNTIME_METADATA_FIELD]` parses against `pluginRuntimeDescriptorSchema` → set `config.hostRuntime = { pluginName, entry }` (new `MCPClientConfig.hostRuntime?: { pluginName: string; entry: string }`); `MCPClient.connectStdio` uses `PluginMcpRuntimeResolver.resolveForDiscovery` + passes `trustedNodeLaunch` into transport options and `cwd`.
- Import path persistence: `PluginImportService` MCP row write copies runtime descriptor from normalized metadata (already rides in `server.metadata` → `entity.metadata`).

Steps: failing tests (trusted launch spawns execPath with entry argv + injected env while rejecting plugin `ELECTRON_RUN_AS_NODE` via config.env; entry traversal/symlink escape rejected; context file written atomically + released; discovery config uses runtime not command) → implement → run → commit `feat(mcp): host-managed aifetchly-node runtime with trusted stdio launch`.

### Task 3: TD-03 — Policy registry + query-loop resolution

**Files:**
- Create: `src/service/PluginToolPolicyRegistry.ts`
- Modify: `src/service/AIChatQueryLoop.ts` (`executePreparedToolWithTimeout` ~4868)
- Test: `test/vitest/main/service/PluginToolPolicyRegistry.test.ts`

```typescript
export interface PluginToolPolicyEntry {
  readonly pluginName: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly policy: PluginToolPolicy; // clamped
}
export class PluginToolPolicyRegistry {
  private entries = new Map<string, PluginToolPolicyEntry>(); // key: canonical AI tool name
  registerFromManifest(pluginName: string, manifest: unknown): { errors: PluginError[] }
  unregisterPlugin(pluginName: string): void
  resolveByToolName(aiToolName: string): PluginToolPolicyEntry | null
  static canonicalKey(pluginName: string, serverName: string, toolName: string): string
}
export function getPluginToolPolicyRegistry(): PluginToolPolicyRegistry // process singleton
```
- Loads from `manifest.toolPolicies` (key `server/tool`), validates each with `pluginToolPolicySchema`, clamps, requires the referenced server to exist in manifest `mcpServers`; policy key `serverName` uses UNSCOPED server name.
- `evaluateHostRequirements(manifest.hostRequirements)` — unsupported required capability ⇒ registration error (activation failure, design §5.4).

Query loop change (between skill and inference):
```typescript
const pluginPolicy = getPluginToolPolicyRegistry().resolveByToolName(effectiveCall.name);
const cls: ToolTimeoutClass =
  skill?.resolveTimeoutClass?.(effectiveCall.arguments ?? {}) ??
  skill?.timeoutClass ??
  pluginPolicy?.policy.timeoutClass ??
  inferTimeoutClassByName(effectiveCall.name);
```
`pluginPolicy?.policy.maxRunMs` threads into Task 5/7 as the job deadline (default `HOST_MAX_RUN_MS`).

Wiring: `PluginComponentRegistryService.applyLoadedPlugins()` → after `loadAllPlugins()`, re-register policies from `loaded.enabled` manifests + unregister disabled. This is the HOST-01/02 deliverable; absence of a Yellow Pages branch anywhere in the loop is a hard requirement (PRD §24.4).

Steps: failing tests (register valid; reject unknown capability / invalid policy / missing server; resolve by canonical name; unregister on disable) → implement + wire loop → run → commit `feat(ai-chat): plugin MCP tool policy registry and loop resolution`.

### Task 4: TD-04+07 — Context propagation + deadline-aware calls

**Files:**
- Modify: `src/service/ToolExecutor.ts` (`executeInternal`/`executeMCPTool` statics — accept `context?: ModuleExecutionContext`)
- Modify: `src/service/MCPToolService.ts` (`executeMCPTool(serverId, toolName, params, options?: PluginToolExecutionOptions)`)
- Modify: `src/modules/MCPClient.ts` (`callToolContent` options gain `maxTotalTimeoutMs`, `resetTimeoutOnProgress`, `onprogress`)
- Test: extend `test/vitest/main/MCPToolServiceTimeout.test.ts`, new `test/vitest/main/MCPToolServiceAsync.test.ts`

Semantics:
- Foreground (no options): EXACT current behavior — 240s race + `callTool` throwing path. Zero regression (PRD §24.3).
- Async (options present): no 240s race; `remaining = deadlineEpochMs - now`; reject if ≤ cleanup reserve (5s) without spawning; `client.callToolContent(tool, params, { timeoutMs: remaining, maxTotalTimeoutMs: remaining, signal, resetTimeoutOnProgress: false, onprogress })`; disconnect in `finally` unchanged; host-context written in execute mode with deadline + browser + outputDirectory (browser via Task 8 service; outputDirectory via Task 10 staging).
- `ToolExecutor.executeMCPTool` builds options from `context.signal` + a deadline carried in `context` (new optional field, see Task 5) + progress mapping.

Steps: failing tests with a fake MCP client (injected via constructor) — async call with 10-min deadline never trips 240s timer (fake timers); expired deadline rejects pre-spawn; signal abort propagates to SDK call → implement → commit `feat(mcp): deadline-aware async execution with context propagation`.

### Task 5: TD-05 — Result normalization + progress bridge

**Files:**
- Create: `src/service/McpResultNormalizer.ts`
- Modify: `src/service/ToolExecutor.ts` (MCP branch uses normalizer; no `{success:true,result}` wrap)
- Modify: `src/service/SkillExecutor.ts` (`executeViaToolExecutor` preserves nested `success === false`)
- Modify: `src/modules/MCPClient.ts` (onprogress mapping)
- Modify: `src/service/ToolJobRegistry.ts` (`ToolJobSpawnHandle.jobId`; `updateProgress` unchanged)
- Modify: `src/service/AIChatQueryLoop.ts` (`executeAsyncTool` emitProgress also updates registry; domain-envelope result mapping in `pollAsyncJobToCompletion` completed branch)
- Test: `test/vitest/main/service/McpResultNormalizer.test.ts`, `test/vitest/main/service/ToolJobRegistry.jobId.test.ts` (extend signal test)

Normalizer precedence (design §10.4, complete):

```typescript
export interface NormalizedMcpToolOutcome {
  readonly success: boolean;
  readonly payload: Record<string, unknown>; // domain envelope (bounded), or { error } for fatal
  readonly isDomainEnvelope: boolean;
}
export function normalizeMcpToolOutcome(call: MCPToolCallContent): NormalizedMcpToolOutcome
```
1. `structuredContent` valid object with boolean `success` → envelope (that success wins).
2. else first text block parses as JSON object with boolean `success` → envelope.
3. `isError: true` → `{ success: false, payload: { error: preserveStructuredDiagnostics(call) } }` — nested `success:true` inside is IGNORED (contradiction rule).
4. non-envelope + `isError:false` → legacy generic: `{ success: true, payload: <existing extraction> }`.
5. Transport/JSON-RPC failures stay exceptions → ToolExecutor maps to sanitized `{ success:false, error }` (no argv/env leakage — message only).

`SkillExecutor.executeViaToolExecutor`: `success: isRecord(result) && typeof result.success === "boolean" ? result.success : true`.

Progress: SDK `onprogress` (params: progress/total/message) → map units=records → `{ phase: "extracting", message (bounded 200 chars), progress: total? progress/total : null, partialCount: progress, expectedCount: total ?? null }` → `options.onProgress` → context.emitProgress. In async path `executeAsyncTool`'s emitProgress calls BOTH `onProgress?.(...)` (renderer) and `registry.updateProgress(handle.jobId, ...)`.

Steps: failing tests for all 5 precedence rows + registry jobId + progress fan-out → implement → commit `feat(mcp): preserve plugin result success semantics and bridge progress`.

### Task 6: Deadline expiry cancellation + settled wait

**Files:**
- Modify: `src/service/ToolJobRegistry.ts` (`onSettled` handlers + `waitForSettled(jobId, timeoutMs)`)
- Modify: `src/service/AIChatQueryLoop.ts` (`pollAsyncJobToCompletion` deadline branch)
- Test: extend `test/vitest/main/service/ToolJobRegistry.signal.test.ts`, new `pollDeadline` unit tests where feasible

- Registry: `handle.onSettled(cb)` registered by async MCP executor (cleanup continuation); settle fires exactly once from resolve/reject/cancel paths; `waitForSettled` resolves on terminal status or timeout.
- Poll loop: compute `deadlineMs = min(policy?.maxRunMs ?? HOST_MAX_RUN_MS, ASYNC_POLL_MAX_MS)`; at expiry → `registry.cancel(jobId)`; `await registry.waitForSettled(jobId, 5_000)`; return `{ success:false, result: { error: "JOB_DEADLINE_EXCEEDED", job_id, cancelled: true } }` — never the old "may still be running" text.

Steps: failing tests (cancel at expiry invokes settle + wait resolves; late resolve ignored after cancel) → implement → commit `fix(ai-chat): cancel async jobs and await cleanup at deadline expiry`.

### Task 7: TD-06 — Browser capability

**Files:**
- Create: `src/service/PluginBrowserCapabilityService.ts`
- Test: `test/vitest/main/service/PluginBrowserCapabilityService.test.ts`

```typescript
export type BrowserCapabilityResult =
  | { readonly ok: true; readonly descriptor: BrowserExecutableDescriptor }
  | { readonly ok: false; readonly errorCode: "browser_dependency_missing"; readonly searchedPaths: readonly string[] };
export class PluginBrowserCapabilityService {
  constructor(deps?: { resolver?: BrowserExecutableResolver; managedCandidates?: () => readonly string[] })
  resolve(): BrowserCapabilityResult
}
```
Wraps the existing resolver (configured → managed cache via `ManagedBrowserModule` candidate listing → system). No download, no settings exposure — returns only the descriptor consumed by the host-context writer (Task 4). Steps: tests → implement → commit `feat(plugin): generic browser executable capability for plugins`.

### Task 8: TD-07 — Recovery ledger + duplicate suppression

**Files:**
- Create: `src/service/PluginRecoveryLedger.ts`
- Modify: `src/service/ToolJobRegistry.ts` (job `fingerprint` on start + `findActiveJobByFingerprint`)
- Modify: `src/service/AIChatQueryLoop.ts` (`executeAsyncTool` admission)
- Test: `test/vitest/main/service/PluginRecoveryLedger.test.ts`

Ledger (in-memory, conversation+plugin scoped, PRD §12.5):
```typescript
export interface RecoveryRecordInput { conversationId; pluginName; searchIdentity; code; category; allowedStrategies; retryAfterMs?: number }
export interface RecoveryReservation { errorRef: string; strategy: string }
export class PluginRecoveryLedger {
  recordFailure(input: RecoveryRecordInput): string            // host errorRef (opaque)
  validateAndReserve(args: { conversationId; pluginName; searchIdentity; previousErrorId?: unknown; strategy?: unknown }): 
    { ok: true; context: { attempt: number; strategy: string } } | { ok: false; reason: "unknown_error_ref" | "budget_exhausted" | "cooldown" | "strategy_not_allowed" | "fingerprint_repeat" | "missing_recovery_field" }
  completeAttempt(errorRef: string, outcome: "failed" | "succeeded"): void
}
```
- Default 2 retries / hard max 3 per logical search identity; identical (strategy+canonical args) fingerprint never repeats after same failure code; rate-limit category enforces `retryAfterMs`; model-supplied counters ignored; restart ⇒ all refs invalid (memory only).
- Duplicate suppression: canonical fingerprint `sha256(conversationId|tool|query|location|platform|details|fields|maxResults)`; `executeAsyncTool` checks `registry.findActiveJobByFingerprint(...)` first → structured `JOB_ALREADY_RUNNING` result bound to THIS toolCallId (no second job).
- Retry wiring in loop: when a plugin-policy async tool fails with a domain envelope carrying `error`, call `ledger.recordFailure(...)`; when the retry call includes `recovery`, validate/reserve before `registry.start`. (Bounded, generic — no Yellow Pages branch.)

Steps: failing tests (forged/foreign error ref rejected; concurrent double-reserve impossible; cooldown enforced; fingerprint repeat rejected; duplicate running job suppressed) → implement → commit `feat(ai-chat): cross-call recovery ledger and duplicate job suppression`.

### Task 9: TD-08 — File artifact bridge

**Files:**
- Create: `src/service/PluginFileArtifactService.ts`, `src/modules/PluginFileArtifactModule.ts`
- Create: `src/main-process/communication/plugin-artifact-ipc.ts`
- Modify: `src/preload.ts` (channels), `src/background.ts` or communication index (registration)
- Test: `test/vitest/main/service/PluginFileArtifactService.test.ts`

Service (design §13): host-resolved root `<userData>/plugin-artifacts/<user-scope>/`; `provisionStaging(executionId)` → dir; `validateCandidates(stagingDir, candidates)` (containment, regular file, no symlink, ext json/csv, ≤100MiB, record count re-count); `promote(executionId, conversationId, pluginName, candidates)` → atomic copy to `artifacts/<artifactId>/{content.json|csv, metadata.json}` (host-assigned opaque id, sha256, sizes); `list(conversationId)`, `preview(conversationId, artifactId, maxRows)`, `exportToPath(conversationId, artifactId, dest)`, `delete(...)`, `sweepExpired(retentionMs=30d)` + `reconcileStartupJournal()`. Module wraps service for IPC ownership checks (conversation match). IPC channels: `plugin-artifact:list|preview|export|delete` — validated with Zod, ownership-checked; no renderer paths/MIME overrides. **No renderer UI this pass** (documented follow-up ⇒ no i18n/component-test obligations yet).

Steps: failing tests (traversal/symlink candidate rejected; wrong ownership rejected; promotion atomic + idempotent; preview bounded; CSV formula neutralization) → implement → commit `feat(plugin): host file-artifact store with ownership-scoped IPC`.

### Task 10: HOST-13 — documentation corrections

Grep for stale `{ async: true` / `job_id` immediate-return claims in `src/config/skillsRegistry.ts` skill descriptions + `docs/superpowers/specs/2026-06-27-async-tool-job-polling.md` + `docs/test-manual/aiChatV2-async-jobs.md`; align wording with managed-async (loop polls, model sees real result). Commit `docs: correct managed-async tool descriptions`.

### Task 11: Phase 2 — independent plugin repository

**Location:** `/home/robertzeng/project/yellow-pages-scraper-plugin` (own `git init`, own package.json/node_modules; NEVER imports desktop `@/` or its node_modules — PRD §19.11, verified by a lint rule test).

Layout (design §4):
```
.aifetchly-plugin/plugin.json   # name/version/skills/mcpServers/permissions/hostRequirements/capabilities/toolPolicies (Task 1 schema)
.mcp.json                        # { mcpServers: { scraper: { transport: "stdio", runtime: "aifetchly-node", entry: "dist/yellow-pages-mcp.cjs", timeout: 30000 } } }
skills/yellow-pages-scraper/SKILL.md
commands/yellow-pages.md
contracts/{scrape-input,scrape-result,host-context,progress,partial}.v1.schema.json + fixtures
src/childprocess/{mcp-server.ts,HostContextReader.ts,McpToolHandlers.ts,ShutdownCoordinator.ts}
src/scraper/{ScrapeCoordinator.ts,BrowserSession.ts,DeterministicRecovery.ts,RecordNormalizer.ts,ResultWriter.ts,ScraperError.ts}
src/platforms/{PlatformAdapter.ts,PlatformCatalog.ts,adapters/yellowpages-com.ts}
test/{unit,contracts}/…
scripts/build.ts (esbuild → dist/yellow-pages-mcp.cjs, cjs, bundle puppeteer-core + sdk + zod)
package.json (deps: @modelcontextprotocol/sdk, puppeteer-core, zod; dev: typescript, esbuild, vitest, @types/node)
```

Key behaviors (PRD §23 PLUGIN-01..12):
- `mcp-server.ts`: MCP SDK `Server` over stdio; parses `--host-context-file <path>` argv (host-injected, not model data); registers `scrape_yellow_pages` (input zod-validated: query/location 1–256 chars, platform enum|auto, maxResults ≤1000 default 100, fields allowlist, recovery object) + `list_yellow_pages_platforms`; emits `notifications/progress` with the received progressToken (units = collected records, `total` omitted when unknown); respects request abort signal → stops page loops, closes browser in `finally`; discovery mode (no browser) initialize/list-tools works.
- `ScrapeCoordinator` pipeline (design §11.2): validate → staging output → BrowserSession.launch(executablePath from host context) → adapter.search → classifyPage (listings|empty|consent|challenge|unexpected) → extract/normalize/dedupe → optional detail enrichment (concurrency 2) → incremental NDJSON + periodic progress → stop at cap/exhaustion/deadline/cancel → finalize JSON+CSV+`candidates.json` atomically → close browser → return bounded `ScrapeResultV1` (schemaVersion 1, preview ≤5 records, 32KiB budget).
- `ScraperError` taxonomy: codes from PRD §13.3, categories §13.2, `safeObservation` (title/origin/path/selectorMatchCounts — never cookies/HTML/full paths), `allowedStrategies`.
- `DeterministicRecovery`: 2 retries per transient op w/ exponential backoff, packaged fallback selectors, consent handling, skip-malformed-listing; auth/captcha/dependency stop immediately.
- `ResultWriter`: NDJSON staging; CSV with quote escaping + formula neutralization (`=+-@` prefix); atomic rename; candidates only list finalized files.
- `yellowpages-com` adapter ported from desktop `src/config/platforms/yellowpages-com.ts` selectors, adapted to the plugin `PlatformAdapter` interface; `PlatformCatalog` marks all other legacy adapters as not-ready entries (id/countries/fields) so `list_yellow_pages_platforms` is honest.
- Tests: input validation bounds, error classification, adapter fallback order, writer finalization + formula neutralization, context-file parsing (missing browser ⇒ `BROWSER_EXECUTABLE_MISSING`), host-context redaction (no secrets in outputs).
- CI-less build script + `yarn build` producing the single cjs; verify no `require("electron")` / no `@/` imports (test asserts).

Commit sequence in the plugin repo: `chore: scaffold independent plugin repository`, `feat(contracts): versioned scrape/host contracts`, `feat(mcp): stdio server with host-context and progress`, `feat(scraper): coordinator, browser session, deterministic recovery`, `feat(platforms): yellowpages.com adapter and catalog`, `feat(output): staged result writer with candidate manifest`, `test: unit and contract suites`, `build: esbuild bundle to dist/yellow-pages-mcp.cjs`.

### Task 12: Final gates

- Worktree: `yarn vitest run --config vite.main.config.mjs` (targeted: new + touched suites), one-shot `npx tsc --noEmit` (memory: watch-mode trap), `yarn test:components` NOT required (no renderer change).
- Plugin repo: `yarn install`, `yarn build`, `yarn vitest run`.
- Report: what's done per HOST-xx/PLUGIN-xx, explicit deferral list, known gaps.

---

## Self-review

- Spec coverage: HOST-01(T3) 02(T3) 03(T4) 04/05(T5) 06(T4+T6) 07(T4) 08(T4/T5 progress notifications) 09(T5) 10(T8) 11(T4+T6) 13(T10) 14(T2) 15(T7) 16(T8) 17(T9); HOST-12/18 + HUB-01/02 + Phase-4 removal explicitly deferred. PLUGIN-01..12 covered by Task 11 (dependency diagnostics PLUGIN-10 via host-context browser check). PRD §25.1/25.2 host+client test rows map to Tasks 2–8 tests.
- Placeholders: none — deferred items are named with rationale, not "TBD" inside scope.
- Type consistency: `PluginToolExecutionOptions`/`PluginHostContextV1` defined in Task 1 and consumed unchanged in Tasks 2/4/7/9/11; `HOST_RUNTIME_METADATA_FIELD` single source.
