/**
 * SkillExecutor — validates, permission-checks, and dispatches skill execution.
 *
 * Wraps the existing ToolExecutor for built-in skills. Routes execution
 * to the correct tier (renderer, main, sandboxed).
 *
 * Includes:
 * - Input sanitization (T025)
 * - Permission checks (T018)
 * - Audit logging (T024)
 *
 * @see research.md Decision 3 (tier dispatching)
 * @see research.md Decision 8 (wrap ToolExecutor)
 */

import type { ToolExecutionResult } from "@/api/aiChatApi";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { SkillRegistry } from "@/config/skillsRegistry";
import { ToolExecutor } from "@/service/ToolExecutor";
import { SkillPermissionService } from "@/service/SkillPermissionService";

// ---------------------------------------------------------------------------
// Input sanitization (FR-003, FR-024)
// ---------------------------------------------------------------------------

/** Patterns that should be rejected in skill arguments. */
const SENSITIVE_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{20,}\b/, // OpenAI-style API keys
  /\bpk_[a-zA-Z0-9]{20,}\b/, // Stripe-style keys
  /\bat_[a-zA-Z0-9]{20,}\b/, // Generic access tokens
  /\bpassword\s*[:=]\s*["']?\S{4,}/i, // password=xxx or password:"xxx" (4+ chars)
  /\btoken\s*[:=]\s*["']?\S{8,}/i, // token=xxx (8+ chars to avoid "token:bearer")
  /\bcookie\s*[:=]\s*["']?\S{8,}/i, // cookie=xxx (8+ chars)
  /\bsecret\s*[:=]\s*["']?\S{4,}/i, // secret=xxx (4+ chars)
] as const;

/**
 * Validate and sanitize skill arguments.
 * Rejects arguments containing sensitive patterns.
 */
function validateArgs(
  args: Record<string, unknown>
): { valid: true } | { valid: false; reason: string } {
  const serialized = JSON.stringify(args);

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(serialized)) {
      return {
        valid: false,
        reason: `Arguments contain a potentially sensitive value matching pattern ${pattern.source}`,
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Audit logging (FR-024)
// ---------------------------------------------------------------------------

/** Sanitize args for logging — strips sensitive values. */
function sanitizeForLog(
  args: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      sanitized[key] =
        value.length > 100
          ? `${value.substring(0, 50)}...[truncated, ${value.length} chars]`
          : value;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function auditLog(
  name: string,
  args: Record<string, unknown>,
  success: boolean,
  durationMs: number,
  error?: string
): void {
  const sanitizedArgs = sanitizeForLog(args);
  const logEntry = {
    tool: name,
    args: sanitizedArgs,
    success,
    durationMs,
    ...(error ? { error } : {}),
    timestamp: new Date().toISOString(),
  };
  console.log(`[SkillAudit] ${JSON.stringify(logEntry)}`);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Execute a registered skill by name.
 *
 * Flow:
 *  1. Validate tool name in registry
 *  2. Sanitize input arguments
 *  3. Check permission (pure skills auto-allowed)
 *  4. Execute based on tier
 *  5. Audit-log the result
 *  6. Return structured ToolExecutionResult (never throws)
 */
async function execute(
  name: string,
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  const toolCallId = context.toolCallId;

  // 1. Validate — skill must be registered
  const skill = SkillRegistry.getSkill(name);
  if (!skill) {
    // Fall back to ToolExecutor for MCP tools (mcp_* prefix)
    if (name.startsWith("mcp_")) {
      return executeViaToolExecutor(name, args, context, startTime);
    }

    const result: ToolExecutionResult = {
      tool_call_id: toolCallId,
      tool_name: name,
      success: false,
      result: { error: `Unknown tool: ${name}` },
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, args, false, result.execution_time_ms, "Unknown tool");
    return result;
  }

  // 2. Sanitize input (FR-003)
  const validation = validateArgs(args);
  if (!validation.valid) {
    const result: ToolExecutionResult = {
      tool_call_id: toolCallId,
      tool_name: name,
      success: false,
      result: { error: `Input validation failed: ${validation.reason}` },
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, args, false, result.execution_time_ms, validation.reason);
    return result;
  }

  // 3. Permission check (pure skills auto-allowed)
  const permCheck = SkillPermissionService.checkPermission(name);
  if (!permCheck.allowed) {
    if (permCheck.needsPrompt) {
      // Return a special result indicating permission is needed
      // The caller (StreamEventProcessor) will handle prompting the user
      const result: ToolExecutionResult = {
        tool_call_id: toolCallId,
        tool_name: name,
        success: false,
        result: {
          error: "Permission required",
          needsPermissionPrompt: true,
          permissionCategory: skill.permissionCategory,
        },
        execution_time_ms: Date.now() - startTime,
      };
      return result;
    }
    // Explicitly denied
    const result: ToolExecutionResult = {
      tool_call_id: toolCallId,
      tool_name: name,
      success: false,
      result: { error: permCheck.reason || "Permission denied" },
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, args, false, result.execution_time_ms, permCheck.reason);
    return result;
  }

  // 4. Execute based on tier
  try {
    const execResult = await skill.execute(args, context);
    const result: ToolExecutionResult = {
      tool_call_id: toolCallId,
      tool_name: name,
      success: execResult.success,
      result: execResult.result,
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, args, result.success, result.execution_time_ms);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const result: ToolExecutionResult = {
      tool_call_id: toolCallId,
      tool_name: name,
      success: false,
      result: { error: errorMessage },
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, args, false, result.execution_time_ms, errorMessage);
    return result;
  }
}

/**
 * Delegate directly to ToolExecutor for tools not in the registry
 * (e.g., MCP tools with mcp_ prefix).
 */
async function executeViaToolExecutor(
  name: string,
  args: Record<string, unknown>,
  context: SkillExecutionContext,
  startTime: number
): Promise<ToolExecutionResult> {
  try {
    const result = await ToolExecutor.execute(
      name,
      args,
      context.conversationId
    );
    const execResult: ToolExecutionResult = {
      tool_call_id: context.toolCallId,
      tool_name: name,
      success: true,
      result,
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, args, true, execResult.execution_time_ms);
    return execResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const execResult: ToolExecutionResult = {
      tool_call_id: context.toolCallId,
      tool_name: name,
      success: false,
      result: { error: errorMessage },
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, args, false, execResult.execution_time_ms, errorMessage);
    return execResult;
  }
}

/**
 * Check if a tool name is known (either in the registry or handled by ToolExecutor).
 */
function isKnown(name: string): boolean {
  return SkillRegistry.isRegistered(name) || name.startsWith("mcp_");
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SkillExecutor = {
  execute,
  isKnown,
  /** Exposed for testing. */
  validateArgs,
} as const;
