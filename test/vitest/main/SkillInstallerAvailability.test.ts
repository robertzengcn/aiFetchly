/**
 * Installer availability + entry-point routing (FR-28 / design §8.7):
 * while the feature flag is enabled, skill_install_prepare is ALWAYS loaded
 * — the model never needs tool_catalog_search to discover it — and the
 * routing decision names it as the allowed entry point for explicit install
 * intent, with substitutes blocked at the loop layer.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ToolLoadPolicyService } from "@/service/ToolLoadPolicyService";
import { classifySkillRequestIntent } from "@/service/SkillInstallIntentGuard";
import { SkillRegistry } from "@/config/skillsRegistry";
import type { OpenAITool } from "@/api/aiChatApi";

const FLAG = "AIFETCHLY_SKILL_INSTALL_ENABLED";

// The registry imports execute handlers lazily; loading it without Electron
// works in the main-process test environment.
process.env[FLAG] = "true";

beforeEach(() => {
  process.env[FLAG] = "true";
});

afterEach(() => {
  delete process.env[FLAG];
});

function toolNamed(name: string): OpenAITool {
  return {
    type: "function",
    function: {
      name,
      description: "",
      parameters: { type: "object", properties: {} },
    },
  };
}

describe("installer tool availability under the feature flag", () => {
  const policy = new ToolLoadPolicyService();
  const context = {
    conversationId: "conv-avail",
    currentUserMessage: "",
    isPlanMode: false,
    autoPlanEnabled: false,
    uploadedFileTypes: [],
  };

  it("skill_install_prepare is classified always (no catalog search needed)", () => {
    expect(
      policy.classify({
        tool: toolNamed("skill_install_prepare"),
        source: "builtin",
        context,
      })
    ).toBe("always");
    expect(
      policy.classify({
        tool: toolNamed("skill_install_status"),
        source: "builtin",
        context,
      })
    ).toBe("always");
  });

  it("the registry exposes the full installer tool surface", async () => {
    const names = (await SkillRegistry.getAllToolFunctions()).map((t) => t.name);
    expect(names).toContain("skill_install_prepare");
    expect(names).toContain("skill_install_approve");
    expect(names).toContain("skill_install_status");
    expect(names).toContain("skill_install_cancel");
  });

  it("explicit install intent names skill_install_prepare as the entry point", () => {
    const decision = classifySkillRequestIntent(
      "Set up https://github.com/browser-use/video-use for me"
    );
    expect(decision.allowedEntryPoint).toBe("skill_install_prepare");
    expect(decision.policyVersion).toBe(1);
  });
});
