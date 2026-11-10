import { describe, expect, it } from "vitest";
import {
  PortableWorkspaceMemoryFormat,
  extractTitle,
} from "@/service/PortableWorkspaceMemoryFormat";
import type { PortableMemoryFileDraft } from "@/entityTypes/portableWorkspaceMemoryTypes";

const format = new PortableWorkspaceMemoryFormat();

const VALID_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";

function makeDraft(overrides: {
  readonly id?: string;
  readonly fileName?: string;
  readonly rawFrontmatter?: unknown;
  readonly markdownBody?: string;
  readonly sizeBytes?: number;
  readonly contentHash?: string;
  readonly isSymbolicLink?: boolean;
  readonly syntaxError?: string;
}): PortableMemoryFileDraft {
  const id = overrides.id ?? VALID_ID;
  return {
    relativePath: `.aifetchly/memory/${overrides.fileName ?? `${id}.md`}`,
    fileName: overrides.fileName ?? `${id}.md`,
    contentHash: overrides.contentHash ?? "a".repeat(64),
    sizeBytes: overrides.sizeBytes ?? 200,
    mtimeMs: 1,
    rawFrontmatter:
      overrides.rawFrontmatter ??
      ({
        schema: "aifetchly.memory/v1",
        id,
        type: "decision",
        status: "active",
        confidence: 95,
        visibility: "team",
        createdAt: "2026-08-22T08:30:00.000Z",
        updatedAt: "2026-08-22T08:30:00.000Z",
        createdBy: "aifetchly",
      } as Record<string, unknown>),
    markdownBody:
      overrides.markdownBody ?? "# Title\n\nBody content for the memory.",
    isSymbolicLink: overrides.isSymbolicLink ?? false,
    ...(overrides.syntaxError !== undefined
      ? { syntaxError: overrides.syntaxError }
      : {}),
  };
}

function validFrontmatter(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schema: "aifetchly.memory/v1",
    id: VALID_ID,
    type: "decision",
    status: "active",
    confidence: 95,
    visibility: "team",
    createdAt: "2026-08-22T08:30:00.000Z",
    updatedAt: "2026-08-22T09:00:00.000Z",
    createdBy: "aifetchly",
    ...overrides,
  };
}

