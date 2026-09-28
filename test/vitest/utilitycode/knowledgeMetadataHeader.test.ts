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

  it("includes Language, Document date, and one line per present custom key", () => {
    const out: string = buildEmbeddingInput(
      {
        fileName: "pricing.pdf",
        title: "Pricing",
        language: "en",
        documentDate: "2024-03-15",
        customMetadata: {
          product: "Acme",
          customer: "Globex",
          campaign: "Q3 launch",
          category: "pricing",
        },
      },
      "chunk body"
    );
    expect(out).toContain("Language: en");
    expect(out).toContain("Document date: 2024-03-15");
    expect(out).toContain("Product: Acme");
    expect(out).toContain("Customer: Globex");
    expect(out).toContain("Campaign: Q3 launch");
    expect(out).toContain("Category: pricing");
    // Body still present and after the header.
    expect(out.endsWith("chunk body")).toBe(true);
  });

  it("omits Phase 3 header lines when the values are empty", () => {
    const out: string = buildEmbeddingInput(
      {
        fileName: "a.pdf",
        title: "t",
        language: "  ",
        customMetadata: { product: "  ", customer: "ok" },
      },
      "body"
    );
    expect(out).not.toContain("Language:");
    expect(out).not.toContain("Product:");
    expect(out).toContain("Customer: ok");
    expect(out).not.toContain("Document date:");
  });

  it("iterates custom keys in the fixed allowlist order", () => {
    const out: string = buildEmbeddingInput(
      {
        fileName: "a.pdf",
        title: "t",
        // Pass keys out of order; the header must still read product,
        // customer, campaign, category.
        customMetadata: {
          category: "d",
          campaign: "c",
          customer: "b",
          product: "a",
        },
      },
      "body"
    );
    const productIdx = out.indexOf("Product: a");
    const customerIdx = out.indexOf("Customer: b");
    const campaignIdx = out.indexOf("Campaign: c");
    const categoryIdx = out.indexOf("Category: d");
    expect(productIdx).toBeLessThan(customerIdx);
    expect(customerIdx).toBeLessThan(campaignIdx);
    expect(campaignIdx).toBeLessThan(categoryIdx);
  });

  it("collapses a newline inside a custom value so it cannot inject header lines", () => {
    const out: string = buildEmbeddingInput(
      {
        fileName: "a.pdf",
        title: "t",
        customMetadata: { product: "evil\nProduct: fake" },
      },
      "body"
    );
    expect(out).toContain("Product: evil Product: fake");
    // Exactly one header "Product:" line is emitted by us; the smuggled one
    // is collapsed into the value, not a new line.
    expect(out.match(/^Product:/gm)?.length).toBe(1);
  });
});
