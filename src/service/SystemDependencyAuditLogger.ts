/**
 * Audit logging for system dependency installation actions.
 *
 * Provides stderr sanitization and audit record creation.
 * Uses DependencyAuditModel for persistence.
 */

import { DependencyAuditModel } from "@/model/DependencyAudit.model";

const MAX_STDERR_LENGTH = 500;

/** Patterns removed from stderr before storage. */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const ABSOLUTE_PATH = /\/(?:Users|home|etc|var|tmp|opt|usr)\/[^\s"']+/g;
const HOME_REF = /(?:\$HOME|~)\/[^\s"']+/g;
const SECRET_PATTERN =
  /(?:sk-[a-zA-Z0-9]{10,}|ghp_[a-zA-Z0-9]{10,}|AKIA[A-Z0-9]{16}|token["\s:=]+["'][^"']{8,})/gi;

/**
 * Sanitize stderr before storing in the audit log.
 *
 * - Removes absolute paths, home directory references
 * - Removes ANSI escape codes
 * - Redacts common secret patterns
 * - Truncates to 500 characters
 */
export function sanitizeStderr(stderr: string): string {
  let result = stderr;

  // Remove ANSI escape codes first
  result = result.replace(ANSI_ESCAPE, "");

  // Redact secrets before path sanitization (secrets may contain paths)
  result = result.replace(SECRET_PATTERN, "[REDACTED]");

  // Remove absolute Unix paths
  result = result.replace(ABSOLUTE_PATH, "[PATH]");

  // Remove home directory references
  result = result.replace(HOME_REF, "[HOME]");

  // Truncate
  if (result.length > MAX_STDERR_LENGTH) {
    result = result.slice(0, MAX_STDERR_LENGTH);
  }

  return result;
}

/**
 * Service for writing audit log entries for dependency install actions.
 *
 * This is a thin wrapper around DependencyAuditModel that adds
 * sanitization and structured field mapping.
 */
export class SystemDependencyAuditLogger {
  private readonly model: DependencyAuditModel;

  constructor(dbPath: string) {
    this.model = new DependencyAuditModel(dbPath);
  }

  /**
   * Log a dependency install action.
   *
   * Records the full lifecycle: diagnosis, user decision, and outcome.
   * Stderr is sanitized before storage.
   */
  async logAction(params: {
    conversation_id: string;
    skill_name: string;
    dependency_id: string;
    missing_binary: string;
    suggested_by_ai: boolean;
    user_decision: "approved" | "denied" | "suggested";
    installer_backend?: string | null;
    package_name?: string | null;
    execution_status?: string | null;
    execution_duration_ms?: number | null;
    stderr?: string | null;
  }): Promise<number> {
    const stderrSanitized = params.stderr
      ? sanitizeStderr(params.stderr)
      : null;

    return this.model.createEntry({
      conversation_id: params.conversation_id,
      skill_name: params.skill_name,
      dependency_id: params.dependency_id,
      missing_binary: params.missing_binary,
      suggested_by_ai: params.suggested_by_ai,
      user_decision: params.user_decision,
      installer_backend: params.installer_backend ?? null,
      package_name: params.package_name ?? null,
      execution_status: params.execution_status ?? null,
      execution_duration_ms: params.execution_duration_ms ?? null,
      stderr_sanitized: stderrSanitized,
    });
  }

  /** Get the underlying model for queries. */
  getModel(): DependencyAuditModel {
    return this.model;
  }
}
