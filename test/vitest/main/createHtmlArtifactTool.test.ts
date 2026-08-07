/**
 * Tests for the built-in `create_html_artifact` skill registration and its
 * execute() path. The Model is spied so no real DB is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SkillRegistry } from "@/config/skillsRegistry";
import { AIArtifactModule } from "@/modules/AIArtifactModule";
import type { AIArtifactRecord } from "@/entityTypes/aiArtifactTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

const TOOL_NAME = "create_html_artifact";

function makeContext(
  conversationId: string
): SkillExecutionContext {
  return {
    conversationId,
    toolCallId: "call-test",
  };
}

describe("create_html_artifact skill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is registered as a built-in skill with pure permission", () => {
    const skill = SkillRegistry.getSkill(TOOL_NAME);
    expect(skill).not.toBeNull();
    expect(skill?.source).toBe("built-in");
    expect(skill?.permissionCategory).toBe("pure");
    expect(skill?.requiresConfirmation).toBe(false);
    expect(skill?.description).toMatch(/main content area/i);
  });

  it("returns artifact metadata without HTML content on success", async () => {
    const fake: AIArtifactRecord = {
      id: "artifact-abc",
      conversationId: "v2-conv",
      type: "html",
      title: "Report",
      description: "desc",
      mimeType: "text/html",
      content: "<p>should not leak</p>",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const spy = vi
      .spyOn(AIArtifactModule.prototype, "createHtmlArtifact")
      .mockResolvedValue(fake);

    const skill = SkillRegistry.getSkill(TOOL_NAME)!;
    const res = await skill.execute(
      { title: "Report", html: "<p>hi</p>" },
      makeContext("v2-conv")
    );

    expect(res.success).toBe(true);
    const result = res.result as {
      artifact?: { id: string; content?: string };
    };
    expect(result.artifact?.id).toBe("artifact-abc");
    // Critical: the tool result must NOT carry the full HTML content.
    expect(result.artifact).not.toHaveProperty("content");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "v2-conv",
        title: "Report",
      })
    );
  });

  it("fails when the conversation id is missing", async () => {
    const skill = SkillRegistry.getSkill(TOOL_NAME)!;
    const res = await skill.execute(
      { title: "Report", html: "<p>hi</p>" },
      makeContext("")
    );
    expect(res.success).toBe(false);
    expect((res.result as { error?: string }).error).toMatch(/conversation/i);
  });

  it("fails on invalid HTML (script) without persisting", async () => {
    const spy = vi
      .spyOn(AIArtifactModule.prototype, "createHtmlArtifact")
      .mockResolvedValue({} as AIArtifactRecord);

    const skill = SkillRegistry.getSkill(TOOL_NAME)!;
    const res = await skill.execute(
      { title: "Report", html: "<script>alert(1)</script>" },
      makeContext("v2-conv")
    );
    expect(res.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
