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
    expect(classify(TOOL_CATALOG_SEARCH_TOOL_NAME, "system")).toBe("always");
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

  it("keeps attach_local_images deferred by default (not always-loaded)", () => {
    expect(classify("attach_local_images", "builtin")).toBe("deferred");
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage: "write a short product tagline",
      })
    ).toBe("deferred");
  });

  it("promotes attach_local_images for local image edit/analyze intent", () => {
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage:
          "please update the backgroud color of image in workspace to white",
      })
    ).toBe("contextual");
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage:
          "Find the front-view product photo and make the background white.",
      })
    ).toBe("contextual");
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage: "compare these three banner images",
      })
    ).toBe("contextual");
  });

  it("promotes process_artifact_batch for the same multi-image edit intent", () => {
    expect(
      classify("process_artifact_batch", "builtin", {
        currentUserMessage:
          "please update all image backgrounds in the workspace to white",
      })
    ).toBe("contextual");
    expect(
      classify("process_artifact_batch", "builtin", {
        currentUserMessage: "write a short product tagline",
      })
    ).toBe("deferred");
  });

  it("exposes only the batch processor for plural workspace image edits", () => {
    const currentUserMessage =
      "please modify the background color of those image in the workspace to white";

    expect(
      classify("attach_local_images", "builtin", { currentUserMessage })
    ).toBe("deferred");
    expect(
      classify("process_artifact_batch", "builtin", { currentUserMessage })
    ).toBe("contextual");
  });

  it("promotes generated-artifact export for explicit workspace save intent", () => {
    expect(
      classify("export_generated_artifacts", "builtin", {
        currentUserMessage: "save the generated files into my workspace",
      })
    ).toBe("contextual");
  });

  it("promotes attach_local_images on continue when recent history has image intent", () => {
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage: "continue",
        recentUserMessages: [
          "please update the backgroud color of image in workspace to white",
        ],
      })
    ).toBe("contextual");
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage: "yes",
        recentUserMessages: ["compare these three banner images"],
      })
    ).toBe("contextual");
    // Continuation without image history stays deferred.
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage: "continue",
        recentUserMessages: ["write a short product tagline"],
      })
    ).toBe("deferred");
    // Non-continuation messages do not inherit old image intent.
    expect(
      classify("attach_local_images", "builtin", {
        currentUserMessage: "what is the weather today",
        recentUserMessages: [
          "please update the backgroud color of image in workspace to white",
        ],
      })
    ).toBe("deferred");
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
      classify("file_write", "builtin", {
        currentUserMessage: 'update file content with "manual test 20260723"',
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

  it("promotes file_write for 'export/download/convert ... to csv/file' phrasings", () => {
    const phrases = [
      "export those data to a csv file",
      "export the data to a csv",
      "export to csv",
      "export to an excel file",
      "export the contacts to a csv file",
      "download these as a csv",
      "download the report as csv",
      "convert these to csv",
      "convert to a json file",
      "save the table as a csv",
      "save the table as xlsx",
      "dump the results to a file",
      "put this data into a spreadsheet",
    ];
    for (const currentUserMessage of phrases) {
      expect(classify("file_write", "builtin", { currentUserMessage })).toBe(
        "contextual"
      );
    }
  });

  it("does NOT promote file_write when 'export/download/convert/save' has no file/data-format target", () => {
    const phrases = [
      "what is a csv file",
      "explain how csv escaping works",
      "how do I parse csv in python",
      "export our brand guidelines as a style guide",
      "tell me about downloadable resources on your site",
      "put the meeting notes in the chat",
      "save me a seat",
      "tell me how to convert between csv and json formats",
    ];
    for (const currentUserMessage of phrases) {
      expect(classify("file_write", "builtin", { currentUserMessage })).toBe(
        "deferred"
      );
    }
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

  it("promotes the website import tool for knowledge-library intent and stays deferred otherwise", () => {
    // Explicit knowledge-library wording promotes it.
    expect(
      classify("knowledge_library_import_website", "builtin", {
        currentUserMessage: "import this webpage into the knowledge library",
      })
    ).toBe("contextual");
    // Website-import phrasing (no literal "knowledge library") also promotes it.
    expect(
      classify("knowledge_library_import_website", "builtin", {
        currentUserMessage: "save this url to the knowledge base for later",
      })
    ).toBe("contextual");
    // Unrelated chat leaves it deferred (discoverable via catalog search).
    expect(
      classify("knowledge_library_import_website", "builtin", {
        currentUserMessage: "what is the weather today",
      })
    ).toBe("deferred");
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

  it("promotes create_html_artifact for 'show/render/display ... in html' phrasings", () => {
    const phrases = [
      "show result in html",
      "show data in html",
      "show data in html file",
      "show the results as html",
      "display the results as html",
      "render the table in html",
      "make an html report",
      "generate an html page for the contacts",
      "put this into an html page",
      "output the report as html",
    ];
    for (const currentUserMessage of phrases) {
      expect(
        classify("create_html_artifact", "builtin", { currentUserMessage })
      ).toBe("contextual");
    }
  });

  it("does NOT promote create_html_artifact for generic HTML knowledge questions", () => {
    const phrases = [
      "what is HTML?",
      "how do I center a div in html",
      "why is my html broken",
      "explain how HTML works",
      "write a short product tagline",
      "what is the weather today",
    ];
    for (const currentUserMessage of phrases) {
      expect(
        classify("create_html_artifact", "builtin", { currentUserMessage })
      ).toBe("deferred");
    }
  });

  it("keeps email inbox tools deferred by default and for outbound email phrasing", () => {
    expect(classify("list_email_inboxes", "builtin")).toBe("deferred");
    expect(classify("fetch_unread_emails", "builtin")).toBe("deferred");
    expect(classify("get_email_message", "builtin")).toBe("deferred");
    expect(classify("mark_email_processed", "builtin")).toBe("deferred");
    expect(
      classify("fetch_unread_emails", "builtin", {
        currentUserMessage: "start a bulk email marketing campaign",
      })
    ).toBe("deferred");
    expect(
      classify("list_email_inboxes", "builtin", {
        currentUserMessage: "generate an email template for our newsletter",
      })
    ).toBe("deferred");
    // Reply tools stay deferred unless named or discovered via catalog search.
    expect(
      classify("create_email_reply_draft", "builtin", {
        currentUserMessage: "check whether there is new email in my emaibox",
      })
    ).toBe("deferred");
    expect(
      classify("send_email_reply", "builtin", {
        currentUserMessage: "check my inbox for unread emails",
      })
    ).toBe("deferred");
  });

  it("promotes email inbox tools for check-inbox / unread / mailbox intent", () => {
    expect(
      classify("list_email_inboxes", "builtin", {
        currentUserMessage: "check whether there is new email in my emaibox",
      })
    ).toBe("contextual");
    expect(
      classify("fetch_unread_emails", "builtin", {
        currentUserMessage: "check whether there is new email in my emaibox",
      })
    ).toBe("contextual");
    expect(
      classify("get_email_message", "builtin", {
        currentUserMessage: "check my inbox for unread emails",
      })
    ).toBe("contextual");
    expect(
      classify("mark_email_processed", "builtin", {
        currentUserMessage: "are there any new emails in my mailbox",
      })
    ).toBe("contextual");
    expect(
      classify("fetch_unread_emails", "builtin", {
        currentUserMessage: "fetch unread emails from my inbox",
      })
    ).toBe("contextual");
  });

  it("promotes email inbox tools on continue when recent history has inbox intent", () => {
    expect(
      classify("fetch_unread_emails", "builtin", {
        currentUserMessage: "continue",
        recentUserMessages: ["check whether there is new email in my emaibox"],
      })
    ).toBe("contextual");
    expect(
      classify("list_email_inboxes", "builtin", {
        currentUserMessage: "yes",
        recentUserMessages: ["check my inbox"],
      })
    ).toBe("contextual");
    expect(
      classify("fetch_unread_emails", "builtin", {
        currentUserMessage: "continue",
        recentUserMessages: ["write a short product tagline"],
      })
    ).toBe("deferred");
    expect(
      classify("fetch_unread_emails", "builtin", {
        currentUserMessage: "what is the weather today",
        recentUserMessages: ["check my inbox for unread emails"],
      })
    ).toBe("deferred");
  });

  it("treats plan tools as always only in plan mode", () => {
    expect(classify("AskUserQuestion", "plan", { isPlanMode: true })).toBe(
      "always"
    );
    expect(
      classify("SubmitPlanForApproval", "plan", { isPlanMode: true })
    ).toBe("always");
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

  // ---- Contact verification (verify_contact_info) ----
  it("keeps verify_contact_info deferred by default", () => {
    expect(classify("verify_contact_info", "builtin")).toBe("deferred");
  });

  it("promotes verify_contact_info for 'verify these emails'", () => {
    expect(
      classify("verify_contact_info", "builtin", {
        currentUserMessage: "verify these emails for me",
      })
    ).toBe("contextual");
  });

  it("promotes verify_contact_info for 'normalize these phone numbers'", () => {
    expect(
      classify("verify_contact_info", "builtin", {
        currentUserMessage: "normalize these phone numbers",
      })
    ).toBe("contextual");
  });

  it("promotes verify_contact_info for 'clean these contacts'", () => {
    expect(
      classify("verify_contact_info", "builtin", {
        currentUserMessage: "clean these contacts and remove invalid ones",
      })
    ).toBe("contextual");
  });

  it("does NOT promote verify_contact_info for generic email questions", () => {
    expect(
      classify("verify_contact_info", "builtin", {
        currentUserMessage: "how does email work?",
      })
    ).toBe("deferred");
    expect(
      classify("verify_contact_info", "builtin", {
        currentUserMessage: "what is phone verification?",
      })
    ).toBe("deferred");
  });
});
