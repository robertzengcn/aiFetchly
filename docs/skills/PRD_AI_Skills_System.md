# PRD: AI Skills System for aiFetchly

**Version:** 1.0 | **Date:** 2026-04-03 | **Status:** Draft

---

## 1. Overview

### 1.1 Problem Statement

aiFetchly's AI chat currently supports a fixed set of built-in tools (Google/Bing/Yandex scraping, contact extraction, website analysis, etc.) and MCP server tools. The system lacks:

- A unified **skill concept** that encompasses built-in, user-authored, and marketplace-sourced capabilities
- **Lifecycle management** (install, update, uninstall) for skills beyond MCP
- **Security boundaries** for running user-authored or third-party code
- **Granular permission controls** and user trust mechanisms
- A **marketplace-compatible import format** for discovering and installing external skills

### 1.2 Product Goal

Extend aiFetchly with a **Skills System** that allows the AI to execute well-defined, securely-sandboxed capabilities requested by the user during chat conversations. Three skill sources must be supported:

1. **Built-in skills** — shipped with the app, fully trusted
2. **User-authored skills** — personal scripts written by power users
3. **Marketplace skills** — imported from external sources (e.g., SkillsMP.com)

### 1.3 Success Metrics

| Metric | Target |
|--------|--------|
| End-to-end tool-call loop latency (built-in skill) | < 2 seconds |
| User-authored skill sandbox isolation | 100% (no access to process/fs/electron) |
| Permission prompt completion rate | > 90% |
| Skill install success rate | > 95% |
| Zero security incidents from sandbox escape | Mandatory |

---

## 2. Terminology

| Term | Definition |
|------|-----------|
| **Skill** | A named, versioned capability that the AI can invoke during a conversation. Composed of a manifest + executable logic. |
| **Skill Manifest** | A `skill.json` file describing the skill's name, description, parameters (JSON Schema), permissions, and runtime. |
| **Skill Registry** | A static TypeScript registry mapping skill names to their definitions and executors. |
| **Skill Tier** | Where a skill executes: `renderer` (pure), `main` (IPC), `sandboxed` (isolated VM). |
| **Tool Call** | The LLM's request to invoke a skill (SSE event from the AI server). |
| **Tool Result** | The JSON result returned to the LLM after skill execution. |
| **Permission Category** | Classification of skill capabilities: `pure`, `network`, `filesystem`, `automation`. |

---

## 3. Current State (What Exists vs. What's Missing)

### 3.1 Already Implemented

| Component | File | Status |
|-----------|------|--------|
| Tool function types | `src/api/aiChatApi.ts` (`ToolFunction`, `ToolExecutionResult`) | Done |
| Streaming API | `AiChatApi.streamMessage()`, `streamContinueWithToolResults()` | Done |
| Chat event handling | `AiChatBox.vue` handles `tool_call` / `tool_result` SSE events | Done (display only) |
| Static tool definitions | `src/config/aiTools.config.ts` (Google, Bing, Yandex, etc.) | Done |
| Tool execution engine | `src/service/ToolExecutor.ts` with rate limiting | Done |
| MCP tool integration | `src/service/MCPToolService.ts` + `MCPToolManager.vue` | Done |
| AI chat IPC handlers | `src/main-process/communication/ai-chat-ipc.ts` | Done |
| Stream event processing | `src/service/StreamEventProcessor.ts` | Done |

### 3.2 Gap Analysis

| Gap | Impact | Priority |
|-----|--------|----------|
| No tool-call **execution loop** in `AiChatBox.vue` (tool_call events displayed but not executed/continued) | Critical — skills cannot run | P0 |
| No **skill registry** — tools scattered across config files and MCP | Cannot discover or manage skills | P0 |
| No **sandboxing** for user-authored skills | Security risk — malicious code could access filesystem/process | P1 |
| No **permission system** — no user consent prompts | Untrusted code runs without boundaries | P1 |
| No **skill lifecycle management** (install/update/uninstall) | Cannot import or manage marketplace skills | P2 |
| No **skill UI page** — only MCP tool manager exists | Users cannot browse/enable/disable skills | P2 |
| No **manifest validation** on import | Malformed skills could break the system | P2 |

