/**
 * Renderer API for system dependency operations.
 *
 * Provides typed wrappers around IPC calls for:
 * - Resolving missing dependencies (advisory)
 * - Installing approved dependencies
 * - Querying audit log
 */

import { windowInvoke } from "@/views/utils/apirequest";
import {
  SYSTEM_DEPENDENCY_RESOLVE,
  SYSTEM_DEPENDENCY_INSTALL,
  SYSTEM_DEPENDENCY_GET_AUDIT_LOG,
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
