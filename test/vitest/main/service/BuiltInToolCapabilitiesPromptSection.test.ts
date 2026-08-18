import { describe, expect, it } from "vitest";
import { buildBuiltInToolCapabilitiesSection } from "@/service/BuiltInToolCapabilitiesPromptSection";

/**
 * Tests for the system-level "Built-in Tool Capabilities" table injected into
 * the AI Chat V2 system prompt. The block steers the model to the correct
 * specialized tool (or to tool_catalog_search to load it) for every
 * contextual/deferred built-in capability, so the model does not fall back to
 * always-loaded file tools or paste output into chat.
 */
describe("buildBuiltInToolCapabilitiesSection", () => {
  it("returns a non-empty, deterministic guidance block", () => {
    const s = buildBuiltInToolCapabilitiesSection();
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    // Pure function: stable across calls.
    expect(buildBuiltInToolCapabilitiesSection()).toBe(s);
  });

  it("covers every contextual/deferred built-in tool family", () => {
    const s = buildBuiltInToolCapabilitiesSection();
    // Each family's representative tool name must appear.
    const must = [
      "create_html_artifact",
      "file_write",
      "file_edit",
      "attach_local_images",
      "process_artifact_batch",
      "export_generated_artifacts",
      "list_email_inboxes",
      "fetch_unread_emails",
      "create_email_reply_draft",
      "send_email_reply",
      "list_schedules",
      "create_schedule",
      "knowledge_library_import_attachment",
      "scrape_urls_from_search_engine",
      "shell_execute",
    ];
    for (const name of must) {
      expect(s).toContain(name);
    }
  });

  it("teaches the model to load deferred tools via tool_catalog_search", () => {
    const s = buildBuiltInToolCapabilitiesSection();
    expect(s).toContain("tool_catalog_search");
    // The discovery fallback phrasing must be present.
    expect(s).toContain("load");
  });

  it("discourages substituting always-loaded file tools for specialized tools", () => {
    const s = buildBuiltInToolCapabilitiesSection();
    expect(s).toContain("file_read");
    // The block must tell the model NOT to use file_read/glob_files as a
    // substitute (this was the exact failure mode for the HTML bug).
    expect(s.toLowerCase()).toContain("not");
  });

  it("routes data-export requests to file_write and forbids shell_echo fallback", () => {
    const s = buildBuiltInToolCapabilitiesSection();
    // The file-write row must cover export/download/convert-to-csv/xlsx phrasings.
    expect(s).toContain("export/download/convert");
    expect(s).toContain("csv");
    // It must explicitly forbid the shell-echo antipattern that caused the
    // 'export those data to a csv file' bug (row-by-row echo >>).
    expect(s.toLowerCase()).toContain("not a shell echo");
    expect(s.toLowerCase()).toContain("row-by-row");
  });

  it("explicitly flags the email-reply tools as not auto-promoted", () => {
    const s = buildBuiltInToolCapabilitiesSection();
    // Reply tools are deferred-by-default (no intent regex) — the table must
    // call this out so the model loads them via search rather than failing.
    expect(s.toLowerCase()).toContain("not auto-promoted");
  });

  it("teaches the model how to edit a previously generated image", () => {
    const s = buildBuiltInToolCapabilitiesSection();
    // The model must know the two-step workflow: export the generated image
    // to the workspace, then use attach_local_images to edit it.
    expect(s).toContain("export_generated_artifacts");
    expect(s).toContain("aifetchly-generated-image://");
    expect(s).toContain("attach_local_images");
  });
});
