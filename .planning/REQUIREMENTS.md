# Requirements: AiFetchly — v2.0 Local Extensibility

**Defined:** 2026-07-04
**Core Value:** Users can extend the AiFetchly assistant with local instructions, slash commands, agents, hooks, and skills (`~/.aifetchly` + `<workspace>/.aifetchly`) without changing application source code.
**Source of truth:** `docs/prd/aifetchly-local-extensibility-prd.md` + `docs/prd/aifetchly-local-extensibility-technical-design.md`

## v1 Requirements (this milestone)

Requirements for the v2.0 milestone. Each maps to exactly one roadmap phase (13–18).

### Config Loading (CFG)

- [ ] **CFG-01**: Global loader resolves `~/.aifetchly` (not Electron `userData`) and discovers `AGENTS.md`, `settings.json`, and `commands/*.md` via async bounded reads
- [ ] **CFG-02**: Workspace loader discovers `<workspace>/.aifetchly/{AGENTS.md,settings.json,commands/*.md}` and optional root `<workspace>/AGENTS.md` for an approved workspace, after confirming the root against the stored approved workspace (never trusts renderer-provided paths)
- [ ] **CFG-03**: `settings.json` parsed with schema (`commandsEnabled`/`agentsEnabled`/`hooksEnabled`/`workspaceConfigEnabled`/`watchEnabled`); unknown fields ignored, invalid known fields fall back to defaults with warnings
- [ ] **CFG-04**: Size limits enforced (`AGENTS.md` 256KB, command 64KB, agent 128KB, hooks 128KB, settings 32KB; ≤200 commands / ≤100 agents per source); oversized files ignored with diagnostics
- [ ] **CFG-05**: Path-safety helper rejects absolute relative paths, `..` traversal, and symlinks escaping the trusted root, returning structured `{ ok: false, reason }` errors
- [ ] **CFG-06**: Loader produces a typed `AIFetchlyConfigSnapshot` (files, instructions, commands, agents, hooks, skills, diagnostics) with SHA-256 content hashes, plus a diff for UI/logging; runtime correctness uses full-snapshot source replacement
- [ ] **CFG-07**: Restricted markdown frontmatter parser parses only the initial `---` block, supports scalars + string arrays, never executes YAML tags, fails closed on ambiguous syntax, and preserves the body exactly

### Context Injection (CTX)

- [ ] **CTX-01**: Global `~/.aifetchly/AGENTS.md` content injected into the AiChatV2 system message via `AIChatContextAssembler`, after the base system prompt and before durable memory
- [ ] **CTX-02**: Trusted workspace `.aifetchly/AGENTS.md` injected with a labeled block identifying the workspace path; untrusted workspace instructions are not injected
- [ ] **CTX-03**: Instruction blocks labeled clearly (e.g. "User global AiFetchly instructions…") without implying priority over the app system prompt; an in-memory cache avoids per-request file reads; missing config / read failures degrade to no injection + warning (never block chat)

### Slash Commands (CMD)

- [ ] **CMD-01**: `CommandRegistry` with scoped IDs (`built-in:command:`, `user:command:`, `workspace:<id>:command:`, `plugin:<name>:command:`), deterministic lookup order (built-in > workspace > user > plugin), and `replaceSource` for full-source reconciliation
- [ ] **CMD-02**: `SlashCommandParser` detects command-leading input per rules: `/review src` is a command, ` /review` after left-trim is a command, `//review` is not, `/` opens suggestions but is not dispatchable, `/unknown args` parses and dispatch returns not-found
- [ ] **CMD-03**: Built-in commands registered at startup: `/help`, `/clear`, `/status`, `/reload-config` (`/agents`, `/skills`, `/plugins` added in later phases)
- [ ] **CMD-04**: Dispatch returns typed `SlashCommandDispatchResponse` — prompt command → `submit_prompt`; local command (built-ins) → `show_result`; AI-enable gating occurs before actual AI submission in the stream IPC
- [ ] **CMD-05**: Renderer slash-suggestions UI shows name/description/source badge (Built-in/User/Workspace/Plugin)/argument hint/disabled-or-trust state, with arrow-key navigation, Enter/Tab to choose, Shift+Enter newline preserved
- [ ] **CMD-06**: Markdown file commands (`commands/*.md`) loaded from global + trusted-workspace sources; frontmatter validated (name `^[a-z][a-z0-9_-]*$`, description ≤500 chars, ≤10 aliases same regex, `argumentHint` ≤100, `type: prompt`, non-empty body); `$ARGUMENTS` expanded on dispatch; source replacement reconciles add/change/delete/rename
- [ ] **CMD-07**: Suggestion ranking (exact name → exact alias → prefix name → prefix alias → substring in description); list responses expose metadata only, not full prompt body, except via explicit trust-guarded preview
- [ ] **CMD-08**: Unknown command dispatch returns a clear "Unknown slash command" message; disabled (untrusted) command returns a trust message; invalid prompt expansion returns a check-diagnostics message

