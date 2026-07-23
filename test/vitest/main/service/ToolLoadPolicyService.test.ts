import { describe, expect, it } from "vitest";
import { ToolLoadPolicyService } from "@/service/ToolLoadPolicyService";
import { TOOL_CATALOG_SEARCH_TOOL_NAME } from "@/config/toolCatalogConfig";
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

describe("ToolLoadPolicyService.classify", () => {
  it("treats tool_catalog_search as always", () => {
    expect(
      classify(TOOL_CATALOG_SEARCH_TOOL_NAME, "system")
    ).toBe("always");
  });

  it("treats core file/search/job helpers as always", () => {
    expect(classify("file_read", "builtin")).toBe("always");
    expect(classify("glob_files", "builtin")).toBe("always");
    expect(classify("grep_files", "builtin")).toBe("always");
    expect(classify("check_tool_job_status", "builtin")).toBe("always");
    expect(classify("check_shell_status", "builtin")).toBe("always");
    expect(classify("read_attachment_content", "builtin")).toBe("always");
    expect(classify("knowledge_library_search", "builtin")).toBe("always");
    expect(classify("run_subagent", "builtin")).toBe("always");
  });

  it("classifies MCP tools as deferred regardless of name style", () => {
    expect(classify("mcp__crm__server__create_lead", "mcp")).toBe("deferred");
    expect(classify("mcp_42_search", "mcp")).toBe("deferred");
  });

  it("classifies plugin/imported/subagent tools as deferred", () => {
    expect(classify("plugin_tool_x", "plugin")).toBe("deferred");
    expect(classify("user_skill_y", "imported")).toBe("deferred");
    expect(classify("agent_owned_tool", "subagent")).toBe("deferred");
  });

  it("defers specialized built-in tools by default", () => {
    expect(classify("scrape_urls_from_search_engine", "builtin")).toBe(
      "deferred"
    );
    expect(classify("search_maps_businesses", "builtin")).toBe("deferred");
    expect(classify("shell_execute", "builtin")).toBe("deferred");
  });

  it("promotes a specialized tool to contextual when named in the user message", () => {
    expect(
      classify("search_maps_businesses", "builtin", {
        currentUserMessage: "Please use search_maps_businesses for dentists",
      })
    ).toBe("contextual");
  });

  it("promotes shell_execute for shell-like user intent", () => {
    expect(
      classify("shell_execute", "builtin", {
        currentUserMessage: "rm the file test.txt",
      })
    ).toBe("contextual");
    expect(
      classify("shell_execute", "builtin", {
        currentUserMessage: "delete the file test.txt",
      })
    ).toBe("contextual");
    expect(
      classify("shell_execute", "builtin", {
        currentUserMessage: "delete test.txt",
      })
    ).toBe("contextual");
    expect(
      classify("shell_execute", "builtin", {
        currentUserMessage: "run a shell command to list files",
      })
    ).toBe("contextual");
  });

  it("promotes file mutation tools for clear workspace file intent", () => {
    expect(
      classify("file_write", "builtin", {
        currentUserMessage:
          'create a file in the workspace named "test.txt" with content test',
      })
    ).toBe("contextual");
    expect(
      classify("file_write", "builtin", {
        currentUserMessage: "write content to docs/report.md",
      })
    ).toBe("contextual");
    expect(
      classify("file_edit", "builtin", {
        currentUserMessage: "replace foo with bar in src/main.ts",
      })
    ).toBe("contextual");
  });

  it("keeps file mutation tools deferred for ordinary chat", () => {
    expect(
      classify("file_write", "builtin", {
        currentUserMessage: "write a short product tagline",
      })
    ).toBe("deferred");
    expect(
      classify("file_edit", "builtin", {
        currentUserMessage: "fix this sentence",
      })
    ).toBe("deferred");
  });

  it("promotes knowledge-library management tools for knowledge-library intent", () => {
    expect(
      classify("knowledge_library_list_documents", "builtin", {
        currentUserMessage: "list documents in the knowledge library",
      })
    ).toBe("contextual");
    expect(
      classify("knowledge_library_import_attachment", "builtin", {
        currentUserMessage: "import this attachment into the knowledge base",
      })
    ).toBe("contextual");
    expect(
      classify("knowledge_library_delete_document", "builtin", {
        currentUserMessage: "delete this document from the knowledge library",
      })
    ).toBe("contextual");
  });

  it("promotes schedule and HTML artifact tools for matching intent", () => {
    expect(
      classify("create_schedule", "builtin", {
        currentUserMessage: "create a schedule to run this task every morning",
      })
    ).toBe("contextual");
    expect(
      classify("delete_schedule", "builtin", {
        currentUserMessage: "delete the old cron schedule",
      })
    ).toBe("contextual");
    expect(
      classify("create_html_artifact", "builtin", {
        currentUserMessage: "show this as an interactive dashboard",
      })
    ).toBe("contextual");
  });

  it("treats plan tools as always only in plan mode", () => {
    expect(classify("AskUserQuestion", "plan", { isPlanMode: true })).toBe(
      "always"
    );
    expect(classify("SubmitPlanForApproval", "plan", { isPlanMode: true })).toBe(
      "always"
    );
    expect(classify("AskUserQuestion", "plan", { isPlanMode: false })).toBe(
      "contextual"
    );
  });

  it("treats EnterPlanMode as contextual", () => {
    expect(classify("EnterPlanMode", "plan")).toBe("contextual");
  });

  it("never inspects tool arguments (pure name+source+context)", () => {
    const svc = new ToolLoadPolicyService();
    const policy = svc.classify({
      tool: { type: "function", function: { name: "file_read" } },
      source: "builtin",
      context: baseCtx,
    });
    expect(policy).toBe("always");
  });
});
