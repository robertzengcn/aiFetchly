import { describe, expect, it } from "vitest";
import { buildEmbeddingInput } from "@/service/knowledgeMetadataHeader";

describe("buildEmbeddingInput", () => {
  it("returns body unchanged when only defaults are present", () => {
    const out: string = buildEmbeddingInput(
      {
        fileName: "memo.pdf",
        author: "User",
        tags: ["uploaded", "knowledge"],
        description: "Uploaded document: memo.pdf",
      },
      "body text"
    );
    expect(out).toBe("body text");
  });

  it("prefixes title, author, tags, description", () => {
    const out: string = buildEmbeddingInput(
      {
        fileName: "q3.pdf",
        title: "Q3 refund policy",
        author: "Alice Chen",
        tags: ["refund-policy", "enterprise"],
        description: "Refund rules",
      },
      "chunk body"
    );
    expect(
      out.startsWith(
        "Title: Q3 refund policy\nAuthor: Alice Chen\nTags: refund-policy, enterprise\nDescription: Refund rules\n\n"
      )
    ).toBe(true);
    expect(out.endsWith("chunk body")).toBe(true);
  });

  it("collapses newlines inside fields so no extra header lines are smuggled", () => {
    const out: string = buildEmbeddingInput(
      { fileName: "a.pdf", title: "t", description: "line one\nline two" },
      "body"
    );
    expect(out).toContain("Description: line one line two");
    expect(out.match(/^Description:/gm)?.length).toBe(1);
  });

  it("omits User author and default tags", () => {
    const out: string = buildEmbeddingInput(
      {
        fileName: "a.pdf",
        title: "t",
        author: "User",
        tags: ["knowledge", "uploaded"],
      },
      "body"
    );
    expect(out).toBe("Title: t\n\nbody");
  });
});
