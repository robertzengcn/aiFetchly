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
    expect(dockRule).toContain("position: sticky");
    expect(dockRule).toContain("top: 92px");
    expect(dockRule).toContain("height: calc(100vh - 92px)");
    expect(dockRule).toContain("padding-top: 32px");
    expect(dockRule).not.toContain("position: fixed");
  });
});
