# PRD: AiFetchly Hooks System

**Date:** 2026-06-23
**Status:** Draft
**Owner:** AiFetchly AI Chat / Skill Runtime
**Related areas:** AI Chat V2, skill execution, tool permissions, plugin system, agent runtime
**Reference:** Claude Code hooks lifecycle model, adapted for AiFetchly architecture

## Summary

AiFetchly should add a lifecycle hooks system that lets trusted users, projects, plugins, and built-in app code observe, block, modify, and annotate AI/tool execution at well-defined points.

The feature is inspired by Claude Code hooks, but AiFetchly should not copy the full Claude Code system in the first version. AiFetchly already has a TypeScript/Electron architecture, a `SkillRegistry`, `SkillExecutor`, `ToolExecutor`, `SkillPermissionService`, `StreamEventProcessor`, local SQLite persistence, plugins, and strict worker/database separation rules. Hooks should wrap these existing seams instead of becoming a second execution framework.

The first version should focus on the AI chat and tool loop:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `PermissionRequest`
- `PermissionDenied`

The system should start with typed contracts, a central dispatcher, in-process callback hooks, strict permission behavior, and optional command hooks behind explicit user approval. HTTP, prompt, agent, async, and plugin-distributed hooks can follow after the core pipeline is stable.

## Problem

AiFetchly's AI chat and skill system is becoming more powerful. It can call local tools, run shell-like operations through skills, use MCP tools, scrape websites, manage email marketing workflows, and coordinate plan-mode or agent tasks. Users and plugin authors will increasingly need controlled extension points around this lifecycle.

Today, there is no uniform place to:

- Block a risky tool call before execution based on local policy.
- Rewrite tool arguments before execution.
- Add contextual warnings or reminders to the AI after a tool call.
- Enforce organization, project, or user-specific guardrails.
- Log or audit sensitive tool behavior in a standardized way.
- Let plugins safely attach behavior to AI/tool lifecycle events.
- Add internal built-in checks without scattering conditional logic across the chat loop.

Without a hook system, these behaviors tend to become ad hoc conditionals in `StreamEventProcessor`, `SkillExecutor`, IPC handlers, or plugin code. That makes behavior harder to test, easier to bypass, and riskier to extend.

## Goals

1. Add typed lifecycle events around AI chat and tool execution.
2. Keep hook dispatch centralized and testable.
3. Preserve the existing `SkillRegistry`, `SkillExecutor`, `ToolExecutor`, and `SkillPermissionService` flow.
4. Ensure hook `allow` decisions never bypass existing permission checks.
5. Allow hooks to block, ask, modify input, add context, or annotate output in controlled ways.
6. Support multiple hook sources with predictable priority and visibility.
7. Support safe built-in/session callback hooks first.
8. Support command hooks only with explicit user trust, timeout, output limits, and audit logging.
9. Keep IPC handlers thin and free of direct database access.
10. Keep child/worker processes free of direct database access.
11. Gate AI-powered hook types behind `USER_AI_ENABLED` before any AI work.
12. Provide enough observability that users understand when hooks affect a turn.

## Non-Goals

1. Do not copy Claude Code's complete hook surface in the first release.
2. Do not add prompt hooks, agent hooks, async background hooks, or async re-wake in the MVP.
3. Do not let hooks execute arbitrary database writes directly.
4. Do not let hook `allow` override denied or unknown skill permissions.
5. Do not let renderer code execute hooks directly.
6. Do not move hook execution into existing scraping workers.
7. Do not add an enterprise policy system in the first version.
8. Do not require a new external agent framework.
9. Do not redesign the AI chat UI in the first version.
10. Do not make hooks invisible when they block, modify, or add context to a turn.

## Users

### Primary User

A power user or operator using AiFetchly AI chat and tools to run marketing, scraping, email, and automation workflows. This user wants local control over risky AI actions and repeatable automation around tool calls.

### Secondary User

A developer or plugin author extending AiFetchly. This user wants a stable lifecycle API instead of patching tool execution internals.

### Internal User

AiFetchly maintainers who need built-in lifecycle policies, diagnostic attachments, safety checks, and structured audit behavior without hard-coding every behavior inside the stream processor.

## Product Principles

### Hooks Are A Policy Layer

