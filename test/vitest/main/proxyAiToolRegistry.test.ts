import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@/config/skillsRegistry";

const PROXY_TOOLS = [
  "proxy_list",
  "proxy_get",
  "proxy_create",
  "proxy_update",
  "proxy_delete",
  "proxy_import",
  "proxy_check",
  "proxy_remove_failed",
] as const;

describe("proxy AI tool registry", () => {
  it("registers all 8 proxy tools as built-in skills", () => {
    for (const name of PROXY_TOOLS) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill, `expected ${name} to be registered`).toBeDefined();
      expect(skill?.source).toBe("built-in");
      expect(skill?.tier).toBe("main");
    }
  });

  it("classifies read-only tools as pure with no confirmation", () => {
    for (const name of ["proxy_list", "proxy_get"] as const) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill?.permissionCategory).toBe("pure");
      expect(skill?.requiresConfirmation).toBe(false);
    }
  });

  it("classifies mutating/check/cleanup tools as automation with confirmation", () => {
    for (const name of [
      "proxy_create",
      "proxy_update",
      "proxy_delete",
      "proxy_import",
      "proxy_check",
      "proxy_remove_failed",
    ] as const) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill?.permissionCategory).toBe("automation");
      expect(skill?.requiresConfirmation).toBe(true);
    }
  });

  it("marks proxy_check with a network timeout class", () => {
    const skill = SkillRegistry.getSkill("proxy_check");
    expect(skill?.timeoutClass).toBe("network");
  });

  it("exposes JSON-schema parameters for every proxy tool", () => {
    for (const name of PROXY_TOOLS) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill?.parameters).toBeTypeOf("object");
      expect((skill?.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("does not echo credentials in tool descriptions", () => {
    for (const name of PROXY_TOOLS) {
      const skill = SkillRegistry.getSkill(name);
      // Descriptions explain that passwords are NOT returned; they must not
      // promise to reveal them.
      expect(skill?.description.toLowerCase()).not.toContain("returns the password");
    }
  });
});
