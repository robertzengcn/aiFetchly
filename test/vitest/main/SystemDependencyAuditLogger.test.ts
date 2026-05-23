"use strict";
import { describe, expect, test } from "vitest";
import { sanitizeStderr } from "@/service/SystemDependencyAuditLogger";

describe("sanitizeStderr", () => {
  test("removes absolute Unix paths", () => {
    const input =
      'Error: file not found at /Users/john/.ssh/id_rsa and /etc/hosts';
    const result = sanitizeStderr(input);
    expect(result).not.toContain("/Users/john");
    expect(result).not.toContain("/etc/hosts");
    expect(result).toContain("[PATH]");
  });

  test("removes home directory references", () => {
    const input = "Config loaded from $HOME/.config and ~/Desktop";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("$HOME");
    expect(result).not.toContain("~/Desktop");
    expect(result).toContain("[HOME]");
  });

  test("truncates to 500 characters", () => {
    const input = "x".repeat(1000);
    const result = sanitizeStderr(input);
    expect(result.length).toBe(500);
  });

  test("does not truncate short strings", () => {
    const input = "short error";
    const result = sanitizeStderr(input);
    expect(result).toBe("short error");
  });

  test("removes ANSI escape codes", () => {
    const input = "\x1b[31mError:\x1b[0m something failed \x1b[1;32mOK\x1b[0m";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("\x1b");
    expect(result).toBe("Error: something failed OK");
  });

  test("removes common secret patterns", () => {
    const input =
      'API_KEY=sk-abc123def456 token="ghp_xxxxxxxxxxxx"';
    const result = sanitizeStderr(input);
    expect(result).not.toContain("sk-abc123def456");
    expect(result).not.toContain("ghp_xxxxxxxxxxxx");
    expect(result).toContain("[REDACTED]");
  });

  test("handles empty string", () => {
    expect(sanitizeStderr("")).toBe("");
  });

  test("handles string with only whitespace", () => {
    expect(sanitizeStderr("   ")).toBe("   ");
  });

  test("preserves safe content", () => {
    const input = "brew install poppler completed successfully";
    expect(sanitizeStderr(input)).toBe(input);
  });
});
