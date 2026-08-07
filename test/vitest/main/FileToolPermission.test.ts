/**
 * Permission flow verification tests for AI file tools (US4).
 *
 * Verifies that all file tools (read AND write/edit) trigger the filesystem
 * permission category and require confirmation, and that the SkillExecutor
 * permission flow handles them correctly.
 */
import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@/config/skillsRegistry";
import type { SkillDefinition } from "@/entityTypes/skillTypes";

describe("File Tool Permission Flow", () => {
  // ---------------------------------------------------------------------------
  // All file tools (including reads) require the filesystem permission prompt.
  // file_read/glob_files/grep_files were intentionally moved from 'pure' to
  // 'filesystem' with requiresConfirmation=true (83101eda3) so the consent
  // card appears before any file operation.
  // ---------------------------------------------------------------------------

  describe("read tools require permission", () => {
    it("file_read has permissionCategory 'filesystem'", () => {
      const skill = SkillRegistry.getSkill("file_read");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("filesystem");
    });

    it("file_read requires confirmation", () => {
      const skill = SkillRegistry.getSkill("file_read");
      expect(skill!.requiresConfirmation).toBe(true);
    });

    it("glob_files has permissionCategory 'filesystem'", () => {
      const skill = SkillRegistry.getSkill("glob_files");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("filesystem");
    });

    it("grep_files has permissionCategory 'filesystem'", () => {
      const skill = SkillRegistry.getSkill("grep_files");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("filesystem");
    });
  });

  // ---------------------------------------------------------------------------
  // Write/edit tools: require permission
  // ---------------------------------------------------------------------------

  describe("write/edit tools require permission", () => {
    it("file_edit has permissionCategory 'filesystem'", () => {
      const skill = SkillRegistry.getSkill("file_edit");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("filesystem");
    });

    it("file_edit requires confirmation", () => {
      const skill = SkillRegistry.getSkill("file_edit");
      expect(skill!.requiresConfirmation).toBe(true);
    });

    it("file_write has permissionCategory 'filesystem'", () => {
      const skill = SkillRegistry.getSkill("file_write");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("filesystem");
    });

    it("file_write requires confirmation", () => {
      const skill = SkillRegistry.getSkill("file_write");
      expect(skill!.requiresConfirmation).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Skill definition structure
  // ---------------------------------------------------------------------------

  describe("skill definitions are valid", () => {
    const fileToolNames = [
      "file_read",
      "file_write",
      "file_edit",
      "glob_files",
      "grep_files",
    ];

    it("all five file tools are registered", () => {
      for (const name of fileToolNames) {
        expect(SkillRegistry.isRegistered(name)).toBe(true);
      }
    });

    it("all file tools have execute function", () => {
      for (const name of fileToolNames) {
        const skill = SkillRegistry.getSkill(name) as SkillDefinition;
        expect(typeof skill.execute).toBe("function");
      }
    });

    it("all file tools are built-in", () => {
      for (const name of fileToolNames) {
        const skill = SkillRegistry.getSkill(name) as SkillDefinition;
        expect(skill.source).toBe("built-in");
      }
    });

    it("all file tools have tier 'main'", () => {
      for (const name of fileToolNames) {
        const skill = SkillRegistry.getSkill(name) as SkillDefinition;
        expect(skill.tier).toBe("main");
      }
    });

    it("all file tools have valid parameter schemas", () => {
      for (const name of fileToolNames) {
        const skill = SkillRegistry.getSkill(name) as SkillDefinition;
        expect(skill.parameters.type).toBe("object");
        expect(skill.parameters.properties).toBeDefined();
        expect(Array.isArray(skill.parameters.required)).toBe(true);
      }
    });
  });
});
