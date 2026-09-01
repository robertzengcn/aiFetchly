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
    expect(cat.byName.get("mcp__crm__server__create_lead")?.source).toBe("mcp");
    expect(cat.byName.get("mcp__crm__server__create_lead")?.loadPolicy).toBe(
      "deferred"
    );
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
        name === "file_read" ? ({ name, source: "built-in" } as never) : null,
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

  it("exposes shell_execute for shell-like file removal requests", () => {
    const svc = new ToolCatalogService();
    const shellCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage: "rm the file test.txt",
    };
    const catalog = svc.buildFromOpenAITools({
      tools: [
        tool("file_read"),
        tool("shell_execute"),
        tool("check_shell_status"),
        tool("mcp_1_secret"),
      ],
      context: shellCtx,
    });
    const r = svc.filterForRound({
      catalog,
      liveTools: [
        tool("file_read"),
        tool("shell_execute"),
        tool("check_shell_status"),
        tool("mcp_1_secret"),
      ],
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("shell_execute")?.loadPolicy).toBe("contextual");
    expect(catalog.byName.get("check_shell_status")?.loadPolicy).toBe("always");
    expect(r.exposedToolNames).toContain("shell_execute");
    expect(r.exposedToolNames).toContain("check_shell_status");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
  });

  it("keeps shell_execute deferred for ordinary chat", () => {
    const { svc, catalog } = buildWith([tool("shell_execute")]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("shell_execute")],
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("shell_execute")?.loadPolicy).toBe("deferred");
    expect(r.exposedToolNames).not.toContain("shell_execute");
  });

  it("exposes file_write for clear file creation requests", () => {
    const svc = new ToolCatalogService();
    const fileCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage:
        'create a file in the workspace, name "test.txt", with content "test"',
    };
    const liveTools = [
      tool("file_read"),
      tool("file_write"),
      tool("mcp_1_secret"),
    ];
    const catalog = svc.buildFromOpenAITools({
      tools: liveTools,
      context: fileCtx,
    });
    const r = svc.filterForRound({
      catalog,
      liveTools,
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("file_write")?.loadPolicy).toBe("contextual");
    expect(r.exposedToolNames).toContain("file_write");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
  });

  it("exposes file_edit for clear file editing requests", () => {
    const svc = new ToolCatalogService();
    const fileCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage: "replace localhost with 127.0.0.1 in config.json",
    };
    const liveTools = [tool("file_edit"), tool("mcp_1_secret")];
    const catalog = svc.buildFromOpenAITools({
      tools: liveTools,
      context: fileCtx,
    });
    const r = svc.filterForRound({
      catalog,
      liveTools,
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("file_edit")?.loadPolicy).toBe("contextual");
    expect(r.exposedToolNames).toContain("file_edit");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
  });

  it("exposes attach_local_images for image intent and continue follow-ups", () => {
    const svc = new ToolCatalogService();
    const imageCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage:
        "please update the backgroud color of image in workspace to white",
    };
    const continueCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage: "continue",
      recentUserMessages: [
        "please update the backgroud color of image in workspace to white",
      ],
    };
    const liveTools = [
      tool("glob_files"),
      tool("attach_local_images"),
      tool("shell_execute"),
      tool("mcp_1_secret"),
    ];

    for (const roundCtx of [imageCtx, continueCtx]) {
      const catalog = svc.buildFromOpenAITools({
        tools: liveTools,
        context: roundCtx,
      });
      const r = svc.filterForRound({
        catalog,
        liveTools,
        state: emptyState,
        modeDecision: {
          mode: "deferred",
          configuredMode: "on",
          reason: "on",
          estimatedDeferredTokens: 1000,
        },
      });

      expect(catalog.byName.get("attach_local_images")?.loadPolicy).toBe(
        "contextual"
      );
      expect(r.exposedToolNames).toContain("attach_local_images");
      expect(r.exposedToolNames).toContain("glob_files");
      expect(r.exposedToolNames).not.toContain("shell_execute");
      expect(r.exposedToolNames).not.toContain("mcp_1_secret");
    }
  });

  it("exposes file mutation tools for implicit file-content update requests", () => {
    const svc = new ToolCatalogService();
    const fileCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage: 'update file content with "manual test 20260723"',
    };
    const liveTools = [
      tool("file_write"),
      tool("file_edit"),
      tool("mcp_1_secret"),
    ];
    const catalog = svc.buildFromOpenAITools({
      tools: liveTools,
      context: fileCtx,
    });
    const r = svc.filterForRound({
      catalog,
      liveTools,
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("file_write")?.loadPolicy).toBe("contextual");
    expect(catalog.byName.get("file_edit")?.loadPolicy).toBe("contextual");
    expect(r.exposedToolNames).toContain("file_write");
    expect(r.exposedToolNames).toContain("file_edit");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
  });

  it("keeps run_subagent exposed because the system prompt advertises agents", () => {
    const { svc, catalog } = buildWith([
      tool("run_subagent"),
      tool("mcp_1_secret"),
    ]);
    const r = svc.filterForRound({
      catalog,
      liveTools: [tool("run_subagent"), tool("mcp_1_secret")],
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("run_subagent")?.loadPolicy).toBe("always");
    expect(r.exposedToolNames).toContain("run_subagent");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
  });

  it("exposes management tools for matching knowledge, schedule, and artifact intent", () => {
    const svc = new ToolCatalogService();
    const intentCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage:
        "list knowledge library documents, create a schedule, and show a dashboard",
    };
    const liveTools = [
      tool("knowledge_library_list_documents"),
      tool("create_schedule"),
      tool("create_html_artifact"),
      tool("mcp_1_secret"),
    ];
    const catalog = svc.buildFromOpenAITools({
      tools: liveTools,
      context: intentCtx,
    });
    const r = svc.filterForRound({
      catalog,
      liveTools,
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(r.exposedToolNames).toContain("knowledge_library_list_documents");
    expect(r.exposedToolNames).toContain("create_schedule");
    expect(r.exposedToolNames).toContain("create_html_artifact");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
  });

  it("exposes email inbox tools for check-inbox intent and keeps reply tools deferred", () => {
    const svc = new ToolCatalogService();
    const inboxCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage: "check whether there is new email in my emaibox",
    };
    const liveTools = [
      tool("list_email_inboxes"),
      tool("fetch_unread_emails"),
      tool("get_email_message"),
      tool("mark_email_processed"),
      tool("create_email_reply_draft"),
      tool("send_email_reply"),
      tool("mcp_1_secret"),
    ];
    const catalog = svc.buildFromOpenAITools({
      tools: liveTools,
      context: inboxCtx,
    });
    const r = svc.filterForRound({
      catalog,
      liveTools,
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("fetch_unread_emails")?.loadPolicy).toBe(
      "contextual"
    );
    expect(r.exposedToolNames).toContain("list_email_inboxes");
    expect(r.exposedToolNames).toContain("fetch_unread_emails");
    expect(r.exposedToolNames).toContain("get_email_message");
    expect(r.exposedToolNames).toContain("mark_email_processed");
    expect(r.exposedToolNames).not.toContain("create_email_reply_draft");
    expect(r.exposedToolNames).not.toContain("send_email_reply");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
  });

  it("exposes outbound send tools for marketing-email intent and keeps reply/inbox deferred", () => {
    const svc = new ToolCatalogService();
    const sendCtx: ToolCatalogRuntimeContext = {
      ...ctx,
      currentUserMessage:
        "Write a marketing email introducing our new product and send it to above customer",
    };
    const liveTools = [
      tool("list_email_services"),
      tool("list_email_templates"),
      tool("start_email_send_task"),
      tool("list_email_inboxes"),
      tool("send_email_reply"),
      tool("create_email_reply_draft"),
      tool("mcp_1_secret"),
    ];
    const catalog = svc.buildFromOpenAITools({
      tools: liveTools,
      context: sendCtx,
    });
    const r = svc.filterForRound({
      catalog,
      liveTools,
      state: emptyState,
      modeDecision: {
        mode: "deferred",
        configuredMode: "on",
        reason: "on",
        estimatedDeferredTokens: 1000,
      },
    });

    expect(catalog.byName.get("start_email_send_task")?.loadPolicy).toBe(
      "contextual"
    );
    expect(r.exposedToolNames).toContain("start_email_send_task");
    expect(r.exposedToolNames).toContain("list_email_services");
    expect(r.exposedToolNames).toContain("list_email_templates");
    expect(r.exposedToolNames).not.toContain("list_email_inboxes");
    expect(r.exposedToolNames).not.toContain("send_email_reply");
    expect(r.exposedToolNames).not.toContain("create_email_reply_draft");
    expect(r.exposedToolNames).not.toContain("mcp_1_secret");
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
