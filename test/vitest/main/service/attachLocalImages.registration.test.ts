import { describe, expect, it } from "vitest";
import { SkillRegistry } from "@/config/skillsRegistry";

describe("attach_local_images registration", () => {
  it("is registered as a built-in main/filesystem skill", () => {
    const skill = SkillRegistry.getSkill("attach_local_images");
    expect(skill).not.toBeNull();
    expect(skill?.tier).toBe("main");
    expect(skill?.permissionCategory).toBe("filesystem");
    expect(skill?.requiresConfirmation).toBe(true);
    expect(skill?.source).toBe("built-in");
    expect(skill?.timeoutClass).toBe("fast");
    expect(typeof skill?.execute).toBe("function");
    expect(typeof skill?.buildPermissionPreview).toBe("function");
  });

  it("enforces 1-3 unique paths in the schema", () => {
    const skill = SkillRegistry.getSkill("attach_local_images");
    const params = skill?.parameters as Record<string, unknown>;
    const paths = params.properties?.paths as Record<string, unknown>;
    expect(paths.minItems).toBe(1);
    expect(paths.maxItems).toBe(3);
    expect(paths.uniqueItems).toBe(true);
    expect(params.required).toEqual(["paths"]);
    expect(params.additionalProperties).toBe(false);
  });

  it("is enabled for the runtime", async () => {
    expect(
      await SkillRegistry.isSkillEnabledForRuntime("attach_local_images")
    ).toBe(true);
  });

  it("exposes a valid vision detail enum", () => {
    const skill = SkillRegistry.getSkill("attach_local_images");
    const params = skill?.parameters as Record<string, unknown>;
    const detail = params.properties?.detail as Record<string, unknown>;
    expect(detail.enum).toEqual(["auto", "low", "high"]);
    expect(detail.default).toBe("auto");
  });
});
