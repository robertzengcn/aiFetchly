import { describe, it, expect } from "vitest";
import {
  decideKnowledgeRelevance,
  DEFAULT_RELEVANCE_THRESHOLD,
  type RetrievedCandidate,
  type KnowledgeScopeConfig,
} from "@/service/emailReply/EmailReplyKnowledgeRelevance";

const openScope: KnowledgeScopeConfig = {
  allowAllDocuments: true,
  allowedDocumentIds: [],
  excludeInactiveDocuments: true,
};

function cand(
  over: Partial<RetrievedCandidate> = {}
): RetrievedCandidate {
  return {
    documentId: 1,
    documentActive: true,
    text: "Our plan costs $500 per month.",
    score: 0.9,
    isNeighbor: false,
    ...over,
  };
}

describe("decideKnowledgeRelevance — scope semantics (FR-008)", () => {
  it("empty allowlist with allowAll=false means search NOTHING", () => {
    const d = decideKnowledgeRelevance([cand()], {
      allowAllDocuments: false,
      allowedDocumentIds: [],
      excludeInactiveDocuments: true,
    });
    expect(d.outcome).toBe("scope_empty");
    expect(d.selections).toHaveLength(0);
    expect(d.reviewReason).toBeTruthy();
  });

  it("drops candidates outside the mailbox allowlist (cross-mailbox isolation)", () => {
    const d = decideKnowledgeRelevance(
      [cand({ documentId: 1 }), cand({ documentId: 2 })],
      {
        allowAllDocuments: false,
        allowedDocumentIds: [1],
        excludeInactiveDocuments: true,
      }
    );
    expect(d.droppedByScope).toBe(1);
    expect(d.selections.every((s) => s.documentId === 1)).toBe(true);
  });

  it("excludes inactive documents when policy says so", () => {
    const d = decideKnowledgeRelevance(
      [cand({ documentActive: false }), cand({ documentActive: true })],
      openScope
    );
    expect(d.droppedInactive).toBe(1);
    expect(d.selections).toHaveLength(1);
  });
});

describe("decideKnowledgeRelevance — relevance + abstention (FR-009)", () => {
  it("returns relevant for a direct qualifying match", () => {
    const d = decideKnowledgeRelevance([cand({ score: 0.9 })], openScope);
    expect(d.outcome).toBe("relevant");
    expect(d.selections[0].score).toBe(0.9);
  });

  it("abstains (low_relevance) when no direct match clears the threshold", () => {
    const d = decideKnowledgeRelevance([cand({ score: 0.3 })], openScope);
    expect(d.outcome).toBe("low_relevance");
    expect(d.selections).toHaveLength(0);
    expect(d.reviewReason).toMatch(/do not answer/i);
  });

  it("a neighbor chunk NEVER qualifies by inherited score", () => {
    const d = decideKnowledgeRelevance(
      [cand({ score: 0.99, isNeighbor: true })],
      openScope
    );
    expect(d.outcome).toBe("low_relevance");
  });

  it("neighbors may accompany a qualifying direct match", () => {
    const d = decideKnowledgeRelevance(
      [
        cand({ score: 0.9, isNeighbor: false, text: "pricing is $500" }),
        cand({
          score: 0.9,
          isNeighbor: true,
          text: "continuation of the pricing paragraph",
        }),
      ],
      openScope
    );
    expect(d.outcome).toBe("relevant");
    // The neighbor rode along but the outcome is driven by the direct match.
    expect(d.selections.length).toBeGreaterThanOrEqual(1);
  });

  it("removes duplicate / substantially-overlapping chunks", () => {
    const d = decideKnowledgeRelevance(
      [
        cand({ score: 0.9, text: "our plan costs $500 per month for the pro tier" }),
        cand({
          score: 0.85,
          text: "our plan costs $500 per month for the pro tier with support",
        }),
      ],
      openScope
    );
    expect(d.droppedDuplicate).toBe(1);
    expect(d.selections).toHaveLength(1);
  });

  it("flags conflicting money values as conflicting -> review", () => {
    const d = decideKnowledgeRelevance(
      [
        cand({ score: 0.9, text: "Plan price is $500." }),
        cand({ score: 0.88, text: "Plan price is $750." }),
      ],
      openScope
    );
    expect(d.outcome).toBe("conflicting");
    expect(d.reviewReason).toMatch(/money/);
  });

  it("no_results when everything was filtered out", () => {
    const d = decideKnowledgeRelevance(
      [cand({ documentActive: false })],
      openScope
    );
    expect(d.outcome).toBe("no_results");
  });

  it("records the threshold + profile for versioned audit metadata", () => {
    const d = decideKnowledgeRelevance([cand()], openScope, { threshold: 0.7 });
    expect(d.threshold).toBe(0.7);
    expect(d.thresholdProfile).toBeTruthy();
    expect(DEFAULT_RELEVANCE_THRESHOLD).toBeGreaterThan(0);
  });
});
