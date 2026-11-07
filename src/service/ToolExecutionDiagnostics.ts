/**
 * G02 — consistent, redacted execution diagnostic record.
 *
 * One line per plugin tool execution settle (success, failure, degraded
 * promotion, crash) built ONLY from approved metadata: tool/execution
 * identity, discovered plugin identity (name/version/generation from the
 * policy registry), counts, attempt/cleanup timings, outcome and
 * dependency state.
 *
 * Plugin-supplied strings (error code/message from the envelope) pass the
 * shared progress redaction first and are hard-bounded — no full records,
 * no URLs with credentials, no raw filesystem paths, no caught payloads
 * are ever logged.
 */
import { log } from "@/modules/Logger";
import { redactProgressText } from "@/modules/mcp/progressCoalescing";
import { getPluginToolPolicyRegistry } from "@/service/PluginToolPolicyRegistry";
import {
  getPluginBrowserCapabilityService,
} from "@/service/PluginBrowserCapabilityService";

const MAX_DIAG_ERROR_CHARS = 200;

export type ToolExecutionOutcome =
  | "succeeded"
  | "failed"
  | "degraded-promotion"
  | "cancelled"
  | "crashed";

export interface ToolExecutionDiagnosticRecord {
  /** Canonical AI tool name (`mcp__plugin__server__tool`). */
  readonly toolName: string;
  /** Registry job id — the single execution/attempt identity. */
  readonly toolCallId: string;
  readonly conversationId: string;
  readonly pluginName: string;
  /** Outcome class of the settle (never a plugin-supplied free string). */
  readonly outcome: ToolExecutionOutcome;
  /**
   * Attempt role: "initial" or the authorized recovery strategy the ledger
   * approved for this attempt (H1/H3).
   */
  readonly attempt: string;
  /** Wall duration of the managed-async call (ms), host-measured. */
  readonly durationMs: number;
  /** Envelope error code / bounded+redacted message (success reads: null). */
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /** Artifact promotion result (B03): registered candidates and errors. */
  readonly artifactsRegistered: number;
  readonly artifactErrors: number;
  /** Domain result declared record count when the envelope carries one. */
  readonly resultRecordCount: number | null;
  /** Cleanup confirmation for B07 deadlines (null when not a timeout). */
  readonly cleanupPending: boolean | null;
}

/** Dependency state fields are computed OUTSIDE the record (never trusted). */
function dependencyState(pluginName: string): Record<string, unknown> {
  const registry = getPluginToolPolicyRegistry();
  const declared = registry.getPluginArtifactFormats(pluginName);
  let browser: unknown = null;
  try {
    const declaredBrowser = registry.pluginDeclaresBrowserExecution(pluginName);
    browser = declaredBrowser
      ? getPluginBrowserCapabilityService().testBrowserUsable({
          browserExecutable: true,
        }).compatible
      : null;
  } catch {
    browser = null;
  }
  return {
    artifactsDeclared: declared,
    browserDeclared: registry.pluginDeclaresBrowserExecution(pluginName),
    browserCompatible: browser,
  };
}

/**
 * Build and log the diagnostic record. Everything passes the shared
 * redaction (progress text) before reaching any consumer; the record is
 * written through the host logger only, never sent to the model or
 * persisted with results.
 */
export function buildToolExecutionDiagnostics(
  record: ToolExecutionDiagnosticRecord
): Record<string, unknown> {
  const registry = getPluginToolPolicyRegistry();
  return {
    category: "tool_execution",
    toolName: record.toolName,
    toolCallId: record.toolCallId,
    conversationId: record.conversationId,
    plugin: record.pluginName,
    pluginVersion: registry.getPluginVersion(record.pluginName),
    pluginGeneration: registry.getPluginGeneration(record.pluginName),
    outcome: record.outcome,
    attempt: record.attempt,
    durationMs: Math.max(0, Math.round(record.durationMs)),
    errorCode:
      record.errorCode !== null
        ? redactProgressText(record.errorCode, MAX_DIAG_ERROR_CHARS)
        : null,
    errorMessage:
      record.errorMessage !== null
        ? redactProgressText(record.errorMessage, MAX_DIAG_ERROR_CHARS)
        : null,
    artifactsRegistered: record.artifactsRegistered,
    artifactErrors: record.artifactErrors,
    resultRecordCount: record.resultRecordCount,
    cleanupPending: record.cleanupPending,
    ...dependencyState(record.pluginName),
  };
}

export function logToolExecutionDiagnostics(
  record: ToolExecutionDiagnosticRecord
): void {
  try {
    log.info(
      `[tool-execution] ${JSON.stringify(
        buildToolExecutionDiagnostics(record)
      )}`
    );
  } catch {
    // Diagnostics must never break the execution they describe.
  }
}

/**
 * Extract a bounded, redacted error identity from a settled ToolExecutionResult
 * envelope — never the full payload.
 */
export function envelopeErrorIdentity(result: unknown): {
  code: string | null;
  message: string | null;
  recordCount: number | null;
} {
  const out: {
    code: string | null;
    message: string | null;
    recordCount: number | null;
  } = { code: null, message: null, recordCount: null };
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return out;
  }
  const record = result as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const err = error as Record<string, unknown>;
    if (typeof err.code === "string") out.code = err.code.slice(0, 120);
    if (typeof err.message === "string") {
      out.message = err.message.slice(0, MAX_DIAG_ERROR_CHARS);
    }
  }
  const count = (record as Record<string, unknown>)["count"];
  if (typeof count === "number" && Number.isFinite(count)) {
    out.recordCount = Math.max(0, Math.floor(count));
  }
  return out;
}
