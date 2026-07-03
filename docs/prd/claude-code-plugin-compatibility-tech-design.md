# Claude Code Plugin Compatibility — Technical Design

Version: 1.0
Date: 2026-07-03
Status: Draft
Source PRD: `docs/prd/claude-code-plugin-compatibility-prd.md`
Normative reference: `https://code.claude.com/docs/en/plugins` (snapshot 2026-07-03)

## 1. Purpose

Translate the Claude Plugin Compatibility PRD into an implementation-facing design. The technical goal is to make Claude Code plugins installable and runnable in AiFetchly by adding a thin translation layer at the manifest/skill boundary, without forking the existing runtime.

**Hard rule**: adapters never mutate disk. All translation is in-memory and runs on every load. This guarantees round-trip fidelity — an installed Claude plugin stays byte-identical to its upstream source.

## 2. Existing System Anchors

The compatibility layer builds on these existing surfaces. Nothing here replaces them.

### 2.1 Plugin pipeline

```text
src/entityTypes/pluginTypes.ts                 # types + PluginError codes
src/service/PluginManifestService.ts           # manifest load + validate
src/service/PluginLoaderService.ts             # memoized loadAllPlugins()
src/service/PluginImportService.ts             # install coordination
src/service/PluginInstallService.ts            # versioned cache writes
src/service/PluginRuntimeCache.ts              # memoize invalidation
src/service/PluginMcpDeclaration.ts            # MCP servers.json parse + normalize
src/service/PluginComponentRegistryService.ts  # flat registry → Skill/MCP runtime
src/service/PluginDiagnosticsService.ts        # per-component health
src/service/pluginPaths.ts                     # getPluginInstallRoot, etc.
src/service/pluginSources/                     # fetchers: zip/folder/git/github/npm/url
src/modules/PluginManagementModule.ts          # business logic
src/main-process/communication/plugin-ipc.ts   # IPC handlers
src/views/api/plugins.ts                       # renderer API
```

### 2.2 Skill runtime

```text
src/entity/InstalledSkill.entity.ts
src/entityTypes/skillTypes.ts
src/model/InstalledSkill.model.ts
src/modules/SkillManagementModule.ts
src/service/SkillImportService.ts
src/service/SkillExecutor.ts
src/service/SandboxedSkillExecutor.ts
src/service/SkillWorkerClient.ts
src/service/SkillPermissionService.ts
src/childprocess/SkillWorker.ts
src/config/skillsRegistry.ts
```

Current AiFetchly skill shape (per skill directory): `manifest.json` + skill content files. The `manifest.json` is the on-disk skill descriptor that `SkillImportService` consumes.

### 2.3 MCP runtime

```text
src/entity/MCPTool.entity.ts
src/modules/MCPToolModule.ts
src/modules/MCPClient.ts
src/service/MCPToolService.ts
```

MCP servers are declared via a `mcp/servers.json` file with shape `{ mcpServers: Record<string, PluginMcpServerDeclaration> }`, parsed by `parseServersJson()` and normalized by `normalizeMcpDeclaration()` in `PluginMcpDeclaration.ts`. Per-server field constraints: stdio requires `command`; sse/websocket require `host` or `url`.

### 2.4 Hooks runtime (Phase 3 target)

```text
src/service/hooks/HookRegistry.ts
src/service/hooks/builtinHooks.ts
```

`HookRegistry` is the existing event-dispatch surface. Plugin hooks will be projected onto it through a dedicated registration path that dispatches into `SkillWorker`, never into the main process.

### 2.5 Database architecture (unchanged)

Per project rules:
- IPC handlers MUST NOT touch TypeORM repositories directly.
- DB access lives in `src/model/` (extends `BaseDb`).
- Business logic lives in `src/modules/` (extends `BaseModule`).
- DB path resolution always via `Token` + `USERSDBPATH` through base classes.
- Worker processes NEVER access the DB; they send IPC messages.

This design adds **no new entities, no migrations, no schema changes** in any phase.