Hooks should observe, constrain, transform, or annotate existing execution. They should not replace `SkillExecutor`, `ToolExecutor`, `SkillPermissionService`, or the module/model database architecture.

### Stricter Can Win, Looser Cannot

A hook may block a tool that would otherwise run. A hook may request confirmation. A hook may add warnings. A hook may rewrite input before permission and execution. But a hook may not bypass existing denied or prompt-required permission rules.

### The Main Process Owns The Boundary

Hooks should be dispatched from the main process service layer. Renderer code may display hook events, approvals, and outcomes, but it should not execute hook logic.

### Typed Contracts Beat Ad Hoc Strings

Every hook event should have a typed input and output contract. Hook outputs should be parsed, validated, and aggregated before affecting execution.

### Small MVP, Clear Expansion Path

The first release should prove event dispatch and `PreToolUse` / `PostToolUse` integration. More hook types should be added only after safety, observability, and tests are solid.

## Current State

AiFetchly already has several relevant pieces:

| Area | Current component | Relevance |
| --- | --- | --- |
| Tool event loop | `src/service/StreamEventProcessor.ts` | Receives tool calls, executes tools, saves results, sends results back to AI |
| Skill execution | `src/service/SkillExecutor.ts` | Validates skills, checks permissions, rate-limits shell skills, audits results |
| Legacy and MCP execution | `src/service/ToolExecutor.ts` | Executes tools not fully covered by the registry path |
| Skill permissions | `src/service/SkillPermissionService.ts` | Stores grant/deny/session permission state using `Token` |
| Tool result persistence | `src/service/ToolExecutionService.ts` | Saves tool call and result messages |
| Sandboxed skill worker | `src/childprocess/SkillWorker.ts` | Existing worker entry point for sandboxed skill execution |
| Plugin system | `PluginManagementModule`, plugin IPC and UI | Future hook source for plugin-provided hooks |
| AI enable gate | `Token` + `USER_AI_ENABLED` | Required before AI functions do work |

The strongest first integration point is `StreamEventProcessor.executeTool()`, because it catches registry skills, MCP tools, and legacy tools in one place.

## Proposed Solution

Add a hook subsystem under the service layer:

```text
Renderer
  -> preload API
  -> AI chat IPC
  -> StreamEventProcessor
  -> HookDispatcher.executeHooks(PreToolUse)
  -> SkillExecutor / ToolExecutor
  -> HookDispatcher.executeHooks(PostToolUse or PostToolUseFailure)
  -> ToolExecutionService persistence
  -> AI server continuation
  -> renderer stream events
```

Suggested files:

```text
src/entityTypes/hookTypes.ts
src/service/hooks/HookRegistry.ts
src/service/hooks/HookDispatcher.ts
src/service/hooks/HookMatcher.ts
src/service/hooks/HookOutputValidator.ts
src/service/hooks/executors/CallbackHookExecutor.ts
src/service/hooks/executors/CommandHookExecutor.ts
src/service/hooks/HookAuditService.ts
src/modules/HookModule.ts                 # only if persisted hook CRUD is needed
src/model/Hook.model.ts                   # only if persisted hook CRUD is needed
src/main-process/communication/hooks-ipc.ts
test/vitest/utilitycode/hooks/*.test.ts
test/vitest/main/hooks-ipc.test.ts
```

## Hook Events

### MVP Events

| Event | When it fires | Primary use |
| --- | --- | --- |
| `SessionStart` | When an AI chat session or query session begins | Add initial context, attach watch-style metadata later |
| `UserPromptSubmit` | After user submits a prompt, before remote AI request | Validate prompt, add local context, block unsafe prompts |
| `PreToolUse` | Before a local tool/skill/MCP tool executes | Block, ask, rewrite input, add context |
| `PostToolUse` | After successful local tool execution | Annotate output, add context, emit audit messages |
| `PostToolUseFailure` | After failed local tool execution | Add recovery context, classify failure, block continuation if needed |
| `PermissionRequest` | When a skill/tool needs user approval | Add reason, enforce stricter policy, enrich approval UI |
| `PermissionDenied` | When user or policy denies a tool | Audit, add explanation, block follow-up loops |
| `Stop` | When a turn completes or is stopped | Cleanup session hooks, summarize hook effects |

