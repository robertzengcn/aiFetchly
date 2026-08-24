/**
 * Tests for the universal use_skill / skill_resource_* tools and the
 * resource-confinement rules (design §10.4, §10.8; PRD §14.4, FR-21).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SkillRegistry } from "@/config/skillsRegistry";
import {
  listSkillResources,
  readSkillResource,
} from "@/service/PromptSkillResourceService";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import { ToolLoadPolicyService } from "@/service/ToolLoadPolicyService";
import type { PromptSkillDefinition } from "@/entityTypes/promptSkillTypes";

// use_skill resolves the conversation workspace scope through the shared
// context service; a missing workspace degrades to "" (the skill still
// loads — only the workspace header line is affected).
vi.mock("@/modules/WorkspaceModule", () => {
  const getActiveWorkspace = vi.fn().mockResolvedValue(null);
  return {
    WorkspaceModule: vi.fn().mockImplementation(() => ({
      getActiveWorkspace,
    })),
  };
});

const SKILL_MD =
  "---\nname: video-use\ndescription: Edit videos\n---\n\n# Usage\n\nSee helpers/cut.py.";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

let root: string;
let definition: PromptSkillDefinition;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ps-tools-"));
  fs.writeFileSync(path.join(root, "SKILL.md"), SKILL_MD);
  fs.mkdirSync(path.join(root, "helpers"), { recursive: true });
  fs.writeFileSync(path.join(root, "helpers", "cut.py"), "print('cut')");
  fs.writeFileSync(path.join(root, "helpers", "notes.md"), "# notes");
  definition = {
    runtimeId: "prompt:user:video-use-install",
    installationId: "video-use-install",
    sourceId: "user",
    scope: "user",
    name: "video-use",
    description: "Edit videos",
    canonicalRoot: root,
    skillMarkdownPath: path.join(root, "SKILL.md"),
    contentHash: sha256(SKILL_MD),
    manifest: {
      schemaVersion: 1,
      name: "video-use",
      description: "Edit videos",
      unknownFields: {},
    },
    enabled: true,
  };
  getDefaultPromptSkillCatalog().replaceSource("user", [definition]);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  getDefaultPromptSkillCatalog().replaceSource("user", []);
});

describe("skillsRegistry prompt-skill tools", () => {
  it("registers use_skill, skill_resource_list, skill_resource_read", async () => {
    const all = await SkillRegistry.getAllToolFunctions();
    const names = all.map((t) => t.name);
    expect(names).toContain("use_skill");
    expect(names).toContain("skill_resource_list");
    expect(names).toContain("skill_resource_read");
  });

  it("use_skill execute returns a short ack and carries the hidden attachment", async () => {
    const skill = SkillRegistry.getSkill("use_skill");
    expect(skill).not.toBeNull();
    const outcome = await skill!.execute(
      { skill: "video-use" },
      {
        conversationId: "conv-tools",
        toolCallId: "tc-1",
      } as never
    );
    expect(outcome.success).toBe(true);
    expect(outcome.result.status).toBe("loaded");
    expect(outcome.result.runtimeId).toBe(definition.runtimeId);
    expect((outcome.result as Record<string, unknown>).normalizedInstructions)
      .toBeUndefined();
    // The attachment rides as a TRANSIENT SIBLING, never inside result.
    expect(outcome.promptSkillContext).toBeDefined();
    expect(outcome.promptSkillContext?.normalizedInstructions).toContain(
      "<invoked_prompt_skill"
    );
  });

  it("use_skill rejects install/update requests", async () => {
    const skill = SkillRegistry.getSkill("use_skill");
    const outcome = await skill!.execute(
      { skill: "video-use", arguments: "update this skill" },
      { conversationId: "conv-tools", toolCallId: "tc-2" } as never
    );
    expect(outcome.success).toBe(false);
    expect(outcome.result.code).toBe("SKILL_INSTALL_MUTATION_REJECTED");
  });
});

describe("skill resource confinement", () => {
  it("lists helper files under the skill root", async () => {
    const outcome = await listSkillResources(
      definition.runtimeId,
      "helpers"
    );
    expect(outcome.success).toBe(true);
    const files = outcome.result.files as { path: string }[];
    expect(files.map((f) => f.path)).toContain("cut.py");
  });

  it("reads a helper file with a content hash", async () => {
    const outcome = await readSkillResource(
      definition.runtimeId,
      "helpers/cut.py"
    );
    expect(outcome.success).toBe(true);
    expect(outcome.result.content).toContain("print('cut')");
    expect(outcome.result.contentHash).toHaveLength(64);
  });

  it("rejects absolute paths", async () => {
    const outcome = await readSkillResource(
      definition.runtimeId,
      path.join(root, "helpers", "cut.py")
    );
    expect(outcome.success).toBe(false);
  });

  it("rejects traversal outside the skill root", async () => {
    const outcome = await readSkillResource(
      definition.runtimeId,
      "../../etc/passwd"
    );
    expect(outcome.success).toBe(false);
    expect(String(outcome.result.error)).toContain("escape");
  });

  it("rejects unknown runtime ids (no sibling-skill access)", async () => {
    const outcome = await readSkillResource("prompt:user:other", "SKILL.md");
    expect(outcome.success).toBe(false);
    expect(String(outcome.result.error)).toContain("Unknown prompt skill");
  });

  it("rejects symlinked helpers that escape the root", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    try {
      const secretFile = path.join(outside, "secret.txt");
      fs.writeFileSync(secretFile, "s3cret");
      fs.symlinkSync(secretFile, path.join(root, "helpers", "leak.txt"));
      const outcome = await readSkillResource(
        definition.runtimeId,
        "helpers/leak.txt"
      );
      expect(outcome.success).toBe(false);
      expect(String(outcome.result.error)).toContain("escape");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects binary-looking content", async () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03]);
    fs.writeFileSync(path.join(root, "helpers", "blob.bin"), binary);
    const outcome = await readSkillResource(
      definition.runtimeId,
      "helpers/blob.bin"
    );
    expect(outcome.success).toBe(false);
    expect(String(outcome.result.error)).toContain("binary");
  });
});

describe("ToolLoadPolicyService prompt-skill tools", () => {
  type OpenAITool = import("@/api/aiChatApi").OpenAITool;
  const policy = new ToolLoadPolicyService();
  const baseContext = {
    conversationId: "conv-policy",
    currentUserMessage: "",
    isPlanMode: false,
    autoPlanEnabled: false,
    uploadedFileTypes: [],
  };

  it("classifies use_skill and resource tools as always loaded", () => {
    for (const name of [
      "use_skill",
      "skill_resource_list",
      "skill_resource_read",
    ]) {
      const tool: OpenAITool = {
        type: "function",
        function: {
          name,
          description: "",
          parameters: { type: "object", properties: {} },
        },
      };
      expect(
        policy.classify({ tool, source: "builtin", context: baseContext })
      ).toBe("always");
    }
  });
});
