import { describe, expect, it } from "vitest";
import {
  PortableWorkspaceMemoryIndexService,
  summarize,
  README_MANAGED_START,
  README_MANAGED_END,
} from "@/service/PortableWorkspaceMemoryIndexService";
import type { PortableMemoryDocumentV1 } from "@/entityTypes/portableWorkspaceMemoryTypes";

const service = new PortableWorkspaceMemoryIndexService();

function doc(input: {
  readonly id: string;
  readonly type: PortableMemoryDocumentV1["frontmatter"]["type"];
  readonly title: string;
  readonly content: string;
  readonly updatedAt: string;
}): PortableMemoryDocumentV1 {
  return {
    frontmatter: {
      schema: "aifetchly.memory/v1",
      id: input.id,
      type: input.type,
      status: "active",
      confidence: 90,
      visibility: "team",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: input.updatedAt,
      createdBy: "aifetchly",
    },
    title: input.title,
    content: input.content,
    relativePath: `.aifetchly/memory/${input.id}.md`,
    contentHash: "a".repeat(64),
    sizeBytes: 100,
    mtimeMs: 0,
  };
}

const ID_A = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";
const ID_B = "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0";

describe("PortableWorkspaceMemoryIndexService", () => {
  it("generates deterministic bytes for the same record set", () => {
    const docs = [
      doc({
        id: ID_A,
        type: "decision",
        title: "Storage",
        content: "Markdown files own portable fields.",
        updatedAt: "2026-08-22T08:30:00.000Z",
      }),
    ];
    expect(service.buildIndex(docs)).toBe(service.buildIndex(docs));
  });

  it("uses max record updatedAt as the generation timestamp (never wall clock)", () => {
    const out = service.buildIndex([
      doc({
        id: ID_A,
        type: "decision",
        title: "Older",
        content: "first",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      doc({
        id: ID_B,
        type: "warning",
        title: "Newer",
        content: "second",
        updatedAt: "2026-08-22T08:30:00.000Z",
      }),
    ]);
    expect(out).toContain("Generated from records updated through: `2026-08-22T08:30:00.000Z`");
  });

  it("uses the fixed epoch for an empty index", () => {
    const out = service.buildIndex([]);
    expect(out).toContain("1970-01-01T00:00:00.000Z");
  });

  it("sorts by type priority, then title, then id", () => {
    const out = service.buildIndex([
      doc({ id: ID_B, type: "project", title: "Zeta", content: "p", updatedAt: "2026-08-01T00:00:00.000Z" }),
      doc({ id: ID_A, type: "warning", title: "Alpha", content: "w", updatedAt: "2026-08-01T00:00:00.000Z" }),
      doc({
        id: "wmem-018f2f11-1111-4111-8111-111111111111",
        type: "decision",
        title: "Beta",
        content: "d",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ]);
    const idxWarn = out.indexOf("[warning]");
    const idxDecision = out.indexOf("[decision]");
    const idxProject = out.indexOf("[project]");
    expect(idxWarn).toBeGreaterThanOrEqual(0);
    expect(idxWarn).toBeLessThan(idxDecision);
    expect(idxDecision).toBeLessThan(idxProject);
  });

  it("links each entry to its record file", () => {
    const out = service.buildIndex([
      doc({ id: ID_A, type: "decision", title: "Storage", content: "c", updatedAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(out).toContain(`(./${ID_A}.md)`);
  });

  it("truncates summaries at 240 code points with an ellipsis", () => {
    const long = "word ".repeat(100);
    const s = summarize(long);
    expect([...s].length).toBeLessThanOrEqual(241);
    expect(s.endsWith("…")).toBe(true);
  });

  it("prefers a sentence boundary when truncating", () => {
    const text = `${"filler ".repeat(30)}. This is the important sentence that should survive.`;
    const s = summarize(text);
    expect(s.endsWith(".")).toBe(true);
    expect(s).not.toContain("important");
  });

  // --- README managed block -------------------------------------------------

  it("creates the README with a single managed block when absent", () => {
    const block = service.buildReadmeManagedBlock({ sharingMode: "local" });
    const next = service.applyManagedBlock(null, block);
    expect(next).not.toBeNull();
    expect(next?.startsWith(README_MANAGED_START)).toBe(true);
    expect(next?.includes(README_MANAGED_END)).toBe(true);
  });

  it("replaces exactly one managed block and preserves user content", () => {
    const block = service.buildReadmeManagedBlock({ sharingMode: "team" });
    const existing = `# My project notes\n\nUser content before.\n\n${block}\n\nUser content after.\n`;
    const updated = service.applyManagedBlock(
      existing,
      service.buildReadmeManagedBlock({ sharingMode: "local" })
    );
    expect(updated).not.toBeNull();
    expect(updated ?? "").toContain("# My project notes");
    expect(updated ?? "").toContain("User content before.");
    expect(updated ?? "").toContain("User content after.");
    expect(updated ?? "").toContain("**local**");
    expect((updated ?? "").split(README_MANAGED_START).length - 1).toBe(1);
  });

  it("refuses malformed or duplicated markers (returns null)", () => {
    const block = service.buildReadmeManagedBlock({ sharingMode: "local" });
    expect(
      service.applyManagedBlock(
        `${README_MANAGED_START} broken — no end marker`,
        block
      )
    ).toBeNull();
    const duplicated = service.applyManagedBlock(`${block}\n${block}`, block);
    expect(duplicated).toBeNull();
  });
});
