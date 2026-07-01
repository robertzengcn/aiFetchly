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
import { SHELL_RATE_LIMITS } from "@/config/shellToolConfig";

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

/** Legacy names merged into scrape_urls_from_search_engine (old transcripts + permissions). */
const LEGACY_SEARCH_SCRAPE_TOOL_NAMES = new Set<string>([
  "scrape_urls_from_google",
  "scrape_urls_from_bing",
  "scrape_urls_from_yandex",
  "scrape_urls_from_baidu",
]);

const LEGACY_SEARCH_ENGINE_ARG: Readonly<Record<string, string>> = {
  scrape_urls_from_google: "google",
  scrape_urls_from_bing: "bing",
  scrape_urls_from_yandex: "yandex",
  scrape_urls_from_baidu: "baidu",
};

function resolveSearchScrapeInvocation(
  name: string,
  args: Record<string, unknown>
): {
  skillName: string;
  resolvedArgs: Record<string, unknown>;
  permissionSkillName: string;
} {
  const engine = LEGACY_SEARCH_ENGINE_ARG[name];
  if (engine !== undefined) {
    return {
      skillName: "scrape_urls_from_search_engine",
      resolvedArgs: { ...args, search_engine: engine },
      permissionSkillName: name,
    };
  }
  return {
    skillName: name,
    resolvedArgs: args,
    permissionSkillName: name,
  };
}

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
// Shell rate limiting (FR-031)
// ---------------------------------------------------------------------------

class ShellRateLimiter {
  private activeCount = 0;
  private timestamps: number[] = [];

  check(): { allowed: true } | { allowed: false; reason: string } {
    const now = Date.now();

    // Prune timestamps older than 1 minute
    const oneMinuteAgo = now - 60_000;
    while (this.timestamps.length > 0 && this.timestamps[0] < oneMinuteAgo) {
      this.timestamps.shift();
    }

    // Check concurrent limit
    if (this.activeCount >= SHELL_RATE_LIMITS.maxConcurrent) {
      return {
        allowed: false,
        reason: `Too many concurrent shell commands (max ${SHELL_RATE_LIMITS.maxConcurrent})`,
      };
    }

    // Check per-minute limit
    if (this.timestamps.length >= SHELL_RATE_LIMITS.maxPerMinute) {
      return {
        allowed: false,
        reason: `Shell command rate limit exceeded (max ${SHELL_RATE_LIMITS.maxPerMinute}/min)`,
      };
    }

    // Check cooldown
    if (this.timestamps.length > 0) {
      const lastRun = this.timestamps[this.timestamps.length - 1];
      if (now - lastRun < SHELL_RATE_LIMITS.cooldownMs) {
        return {
          allowed: false,
          reason: `Shell command cooldown not elapsed (${SHELL_RATE_LIMITS.cooldownMs}ms)`,
        };
      }
    }

    return { allowed: true };
  }

  acquire(): void {
    this.activeCount++;
    this.timestamps.push(Date.now());
  }

  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  /** Reset state for testing. */
  reset(): void {
    this.activeCount = 0;
    this.timestamps = [];
  }
}

const shellRateLimiter = new ShellRateLimiter();

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

  const { skillName, resolvedArgs, permissionSkillName } =
    resolveSearchScrapeInvocation(name, args);

  // 1. Validate — skill must be registered
  const skill = SkillRegistry.getSkill(skillName);
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
    auditLog(
      name,
      resolvedArgs,
      false,
      result.execution_time_ms,
      "Unknown tool"
    );
    return result;
  }

  // 2. Sanitize input (FR-003)
  const validation = validateArgs(resolvedArgs);
  if (!validation.valid) {
    const result: ToolExecutionResult = {
      tool_call_id: toolCallId,
      tool_name: name,
      success: false,
      result: { error: `Input validation failed: ${validation.reason}` },
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(
      name,
      resolvedArgs,
      false,
      result.execution_time_ms,
      validation.reason
    );
    return result;
  }

  // 3. Permission check (pure skills auto-allowed, or already granted by caller)
  if (!context.skipPermissionCheck) {
    const permCheck =
      SkillPermissionService.checkPermission(permissionSkillName);
    if (!permCheck.allowed) {
      if (permCheck.needsPrompt) {
        // Return a special result indicating permission is needed.
        // StreamEventProcessor shows the UI prompt, defers sendToolResultToAI until the user grants.
        const result: ToolExecutionResult = {
          tool_call_id: toolCallId,
          tool_name: name,
          success: false,
          result: {
            error: "Permission required",
            needsPermissionPrompt: true,
            permissionCategory: skill.permissionCategory,
            // Shell skills: include command preview for the permission prompt UI
            ...(skill.permissionCategory === "shell"
              ? {
                  shellPreview: {
                    command: (resolvedArgs.command as string) ?? "",
                    cwd: (resolvedArgs.cwd as string) ?? "",
                    shell: (resolvedArgs.shell as string) ?? "auto",
                    timeout_ms: (resolvedArgs.timeout_ms as number) ?? 60000,
                  },
                }
              : {}),
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
      auditLog(
        name,
        resolvedArgs,
        false,
        result.execution_time_ms,
        permCheck.reason
      );
      return result;
    }
  }

  // 4. Shell rate limiting (only for shell_execute)
  if (skill.permissionCategory === "shell") {
    const rateLimit = shellRateLimiter.check();
    if (!rateLimit.allowed) {
      const result: ToolExecutionResult = {
        tool_call_id: toolCallId,
        tool_name: name,
        success: false,
        result: { error: rateLimit.reason },
        execution_time_ms: Date.now() - startTime,
      };
      auditLog(
        name,
        resolvedArgs,
        false,
        result.execution_time_ms,
        rateLimit.reason
      );
      return result;
    }
    shellRateLimiter.acquire();
  }

  // 5. Execute based on tier
  try {
    const execResult = await skill.execute(resolvedArgs, context);
    const result: ToolExecutionResult = {
      tool_call_id: toolCallId,
      tool_name: name,
      success: execResult.success,
      result: execResult.result,
      execution_time_ms: Date.now() - startTime,
    };
    auditLog(name, resolvedArgs, result.success, result.execution_time_ms);
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
    auditLog(name, resolvedArgs, false, result.execution_time_ms, errorMessage);
    return result;
  } finally {
    if (skill.permissionCategory === "shell") {
      shellRateLimiter.release();
    }
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
      context.conversationId,
      {
        toolCallId: context.toolCallId,
        emitProgress: context.emitProgress,
        signal: context.signal,
      }
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
  return (
    SkillRegistry.isRegistered(name) ||
    LEGACY_SEARCH_SCRAPE_TOOL_NAMES.has(name) ||
    name.startsWith("mcp_")
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SkillExecutor = {
  execute,
  isKnown,
  /** Exposed for testing. */
  validateArgs,
  /** Exposed for testing — rate limiter instance. */
  rateLimiter: shellRateLimiter,
} as const;
