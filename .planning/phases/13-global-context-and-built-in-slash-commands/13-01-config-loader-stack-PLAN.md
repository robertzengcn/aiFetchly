---
phase: 13-global-context-and-built-in-slash-commands
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/entityTypes/aifetchlyConfigTypes.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts
  - src/service/aifetchlyConfig/resolveConfigRelativePath.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff.ts
  - test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts
  - test/vitest/main/service/AIFetchlyConfigLoader.test.ts
  - test/vitest/main/service/AIFetchlyConfigSnapshotDiff.test.ts
autonomous: true
requirements: [CFG-01, CFG-03, CFG-04, CFG-05, CFG-06, CFG-07, DX-01]
must_haves:
  truths:
    - "AIFetchlyConfigLoader resolves the global root via os.homedir() joined with the '.aifetchly' segment, never Electron userData (CFG-01)"
    - "Missing global config folder produces an empty snapshot with scanner-io-error-free diagnostics and no crash (CFG-01)"
    - "settings.json is validated with a zod schema; unknown fields are ignored; invalid known fields fall back to DEFAULT_AIFETCHLY_CONFIG_SETTINGS with a 'settings-json-invalid' warning diagnostic (CFG-03)"
    - "Files exceeding their size limit (AGENTS.md 256KB, command 64KB, settings 32KB) are ignored with a 'file-too-large' diagnostic (CFG-04)"
    - "resolveConfigRelativePath rejects absolute paths, '..' traversal, and symlinks escaping the trusted root, returning {ok:false,reason} (CFG-05)"
    - "parseRestrictedFrontmatter parses only the initial '---' block, supports scalars and string arrays, rejects YAML tags, fails closed on ambiguous syntax, preserves the body exactly (CFG-07)"
    - "No source file under src/service/aifetchlyConfig/ imports the repo's existing YAML parsing dependency (CFG-07 security invariant)"
    - "Snapshots carry SHA-256 content hashes (crypto.createHash('sha256')); the diff function computes added/changed/removed correctly (CFG-06)"
    - "Diagnostics use the stable codes from design §5.3 and are source-specific + user-readable (DX-01)"
  artifacts:
    - "src/entityTypes/aifetchlyConfigTypes.ts — pure types (no Electron/TypeORM/Vue imports): AIFetchlyConfigSourceKind, AIFetchlyConfigSourceRef, AIFetchlyConfigFileKind, AIFetchlyConfigFileSnapshot, AIFetchlyConfigDiagnostic, AIFetchlyInstructionBlock, AIFetchlyConfigSnapshot, AIFetchlyConfigDiff, AIFetchlyConfigSettings, AIFetchlyConfigSeverity"
    - "src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts — AIFETCHLY_CONFIG_LIMITS object + DEFAULT_AIFETCHLY_CONFIG_SETTINGS"
    - "src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts — parseRestrictedFrontmatter + ParsedFrontmatter interface"
    - "src/service/aifetchlyConfig/resolveConfigRelativePath.ts — resolveConfigRelativePath function"
    - "src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts — class AIFetchlyConfigLoader with scanGlobalRoot()"
    - "src/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff.ts — computeSnapshotDiff function"
  key_links:
    - "AIFetchlyConfigLoader.scanGlobalRoot() chains fs.stat (size limit) -> fs.readFile (bounded) -> resolveConfigRelativePath (path safety) -> parseRestrictedFrontmatter (CFG-07) -> crypto.createHash('sha256') (CFG-06) -> zod settings schema (CFG-03) -> AIFetchlyConfigSnapshot"
    - "AIFetchlyConfigMarkdown has NO dependency on the repo's YAML library (hand-rolled, CFG-07)"
  prohibitions:
    - "No $ARGUMENTS substitution logic (TRS-06 / CMD-06 — phase 15 boundary)"
    - "No worker process files under src/childprocess/ (phase 14 boundary)"
    - "No TypeORM entities or database imports (phase 13 is file-backed + in-memory; AIFetchlyWorkspaceTrust is phase 17)"
    - "No imports of the repo's YAML parsing dependency anywhere in src/service/aifetchlyConfig/ (CFG-07 — its default schema executes untrusted tags)"
    - "No renderer imports (src/views/**) of the config-root path literal, fs, path, or os.homedir (TRS-07 — enforced by Plan 05 boundary test)"
---

