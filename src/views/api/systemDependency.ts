/**
 * Renderer API for system dependency operations.
 *
 * Provides typed wrappers around IPC calls for:
 * - Resolving missing dependencies (advisory)
 * - Installing approved dependencies
 * - Querying audit log
 * - Prompt/response flow for auto-detected dependency installs
 */

import { windowInvoke } from "@/views/utils/apirequest";
import {
  SYSTEM_DEPENDENCY_RESOLVE,
  SYSTEM_DEPENDENCY_INSTALL,
  SYSTEM_DEPENDENCY_GET_AUDIT_LOG,
  SYSTEM_DEPENDENCY_PROMPT,
  SYSTEM_DEPENDENCY_PROMPT_RESPONSE,
} from "@/config/channellist";
import type {
  ResolveSystemDependencyInput,
  ResolveSystemDependencyOutput,
  InstallSystemDependencyRequest,
  InstallSystemDependencyResponse,
  GetAuditLogRequest,
  GetAuditLogResponse,
} from "@/entityTypes/systemDependencyTypes";

/** Resolve a potential missing system dependency (advisory, no side effects). */
export async function resolveSystemDependency(
  input: ResolveSystemDependencyInput
): Promise<ResolveSystemDependencyOutput> {
  return await windowInvoke(SYSTEM_DEPENDENCY_RESOLVE, input);
}

/** Install a user-approved system dependency. */
export async function installSystemDependency(
  request: InstallSystemDependencyRequest
): Promise<InstallSystemDependencyResponse> {
  return await windowInvoke(SYSTEM_DEPENDENCY_INSTALL, request);
}

/** Query audit log entries with optional filters. */
export async function getAuditLog(
  params: GetAuditLogRequest
): Promise<GetAuditLogResponse> {
  return await windowInvoke(SYSTEM_DEPENDENCY_GET_AUDIT_LOG, params);
}

/** Payload sent from main process when asking user to approve an install. */
export interface DependencyPromptPayload {
  readonly toolId: string;
  readonly toolName: string;
  readonly conversationId: string;
  readonly resolution: ResolveSystemDependencyOutput;
  readonly reason: string;
}

/**
 * Register a listener for the dependency install prompt from main process.
 * Returns an unsubscribe function.
 */
export function onDependencyPrompt(
  callback: (payload: DependencyPromptPayload) => void
): () => void {
  const handler = (payload: unknown): void => {
    callback(payload as DependencyPromptPayload);
  };
  window.api.receive(SYSTEM_DEPENDENCY_PROMPT, handler);
  return () => {
    window.api.removeListener(SYSTEM_DEPENDENCY_PROMPT, handler);
  };
}

/** Send the user's approval/denial back to the main process. */
export async function respondToDependencyPrompt(
  toolId: string,
  approved: boolean
): Promise<{ ok: boolean; error?: string }> {
  return await windowInvoke(SYSTEM_DEPENDENCY_PROMPT_RESPONSE, {
    toolId,
    approved,
  });
}
