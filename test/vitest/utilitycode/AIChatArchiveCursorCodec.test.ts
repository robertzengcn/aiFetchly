import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  encodeSourceId,
  decodeSourceId,
  type CursorPayload,
} from "@/service/AIChatArchiveCursorCodec";

const VALID_PAYLOAD: CursorPayload = {
  v: 1,
  conversationId: "v2-abc",
  epoch: "11111111-2222-3333-4444-555555555555",
  revision: 3,
  lastTimestampMs: 1_700_000_000_000,
  lastRowId: 42,
  direction: "forward",
};

describe("AIChatArchiveCursorCodec", () => {
  describe("encodeCursor / decodeCursor round-trip", () => {
    it("decodes an encoded cursor matching the same conversation + epoch", () => {
      const encoded = encodeCursor(VALID_PAYLOAD);
      const decoded = decodeCursor(
        encoded,
        "v2-abc",
        "11111111-2222-3333-4444-555555555555"
      );
      expect(decoded).not.toBeNull();
      expect(decoded?.lastRowId).toBe(42);
      expect(decoded?.revision).toBe(3);
    });

    it("is opaque (not human-readable JSON)", () => {
      const encoded = encodeCursor(VALID_PAYLOAD);
      expect(encoded).not.toContain("v2-abc");
      expect(encoded).not.toContain("{");
    });
  });

  describe("scope isolation (rejects cross-conversation/cross-epoch cursors)", () => {
    it("returns null when conversationId differs", () => {
      const encoded = encodeCursor(VALID_PAYLOAD);
      expect(
        decodeCursor(
          encoded,
          "v2-DIFFERENT",
          "11111111-2222-3333-4444-555555555555"
        )
      ).toBeNull();
    });

    it("returns null when epoch differs", () => {
      const encoded = encodeCursor(VALID_PAYLOAD);
      expect(
        decodeCursor(encoded, "v2-abc", "00000000-0000-0000-0000-000000000000")
      ).toBeNull();
    });

    it("returns null for a non-string input", () => {
      expect(decodeCursor(null, "v2-abc", "ep")).toBeNull();
      expect(decodeCursor(undefined, "v2-abc", "ep")).toBeNull();
      expect(decodeCursor(123, "v2-abc", "ep")).toBeNull();
    });

    it("returns null for an oversized string", () => {
      expect(decodeCursor("x".repeat(2048), "v2-abc", "ep")).toBeNull();
    });

    it("returns null for malformed base64url", () => {
      expect(decodeCursor("!!!not-base64!!!", "v2-abc", "ep")).toBeNull();
    });

    it("returns null for valid base64url of non-JSON", () => {
      const encoded = Buffer.from("not json", "utf8").toString("base64url");
      expect(decodeCursor(encoded, "v2-abc", "ep")).toBeNull();
    });

    it("returns null for JSON missing required fields", () => {
      const partial = Buffer.from(
        JSON.stringify({ v: 1, conversationId: "v2-abc" }),
        "utf8"
      ).toString("base64url");
      expect(
        decodeCursor(partial, "v2-abc", "11111111-2222-3333-4444-555555555555")
      ).toBeNull();
    });

    it("returns null for an unknown cursor version", () => {
      const v2 = { ...VALID_PAYLOAD, v: 2 as unknown as 1 };
      const encoded = Buffer.from(JSON.stringify(v2), "utf8").toString(
        "base64url"
      );
      expect(
        decodeCursor(encoded, "v2-abc", "11111111-2222-3333-4444-555555555555")
      ).toBeNull();
    });
  });

  describe("encodeSourceId / decodeSourceId", () => {
    it("round-trips a valid source id payload", () => {
      const encoded = encodeSourceId({
        v: 1,
        epoch: "ep-1",
        revision: 5,
        rowId: 99,
        field: "content",
        startCodePoint: 0,
        endCodePoint: 100,
      });
      const decoded = decodeSourceId(encoded, "ep-1");
      expect(decoded).not.toBeNull();
      expect(decoded?.rowId).toBe(99);
      expect(decoded?.field).toBe("content");
    });

    it("rejects source id whose epoch does not match", () => {
      const encoded = encodeSourceId({
        v: 1,
        epoch: "ep-1",
        revision: 5,
        rowId: 99,
        field: "content",
        startCodePoint: 0,
        endCodePoint: 100,
      });
      expect(decodeSourceId(encoded, "ep-DIFFERENT")).toBeNull();
    });

    it("rejects a source id with inverted offsets", () => {
      const encoded = encodeSourceId({
        v: 1,
        epoch: "ep-1",
        revision: 5,
        rowId: 99,
        field: "content",
        startCodePoint: 100,
        endCodePoint: 50,
      });
      expect(decodeSourceId(encoded, "ep-1")).toBeNull();
    });

    it("rejects non-string input", () => {
      expect(decodeSourceId(null, "ep-1")).toBeNull();
      expect(decodeSourceId({}, "ep-1")).toBeNull();
    });
  });
});
