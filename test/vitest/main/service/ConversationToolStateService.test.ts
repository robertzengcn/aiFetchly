import { describe, expect, it } from "vitest";
import {
  ConversationToolStateService,
  buildDeferredAnnouncementDelta,
  buildDeferredAnnouncement,
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

describe("buildDeferredAnnouncement (pure)", () => {
  it("emits a compact category-level note on the first announcement", () => {
    const catalog = catalogOf([tool("mcp_1_a"), tool("mcp_1_b")]);
    const msg = buildDeferredAnnouncement({
      previousAnnounced: [],
      catalog,
    });
    expect(msg).toContain("Tool catalog mode is active");
    expect(msg).toContain("tool_catalog_search");
    expect(msg).toContain("Deferred tool categories: mcp");
  });

  it("returns empty when nothing changed since the last announcement", () => {
    const catalog = catalogOf([tool("mcp_1_a")]);
    const msg = buildDeferredAnnouncement({
      previousAnnounced: ["mcp_1_a"],
      catalog,
    });
    expect(msg).toBe("");
  });

  it("emits a delta when new deferred tools appear", () => {
    const catalog = catalogOf([
      tool("mcp_1_a", "alpha"),
      tool("mcp_1_b", "beta"),
    ]);
    const msg = buildDeferredAnnouncement({
      previousAnnounced: ["mcp_1_a"],
      catalog,
    });
    expect(msg).toContain("Newly deferred tools");
    expect(msg).toContain("mcp_1_b");
    expect(msg).not.toContain("mcp_1_a");
  });

  it("reports removed tools in the delta", () => {
    const catalog = catalogOf([tool("mcp_1_a")]);
    const msg = buildDeferredAnnouncement({
      previousAnnounced: ["mcp_1_a", "mcp_1_gone"],
      catalog,
    });
    expect(msg).toContain("Tools no longer available");
    expect(msg).toContain("mcp_1_gone");
  });

  it("caps the number of added lines", () => {
    const tools: OpenAITool[] = [];
    for (let i = 0; i < 5; i++) tools.push(tool(`mcp_1_t${i}`));
    const catalog = catalogOf(tools);
    const msg = buildDeferredAnnouncement({
      previousAnnounced: ["mcp_1_t0"],
      catalog,
      maxAddedLines: 2,
    });
    expect(msg).toContain("...and 2 more");
  });
});
