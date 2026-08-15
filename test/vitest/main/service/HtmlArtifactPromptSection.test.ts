import { describe, expect, it } from "vitest";
import { buildHtmlArtifactGuidanceSection } from "@/service/HtmlArtifactPromptSection";

describe("buildHtmlArtifactGuidanceSection", () => {
  it("returns a non-empty guidance block mentioning the tool", () => {
    const s = buildHtmlArtifactGuidanceSection();
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain("create_html_artifact");
  });

  it("points the model away from raw HTML and workspace file tools", () => {
    const s = buildHtmlArtifactGuidanceSection();
    expect(s).toContain("main content area");
    expect(s).toContain("file_read");
    expect(s).toContain("tool_catalog_search");
    // Must explicitly discourage inlining the full HTML in chat.
    expect(s.toLowerCase()).toContain("must not inline");
  });

  it("is deterministic / pure (no side effects, stable output)", () => {
    expect(buildHtmlArtifactGuidanceSection()).toBe(
      buildHtmlArtifactGuidanceSection()
    );
  });
});