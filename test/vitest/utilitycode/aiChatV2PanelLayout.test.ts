import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): Promise<string> =>
  readFile(path.resolve(process.cwd(), relativePath), "utf8");

const extractRule = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? "";
};

describe("AI chat V2 panel layout", () => {
  it("keeps the composer visible while only the message list scrolls", async () => {
    const [shellSource, messagesSource, composerSource] = await Promise.all([
      readSource("src/views/components/aiChatV2/AiChatV2.vue"),
      readSource("src/views/components/aiChatV2/AiChatV2Messages.vue"),
      readSource("src/views/components/aiChatV2/AiChatV2Composer.vue"),
    ]);

    const shellRule = extractRule(shellSource, ".v2-shell");
    const bodyRule = extractRule(shellSource, ".v2-shell__body");
    const messagesRule = extractRule(messagesSource, ".v2-messages");
    const composerRule = extractRule(composerSource, ".v2-composer");

    expect(shellRule).toContain("min-height: 0");
    expect(shellRule).toContain("overflow: hidden");
    expect(bodyRule).toContain("overflow: hidden");
    expect(messagesRule).toContain("min-height: 0");
    expect(composerRule).toContain("flex: 0 0 auto");
  });
});
