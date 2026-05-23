/**
 * Skills IPC handlers — permission management and skill import for skill execution.
 *
 * Handles:
 * - SKILL_CHECK_PERMISSION: Check if a skill can execute
 * - SKILL_GRANT_PERMISSION: Grant execution permission
 * - SKILL_DENY_PERMISSION: Deny execution permission
 * - SKILL_REVOKE_PERMISSION: Reset permission to prompt again
 * - SKILL_GET_PERMISSION_STATUS: Get current permission status
 * - SKILL_IMPORT: Import a skill from a zip file
 * - SKILL_LIST_INSTALLED: List all installed skills
 * - SKILL_TOGGLE: Enable/disable an installed skill
 * - SKILL_UNINSTALL: Remove an installed skill
 *
 * All handlers check AI enable first per CLAUDE.md rules.
 */

import { ipcMain, app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  SKILL_CHECK_PERMISSION,
  SKILL_GRANT_PERMISSION,
  SKILL_DENY_PERMISSION,
  SKILL_REVOKE_PERMISSION,
  SKILL_GET_PERMISSION_STATUS,
  SKILL_IMPORT,
  SKILL_LIST_INSTALLED,
  SKILL_TOGGLE,
  SKILL_UNINSTALL,
} from "@/config/channellist";
import { SkillPermissionService } from "@/service/SkillPermissionService";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { SkillImportService } from "@/service/SkillImportService";

interface AiDisabledResponse {
  status: false;
  msg: string;
  data: null;
}

/**
 * Check if AI features are enabled.
 */
function checkAiEnabled(): AiDisabledResponse | null {
  const tokenService = new Token();
  const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
  if (!aiEnabled || aiEnabled === "false" || aiEnabled === "0") {
    return {
      status: false,
      msg: "AI features are not enabled. Please upgrade your plan to access AI features.",
      data: null,
    };
  }
  return null;
}

/**
 * ipcMain.handle listeners receive (event, ...invokeArgs). Spread `...args` puts the
 * IpcMainInvokeEvent at index 0 and the renderer payload at index 1.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractData<T>(args: unknown[]): T {
  return args[1] as T;
}

/**
 * Validate that a string is non-empty and within length bounds.
 */
function validateString(
  value: unknown,
  fieldName: string,
  maxLength = 256
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return `${fieldName} is required and must be a non-empty string`;
  }
  if (value.length > maxLength) {
    return `${fieldName} exceeds maximum length of ${maxLength}`;
  }
  return null;
}

export function registerSkillsIpcHandlers(): void {
  console.log("Skills IPC handlers registered");

  // Check if a skill needs permission or can execute
  ipcMain.handle(SKILL_CHECK_PERMISSION, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ skillName: string }>(args);
    const nameError = validateString(data?.skillName, "skillName");
    if (nameError) return { status: false, msg: nameError, data: null };

    try {
      const result = SkillPermissionService.checkPermission(data.skillName);
      return {
        status: true,
        msg: "Permission check completed",
        data: {
          allowed: result.allowed,
          needsPrompt: result.needsPrompt,
          reason: result.reason,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // Grant permission for a skill
  ipcMain.handle(SKILL_GRANT_PERMISSION, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ skillName: string; persistent: boolean }>(args);
    const nameError = validateString(data?.skillName, "skillName");
    if (nameError) return { status: false, msg: nameError, data: null };
    try {
      SkillPermissionService.grantPermission(data.skillName, data.persistent);
      return { status: true, msg: "Permission granted", data: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // Deny permission for a skill
  ipcMain.handle(SKILL_DENY_PERMISSION, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ skillName: string }>(args);
    const nameError = validateString(data?.skillName, "skillName");
    if (nameError) return { status: false, msg: nameError, data: null };
    try {
      SkillPermissionService.denyPermission(data.skillName);
      return { status: true, msg: "Permission denied", data: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // Revoke (reset) permission for a skill
  ipcMain.handle(SKILL_REVOKE_PERMISSION, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ skillName: string }>(args);
    const nameError = validateString(data?.skillName, "skillName");
    if (nameError) return { status: false, msg: nameError, data: null };
    try {
      SkillPermissionService.revokePermission(data.skillName);
      return { status: true, msg: "Permission revoked", data: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // Get current permission status
  ipcMain.handle(SKILL_GET_PERMISSION_STATUS, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ skillName: string }>(args);
    const nameError = validateString(data?.skillName, "skillName");
    if (nameError) return { status: false, msg: nameError, data: null };
    try {
      const permissionStatus = SkillPermissionService.getPermissionStatus(
        data.skillName
      );
      return {
        status: true,
        msg: "Status retrieved",
        data: { permissionStatus },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // ---------------------------------------------------------------------------
  // Skill Import & Management Handlers
  // ---------------------------------------------------------------------------

  // Import skill from zip file
  ipcMain.handle(SKILL_IMPORT, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ zipPath: string }>(args);
    const pathError = validateString(data?.zipPath, "zipPath", 4096);
    if (pathError) return { status: false, msg: pathError, data: null };
    try {
      const result = await SkillImportService.importFromZip(data.zipPath);
      if (result.success) {
        return {
          status: true,
          msg: `Skill "${result.name}" imported successfully`,
          data: { name: result.name },
        };
      }
      return { status: false, msg: result.error, data: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // List all installed skills
  ipcMain.handle(SKILL_LIST_INSTALLED, async () => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    try {
      const module = new SkillManagementModule();
      const skills = await module.listInstalledSkills();
      return {
        status: true,
        msg: "Skills retrieved",
        data: { skills },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // Toggle skill enabled/disabled
  ipcMain.handle(SKILL_TOGGLE, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ skillName: string; enabled: boolean }>(args);
    const nameError = validateString(data?.skillName, "skillName");
    if (nameError) return { status: false, msg: nameError, data: null };
    if (typeof data?.enabled !== "boolean") {
      return { status: false, msg: "enabled must be a boolean", data: null };
    }
    try {
      const module = new SkillManagementModule();
      const success = await module.toggleSkill(data.skillName, data.enabled);

      // Update registry to reflect enabled/disabled state
      if (success && !data.enabled) {
        // Unregister disabled skill from runtime
        const { SkillRegistry } = await import("@/config/skillsRegistry");
        SkillRegistry.unregisterSkill(data.skillName);
      }

      return {
        status: true,
        msg: success ? "Skill toggled" : "Skill not found",
        data: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });

  // Uninstall a skill
  ipcMain.handle(SKILL_UNINSTALL, async (...args: unknown[]) => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    const data = extractData<{ skillName: string }>(args);
    try {
      const module = new SkillManagementModule();
      const success = await module.uninstallSkill(data.skillName);

      // Unregister from runtime
      if (success) {
        const { SkillRegistry } = await import("@/config/skillsRegistry");
        SkillRegistry.unregisterSkill(data.skillName);

        // Clean up skill files from disk
        try {
          const skillsDir = path.join(
            app.getPath("userData"),
            "installed_skills",
            data.skillName
          );
          if (fs.existsSync(skillsDir)) {
            fs.rmSync(skillsDir, { recursive: true, force: true });
          }
        } catch (cleanupError) {
          console.warn(
            `[SkillsIPC] Failed to clean up skill files for "${
              data.skillName
            }": ${
              cleanupError instanceof Error
                ? cleanupError.message
                : cleanupError
            }`
          );
        }
      }

      return {
        status: true,
        msg: success ? "Skill uninstalled" : "Skill not found",
        data: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { status: false, msg: message, data: null };
    }
  });
}