---

## 4. Functional Requirements

### FR-1: Tool-Call Execution Loop (P0)

The AI chat must complete the full tool-call cycle:

1. User sends a message with `client_tools` from the skill registry
2. AI server returns a `tool_call` SSE event with `toolName`, `toolCallId`, `toolParams`
3. Electron **validates** the tool name against the registry
4. Electron **executes** the skill at the appropriate tier
5. Electron sends `tool_results` back via `streamContinueWithToolResults()`
6. Streaming continues — the AI incorporates the tool result and responds to the user

**Acceptance Criteria:**
- When the AI requests a tool, it is executed and the result is returned within the same conversation
- The UI shows execution status (running, success, error) inline in the chat
- Errors in tool execution do not crash the stream — they are returned as error results to the AI

### FR-2: Skill Registry (P0)

A unified, static TypeScript registry that is the **single source of truth** for all available skills.

Each skill entry must include:
- `name` — unique identifier
- `description` — human-readable description (shown to the LLM)
- `parameters` — JSON Schema for input validation
- `tier` — execution tier: `renderer` | `main` | `sandboxed`
- `requiresConfirmation` — whether user consent is needed before execution
- `permissionCategory` — `pure` | `network` | `filesystem` | `automation`
- `execute(args)` — the function that runs the skill
- `source` — `built-in` | `user` | `marketplace`

**Constraints:**
- No dynamic imports (`import()`) — all skills are statically registered
- Registry is rebuilt at compile time; runtime additions only via the marketplace import flow (validates and registers into a persisted store)

**Acceptance Criteria:**
- All existing built-in tools are migrated to the registry
- MCP tools are discoverable through the registry (as a dynamic sub-provider)
- The registry can enumerate all available skills and their definitions for the LLM

### FR-3: Skill Execution Tiers (P0/P1)

| Tier | When to Use | Execution Environment | Security Level |
|------|------------|----------------------|----------------|
| **Renderer** (P0) | Pure computation, formatting, parsing | Renderer process, plain async function | Trusted |
| **Main process** (P0) | Filesystem, DB access, OS operations, Puppeteer | Main process via `ipcMain.handle()` | Trusted (app code) |
| **Sandboxed** (P1) | User-authored or marketplace JS/TS skills | `isolated-vm` with explicit API grants | Untrusted |

**Acceptance Criteria:**
- Built-in skills execute at renderer or main tier without any sandbox overhead
- User-authored skills execute in `isolated-vm` with no access to `process`, `fs`, `require`, or `electron`
- Sandboxed skills receive only explicitly granted APIs (e.g., a proxied `fetch`, `log`, skill arguments)
- Sandboxed skills have a memory limit (default: 64MB) and execution timeout (default: 30s)

### FR-4: Permission System (P1)

A capability-based permission model gating sensitive skill actions.

**Permission Categories:**

| Category | Example Actions | Risk Level | Default Policy |
|----------|----------------|------------|----------------|
| `pure` | Data formatting, math, text processing | None | Auto-allow |
| `network` | HTTP requests to specific domains | Medium | Confirm first time per domain |
| `filesystem` | Read/write local files | High | Always confirm |
| `automation` | Trigger Puppeteer, social posting, scraping | High | Always confirm |

**Permission Lifecycle:**

1. **Install-time:** When a skill is imported, its manifest declares required permissions. The user reviews and grants/denies before installation completes.
2. **Runtime (fallback):** If a skill attempts an action not covered by install-time grants, a confirmation dialog appears (with "Remember my choice" checkbox).
3. **Persistence:** Granted permissions stored via the existing `Token` service pattern (e.g., `SKILL_PERMISSION_<skillName>`).
4. **Revocation:** Users can revoke permissions at any time from the Skills management page.

**Acceptance Criteria:**
- Skills with `pure` category never show a confirmation dialog
- Skills with `automation` or `filesystem` always require explicit user approval
- Network permissions are scoped per domain (e.g., `linkedin.com` only)
- A "Developer Mode" toggle is available for power users to skip all prompts (off by default)

