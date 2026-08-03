import { describe, expect, it } from "vitest";
import { AtMentionParser } from "@/service/aiChatAtMentions/AtMentionParser";
import type { ChatV2AtMentionParsed } from "@/entityTypes/aiChatAtMentionTypes";

const parser = new AtMentionParser();

function pathsOf(content: string): string[] {
  return parser.extract(content).mentions.map((m) => m.pathText);
}

describe("AtMentionParser.extract", () => {
  it("extracts a basic file mention", () => {
    const result = parser.extract("Review @src/main.ts please");
    expect(result.mentions).toHaveLength(1);
    const m = result.mentions[0] as ChatV2AtMentionParsed;
    expect(m.pathText).toBe("src/main.ts");
    expect(m.rawText).toBe("@src/main.ts");
    expect(m.quoted).toBe(false);
    expect(m.startIndex).toBe(7);
    expect(m.endIndex).toBe(19); // exclusive
    expect(m.lineStart).toBeUndefined();
    expect(m.lineEnd).toBeUndefined();
    expect(result.truncated).toBe(false);
  });

  it("extracts a mention at start of input", () => {
    const m = parser.extract("@src/main.ts")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.startIndex).toBe(0);
    expect(m.pathText).toBe("src/main.ts");
  });

  it("extracts a quoted path with spaces", () => {
    const m = parser.extract('see @"docs/path with spaces.md" now')
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.pathText).toBe("docs/path with spaces.md");
    expect(m.quoted).toBe(true);
    expect(m.rawText).toBe('@"docs/path with spaces.md"');
  });

  it("extracts a single line range #L10", () => {
    const m = parser.extract("@src/main.ts#L10")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.pathText).toBe("src/main.ts");
    expect(m.lineStart).toBe(10);
    expect(m.lineEnd).toBeUndefined();
    expect(m.parseError).toBeUndefined();
  });

  it("extracts a multi-line range #L10-20", () => {
    const m = parser.extract("@src/main.ts#L10-20")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.pathText).toBe("src/main.ts");
    expect(m.lineStart).toBe(10);
    expect(m.lineEnd).toBe(20);
  });

  it("flags an invalid line range where end < start", () => {
    const m = parser.extract("@src/main.ts#L20-10")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.parseError).toBe("invalid_line_range");
    expect(m.lineStart).toBe(20);
    expect(m.lineEnd).toBe(10);
  });

  it("rejects a zero start line as invalid", () => {
    const m = parser.extract("@src/main.ts#L0")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.parseError).toBe("invalid_line_range");
  });

  it("ignores common email addresses", () => {
    expect(pathsOf("contact me at email@example.com please")).toEqual([]);
    expect(pathsOf("hello@company.com")).toEqual([]);
  });

  it("ignores double-at markers @@", () => {
    expect(pathsOf("foo @@ bar")).toEqual([]);
  });

  it("does not treat a lone trailing @ as a mention", () => {
    expect(pathsOf("hello @")).toEqual([]);
  });

  it("extracts multiple distinct mentions in one message", () => {
    const result = parser.extract(
      "Compare @src/a.ts with @src/b.ts and @docs/readme.md"
    );
    expect(result.mentions.map((m) => m.pathText)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "docs/readme.md",
    ]);
  });

  it("deduplicates identical mentions", () => {
    const result = parser.extract("@src/a.ts and @src/a.ts again");
    expect(result.mentions).toHaveLength(1);
  });

  it("keeps distinct line ranges on the same file separate", () => {
    const result = parser.extract("@src/a.ts#L1-5 @src/a.ts#L10-20");
    expect(result.mentions).toHaveLength(2);
  });

  it("strips trailing prose punctuation from an unquoted mention", () => {
    const m = parser.extract("see @src/main.ts.")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.pathText).toBe("src/main.ts");
    expect(m.rawText).toBe("@src/main.ts");
    // endIndex stops before the stripped "."
    expect(m.endIndex).toBe("see @src/main.ts".length);
  });

  it("strips trailing punctuation before the line fragment", () => {
    const m = parser.extract("see @src/main.ts#L10-20.")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.pathText).toBe("src/main.ts");
    expect(m.lineStart).toBe(10);
    expect(m.lineEnd).toBe(20);
  });

  it("does not re-scan an @ inside a quoted path", () => {
    const result = parser.extract('@"docs/a@b.md" and @src/c.ts');
    expect(result.mentions.map((m) => m.pathText)).toEqual([
      "docs/a@b.md",
      "src/c.ts",
    ]);
  });

  it("ignores an unterminated quoted mention", () => {
    expect(pathsOf('see @"docs/never closed')).toEqual([]);
  });

  it("preserves directory trailing slash", () => {
    const m = parser.extract("list @src/service/ now")
      .mentions[0] as ChatV2AtMentionParsed;
    expect(m.pathText).toBe("src/service/");
  });

  it("respects the maxMentions option and reports truncation", () => {
    const result = parser.extract("@a @b @c", { maxMentions: 2 });
    expect(result.mentions).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("returns no mentions for plain text", () => {
    expect(parser.extract("just a normal message").mentions).toHaveLength(0);
  });
});
