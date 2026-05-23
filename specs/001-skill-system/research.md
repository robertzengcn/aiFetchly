# Research: AI Skills System

**Date**: 2026-04-03 | **Feature**: 001-skill-system

## Decision 1: Skill Registry Pattern — Static TypeScript Registry

**Decision**: Use a static TypeScript registry file (`skillsRegistry.ts`) with named exports and a `Map<string, SkillDefinition>` at module level.

**Rationale**: The project has a strict "no dynamic import" rule. A static registry provides TypeScript type safety through the entire chain, no file I/O at startup, no deserialization risks, and full IDE support for refactoring.

**Alternatives considered**:
- JSON manifest files: Rejected — loses type safety, requires runtime validation, no IDE refactoring support
- Decorator-based registry: Rejected — over-engineering for the number of skills, adds complexity
- Dynamic import(): Explicitly prohibited by project architecture rules

## Decision 2: Tool-Call Execution Loop Integration — Fire-and-Forget Async

**Decision**: Use Option A (fire-and-forget async) inside the `tool_call` case handler in `StreamEventProcessor`. The handler kicks off `executeSkillAndContinue()` as an async operation without blocking the stream processor.

**Rationale**: The current `StreamEventProcessor` already handles tool calls in the main process. The minimal-risk approach is to extend the existing `handleToolCallEvent()` to dispatch to the `SkillExecutor` and then call `streamContinueWithToolResults()`. This avoids refactoring the `onEvent` callback signature.

**Alternatives considered**:
- Promise queue sequencing: Rejected for v1 — adds complexity; fire-and-forget is sufficient since tool calls are sequential within a conversation
- Refactoring `onEvent` to return `Promise<void>`: Rejected — would require changes across the streaming infrastructure for minimal benefit

## Decision 3: Execution Tier Dispatching

**Decision**: `SkillExecutor` checks the skill's `tier` property and dispatches accordingly:
- `renderer`: Execute directly in the current process context
- `main`: Send via IPC to `skills-ipc.ts` handler
- `sandboxed`: Execute via `isolated-vm` in the main process (Phase 2)

**Rationale**: The existing `ToolExecutor` already runs in the main process context (via `StreamEventProcessor` in the IPC handler). Renderer-tier skills are pure functions that can run anywhere. Main-tier skills need IPC for filesystem/OS access. The dispatch pattern keeps each tier isolated.

**Alternatives considered**:
- All skills via IPC: Rejected — adds unnecessary latency for pure computation skills
- Hidden BrowserWindow for all untrusted: Deferred to future phase — isolated-vm is sufficient for v1

## Decision 4: Permission Storage — Token Service Pattern

**Decision**: Store permission grants using the existing `Token` service with keys like `SKILL_PERMISSION_<skillName>`.

**Rationale**: The project already uses the `Token` service for settings like `USER_AI_ENABLED`. Reusing this pattern is consistent, well-understood, and avoids introducing a new storage mechanism.

**Alternatives considered**:
- Separate SQLite table: Rejected for permissions — adds migration overhead for simple key-value data; use SQLite only for installed skill records (Phase 3)
- Electron store: Rejected — the Token service already wraps this concept

## Decision 5: Skill Import — Zip Extraction to userData

**Decision**: Use `adm-zip` to extract skill packages to `app.getPath('userData')/installed_skills/<name>/`. Validate manifest before extraction completes. Store metadata in SQLite `installed_skills` table.

**Rationale**: Standard Electron pattern for user data persistence. `adm-zip` is synchronous and reliable for small packages. SQLite provides queryable persistence for the skills management UI.

**Alternatives considered**:
- `node:zlib` + manual extraction: Rejected — more code for the same result, adm-zip is battle-tested
- Tar archives: Rejected — less user-friendly than zip, marketplace standard is zip

## Decision 6: Sandboxing Library — isolated-vm

**Decision**: Use `isolated-vm` for user-authored JavaScript skills with 64MB memory limit and 30-second execution timeout.

**Rationale**: `isolated-vm` creates separate V8 isolates with proper memory and CPU limits. It's actively maintained and specifically designed for running untrusted code. The project docs explicitly recommend it over `vm2` (unmaintained) and Node.js built-in `vm` (not a security boundary).

**Alternatives considered**:
- `vm2`: Rejected — no longer maintained, known security issues
- Node.js `vm` module: Rejected — not a security boundary, shares the same V8 isolate
- Hidden BrowserWindow: Deferred — more isolated but higher overhead; suitable for Phase 4

## Decision 7: MCP Integration — Dynamic Sub-Provider

**Decision**: The skill registry wraps MCP tools as a dynamic sub-provider. When `getAllToolFunctions()` is called, it merges static built-in skills with enabled MCP tools from `MCPToolService.getEnabledMCPToolsAsFunctions()`.

**Rationale**: MCP tools already have a complete service layer (`MCPToolService`). Rather than migrating MCP tools into the static registry (which would break the dynamic discovery model), the registry acts as an aggregator that includes MCP tools at enumeration time.

**Alternatives considered**:
- Migrate MCP into static registry: Rejected — MCP tools are discovered dynamically from servers; static registration would break this
- Keep MCP separate: Rejected — creates two parallel tool systems that the AI and UI must handle differently

## Decision 8: Existing ToolExecutor — Wrap, Don't Replace

**Decision**: `SkillExecutor` wraps the existing `ToolExecutor` during Phase 1. Built-in tool execution is delegated to `ToolExecutor.execute()`, while the `SkillExecutor` handles registry lookup, permission checks, and tier dispatching.

**Rationale**: Minimizes risk during migration. The existing `ToolExecutor` has rate limiting, timeouts, and tool-specific handlers that work correctly. Wrapping preserves all of this while adding the registry and permission layer on top.

**Alternatives considered**:
- Replace ToolExecutor entirely: Rejected — high risk, would require re-implementing all tool handlers
- Fork ToolExecutor: Rejected — creates maintenance burden of two parallel implementations
