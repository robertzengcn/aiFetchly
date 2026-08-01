import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@/service/pluginCompat/claudeFrontmatterParser";

describe("parseFrontmatter", () => {
  it("returns empty object when no frontmatter present", () => {
    expect(parseFrontmatter("just markdown\n# heading")).toEqual({
      frontmatter: {},
      body: "just markdown\n# heading",
    });
  });

  it("parses name, description, version", () => {
    const md = `---
name: lead-research
description: Use when the user asks about lead research.
version: 1.2.0
---
body content`;
    expect(parseFrontmatter(md)).toEqual({
      frontmatter: {
        name: "lead-research",
        description: "Use when the user asks about lead research.",
        version: "1.2.0",
      },
      body: "body content",
    });
  });

  it("parses flow-style array allowed-tools", () => {
    const md = `---
name: foo
allowed-tools: [search, browse]
---
body`;
    expect(parseFrontmatter(md).frontmatter["allowed-tools"]).toEqual([
      "search",
      "browse",
    ]);
  });

  it("parses block-style array allowed-tools", () => {
    const md = `---
name: foo
allowed-tools:
  - search
  - browse
---
body`;
    expect(parseFrontmatter(md).frontmatter["allowed-tools"]).toEqual([
      "search",
      "browse",
    ]);
  });

  it("parses boolean true/false", () => {
    const md = `---
name: foo
flag: true
---
body`;
    expect(parseFrontmatter(md).frontmatter.flag).toBe(true);
  });

  it("parses integer", () => {
    const md = `---
name: foo
count: 42
---
body`;
    expect(parseFrontmatter(md).frontmatter.count).toBe(42);
  });

  it("ignores lines without colon inside frontmatter block", () => {
    const md = `---
garbage line
name: foo
---
body`;
    const result = parseFrontmatter(md);
    expect(result.frontmatter.name).toBe("foo");
    expect(Object.keys(result.frontmatter)).toEqual(["name"]);
  });

  it("stops at first closing --- even if body contains ---", () => {
    const md = `---
name: foo
---
body
---
more body`;
    const result = parseFrontmatter(md);
    expect(result.frontmatter.name).toBe("foo");
    expect(result.body).toBe("body\n---\nmore body");
  });

  it("handles CRLF line endings", () => {
    const md = "---\r\nname: foo\r\n---\r\nbody";
    expect(parseFrontmatter(md).frontmatter.name).toBe("foo");
  });

  it("handles empty frontmatter block", () => {
    const md = `---
---
body`;
    expect(parseFrontmatter(md)).toEqual({ frontmatter: {}, body: "body" });
  });

  it("returns empty object when first line is not ---", () => {
    expect(
      parseFrontmatter("--- not a delimiter\nname: foo").frontmatter
    ).toEqual({});
  });
});
