/**
 * System Dependency IPC handlers — resolve, install, and audit query.
 *
 * All handlers follow the three-layer architecture:
 * IPC (this file) → Module (business logic) → Service → Model
 */

import { ipcMain } from "electron";
import { SystemDependencyModule } from "@/modules/SystemDependencyModule";
import type {
  ResolveSystemDependencyInput,
  InstallSystemDependencyRequest,
  GetAuditLogRequest,
} from "@/entityTypes/systemDependencyTypes";

/** IPC channel names. */
export const SYSTEM_DEPENDENCY_RESOLVE = "system-dependency:resolve";
export const SYSTEM_DEPENDENCY_INSTALL = "system-dependency:install";
export const SYSTEM_DEPENDENCY_GET_AUDIT_LOG =
  "system-dependency:get-audit-log";

let moduleInstance: SystemDependencyModule | null = null;

function getModule(): SystemDependencyModule {
  if (!moduleInstance) {
    moduleInstance = new SystemDependencyModule();
  }
  return moduleInstance;
}

/** Validate that a value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function registerSystemDependencyIpcHandlers(): void {
  ipcMain.handle(
    SYSTEM_DEPENDENCY_RESOLVE,
    async (
      _event,
      input: ResolveSystemDependencyInput & {
        conversation_id?: string;
        skill_name?: string;
      }
    ) => {
      try {
        const mod = getModule();
        const { conversation_id, skill_name, ...resolveInput } = input;
        return mod.resolve(resolveInput, { conversation_id, skill_name });
      } catch (error) {
        return {
          resolved: false,
          confidence: 0,
          reason: `Resolver error: ${
            error instanceof Error ? error.message : String(error)
          }`,
          requires_manual_review: true,
        };
      }
    }
  );

  ipcMain.handle(
    SYSTEM_DEPENDENCY_INSTALL,
    async (_event, request: InstallSystemDependencyRequest) => {
      try {
        // Input validation at IPC boundary (H-2 fix)
        if (
          !isNonEmptyString(request?.dependency_id) ||
          !isNonEmptyString(request?.conversation_id) ||
          !isNonEmptyString(request?.skill_name)
        ) {
          return {
            status: false,
            msg: "Invalid request: dependency_id, conversation_id, and skill_name are required",
            data: null,
          };
        }
        const mod = getModule();
        const result = await mod.install(request);
        return { status: true, msg: "Install completed", data: result };
      } catch (error) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : String(error),
          data: null,
        };
      }
    }
  );

  ipcMain.handle(
    SYSTEM_DEPENDENCY_GET_AUDIT_LOG,
    async (_event, params: GetAuditLogRequest) => {
      try {
        // Cap pagination limit (M-2 fix)
        const cappedParams: GetAuditLogRequest = {
          ...params,
          limit: Math.min(params?.limit ?? 50, 500),
          offset: params?.offset ?? 0,
        };
        const mod = getModule();
        return await mod.getAuditLog(cappedParams);
      } catch (error) {
        return {
          status: false,
          data: [],
          total: 0,
        };
      }
    }
  );
}