## 3. Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│ Claude plugin on disk                                       │
│   .claude-plugin/plugin.json                                │
│   skills/*.md (YAML frontmatter + markdown body)            │
│   .mcp.json  OR  manifest.mcp = { ... }                     │
│   hooks/hooks.json  (Phase 3)                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
         PluginManifestService.loadFromDirectory()
         ├── locateManifestFile() probes 3 paths in order
         └── tags result with format: "aifetchly" | "claude"
                           │
            ┌──────────────┴───────────────┐
            ▼                              ▼
   AiFetchly path (existing)     Claude path (new)
   validate as before            ClaudePluginAdapter.adapt()
                                 ├── normalize component path arrays
                                 ├── resolve inline mcp OR .mcp.json
                                 └── carry unsupported fields as opaque
                           │
                           ▼
              PluginLoaderService.forceLoad()
              ├── per-skill: ClaudeSkillFormatAdapter.parse()
              │            → InstalledSkill-shape (in-memory only)
              ├── per-mcp:  PluginMcpDeclaration (existing path)
              └── collect errors per-component
                           │
                           ▼
              Existing runtime (unchanged)
              SkillExecutor, MCPToolModule, HookRegistry
```

Five design principles:

1. **Two formats, one internal model.** The on-disk world has two shapes; the in-memory world has one. Translation happens at one boundary.
2. **Adapters are pure.** `ClaudePluginAdapter.adapt()` is synchronous, side-effect-free, and depends only on its input object. Testable without mocks.
3. **Failure is structured, never thrown.** Adapters return `{ success: true, ... } | { success: false, errors: PluginError[] }` matching the existing `PluginManifestLoadResult` pattern.
4. **Disk is read-only after install.** Adapters run on every load; nothing is cached on disk.
5. **Unsupported components survive round-trip.** `lsp`, `outputStyles`, `commands`, `agents`, `hooks` (until Phase 3) ride along as opaque fields so re-emitting the manifest preserves them.

## 4. Package Format — Claude Layout

The Claude plugin layout that AiFetchly must accept:

```text
plugin-root/
├── .claude-plugin/
│   └── plugin.json              ← manifest (Claude shape, see §5.1)
├── skills/                      ← auto-detected (Phase 1)
│   ├── lead-tools/
│   │   └── SKILL.md             ← markdown + YAML frontmatter
│   └── email-writer/
│       └── SKILL.md
├── commands/                    ← auto-detected (Phase 4 — not yet consumed)
│   └── foo.md
├── agents/                      ← auto-detected (Phase 4 — not yet consumed)
│   └── bar.md
├── hooks/
│   └── hooks.json               ← Phase 3
├── .mcp.json                    ← sibling MCP config (alternative A)
├── output-styles/               ← ignored (opaque carry-through)
└── README.md
```

Two acceptable MCP locations:
- **Alternative A**: sibling `.mcp.json` at plugin root.
- **Alternative B**: inline `mcp` field inside `.claude-plugin/plugin.json`.

Both must be resolved. Inline wins if both exist (matches Claude's precedence).

## 5. Manifest Translation

### 5.1 Claude manifest input shape

```typescript
interface ClaudePluginManifestRaw {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  repository?: string;

  // Component declarations — any of the following forms:
  commands?: ComponentDecl;
  agents?: ComponentDecl;
  skills?: ComponentDecl;
  outputStyles?: ComponentDecl;
  hooks?: string | string[];             // path(s) to hook files
  lsp?: LspServers;                      // opaque, ignored
  mcp?: Record<string, PluginMcpServerDeclaration>;  // inline MCP (alt B)
}

// Claude allows directory auto-detect, single path, array of paths,
// or (for commands/agents/skills) an object map.
type ComponentDecl =
  | string                                // path string
  | string[]                              // array of paths
  | true                                  // auto-detect default dir
  | Record<string, { source?: string; content?: string; description?: string }>;
```

### 5.2 Adapted output

```typescript
interface AdaptedClaudeManifest {
  ok: true;
  manifest: PluginManifest;              // AiFetchly internal shape
  format: "claude";
  skillsPaths: readonly string[];        // normalized
  mcpServersPaths: readonly string[];    // path to .mcp.json when alt A
  inlineMcp?: Record<string, PluginMcpServerDeclaration>;  // alt B
  hooksPath?: string;                    // for Phase 3
  opaque: Record<string, unknown>;       // commands/agents/outputStyles/lsp carry-through
}

interface AdaptFailed {
  ok: false;
  errors: readonly PluginError[];
}

type ClaudeAdaptResult = AdaptedClaudeManifest | AdaptFailed;
```

### 5.3 `ClaudePluginAdapter.adapt()` contract

```typescript
// src/service/pluginCompat/ClaudePluginAdapter.ts

export interface ClaudePluginAdapterOptions {
  readonly pluginRoot: string;            // absolute, for path-traversal checks
}

export class ClaudePluginAdapter {
  /**
   * Translate a parsed Claude manifest JSON object into AiFetchly's
   * internal PluginManifest shape. Pure: no I/O, no side effects.
   *
   * Validation rules:
   *   - name must match PLUGIN_NAME_REGEX (same as AiFetchly).
   *   - version optional in Claude; if missing, defaults to "0.0.0".
   *   - description optional in Claude; if missing, defaults to "" and
   *     the manifest loads but the Plugin Manager shows a warning.
   *   - Component path arrays: dedupe, normalize, validate with
   *     resolvePluginRelativePath(). Reject path-outside-plugin.
   *   - Skills object-map form: derive path as `skills/<key>/SKILL.md`.
   *
   * Error codes produced:
   *   - manifest-schema-invalid
   *   - plugin-version-invalid
   *   - path-outside-plugin
   */
  static adapt(
    raw: unknown,
    options: ClaudePluginAdapterOptions
  ): ClaudeAdaptResult;
}
```

### 5.4 Path normalization matrix

| Claude form | Example | Normalized to |
|---|---|---|
| `true` (auto-detect) | `skills: true` | `["skills/"]` (directory auto-discovered at load) |
| Single string | `skills: "custom/"` | `["custom/"]` |
| Path array | `skills: ["a/", "b/"]` | `["a/", "b/"]` (deduped) |
| Object map | `skills: { lead: {...} }` | `["skills/lead/SKILL.md", ...]` |

### 5.5 MCP resolution order

```text
1. If manifest.mcp is an object → use inline (alt B). Ignore .mcp.json.
2. Else if .mcp.json exists at root → read it (alt A).
3. Else → no MCP servers from this plugin.
```

Both forms produce the same `Record<string, PluginMcpServerDeclaration>` consumed by `parseServersJson()` (alt A) or accepted directly (alt B). A small refactor to `PluginMcpDeclaration.ts` extracts the inner "object map → normalized server list" path so both callers share it.

## 6. Skill Format Adapter

### 6.1 Claude skill input

A Claude skill is a markdown file. Canonical name: `SKILL.md`. Each file has YAML frontmatter delimited by `---`:

```markdown
---
name: lead-research
description: Use when the user asks to research LinkedIn leads.
allowed-tools: [search, browse]
---

