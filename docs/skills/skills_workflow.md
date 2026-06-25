## AI Skills (Tool Calling) Workflow for aiFetchly

This document describes how to add **AI skill support** (a.k.a. **tool calling**) to `aiFetchly` so the LLM can request well-defined actions ("skills") and the app can execute them safely.

The key idea is:
- **AI server = brain**: decides *which* skill to call and *with what arguments*
- **Electron app = hands**: actually executes the skill (often via main-process IPC), returns a JSON result, then the AI continues the response

This design matches the code you already have:
- `AiChatBox.vue` renders streaming events like `tool_call` and `tool_result`
- `AiChatApi.streamMessage()` supports sending `client_tools`
- `AiChatApi.streamContinueWithToolResults()` supports continuing after tool execution

### Current state in your codebase

- **UI already supports tool events**: `AiChatBox.vue` has dedicated UI for `tool_call` and `tool_result` message types.
- **API already supports tool definitions**: `src/api/aiChatApi.ts` sends `client_tools` to `/api/ai/ask/stream`.
- **API already supports the continuation loop**: `streamContinueWithToolResults()` posts results to `/api/ai/ask/continue`.

What’s typically missing (and what you should implement next) is the execution loop:

1. Start `/api/ai/ask/stream` with the available `client_tools` (skills)
2. When a `tool_call` arrives, **execute the skill**
3. Send the `tool_results` back via `/api/ai/ask/continue`
4. Continue streaming tokens to the UI

### Skill definition model

In this project, treat a **Skill** as two things:

1) A `ToolFunction` (what the LLM sees)

2) An `execute()` function (what the app runs)

Your existing tool definition type is in `src/api/aiChatApi.ts`:
- `ToolFunction`: `{ type, name, description, parameters }`

Recommended local registry type (conceptual):
- `definition: ToolFunction`
- `execute(args) -> JSON result`

Important constraints:
- **Allowlist only**: only expose tools you register.
- **Tight JSON schema parameters**: avoid “free-form any object” where possible.
- **Timeouts**: a skill must have a max execution time.
- **JSON-only results**: the result must be JSON-serializable and not huge.

### Where skills should execute (3 tiers)

Pick the execution tier based on what the skill needs to do:

- **Renderer-only (safe, pure)**:
  - Small transforms, formatting, parsing, summarizing local chat history
  - No filesystem, no OS, no secrets

- **Main-process skill (recommended for Electron capabilities)**:
  - Filesystem, launching automation, reading app state, DB writes/reads
  - Implemented as `ipcMain.handle(...)` and invoked from renderer
  - Must follow your project rule: **check AI enable first** in AI-related IPC handlers

- **Server skill (backend)**:
  - External network calls, shared logs/auditing, centralized auth controls
  - Best when you don’t want privileged operations on clients

Rule of thumb:
- Needs OS access → **main process skill**
- Needs external network/services → **server skill**
- Pure function → **renderer skill**

### Implementing the tool-call loop (high level)

When the user sends a message, the UI calls `streamMessage()` with:
- `message`
- optional `conversationId`
- optional `systemPrompt`
- optional `client_tools` (skills)

During streaming:
- If you receive a `tool_call` event:
  - Validate tool name is registered
  - Validate the arguments match your expected schema (and size limits)
  - Execute it (often via IPC)
  - Create a `ToolExecutionResult[]`
  - Call `streamContinueWithToolResults(conversationId, toolResults, onEvent, clientTools?, threadId?)`
  - Keep streaming tokens to the same UI pipeline

### “No dynamic import” note (important for aiFetchly)

This repo’s Electron rules forbid dynamic imports (`import()`).

That means:
- ❌ Don’t implement skills by dynamically importing arbitrary JS/TS at runtime.
- ✅ Do implement skills via a **static registry** (explicit imports + allowlist).

If you want “user-added skills” later, treat them as:
- Scripts executed via controlled child processes (with strong warnings and permission prompts), OR
- Declarative skills that map to existing safe primitives (recommended)

### Skill registry & discovery

You have two common options:

- **Registry in code (simplest, safest)**:
  - A `skillsRegistry.ts` exporting an array/map of skills
  - The UI sends `client_tools` derived from the registry

- **Registry manifest (more flexible)**:
  - A JSON manifest listing skill name/description/parameter schema
  - Execution still maps to allowlisted implementations
  - Useful if you want to display skills in UI (like your MCP Tool Manager)

### Security & safety checklist

Because tool calling can trigger side effects, enforce:

- **Parameter validation**:
  - Reject unknown keys
  - Enforce max string lengths / max array sizes
  - Reject suspicious content (tokens, cookies, passwords) where applicable

- **Permission gating**:
  - Some skills should require user confirmation (send email, post social, delete, write files)
  - Prefer a “plan/dry-run” tool first, then an “apply” tool

- **Auditing**:
  - Log tool name, arguments (sanitized), success/failure, and duration

- **Determinism where possible**:
  - Skills should be stable, idempotent, and return structured results

- **Don’t run privileged actions in renderer**:
  - Use main process IPC or server endpoints for anything sensitive

### Practical rollout plan (recommended)

Start small and iterate:

1. Add 1–2 **safe skills** (pure, no side effects) to validate the loop end-to-end.
2. Wire up `tool_call -> execute -> continue` so the assistant can finish responses after tool results.
3. Add main-process skills (IPC-based) with confirmation prompts for side effects.
4. Add a UI toggle:
   - enable/disable skills
   - “selected skills only” mode for safer defaults

### Appendix: terminology mapping

- **Skill** (this doc): an app-executable capability exposed to the LLM
- **Tool** (stream events): the LLM’s requested call (`tool_call`) and your returned result (`tool_result`)
- **client_tools** (API): the list of tool definitions you provide to the backend for the LLM to choose from