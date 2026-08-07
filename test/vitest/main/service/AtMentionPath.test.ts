import { describe, expect, it } from "vitest";
import {
  buildDisplayText,
  buildInsertText,
  escapeGlob,
  normalizePathText,
} from "@/service/aiChatAtMentions/AtMentionPath";

describe("normalizePathText", () => {
  it("keeps a normal relative path", () => {
    expect(normalizePathText("src/main.ts")).toEqual({
      ok: true,
      path: "src/main.ts",
    });
  });

  it("strips a leading ./", () => {
    expect(normalizePathText("./src/main.ts")).toEqual({
      ok: true,
      path: "src/main.ts",
    });
  });

  it("converts backslashes to forward slashes", () => {
    expect(normalizePathText("src\\sub\\main.ts")).toEqual({
      ok: true,
      path: "src/sub/main.ts",
    });
  });

  it("preserves spaces inside the path", () => {
    expect(normalizePathText("docs/a b.md")).toEqual({
      ok: true,
      path: "docs/a b.md",
    });
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizePathText("")).toEqual({ ok: false, error: "empty" });
    expect(normalizePathText("   ")).toEqual({ ok: false, error: "empty" });
  });

  it("rejects null bytes and control characters", () => {
    expect(normalizePathText("src\tmain")).toEqual({
      ok: false,
      error: "control_chars",
    });
    expect(normalizePathText("src\x07main")).toEqual({
      ok: false,
      error: "control_chars",
    });
    expect(normalizePathText("src\0main")).toEqual({
      ok: false,
      error: "control_chars",
    });
  });

  it("does not expand ~ in phase 1", () => {
    expect(normalizePathText("~/notes.md")).toEqual({
      ok: true,
      path: "~/notes.md",
    });
  });
});

describe("buildInsertText", () => {
  it("wraps a plain file path with @", () => {
    expect(buildInsertText("src/main.ts", "file")).toBe("@src/main.ts");
  });

  it("appends trailing slash for directories", () => {
    expect(buildInsertText("src/service", "directory")).toBe("@src/service/");
  });

  it("quotes paths that contain spaces", () => {
    expect(buildInsertText("docs/a b.md", "file")).toBe('@"docs/a b.md"');
  });

  it("quotes directory paths with spaces and adds slash", () => {
    expect(buildInsertText("docs/my dir", "directory")).toBe(
      '@"docs/my dir/"'
    );
  });
});

describe("buildDisplayText", () => {
  it("returns the path with a trailing slash for directories", () => {
    expect(buildDisplayText("src/service", "directory")).toBe("src/service/");
    expect(buildDisplayText("src/main.ts", "file")).toBe("src/main.ts");
  });
});

describe("escapeGlob", () => {
  it("escapes glob magic characters literally", () => {
    expect(escapeGlob("a*b")).toBe("a[*]b");
    expect(escapeGlob("a?b")).toBe("a[?]b");
    expect(escapeGlob("a[b")).toBe("a[[]b");
  });

  it("leaves normal path text untouched", () => {
    expect(escapeGlob("src/ser")).toBe("src/ser");
  });
});