# Lead Research Skill

Instructions for the model here. Body is markdown.
```

### 6.2 Frontmatter grammar (minimal)

The parser supports only this subset. Anything beyond it is a structured error, never silently dropped.

```yaml
# key: value pairs, value must be:
#   - string (single line, no quotes unless containing colon)
#   - boolean (true/false)
#   - integer
#   - flow-style array: [a, b, c]
#   - block-style array:
#       - a
#       - b
```

Unsupported YAML features (anchors, multi-line strings, nested objects beyond one level, type tags) cause `skill-manifest-invalid` errors.

### 6.3 Parsed output

```typescript
interface ParsedClaudeSkill {
  readonly name: string;                  // from frontmatter, required
  readonly description: string;           // from frontmatter, required
  readonly allowedTools?: readonly string[];  // optional
  readonly raw: {
    readonly frontmatter: Record<string, unknown>;
    readonly body: string;                // markdown content after frontmatter
    readonly sourcePath: string;          // absolute path to .md file
  };
}

interface ClaudeSkillParseFailure {
  readonly ok: false;
  readonly error: PluginError;
}

type ClaudeSkillParseResult =
  | { ok: true; skill: ParsedClaudeSkill }
  | ClaudeSkillParseFailure;
```

### 6.4 Projecting onto the existing skill pipeline

`SkillImportService` expects an on-disk `manifest.json`. We never write one. Instead, we extend `SkillImportService` with a sibling entrypoint that accepts an already-parsed `ParsedClaudeSkill` and produces the same in-memory `InstalledSkillEntity`:

```typescript
// New method on SkillImportService
importFromClaudeSkill(
  pluginName: string,
  parsed: ParsedClaudeSkill
): Promise<{ ok: true; skillId: number } | { ok: false; error: PluginError }>;
```

The method:
1. Builds an `InstalledSkillEntity` with fields from `parsed` (name, description, content body).
2. Sets `pluginName`, `pluginComponentPath` to the relative path of the `.md` file.
3. Marks the skill as `source: "claude-md"` (new enum value on the skill source field).
4. Persists via `InstalledSkill.model.ts` (existing pattern).

`SkillExecutor` receives no changes — it already reads skill content from the DB row, not from disk. The markdown body becomes the skill content the executor sees.

### 6.5 Description handling in the prompt

The frontmatter `description` is the model-facing trigger predicate. The prompt assembler MUST:

- Pass `description` through verbatim to the model context.
- Never truncate, even if it exceeds typical token budgets for skill descriptions.
- Use `name` (not `description`) as the human-facing label in Plugin Manager UI.

This is enforced by a unit test on the prompt assembler that asserts byte-equality between the description string and what reaches the skill-catalog block of the prompt.

## 7. Loader Integration

### 7.1 Modified `locateManifestFile()`

```typescript
function locateManifestFile(pluginRoot: string): {
  path: string;
  format: "aifetchly" | "claude";
} | null {
  // 1. AiFetchly native (preferred when both exist)
  const ai = path.join(pluginRoot, ".aifetchly-plugin", "plugin.json");
  if (fs.existsSync(ai)) return { path: ai, format: "aifetchly" };

  // 2. Claude compat
  const cc = path.join(pluginRoot, ".claude-plugin", "plugin.json");
  if (fs.existsSync(cc)) return { path: cc, format: "claude" };

  // 3. Root fallback (treat as aifetchly; preserve legacy behavior)
  const root = path.join(pluginRoot, "plugin.json");
  if (fs.existsSync(root)) return { path: root, format: "aifetchly" };

  return null;
}
```

When both `.aifetchly-plugin/` and `.claude-plugin/` exist, AiFetchly wins. This is intentional: native format is authoritative for AiFetchly-authored plugins.

### 7.2 Modified `loadFromDirectory()`

```typescript
static async loadFromDirectory(
  pluginRoot: string
): Promise<PluginManifestLoadResult> {
  const located = locateManifestFile(pluginRoot);
  if (!located) {
    return fail([{ code: "manifest-not-found", ... }]);
  }

  // read + parse JSON (existing path, extracted into a helper)
  const parsed = readAndParseJson(located.path);
  if (!parsed.ok) return fail(parsed.errors);

  if (located.format === "claude") {
    const adapted = ClaudePluginAdapter.adapt(parsed.value, { pluginRoot });
    if (!adapted.ok) return fail(adapted.errors);
    return okWithFormat(adapted.manifest, located.path, "claude", adapted);
  }

  // existing AiFetchly validation path
  return validateManifest(parsed.value, pluginRoot);
}
```

`PluginManifestLoadResult` gains an optional `format` and `claudeExtras` (the `AdaptedClaudeManifest`) field. AiFetchly-format loads leave them undefined, preserving backward compatibility.

### 7.3 Modified `PluginLoaderService.forceLoad()`

For each plugin where the manifest load returns `format === "claude"`:

1. For each path in `adapted.skillsPaths`:
   - If the path is a directory, enumerate `*.md` files (top-level only, no recursion).
   - If the path is a file, treat it as a single skill.
   - For each `.md` file: `ClaudeSkillFormatAdapter.parse()` → `SkillImportService.importFromClaudeSkill()`.
2. For MCP:
   - If `adapted.inlineMcp` is set, register each entry via the refactored `PluginMcpDeclaration` entrypoint (object-map form).
   - Else if `adapted.mcpServersPaths` is set, read each file and run through the existing `parseServersJson()` + `normalizeMcpDeclaration()` pipeline.
3. Persist `format` on the loaded `LoadedPlugin` for UI display.

For AiFetchly-format plugins, behavior is unchanged.

### 7.4 Cache behavior

`PluginRuntimeCache.clear()` already invalidates the memoized `loadAllPlugins()` result on every enable/disable/install/uninstall. No change needed. Adapters run on every cold load, which is acceptable because loads are memoized and infrequent.

If profiling later shows the markdown parse dominates load time, a process-lifetime in-memory cache keyed by `(pluginName, skillPath, fileMtime)` can be added. Not in scope for Phase 1.

## 8. MCP Phase 2 Additions

### 8.1 Scoping

At server-registration time, server names are rewritten:

```text
plugin: "lead-pack", server: "linkedin"  →  registered as: "lead-pack__linkedin"
```

The rewrite is in a new helper `scopeMcpServerName(pluginName, serverName)`. It runs once at registration time. The Plugin Manager UI displays the original un-scoped name (stored in `metadata`). The MCP client manager uses the scoped name.

Tool naming follows the existing pattern: `mcp_${serverId}_${toolName}` — `serverId` already derives from the registered server name, so scoping flows through automatically.

### 8.2 Per-plugin options store

```text
~/.aifetchly/plugins/<plugin-name>/options.json
{
  "linkedin": {                          // server name (un-scoped)
    "LINKEDIN_API_KEY": "<encrypted>",
    "DEBUG": "true"
  }
}
```

Secret values are encrypted with Electron `safeStorage` on write, decrypted on read. Non-secret values are plain strings.

### 8.3 `${VAR}` resolution

At spawn time, for each `env` entry in the server declaration, values matching `^\$\{[A-Z_][A-Z0-9_]*\}$` are resolved from the options store. Unknown placeholders are an error (`mcp-config-invalid`, recoverable: true) — servers never spawn with unresolved env. The check runs before process spawn so the user sees a clear Plugin Manager error instead of a silent server crash.

### 8.4 MCP runtime entrypoint refactor

`PluginMcpDeclaration.ts` currently exposes `parseServersJson()` (file-form) and `normalizeMcpDeclaration()` (single-server). Phase 2 extracts a third entrypoint:

```typescript
export function normalizeInlineMcpMap(
  map: Record<string, PluginMcpServerDeclaration>,
  pluginRoot: string
): { ok: true; servers: NormalizedMcpServer[] }
  | { ok: false; errors: PluginError[] };