### FR-5: Skill Import and Marketplace Compatibility (P2)

Support for importing skills from external sources using a standardized format.

**Skill Package Format** — a `.zip` file containing:

```
skill-folder/
├── skill.json          # Manifest (required)
├── main.js / main.ts   # Entry point (required)
├── README.md           # Documentation (optional)
└── assets/             # Supporting files (optional)
```

**Manifest Schema (`skill.json`):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique kebab-case identifier |
| `version` | string | Yes | Semver version |
| `description` | string | Yes | Human-readable description |
| `author` | string | No | Skill author |
| `runtime` | string | Yes | `javascript` or `python` |
| `entry` | string | Yes | Relative path to entry file |
| `parameters` | object | Yes | JSON Schema for inputs |
| `permissions` | string[] | No | Permission declarations |

**Import Flow:**

1. User clicks "Add Skill" with file dialog (`.zip` filter)
2. Main process extracts zip to `app.getPath('userData')/installed_skills/<name>/`
3. Manifest validation: required fields present, name unique, version valid semver, parameters valid JSON Schema, runtime supported
4. Permissions displayed in a review dialog
5. User grants/denies installation
6. Skill registered in local SQLite store
7. Skill available immediately via hot registration (no restart needed)

**Acceptance Criteria:**
- Valid skill package imported in < 5 seconds
- Invalid manifests rejected with clear error messages
- Duplicate names prompt for update or cancellation
- Imported skills persist across app restarts

### FR-6: Skills Management UI (P2)

A dedicated page for managing all skills (built-in, user-authored, marketplace).

| View | Contents |
|------|----------|
| **Skill List** | All installed skills with name, source, status (enabled/disabled), permission category |
| **Skill Detail** | Description, parameters, permissions, version, author, last used |
| **Import** | "Add Skill" button, file dialog, manifest review, confirm |
| **Settings** | Enable/disable individual skills, "Developer Mode" toggle, global permission defaults |
| **MCP Integration** | Existing MCP tool manager accessible as a tab within this page |

**Chat Integration:**
- When a `tool_call` arrives for a skill needing confirmation, show an inline approval card:

```
Tool: LinkedIn Scraper wants to access linkedin.com
[Allow Once] [Always Allow] [Deny]
```

---

## 5. Non-Functional Requirements

### NFR-1: Security

| Requirement | Detail |
|-------------|--------|
| No dynamic imports | All built-in skills statically imported at compile time |
| Sandboxed execution | User-authored JS/TS skills run in `isolated-vm`, never in main process |
| Parameter validation | All arguments validated against JSON Schema before execution |
| Input sanitization | Reject arguments containing tokens, cookies, passwords, or suspicious patterns |
| Memory limits | Sandboxed skills limited to 64MB (configurable) |
| Execution timeout | Sandboxed skills limited to 30 seconds (configurable) |
| Audit logging | All executions logged: tool name, args (sanitized), success/failure, duration |
| No double execution | A tool name executes at exactly one tier (client OR server, never both) |

### NFR-2: Performance

| Requirement | Target |
|-------------|--------|
| Built-in skill execution overhead | < 100ms (excluding I/O) |
| Sandboxed skill startup | < 500ms |
| Registry enumeration (for `client_tools`) | < 10ms |
| Permission check | < 5ms (cached) |
| Manifest validation on import | < 1s |

### NFR-3: Compatibility

- Existing MCP tool system continues to work without changes
- Existing built-in tools continue to function during and after migration
- Python skills supported via `child_process.spawn` (not `exec`) with limited OS permissions

### NFR-4: Maintainability

- Each skill file < 400 lines; registry file < 200 lines
- No `any` types — all interfaces use explicit types or `unknown` with type guards
- Immutable patterns — skill execution results are new objects, never mutated inputs
- Every tier has comprehensive error handling with structured error results

---

## 6. Architecture

### 6.1 System Flow

