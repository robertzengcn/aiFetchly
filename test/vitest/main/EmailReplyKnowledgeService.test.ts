import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock RagSearchModule so the knowledge service can be tested in isolation.
const searchKnowledgeForToolMock = vi.fn();
vi.mock("@/modules/RagSearchModule", () => ({
  RagSearchModule: class {
    searchKnowledgeForTool = searchKnowledgeForToolMock;
  },
}));

import { retrieveReplyKnowledge } from "@/service/emailReply/EmailReplyKnowledgeService";

beforeEach(() => {
  searchKnowledgeForToolMock.mockReset();
});

describe("retrieveReplyKnowledge", () => {
  it("returns disabled warning when useKnowledgeLibrary is false", async () => {
    const res = await retrieveReplyKnowledge({
      emailServiceId: 7,
      subject: "Pricing",
      bodyText: "What does it cost?",
      useKnowledgeLibrary: false,
    });
    expect(res.sources).toEqual([]);
    expect(res.audits).toEqual([]);
    expect(res.warning).toMatch(/disabled by caller/);
    expect(searchKnowledgeForToolMock).not.toHaveBeenCalled();
  });

  it("maps rag results to sources + audits", async () => {
    searchKnowledgeForToolMock.mockResolvedValue({
      success: true,
      results: [
        {
          chunkId: 1,
          documentId: 10,
          documentName: "pricing.pdf",
          title: "Pricing",
          citation: "[doc:10 chunk:1 pricing.pdf]",
          content: "Plans start at $29/mo",
          score: 0.92,
        },
      ],
    });

    const res = await retrieveReplyKnowledge({
      emailServiceId: 7,
      subject: "Pricing question",
      bodyText: "How much?",
      fromName: "Prospect",
      goal: "answer pricing",
      useKnowledgeLibrary: true,
    });

    expect(res.warning).toBeNull();
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0].documentName).toBe("pricing.pdf");
    expect(res.sources[0].chunkId).toBe(1);
    expect(res.audits[0].toolName).toBe("knowledge_library_search");
    expect(res.audits[0].query).toContain("Pricing question");
    // The query passed downstream should include subject + body + sender + goal.
    expect(searchKnowledgeForToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, includeNeighborChunks: true })
    );
  });

  it("trims long snippet content to the prompt cap", async () => {
    const long = "x".repeat(2000);
    searchKnowledgeForToolMock.mockResolvedValue({
      success: true,
      results: [
        {
          chunkId: 1,
          documentId: 1,
          documentName: "d",
          content: long,
          score: 0.9,
        },
      ],
    });
    const res = await retrieveReplyKnowledge({
      emailServiceId: 7,
      subject: "s",
      bodyText: "b",
      useKnowledgeLibrary: true,
    });
    expect(res.abstained).toBe(false);
    expect(res.sources[0].content.length).toBeLessThanOrEqual(801); // 800 + ellipsis
    expect(res.sources[0].content.endsWith("…")).toBe(true);
  });

  it("returns a warning (no throw) when rag search fails", async () => {
    searchKnowledgeForToolMock.mockRejectedValue(new Error("boom"));
    const res = await retrieveReplyKnowledge({
      emailServiceId: 7,
      subject: "s",
      bodyText: "b",
      useKnowledgeLibrary: true,
    });
    expect(res.sources).toEqual([]);
    expect(res.warning).toMatch(/failed/);
  });

  it("returns a warning + abstention when rag returns no results", async () => {
    searchKnowledgeForToolMock.mockResolvedValue({
      success: true,
      results: [],
    });
    const res = await retrieveReplyKnowledge({
      emailServiceId: 7,
      subject: "s",
      bodyText: "b",
      useKnowledgeLibrary: true,
    });
    expect(res.sources).toEqual([]);
    expect(res.abstained).toBe(true);
    expect(res.warning).toMatch(/no in-scope knowledge results/);
  });

  it("abstains when the best score is below the relevance threshold", async () => {
    searchKnowledgeForToolMock.mockResolvedValue({
      success: true,
      results: [
        {
          chunkId: 1,
          documentId: 1,
          documentName: "d",
          content: "weak",
          score: 0.2,
        },
      ],
    });
    const res = await retrieveReplyKnowledge({
      emailServiceId: 7,
      subject: "s",
      bodyText: "b",
      useKnowledgeLibrary: true,
    });
    expect(res.abstained).toBe(true);
    expect(res.sources).toEqual([]);
    expect(res.warning).toMatch(/relevance threshold/);
  });
});
