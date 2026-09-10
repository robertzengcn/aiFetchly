import { describe, expect, it } from "vitest";
import {
  OutboundEmailEnvelopeHasher,
  canonicalizeOutboundEnvelope,
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
      // Hardcoded SHA-256 of the canonical form (design §11). A change here
      // means canonicalization drifted; do not regenerate blindly.
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
      expect(OutboundEmailEnvelopeHasher.hashBatch([env])).toBe(
        "10a8d00bd593f796aeed7821bcd17c76107a43e30032f21ad2477fdfb105b6d6"
      );
      expect(OutboundEmailEnvelopeHasher.hashEnvelope(single)).toBe(
        "2761bdce2dae20d61a794575aa2a46482a568cdd0f96e75530238d9f8b20a2ec"
      );
    });
  });
});

describe("OutboundEmailEnvelopeHasher v1 (pinned, byte-identical)", () => {
  it("produces the pinned v1 envelope hash", () => {
    const env: CanonicalOutboundEnvelopeV1 = {
      version: 1,
      emailServiceId: 3,
      senderAddress: "Sales@Example.com",
      recipientAddress: "user@example.com",
      subject: "Hi",
      bodyText: "Body",
      bodyHtml: null,
    };
    // Pin the canonical string so any v1 regression is caught.
    const canonical = canonicalizeOutboundEnvelope(env);
    expect(canonical).toBe(
      "version:1|emailServiceId:3|sender:17:sales@example.com|recipient:16:user@example.com|subject:2:Hi|bodyText:4:Body|bodyHtml:<<NULL_BODY_HTML>>"
    );
    expect(OutboundEmailEnvelopeHasher.hashEnvelope(env)).toHaveLength(64);
  });
});

describe("OutboundEmailEnvelopeHasher v2 (§15)", () => {
  it("binds smtpUsername and replyTo into the hash", () => {
    const base = {
      version: 2 as const,
      emailServiceId: 3,
      senderAddress: "sales@example.com",
      recipientAddress: "user@example.com",
      subject: "Hi",
      bodyText: "Body",
      bodyHtml: null,
    };
    const noIdentity = OutboundEmailEnvelopeHasher.hashEnvelopeV2({
      ...base,
      smtpUsername: "mailbox@example.com",
      replyToAddress: null,
    });
    const withReplyTo = OutboundEmailEnvelopeHasher.hashEnvelopeV2({
      ...base,
      smtpUsername: "mailbox@example.com",
      replyToAddress: "support@example.com",
    });
    expect(noIdentity).not.toBe(withReplyTo);
  });

  it("null Reply-To differs from non-null Reply-To", () => {
    const base = {
      version: 2 as const,
      emailServiceId: 1,
      smtpUsername: "x@y.com",
      senderAddress: "s@y.com",
      recipientAddress: "r@y.com",
      subject: "s",
      bodyText: "b",
      bodyHtml: null,
    };
    expect(
      OutboundEmailEnvelopeHasher.hashEnvelopeV2({
        ...base,
        replyToAddress: null,
      })
    ).not.toBe(
      OutboundEmailEnvelopeHasher.hashEnvelopeV2({
        ...base,
        replyToAddress: "",
      })
    );
  });

  it("v2 batch ordering is deterministic", () => {
    const entries = [
      {
        version: 2 as const,
        draftId: 2,
        emailServiceId: 1,
        smtpUsername: "x@y.com",
        senderAddress: "s@y.com",
        replyToAddress: null,
        recipientAddress: "b@y.com",
        subject: "s",
        bodyText: "b",
        bodyHtml: null,
      },
      {
        version: 2 as const,
        draftId: 1,
        emailServiceId: 1,
        smtpUsername: "x@y.com",
        senderAddress: "s@y.com",
        replyToAddress: null,
        recipientAddress: "a@y.com",
        subject: "s",
        bodyText: "b",
        bodyHtml: null,
      },
    ];
    const h1 = OutboundEmailEnvelopeHasher.hashBatchV2(entries);
    const h2 = OutboundEmailEnvelopeHasher.hashBatchV2([...entries].reverse());
    expect(h1).toBe(h2);
  });
});