describe("PortableWorkspaceMemoryFormat.parseDraft", () => {
  it("accepts a valid draft and extracts title and content", () => {
    const result = format.parseDraft(makeDraft({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe("Title");
    expect(result.document.content).toBe("Body content for the memory.");
    expect(result.document.frontmatter.id).toBe(VALID_ID);
    expect(result.warnings).toHaveLength(0);
  });

  it("round-trips canonical serialization through the parser", () => {
    const parsed = format.parseDraft(makeDraft({ rawFrontmatter: validFrontmatter() }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const serialized = format.serialize(parsed.document);
    const reparsed = format.parseDraft(
      makeDraft({
        rawFrontmatter: parseFrontmatterBlock(serialized),
        markdownBody: serialized.replace(/^---[\s\S]*?---\n\n/, ""),
        contentHash: "b".repeat(64),
      })
    );
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.document.frontmatter).toEqual(parsed.document.frontmatter);
    expect(reparsed.document.title).toBe(parsed.document.title);
    expect(reparsed.document.content).toBe(parsed.document.content);
  });

  it("produces byte-stable serialized output for the same document", () => {
    const parsed = format.parseDraft(makeDraft({ rawFrontmatter: validFrontmatter() }));
    if (!parsed.ok) throw new Error("parse failed");
    expect(format.serialize(parsed.document)).toBe(
      format.serialize(parsed.document)
    );
  });

  it("emits frontmatter fields in canonical order", () => {
    const parsed = format.parseDraft(makeDraft({ rawFrontmatter: validFrontmatter() }));
    if (!parsed.ok) throw new Error("parse failed");
    const s = format.serialize(parsed.document);
    const fm = s.slice(4, s.indexOf("\n---"));
    const keys = fm
      .split("\n")
      .map((l) => l.split(":")[0])
      .filter(Boolean);
    expect(keys.slice(0, 9)).toEqual([
      "schema",
      "id",
      "type",
      "status",
      "confidence",
      "visibility",
      "createdAt",
      "updatedAt",
      "createdBy",
    ]);
  });

  it("rejects symlinks", () => {
    const result = format.parseDraft(makeDraft({ isSymbolicLink: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("memory-symlink-rejected");
  });

  it("rejects oversized files", () => {
    const result = format.parseDraft(makeDraft({ sizeBytes: 17 * 1024 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("memory-file-too-large");
  });

  it("rejects unsupported schema versions", () => {
    const result = format.parseDraft(
      makeDraft({ rawFrontmatter: validFrontmatter({ schema: "aifetchly.memory/v2" }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("memory-schema-unsupported");
  });

  it("rejects invalid memory ids", () => {
    const result = format.parseDraft(
      makeDraft({ rawFrontmatter: validFrontmatter({ id: "not-a-uuid" }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("memory-id-invalid");
  });

  it("rejects filename/id mismatches", () => {
    const other = "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0";
    const result = format.parseDraft(
      makeDraft({ fileName: `${other}.md` })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("memory-id-path-mismatch");
  });

  it("rejects invalid enums, confidence, timestamps", () => {
    for (const [field, value] of [
      ["type", "random"],
      ["status", "deleted"],
      ["visibility", "public"],
      ["createdBy", "machine"],
    ] as const) {
      const r = format.parseDraft(
        makeDraft({ rawFrontmatter: validFrontmatter({ [field]: value }) })
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.diagnostic.code).toBe("memory-field-invalid");
    }
    expect(
      format.parseDraft(makeDraft({ rawFrontmatter: validFrontmatter({ confidence: 101 }) })).ok
    ).toBe(false);
    expect(
      format.parseDraft(makeDraft({ rawFrontmatter: validFrontmatter({ confidence: 1.5 }) })).ok
    ).toBe(false);
    expect(
      format.parseDraft(
        makeDraft({ rawFrontmatter: validFrontmatter({ createdAt: "2026-08-22 08:30:00" }) })
      ).ok
    ).toBe(false);
    expect(
      format.parseDraft(
        makeDraft({
          rawFrontmatter: validFrontmatter({
            createdAt: "2026-08-22T09:00:00.000Z",
            updatedAt: "2026-08-22T08:30:00.000Z",
          }),
        })
      ).ok
    ).toBe(false);
  });

  it("ignores unknown fields with a recoverable warning", () => {
    const result = format.parseDraft(
      makeDraft({ rawFrontmatter: validFrontmatter({ color: "red", nested: { a: 1 } }) })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(
      result.warnings.every((w) => w.code === "memory-field-invalid" && w.recoverable)
    ).toBe(true);
  });

  it("validates bounded id arrays and tags", () => {
    expect(
      format.parseDraft(
        makeDraft({ rawFrontmatter: validFrontmatter({ supersedes: ["bad-id"] }) })
      ).ok
    ).toBe(false);
    expect(
      format.parseDraft(
        makeDraft({
          rawFrontmatter: validFrontmatter({
            tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
          }),
        })
      ).ok
    ).toBe(false);
    const okTags = format.parseDraft(
      makeDraft({ rawFrontmatter: validFrontmatter({ tags: ["Docker", " deploy "] }) })
    );
    expect(okTags.ok).toBe(true);
    if (!okTags.ok) return;
    expect(okTags.document.frontmatter.tags).toEqual(["docker", "deploy"]);
  });

  it("rejects secret-like content", () => {
    const r = format.parseDraft(
      makeDraft({
        markdownBody: "# Deploy key\n\nUse sk-abcdefghijklmnop1234 for deploys.",
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostic.code).toBe("memory-secret-rejected");
  });

  it("rejects missing H1 / empty content / oversized content", () => {
    expect(
      format.parseDraft(makeDraft({ markdownBody: "no heading at all" })).ok
    ).toBe(false);
    expect(format.parseDraft(makeDraft({ markdownBody: "# Only title" })).ok).toBe(
      false
    );
    const long = "x".repeat(8001);
    expect(
      format.parseDraft(makeDraft({ markdownBody: `# T\n\n${long}` })).ok
    ).toBe(false);
  });

  it("extracts the first H1 outside code fences", () => {
    const body = "```md\n# Not a title\n```\n\n# Real Title\n\nContent";
    const r = extractTitle(body);
    expect(r?.title).toBe("Real Title");
    expect(r?.content).toBe("Content");
  });

  it("normalizes CRLF and handles multiple H1s (first wins)", () => {
    const r = format.parseDraft(
      makeDraft({
        markdownBody: "# First\r\n\r\nWindows content.\r\n\r\n# Second\r\n\r\nMore.",
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.document.title).toBe("First");
    expect(r.document.content).toContain("Windows content.");
    expect(r.document.content).toContain("# Second");
  });
});

function parseFrontmatterBlock(serialized: string): unknown {
  // Extract the YAML between the --- fences and parse with js-yaml.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const yaml = require("js-yaml") as typeof import("js-yaml");
  const start = serialized.indexOf("---\n") + 4;
  const end = serialized.indexOf("\n---", start);
  return yaml.load(serialized.slice(start, end));
}
