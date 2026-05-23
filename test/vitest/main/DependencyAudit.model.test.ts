"use strict";
import { describe, expect, test } from "vitest";
import { sanitizeStderr } from "@/service/SystemDependencyAuditLogger";

describe("DependencyAudit model — sanitizeStderr integration", () => {
  test("sanitizeStderr redacts secrets before storage", () => {
    const stderr =
      'Error: API key sk-abc123def456ghi789 not valid, token="ghp_xxxxxxxxxxxxxxxxxxxx"';
    const result = sanitizeStderr(stderr);
    expect(result).not.toContain("sk-abc123def456ghi789");
    expect(result).not.toContain("ghp_xxxxxxxxxxxxxxxxxxxx");
    expect(result).toContain("[REDACTED]");
  });

  test("sanitizeStderr removes absolute paths from brew errors", () => {
    const stderr =
      "Error: /opt/homebrew/Cellar/poppler/24.02.0_1 failed to build";
    const result = sanitizeStderr(stderr);
    expect(result).not.toContain("/opt/homebrew/Cellar/poppler");
    expect(result).toContain("[PATH]");
  });

  test("sanitizeStderr truncates long stderr to 500 chars", () => {
    const stderr = "x".repeat(2000);
    const result = sanitizeStderr(stderr);
    expect(result.length).toBe(500);
  });

  test("sanitizeStderr preserves safe brew output", () => {
    const stderr = "brew install poppler completed successfully";
    expect(sanitizeStderr(stderr)).toBe(stderr);
  });
});
