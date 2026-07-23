import { describe, expect, it } from "vitest";
import {
  ToolCatalogService,
  TOOL_CATALOG_SEARCH_OPENAI_TOOL,
} from "@/service/ToolCatalogService";
import { TOOL_CATALOG_SEARCH_TOOL_NAME } from "@/config/toolCatalogConfig";
import type { OpenAITool } from "@/api/aiChatApi";
import type {
  ToolCatalogRuntimeContext,
  ToolCatalogState,
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

const emptyState: ToolCatalogState = {
  discoveredToolNames: new Set(),
  announcedDeferredNames: new Set(),
};

describe("ToolCatalogService.buildFromOpenAITools", () => {
  it("detects MCP source by name prefix", () => {
    const svc = new ToolCatalogService();
    const cat = svc.buildFromOpenAITools({
      tools: [tool("mcp__crm__server__create_lead")],
      context: ctx,
    });
    expect(cat.byName.get("mcp__crm__server__create_lead")?.source).toBe(
      "mcp"
    );
    expect(
      cat.byName.get("mcp__crm__server__create_lead")?.loadPolicy
    ).toBe("deferred");
  });

  it("detects legacy MCP names", () => {
    const svc = new ToolCatalogService();
    const cat = svc.buildFromOpenAITools({
      tools: [tool("mcp_42_search")],
      context: ctx,
    });
    expect(cat.byName.get("mcp_42_search")?.source).toBe("mcp");
  });

  it("classifies core helpers as always via injected skill resolver", () => {
    const svc = new ToolCatalogService({
      getSkillDefinition: (name) =>
        name === "file_read"
          ? ({ name, source: "built-in" } as never)
          : null,
    });
    const cat = svc.buildFromOpenAITools({
      tools: [tool("file_read")],
      context: ctx,
    });
    const e = cat.byName.get("file_read");
    expect(e?.source).toBe("builtin");
    expect(e?.loadPolicy).toBe("always");
  });

  it("deduplicates entries by name (first wins)", () => {
    const svc = new ToolCatalogService();
    const cat = svc.buildFromOpenAITools({
      tools: [tool("dup", "first"), tool("dup", "second")],
      context: ctx,
    });
    expect(cat.entries.length).toBe(1);
    expect(cat.byName.get("dup")?.description).toBe("first");
  });

  it("produces stable ordering system->plan->builtin->mcp", () => {
    const svc = new ToolCatalogService();
    const cat = svc.buildFromOpenAITools({
      tools: [
        tool("mcp_1_zeta"),
        tool("search_maps_businesses"),
        tool("AskUserQuestion"),
      ],
      context: { ...ctx, isPlanMode: true },
    });
    const order = cat.entries.map((e) => e.source);
    // plan before builtin before mcp
    expect(order.indexOf("plan")).toBeLessThan(order.indexOf("builtin"));
    expect(order.indexOf("builtin")).toBeLessThan(order.indexOf("mcp"));
  });

  it("computes stable schema hashes", () => {
    const svc = new ToolCatalogService();
    const cat1 = svc.buildFromOpenAITools({
      tools: [tool("file_read")],
      context: ctx,
    });
    const cat2 = svc.buildFromOpenAITools({
      tools: [tool("file_read")],
      context: ctx,
    });
    expect(cat1.byName.get("file_read")?.schemaHash).toBe(
      cat2.byName.get("file_read")?.schemaHash
    );
    const cat3 = svc.buildFromOpenAITools({
      tools: [tool("file_read", "different")],
      context: ctx,
    });
    expect(cat3.byName.get("file_read")?.schemaHash).not.toBe(
      cat1.byName.get("file_read")?.schemaHash
    );
  });

  it("aggregates estimated token totals", () => {
    const svc = new ToolCatalogService();
    const cat = svc.buildFromOpenAITools({
      tools: [tool("mcp_1_a"), tool("mcp_1_b")],
      context: ctx,
    });
    expect(cat.totalEstimatedTokens).toBeGreaterThan(0);
    expect(cat.deferredEstimatedTokens).toBe(cat.totalEstimatedTokens);
  });
});

describe("ToolCatalogService.filterForRound", () => {
  function buildWith(tools: OpenAITool[]) {
    const svc = new ToolCatalogService();
    return {
      svc,
      catalog: svc.buildFromOpenAITools({ tools, context: ctx }),
    };
  }

  it("standard mode exposes all live tools without the search tool", () => {
    const { svc, catalog } = buildWith([
      tool("file_read"),
      tool("mcp_1_secret"),
    ]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("file_read"), tool("mcp_1_secret")],
      state: emptyState,
      modeDecision: {
        mode: "standard",
        configuredMode: "off",
        reason: "off",
        estimatedDeferredTokens: 0,
      },
    });
    expect(r.mode).toBe("standard");
    expect(r.exposedToolNames).toEqual(
      expect.arrayContaining(["file_read", "mcp_1_secret"])
    );
    // search tool not added in standard mode
    expect(r.exposedToolNames).not.toContain(TOOL_CATALOG_SEARCH_TOOL_NAME);
  });

  it("deferred mode hides undiscovered deferred tools and adds the search tool", () => {
    const { svc, catalog } = buildWith([
      tool("file_read"),
      tool("mcp_1_secret"),
    ]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("file_read"), tool("mcp_1_secret")],
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });
    expect(r.mode).toBe("deferred");
    expect(r.exposedToolNames).toContain("file_read");
    expect(r.exposedToolNames).toContain(TOOL_CATALOG_SEARCH_TOOL_NAME);
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
    expect(r.deferredToolNames).toContain("mcp_1_secret");
  });

  it("promotes a discovered deferred tool", () => {
    const { svc, catalog } = buildWith([tool("mcp_1_secret")]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("mcp_1_secret")],
      state: {
        discoveredToolNames: new Set(["mcp_1_secret"]),
        announcedDeferredNames: new Set(),
      },
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });
    expect(r.exposedToolNames).toContain("mcp_1_secret");
  });

  it("exposes forced tools even when deferred", () => {
    const { svc, catalog } = buildWith([tool("mcp_1_secret")]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("mcp_1_secret")],
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
      forcedToolNames: new Set(["mcp_1_secret"]),
    });
    expect(r.exposedToolNames).toContain("mcp_1_secret");
  });

  it("includes search tool definition object", () => {
    const { svc, catalog } = buildWith([tool("file_read")]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("file_read")],
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });
    expect(
      r.exposedTools.some(
        (t) => t.function.name === TOOL_CATALOG_SEARCH_TOOL_NAME
      )
    ).toBe(true);
    expect(TOOL_CATALOG_SEARCH_OPENAI_TOOL.function.name).toBe(
      TOOL_CATALOG_SEARCH_TOOL_NAME
    );
  });

  it("reports metrics with counts", () => {
    const { svc, catalog } = buildWith([
      tool("file_read"),
      tool("mcp_1_secret"),
    ]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("file_read"), tool("mcp_1_secret")],
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });
    expect(r.metrics.totalCount).toBe(2);
    expect(r.metrics.deferredCount).toBe(1);
    expect(r.metrics.exposedCount).toBe(2); // file_read + search tool
    expect(r.metrics.discoveredCount).toBe(0);
  });
});
