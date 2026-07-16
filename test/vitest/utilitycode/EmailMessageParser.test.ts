import { describe, it, expect } from "vitest";
import {
  extractThreadKey,
  buildSnippet,
  encodeAddresses,
  decodeAddresses,
  isAutomatedSender,
} from "@/service/emailReceive/EmailMessageParser";

describe("extractThreadKey", () => {
  it("uses the first reference when present", () => {
    const key = extractThreadKey(
      "<msg-1@example>",
      "<msg-2@example>",
      "<ref-a@example> <ref-b@example>"
    );
    expect(key).toBe("<ref-a@example>");
  });

  it("falls back to in-reply-to when no references", () => {
    expect(extractThreadKey("<a@x>", "<irt@x>", null)).toBe("<irt@x>");
  });

  it("falls back to message id when alone", () => {
    expect(extractThreadKey("<only@x>", null, null)).toBe("<only@x>");
  });

  it("returns null when nothing is available", () => {
    expect(extractThreadKey(null, null, null)).toBeNull();
  });
});

describe("buildSnippet", () => {
  it("collapses whitespace and newlines", () => {
    expect(buildSnippet("Hello\n\n   world\t!")).toBe("Hello world !");
  });

  it("truncates with ellipsis when over max", () => {
    const text = "a".repeat(300);
    const snip = buildSnippet(text, 10)!;
    expect(snip.length).toBe(11); // 10 chars + ellipsis
    expect(snip.endsWith("…")).toBe(true);
  });

  it("returns null for empty input", () => {
    expect(buildSnippet(null)).toBeNull();
    expect(buildSnippet("")).toBeNull();
  });
});

describe("encode/decode addresses", () => {
  it("round-trips an address list", () => {
    const json = encodeAddresses(["a@x", "Name <b@y>"]);
    expect(decodeAddresses(json)).toEqual(["a@x", "Name <b@y>"]);
  });

  it("decode returns [] for invalid json", () => {
    expect(decodeAddresses("not json")).toEqual([]);
    expect(decodeAddresses(null)).toEqual([]);
  });
});

describe("isAutomatedSender", () => {
  it("flags no-reply addresses", () => {
    expect(isAutomatedSender({ fromAddress: "no-reply@example.com" })).toBe(true);
    expect(isAutomatedSender({ fromAddress: "mailer-daemon@example.com" })).toBe(true);
    expect(isAutomatedSender({ fromAddress: "postmaster@example.com" })).toBe(true);
  });

  it("does not flag ordinary addresses", () => {
    expect(isAutomatedSender({ fromAddress: "prospect@example.com" })).toBe(false);
  });

  it("respects Auto-Submitted header (not 'no')", () => {
    expect(
      isAutomatedSender({ fromAddress: "list@example.com", autoSubmitted: "auto-generated" })
    ).toBe(true);
  });

  it("treats Auto-Submitted: no as non-automated", () => {
    expect(
      isAutomatedSender({ fromAddress: "prospect@example.com", autoSubmitted: "no" })
    ).toBe(false);
  });

  it("respects Precedence bulk/junk/list", () => {
    expect(
      isAutomatedSender({ fromAddress: "x@example.com", precedence: "bulk" })
    ).toBe(true);
    expect(
      isAutomatedSender({ fromAddress: "x@example.com", precedence: "list" })
    ).toBe(true);
  });
});