<objective>
Build the global `~/.aifetchly` config loader stack: pure types, size/path constants, a hand-rolled restricted frontmatter parser, a path-safety helper, the async bounded file scanner, and the snapshot diff. This is the foundation that Plan 03's orchestrator and context loader consume.

Purpose: Establish the data contracts (CFG-06) and the safe file-reading pipeline (CFG-01/03/04/05/07, DX-01) before any orchestration or IPC layer is wired. Every later plan depends on these types and this loader.
Output: Six new source files + three Vitest test files, all under src/service/aifetchlyConfig/ and src/entityTypes/.
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
  <name>Task 1: Pure types, size constants, and hand-rolled restricted frontmatter parser (CFG-07, CFG-04 limits, DX-01 codes)</name>
  <files>
    src/entityTypes/aifetchlyConfigTypes.ts,
    src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts,
    src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts,
    test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §5.1-5.3 (source identity, file snapshot, diagnostics), §5.4 (instruction block), §6.5 (size limits constants), §6.6 (frontmatter parser rules), §6.8 (settings schema + defaults)
    - src/entityTypes/commonType.ts — the project pattern for pure entity types (CommonMessage envelope, MessageType enum)
    - src/entityTypes/aiChatV2Types.ts — sibling pure-types file to mirror structure/export style
    - src/service/PluginDiagnosticsService.ts — the structural analog for diagnostic severity/codes shape (DX-01)
    - src/service/SkillDiagnosticsService.ts — second diagnostics analog for source-specific error reporting
    - src/utils/lazySchema.ts — the WeakMap-cached zod wrapper pattern (needed in Task 2 for settings schema, but read now to plan the import surface)
  </read_first>
  <behavior>
    - parseRestrictedFrontmatter("---\nname: review\ndescription: x\n---\nbody") returns scalars.get("name") === "review" and body === "body"
    - parseRestrictedFrontmatter with a string array field ("aliases:\n  - rv\n  - r") returns arrays.get("aliases") === ["rv","r"]
    - parseRestrictedFrontmatter returns null when the text does not start with the frontmatter opener (fail closed)
    - parseRestrictedFrontmatter returns null when the opener is never terminated (fail closed)
    - parseRestrictedFrontmatter rejects a tag line like "!!js/function '...'" by returning null (never executes the tag)
    - parseRestrictedFrontmatter preserves the body byte-for-byte after the closing delimiter (including leading/trailing whitespace)
  </behavior>
  <action>
    Create the three files in dependency order.

    File 1 — src/entityTypes/aifetchlyConfigTypes.ts: a PURE types module (interfaces, type aliases, readonly arrays). NO imports of Electron, TypeORM, Vue, or any service. Export exactly these types per design §5.1-5.7:
      - AIFetchlyConfigSourceKind = "user" | "workspace" | "plugin"
      - AIFetchlyConfigSourceRef (kind, sourceId, rootPath, optional workspaceId/workspaceRoot/pluginName)
      - AIFetchlyConfigFileKind union: "instructions" | "settings" | "command" | "agent" | "skill" | "hook" | "plugin-options" | "unknown"
      - AIFetchlyConfigFileSnapshot (relativePath, kind, mtimeMs, sizeBytes, contentHash)
      - AIFetchlyConfigSeverity = "info" | "warning" | "error"
      - AIFetchlyConfigDiagnostic (severity, source, sourceId, filePath, code, message, recoverable)
      - AIFetchlyInstructionBlock (id, source, sourceId, label, relativePath, content, contentHash, trusted)
      - SlashCommandSource, SlashCommandType aliases (forward-declared; the concrete SlashCommandDefinition/View live in slashCommandTypes.ts created by Plan 02 — use a local minimal placeholder ONLY if needed to avoid a circular import; prefer leaving command/agent/hook/skill arrays as `readonly UnknownTypedRecord[]` or `readonly unknown[]` until Plans 02/03 supply real types)
      - AIFetchlyConfigSnapshot (source, sourceId, rootPath, version, files, instructions, commands, agents, hooks, skills, diagnostics — all readonly arrays)
      - AIFetchlyConfigDiff (added, changed, removed, plus the per-capability boolean Changed flags)
      - AIFetchlyConfigSettings (commandsEnabled, agentsEnabled, hooksEnabled, workspaceConfigEnabled, watchEnabled — all readonly boolean)
    Source ID format constants belong in AIFetchlyConfigConstants, not here.

    File 2 — src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts: export two frozen objects.
      - AIFETCHLY_CONFIG_LIMITS per design §6.5: agentsMdBytes 262144, commandMdBytes 65536, agentMdBytes 131072, hooksJsonBytes 131072, settingsJsonBytes 32768, maxCommandsPerSource 200, maxAgentsPerSource 100. Use `as const`.
      - DEFAULT_AIFETCHLY_CONFIG_SETTINGS per design §6.8: commandsEnabled true, agentsEnabled true, hooksEnabled false, workspaceConfigEnabled true, watchEnabled true. Use `as const`.
      - AIFETCHLY_CONFIG_DIR_NAME = ".aifetchly" (the single literal; reused by the loader so the literal appears in exactly one source file).
      - AIFETCHLY_DIAGNOSTIC_CODES: a readonly string tuple listing the stable codes from design §5.3 (file-too-large, frontmatter-missing, frontmatter-invalid, command-name-invalid, command-description-missing, agent-name-invalid, agent-tool-invalid, settings-json-invalid, path-outside-root, unsupported-file, workspace-untrusted, scanner-io-error). This tuple is the DX-01 single source of truth.

    File 3 — src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts: hand-rolled restricted frontmatter parser. CRITICAL security constraint (CFG-07, Pitfall 2): you MUST NOT import or use the repo's existing YAML parsing dependency anywhere in this file or any sibling under src/service/aifetchlyConfig/. Its default schema EXECUTES untrusted YAML tags, which is unsafe for workspace-scanned files. Hand-roll the parser instead (~50-80 LOC).
      - Export interface ParsedFrontmatter { readonly scalars: ReadonlyMap<string, string>; readonly arrays: ReadonlyMap<string, readonly string[]>; readonly body: string }
      - Export function parseRestrictedFrontmatter(text: string): ParsedFrontmatter | null
      - Rules: only parse the INITIAL frontmatter block delimited by the exact opener and closer lines; support scalar lines "key: value" and string-array blocks "key:\n  - item"; reject (return null, fail closed) on anything else — including YAML tags, nested maps, quoted multiline strings, or unterminated blocks.
      - Preserve the body EXACTLY (byte-for-byte after the closing delimiter).
      - Trim scalar values but do NOT interpolate env vars or escapes.
      - Add a header JSDoc that states the security rationale in concept (without naming the rejected library by its literal package identifier) so future maintainers do not reintroduce it.

    File 4 — test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts: table-driven Vitest cases covering every <behavior> bullet above plus edge cases (empty frontmatter "---\n---", array with zero items, scalar with empty value, body with trailing newline, CRLF line endings rejected or normalized — pick one and document).
  </action>
  <verify>
    <automated>yarn testmain -- AIFetchlyConfigMarkdown</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts exits 0 via `yarn testmain -- AIFetchlyConfigMarkdown`
    - `grep -c "export interface ParsedFrontmatter" src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts` returns 1
    - `grep -c "export function parseRestrictedFrontmatter" src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts` returns 1
    - No file under src/service/aifetchlyConfig/ imports the YAML library: `! grep -rE "from ['\"]js-yaml['\"]|require\(['\"]js-yaml['\"]\)" src/service/aifetchlyConfig/` exits 0 (CFG-07)
    - `grep -c "AIFETCHLY_CONFIG_LIMITS" src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` returns at least 1
    - `grep -c "AIFETCHLY_DIAGNOSTIC_CODES" src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` returns at least 1 (DX-01)
    - src/entityTypes/aifetchlyConfigTypes.ts has zero imports from electron, typeorm, vue, or any src/service/ path: `! grep -E "from ['\"](electron|typeorm|vue)|from ['\"]@/service" src/entityTypes/aifetchlyConfigTypes.ts` exits 0
  </acceptance_criteria>
  <done>
    Restricted frontmatter parser ships tag-safe (CFG-07); pure types and constants are importable by Plan 02 and Plan 03; diagnostic codes list is centralized (DX-01). No YAML library import exists anywhere under src/service/aifetchlyConfig/.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Path-safety helper, async bounded config loader, and snapshot diff (CFG-01, CFG-03, CFG-04, CFG-05, CFG-06)</name>
  <files>
    src/service/aifetchlyConfig/resolveConfigRelativePath.ts,
    src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts,
    src/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff.ts,
    test/vitest/main/service/AIFetchlyConfigLoader.test.ts,
    test/vitest/main/service/AIFetchlyConfigSnapshotDiff.test.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §6.1 (global root via os.homedir), §6.3 (path-safety helper rules + return shape), §6.4 (file discovery list), §6.5 (size limits), §6.8 (settings parse + defaults), §5.2 (contentHash definition), §5.7 (diff fields)
    - src/service/FilePathGuard.ts — the structural analog for path-safety enforcement (mirror its realpath + null-byte + structured-result approach; do NOT subclass it — phase 13 needs a simpler standalone function)
    - src/config/fileToolConfig.ts around line 123 — confirms the project already uses os.homedir() for path resolution
    - src/utils/lazySchema.ts — the WeakMap-cached zod wrapper; the settings schema MUST be wrapped in lazySchema per project pattern
    - src/entityTypes/aifetchlyConfigTypes.ts — the types produced by Task 1 (read AFTER Task 1 lands)
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts — the limits + defaults + diagnostic codes from Task 1 (read AFTER Task 1 lands)
  </read_first>
  <behavior>
    - resolveConfigRelativePath(root, "AGENTS.md") returns {ok:true, absolutePath: "<root>/AGENTS.md"}
    - resolveConfigRelativePath(root, "/etc/passwd") returns {ok:false, reason: "...absolute..."}
    - resolveConfigRelativePath(root, "../escape") returns {ok:false, reason: "...traversal..."}
    - resolveConfigRelativePath(root, "sub/../../escape") returns {ok:false, reason: "...traversal..."}
    - AIFetchlyConfigLoader.scanGlobalRoot() with a missing folder returns a snapshot with empty files/instructions/diagnostics and source "user"
    - AIFetchlyConfigLoader.scanGlobalRoot() with an oversized AGENTS.md emits a "file-too-large" diagnostic and excludes the file
    - AIFetchlyConfigLoader.scanGlobalRoot() with invalid settings.json falls back to DEFAULT_AIFETCHLY_CONFIG_SETTINGS and emits a "settings-json-invalid" warning
    - AIFetchlyConfigLoader.scanGlobalRoot() with valid AGENTS.md produces an AIFetchlyInstructionBlock with a SHA-256 contentHash
    - computeSnapshotDiff(old, new) with one added file returns {added:[path], changed:[], removed:[]} and instructionsChanged=true
    - computeSnapshotDiff with a content-hash change on an existing path returns changed:[path]
    - computeSnapshotDiff with a deleted path returns removed:[path]
  </behavior>
  <action>
    Create the three source files and two test files.

    File 1 — src/service/aifetchlyConfig/resolveConfigRelativePath.ts: a standalone path-safety helper (CFG-05). Export `function resolveConfigRelativePath(rootPath: string, relativePath: string): { ok: true; absolutePath: string } | { ok: false; reason: string }`.
      - Reject when relativePath is absolute (starts with "/" on POSIX or matches /^[A-Za-z]:/ on Windows).
      - Reject when the normalized relative path contains ".." after normalization (use path.posix.normalize + path.normalize; reject if any segment is "..").
      - Reject null bytes / control characters (mirror FilePathGuard.validate lines 48-60).
      - For EXISTING files, use fs.realpathSync and verify the resolved real path starts with the resolved root (catches symlinks escaping the root). For non-existing paths, use path.resolve and verify the prefix.
      - Return structured errors, never throw.
      - Import only from "path" and "fs" (stdlib). NO picomatch here — keep it minimal.

    File 2 — src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts: the async bounded scanner. Export `class AIFetchlyConfigLoader`.
      - Constructor takes an optional root override (for tests); default root is `path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME)` (CFG-01 — NEVER app.getPath('userData')).
      - Async method `scanGlobalRoot(): Promise<AIFetchlyConfigSnapshot>` that:
        a. fs.readdir the root (catch ENOENT -> return empty snapshot with source "user", sourceId "user", NO diagnostic; missing folder is the happy path on a fresh install).
        b. Discover ONLY: AGENTS.md, settings.json (per design §6.4 phase-1 list). Use simple fs.readdir + explicit name checks (NO picomatch glob — Pitfall A3 says it's unnecessary here).
        c. For each candidate: fs.stat FIRST; if size > the matching AIFETCHLY_CONFIG_LIMITS constant, emit a "file-too-large" diagnostic (CFG-04) and SKIP fs.readFile.
        d. fs.readFile (async, bounded by the stat-checked size).
        e. For AGENTS.md: crypto.createHash('sha256').update(content).digest('hex') for the contentHash (CFG-06). Build an AIFetchlyInstructionBlock with id "user:instructions:AGENTS.md", source "user", sourceId "user", label per design §12.2 ("User global AiFetchly instructions from ~/.aifetchly/AGENTS.md" — but the LABEL belongs in the context loader (Plan 03); here store relativePath and let the context loader format the label). Set trusted=true for global (user-owned, always-on per TRS-01).
        f. For settings.json: JSON.parse, then wrap a zod schema in lazySchema. Schema = z.object({ commandsEnabled: z.boolean().optional(), agentsEnabled: z.boolean().optional(), hooksEnabled: z.boolean().optional(), workspaceConfigEnabled: z.boolean().optional(), watchEnabled: z.boolean().optional() }).passthrough(). On parse failure or zod failure, fall back to DEFAULT_AIFETCHLY_CONFIG_SETTINGS and emit a "settings-json-invalid" warning (CFG-03). Merge parsed values over defaults.
        g. On any unexpected fs error (EACCES, EIO), emit a "scanner-io-error" diagnostic (recoverable: true) and continue — never throw from scanGlobalRoot.
      - The snapshot's commands/agents/hooks/skills arrays are EMPTY in phase 13 (Phase 15+ populates commands; phase 16 agents; etc.). This keeps the type stable.
      - All file ops use fs.promises (async). NO fs.readFileSync in the hot path (Pitfall 6).

    File 3 — src/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff.ts: export `function computeSnapshotDiff(prev: AIFetchlyConfigSnapshot | null, next: AIFetchlyConfigSnapshot): AIFetchlyConfigDiff`.
      - Index files by relativePath. Compare contentHash. Populate added/changed/removed path arrays.
      - Set the per-capability Changed booleans by diffing the corresponding arrays (instructionsChanged, commandsChanged, agentsChanged, hooksChanged, skillsChanged, diagnosticsChanged). Use contentHash for instructions; use id for commands/agents/hooks/skills.
      - Handle prev=null (initial scan): everything is "added".

    Test files — table-driven, mirroring the <behavior> cases. Use Node's fs.promises + os.tmpdir() to build ephemeral fake ~/.aifetchly folders for the loader test; clean up in afterEach. Mock nothing — these are real-disk integration-style unit tests (the loader is pure filesystem I/O).
  </action>
  <verify>
    <automated>yarn testmain -- AIFetchlyConfigLoader && yarn testmain -- AIFetchlyConfigSnapshotDiff</automated>
  </verify>
  <acceptance_criteria>
    - test/vitest/main/service/AIFetchlyConfigLoader.test.ts exits 0
    - test/vitest/main/service/AIFetchlyConfigSnapshotDiff.test.ts exits 0
    - `grep -c "os.homedir" src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` returns at least 1 (CFG-01)
    - `grep -c "app.getPath" src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` returns 0 (must NOT use Electron userData — CFG-01)
    - `grep -c "createHash" src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` returns at least 1 (CFG-06 SHA-256)
    - `grep -c "AIFETCHLY_CONFIG_LIMITS" src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` returns at least 1 (CFG-04 size limits enforced)
    - `grep -c "{ ok: false" src/service/aifetchlyConfig/resolveConfigRelativePath.ts` returns at least 1 (CFG-05 structured error)
    - `grep -c "realpathSync\|realpath" src/service/aifetchlyConfig/resolveConfigRelativePath.ts` returns at least 1 (CFG-05 symlink check)
    - No sync fs in scan path: `! grep -n "readFileSync\|statSync\|readdirSync" src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` exits 0 (Pitfall 6 — only async fs.promises in the scan)
    - No YAML library import: `! grep -rE "from ['\"]js-yaml['\"]|require\(['\"]js-yaml['\"]\)" src/service/aifetchlyConfig/` exits 0 (CFG-07 still clean after Task 2)
  </acceptance_criteria>
  <done>
    Global config scanner reads ~/.aifetchly async with size/path safety and produces a typed snapshot with SHA-256 hashes and diagnostics; the diff function is pure and correct. The loader never touches Electron userData, never blocks on sync fs, and never imports the repo's YAML library.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Disk (`~/.aifetchly`) → main process | User-authored files cross into the main process via the loader. Content is untrusted (future workspace files are explicitly untrusted; global is user-owned but still untrusted-as-model-input). |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-13-01 | Tampering / Info Disclosure | resolveConfigRelativePath (CFG-05) | high | mitigate | Reject absolute paths, `..` traversal, and escaping symlinks; return structured {ok:false,reason}; mirror FilePathGuard realpath check. Covered by Task 2 acceptance criteria. |
| T-13-02 | Code Execution (LFI via YAML tags) | AIFetchlyConfigMarkdown (CFG-07) | high | mitigate | Hand-rolled scalar+array-only parser; rejects tags; fail-closed on ambiguity. NO import of the repo's YAML dependency. Covered by Task 1 grep gate. |
| T-13-DoS | Denial of Service | AIFetchlyConfigLoader size checks (CFG-04) | medium | mitigate | fs.stat BEFORE fs.readFile; per-file-type size limits from AIFETCHLY_CONFIG_LIMITS; oversized files emit "file-too-large" diagnostic and are skipped. Covered by Task 2. |
| T-13-IO | Tampering | AIFetchlyConfigLoader unexpected fs errors | low | mitigate | Wrap all fs ops in try/catch; emit "scanner-io-error" recoverable diagnostic; never throw from scanGlobalRoot. Covered by Task 2. |
| T-13-SC | Tampering | Package installs | n/a | accept | Phase 13 installs ZERO new packages (verified in research §Package Legitimacy Audit). All deps are stdlib or already-present (zod ^3.24.0, picomatch ^4.0.2 unused here). |
</threat_model>

<verification>
- yarn testmain -- AIFetchlyConfigMarkdown exits 0 (CFG-07)
- yarn testmain -- AIFetchlyConfigLoader exits 0 (CFG-01, CFG-03, CFG-04, CFG-05, DX-01)
- yarn testmain -- AIFetchlyConfigSnapshotDiff exits 0 (CFG-06)
- No YAML library imports under src/service/aifetchlyConfig/ (CFG-07 grep gate)
- No Electron userData usage in the loader (CFG-01 grep gate)
- tsc --noEmit passes (the vitest typecheck gate runs it automatically)
</verification>

<success_criteria>
- Pure types module imports nothing from Electron/TypeORM/Vue/services.
- Restricted frontmatter parser is tag-safe, fail-closed, body-preserving.
- Config loader resolves ~/.aifetchly via os.homedir, enforces size limits, validates settings with zod, hashes content with SHA-256, and degrades gracefully on missing folder / invalid files.
- Snapshot diff correctly computes added/changed/removed across all capability arrays.
- All diagnostic codes come from the single AIFETCHLY_DIAGNOSTIC_CODES tuple (DX-01).
</success_criteria>

<output>
Create `.planning/phases/13-global-context-and-built-in-slash-commands/13-01-SUMMARY.md` when done.

## Artifacts this phase produces (Plan 01 contribution)

**Types (src/entityTypes/aifetchlyConfigTypes.ts):**
- AIFetchlyConfigSourceKind, AIFetchlyConfigSourceRef
- AIFetchlyConfigFileKind, AIFetchlyConfigFileSnapshot
- AIFetchlyConfigSeverity, AIFetchlyConfigDiagnostic
- AIFetchlyInstructionBlock
- AIFetchlyConfigSnapshot, AIFetchlyConfigDiff
- AIFetchlyConfigSettings

**Constants (src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts):**
- AIFETCHLY_CONFIG_LIMITS (size + count limits)
- DEFAULT_AIFETCHLY_CONFIG_SETTINGS
- AIFETCHLY_CONFIG_DIR_NAME (the single ".aifetchly" literal)
- AIFETCHLY_DIAGNOSTIC_CODES (stable code tuple — DX-01)

**Services (src/service/aifetchlyConfig/):**
- parseRestrictedFrontmatter + ParsedFrontmatter (AIFetchlyConfigMarkdown.ts)
- resolveConfigRelativePath (resolveConfigRelativePath.ts)
- AIFetchlyConfigLoader class with scanGlobalRoot() (AIFetchlyConfigLoader.ts)
- computeSnapshotDiff (AIFetchlyConfigSnapshotDiff.ts)

**Tests (test/vitest/main/service/):**
- AIFetchlyConfigMarkdown.test.ts
- AIFetchlyConfigLoader.test.ts
- AIFetchlyConfigSnapshotDiff.test.ts
</output>
