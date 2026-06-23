import { describe, it, expect } from "vitest";
import { matchesHookMatcher } from "@/service/hooks/HookMatcher";

describe("matchesHookMatcher", () => {
  it("matches everything when matcher is undefined", () => {
    expect(matchesHookMatcher(undefined, "anything")).toBe(true);
    expect(matchesHookMatcher(undefined, "")).toBe(true);
  });

  it("matches everything when matcher is '*'", () => {
    expect(matchesHookMatcher("*", "shell_execute")).toBe(true);
    expect(matchesHookMatcher("*", "mcp_foo")).toBe(true);
  });

  it("matches exact names", () => {
    expect(matchesHookMatcher("shell_execute", "shell_execute")).toBe(true);
    expect(matchesHookMatcher("shell_execute", "Shell_Execute")).toBe(false);
    expect(matchesHookMatcher("shell_execute", "shell_execute_safe")).toBe(
      false
    );
  });

  it("matches suffix wildcards (mcp_*)", () => {
    expect(matchesHookMatcher("mcp_*", "mcp_foo")).toBe(true);
    expect(matchesHookMatcher("mcp_*", "mcp_")).toBe(true);
    expect(matchesHookMatcher("mcp_*", "mcp")).toBe(false);
    expect(matchesHookMatcher("mcp_*", "other_mcp_thing")).toBe(false);
  });

  it("matches prefix wildcards (*_search)", () => {
    expect(matchesHookMatcher("*_search", "google_search")).toBe(true);
    expect(matchesHookMatcher("*_search", "_search")).toBe(true);
    expect(matchesHookMatcher("*_search", "google_search_more")).toBe(false);
  });

  it("matches contains wildcards (scrape_*_urls)", () => {
    expect(matchesHookMatcher("scrape_*_urls", "scrape_contact_urls")).toBe(
      true
    );
    // `*` can match empty, but the literal `_urls` suffix must still follow.
    expect(matchesHookMatcher("scrape_*_urls", "scrape__urls")).toBe(true);
    expect(matchesHookMatcher("scrape_*_urls", "scrape_urls")).toBe(false);
    expect(matchesHookMatcher("scrape_*_urls", "scrape_urls_more")).toBe(false);
  });

  it("rejects empty matcher", () => {
    expect(matchesHookMatcher("", "shell_execute")).toBe(false);
  });

  it("rejects oversized matcher", () => {
    const huge = "a".repeat(129);
    expect(matchesHookMatcher(huge, "a".repeat(129))).toBe(false);
  });

  it("escapes regex metacharacters except star", () => {
    expect(matchesHookMatcher("a.b", "a.b")).toBe(true);
    expect(matchesHookMatcher("a.b", "axb")).toBe(false);
    expect(matchesHookMatcher("a[bc]", "a[bc]")).toBe(true);
    expect(matchesHookMatcher("(group)", "(group)")).toBe(true);
  });

  it("anchors the matcher on both ends", () => {
    expect(matchesHookMatcher("shell_execute", "prefix_shell_execute")).toBe(
      false
    );
    expect(matchesHookMatcher("shell_execute", "shell_execute_suffix")).toBe(
      false
    );
  });
});
