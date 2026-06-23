# Technical Design: AiFetchly Hooks System

**Date:** 2026-06-23
**Status:** Draft
**PRD:** [2026-06-23-hooks-system-prd.md](2026-06-23-hooks-system-prd.md)
**Related areas:** AI Chat V2, skill execution, MCP tools, plugin runtime, shell safety, TypeORM persistence

## Design Intent

Add a lifecycle hook layer around AiFetchly's AI chat and tool execution loop.

The design adapts Claude Code's hook model to AiFetchly's existing architecture:

- Claude Code has a broad agent-loop hook system with command, prompt, agent, HTTP, callback, async, and policy-managed sources.
- AiFetchly should start smaller: typed lifecycle events, callback hooks, command hooks, central aggregation, and strict integration with the existing skill permission system.
- Claude Code's hooks live inside a coding-agent query loop.
- AiFetchly's hooks should live in the Electron main-process service layer and wrap `StreamEventProcessor`, `SkillExecutor`, `ToolExecutor`, and `SkillPermissionService`.

The first technical goal is not "all hook types." It is a safe, testable policy layer that can block, ask, rewrite input, annotate output, and add bounded context without bypassing existing permissions.

## Current State

AiFetchly already has most of the execution seams needed for hooks:

- `StreamEventProcessor.handleToolCallEvent()` receives local tool calls from the AI stream.
- `StreamEventProcessor.executeTool()` dispatches registry skills, MCP tools, and legacy tools.
- `SkillExecutor.execute()` validates registry skills, checks `SkillPermissionService`, applies shell rate limiting, executes the skill, and audit logs the result.
- `ToolExecutor.execute()` handles legacy and MCP paths that are not fully covered by `SkillRegistry`.
- `ToolExecutionService` saves tool call and result messages.
- `SkillPermissionService` enforces pure/network/filesystem/automation/shell permission behavior.
- `SkillRegistry` owns built-in, imported, and MCP skill discovery.
- AI feature IPC handlers must check `USER_AI_ENABLED` before AI work.
- Worker entry points belong under `src/childprocess/`, and workers must not write to SQLite directly.

The hook layer should fit these boundaries. It should not move database access into IPC or workers, and it should not create a second skill executor.

## Architecture

```text
AI chat request
  |
  v
ai-chat-v2 IPC / existing stream owner
  |
  v
StreamEventProcessor
  |
  +--> HookDispatcher.executeHooks("PreToolUse")
  |       |
  |       +--> HookRegistry.getMatchingHooks()
  |       +--> CallbackHookExecutor / CommandHookExecutor
  |       +--> HookResultAggregator
  |
  +--> SkillPermissionService.checkPermission()
  |
  +--> SkillExecutor.execute() or ToolExecutor.execute()
  |
  +--> HookDispatcher.executeHooks("PostToolUse" or "PostToolUseFailure")
  |
  +--> ToolExecutionService.saveToolResult()
  |
  +--> AiChatApi.streamContinueWithToolResults()
  |
  v
Renderer stream events
```

The hook write path for future persisted configuration is:

```text
Renderer hooks settings UI
  |
  v
hooks-ipc.ts
  |
  v
HookModule
  |
  v
Hook.model
  |
  v
HookConfigEntity / HookAuditEntity
  |
  v
SQLite TypeORM
```

The MVP can avoid persistence by using built-in and session hooks plus optional JSON settings. Once UI CRUD is needed, switch to the standard Entity -> Model -> Module -> IPC path.

## File Structure

Create in phase 1:

- `src/entityTypes/hookTypes.ts`
- `src/service/hooks/HookMatcher.ts`
- `src/service/hooks/HookRegistry.ts`
- `src/service/hooks/HookOutputValidator.ts`
- `src/service/hooks/HookResultAggregator.ts`
- `src/service/hooks/HookDispatcher.ts`
- `src/service/hooks/executors/CallbackHookExecutor.ts`
- `src/service/hooks/HookAuditService.ts`
- `test/vitest/utilitycode/hooks/HookMatcher.test.ts`
- `test/vitest/utilitycode/hooks/HookRegistry.test.ts`
- `test/vitest/utilitycode/hooks/HookOutputValidator.test.ts`
- `test/vitest/utilitycode/hooks/HookResultAggregator.test.ts`
- `test/vitest/utilitycode/hooks/HookDispatcher.test.ts`

Create in phase 2:

- `test/vitest/utilitycode/hooks/StreamEventProcessorHooks.test.ts` or equivalent stream-loop test location

Create in phase 3:

- `src/service/hooks/executors/CommandHookExecutor.ts`
- `src/service/hooks/HookCommandTrustService.ts`
- `test/vitest/utilitycode/hooks/CommandHookExecutor.test.ts`
- `test/vitest/utilitycode/hooks/HookCommandTrustService.test.ts`