```

Both file-form and inline-form feed into the same `NormalizedMcpServer[]` consumer, so the MCP runtime is unchanged downstream.

## 9. Hooks Phase 3 Additions

### 9.1 Hooks schema

```typescript
interface ClaudeHooksFile {
  // keys are event names: PreToolUse, PostToolUse, SessionStart, Stop, ...
  [event: string]: ClaudeHookMatcher[];
}

interface ClaudeHookMatcher {
  readonly plugin?: string;               // tool-name pattern (regex)
  readonly command: string;               // shell command (Claude form)
  readonly timeout?: number;              // ms
}
```

### 9.2 Translation to AiFetchly's matcher format

```typescript
// src/service/pluginCompat/ClaudeHooksAdapter.ts

export interface AiFetchlyHookMatcher {
  readonly event: string;                 // PreToolUse | PostToolUse | ...
  readonly plugin?: string;
  readonly skillRef: string;              // path to skill body in worker
  readonly timeout: number;
}

export function adaptHooksFile(
  raw: unknown,
  pluginName: string
): { ok: true; matchers: AiFetchlyHookMatcher[] }
  | { ok: false; errors: PluginError[] };
```

The Claude `command` field is a shell command in Claude Code. In AiFetchly, we do **not** shell-exec plugin commands. Instead, the matcher wraps the command in a synthetic skill that `SkillWorker` executes. This is a deliberate divergence from Claude's runtime model — we get the same extensibility without giving plugins main-process shell access.

### 9.3 Event allowlist (Phase 3 launch set)

- `PreToolUse`
- `PostToolUse`
- `SessionStart`
- `Stop`

Other events in `hooks.json` are accepted (parsed without error) but logged as "not yet supported" and not dispatched.

### 9.4 Worker dispatch

```text
[main process] HookRegistry fires event
        │
        ▼
