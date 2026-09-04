import { describe, expect, it } from "vitest";
import {
  OutboundEmailEnvelopeHasher,
  type CanonicalOutboundEnvelopeV1,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";

function envelope(
  overrides: Partial<CanonicalOutboundEnvelopeV1> = {}
): CanonicalOutboundEnvelopeV1 {
  return {
    version: 1,
    emailServiceId: 1,
    senderAddress: "Sender@Example.com",
    recipientAddress: "Recipient@Example.com",
    subject: "Hello",
    bodyText: "Hi there",
    bodyHtml: "<p>Hi</p>",
    ...overrides,
  };
}

describe("OutboundEmailEnvelopeHasher", () => {
  it("is deterministic for identical envelopes", () => {
    const a = OutboundEmailEnvelopeHasher.hashEnvelope(envelope());
    const b = OutboundEmailEnvelopeHasher.hashEnvelope(envelope());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes CRLF and CR to LF before hashing", () => {
    const crlf = envelope({
      subject: "Hello\r\nWorld",
      bodyText: "Line1\r\nLine2\rLine3",
      bodyHtml: "<p>a\r\nb</p>",
    });
    const lf = envelope({
      subject: "Hello\nWorld",
      bodyText: "Line1\nLine2\nLine3",
      bodyHtml: "<p>a\nb</p>",
    });
    expect(OutboundEmailEnvelopeHasher.hashEnvelope(crlf)).toBe(
      OutboundEmailEnvelopeHasher.hashEnvelope(lf)
    );
  });

  it("treats null HTML as distinct from empty-string HTML", () => {
    const withNull = envelope({ bodyHtml: null });
    const withEmpty = envelope({ bodyHtml: "" });
    expect(OutboundEmailEnvelopeHasher.hashEnvelope(withNull)).not.toBe(
      OutboundEmailEnvelopeHasher.hashEnvelope(withEmpty)
    );
  });

  it("lowercases the whole recipient and sender address for hashing", () => {
    const mixed = envelope({
      senderAddress: "Sender@Example.COM",
      recipientAddress: "User.Name@Example.COM",
    });
    const lower = envelope({
      senderAddress: "sender@example.com",
      recipientAddress: "user.name@example.com",
    });
    expect(OutboundEmailEnvelopeHasher.hashEnvelope(mixed)).toBe(
      OutboundEmailEnvelopeHasher.hashEnvelope(lower)
    );
  });

  it("is sensitive to content changes", () => {
    const base = OutboundEmailEnvelopeHasher.hashEnvelope(envelope());
    const changed = OutboundEmailEnvelopeHasher.hashEnvelope(
      envelope({ subject: "Hello!" })
    );
    expect(base).not.toBe(changed);
  });

  it("excludes version changes from the hash are reflected (version is part of the hash)", () => {
    // The schema version IS part of the canonical envelope (§11: include a
    // schema version). A different version yields a different hash.
    const v1 = OutboundEmailEnvelopeHasher.hashEnvelope(
      envelope({ version: 1 })
    );
    // Build a v2-ish envelope via a cast to confirm version participates.
    const v2 = OutboundEmailEnvelopeHasher.hashEnvelope({
      ...envelope(),
      version: 2,
    } as unknown as CanonicalOutboundEnvelopeV1);
    expect(v1).not.toBe(v2);
  });

  describe("hashBatch", () => {
    const envA: CanonicalOutboundEnvelopeV1 & { draftId: number } = {
      ...envelope({ recipientAddress: "b@example.com" }),
      draftId: 1,
    };
    const envB: CanonicalOutboundEnvelopeV1 & { draftId: number } = {
      ...envelope({ recipientAddress: "a@example.com" }),
      draftId: 2,
    };

    it("is deterministic regardless of input order (sorts by recipient then draftId)", () => {
      const h1 = OutboundEmailEnvelopeHasher.hashBatch([envA, envB]);
      const h2 = OutboundEmailEnvelopeHasher.hashBatch([envB, envA]);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is sensitive to envelope content", () => {
      const base = OutboundEmailEnvelopeHasher.hashBatch([envA, envB]);
      const modified = OutboundEmailEnvelopeHasher.hashBatch([
        { ...envB, subject: "Changed" },
        envA,
      ]);
      expect(base).not.toBe(modified);
    });

    it("produces a stable, documented digest for a known input", () => {
      // Snapshots guard against accidental canonicalization drift.
      const single = envelope({
        recipientAddress: "a@example.com",
        senderAddress: "s@example.com",
        subject: "Hi",
        bodyText: "Body",
        bodyHtml: null,
      });
      const env: CanonicalOutboundEnvelopeV1 & { draftId: number } = {
        ...single,
        draftId: 7,
      };
      const hash = OutboundEmailEnvelopeHasher.hashBatch([env]);
      expect(hash).toMatchSnapshot();
      expect(
        OutboundEmailEnvelopeHasher.hashEnvelope(single)
      ).toMatchSnapshot();
    });
  });
});
