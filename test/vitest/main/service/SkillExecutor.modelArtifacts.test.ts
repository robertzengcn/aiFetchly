import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock heavy / external collaborators before importing SkillExecutor.
vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: { execute: vi.fn().mockResolvedValue({ results: [] }) },
}));
vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: vi.fn().mockImplementation(() => ({
    getEnabledMCPToolsAsFunctions: vi.fn().mockResolvedValue([]),
  })),
}));
const tokenStore: Record<string, string> = {};
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn((key: string) => tokenStore[key] || ""),
    setValue: vi.fn((key: string, value: string) => {
      tokenStore[key] = value;
    }),
  })),
}));

import { SkillExecutor } from "@/service/SkillExecutor";
import { SkillRegistry } from "@/config/skillsRegistry";
import type {
  SkillDefinition,
  SkillExecutionContext,
} from "@/entityTypes/skillTypes";
import type { ImageModelArtifact } from "@/entityTypes/aiImageAttachmentToolTypes";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { setHookAuditLoggerForTests } from "@/service/hooks/HookAuditService";

const ARTIFACT: ImageModelArtifact = {
  kind: "image",
  fileName: "a.png",
  relativePath: "a.png",
  mimeType: "image/png",
  sizeBytes: 100,
  width: 64,
  height: 64,
  sha256: "abc",
  detail: "auto",
  dataUrl: "data:image/png;base64,SECRETBYTES",
};

function baseContext(): SkillExecutionContext {
  return {
    conversationId: "conv-x",
    toolCallId: "call-x",
  };
}

describe("SkillExecutor modelArtifacts + permissionPreview threading", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
    setHookAuditLoggerForTests({ log: () => undefined });
    for (const key of Object.keys(tokenStore)) delete tokenStore[key];
  });
  afterEach(() => {
    SkillRegistry.unregisterSkill("test_pure_image_attach");
    SkillRegistry.unregisterSkill("test_fs_image_attach");
  });

  it("threads modelArtifacts from skill.execute onto the ToolExecutionResult", async () => {
    const skill: SkillDefinition = {
      name: "test_pure_image_attach",
      description: "test",
      parameters: { type: "object", properties: {} },
      tier: "main",
      requiresConfirmation: false,
      permissionCategory: "pure",
      source: "built-in",
      execute: async () => ({
        success: true,
        result: { attached_count: 1, summary: "ok" },
        modelArtifacts: [ARTIFACT],
      }),
    };
    SkillRegistry.registerSkill(skill);

    const result = await SkillExecutor.execute(
      "test_pure_image_attach",
      {},
      baseContext()
    );

    expect(result.success).toBe(true);
    // modelArtifacts surfaced as a top-level sibling of `result`.
    expect(result.modelArtifacts).toEqual([ARTIFACT]);
    // The persisted/emitted `result` carries metadata only — no artifact bytes.
    expect(result.result).not.toHaveProperty("modelArtifacts");
    expect(JSON.stringify(result.result)).not.toContain("data:image/");
    expect(JSON.stringify(result.result)).not.toContain("SECRETBYTES");
  });

  it("omits modelArtifacts when the skill returns none", async () => {
    const skill: SkillDefinition = {
      name: "test_pure_image_attach",
      description: "test",
      parameters: { type: "object", properties: {} },
      tier: "main",
      requiresConfirmation: false,
      permissionCategory: "pure",
      source: "built-in",
      execute: async () => ({ success: true, result: { ok: true } }),
    };
    SkillRegistry.registerSkill(skill);

    const result = await SkillExecutor.execute(
      "test_pure_image_attach",
      {},
      baseContext()
    );
    expect(result.success).toBe(true);
    expect(result.modelArtifacts).toBeUndefined();
  });

  it("attaches a metadata-only permissionPreview to the deferred prompt result", async () => {
    const skill: SkillDefinition = {
      name: "test_fs_image_attach",
      description: "test",
      parameters: { type: "object", properties: {} },
      tier: "main",
      requiresConfirmation: true,
      permissionCategory: "filesystem",
      source: "built-in",
      execute: async () => ({ success: true, result: {} }),
      buildPermissionPreview: (args) => {
        const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
        return {
          kind: "file_transfer",
          titleKey: "aiChatV2.imageTool.permissionTitle",
          descriptionKey: "aiChatV2.imageTool.permissionDescription",
          items: paths,
          destinationLabel: "Configured AI Server",
        };
      },
    };
    SkillRegistry.registerSkill(skill);

    const result = await SkillExecutor.execute(
      "test_fs_image_attach",
      { paths: ["products/a.png", "products/b.png"] },
      baseContext()
    );

    // Filesystem skill with no prior approval → deferred prompt.
    expect(result.success).toBe(false);
    expect(result.result.needsPermissionPrompt).toBe(true);
    expect(result.result.permissionPreview).toMatchObject({
      kind: "file_transfer",
      items: ["products/a.png", "products/b.png"],
      destinationLabel: "Configured AI Server",
    });
    // No artifacts leak on the deferred path.
    expect(result.modelArtifacts).toBeUndefined();
  });

  it("omits permissionPreview when the skill declares no builder", async () => {
    const skill: SkillDefinition = {
      name: "test_fs_image_attach",
      description: "test",
      parameters: { type: "object", properties: {} },
      tier: "main",
      requiresConfirmation: true,
      permissionCategory: "filesystem",
      source: "built-in",
      execute: async () => ({ success: true, result: {} }),
    };
    SkillRegistry.registerSkill(skill);

    const result = await SkillExecutor.execute(
      "test_fs_image_attach",
      { paths: ["a.png"] },
      baseContext()
    );
    expect(result.result.needsPermissionPrompt).toBe(true);
    expect(result.result.permissionPreview).toBeUndefined();
  });
});