### Deferred Events

The following events are valuable but should wait:

| Event | Reason to defer |
| --- | --- |
| `ConfigChange` | Requires stable settings source and UI |
| `FileChanged` | AiFetchly is not primarily a project-file coding agent |
| `PreCompact` / `PostCompact` | Depends on context compaction architecture |
| `SubagentStart` / `SubagentStop` | Depends on agent runtime maturity |
| `TaskCreated` / `TaskCompleted` | Should be added after AI chat hooks are stable |
| `HTTPResponse` or remote events | Needs separate security and privacy review |

## Hook Sources

Hook source controls trust, priority, and persistence.

| Source | Description | MVP support |
| --- | --- | --- |
| `builtin` | Internal app hooks registered in code | Yes |
| `session` | Ephemeral hooks registered for the current runtime/session | Yes |
| `user` | User-configured hooks stored locally | Yes, after dispatcher MVP |
| `project` | Project/workspace hook config | Later, if project concepts become stronger |
| `plugin` | Hooks bundled with enabled plugins | Later |
| `policy` | Admin-managed enterprise hooks | No first version |

Recommended merge priority:

1. `policy` later, when available
2. `builtin`
3. `session`
4. `project`
5. `plugin`
6. `user`

Stricter outcomes should aggregate across all sources. Priority should decide ordering and conflict display, not allow a lower-priority hook to undo a block from a higher-priority hook.

## Hook Types

### MVP Hook Types

| Type | Description | Persistence |
| --- | --- | --- |
| `callback` | In-process TypeScript function registered by app code | Runtime only |
| `command` | Local process that receives hook JSON on stdin and returns hook JSON on stdout | User/project/plugin config after approval |

### Later Hook Types

| Type | Description | Required before support |
| --- | --- | --- |
| `http` | POST hook input JSON to a URL | SSRF guard, URL allowlist, private network blocking |
| `prompt` | AI evaluation over hook input | `USER_AI_ENABLED`, recursion guard, budget controls |
| `agent` | Agentic verifier or subtask | Agent runtime maturity, recursion guard |
| `function` | Session-only TypeScript predicate/filter | Only if needed beyond `callback` |

The MVP should not include `prompt` or `agent` hooks. Those types create recursion and billing/plan risks.

## Configuration Shape