SkillWorkerClient.runHook(matcher, eventPayload)
        │  (IPC message to worker)
        ▼
[SkillWorker] evaluates matcher.skillRef against payload
        │
        ▼
returns { decision: "allow" | "deny" | "modify", ... }
        │
        ▼
[main process] applies decision
```

Hook failures are non-fatal: log + continue. A `PreToolUse` hook that errors does not block the tool call.

## 10. Marketplace Identifier Parsing

### 10.1 Parser

```typescript
// src/service/pluginCompat/parsePluginIdentifier.ts

export interface ParsedPluginIdentifier {
  readonly name: string;
  readonly marketplace?: string;
}

export function parsePluginIdentifier(
  id: string
): { ok: true; value: ParsedPluginIdentifier }
  | { ok: false; error: PluginError };
```

Rules:
- `name` — bare identifier, validated against `PLUGIN_NAME_REGEX`.
- `name@marketplace` — both segments required, marketplace validated against `PLUGIN_NAME_REGEX`.
- Empty marketplace (e.g. `foo@`) is an error.

### 10.2 Usage

The parser is called at install-time only. Phase 1's only consumer is the existing `PluginInstallService` — it accepts the parsed form and proceeds with the existing source-resolution pipeline. No marketplace registry enforcement yet.

## 11. Error Model Additions

### 11.1 New error codes added to `PluginErrorCode`

```typescript
| "claude-format-unsupported-feature"   // e.g. LSP declared, ignored
| "claude-frontmatter-invalid"          // YAML subset parse failed
| "claude-frontmatter-missing-field"    // required field absent
| "mcp-options-missing"                 // ${VAR} couldn't resolve
| "plugin-identifier-invalid"           // parse failure
```

All new codes must be rendered in `getPluginErrorMessage`-equivalent code and surface in the Plugin Manager UI.

### 11.2 Failure isolation guarantees

- One malformed skill in a plugin → that skill records an error; sibling skills still load.
- One malformed MCP server declaration → that server records an error; sibling servers still register.
- One malformed hook matcher (Phase 3) → that matcher is dropped; sibling matchers register.
- A malformed manifest → entire plugin fails to load and is recorded as `disabled` with errors, matching v1 behavior.

## 12. New Files

### 12.1 Phase 1

```text
src/service/pluginCompat/
├── pluginFormatTypes.ts                # AdaptedClaudeManifest, ClaudeAdaptResult, ...
├── ClaudePluginAdapter.ts              # manifest translator
├── ClaudeSkillFormatAdapter.ts         # markdown+frontmatter → ParsedClaudeSkill
├── claudeFrontmatterParser.ts          # minimal YAML subset parser
└── parsePluginIdentifier.ts            # name@marketplace parser
```

### 12.2 Phase 2

```text
src/service/pluginCompat/
└── PluginOptionsStore.ts               # reads/writes options.json (Model-layer backed)

