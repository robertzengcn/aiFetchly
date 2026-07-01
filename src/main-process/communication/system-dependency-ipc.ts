/**
 * System Dependency IPC handlers — resolve, install, and audit query.
 *
 * All handlers follow the three-layer architecture:
 * IPC (this file, validated) → Module (business logic) → Service → Model
 */

import { SystemDependencyModule } from "@/modules/SystemDependencyModule";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  resolveSystemDependencyInputSchema,
  installSystemDependencyInputSchema,
  getAuditLogInputSchema,
} from "@/schemas/ipc/systemDependency";

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

export function registerSystemDependencyIpcHandlers(): void {
  registerValidatedHandler(
    SYSTEM_DEPENDENCY_RESOLVE,
    resolveSystemDependencyInputSchema,
    async (input) => {
      const { conversation_id, skill_name, ...resolveInput } = input;
      const mod = getModule();
      return mod.resolve(resolveInput, { conversation_id, skill_name });
    }
  );

  registerValidatedHandler(
    SYSTEM_DEPENDENCY_INSTALL,
    installSystemDependencyInputSchema,
    async (input) => {
      // Original H-2 fix (mandatory fields) now enforced by schema:
      //   dependency_id, conversation_id, skill_name all required as
      //   non-empty strings at boundary.
      const mod = getModule();
      return mod.install(input);
    }
  );

  registerValidatedHandler(
    SYSTEM_DEPENDENCY_GET_AUDIT_LOG,
    getAuditLogInputSchema,
    async (input) => {
      // Original M-2 fix (cap pagination at 500) now enforced by schema:
      //   limit.max(500). Handler still applies defaults for missing values.
      const mod = getModule();
      return mod.getAuditLog({
        ...input,
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
      });
    }
  );
}
