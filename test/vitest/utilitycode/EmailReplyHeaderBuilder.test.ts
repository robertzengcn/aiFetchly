import { describe, it, expect } from "vitest";
import {
  buildReplyThreadHeaders,
  buildOutboundHeaders,
  normalizeReplySubject,
  isValidHeaderValue,
} from "@/service/emailReply/EmailReplyHeaderBuilder";
import { correlationIdForMessage } from "@/service/emailReply/EmailReplyCorrelation";

describe("buildReplyThreadHeaders (FR-022)", () => {
  it("sets In-Reply-To to the normalized parent id", () => {
    const h = buildReplyThreadHeaders({
      parentMessageId: "<parent@x>",
      parentReferences: "<root@x> <parent@x>",
    });
    expect(h.inReplyTo).toBe("parent@x");
  });

  it("builds References = prior chain + parent, deduped in order", () => {
    const h = buildReplyThreadHeaders({
      parentMessageId: "<parent@x>",
      parentReferences: "<root@x> <mid@x> <parent@x>",
    });
    expect(h.references).toEqual(["root@x", "mid@x", "parent@x"]);
  });

  it("omits malformed ids rather than forwarding raw garbage", () => {
    const h = buildReplyThreadHeaders({
      parentMessageId: "not an id\x01",
      parentReferences: "garbage <ok@x> more garbage",
    });
    expect(h.inReplyTo).toBeNull();
    expect(h.references).toEqual(["ok@x"]);
  });

  it("handles a message with no usable ids at all", () => {
    const h = buildReplyThreadHeaders({
      parentMessageId: null,
      parentReferences: null,
    });
    expect(h.inReplyTo).toBeNull();
    expect(h.references).toEqual([]);
  });
});

describe("normalizeReplySubject", () => {
  it("collapses stacked Re: prefixes into one", () => {
    expect(normalizeReplySubject("Re: Re: Re: Pricing")).toBe("Re: Pricing");
  });

  it("handles fwd/aw variants and CJK reply prefixes", () => {
    expect(normalizeReplySubject("FWD: AW: hello")).toBe("Re: hello");
    expect(normalizeReplySubject("回复：回复：你好")).toBe("Re: 你好");
  });

  it("adds Re: to a bare subject", () => {
    expect(normalizeReplySubject("Pricing")).toBe("Re: Pricing");
  });

  it("survives an empty subject", () => {
    expect(normalizeReplySubject("   ")).toBe("Re:");
  });
});

describe("buildOutboundHeaders", () => {
  it("returns the validated full header set", () => {
    const out = buildOutboundHeaders({
      subject: "Re: Re: Pricing",
      recipientAddress: "p@x.com",
      parentMessageId: "<par@x>",
      parentReferences: "<r@x>",
    });
    expect(out.subject).toBe("Re: Pricing");
    expect(out.recipientAddress).toBe("p@x.com");
    expect(out.thread.inReplyTo).toBe("par@x");
    expect(out.thread.references).toEqual(["r@x", "par@x"]);
  });

  it("blocks the send on a missing/control-char recipient", () => {
    expect(() =>
      buildOutboundHeaders({
        subject: "s",
        recipientAddress: "",
        parentMessageId: null,
        parentReferences: null,
      })
    ).toThrow(/recipient/);
    expect(() =>
      buildOutboundHeaders({
        subject: "s",
        recipientAddress: "a\x01b@x.com",
        parentMessageId: null,
        parentReferences: null,
      })
    ).toThrow(/recipient/);
  });
});

describe("isValidHeaderValue", () => {
  it("rejects control chars and overlong values", () => {
    expect(isValidHeaderValue("ok@x")).toBe(true);
    expect(isValidHeaderValue("bad\x1b")).toBe(false);
    expect(isValidHeaderValue("x".repeat(999))).toBe(false);
  });
});

describe("correlationIdForMessage (FR-024)", () => {
  it("is deterministic per message and distinct across messages", () => {
    expect(correlationIdForMessage(42)).toBe(correlationIdForMessage(42));
    expect(correlationIdForMessage(42)).not.toBe(correlationIdForMessage(43));
    expect(correlationIdForMessage(42)).toMatch(/^erx-/);
  });
});
