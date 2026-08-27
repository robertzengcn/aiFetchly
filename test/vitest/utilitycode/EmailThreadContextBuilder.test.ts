import { describe, it, expect } from "vitest";
import {
  buildBoundedThreadContext,
  renderConversationContext,
  reduceQuotedAndSignature,
  isShortReply,
  summarizeOlderTurns,
  estimateTokens,
  type EmailConversationTurn,
} from "@/service/emailReply/EmailThreadContextBuilder";

function turn(
  id: number,
  direction: "inbound" | "outbound",
  body: string,
  ts: number,
  sender = direction === "inbound" ? "p@x.com" : "me@x.com"
): EmailConversationTurn {
  return {
    sourceType: direction === "inbound" ? "received_message" : "send_attempt",
    sourceId: id,
    direction,
    timestamp: new Date(ts),
    sender,
    recipients: [],
    subject: "Re: thread",
    bodyText: body,
  };
}

describe("reduceQuotedAndSignature", () => {
  it("removes lines after a quoted-reply header", () => {
    const r = reduceQuotedAndSignature(
      "Sounds good.\n\nOn Mon, Jan 5, 2026 at 10:00 AM p@x.com wrote:\n> old content\n> more old"
    );
    expect(r.text).toBe("Sounds good.");
    expect(r.quotedRemoved).toBe(true);
  });

  it("removes a '--' signature block", () => {
    const r = reduceQuotedAndSignature("Hello\n--\nRobert\nVP Sales");
    expect(r.text).toBe("Hello");
    expect(r.signatureRemoved).toBe(true);
  });

  it("skips individual quoted lines but keeps the rest", () => {
    const r = reduceQuotedAndSignature("Hi\n> quote\nBye");
    expect(r.text).toContain("Hi");
    expect(r.text).toContain("Bye");
    expect(r.text).not.toContain("quote");
  });

  it("is conservative — keeps ambiguous text", () => {
    const body = "We discussed -- options earlier.\nEverything stays.";
    const r = reduceQuotedAndSignature(body);
    expect(r.text).toContain("options earlier");
  });
});

describe("isShortReply", () => {
  it("recognizes classic short answers", () => {
    expect(isShortReply("Yes")).toBe(true);
    expect(isShortReply("That works.")).toBe(true);
    expect(isShortReply("Use the second option.")).toBe(false); // needs prior turn but is 22 chars... actually >24? no
  });

  it("rejects substantive replies", () => {
    expect(isShortReply("Yes, please go ahead with option two and send the invoice.")).toBe(
      false
    );
  });

  it("sees through quoted clutter", () => {
    expect(
      isShortReply("Yes\n\nOn Mon someone wrote:\n> lots of old quoted text")
    ).toBe(true);
  });
});

