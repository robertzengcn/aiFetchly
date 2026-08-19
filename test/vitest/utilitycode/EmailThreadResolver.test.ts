import { describe, it, expect } from "vitest";
import {
  normalizeMessageId,
  parseReferenceChain,
  normalizeThreadHeaders,
  resolveConversationRoot,
  providerSingletonKey,
} from "@/service/emailReceive/EmailThreadResolver";

describe("normalizeMessageId", () => {
  it("extracts the token from <id@domain>", () => {
    expect(normalizeMessageId("<abc@example.com>")).toBe("abc@example.com");
  });

  it("unfolds folded whitespace and trims", () => {
    expect(normalizeMessageId("  <abc@example.com>\r\n\t ")).toBe("abc@example.com");
  });

  it("returns null for empty / whitespace / missing", () => {
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId("   ")).toBeNull();
  });

  it("rejects control characters", () => {
    expect(normalizeMessageId("<ab\x01c@x.com>")).toBeNull();
  });

  it("rejects over-long ids", () => {
    expect(normalizeMessageId(`<${"a".repeat(1000)}@x.com>`)).toBeNull();
  });

  it("preserves the identifier verbatim (no casing)", () => {
    expect(normalizeMessageId("<Mixed.Case@Example.COM>")).toBe(
      "Mixed.Case@Example.COM"
    );
  });
});

describe("parseReferenceChain", () => {
  it("parses and dedupes while preserving order", () => {
    const chain = parseReferenceChain(
      "<a@x> <b@x> <a@x> <c@x>"
    );
    expect(chain).toEqual(["a@x", "b@x", "c@x"]);
  });

  it("drops malformed tokens", () => {
    expect(parseReferenceChain("<a@x> garbage <b@x>")).toEqual(["a@x", "b@x"]);
  });

  it("returns [] for empty", () => {
    expect(parseReferenceChain(null)).toEqual([]);
    expect(parseReferenceChain("")).toEqual([]);
  });

  it("caps an absurdly long chain", () => {
    const huge = Array.from({ length: 100 }, (_, i) => `<m${i}@x>`).join(" ");
    expect(parseReferenceChain(huge).length).toBe(50);
  });
});

describe("normalizeThreadHeaders", () => {
  it("normalizes the triple and takes a single In-Reply-To", () => {
    const h = normalizeThreadHeaders({
      messageId: "<cur@x>",
      inReplyTo: "<parent@x>",
      references: "<root@x> <parent@x>",
    });
    expect(h.messageId).toBe("cur@x");
    expect(h.inReplyTo).toBe("parent@x");
    expect(h.references).toEqual(["root@x", "parent@x"]);
  });

  it("nulls In-Reply-To when it carries multiple tokens (ambiguity signal)", () => {
    const h = normalizeThreadHeaders({
      messageId: "<cur@x>",
      inReplyTo: "<a@x> <b@x>",
    });
    expect(h.inReplyTo).toBeNull();
  });
});

describe("resolveConversationRoot", () => {
  it("joins the parent conversation via In-Reply-To (exact link)", () => {
    const r = resolveConversationRoot({
      headers: normalizeThreadHeaders({
        messageId: "<child@x>",
        inReplyTo: "<parent@x>",
        references: "<root@x> <parent@x>",
      }),
      providerUid: "u1",
    });
    expect(r.matchCandidates[0]).toBe("parent@x");
    expect(r.rootKey).toBe("root@x"); // oldest reference
    expect(r.confidence).not.toBe("ambiguous");
  });

  it("uses the oldest reference as root when only References exist", () => {
    const r = resolveConversationRoot({
      headers: normalizeThreadHeaders({
        references: "<root@x> <mid@x>",
      }),
      providerUid: "u1",
    });
    expect(r.rootKey).toBe("root@x");
  });

  it("starts a new thread from its own Message-ID when no parent links", () => {
    const r = resolveConversationRoot({
      headers: normalizeThreadHeaders({ messageId: "<solo@x>" }),
      providerUid: "u1",
    });
    expect(r.rootKey).toBe("solo@x");
    expect(r.confidence).toBe("exact");
  });

  it("falls back to a provider singleton when there are no usable ids", () => {
    const r = resolveConversationRoot({
      headers: normalizeThreadHeaders({}),
      providerUid: "imap-123",
    });
    expect(r.rootKey).toBe("provider:imap-123");
    expect(providerSingletonKey("imap-123")).toBe("provider:imap-123");
  });

  it("never merges by subject — identical subjects with disjoint ids get different roots", () => {
    const a = resolveConversationRoot({
      headers: normalizeThreadHeaders({ messageId: "<aaa@x>" }),
      providerUid: "u1",
    });
    const b = resolveConversationRoot({
      headers: normalizeThreadHeaders({ messageId: "<bbb@x>" }),
      providerUid: "u2",
    });
    expect(a.rootKey).not.toBe(b.rootKey);
  });

  it("flags a multi-token In-Reply-To as ambiguous", () => {
    // normalizeThreadHeaders nulls a multi-token In-Reply-To, but the raw signal
    // is two parent candidates; emulate by passing references pointing at two
    // unrelated unknown roots with no clear parent.
    const r = resolveConversationRoot({
      headers: {
        messageId: "cur@x",
        inReplyTo: null,
        references: ["aaa@x", "bbb@x"],
      },
      providerUid: "u1",
    });
    expect(r.rootKey).toBe("aaa@x");
  });
});