```
User sends message
        |
        v
AiChatBox.vue
  1. Collect client_tools from SkillRegistry.getAllToolFunctions()
  2. Call AiChatApi.streamMessage(msg, tools)
        |
        | SSE stream
        v
StreamEventProcessor
  case 'tool_call':
    1. Validate tool name in registry
    2. Check permissions (skip if pure)
    3. Delegate to SkillExecutor.execute(name, args)
    4. Call streamContinueWithToolResults(result)
        |
        +--------------+--------------+
        v              v              v
   Renderer        Main IPC     Sandboxed
   (pure)         (trusted)    (isolated-vm)
```

### 6.2 New Files

| File | Purpose |
|------|---------|
| `src/config/skillsRegistry.ts` | Unified skill registry with `getAllToolFunctions()` and delegation |
| `src/service/SkillExecutor.ts` | Orchestrator — validates, permission-checks, dispatches to tier, returns `ToolExecutionResult` |
| `src/service/SkillPermissionService.ts` | Permission persistence and checking using `Token` service pattern |
| `src/service/SkillImportService.ts` | Import flow — zip extraction, manifest validation, local storage |
| `src/main-process/communication/skills-ipc.ts` | IPC handlers for main-process execution and import |
| `src/views/pages/systemsetting/skills.vue` | Skills management UI page |

### 6.3 Files to Modify

| File | Change |
|------|--------|
| `src/views/components/aiChat/AiChatBox.vue` | Add tool-call execution loop in `tool_call` event handler |
| `src/service/StreamEventProcessor.ts` | Integrate with `SkillExecutor` for tool-call dispatch |
| `src/config/aiTools.config.ts` | Migrate static tool definitions into the registry |
| `src/service/ToolExecutor.ts` | Wrap or delegate to `SkillExecutor` |
| `src/preload.ts` | Add `invokeSkill` and `importSkill` to contextBridge |
| `src/background.ts` | Register new skills IPC handlers |
| Navigation/menu config | Add "Skills" page link |

### 6.4 Data Model — `installed_skills` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT UNIQUE | Skill identifier |
| `version` | TEXT | Semver version |
| `source` | TEXT | `built-in` / `user` / `marketplace` |
| `manifest_json` | TEXT | Full manifest JSON |
| `permissions_json` | TEXT | Granted permissions JSON |
| `enabled` | INTEGER | 0 or 1 |
| `installed_at` | TEXT ISO8601 | Installation timestamp |
| `updated_at` | TEXT ISO8601 | Last update timestamp |

---

## 7. Phased Implementation Plan

### Phase 1: Core Loop (P0) — Minimum Viable Skills

**Goal:** The AI can invoke a built-in skill and receive the result within the same conversation.

| Step | Deliverable |
|------|-------------|
| 1.1 | Create `skillsRegistry.ts` with 2-3 migrated built-in skills |
| 1.2 | Create `SkillExecutor.ts` — validates name, dispatches to tier, returns result |
| 1.3 | Wire `tool_call -> execute -> streamContinueWithToolResults` in stream handler |
| 1.4 | End-to-end test: user asks AI to search, AI calls tool, result appears in chat |
| 1.5 | Migrate all remaining built-in tools from `aiTools.config.ts` to registry |

**Exit Criteria:** AI can invoke any built-in skill during chat; MCP tools unchanged; all existing functionality preserved.

### Phase 2: Security and Permissions (P1)

**Goal:** User-authored skills run safely; permissions protect sensitive operations.

| Step | Deliverable |
|------|-------------|
| 2.1 | `SkillPermissionService.ts` — install-time and runtime permission checks |
| 2.2 | Add permission categories to all registry entries |
| 2.3 | `isolated-vm` sandboxed executor (memory limit, timeout, explicit API grants) |
| 2.4 | Confirmation dialogs for high-risk skills |
| 2.5 | Inline chat approval card for runtime permission prompts |
| 2.6 | Audit logging for all skill executions |

**Exit Criteria:** Sandboxed skills cannot access `process`/`fs`/`require`/`electron`; high-risk skills require approval; all executions logged.

### Phase 3: Import and Marketplace (P2)