The user-facing persisted shape should be close to Claude Code's shape but adapted to AiFetchly names.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "shell_execute",
        "hooks": [
          {
            "type": "command",
            "command": "node ./hooks/check-shell-command.js",
            "timeoutMs": 5000,
            "statusMessage": "Checking shell command policy"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node ./hooks/classify-tool-error.js",
            "timeoutMs": 5000
          }
        ]
      }
    ]
  }
}
```

### Matcher Semantics

For tool events, `matcher` matches `toolName`.

Supported matcher MVP:

- Exact name: `shell_execute`
- Wildcard all: `*`
- Simple glob: `mcp_*`, `scrape_*`

Avoid supporting complex permission-rule syntax in MVP. Add it later only if simple matchers are insufficient.

## Hook Input Contract

All hook inputs should share common metadata:

```ts
export interface HookInputBase {
  readonly eventName: HookEventName;
  readonly hookRunId: string;
  readonly source: "ai-chat-v2" | "agent-runtime" | "system";
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly sessionId?: string;
  readonly timestamp: string;
}
```

### `PreToolUse` Input

```ts
export interface PreToolUseHookInput extends HookInputBase {
  readonly eventName: "PreToolUse";
  readonly tool: {
    readonly id: string;
    readonly name: string;
    readonly source: "skill-registry" | "mcp" | "legacy-tool";
    readonly permissionCategory?: string;
  };
  readonly input: Record<string, unknown>;
  readonly permissionState: {
    readonly allowed: boolean;
    readonly needsPrompt: boolean;
    readonly reason?: string;
  };
}
```

### `PostToolUse` Input

```ts
export interface PostToolUseHookInput extends HookInputBase {
  readonly eventName: "PostToolUse";
  readonly tool: {
    readonly id: string;
    readonly name: string;
    readonly source: "skill-registry" | "mcp" | "legacy-tool";
  };
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly executionTimeMs: number;
}
```

### `PostToolUseFailure` Input

```ts
export interface PostToolUseFailureHookInput extends HookInputBase {
  readonly eventName: "PostToolUseFailure";
  readonly tool: {
    readonly id: string;
    readonly name: string;
    readonly source: "skill-registry" | "mcp" | "legacy-tool";
  };
  readonly input: Record<string, unknown>;
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly stack?: string;
  };
  readonly executionTimeMs: number;
}
```

## Hook Output Contract

All hook executors must return a validated output object. Unknown fields should be ignored or recorded in debug logs, not trusted.

```ts
export interface HookOutput {
  readonly continue?: boolean;
  readonly reason?: string;
  readonly systemMessage?: string;
  readonly suppressOutput?: boolean;
  readonly updatedInput?: Record<string, unknown>;
  readonly updatedToolOutput?: Record<string, unknown>;
  readonly additionalContext?: string;
  readonly permissionDecision?: "allow" | "deny" | "ask";
}
```

### Output Semantics

| Field | Meaning |
| --- | --- |
| `continue: false` | Stop the current lifecycle path. For tool events, return a structured tool failure to UI and AI server. |
| `reason` | Human-readable explanation for block, ask, or stop. |
| `systemMessage` | User-visible warning or informational message. |
| `updatedInput` | Replacement tool input for `PreToolUse` only. |
| `updatedToolOutput` | Replacement or amended tool output for `PostToolUse` only. |
| `additionalContext` | Context to include in the next AI continuation or UI attachment. |
| `permissionDecision` | Hook-specific stricter permission behavior. |

### Permission Semantics

Hook permission aggregation must follow these rules:

1. `deny` always wins.
2. `ask` wins over `allow`.
3. `allow` never bypasses existing app permission checks.
4. Existing `SkillPermissionService` denies always win over hook `allow`.
5. Existing app prompts still occur unless the app already has a valid grant.

## Dispatch Pipeline

`HookDispatcher.executeHooks(eventName, input, options)` should:

1. Check global hook enablement.
2. Check workspace/project trust if project hooks are enabled.
3. Resolve matching hooks from `HookRegistry`.
4. Filter by event and matcher.
5. Emit hook-start progress events for UI and telemetry.
6. Execute callback hooks inline.
7. Execute command hooks with timeout and output limit.
8. Parse stdout as JSON.
9. Validate output against the hook output schema.
10. Aggregate blocking, permission, input update, output update, and context results.
11. Return one typed `AggregatedHookResult`.

Suggested aggregate:

```ts
export interface AggregatedHookResult {
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly permissionDecision?: "deny" | "ask" | "allow";
  readonly updatedInput?: Record<string, unknown>;
  readonly updatedToolOutput?: Record<string, unknown>;
  readonly additionalContexts: readonly string[];
  readonly systemMessages: readonly string[];
  readonly hookErrors: readonly HookExecutionError[];
}
```

## Stream Integration

### `PreToolUse`

`StreamEventProcessor.executeTool()` should:

1. Create `PreToolUseHookInput`.
2. Run `HookDispatcher.executeHooks("PreToolUse", input)`.
3. If blocked, send a tool result with `success: false` and the hook reason.
4. If `permissionDecision` is `deny`, treat it as blocked.
5. If `permissionDecision` is `ask`, force the existing permission prompt path.
6. If `updatedInput` exists, use it for permission and execution.
7. Continue to existing `SkillExecutor` or `ToolExecutor`.

### `PostToolUse`

After successful execution:

1. Run `PostToolUse` hooks with original input, effective input, output, and duration.
2. Apply `updatedToolOutput` only if valid and size-bounded.
3. Add `additionalContext` to the AI continuation or structured UI attachment.
4. Save the final visible result through `ToolExecutionService`.
5. Continue the AI stream with the final result.

### `PostToolUseFailure`

After execution failure:

1. Run `PostToolUseFailure` hooks.
2. Allow hooks to add recovery context or user-visible messages.
3. Do not allow hooks to silently convert a failure into success in MVP.
4. Save the error result through existing persistence.
5. Continue the AI stream with the error unless blocked.

## Permission Integration

Hooks must not replace `SkillPermissionService`.

Recommended flow for registered skills:

```text
PreToolUse hooks
  -> aggregate hook permission decision
  -> SkillPermissionService.checkPermission()
  -> shell rate limiting
  -> SkillExecutor.execute()
