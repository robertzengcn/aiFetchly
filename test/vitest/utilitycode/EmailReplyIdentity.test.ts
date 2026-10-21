import { describe, it, expect } from "vitest";
import {
  canonicalReplyKey,
  normalizeStoredMessageId,
  normalizedIdsMatch,
  buildNamespacedProviderUid,
  isNamespacedProviderUid,
  parseNamespacedProviderUid,
  providerUidFitsColumn,
} from "@/service/emailReceive/EmailReplyIdentity";

/**
 * T02 — canonical inbound reply identity (FR-029/FR-038, technical design §4.1).
 * Pure helpers: no DB, no I/O. The duplicate guard keys on the canonical reply
 * identity scoped to the configured email service, never on subject/sender/
 * conversation, and namespaces IMAP UIDs by (folder, UIDVALIDITY).
 */
describe("canonicalReplyKey", () => {
  it("produces an rfc: key from a normalized message id", () => {
    const key = canonicalReplyKey({
      normalizedMessageId: "abc-123@example.com",
      rowId: 42,
    });
    expect(key.startsWith("rfc:")).toBe(true);
    expect(key.length).toBeGreaterThan("rfc:".length + 8);
  });

  it("is deterministic — the same normalized id always hashes to the same key", () => {
    const a = canonicalReplyKey({
      normalizedMessageId: "stable-id@domain",
      rowId: 1,
    });
    const b = canonicalReplyKey({
      normalizedMessageId: "stable-id@domain",
      rowId: 999,
    });
    expect(a).toBe(b);
  });

  it("falls back to a row: singleton when no RFC id is present", () => {
    expect(
      canonicalReplyKey({ normalizedMessageId: null, rowId: 7 })
    ).toBe("row:7");
    expect(
      canonicalReplyKey({ normalizedMessageId: "", rowId: 7 })
    ).toBe("row:7");
  });

  it("two different normalized ids never collide", () => {
    const a = canonicalReplyKey({
      normalizedMessageId: "one@x",
      rowId: 1,
    });
    const b = canonicalReplyKey({
      normalizedMessageId: "two@x",
      rowId: 1,
    });
    expect(a).not.toBe(b);
  });
});

describe("normalizeStoredMessageId", () => {
  it("extracts the token from an <id@domain> header value", () => {
    expect(normalizeStoredMessageId("<abc-123@host.example>")).toBe(
      "abc-123@host.example"
    );
  });

  it("returns null for missing/malformed values", () => {
    expect(normalizeStoredMessageId(null)).toBeNull();
    expect(normalizeStoredMessageId("")).toBeNull();
    expect(normalizeStoredMessageId("   ")).toBeNull();
    expect(normalizeStoredMessageId("no-at-sign")).toBeNull();
  });

  it("rejects control characters", () => {
    expect(normalizeStoredMessageId("ok@x\x00bad")).toBeNull();
  });

  it("is case-preserving (no locale-sensitive casing)", () => {
    expect(normalizeStoredMessageId("<Mixed.Case@Domain>")).toBe(
      "Mixed.Case@Domain"
    );
  });
});

describe("normalizedIdsMatch", () => {
  it("matches identical normalized tokens", () => {
    expect(normalizedIdsMatch("id@x", "id@x")).toBe(true);
  });

  it("does not match different tokens", () => {
    expect(normalizedIdsMatch("a@x", "b@x")).toBe(false);
  });

  it("never matches when either side is missing (no merge-by-absence)", () => {
    expect(normalizedIdsMatch(null, null)).toBe(false);
    expect(normalizedIdsMatch("id@x", null)).toBe(false);
    expect(normalizedIdsMatch(null, "id@x")).toBe(false);
    expect(normalizedIdsMatch("", "")).toBe(false);
  });

  it("is case-sensitive — Mixed.Case differs from mixed.case", () => {
    expect(normalizedIdsMatch("Mixed.Case@x", "mixed.case@x")).toBe(false);
  });
});