### Workspace Watcher (WAT)

- [ ] **WAT-01**: One long-lived child process worker (`src/childprocess/aifetchly-config/`) serves all acquired workspaces (0 watched → no worker; 1+ → one worker); it watches only `<workspace>/.aifetchly/**` and optional `<workspace>/AGENTS.md`, never the whole workspace
- [ ] **WAT-02**: Worker must not access SQLite/TypeORM, mutate registries, make trust decisions, execute user functions, or call renderer IPC
- [ ] **WAT-03**: `WorkspaceWatchManager` exposes `acquire`/`release`/`rescan`/`shutdown` with per-workspace reference counting by consumer (`chat:<id>`, `stream:<id>`, `agent:<id>`, `tool:<id>`)
- [ ] **WAT-04**: Watching starts on chat open / workspace approval, continues during active streams/agent/tool runs, and stops only when all consumers release; workspace switch releases old and acquires new with immediate snapshot + source replacement + renderer notification
- [ ] **WAT-05**: File events debounced per-workspace (300–800ms) and reconciled from a fresh full snapshot (handles delete/rename/atomic save/git checkout/missed events); scan generations discard stale out-of-order scans
- [ ] **WAT-06**: Worker protocol (main→worker commands; worker→main snapshot/changed/diagnostic/error events) validated in the main process; malformed messages terminate and restart the worker
- [ ] **WAT-07**: Worker crash triggers restart (max 3 within 60s) + full rescan of all watched workspaces; cap exceeded → stop auto-watch and surface error, with `/reload-config` as manual retry; app shutdown sends shutdown then force-kills after a short timeout (no orphan workers)

### Trust & Security (TRS)

- [ ] **TRS-01**: Global `~/.aifetchly` enabled by default (user-owned); workspace `.aifetchly` untrusted until approved; trust enforced in `AIFetchlyRuntimeRegistrySync` before registry mutation (not UI-only disabled state)
- [ ] **TRS-02**: Workspace AI-config trust persisted via a TypeORM entity + Model + Module (`AIFetchlyWorkspaceTrust`) with per-capability flags (instructions/commands/agents/hooks/skills); added before hooks/skills ship
- [ ] **TRS-03**: Trust prompt UI offers Preview / Trust instructions only / Trust all workspace AI config / Keep disabled when a workspace contains `.aifetchly`
- [ ] **TRS-04**: External web/scraped/attachment content cannot override local trust policies; injected instruction blocks are clearly labeled by source
- [ ] **TRS-05**: AI-serving IPC handlers (prompt command submit, skill command, agent run, AI-backed config diagnostics) check `USER_AI_ENABLED` via `Token`; list/status/reload-rescan handlers do not
- [ ] **TRS-06**: No direct execution of arbitrary JS/shell/TS from `~/.aifetchly`; executable behavior is modeled as skills/tools or worker-executed hooks with permissions; Phase-1 prompt commands are text expansion only (invariant maintained across all phases)
- [ ] **TRS-07**: Renderer never reads extension files directly; worker never accesses DB/registries (enforced + tested as boundaries)

### Dynamic Agents (AGT)

- [ ] **AGT-01**: `AgentDefinitionRegistry` refactored for source-aware dynamic registration (`listBuiltIns`/`list`/`getById`/`replaceSource`) with lookup order built-in > user > trusted workspace > plugin; built-ins cannot be shadowed
- [ ] **AGT-02**: `agents/*.md` parsed (name, description, tools allowlist, `maxToolCalls`, `maxRuntimeMs`, prompt body) and registered with scoped IDs (`user:agent:`, `workspace:<id>:agent:`); tool allowlists intersected with actually registered and permitted tools at runtime; workspace agents require trust
- [ ] **AGT-03**: `run_subagent` validation and description updated to dispatch by dynamic agent ID; `/agents` lists built-in and dynamic agents

### Hooks (HOK)

- [ ] **HOK-01**: `hooks/hooks.json` parsed (matchers for `PreToolUse`/`PostToolUse`/`SessionStart`/`Stop`) from user and trusted-workspace config; `HookRegistry` gains `replaceSource`/`unregisterSource` (or an adapter in `AIFetchlyRuntimeRegistrySync`)
- [ ] **HOK-02**: Hooks dispatched only through existing safe hook boundaries; never execute shell directly in the main process (actions route through worker/sandbox or a registered skill); workspace hooks require trust; failures are non-fatal and surface as diagnostics; unsupported events produce diagnostics

### Skills & Plugins (SKL)

- [ ] **SKL-01**: `~/.aifetchly/skills/*/manifest.json` validated and registered through the existing `SkillRegistry`, executed via `SkillExecutor`, permission-checked via `SkillPermissionService`; never loaded as arbitrary code into the Electron main process
- [ ] **SKL-02**: Plugin `commands/*.md` promoted from opaque metadata once the native command registry is stable; plugin `agents/*.md` promoted once the dynamic agent registry is stable; `~/.aifetchly/plugins/<name>/options.json` path preserved without conflicting with installed plugin package roots under `userData/plugins/installed`