```

If a hook returns `allow`, still run `SkillPermissionService.checkPermission()`.

If a hook returns `deny`, return a structured blocked result before normal tool execution.

If a hook returns `ask`, force the permission prompt even if the app would otherwise auto-allow, except for internal built-in hooks may be allowed to add non-blocking warnings instead.

## Command Hook Execution

Command hooks should receive hook input JSON on stdin and write hook output JSON to stdout.

Example command hook:

```js
process.stdin.setEncoding("utf8");

let body = "";
process.stdin.on("data", (chunk) => {
  body += chunk;
});

process.stdin.on("end", () => {
  const input = JSON.parse(body);
  if (input.tool?.name === "shell_execute") {
    const command = String(input.input?.command || "");
    if (command.includes("rm -rf")) {
      console.log(JSON.stringify({
        continue: false,
        reason: "Dangerous recursive delete commands are blocked by local hook policy."
      }));
      return;
    }
  }
  console.log(JSON.stringify({ continue: true }));
});
```

### Command Hook Safety Requirements

1. Command hooks must be disabled by default until the user enables hooks.
2. First command hook execution must require explicit trust approval.
3. Every command hook must have a timeout, default 5 seconds.
4. stdout and stderr must be size-capped.
5. Hook output must be valid JSON to affect execution.
6. Invalid JSON should be treated as hook failure, not a trusted allow.
7. Command hook environment must use an allowlist, not full app env by default.
8. Secrets from `Token` must not be passed to command hooks.
9. Hook command, cwd, timeout, and source should be audit logged.
10. Command hooks must not run in renderer.

## Persistence

### MVP

The first version can store user hook config in a local JSON setting managed by a service, if there is no UI CRUD yet. Built-in and session hooks can remain in memory.

### Persistent Management Version

If the product adds UI CRUD, use the standard architecture:

```text
Renderer UI
  -> hooks IPC
  -> HookModule
  -> Hook.model
  -> TypeORM entity
  -> SQLite
