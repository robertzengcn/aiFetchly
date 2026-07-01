/**
 * Skills IPC handlers — permission management and skill import for skill execution.
 *
 * All 10 handlers migrated to registerAiValidatedHandler (centralizes the
 * USER_AI_ENABLED check that was previously a per-handler checkAiEnabled()).
 *
 * Handles:
 * - SKILL_CHECK_PERMISSION / GRANT / DENY / REVOKE / GET_STATUS: by skillName
 * - SKILL_IMPORT: zipPath
 * - SKILL_LIST_INSTALLED: no input
 * - SKILL_TOGGLE: skillName + enabled
 * - SKILL_UNINSTALL: skillName
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
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
import { registerAiValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  skillByNameInputSchema,
  skillGrantPermissionInputSchema,
  skillToggleInputSchema,
  skillImportInputSchema,
  skillListInstalledInputSchema,
} from "@/schemas/ipc/skills";

export function registerSkillsIpcHandlers(): void {
  console.log("Skills IPC handlers registered");

  registerAiValidatedHandler(
    SKILL_CHECK_PERMISSION,
    skillByNameInputSchema,
    async (input) => {
      const result = SkillPermissionService.checkPermission(input.skillName);
      return {
        allowed: result.allowed,
        needsPrompt: result.needsPrompt,
        reason: result.reason,
      };
    },
  );

  registerAiValidatedHandler(
    SKILL_GRANT_PERMISSION,
    skillGrantPermissionInputSchema,
    async (input) => {
      SkillPermissionService.grantPermission(input.skillName, input.persistent);
      return null;
    },
  );

  registerAiValidatedHandler(
    SKILL_DENY_PERMISSION,
    skillByNameInputSchema,
    async (input) => {
      SkillPermissionService.denyPermission(input.skillName);
      return null;
    },
  );

  registerAiValidatedHandler(
    SKILL_REVOKE_PERMISSION,
    skillByNameInputSchema,
    async (input) => {
      SkillPermissionService.revokePermission(input.skillName);
      return null;
    },
  );

  registerAiValidatedHandler(
    SKILL_GET_PERMISSION_STATUS,
    skillByNameInputSchema,
    async (input) => {
      const permissionStatus = SkillPermissionService.getPermissionStatus(input.skillName);
      return { permissionStatus };
    },
  );

  registerAiValidatedHandler(
    SKILL_IMPORT,
    skillImportInputSchema,
    async (input) => {
      const result = await SkillImportService.importFromZip(input.zipPath);
      if (!result.success) {
        throw new Error(result.error || "Skill import failed");
      }
      return { name: result.name };
    },
  );

  registerAiValidatedHandler(
    SKILL_LIST_INSTALLED,
    skillListInstalledInputSchema,
    async () => {
      const module = new SkillManagementModule();
      const skills = await module.listInstalledSkills();
      return { skills };
    },
  );

  registerAiValidatedHandler(
    SKILL_TOGGLE,
    skillToggleInputSchema,
    async (input) => {
      const module = new SkillManagementModule();
      const success = await module.toggleSkill(input.skillName, input.enabled);
      if (success && !input.enabled) {
        // Unregister disabled skill from runtime
        const { SkillRegistry } = await import("@/config/skillsRegistry");
        SkillRegistry.unregisterSkill(input.skillName);
      }
      if (!success) {
        throw new Error("Skill not found");
      }
      return null;
    },
  );

  registerAiValidatedHandler(
    SKILL_UNINSTALL,
    skillByNameInputSchema,
    async (input) => {
      const module = new SkillManagementModule();
      const success = await module.uninstallSkill(input.skillName);
      if (success) {
        const { SkillRegistry } = await import("@/config/skillsRegistry");
        SkillRegistry.unregisterSkill(input.skillName);
        // Clean up skill files from disk (best-effort)
        try {
          const skillsDir = path.join(
            app.getPath("userData"),
            "installed_skills",
            input.skillName,
          );
          if (fs.existsSync(skillsDir)) {
            fs.rmSync(skillsDir, { recursive: true, force: true });
          }
        } catch (cleanupError) {
          console.warn(
            `[SkillsIPC] Failed to clean up skill files for "${input.skillName}": ${
              cleanupError instanceof Error ? cleanupError.message : cleanupError
            }`,
          );
        }
      }
      if (!success) {
        throw new Error("Skill not found");
      }
      return null;
    },
  );
}
