import { describe, expect, it } from "vitest";
import { buildBuiltInToolCapabilitiesSection } from "@/service/BuiltInToolCapabilitiesPromptSection";
import { ToolLoadPolicyService } from "@/service/ToolLoadPolicyService";
import type { OpenAITool } from "@/api/aiChatApi";
import type {
  ToolCatalogRuntimeContext,
  ToolCatalogSource,
} from "@/entityTypes/toolCatalogTypes";

function tool(name: string): OpenAITool {
  return {
    type: "function",
    function: { name, description: "d", parameters: { type: "object" } },
  };
}

const baseCtx: ToolCatalogRuntimeContext = {
  conversationId: "c1",
  isPlanMode: false,
  autoPlanEnabled: false,
  currentUserMessage: "",
  uploadedFileTypes: [],
};

function classify(
  name: string,
  source: ToolCatalogSource,
  ctxOverrides: Partial<ToolCatalogRuntimeContext> = {}
): string {
  const svc = new ToolLoadPolicyService();
  return svc.classify({
    tool: tool(name),
    source,
    context: { ...baseCtx, ...ctxOverrides },
  });
}

/**
 * Generated-image edit routing: since selected generated images arrive
 * attached to the current user turn, neither the system-prompt capability
 * table nor the tool-load policy may route those edits through
 * export_generated_artifacts + attach_local_images (the obsolete workspace
 * round-trip). Workspace-file behavior must remain untouched.
 */
describe("generated image prompt routing", () => {
  describe("BuiltInToolCapabilitiesPromptSection", () => {
    it("no longer contains the obsolete export+attach workflow row", () => {
      const s = buildBuiltInToolCapabilitiesSection();
      expect(s).not.toContain("export_generated_artifacts` (copy");
      expect(s).not.toContain(
        "then `attach_local_images` with the workspace path"
      );
      expect(s).not.toContain("aifetchly-generated-image://");
    });

    it("tells the model generated images arrive attached with no workspace needed", () => {
      const s = buildBuiltInToolCapabilitiesSection();
      const lower = s.toLowerCase();
      expect(lower).toContain("attached to the current user turn");
      expect(lower).toContain("no workspace");
    });

    it("keeps export_generated_artifacts only for explicit save/copy requests", () => {
      const s = buildBuiltInToolCapabilitiesSection();
      expect(s).toContain("`export_generated_artifacts`");
      const lower = s.toLowerCase();
      expect(lower).toContain("save/copy/materialize");
      expect(lower).toContain("explicitly asks");
    });
  });

  describe("ToolLoadPolicyService", () => {
    it("does NOT promote attach/export tools for a follow-up edit on recent generated images", () => {
      const ctx = {
        currentUserMessage: "make it brighter",
        hasRecentGeneratedImages: true,
      };
      expect(classify("attach_local_images", "builtin", ctx)).toBe("deferred");
      expect(
        classify("export_generated_artifacts", "builtin", ctx)
      ).toBe("deferred");
    });

    it("does NOT promote attach/export tools for verb-only edit phrasings either", () => {
      const ctx = {
        currentUserMessage: "please add tree in front of the house",
        hasRecentGeneratedImages: true,
      };
      expect(classify("attach_local_images", "builtin", ctx)).toBe("deferred");
      expect(
        classify("export_generated_artifacts", "builtin", ctx)
      ).toBe("deferred");
    });

    it("still promotes attach_local_images for workspace-file image intent", () => {
      // IMAGE_ATTACH_INTENT_RE path must remain untouched by this change.
      expect(
        classify("attach_local_images", "builtin", {
          currentUserMessage: "edit the logo.png in my project",
          hasRecentGeneratedImages: false,
        })
      ).toBe("contextual");
    });

    it("still defers attach_local_images and prefers batch for plural workspace scope", () => {
      // Batch-intent deferral logic (~L332-339) must be preserved.
      const currentUserMessage =
        "please modify the background color of those images in the workspace to white";
      expect(
        classify("attach_local_images", "builtin", { currentUserMessage })
      ).toBe("deferred");
      expect(
        classify("process_artifact_batch", "builtin", { currentUserMessage })
      ).toBe("contextual");
    });

    it("still promotes export_generated_artifacts for explicit workspace save intent", () => {
      // CONTEXTUAL_FILE_WRITE_TOOL_NAMES / export-for-save behavior preserved.
      expect(
        classify("export_generated_artifacts", "builtin", {
          currentUserMessage: "save the generated files into my workspace",
          hasRecentGeneratedImages: true,
        })
      ).toBe("contextual");
    });
  });
});