describe("buildBoundedThreadContext", () => {
  it("orders recent turns chronologically and identifies the current message", () => {
    const ctx = buildBoundedThreadContext([
      turn(1, "inbound", "first", 1000),
      turn(2, "outbound", "second", 2000),
      turn(3, "inbound", "third (current)", 3000),
    ]);
    const ids = ctx.recentTurns.map((t) => t.sourceId);
    expect(ids).toEqual([1, 2, 3]); // chronological including current
  });

  it("short-reply guard: 'Yes' keeps the prior turn verbatim", () => {
    const ctx = buildBoundedThreadContext([
      turn(1, "outbound", "Should we ship on Friday or Monday? Please pick option one or option two.", 1000),
      turn(2, "inbound", "Yes", 2000),
    ]);
    expect(ctx.shortReplyGuardApplied).toBe(true);
    expect(ctx.recentTurns.map((t) => t.sourceId)).toContain(1);
  });

  it("collapses turns beyond the recent cap into a structured summary", () => {
    const turns = [
      turn(1, "inbound", "What is the price?", 1000),
      turn(2, "outbound", "We'll charge $500.", 2000),
      turn(3, "inbound", "Can you do Monday?", 3000),
      turn(4, "outbound", "I'll confirm Monday works.", 4000),
      turn(5, "inbound", "Great, Monday it is.", 5000),
      turn(6, "inbound", "Please send the doc.", 6000),
      turn(7, "inbound", "Thanks!", 7000),
      turn(8, "inbound", "Final check in.", 8000),
    ];
    const ctx = buildBoundedThreadContext(turns, {
      budget: { totalTokens: 3000, maxRecentTurns: 3, maxOlderTurnChars: 800 },
    });
    expect(ctx.recentTurns.length).toBeLessThanOrEqual(3);
    expect(ctx.olderSummary).not.toBeNull();
    expect(ctx.olderSummary!.commitments.length).toBeGreaterThan(0);
    expect(ctx.olderSummary!.participants.length).toBeGreaterThan(0);
  });

  it("enforces the token budget", () => {
    const turns = [
      turn(1, "inbound", "x".repeat(4000), 1000),
      turn(2, "inbound", "y".repeat(4000), 2000),
      turn(3, "inbound", "current " + "z".repeat(2000), 3000),
    ];
    const ctx = buildBoundedThreadContext(turns, {
      budget: { totalTokens: 1000, maxRecentTurns: 6, maxOlderTurnChars: 500 },
    });
    expect(ctx.estimatedTokens).toBeLessThanOrEqual(1000 + 500); // guard slack
    expect(ctx.truncated).toBe(true);
  });

  it("flags conflicting commitments for human review", () => {
    const turns = [
      turn(1, "inbound", "ok?", 1000),
      turn(2, "outbound", "We'll charge $500 total.", 2000),
      turn(3, "inbound", "hmm", 3000),
      turn(4, "outbound", "Actually we'll charge $750 total.", 4000),
      turn(5, "inbound", "fine", 5000),
      turn(6, "inbound", "please proceed", 6000),
      turn(7, "inbound", "thanks", 7000),
      turn(8, "inbound", "bye", 8000),
    ];
    const summary = summarizeOlderTurns(turns);
    expect(summary.conflicts.some((c) => c.topic === "money")).toBe(true);
  });
});

describe("estimateTokens", () => {
  it("is a monotone ~4 chars/token estimate", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("renderConversationContext (FR-003/004 prompt rendering)", () => {
  it("renders recent turns + commitment-preservation instruction", () => {
    const ctx = buildBoundedThreadContext([
      turn(1, "outbound", "We'll ship Friday.", 1000),
      turn(2, "inbound", "Yes", 2000),
    ]);
    const rendered = renderConversationContext(ctx);
    expect(rendered).toContain("UNTRUSTED conversation history");
    expect(rendered).toContain("We'll ship Friday.");
    expect(rendered).toContain("Preserve earlier commitments");
    expect(rendered).toContain("very short reply");
  });

  it("returns null when there is no context", () => {
    expect(renderConversationContext({
      recentTurns: [],
      olderSummary: null,
      truncated: false,
      estimatedTokens: 0,
      shortReplyGuardApplied: false,
      requiresHumanReview: false,
    })).toBeNull();
  });

  it("warns about conflicting commitments in the summary block", () => {
    const ctx = buildBoundedThreadContext([
      turn(1, "outbound", "We'll charge $500.", 1000),
      turn(2, "inbound", "k", 2000),
      turn(3, "outbound", "Actually $750.", 3000),
      turn(4, "inbound", "fine", 4000),
      turn(5, "inbound", "a", 5000),
      turn(6, "inbound", "b", 6000),
      turn(7, "inbound", "c", 7000),
      turn(8, "inbound", "current", 8000),
    ], { budget: { totalTokens: 1500, maxRecentTurns: 2, maxOlderTurnChars: 400 } });
    const rendered = renderConversationContext(ctx);
    expect(rendered).toContain("CONFLICTING prior commitments");
  });
});