### Diagnostics (DX)

- [ ] **DX-01**: Stable diagnostic codes (`file-too-large`, `frontmatter-missing`/`-invalid`, `command-name-invalid`, `command-description-missing`, `agent-name-invalid`, `agent-tool-invalid`, `settings-json-invalid`, `path-outside-root`, `unsupported-file`, `workspace-untrusted`, `scanner-io-error`); diagnostics are source-specific and user-readable
- [ ] **DX-02**: `/status` shows global/workspace config loaded state, watcher status, last reload time, and command/agent/hook/skill/diagnostic counts; invalid-file diagnostics surface where files are ignored

### Internationalization (I18)

- [ ] **I18-01**: All new user-facing strings added under `aifetchlyConfig` / `slashCommands` i18n groups in `en`, `zh`, `es`, `fr`, `de`, `ja`

## Future Requirements

Deferred beyond v2.0 (tracked, not in current roadmap):

- **FUT-01**: Fuzzy search, recent-command ranking, aliases, and ghost-text autocomplete for slash suggestions (PRD §8.1 "later phases")
- **FUT-02**: Escaped slash support (`\/review`) (tech design §11.1 deferred)
- **FUT-03**: Whole-workspace file indexing beyond `.aifetchly` config paths (PRD §4 Non-Goal 4)
- **FUT-04**: Automatic import from `~/.claude` (PRD §4 Non-Goal 5 / Open Q 5 — may be added later as an explicit user action)
- **FUT-05**: `local` and `skill` slash command types beyond `prompt` (PRD §7.3 future command types)
- **FUT-06**: Root `<workspace>/AGENTS.md` as a primary (non-compatibility) source (currently secondary, trust-gated)

## Out of Scope

Explicit exclusions with reasoning (from PRD §4 Non-Goals):

| Feature | Reason |
|---------|--------|
| Direct execution of arbitrary JS/shell/TS from `~/.aifetchly` | Executable behavior must be modeled as skills/tools or worker hooks with permissions |
| Renderer filesystem watching | Renderer only receives typed state + notifications from main process |
| Worker database access | Watcher workers return snapshots/diffs only; main process owns persistence |
| Whole-workspace file indexing in first release | Watch only `.aifetchly` config paths + optional instruction files |
| Automatic import from `~/.claude` by default | May be added later as an explicit user action |
| Plugin-provided Vue UI extensions | Out of scope for this layer |
| Plugin-provided main-process code | Out of scope for this layer |
| LSP or output-style runtime support | Not in this work |
| Replacement of existing Skill/MCP/Hook/Plugin/Chat V2 runtime | This layer adapts files into existing systems; it does not replace them |

## Traceability

Each requirement maps to exactly one phase. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 13 | Pending |
| CFG-02 | Phase 14 | Pending |
| CFG-03 | Phase 13 | Pending |
| CFG-04 | Phase 13 | Pending |
| CFG-05 | Phase 13 | Pending |
| CFG-06 | Phase 13 | Pending |
| CFG-07 | Phase 13 | Pending |
| CTX-01 | Phase 13 | Pending |
| CTX-02 | Phase 14 | Pending |
| CTX-03 | Phase 13 | Pending |
| CMD-01 | Phase 13 | Pending |
| CMD-02 | Phase 13 | Pending |
| CMD-03 | Phase 13 | Pending |
| CMD-04 | Phase 13 | Pending |
| CMD-05 | Phase 13 | Pending |
| CMD-06 | Phase 15 | Pending |
| CMD-07 | Phase 13 | Pending |
| CMD-08 | Phase 13 | Pending |
| WAT-01 | Phase 14 | Pending |
| WAT-02 | Phase 14 | Pending |
| WAT-03 | Phase 14 | Pending |
| WAT-04 | Phase 14 | Pending |
| WAT-05 | Phase 14 | Pending |
| WAT-06 | Phase 14 | Pending |
| WAT-07 | Phase 14 | Pending |
| TRS-01 | Phase 14 | Pending |
| TRS-02 | Phase 17 | Pending |
| TRS-03 | Phase 14 | Pending |
| TRS-04 | Phase 14 | Pending |
| TRS-05 | Phase 13 | Pending |
| TRS-06 | Phase 13 | Pending |
| TRS-07 | Phase 13 | Pending |
| AGT-01 | Phase 16 | Pending |
| AGT-02 | Phase 16 | Pending |
| AGT-03 | Phase 16 | Pending |
| HOK-01 | Phase 17 | Pending |
| HOK-02 | Phase 17 | Pending |
| SKL-01 | Phase 18 | Pending |
| SKL-02 | Phase 18 | Pending |
| DX-01 | Phase 13 | Pending |
| DX-02 | Phase 13 | Pending |
| I18-01 | Phase 13 | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 42
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-04 after v2.0 milestone kickoff (from PRD §3/§7/§8–§12/§19)*
*Last updated: 2026-07-04 after initial definition*
