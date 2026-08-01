import { describe, expect, it } from "vitest";
import { ToolCatalogSearchService } from "@/service/ToolCatalogSearchService";
import { ToolCatalogService } from "@/service/ToolCatalogService";
import type { OpenAITool } from "@/api/aiChatApi";
import type {
  ToolCatalog,
  ToolCatalogRuntimeContext,
  ToolCatalogState,
} from "@/entityTypes/toolCatalogTypes";

function tool(name: string, desc = ""): OpenAITool {
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

function buildCatalog(tools: OpenAITool[]): ToolCatalog {
  return new ToolCatalogService().buildFromOpenAITools({
    tools,
    context: ctx,
  });
}

describe("ToolCatalogSearchService.search — select", () => {
  it("resolves exact selected names and reports none missing", () => {
    const catalog = buildCatalog([tool("mcp_1_alpha"), tool("mcp_1_beta")]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { select: ["mcp_1_alpha"] },
      catalog,
      state: emptyState,
      context: ctx,
    });
    expect(r.success).toBe(true);
    expect(r.selectedToolNames).toContain("mcp_1_alpha");
    expect(r.missingToolNames).toEqual([]);
  });

  it("reports missing names that are not in the catalog", () => {
    const catalog = buildCatalog([tool("mcp_1_alpha")]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { select: ["does_not_exist"] },
      catalog,
      state: emptyState,
      context: ctx,
    });
    expect(r.missingToolNames).toEqual(["does_not_exist"]);
    expect(r.selectedToolNames).not.toContain("does_not_exist");
  });
});

describe("ToolCatalogSearchService.search — query ranking", () => {
  it("ranks an exact-name match first", () => {
    const catalog = buildCatalog([
      tool("mcp_1_search_maps_businesses"),
      tool("mcp_2_maps_businesses"),
      tool("file_read"),
    ]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "maps businesses" },
      catalog,
      state: emptyState,
      context: ctx,
    });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].name).toBe("mcp_2_maps_businesses");
    // both relevant tools selected for loading
    expect(r.selectedToolNames).toEqual(
      expect.arrayContaining([
        "mcp_2_maps_businesses",
        "mcp_1_search_maps_businesses",
      ])
    );
  });

  it("requires terms prefixed with +", () => {
    const catalog = buildCatalog([
      tool("mcp_1_search_maps_businesses"),
      tool("mcp_2_email_send"),
    ]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "+maps businesses" },
      catalog,
      state: emptyState,
      context: ctx,
    });
    // only candidates containing "maps" survive
    expect(r.matches.some((m) => m.name.includes("maps"))).toBe(true);
    expect(r.matches.some((m) => m.name.includes("email"))).toBe(false);
  });

  it("caps query matches at the default max_results", () => {
    const tools: OpenAITool[] = [];
    for (let i = 0; i < 8; i++) {
      tools.push(tool(`mcp_${i}_scraper_extract`));
    }
    const catalog = buildCatalog(tools);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "scraper extract" },
      catalog,
      state: emptyState,
      context: ctx,
    });
    expect(r.matches.length).toBeLessThanOrEqual(5);
  });

  it("respects an explicit max_results override", () => {
    const tools: OpenAITool[] = [];
    for (let i = 0; i < 8; i++) {
      tools.push(tool(`mcp_${i}_scraper_extract`));
    }
    const catalog = buildCatalog(tools);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "scraper extract", max_results: 2 },
      catalog,
      state: emptyState,
      context: ctx,
    });
    expect(r.matches.length).toBe(2);
  });
});

describe("ToolCatalogSearchService.search — policy", () => {
  it("never returns blocked tools", () => {
    const catalog = buildCatalog([
      tool("mcp_1_alpha"),
      tool("mcp_1_beta"),
    ]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "alpha beta" },
      catalog,
      state: emptyState,
      context: { ...ctx, blockedToolNames: new Set(["mcp_1_alpha"]) },
    });
    expect(r.matches.map((m) => m.name)).not.toContain("mcp_1_alpha");
    expect(r.selectedToolNames).not.toContain("mcp_1_alpha");
  });

  it("restricts to agent allowed tools when allowedToolNames is set", () => {
    const catalog = buildCatalog([
      tool("mcp_1_alpha"),
      tool("mcp_1_beta"),
    ]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "alpha beta" },
      catalog,
      state: emptyState,
      context: {
        ...ctx,
        allowedToolNames: new Set(["mcp_1_beta"]),
      },
    });
    expect(r.matches.map((m) => m.name)).toEqual(["mcp_1_beta"]);
  });

  it("flags already-exposed matches", () => {
    const catalog = buildCatalog([tool("mcp_1_alpha")]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "alpha" },
      catalog,
      state: {
        discoveredToolNames: new Set(["mcp_1_alpha"]),
        announcedDeferredNames: new Set(),
      },
      context: ctx,
    });
    expect(r.matches[0].alreadyExposed).toBe(true);
  });

  it("returns a compact success payload even with no matches", () => {
    const catalog = buildCatalog([tool("mcp_1_alpha")]);
    const svc = new ToolCatalogSearchService();
    const r = svc.search({
      args: { query: "zzznomatch" },
      catalog,
      state: emptyState,
      context: ctx,
    });
    expect(r.success).toBe(true);
    expect(r.matches).toEqual([]);
    expect(r.selectedToolNames).toEqual([]);
  });
});