```

IPC handlers must not access TypeORM repositories directly.

Suggested entity fields:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Hook config ID |
| `eventName` | string | Event this hook listens to |
| `matcher` | string | Tool or event matcher |
| `hookType` | string | `callback`, `command`, later `http` |
| `configJson` | text | Hook config, redacted when displayed |
| `source` | string | `user`, `project`, `plugin`, `builtin`, `session` |
| `enabled` | boolean | Whether hook is active |
| `trusted` | boolean | Whether execution is allowed |
| `createdAt` | datetime | Creation timestamp |
| `updatedAt` | datetime | Update timestamp |
| `lastRunAt` | datetime | Last execution timestamp |

Audit logs can be either structured console logs in MVP or a dedicated entity later.

## UI Requirements

### MVP UI

The MVP can surface hook effects inside the existing AI chat stream:

- Hook blocked tool call.
- Hook requested permission.
- Hook modified tool input.
- Hook added context.
- Hook failed to execute.

These should appear as compact system/tool status messages, not as verbose raw JSON.

### Management UI Later

Add a Hooks tab or settings page after the dispatcher is stable.

User capabilities:

- Enable or disable hooks globally.
- List configured hooks.
- Add command hook.
- Edit command and matcher.
- Trust/untrust a hook source.
- View last run status.
- View recent hook audit entries.
- Disable all plugin hooks.

Any new user-facing text must update all language files:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

## Functional Requirements

### Hook Contracts

1. The system shall define a closed set of hook event names.
2. The system shall define typed input payloads for each hook event.
3. The system shall define a validated hook output contract.
4. The system shall ignore unsupported output fields.
5. The system shall reject malformed hook output.
6. The system shall cap hook output size.

### Hook Registry

1. The system shall register built-in hooks in code.
2. The system shall register session hooks in memory.
3. The system shall load user-configured hooks from local settings or database.
4. The system shall merge hooks by source and event.
5. The system shall filter tool hooks by matcher.
6. The system shall expose a test-only way to clear and register hooks.

### Hook Dispatcher

1. The system shall execute matching hooks for a lifecycle event.
2. The system shall support callback hooks in the MVP.
3. The system shall support command hooks after trust is enabled.
4. The system shall enforce per-hook timeouts.
5. The system shall aggregate multiple hook results deterministically.
6. The system shall treat hook errors as non-allowing failures.
7. The system shall expose hook progress events to the chat stream or logs.

### Tool Integration

1. The system shall run `PreToolUse` before local tool execution.
2. The system shall support blocking a tool before execution.
3. The system shall support replacing tool input before execution.
4. The system shall run normal skill permission checks after pre-tool hooks.
5. The system shall run `PostToolUse` after successful local tool execution.
6. The system shall run `PostToolUseFailure` after local tool execution failure.
7. The system shall save final tool call/result state using existing services.
8. The system shall send final tool result state back to the AI server.

### Permission Integration

1. The system shall never allow hooks to bypass `SkillPermissionService`.
2. The system shall allow hooks to deny a tool call.
3. The system shall allow hooks to request a prompt for a tool call.
4. The system shall preserve existing shell rate limiting.
5. The system shall preserve session grants and persistent grants.
6. The system shall preserve denied permissions.

### Security

1. The system shall disable user/project/plugin command hooks until explicitly trusted.
2. The system shall not pass stored tokens or credentials to hook commands.
3. The system shall redact sensitive values in audit logs.
4. The system shall execute hooks only in the main process or approved worker process.
5. The system shall not execute hooks in renderer code.
6. The system shall not allow hook workers to access the database directly.
7. The system shall gate AI-powered hook types behind `USER_AI_ENABLED`.
8. The system shall prevent recursive hook execution loops.

### Observability

1. The system shall log hook start, success, failure, timeout, and block outcomes.
2. The system shall include hook source and event in audit entries.
3. The system shall expose user-visible messages when a hook blocks execution.
4. The system shall expose user-visible messages when a hook modifies tool input.
5. The system shall avoid displaying raw hook JSON unless debug mode is enabled.

## Non-Functional Requirements

### Performance

- Callback hooks should add less than 10 ms overhead for common events.
- Command hooks should default to a 5 second timeout.
- The dispatcher should fast-path no matching hooks.
- Hook matching should be O(number of hooks for event), not global scan across all hooks.

### Reliability

- A hook failure should not crash AI chat.
- A hook timeout should produce a structured hook error.
- A malformed hook output should not be treated as approval.
- Hook execution should respect chat abort signals where possible.

### Security

- Command hooks are local code execution and must be treated as high risk.
- Hook config should show command previews before trust.
- Plugin hooks should be disabled if the owning plugin is disabled.
- Hook output should not be allowed to inject arbitrary UI HTML.

### Maintainability

- Hook logic should live under `src/service/hooks/`.
- IPC should only call modules/services.
- Tests should cover dispatcher behavior without Electron.
- Tool-loop tests should cover hook integration with fake executors.

## Example Use Cases

### Block Dangerous Shell Commands

A user configures a `PreToolUse` command hook for `shell_execute`. The hook blocks commands containing destructive filesystem patterns. The user sees a tool result explaining the block. The AI receives a structured failure and can propose a safer command.

### Add Compliance Context After Scraping

A built-in `PostToolUse` hook watches scraping tools. After a successful scrape, it adds a short system reminder about respecting contact data policies. The final tool output is unchanged.

### Force Approval For Automation

A project hook returns `permissionDecision: "ask"` for `search_maps_businesses` when `max_results` is high. Existing permission UI appears even if the tool would normally run based on prior grants.

### Annotate Missing Dependency Failures

A `PostToolUseFailure` hook inspects a skill failure and adds context that helps the model recommend a dependency install path. The existing system dependency approval flow still owns installation.

## Edge Cases

1. Multiple hooks update input for the same field.
   - MVP behavior: apply updates in source priority/order, last update wins within allowed sources, record all modifications in debug/audit.

2. One hook blocks and another hook allows.
   - Block wins.

3. Hook returns invalid JSON.
   - Mark hook failed; do not treat as allow.

4. Hook command times out.
   - Mark hook failed; continue only if the hook is configured as non-blocking. Default should be non-blocking failure for observability hooks and blocking failure for policy hooks.

5. User stops chat while hook is running.
   - Abort command process if possible and do not continue tool execution.

6. Tool input contains sensitive data.
   - Pass only the sanitized/approved fields for hooks where possible. Redact logs.

7. Plugin is disabled after registering hooks.
   - Registry excludes plugin hooks owned by disabled plugins.

8. AI is disabled and a prompt hook would run.
   - Prompt hook does not run and returns a disabled result.

9. Worker process attempts database access.
   - This violates architecture and must fail fast. Hook workers must communicate results back to main process.

## Rollout Plan

### Phase 1: Contracts And Callback Dispatcher

Deliver:

- Hook event and input/output types.
- Hook registry for built-in/session callback hooks.
- Hook matcher.
- Hook dispatcher.
- Aggregate result semantics.
- Unit tests for matching, aggregation, malformed output, and permission precedence.

No command execution yet.

### Phase 2: Tool Loop Integration

Deliver:

- `PreToolUse` in `StreamEventProcessor.executeTool()`.
- `PostToolUse` and `PostToolUseFailure`.
- Structured UI/tool-result behavior for hook blocks.
- Tests with fake hooks around fake tool calls.
- Preserve existing permission prompt and resume behavior.

### Phase 3: Command Hooks

Deliver:

- Command hook executor.
- Timeout, stdout/stderr cap, env allowlist.
- Trust prompt or settings gate.
- Audit logging.
- Tests for timeout, invalid JSON, block, input update, and sensitive redaction.

### Phase 4: User Configuration And UI

Deliver:

- Hook settings storage.
- Hooks management UI.
- i18n updates for all supported languages.
- Enable/disable hook controls.
- Last-run status display.

### Phase 5: Plugin Hooks

Deliver:

- Plugin hook manifest support.
- Hook ownership tied to plugin enablement.
- Trust flow for plugin-provided command hooks.
- Plugin uninstall cleanup.

### Phase 6: HTTP And AI-Powered Hooks

Deliver only after explicit design review:

- HTTP hook executor with SSRF controls and URL allowlist.
- Prompt hooks gated by `USER_AI_ENABLED`.
- Agent hooks only if agent runtime has stable recursion controls.

## Acceptance Criteria

### MVP Acceptance

1. A built-in callback `PreToolUse` hook can block a tool call before execution.
2. A built-in callback `PreToolUse` hook can modify tool input before execution.
3. Existing skill permission denial still blocks execution even when a hook returns `allow`.
4. `PostToolUse` receives successful tool output and can add additional context.
5. `PostToolUseFailure` receives failed tool output and can add a user-visible message.
6. Hook failures do not crash the chat stream.
7. No matching hooks adds negligible overhead and changes no behavior.
8. Unit tests cover hook aggregation and permission precedence.
9. Tool-loop tests cover block, update input, success, and failure paths.

### Command Hook Acceptance

1. Command hook receives hook input JSON on stdin.
2. Command hook output JSON can block a tool call.
3. Command hook output JSON can update tool input.
4. Command hook timeout kills the process or prevents further waiting.
5. Invalid command hook JSON is not treated as allow.
6. Command hook execution is disabled until explicitly trusted.
7. Command hook audit logs do not contain raw secrets.

### UI Acceptance

1. Users see when a hook blocked a tool.
2. Users see when a hook requested permission.
3. Users can disable hooks globally.
4. Users can disable individual configured hooks.
5. New UI text is translated in all supported language files.

## Testing Strategy

### Unit Tests

Add Vitest tests under `test/vitest/utilitycode/hooks/`:

- Hook matcher exact, wildcard, glob behavior.
- Hook registry source filtering.
- Dispatcher no-hooks fast path.
- Dispatcher callback success.
- Dispatcher callback throw.
- Aggregation: block wins.
- Aggregation: deny wins.
- Aggregation: ask beats allow.
- Input update ordering.
- Output validation.
- Command hook JSON parsing.
- Command hook timeout behavior.

### Main Process Tests

Add tests under `test/vitest/main/`:

- Hook IPC registers handlers without direct database access.
- User hook enable/disable routes through module/service.
- AI-powered hook types return disabled result when `USER_AI_ENABLED` is not true.

### Integration Tests

Add stream/tool-loop tests:

- Tool executes normally when no hooks match.
- Pre-tool block returns structured tool failure and skips executor.
- Pre-tool input update changes executor input.
- Existing skill permission prompt still appears after hook allow.
- Post-tool context is included in continuation payload or UI message.
- Post-tool failure hook does not turn failure into success in MVP.

### Manual QA

1. Run AI chat with no configured hooks and verify existing behavior is unchanged.
2. Register a built-in test hook that blocks a harmless test tool and verify UI and AI continuation.
3. Register a command hook that blocks a specific shell command.
4. Verify command hook trust prompt.
5. Verify stop/cancel during a slow hook.
6. Verify plugin disabled state excludes plugin hooks after plugin support lands.

## Open Questions

1. Should user hook config initially live in a JSON settings file or SQLite?
   - Recommendation: JSON/service storage for MVP; SQLite once UI CRUD and audit search are required.

2. Should hook-added context be sent to the AI server automatically or only shown to the user?
   - Recommendation: send only bounded `additionalContext` from trusted hooks; show user-visible `systemMessage` separately.

3. Should command hook failure block by default?
   - Recommendation: policy hooks block on failure; observability hooks do not. MVP can expose a `failureMode: "block" | "warn"` option.

4. Should project hooks exist immediately?
   - Recommendation: no. AiFetchly does not yet have a strong project/workspace trust model like Claude Code.

5. Should hooks be available to scheduled AI tasks?
   - Recommendation: after AI chat MVP. Scheduled tasks share tool risks but need separate failure and notification semantics.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Command hooks become arbitrary RCE | High | Disabled by default, trust prompt, audit logs, timeout, env allowlist |
| Hook allow bypasses permission | High | Enforce permission precedence centrally and test it |
| Hook system slows every tool call | Medium | No-hooks fast path, per-event registry maps |
| Hook config leaks secrets | High | Redaction, env allowlist, no Token values in inputs |
| Hook outputs break model loop | Medium | Schema validation and bounded outputs |
| Plugin hooks persist after plugin disabled | Medium | Tie hook ownership to plugin enabled state |
| Prompt hooks recurse or spend AI budget | High | Defer prompt/agent hooks; gate with `USER_AI_ENABLED` |

## Implementation Notes

- Prefer structured TypeScript types over `any`; use `unknown` for untrusted hook output before validation.
- `HookDispatcher` should not import Vue, renderer APIs, or IPC.
- IPC handlers should call service/module methods only.
- If hook worker entry points are added, place them under `src/childprocess/`.
- Hook workers must not access SQLite directly.
- Any database-backed hook settings must follow Entity -> Model -> Module -> IPC.
- Hook command execution should reuse existing shell safety patterns where possible, but should not bypass `SkillPermissionService`.
- Use succinct audit entries that include event, source, hook ID, duration, outcome, and redacted reason.

## Success Metrics

| Metric | Target |
| --- | --- |
| No-hooks tool execution behavior regressions | 0 known regressions |
| No-hooks dispatcher overhead | Less than 5 ms per tool call |
| Callback hook execution overhead | Less than 10 ms typical |
| Command hook timeout enforcement | 100 percent in tests |
| Permission precedence test coverage | 100 percent for allow/ask/deny combinations |
| User-visible hook block clarity | Manual QA pass |
| Hook-caused chat crashes | 0 |

## Appendix: Minimal Type Sketch

```ts
export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PermissionRequest"
  | "PermissionDenied"
  | "Stop";

export type HookSource =
  | "builtin"
  | "session"
  | "user"
  | "project"
  | "plugin"
  | "policy";

export type HookCommandType = "callback" | "command";

export interface HookDefinition {
  readonly id: string;
  readonly eventName: HookEventName;
  readonly matcher?: string;
  readonly source: HookSource;
  readonly enabled: boolean;
  readonly command: HookCommand;
}

export type HookCommand =
  | {
      readonly type: "callback";
      readonly callback: (input: HookInput) => Promise<HookOutput> | HookOutput;
    }
  | {
      readonly type: "command";
      readonly command: string;
      readonly cwd?: string;
      readonly timeoutMs?: number;
      readonly failureMode?: "block" | "warn";
      readonly statusMessage?: string;
    };
```