**Goal:** Users can import external skill packages and manage them through a UI.

| Step | Deliverable |
|------|-------------|
| 3.1 | `InstalledSkill` entity + SQLite migration |
| 3.2 | `SkillImportService.ts` — zip extraction, manifest validation, storage |
| 3.3 | `skills-ipc.ts` — import, list, enable/disable, uninstall, update handlers |
| 3.4 | `skills.vue` — Skills management page |
| 3.5 | Hot registration — imported skills available immediately |
| 3.6 | Developer Mode toggle |

**Exit Criteria:** Users can import `.zip` skill packages through UI; imported skills appear in chat and can be invoked by the AI; skills can be enabled/disabled/uninstalled.

### Phase 4: Scale (Future)

- Skill Store UI — browse and install from marketplace
- Skill versioning and auto-update
- Skill dependency resolution
- Hidden BrowserWindow sandbox for highest-security needs
- Python skill support via `child_process.spawn`
- Community skill sharing

---

## 8. API Contracts

### SkillRegistry

```
getAllToolFunctions(): ToolFunction[]
getSkill(name: string): SkillDefinition | null
isRegistered(name: string): boolean
registerSkill(skill: SkillDefinition): void
unregisterSkill(name: string): void
```

### SkillExecutor

```
execute(name, args, context): Promise<ToolExecutionResult>
isPermissionRequired(name: string): boolean
checkPermission(name: string): Promise<boolean>
```

### New IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `EXECUTE_SKILL` | Renderer -> Main -> Renderer | Execute a main-process skill |
| `IMPORT_SKILL` | Renderer -> Main | Import a skill package |
| `LIST_SKILLS` | Renderer -> Main -> Renderer | List all installed skills |
| `TOGGLE_SKILL` | Renderer -> Main | Enable/disable a skill |
| `UNINSTALL_SKILL` | Renderer -> Main | Remove a skill |
| `CHECK_SKILL_PERMISSION` | Renderer -> Main -> Renderer | Check/request permission |

---

## 9. Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Sandbox escape via `isolated-vm` | Low | Critical | Pin version; audit release notes; hidden BrowserWindow fallback |
| Permission fatigue | Medium | Medium | Install-time manifest review; `pure` auto-allow; "Always Allow" option |
| Breaking existing tools during migration | Medium | High | Run both systems in parallel during Phase 1 |
| Malformed marketplace manifests | Medium | Medium | Strict validation; clear error messages; reject unknown fields |
| Performance overhead from sandbox | Low | Low | Only sandboxed skills pay overhead; built-in run directly |
| Skill name collision | Low | Medium | `custom_` prefix for imported; reject imports shadowing built-in names |

---

## 10. Open Questions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Should `SkillExecutor` replace or wrap `ToolExecutor`? | **Wrap** for Phase 1 (minimal risk), merge later |
| 2 | Where should sandboxed skills run? | **Main process** for v1; hidden BrowserWindow for v2 |
| 3 | Should marketplace skills require online signature verification? | **Yes** for marketplace; **No** for local file import |
| 4 | Maximum concurrent skill executions? | **5** (configurable) |
| 5 | Python skills in Phase 3? | **Later** (Phase 4) — focus on JS/TS first |

---

## 11. Appendix: Source Documents

| Document | Key Contribution to PRD |
|----------|------------------------|
| `skills_workflow.md` | Core loop design (brain vs hands), skill definition model, tier architecture, no-dynamic-import constraint |
| `technology_advice.md` | `SkillExecutor` service design, registry pattern, permission storage via `Token`, `AiChatBox.vue` integration options |
| `Sandboxing TypeScript_JS Skills.md` | `isolated-vm` as standard (avoid `vm2`), memory limits, sandboxing comparison table, malicious skill threat model |
| `Skill Permissions and User Trust.md` | Capability architecture, permission categories, manifest-at-install approach, consent dialog UX, Developer Mode |
| `Electron Skills Import and Integration.md` | Marketplace-compatible manifest format, import flow, zip extraction, skill-to-AI sync pattern |
