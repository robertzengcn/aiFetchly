import { describe, it, expect } from "vitest";
import {
  matchesHookMatcher,
  matchesHookIfCondition,
} from "@/service/hooks/HookMatcher";

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

describe("matchesHookIfCondition", () => {
  it("matches everything when condition is undefined", () => {
    expect(matchesHookIfCondition(undefined, { command: "echo hello" })).toBe(
      true
    );
    expect(matchesHookIfCondition(undefined, {})).toBe(true);
  });

  it("matches everything when condition is '*'", () => {
    expect(matchesHookIfCondition("*", { command: "anything" })).toBe(true);
    expect(matchesHookIfCondition("*", {})).toBe(true);
  });

  it("matches everything when condition is empty string", () => {
    expect(matchesHookIfCondition("", { command: "anything" })).toBe(true);
  });

  it("matches exact argument values", () => {
    expect(
      matchesHookIfCondition("echo hello", { command: "echo hello" })
    ).toBe(true);
    expect(matchesHookIfCondition("echo hello", { command: "echo world" })).toBe(
      false
    );
  });

  it("matches suffix wildcards against string args", () => {
    expect(
      matchesHookIfCondition("echo *", { command: "echo hello world" })
    ).toBe(true);
    expect(matchesHookIfCondition("echo *", { command: "echoworld" })).toBe(
      false
    );
  });

  it("matches prefix wildcards against string args", () => {
    expect(
      matchesHookIfCondition("* commit", { command: "git commit" })
    ).toBe(true);
    expect(matchesHookIfCondition("* commit", { command: "git committed" })).toBe(
      false
    );
  });

  it("matches any string arg when multiple are present", () => {
    expect(
      matchesHookIfCondition("git *", {
        command: "git push",
        path: "/tmp/repo",
      })
    ).toBe(true);
  });

  it("returns false when no string arg matches", () => {
    expect(
      matchesHookIfCondition("git *", {
        command: "echo hello",
        path: "/tmp/file.txt",
      })
    ).toBe(false);
  });

  it("returns false when toolInput is undefined", () => {
    expect(matchesHookIfCondition("echo *", undefined)).toBe(false);
  });

  it("returns false when toolInput is empty", () => {
    expect(matchesHookIfCondition("echo *", {})).toBe(false);
  });

  it("rejects oversized condition", () => {
    const huge = "a".repeat(257);
    expect(matchesHookIfCondition(huge, { command: "anything" })).toBe(false);
  });

  it("escapes regex metacharacters in condition", () => {
    expect(
      matchesHookIfCondition("a.b", { command: "a.b" })
    ).toBe(true);
    expect(
      matchesHookIfCondition("a.b", { command: "axb" })
    ).toBe(false);
  });
});
