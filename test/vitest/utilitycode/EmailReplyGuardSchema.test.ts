import { describe, it, expect } from "vitest";
import { emailReplyGuardWriteSchema } from "@/schemas/entity/emailReplyGuard";
import { canonicalReplyKey } from "@/service/emailReceive/EmailReplyIdentity";

/**
 * T07/FR-035 — guard write-schema + replyKey derivation (technical design §5.2,
 * §4.1). The guard table is created by `synchronize: true` and written through
 * `EmailReplyGuardModel` under `runReplyTxn`. The write schema must accept
 * every persisted column so `parseAndStrip` does not strip guard fields.
 */
describe("emailReplyGuardWriteSchema (T07)", () => {
  it("accepts a fully-populated guard row", () => {
    const parsed = emailReplyGuardWriteSchema().parse({
      id: 1,
      emailServiceId: 4242,
      replyKey: canonicalReplyKey({
        normalizedMessageId: "<abc@example.com>",
        rowId: 7,
      }),
      messageId: 7,
      phase: "generating",
      ownerToken: "a".repeat(128),
      leaseExpiresAt: new Date("2026-10-06T12:00:00.000Z"),
      activeDraftId: null,
      activeAttemptId: null,
    });
    expect(parsed.phase).toBe("generating");
    expect(parsed.replyKey.startsWith("rfc:")).toBe(true);
  });

  it("accepts the minimal idle-state shape (nullable/optional fields omitted)", () => {
    const parsed = emailReplyGuardWriteSchema().parse({
      emailServiceId: 4242,
      replyKey: "row:42",
      messageId: 42,
      phase: "idle",
    });
    expect(parsed.phase).toBe("idle");
    expect(parsed.ownerToken).toBeUndefined();
  });

  it("rejects an unknown phase value", () => {
    expect(() =>
      emailReplyGuardWriteSchema().parse({
        emailServiceId: 1,
        replyKey: "row:1",
        messageId: 1,
        phase: "queued",
      }),
    ).toThrow();
  });

  it("rejects an empty replyKey", () => {
    expect(() =>
      emailReplyGuardWriteSchema().parse({
        emailServiceId: 1,
        replyKey: "",
        messageId: 1,
        phase: "idle",
      }),
    ).toThrow();
  });
});

describe("canonicalReplyKey (guard keying)", () => {
  it("rfc: shape is stable across re-syncs (same normalized id → same key)", () => {
    const a = canonicalReplyKey({
      normalizedMessageId: "stable-id@domain",
      rowId: 1,
    });
    const b = canonicalReplyKey({
      normalizedMessageId: "stable-id@domain",
      rowId: 999,
    });
    expect(a).toBe(b);
    expect(a.startsWith("rfc:")).toBe(true);
  });

  it("row: fallback differs per row when no RFC id exists", () => {
    const a = canonicalReplyKey({
      normalizedMessageId: null,
      rowId: 1,
    });
    const b = canonicalReplyKey({
      normalizedMessageId: null,
      rowId: 2,
    });
    expect(a).toBe("row:1");
    expect(b).toBe("row:2");
    expect(a).not.toBe(b);
  });
});