Create only when persisted management is required:

- `src/entity/HookConfig.entity.ts`
- `src/entity/HookAudit.entity.ts`
- `src/model/HookConfig.model.ts`
- `src/model/HookAudit.model.ts`
- `src/modules/HookModule.ts`
- `src/main-process/communication/hooks-ipc.ts`
- `src/views/api/hooks.ts`
- `src/views/components/hooks/*`

Modify:

- `src/service/StreamEventProcessor.ts`
- `src/service/SkillExecutor.ts` only if `PermissionRequest` and `PermissionDenied` events cannot be emitted from `StreamEventProcessor`
- `src/main-process/communication/index.ts` when hook IPC is added
- `src/preload.ts` when hook UI API is added
- `src/config/channellist.ts` if new renderer stream channels are added
- `src/config/SqliteDb.ts` only if hook entities are added
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` when user-facing UI text is added

## Type System

Create `src/entityTypes/hookTypes.ts`.

Use a closed event union for the MVP:

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
```

Source and runtime types:

```ts
export type HookSource =
  | "builtin"
  | "session"
  | "user"
  | "project"
  | "plugin"
  | "policy";

export type HookCommandType = "callback" | "command";

export type HookFailureMode = "warn" | "block";

export type HookPermissionDecision = "allow" | "ask" | "deny";
```

Shared input:

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

Tool identity:

```ts
export type HookToolSource =
  | "skill-registry"
  | "mcp"
  | "legacy-tool";

export interface HookToolDescriptor {
  readonly id: string;
  readonly name: string;
  readonly source: HookToolSource;
  readonly permissionCategory?: string;
}
```

Tool inputs:

```ts
export interface PreToolUseHookInput extends HookInputBase {
  readonly eventName: "PreToolUse";
  readonly tool: HookToolDescriptor;
  readonly input: Record<string, unknown>;
  readonly permissionState: {
    readonly allowed: boolean;
    readonly needsPrompt: boolean;
    readonly reason?: string;
  };
}

export interface PostToolUseHookInput extends HookInputBase {
  readonly eventName: "PostToolUse";
  readonly tool: HookToolDescriptor;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly executionTimeMs: number;
}

export interface PostToolUseFailureHookInput extends HookInputBase {
  readonly eventName: "PostToolUseFailure";
  readonly tool: HookToolDescriptor;
  readonly input: Record<string, unknown>;
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly stack?: string;
  };
  readonly executionTimeMs: number;
}
```

Other MVP inputs:

```ts
export interface UserPromptSubmitHookInput extends HookInputBase {
  readonly eventName: "UserPromptSubmit";
  readonly prompt: string;
  readonly mode: "chat" | "plan" | "agent";
  readonly metadata?: Record<string, unknown>;
}

export interface SessionStartHookInput extends HookInputBase {
  readonly eventName: "SessionStart";
  readonly mode: "chat" | "plan" | "agent";
  readonly metadata?: Record<string, unknown>;
}

export interface StopHookInput extends HookInputBase {
  readonly eventName: "Stop";
  readonly reason: "completed" | "user_stopped" | "error";
  readonly metadata?: Record<string, unknown>;
}

export interface PermissionRequestHookInput extends HookInputBase {
  readonly eventName: "PermissionRequest";
  readonly tool: HookToolDescriptor;
  readonly input: Record<string, unknown>;
  readonly permissionCategory: string;
  readonly promptReason?: string;
}

export interface PermissionDeniedHookInput extends HookInputBase {
  readonly eventName: "PermissionDenied";
  readonly tool: HookToolDescriptor;
  readonly input: Record<string, unknown>;
  readonly reason: string;
}
```

Union:

```ts
export type HookInput =
  | SessionStartHookInput
  | UserPromptSubmitHookInput
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PermissionRequestHookInput
  | PermissionDeniedHookInput
  | StopHookInput;
```

Hook output:

```ts
export interface HookOutput {
  readonly continue?: boolean;
  readonly reason?: string;
  readonly systemMessage?: string;
  readonly suppressOutput?: boolean;
  readonly updatedInput?: Record<string, unknown>;
  readonly updatedToolOutput?: Record<string, unknown>;
  readonly additionalContext?: string;
  readonly permissionDecision?: HookPermissionDecision;
}
```

Hook definition:

```ts
export interface HookDefinitionBase {
  readonly id: string;
  readonly eventName: HookEventName;
  readonly matcher?: string;
  readonly source: HookSource;
  readonly enabled: boolean;
  readonly trusted: boolean;
  readonly failureMode?: HookFailureMode;
  readonly statusMessage?: string;
}

export interface CallbackHookDefinition extends HookDefinitionBase {
  readonly type: "callback";
  readonly callback: (
    input: HookInput
  ) => Promise<HookOutput> | HookOutput;
}

export interface CommandHookDefinition extends HookDefinitionBase {
  readonly type: "command";
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly envAllowlist?: readonly string[];
}

export type HookDefinition =
  | CallbackHookDefinition
  | CommandHookDefinition;
```

Aggregate result:

```ts
export interface HookExecutionError {
  readonly hookId: string;
  readonly source: HookSource;
  readonly message: string;
  readonly timedOut?: boolean;
  readonly durationMs?: number;
}

export interface AggregatedHookResult {
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly permissionDecision?: HookPermissionDecision;
  readonly updatedInput?: Record<string, unknown>;
  readonly updatedToolOutput?: Record<string, unknown>;
  readonly additionalContexts: readonly string[];
  readonly systemMessages: readonly string[];
  readonly hookErrors: readonly HookExecutionError[];
  readonly executedHookIds: readonly string[];
}
```

## HookMatcher

`HookMatcher` should intentionally start simple.

Supported matcher syntax:

- `undefined` or `*`: match all
- exact: `shell_execute`
- suffix wildcard: `mcp_*`
- prefix wildcard: `*_search`
- contains wildcard: `scrape_*_urls`

Do not support regular expressions in the MVP. Regex matchers create a denial-of-service surface and make UI validation harder.

Suggested interface:

```ts
export function matchesHookMatcher(
  matcher: string | undefined,
  query: string
): boolean;
```

Algorithm:

1. If matcher is missing or `*`, return true.
2. Escape regex special characters except `*`.
3. Convert `*` to `.*`.
4. Anchor with `^` and `$`.
5. Test against `query`.
6. Reject matchers longer than a configured maximum, for example 128 characters.

## HookRegistry

`HookRegistry` owns in-memory hook definitions and loaded hook config.

Responsibilities:

- Store registered hooks by `HookEventName`.
- Register built-in callback hooks.
- Register session hooks.
- Clear session hooks by session ID when needed.
- Load user hooks from settings or modules later.
- Exclude disabled hooks.
- Exclude untrusted command hooks.
- Exclude plugin hooks when owning plugin is disabled later.
- Return matching hooks in deterministic order.

Suggested interface:

```ts
export interface HookLookupInput {
  readonly eventName: HookEventName;
  readonly matchQuery?: string;
  readonly sessionId?: string;
}

export interface HookRegistryApi {
  registerBuiltinHook(hook: CallbackHookDefinition): void;
  registerSessionHook(sessionId: string, hook: HookDefinition): void;
  clearSessionHooks(sessionId: string): void;
  getMatchingHooks(input: HookLookupInput): readonly HookDefinition[];
  resetForTests(): void;
}
```

Ordering:

1. `policy`
2. `builtin`
3. `session`
4. `project`
5. `plugin`
6. `user`

Within a source, preserve registration order. Do not sort by ID because order affects input updates.

## HookOutputValidator

Hook output is untrusted when it comes from command hooks. Validate before aggregation.

Rules:

- Input type to validator is `unknown`.
- Return either `{ valid: true; output: HookOutput }` or `{ valid: false; error: string }`.
- Reject arrays and primitives.
- Reject `updatedInput` if it is not a non-null object.
- Reject `updatedToolOutput` if it is not a non-null object.
- Reject `permissionDecision` outside `allow`, `ask`, `deny`.
- Cap `reason`, `systemMessage`, and `additionalContext` string length.
- Cap serialized `updatedInput` and `updatedToolOutput`.
- Ignore unknown fields after validation.

Suggested constants:

```ts
export const HOOK_LIMITS = {
  maxReasonChars: 1000,
  maxSystemMessageChars: 2000,
  maxAdditionalContextChars: 4000,
  maxUpdatedInputBytes: 64_000,
  maxUpdatedToolOutputBytes: 128_000,
  maxCommandStdoutBytes: 256_000,
  maxCommandStderrBytes: 64_000,
  defaultCommandTimeoutMs: 5_000,
  maxCommandTimeoutMs: 60_000,
} as const;
```

## HookResultAggregator

Aggregation should be deterministic and conservative.

Inputs:

```ts
export interface HookSingleResult {
  readonly hook: HookDefinition;
  readonly output?: HookOutput;
  readonly error?: HookExecutionError;
  readonly durationMs: number;
}
```

Rules:

1. `continue: false` sets `blocked = true`.
2. First block reason wins unless a higher-priority source blocks later in execution order. Since execution order is priority order, keep the first block reason.
3. `permissionDecision: "deny"` wins over all.
4. `permissionDecision: "ask"` wins over `allow`.
5. `permissionDecision: "allow"` is recorded only if no stricter decision exists.
6. `allow` is advisory only and cannot skip app permission checks.
7. `updatedInput` applies only to `PreToolUse`.
8. Multiple `updatedInput` objects merge shallowly in execution order.
9. `updatedToolOutput` applies only to `PostToolUse`.
10. Multiple `updatedToolOutput` objects merge shallowly in execution order.
11. `additionalContext` values append in execution order.
12. `systemMessage` values append in execution order.
13. Hook errors append. If the hook has `failureMode: "block"`, convert the error to a block.

Shallow merge is deliberate for MVP. Deep merge can create surprising behavior for nested tool arguments. If nested updates are needed later, use a JSON patch contract rather than implicit deep merge.

## HookDispatcher

`HookDispatcher` is the only service that executes hooks.

Suggested interface:

```ts
export interface ExecuteHooksInput {
  readonly eventName: HookEventName;
  readonly input: HookInput;
  readonly matchQuery?: string;
  readonly abortSignal?: AbortSignal;
}

export interface HookDispatcherApi {
  executeHooks(input: ExecuteHooksInput): Promise<AggregatedHookResult>;
}
```

Execution flow:

1. If hooks are globally disabled, return empty aggregate.
2. Get matching hooks from `HookRegistry`.
3. If no hooks match, return empty aggregate.
4. Emit hook progress start events.
5. Execute callback hooks inline.
6. Execute command hooks through `CommandHookExecutor`.
7. Validate each output.
8. Convert thrown errors, timeouts, and invalid output into `HookExecutionError`.
9. Aggregate with `HookResultAggregator`.
10. Audit hook outcomes.
11. Return aggregate.

Sequential execution is recommended for MVP. It makes input-update ordering predictable. Parallel execution can be added later for events that do not mutate input or output.

## CallbackHookExecutor

Callback hooks are trusted TypeScript callbacks registered by app code or session code.

Responsibilities:

- Call the callback with typed `HookInput`.
- Catch thrown errors.
- Validate returned output, even though the callback is trusted.
- Measure duration.
- Respect abort signal where possible before starting.

Callback hooks should be the first implementation because they let the app prove dispatcher behavior without local process execution risk.

## CommandHookExecutor

Command hooks run local commands. Treat them as high risk.

Suggested interface:

```ts
export interface CommandHookExecutionInput {
  readonly hook: CommandHookDefinition;
  readonly input: HookInput;
  readonly abortSignal?: AbortSignal;
}

export interface CommandHookExecutionResult {
  readonly output?: HookOutput;
  readonly error?: HookExecutionError;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}
```

Execution rules:

1. Reject command hooks when `trusted` is false.
2. Reject timeout values above `HOOK_LIMITS.maxCommandTimeoutMs`.
3. Spawn the command from the main process, not renderer.
4. Send hook input JSON on stdin.
5. Capture stdout and stderr with byte caps.
6. Kill the child process on timeout or abort.
7. Parse stdout as JSON only after process exits successfully.
8. Treat invalid JSON as hook error.
9. Do not pass full `process.env`.
10. Build an environment from an allowlist plus safe defaults.
11. Never include `Token` values, auth cookies, refresh tokens, or safeStorage output.

Use Node's `child_process.spawn` with platform-specific shell handling only if needed. Prefer command parsing that avoids `shell: true` for simple executables. If the design needs shell syntax, make that explicit in trust UI.

Default environment:

```ts
const DEFAULT_HOOK_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "TEMP",
  "TMP",
] as const;
```

Redact audit logs with patterns similar to `SkillExecutor` sensitive argument redaction.

## HookAuditService

MVP can log structured audit entries to console. Persistent audit can be added when hook UI exists.

Audit entry:

```ts
export interface HookAuditEntry {
  readonly hookRunId: string;
  readonly hookId: string;
  readonly eventName: HookEventName;
  readonly source: HookSource;
  readonly type: HookCommandType;
  readonly matchQuery?: string;
  readonly status: "started" | "success" | "blocked" | "failed" | "timeout";
  readonly durationMs?: number;
  readonly reason?: string;
  readonly timestamp: string;
}
```

Do not audit raw hook input by default. If debug logging is added, sanitize before writing.

## StreamEventProcessor Integration

The first integration should be inside `StreamEventProcessor.executeTool()`.

Current simplified flow:

```text
executeTool(toolId, toolName, toolParams)
  -> SkillExecutor.execute() or ToolExecutor.execute()
  -> saveToolResult()
  -> send TOOL_RESULT chunk
  -> sendToolResultToAI()
```

New flow:

```text
executeTool(toolId, toolName, toolParams)
  -> build HookToolDescriptor
  -> compute pre-permission state if cheap
  -> HookDispatcher.executeHooks("PreToolUse")
  -> if blocked, handle hook blocked result
  -> effectiveToolParams = aggregate.updatedInput ?? toolParams
  -> SkillExecutor.execute() or ToolExecutor.execute()
  -> if success, HookDispatcher.executeHooks("PostToolUse")
  -> if failure, HookDispatcher.executeHooks("PostToolUseFailure")
  -> save final tool result
  -> send TOOL_RESULT chunk
  -> sendToolResultToAI()
```

### Tool Descriptor Resolution

Use:

```ts
function resolveHookToolDescriptor(
  toolId: string,
  toolName: string
): HookToolDescriptor {
  if (SkillRegistry.isRegistered(toolName)) {
    const skill = SkillRegistry.getSkill(toolName);
    return {
      id: toolId,
      name: toolName,
      source: "skill-registry",
      permissionCategory: skill?.permissionCategory,
    };
  }
  if (toolName.startsWith("mcp_")) {
    return { id: toolId, name: toolName, source: "mcp" };
  }
  return { id: toolId, name: toolName, source: "legacy-tool" };
}
```

### Hook Blocked Tool Result

When a pre-tool hook blocks:

```ts
const blockedToolResult = {
  success: false,
  error: aggregate.blockReason || "Tool blocked by hook policy",
  blockedByHook: true,
  hookMessages: aggregate.systemMessages,
};
```

Then use existing save, UI chunk, and AI continuation behavior. The AI should receive a normal failed tool result so it can explain or choose a safer path.

### Input Update

If `aggregate.updatedInput` exists:

1. Use updated input for permission and execution.
2. Preserve original input in hook audit only if sanitized.
3. Send a compact UI message only if a hook made a material change and the hook supplied `systemMessage`.
4. Save the actual executed params in the tool call record if possible.

### PostToolUse Output Update

If `aggregate.updatedToolOutput` exists:

1. Merge shallowly into the successful tool result.
2. Reject updates that exceed output size limits.
3. Do not allow `PostToolUseFailure` to silently turn failure into success in MVP.

## SkillExecutor Integration

Avoid deep changes to `SkillExecutor` in phase 1.

Reason: `StreamEventProcessor.executeTool()` catches registry skills, MCP tools, and legacy tools in one place. Adding pre/post hooks inside `SkillExecutor` would miss legacy/MCP paths and create duplicate hook execution when called from chat.

Only add SkillExecutor-level integration if a future caller uses `SkillExecutor.execute()` outside chat and needs hooks. If added later, use an option:

```ts
readonly skipHooks?: boolean;
```

Then chat can own hook execution and direct service calls can opt in.

## PermissionRequest And PermissionDenied

`SkillExecutor.execute()` currently returns a special result when permission is required:

```ts
{
  error: "Permission required",
  needsPermissionPrompt: true,
  permissionCategory: ...
}
```

Phase 2 can emit `PermissionRequest` in `StreamEventProcessor` when it detects `needsPermissionPrompt`.

Flow:

```text
SkillExecutor.execute()
  -> returns needsPermissionPrompt
  -> StreamEventProcessor detects deferred permission result
  -> HookDispatcher.executeHooks("PermissionRequest")
  -> if hook denies, return blocked result
  -> else show existing approval card
```

`PermissionDenied` should fire from the handler that receives the user's denial response. If denial is currently represented by not resuming, add a small explicit denial path before firing the hook.

## UserPromptSubmit And SessionStart

These events are useful but should follow tool hooks.

### SessionStart

Fire when a new AI chat stream starts after AI enable checks and request validation.

Allowed outputs:

- `additionalContext`
- `systemMessage`
- `continue: false`

Do not allow `updatedInput` for `SessionStart`.

### UserPromptSubmit

Fire after the user prompt is known but before remote AI request.

Allowed outputs:

- `continue: false`
- `reason`
- `systemMessage`
- `additionalContext`

Do not rewrite the user's prompt in MVP. Prompt rewrites are high-risk because they can obscure user intent and complicate transcript persistence.

## Stop Event

Fire after a turn completes, errors, or is stopped by the user.

Allowed outputs:

- `systemMessage`

Do not allow `continue`, `updatedInput`, or `permissionDecision` to affect a completed turn.

Use `Stop` for cleanup and audit. Do not block final completion on slow command hooks.

## Hook Events To Renderer

The MVP does not need a new renderer channel if hook effects are represented through existing tool result chunks.

If richer display is needed, add a small event shape:

```ts
export interface HookStreamEvent {
  readonly eventType: "hook_event";
  readonly conversationId: string;
  readonly hookRunId: string;
  readonly hookId?: string;
  readonly hookEventName: HookEventName;
  readonly status: "started" | "success" | "blocked" | "failed";
  readonly message?: string;
}
```

Add a channel only when the UI needs progress spinners for long command hooks. Otherwise, use `systemMessage` and tool result metadata.

## Persistence Design

### MVP: No Database Entity

Start with:

- Built-in callback hooks in memory.
- Session hooks in memory.
- Optional local JSON settings for user command hooks.

This keeps phase 1 and phase 2 focused on execution semantics.

### Later: HookConfigEntity

When UI CRUD exists, add:

```ts
@Entity("hook_configs")
export class HookConfigEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  hookId!: string;

  @Column()
  eventName!: string;

  @Column({ nullable: true })
  matcher?: string;

  @Column()
  hookType!: string;

  @Column()
  source!: string;

  @Column({ default: true })
  enabled!: boolean;

  @Column({ default: false })
  trusted!: boolean;

  @Column("text")
  configJson!: string;

  @Column({ nullable: true })
  ownerPluginId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "datetime", nullable: true })
  lastRunAt?: Date;
}
```

Indexes:

- `eventName`
- `source`
- `enabled`
- `ownerPluginId`

### Later: HookAuditEntity

```ts
@Entity("hook_audits")
export class HookAuditEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  auditId!: string;

  @Column()
  hookRunId!: string;

  @Column()
  hookId!: string;

  @Column()
  eventName!: string;

  @Column()
  status!: string;

  @Column({ nullable: true })
  reason?: string;

  @Column({ nullable: true })
  durationMs?: number;

  @Column("text", { nullable: true })
  metadataJson?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
```

Persisted audit should be opt-in or capped by retention. Hook events can be frequent.

## Module And Model Layer

If persistence is added:

`HookConfig.model.ts`:

- `listEnabledByEvent(eventName)`
- `createHook(input)`
- `updateHook(hookId, input)`
- `deleteHook(hookId)`
- `setTrusted(hookId, trusted)`
- `setEnabled(hookId, enabled)`

`HookModule.ts`:

- Validates event names, hook types, matcher strings, and command config.
- Redacts command configs before returning to renderer.
- Converts entities to DTOs.
- Owns business rules, for example plugin ownership checks.

IPC:

- `HOOKS_LIST`
- `HOOKS_CREATE`
- `HOOKS_UPDATE`
- `HOOKS_DELETE`
- `HOOKS_SET_ENABLED`
- `HOOKS_SET_TRUSTED`

IPC handlers must not access TypeORM directly.

## Trust And Security

### Global Hook Switch

Add a setting:

```ts
export const USER_HOOKS_ENABLED = "user_hooks_enabled";
```

Default: false for user command hooks, true for built-in callback hooks.

Built-in hooks should remain available for app safety checks even if user-configured hooks are disabled, unless there is a separate developer-only kill switch.

### Command Hook Trust

Command hooks require:

- `trusted: true`
- global user hooks enabled
- source allowed by current policy
- plugin enabled if source is `plugin`

The first UI version should show:

- event name
- matcher
- command
- cwd
- timeout
- source
- what data is passed to stdin at a high level

### Sensitive Data Redaction

Do not pass secrets unless a future explicit grant exists.

Redact logs with patterns for:

- OpenAI-style keys
- access tokens
- refresh tokens
- cookies
- passwords
- `_authToken`
- `Authorization` headers

### Recursion Guard

Hooks must not trigger hooks recursively by default.

Add an execution context flag:

```ts
export interface HookExecutionContext {
  readonly insideHookExecution: boolean;
}
```

If a command hook causes a tool execution indirectly in a future version, the tool execution path should detect `insideHookExecution` and skip user hooks. Built-in critical hooks may still run if needed.

### AI-Enabled Gate

The MVP does not implement AI-powered hook types.

When `prompt` or `agent` hook types are added:

1. The IPC or service entry must check `Token` and `USER_AI_ENABLED` before model calls.
2. If disabled, return a hook error result with a clear disabled reason.
3. Do not evaluate prompt text, parse remote requests, or call AI APIs before this gate.

## Failure Behavior

Hook failure should not crash the chat stream.

Per-hook failure behavior:

```ts
failureMode?: "warn" | "block";
```

Default:

- `callback` built-in hooks: `block` only when the hook definition opts in.
- user command hooks: `warn` for observability hooks, `block` for policy hooks chosen in config.
- invalid or untrusted command hooks: skipped with audit warning.

If a blocking hook fails:

```ts
{
  success: false,
  error: "Hook policy failed: <safe reason>",
  blockedByHook: true
}
```

If a warning hook fails:

- Record `hookErrors`.
- Add a `systemMessage` only if debug mode or user-visible setting is enabled.
- Continue normal tool execution.

## Performance Design

No-hooks fast path:

```ts
const hooks = HookRegistry.getMatchingHooks(...);
if (hooks.length === 0) {
  return EMPTY_AGGREGATE;
}
```

Registry should keep hooks grouped by event:

```ts
const hooksByEvent = new Map<HookEventName, HookDefinition[]>();
```

Avoid scanning all hook configs for every tool call.

Performance targets:

- No matching hooks: less than 5 ms overhead.
- Callback hook: less than 10 ms typical.
- Command hook: default timeout 5 seconds, visible as tool waiting time.

## Example Built-In Hooks

These are useful test hooks but do not need to ship enabled.

### Block Shell Recursive Delete

```ts
HookRegistry.registerBuiltinHook({
  id: "builtin-block-dangerous-shell-delete",
  eventName: "PreToolUse",
  matcher: "shell_execute",
  source: "builtin",
  enabled: true,
  trusted: true,
  type: "callback",
  failureMode: "block",
  callback: (input) => {
    if (input.eventName !== "PreToolUse") return {};
    const command = String(input.input.command || "");
    if (/\brm\s+-rf\s+(\/|\*)/.test(command)) {
      return {
        continue: false,
        reason: "Dangerous recursive delete command blocked by hook policy.",
      };
    }
    return { continue: true };
  },
});
```

### Add Scraping Compliance Context

```ts
HookRegistry.registerBuiltinHook({
  id: "builtin-scraping-compliance-context",
  eventName: "PostToolUse",
  matcher: "scrape_*",
  source: "builtin",
  enabled: true,
  trusted: true,
  type: "callback",
  callback: () => ({
    additionalContext:
      "When using scraped contact data, recommend compliant outreach and avoid storing unnecessary personal data.",
  }),
});
```

## Implementation Phases

### Phase 1: Core Contracts And Dispatcher

Deliver:

- `hookTypes.ts`
- `HookMatcher`
- `HookOutputValidator`
- `HookResultAggregator`
- `HookRegistry`
- `CallbackHookExecutor`
- `HookDispatcher`
- Unit tests

Exit criteria:

- Built-in/session callback hooks can be registered.
- Matching and aggregation work.
- Deny beats ask, ask beats allow.
- Invalid output is rejected.
- No-hooks fast path works.

### Phase 2: AI Tool Loop Integration

Deliver:

- `PreToolUse` integration in `StreamEventProcessor.executeTool()`.
- Hook-blocked tool result handling.
- `updatedInput` support.
- `PostToolUse` support.
- `PostToolUseFailure` support.
- Tests around fake tool execution.

Exit criteria:

- Tool behavior is unchanged when no hooks match.
- A callback hook can block a tool.
- A callback hook can rewrite tool input.
- Existing permission denial still wins after hook allow.
- Post hooks can add bounded context.

### Phase 3: Command Hooks

Deliver:

- `CommandHookExecutor`
- timeout handling
- stdout/stderr caps
- env allowlist
- trust gate
- command hook audit
- command hook tests

Exit criteria:

- Command hook receives JSON on stdin.
- Valid JSON output affects execution.
- Invalid JSON does not allow execution.
- Timeout is enforced.
- Untrusted command hooks do not run.

### Phase 4: Settings And UI

Deliver:

- hook settings storage
- hook management IPC through module layer
- hook list/create/edit/disable UI
- i18n updates
- last run status

Exit criteria:

- User can enable/disable hooks globally.
- User can disable individual hooks.
- User sees hook block reasons in chat.
- All new UI text is translated.

### Phase 5: Plugin Hooks

Deliver:

- plugin hook manifest format
- plugin hook loading
- plugin enabled-state filtering
- plugin uninstall cleanup
- trust flow for plugin command hooks

Exit criteria:

- Disabled plugins cannot contribute active hooks.
- Plugin hooks are removed or disabled on uninstall.
- Plugin command hooks require trust.

## Test Plan

### Unit Tests

`HookMatcher.test.ts`:

- exact matcher
- wildcard matcher
- prefix wildcard
- suffix wildcard
- contains wildcard
- long matcher rejection

`HookOutputValidator.test.ts`:

- accepts valid minimal output
- accepts block output
- accepts permission decision
- rejects primitive output
- rejects invalid permission decision
- rejects oversized strings
- rejects non-object `updatedInput`

`HookResultAggregator.test.ts`:

- block wins
- first block reason wins
- deny wins over ask and allow
- ask wins over allow
- allow remains advisory
- input updates shallow merge in order
- output updates shallow merge in order
- blocking failure converts to block
- warning failure records error only