src/model/PluginOptions.model.ts        # NOT a DB entity — filesystem-backed model
                                        # (placed here per architecture rule: all persistence goes through Model layer)
```

`PluginOptions.model.ts` persists to disk (not DB), but still lives under `src/model/` because it owns a persistence concern. It is invoked via `PluginManagementModule` from IPC handlers, preserving the IPC → Module → Model chain.

### 12.3 Phase 3

```text
src/service/pluginCompat/
├── claudeHooksSchema.ts                # hooks file schema + types
└── ClaudeHooksAdapter.ts               # → AiFetchlyHookMatcher[]
```

## 13. Modified Files

### 13.1 Phase 1

| File | Change |
|---|---|
| `src/entityTypes/pluginTypes.ts` | Add `format?` field to `PluginManifest`, `PluginSummary`, `PluginDetail`. Add 5 error codes to `PluginErrorCode`. |
| `src/service/PluginManifestService.ts` | New `locateManifestFile()` returning `{path, format}`. Branch on format in `loadFromDirectory()`. Extract JSON read/parse into a helper. |
| `src/service/PluginLoaderService.ts` | When `format === "claude"`, dispatch to adapter pipeline for skills. Pass format through to `LoadedPlugin`. |
| `src/service/SkillImportService.ts` | Add `importFromClaudeSkill()` method. |
| `src/entity/InstalledSkill.entity.ts` | Add `source` enum value `"claude-md"` (column already exists, just new value). |
| `src/views/pages/systemsetting/PluginManager.vue` (or equivalent) | Format badge, Claude-specific error rendering. |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | New strings for badge, errors. |

### 13.2 Phase 2

| File | Change |
|---|---|
| `src/service/PluginMcpDeclaration.ts` | Extract `normalizeInlineMcpMap()`. |
| `src/service/MCPToolService.ts` | Apply `scopeMcpServerName()` at registration. Resolve `${VAR}` from options before spawn. |
| `src/modules/MCPToolModule.ts` | Call `PluginOptionsStore` during server boot. |

### 13.3 Phase 3

| File | Change |
|---|---|
| `src/service/hooks/HookRegistry.ts` | New `registerPluginHook()` method. |
| `src/service/SkillWorkerClient.ts` | New `runHook()` IPC method. |
| `src/childprocess/SkillWorker.ts` | Hook-evaluation message handler. |

## 14. IPC Handler Additions

All new IPC channels live under `plugin-ipc.ts`. Each follows the existing `validateInput → call Module → return` pattern. AI-serving channels check `USER_AI_ENABLED` first.

### 14.1 Phase 1
None new — existing install/list/enable channels transparently support Claude plugins.

### 14.2 Phase 2

| Channel | Purpose | AI-gated? |
|---|---|---|
| `plugin:get-mcp-options` | Read options for a plugin's servers | No |
| `plugin:set-mcp-option` | Write a single option value | No |
| `plugin:list-mcp-options-schema` | Discover which `${VAR}` placeholders a plugin needs | No |

### 14.3 Phase 3
None new — hooks register at plugin-load time, no per-call IPC from the renderer.

## 15. Security Review Checklist

Implemented and verified before each phase ships:

- [ ] **`.git` stripping** — confirmed in `GitPluginFetcher`, `GitHubPluginFetcher`. Add unit tests if missing.
- [ ] **URL validation** — `validateGitUrl()` (or equivalent) present in all git-derived fetchers. Audit task.
- [ ] **Path traversal** — `resolvePluginRelativePath()` invoked for every Claude skill path, MCP path, hook file path. No exceptions.
- [ ] **Hook isolation** — Phase 3 hook handlers execute in `SkillWorker`. Verified by a test that asserts the worker PID processes the hook, not the main process.
- [ ] **Options encryption** — Phase 2 secret values encrypted via `safeStorage` before writing to `options.json`.
- [ ] **AI-enable gating** — every AI-serving IPC handler (skill exec, MCP tool exec) checks `USER_AI_ENABLED` first. Existing skill/MCP channels already do this; no new gate needed unless new AI channels are added.
- [ ] **No worker DB access** — Phase 3 worker hook handlers send IPC messages for any state change. Verified by static check: no `import` of `src/model/*` or `src/entity/*` from `src/childprocess/` or `src/service/pluginCompat/` worker-side files.
- [ ] **External dependency freeze** — no new npm dependencies for Phase 1. Frontmatter parser is hand-rolled in <200 lines.

## 16. Testing Strategy

### 16.1 Unit tests (Phase 1, mandatory ≥80% coverage)

| File | Test file | Critical cases |
|---|---|---|
| `ClaudePluginAdapter.ts` | `ClaudePluginAdapter.test.ts` | All 4 component-decl forms; missing optional fields; path traversal; dedupe; mixed formats |
| `ClaudeSkillFormatAdapter.ts` | `ClaudeSkillFormatAdapter.test.ts` | Well-formed skill; missing frontmatter; missing `name`; missing `description`; body-only |
| `claudeFrontmatterParser.ts` | `claudeFrontmatterParser.test.ts` | All supported value types; unsupported YAML features → error; empty frontmatter; no frontmatter |
| `parsePluginIdentifier.ts` | `parsePluginIdentifier.test.ts` | Bare name; `name@marketplace`; empty marketplace; invalid characters |

### 16.2 Integration tests (Phase 1)

| Test | Validates |
|---|---|
| `loadClaudeSkillsOnlyPlugin.test.ts` | End-to-end install from fixture → skills registered → skills invokable |
| `loadClaudeMixedPlugin.test.ts` | Skills + inline MCP + opaque fields all coexist |
| `loadClaudeBrokenPlugin.test.ts` | One broken skill doesn't block others |
| `roundTripClaudePlugin.test.ts` | Bytes on disk unchanged after install + load + uninstall |

Fixtures live under `test/fixtures/claude-plugins/`. Three minimal plugins: `skills-only`, `mcp-only`, `mixed-with-broken-skill`.

### 16.3 Vitest type-check gate

Both `vite.main.config.mjs` and `vite.utilityCode.config.mjs` reference `test/vitest/_typecheck/globalSetup.ts`, so any type error in the compat layer fails the run. All new code must compile clean under `tsc --noEmit` before commit.

### 16.4 Phase 2 integration tests

| Test | Validates |
|---|---|
| `scopedMcpServerNames.test.ts` | Two plugins with same server name don't collide |
| `pluginOptionsRoundTrip.test.ts` | Write option, read it back, value encrypted on disk |
| `inlineMcpMap.test.ts` | Inline `mcp` works without `.mcp.json` |
| `envVarResolution.test.ts` | `${VAR}` resolves; missing var → structured error |

### 16.5 Phase 3 integration tests

| Test | Validates |
|---|---|
| `pluginHookPreToolUse.test.ts` | Hook fires, deny decision blocks tool call |
| `pluginHookErrorIsolation.test.ts` | Hook error doesn't block tool call |
| `pluginHookWorkerPid.test.ts` | Hook runs under SkillWorker PID, not main |

## 17. Implementation Order

Per the project's mandatory auto-commit rule, each completed logical unit gets an atomic commit. Suggested sequence:

### Phase 1
1. Add `format` field to types + new error codes → commit.
2. Implement `claudeFrontmatterParser.ts` + tests → commit.
3. Implement `ClaudeSkillFormatAdapter.ts` + tests → commit.
4. Implement `ClaudePluginAdapter.ts` + tests → commit.
5. Implement `parsePluginIdentifier.ts` + tests → commit.
6. Refactor `PluginManifestService.locateManifestFile()` for dual path → commit.
7. Branch `loadFromDirectory()` on format → commit.
8. Add `SkillImportService.importFromClaudeSkill()` → commit.
9. Wire Claude skills through `PluginLoaderService.forceLoad()` → commit.
10. Add fixture plugins + integration tests → commit.
11. UI badge + i18n across all 6 languages → commit (one per language is acceptable).

### Phase 2
12. Extract `normalizeInlineMcpMap()` from `PluginMcpDeclaration.ts` → commit.
13. `PluginOptions.model.ts` + `PluginOptionsStore.ts` → commit.
14. `scopeMcpServerName()` + apply at registration → commit.
15. `${VAR}` resolution at spawn → commit.
16. IPC handlers for option read/write → commit.
17. Integration tests → commit.

### Phase 3
18. `claudeHooksSchema.ts` + `ClaudeHooksAdapter.ts` + tests → commit.
19. `HookRegistry.registerPluginHook()` → commit.
20. `SkillWorkerClient.runHook()` + worker handler → commit.
21. Integration tests → commit.

## 18. Performance Notes

- **Load cost**: Claude plugins parse markdown on every cold load. Bounded by skill count. Expected: <5ms per skill on typical hardware. Memoization makes this a one-time cost per session.
- **Memory**: parsed frontmatter and skill bodies live in the existing `LoadedPlugin` cache. No additional cache layers in Phase 1.
- **No DB pressure**: nothing about Claude plugins adds query load — `format` is computed, not persisted.

## 19. Open Implementation Questions

1. **Should the frontmatter parser use `js-yaml`?** No. Hand-rolled keeps the bundle small, avoids the YAML feature surface, and forces fail-fast on constructs we don't support. Revisit if real-world Claude plugins use YAML features beyond our subset.
2. **`SkillExecutor` content path**: confirm whether the existing executor reads skill content from the DB row or re-reads from disk. If the latter, the markdown body needs to be stored on disk somewhere predictable. **Action item**: read `SkillExecutor.ts` and confirm before Phase 1 implementation begins.
3. **AI-enable gating boundary**: are MCP-tool-exec IPC handlers already gated by `USER_AI_ENABLED`? Audit before Phase 2.
4. **Plugin Manager UI file**: confirm exact filename (`PluginManager.vue` vs `plugins.vue` vs other) before Phase 1 UI work.
5. **Frontmatter `name` uniqueness scope**: per-plugin (current plan) or global? Per-plugin matches Claude's model. Global would require namespacing at registration time.

## 20. Glossary

- **Adapter**: pure translation function from one on-disk format to the internal model. Never mutates disk.
- **Auto-detect**: Claude's convention where declaring `skills: true` (or omitting the key but having a `skills/` directory) means "scan the default directory."
- **Format discriminator**: `format: "aifetchly" | "claude"` on the in-memory `PluginManifest`. Not persisted.
- **Frontmatter**: YAML block at the top of a `SKILL.md` delimited by `---`.
- **Inline MCP**: Claude's alternative B where the server map lives in the manifest's `mcp` field instead of a sibling `.mcp.json`.
- **Opaque carry-through**: a manifest field we accept but don't yet consume (e.g. `commands`, `agents`, `lsp`, `outputStyles`). Stored on `manifest.opaque` so the round-trip back to disk preserves it.
- **Round-trip fidelity**: an installed plugin's on-disk bytes equal its source bytes. Updates apply cleanly.
- **Scoping**: prefixing MCP server names with `<plugin-name>__` at registration time to prevent cross-plugin collisions.
