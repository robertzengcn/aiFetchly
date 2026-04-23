/**
 * ShellAuditLogger — structured audit logging for shell executions.
 *
 * Redacts sensitive tokens from command text before persisting
 * to the audit log via ShellAuditModel.
 */

import { Token } from "@/config/usersetting";
import { USERSDBPATH } from "@/config/usersetting";
import { ShellAuditModel } from "@/model/ShellAudit.model";
import { SHELL_REDACTION_PATTERNS } from "@/config/shellToolConfig";
import type { ShellAuditData } from "@/entityTypes/shellTypes";

/**
 * Redact sensitive tokens from command text.
 *
 * Applies all redaction patterns from shellToolConfig to replace
 * API keys, passwords, tokens, and credential URLs with placeholders.
 */
export function redactCommand(command: string): string {
  let redacted = command;
  for (const { pattern, replacement } of SHELL_REDACTION_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/**
 * Service for writing shell execution audit log entries.
 *
 * Handles redaction of sensitive command text and persists
 * structured audit records via ShellAuditModel.
 */
export class ShellAuditLogger {
  /**
   * Write an audit log entry for a shell execution.
   *
   * Command text is redacted before storage.
   * This method is fire-and-forget — errors are logged but do not
   * block the caller.
   */
  async log(data: ShellAuditData): Promise<void> {
    try {
      const tokenService = new Token();
      const dbPath = tokenService.getValue(USERSDBPATH);
      if (!dbPath) {
        return;
      }

      const model = new ShellAuditModel(dbPath);
      const commandRedacted = redactCommand(data.commandRedacted);

      await model.createEntry({
        conversation_id: data.conversationId,
        tool_call_id: data.toolCallId,
        command_redacted: commandRedacted,
        cwd: data.cwd,
        shell: data.shell,
        success: data.success,
        exit_code: data.exitCode,
        timed_out: data.timedOut,
        duration_ms: data.durationMs,
      });
    } catch (error: unknown) {
      // Audit log failure must not crash the shell execution path.
      // Log to console but do not throw.
      const message =
        error instanceof Error ? error.message : "Unknown audit log error";
      console.error(`[ShellAuditLogger] Failed to write audit entry: ${message}`);
    }
  }
}
