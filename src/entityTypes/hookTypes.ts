/**
 * AiFetchly Hooks System — Type Contracts
 *
 * Lifecycle hook layer that wraps the AI chat tool loop. See
 * docs/superpowers/specs/2026-06-23-hooks-system-technical-design.md for
 * the full design. The MVP supports PreToolUse / PostToolUse /
 * PostToolUseFailure around StreamEventProcessor.executeTool(), plus
 * callback and command hook executors.
 *
 * Design rules:
 * - Inputs are readonly and produced by the dispatcher; hook callbacks
 *   never construct them.
 * - Outputs are parsed from `unknown` via HookOutputValidator before
 *   aggregation, even for trusted callback hooks.
 * - "Stricter wins": deny beats ask beats allow. Hook allow never
 *   bypasses SkillPermissionService.
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

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

export type HookFailureMode = "warn" | "block";

export type HookPermissionDecision = "allow" | "ask" | "deny";

/** Where the hook run originated. */
export type HookRunSource = "ai-chat-v2" | "agent-runtime" | "system";

// ---------------------------------------------------------------------------
// Size / timing limits
// ---------------------------------------------------------------------------

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
  maxMatcherChars: 128,
} as const;

/** Safe environment variable keys passed to command hooks. */
export const DEFAULT_HOOK_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "TEMP",
  "TMP",
] as const;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface HookInputBase {
  readonly eventName: HookEventName;
  readonly hookRunId: string;
  readonly source: HookRunSource;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly sessionId?: string;
  readonly timestamp: string;
}

export type HookToolSource = "skill-registry" | "mcp" | "legacy-tool";

export interface HookToolDescriptor {
  readonly id: string;
  readonly name: string;
  readonly source: HookToolSource;
  readonly permissionCategory?: string;
}

export interface HookPermissionState {
  readonly allowed: boolean;
  readonly needsPrompt: boolean;
  readonly reason?: string;
}

export interface PreToolUseHookInput extends HookInputBase {
  readonly eventName: "PreToolUse";
  readonly tool: HookToolDescriptor;
  readonly input: Record<string, unknown>;
  readonly permissionState: HookPermissionState;
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

export type HookInput =
  | SessionStartHookInput
  | UserPromptSubmitHookInput
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PermissionRequestHookInput
  | PermissionDeniedHookInput
  | StopHookInput;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

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

export type HookDefinition = CallbackHookDefinition | CommandHookDefinition;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

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

/** Empty aggregate returned on the no-hooks fast path. */
export const EMPTY_AGGREGATE: AggregatedHookResult = {
  blocked: false,
  additionalContexts: [],
  systemMessages: [],
  hookErrors: [],
  executedHookIds: [],
};

/**
 * Recursion guard. Tool execution paths may inspect this flag to skip
 * user/plugin hooks when they are invoked from inside an in-flight hook
 * run. Built-in safety hooks may still run.
 *
 * The MVP threads this through the dispatcher only; SkillExecutor is
 * unchanged. Future integrations can read it to opt out of user hooks.
 */
export interface HookExecutionContext {
  readonly insideHookExecution: boolean;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type HookAuditStatus =
  | "started"
  | "success"
  | "blocked"
  | "failed"
  | "timeout";

export interface HookAuditEntry {
  readonly hookRunId: string;
  readonly hookId: string;
  readonly eventName: HookEventName;
  readonly source: HookSource;
  readonly type: HookCommandType;
  readonly matchQuery?: string;
  readonly status: HookAuditStatus;
  readonly durationMs?: number;
  readonly reason?: string;
  readonly timestamp: string;
}
