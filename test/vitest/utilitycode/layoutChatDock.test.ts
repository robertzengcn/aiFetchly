import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readLayout = (): Promise<string> =>
  readFile(path.resolve(process.cwd(), "src/views/layout/layout.vue"), "utf8");

const extractRule = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? "";
};

describe("layout AI chat V2 dock", () => {
  it("renders chat V2 as a right-side dock instead of an overlay backdrop", async () => {
    const source = await readLayout();

    expect(source).toContain('class="ai-chat-dock"');
    expect(source).not.toContain("<!-- V2 Backdrop overlay -->");

    const dockRule = extractRule(source, ".ai-chat-dock");
    expect(dockRule).toContain("position: relative");
    expect(dockRule).toContain("align-self: stretch");
    expect(dockRule).toContain("height: auto");
    expect(dockRule).toContain("max-height: calc(100vh - 92px)");
    expect(dockRule).toContain("min-height: 0");
    expect(dockRule).not.toContain("\n    height: calc(100vh - 92px);");
    expect(dockRule).toContain("padding-top: 32px");
    expect(dockRule).not.toContain("position: fixed");
  });

  it("keeps chat V2 mounted while toggling dock visibility", async () => {
    const source = await readLayout();

    // AiChatV2 is mounted with v-show (not v-if) so the component stays
    // alive — its scroll position and conversation state survive the
    // dock being collapsed. The tag carries several props across
    // multiple lines now, so assert the binding rather than a brittle
    // single-line literal.
    const aiChatV2Open = source.match(/<AiChatV2[\s\S]*?\/>/);
    expect(aiChatV2Open).not.toBeNull();
    expect(aiChatV2Open?.[0]).toContain('v-show="v2ChatPanelOpen"');
    expect(aiChatV2Open?.[0]).not.toContain('v-if="v2ChatPanelOpen"');
  });
});
