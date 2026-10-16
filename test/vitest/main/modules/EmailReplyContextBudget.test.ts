import { describe, it, expect } from "vitest";
import {
  estimateTokensConservative,
  inputTokenBudget,
  fitRenderedPrompt,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  CONTEXT_SAFETY_MARGIN_TOKENS,
} from "@/service/emailReply/EmailReplyContextBudget";
import { markSuppliedKnowledgeAudits } from "@/service/emailReply/EmailReplyDraftGenerationService";
import type { EmailReplyKnowledgeSourceAudit } from "@/entityTypes/emailReceiveAiTypes";

// F06/F07 — pure unit coverage for model-aware input budgeting and
// supplied-vs-retrieved provenance. No DB, no network, no timers.

interface FakeSource {
  readonly key: string;
  readonly name: string;
  readonly text: string;
}

function source(key: string, name: string, text: string): FakeSource {
  return { key, name, text };
}

describe("estimateTokensConservative", () => {
  it("estimates ASCII at four chars per token", () => {
    expect(estimateTokensConservative("abcd")).toBe(1);
    expect(estimateTokensConservative("abcdefgh")).toBe(2);
    expect(estimateTokensConservative("")).toBe(0);
    expect(estimateTokensConservative(null)).toBe(0);
  });

  it("estimates non-ASCII conservatively (CJK/code-heavy inputs)", () => {
    // Seven CJK code points at 1.5 chars/token → ceil(4.67) = 5 tokens,
    // where a naive chars/4 heuristic would claim 2 and over-admit.
    expect(estimateTokensConservative("日本語テスト文")).toBe(5);
    // Mixed: 4 ASCII (1) + 3 CJK (2) = 3.
    expect(estimateTokensConservative("abcd日本語")).toBe(3);
  });
});

describe("inputTokenBudget", () => {
  it("reserves output plus the safety margin from the window", () => {
    expect(inputTokenBudget(10_000, 1_500)).toBe(
      10_000 - 1_500 - CONTEXT_SAFETY_MARGIN_TOKENS
    );
  });

  it("floors at zero for tiny windows", () => {
    expect(inputTokenBudget(100, 1_500)).toBe(0);
  });

  it("exposes an explicit unknown-model bound (never unlimited)", () => {
    expect(FALLBACK_CONTEXT_WINDOW_TOKENS).toBeLessThanOrEqual(32_768);
    expect(FALLBACK_CONTEXT_WINDOW_TOKENS).toBeGreaterThan(8_000);
  });
});

describe("fitRenderedPrompt", () => {
  const render = (sources: readonly FakeSource[], conversation: string | null) =>
    [
      "FRAME:",
      ...sources.map((s) => `[${s.name}] ${s.text}`),
      conversation ?? "",
      "TAIL:",
    ].join("\n");

  function fit(
    sources: FakeSource[],
    budgetTokens: number,
    conversationSection: string | null = null
  ) {
    return fitRenderedPrompt({
      systemContent: "SYSTEM",
      sources,
      sourceKey: (s) => s.key,
      sourceName: (s) => s.name,
      conversationSection,
      budgetTokens,
      renderUserMessage: render,
    });
  }

  it("keeps everything when the rendered prompt fits", () => {
    const sources = [source("1:1", "a", "x".repeat(100))];
    const result = fit(sources, 100_000);
    expect(result.fittedSources).toHaveLength(1);
    expect(result.droppedSourceKeys).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("drops least-relevant-last and names them (bounded)", () => {
    const sources = [
      source("1:1", "keep-me", "x".repeat(100)),
      source("2:2", "drop-b", "y".repeat(4_000)),
      source("3:3", "drop-a", "z".repeat(4_000)),
    ];
    const result = fit(sources, 900);
    // The first (most relevant) source survives; drops come off the end.
    expect(result.fittedSources.map((s) => s.key)).toEqual(["1:1"]);
    expect(result.droppedSourceKeys).toEqual(["3:3", "2:2"]);
    expect(result.droppedSourceNames).toEqual(["drop-a", "drop-b"]);
    expect(result.truncated).toBe(true);
  });

  it("bounds dropped names while keeping every dropped key", () => {
    const sources = Array.from(
      { length: 8 },
      (_, i) => source(`${i}:${i}`, `doc-${i}`, "w".repeat(3_000))
    );
    const result = fit(sources, 300);
    expect(result.fittedSources).toHaveLength(0);
    expect(result.droppedSourceNames.length).toBeLessThanOrEqual(5);
    expect(result.droppedSourceKeys).toHaveLength(8);
  });

  it("drops sources before touching conversation, then shortens oldest-first", () => {
    const sources = [source("1:1", "a", "x".repeat(100))];
    const conversation = "c".repeat(8_000);
    const result = fit(sources, 1_500, conversation);
    // Retrieval is expendable first: the lone source drops, then the
    // conversation shortens from the front (tail survives).
    expect(result.fittedSources).toHaveLength(0);
    expect(result.droppedSourceKeys).toEqual(["1:1"]);
    expect(result.conversationShortened).toBe(true);
    expect(result.fittedConversation).not.toBe(conversation);
    expect(result.fittedConversation!.endsWith("c".repeat(100))).toBe(true);
  });

  it("nulls a short conversation that still does not fit", () => {
    const result = fit([], 10, "c".repeat(400));
    expect(result.fittedConversation).toBeNull();
    expect(result.truncated).toBe(true);
  });

  it("measures framing overhead, not just source text", () => {
    const sources = [source("1:1", "a", "x")];
    const thin = fit(sources, 10_000);
    // FRAME:/TAIL:/name labels cost tokens beyond the single "x".
    expect(thin.promptTokens).toBeGreaterThan(
      estimateTokensConservative("x") +
        estimateTokensConservative("SYSTEM")
    );
  });

  it("terminates on adversarial inputs", () => {
    const sources = [source("1:1", "a", "x".repeat(1_000_000))];
    const result = fit(sources, 0, "c".repeat(1_000_000));
    expect(result.fittedSources).toHaveLength(0);
    expect(result.fittedConversation).toBeNull();
  });
});

describe("markSuppliedKnowledgeAudits", () => {
  function audit(
    documentId: number,
    chunkId: number
  ): EmailReplyKnowledgeSourceAudit {
    return {
      toolName: "knowledge_library_search",
      query: "pricing",
      chunkId,
      documentId,
      documentName: `doc-${documentId}`,
    };
  }

  it("marks exactly the fitted chunks supplied, preserving diagnostics", () => {
    const audits = [audit(1, 1), audit(2, 2), audit(3, 3)];
    const marked = markSuppliedKnowledgeAudits(audits, new Set(["1:1", "3:3"]));
    expect(marked.map((a) => a.suppliedToPrompt)).toEqual([true, false, true]);
    // Retrieval diagnostics survive on dropped chunks.
    expect(marked[1]?.query).toBe("pricing");
    expect(marked[1]?.documentName).toBe("doc-2");
  });

  it("marks everything supplied when nothing was dropped", () => {
    const audits = [audit(1, 1), audit(2, 2)];
    const marked = markSuppliedKnowledgeAudits(
      audits,
      new Set(["1:1", "2:2"])
    );
    expect(marked.every((a) => a.suppliedToPrompt)).toBe(true);
  });

  it("marks nothing supplied for an empty fitted set", () => {
    const audits = [audit(1, 1)];
    const marked = markSuppliedKnowledgeAudits(audits, new Set());
    expect(marked[0]?.suppliedToPrompt).toBe(false);
  });
});
