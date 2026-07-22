import { describe, expect, it } from "vitest";
import {
  ConversationToolStateService,
  buildDeferredAnnouncementDelta,
} from "@/service/ConversationToolStateService";
import { ToolCatalogService } from "@/service/ToolCatalogService";
import type { OpenAITool } from "@/api/aiChatApi";
import type {
  ToolCatalog,
  ToolCatalogRuntimeContext,
} from "@/entityTypes/toolCatalogTypes";

function tool(name: string, desc = "d"): OpenAITool {
  return {
    type: "function",
    function: {
      name,
      description: desc,
      parameters: { type: "object", properties: {} },
    },
  };
}

const ctx: ToolCatalogRuntimeContext = {
  conversationId: "c1",
  isPlanMode: false,
  autoPlanEnabled: false,
  currentUserMessage: "",
  uploadedFileTypes: [],
};

function catalogOf(tools: OpenAITool[]): ToolCatalog {
  return new ToolCatalogService().buildFromOpenAITools({ tools, context: ctx });
}

describe("buildDeferredAnnouncementDelta (pure)", () => {
  it("announces all deferred tools when none were announced before", () => {
    const catalog = catalogOf([tool("mcp_1_a", "alpha tool"), tool("mcp_1_b")]);
    const delta = buildDeferredAnnouncementDelta({
      previousAnnounced: [],
      catalog,
    });
    expect(delta.addedNames).toEqual(
      expect.arrayContaining(["mcp_1_a", "mcp_1_b"])
    );
    expect(delta.removedNames).toEqual([]);
    const alphaLine = delta.addedLines.find((l) => l.startsWith("mcp_1_a"));
    expect(alphaLine).toContain("[mcp]");
    expect(alphaLine).toContain("alpha tool");
  });

  it("does not re-announce previously announced tools", () => {
    const catalog = catalogOf([tool("mcp_1_a"), tool("mcp_1_b")]);
    const delta = buildDeferredAnnouncementDelta({
      previousAnnounced: ["mcp_1_a"],
      catalog,
    });
    expect(delta.addedNames).toEqual(["mcp_1_b"]);
  });

  it("reports removed names that are no longer deferred", () => {
    const catalog = catalogOf([tool("mcp_1_a")]);
    const delta = buildDeferredAnnouncementDelta({
      previousAnnounced: ["mcp_1_a", "mcp_1_gone"],
      catalog,
    });
    expect(delta.removedNames).toEqual(["mcp_1_gone"]);
    expect(delta.addedNames).toEqual([]);
  });

  it("caps description length in announcement lines", () => {
    const catalog = catalogOf([tool("mcp_1_a", "x".repeat(500))]);
    const delta = buildDeferredAnnouncementDelta({
      previousAnnounced: [],
      catalog,
      shortDescriptionChars: 20,
    });
    expect(delta.addedLines[0].length).toBeLessThan(60);
  });
});

describe("ConversationToolStateService snapshot conversion (pure)", () => {
  it("converts a snapshot to view fields and back", () => {
    const svc = new ConversationToolStateService();
    const snap = {
      discoveredToolNames: ["mcp_1_b", "mcp_1_a"],
      announcedDeferredNames: [],
    };
    const view = svc.snapshotToView("conv-x", snap);
    expect(view.conversationId).toBe("conv-x");
    expect(view.discoveredToolNames).toEqual(["mcp_1_b", "mcp_1_a"]);
    expect(view.announcedDeferredToolNames).toEqual([]);
  });
});