describe("buildNamespacedProviderUid", () => {
  it("encodes folder hash, uidValidity, and uid", () => {
    const uid = buildNamespacedProviderUid({
      folder: "INBOX",
      uidValidity: 123456,
      uid: 789,
    });
    expect(uid.startsWith("imap:")).toBe(true);
    const parsed = parseNamespacedProviderUid(uid)!;
    expect(parsed.uidValidity).toBe("123456");
    expect(parsed.uid).toBe("789");
    // folder hash is a sha256 prefix of "INBOX"
    expect(parsed.folderHash.length).toBe(16);
  });

  it("is stable for the same folder even when uid/uidValidity differ", () => {
    const a = buildNamespacedProviderUid({
      folder: "INBOX",
      uidValidity: 1,
      uid: 1,
    });
    const b = buildNamespacedProviderUid({
      folder: "INBOX",
      uidValidity: 2,
      uid: 2,
    });
    const pa = parseNamespacedProviderUid(a)!;
    const pb = parseNamespacedProviderUid(b)!;
    expect(pa.folderHash).toBe(pb.folderHash);
    expect(pa.uidValidity).not.toBe(pb.uidValidity);
  });

  it("produces different folder hashes for different folders", () => {
    const a = buildNamespacedProviderUid({
      folder: "INBOX",
      uidValidity: 1,
      uid: 1,
    });
    const b = buildNamespacedProviderUid({
      folder: "Archive",
      uidValidity: 1,
      uid: 1,
    });
    expect(parseNamespacedProviderUid(a)!.folderHash).not.toBe(
      parseNamespacedProviderUid(b)!.folderHash
    );
  });

  it("preserves uidValidity as a string (lossless, leading zeros survive)", () => {
    const uid = buildNamespacedProviderUid({
      folder: "INBOX",
      uidValidity: "000123",
      uid: 5,
    });
    expect(parseNamespacedProviderUid(uid)!.uidValidity).toBe("000123");
  });

  it("fits within the 255-char column limit for realistic inputs", () => {
    const longFolder = "A".repeat(200);
    const uid = buildNamespacedProviderUid({
      folder: longFolder,
      uidValidity: 999999999,
      uid: 999999999,
    });
    expect(providerUidFitsColumn(uid)).toBe(true);
  });
});

describe("isNamespacedProviderUid", () => {
  it("recognizes the namespaced form", () => {
    expect(
      isNamespacedProviderUid(
        buildNamespacedProviderUid({ folder: "INBOX", uidValidity: 1, uid: 1 })
      )
    ).toBe(true);
  });

  it("rejects legacy bare UIDs", () => {
    expect(isNamespacedProviderUid("12345")).toBe(false);
    expect(isNamespacedProviderUid("POP3-UIDL-abc")).toBe(false);
  });

  it("rejects null/empty", () => {
    expect(isNamespacedProviderUid(null)).toBe(false);
    expect(isNamespacedProviderUid("")).toBe(false);
  });

  it("rejects a prefix-only string with no segments", () => {
    expect(isNamespacedProviderUid("imap:")).toBe(false);
  });
});

describe("parseNamespacedProviderUid", () => {
  it("round-trips build output", () => {
    const uid = buildNamespacedProviderUid({
      folder: "Sent",
      uidValidity: 42,
      uid: 99,
    });
    const parsed = parseNamespacedProviderUid(uid);
    expect(parsed).toEqual({
      folderHash: expect.any(String),
      uidValidity: "42",
      uid: "99",
    });
  });

  it("returns null for legacy bare UIDs and malformed values", () => {
    expect(parseNamespacedProviderUid("12345")).toBeNull();
    expect(parseNamespacedProviderUid("imap:onlyone")).toBeNull();
    expect(parseNamespacedProviderUid("imap:a:b")).toBeNull();
    expect(parseNamespacedProviderUid(null)).toBeNull();
  });

  it("rejoins a uid that itself contains a colon", () => {
    // Defensively: a UID should not contain a colon, but the parser must not
    // truncate if it does — it reassembles the tail as the uid.
    const uid = "imap:deadbeefdeadbeef:12345:weird:uid";
    const parsed = parseNamespacedProviderUid(uid)!;
    expect(parsed.uid).toBe("weird:uid");
    expect(parsed.uidValidity).toBe("12345");
  });
});
