"use strict";
import { describe, test, expect, beforeEach } from "vitest";
import { ChunkingService } from "@/service/ChunkingService";

describe("ChunkingService", () => {
  let chunkingService: ChunkingService;

  beforeEach(() => {
    chunkingService = new ChunkingService();
  });

  describe("basic functionality", () => {
    test("should be instantiated", () => {
      expect(chunkingService).toBeInstanceOf(ChunkingService);
    });
  });

  describe("markdown chunking", () => {
    interface Chunk {
      content: string;
    }

    // Access the private chunkByMarkdownStructure via an index signature so
    // the test does not need to construct a full RAGDocumentEntity.
    const chunkMarkdown = (content: string): Chunk[] => {
      const service = chunkingService as unknown as {
        chunkByMarkdownStructure(
          c: string,
          o: {
            chunkSize: number;
            overlapSize: number;
            strategy: string;
            preserveWhitespace: boolean;
            minChunkSize: number;
          }
        ): Chunk[];
      };
      return service.chunkByMarkdownStructure(content, {
        chunkSize: 1000,
        overlapSize: 0,
        strategy: "markdown",
        preserveWhitespace: false,
        minChunkSize: 0,
      });
    };

    test("breaks chunks at --- Slide N --- separators emitted by PPTX extraction", () => {
      const content = [
        "--- Slide 1 ---",
        "Quarterly revenue grew 12%.",
        "",
        "--- Slide 2 ---",
        "Operating margin improved.",
        "",
        "--- Slide 3 ---",
        "Outlook is positive.",
      ].join("\n");

      const chunks = chunkMarkdown(content);
      // The separator lines themselves are dropped; each slide becomes its own
      // chunk, so slide boundaries align with chunk boundaries.
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.some((c) => c.content.includes("Quarterly revenue"))).toBe(
        true
      );
      expect(chunks.some((c) => c.content.includes("Operating margin"))).toBe(
        true
      );
      expect(
        chunks.some((c) => c.content.includes("Outlook is positive"))
      ).toBe(true);
      // No chunk should keep the separator text verbatim.
      expect(chunks.some((c) => c.content.includes("--- Slide"))).toBe(false);
    });

    test("still breaks at existing --- Page N --- separators", () => {
      const content = [
        "--- Page 1 ---",
        "Introduction.",
        "",
        "--- Page 2 ---",
        "Conclusion.",
      ].join("\n");

      const chunks = chunkMarkdown(content);
      expect(chunks.some((c) => c.content.includes("Introduction"))).toBe(true);
      expect(chunks.some((c) => c.content.includes("Conclusion"))).toBe(true);
    });
  });
});