`HookRegistry.test.ts`:

- registers built-in hooks
- registers session hooks
- clears session hooks
- filters disabled hooks
- filters untrusted command hooks
- returns source-priority order

`HookDispatcher.test.ts`:

- no-hooks fast path
- callback hook success
- callback hook throw
- invalid callback output
- aggregate multiple callbacks
- respects abort before command start later

`CommandHookExecutor.test.ts`:

- sends JSON on stdin
- parses stdout JSON
- rejects invalid JSON
- enforces timeout
- caps stdout
- captures stderr safely
- rejects untrusted hook
- uses env allowlist

### Integration Tests

Tool loop:

- no hooks, existing tool executes and result continues
- pre hook blocks and executor is not called
- pre hook updates input and executor receives updated input
- pre hook `allow` still hits permission prompt when permission is unknown
- post hook updates output after success
- post failure hook adds context but does not convert failure to success

Permission:

- existing denied permission beats hook allow
- hook deny blocks before permission prompt
- hook ask forces permission prompt

Abort:

- abort before hook execution skips hooks
- abort during command hook kills process or stops waiting
- abort after tool execution does not send continuation

### Manual QA

1. Run chat with no hooks and verify normal tool execution.
2. Register built-in test hook that blocks one harmless tool name.
3. Register built-in test hook that rewrites a harmless parameter.
4. Verify permission prompt still appears for shell or automation skills.
5. Run a command hook that returns invalid JSON.
6. Run a command hook that sleeps past timeout.
7. Stop chat while a slow command hook is running.

## Migration And Compatibility

No database migration is required for phases 1-3 if hook config remains in memory or settings.

If TypeORM entities are added later:

1. Register entities in `src/config/SqliteDb.ts`.
2. Keep `synchronize: true` behavior aligned with existing project conventions.
3. Add model/module tests before IPC UI tests.
4. Do not backfill old tool calls with hook metadata.

Existing conversations and tool results should remain readable. New hook metadata can live in tool result metadata fields where needed.

## Open Technical Questions

1. Should user command hook config be JSON settings or SQLite first?
   - Recommendation: JSON/service storage until hook UI CRUD exists.

2. Should hook input include full tool arguments?
   - Recommendation: yes for MVP, but audit logs must redact. Later add per-hook input scopes if needed.

3. Should hooks execute sequentially or parallel?
   - Recommendation: sequential for MVP because input and output updates need deterministic order.

4. Should `UserPromptSubmit` allow prompt rewrites?
   - Recommendation: no for MVP. Blocking and adding context are safer.

5. Should command hooks use `shell: true`?
   - Recommendation: avoid by default. If shell syntax is required, represent it explicitly and show it in trust UI.

6. Should hook effects be separate chat UI cards?
   - Recommendation: only for blocking, asking, or visible warnings. Avoid noisy cards for successful observability hooks.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Command hooks become hidden local code execution | High | Disabled by default, trust gate, command preview, audit |
| Hook allow bypasses skill permission | High | Central aggregation and permission precedence tests |
| Hooks slow every tool call | Medium | event-indexed registry and no-hooks fast path |
| Invalid hook output corrupts tool loop | Medium | strict validator and bounded output sizes |
| Hook recursion creates loops | High | execution context guard and skip user hooks inside hooks |
| Plugin hooks survive disabled plugin | Medium | filter by plugin ownership and enabled state |
| Hook logs leak secrets | High | no Token values, redaction, sanitized audit only |
| Post hook masks failed tools | Medium | do not let failure hooks convert failure to success in MVP |

## Verification Checklist

- [ ] `yarn test test/vitest/utilitycode/hooks/HookMatcher.test.ts`
- [ ] `yarn test test/vitest/utilitycode/hooks/HookOutputValidator.test.ts`
- [ ] `yarn test test/vitest/utilitycode/hooks/HookResultAggregator.test.ts`
- [ ] `yarn test test/vitest/utilitycode/hooks/HookRegistry.test.ts`
- [ ] `yarn test test/vitest/utilitycode/hooks/HookDispatcher.test.ts`
- [ ] Command hook tests after phase 3
- [ ] Stream/tool loop integration tests after phase 2
- [ ] `yarn vue-check` after UI work
- [ ] `yarn testmain` after IPC work

## Completion Criteria

The hooks foundation is complete when:

1. No-hooks behavior is unchanged.
2. Callback hooks can block, ask, update input, update output, and add context at supported events.
3. Hook `allow` never bypasses existing permission checks.
4. Command hooks are trusted, bounded, timed out, and audited before use.
5. Hook failures are visible and do not crash AI chat.
6. Tests cover matcher, validator, aggregation, dispatcher, command execution, and stream integration.

