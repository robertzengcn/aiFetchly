import { describe, expect, it } from "vitest";
import {
  clipCodepoints,
  clipToUtf8Bytes,
  countCodepoints,
  normalizeText,
  sanitizeExcerpt,
  sanitizeText,
  utf8ByteLength,
} from "@/service/aiChatTitle/AIChatTitleText";

describe("normalizeText", () => {
  it("collapses whitespace and newlines to single spaces", () => {
    expect(normalizeText("  find   dentists\n\nin   Sydney \t please ")).toBe(
      "find dentists in Sydney please"
    );
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeText(" \n\t ")).toBe("");
  });
});

describe("sanitizeText", () => {
  it("replaces emails with a generic marker", () => {
    expect(sanitizeText("contact john.doe+work@example.com today")).toBe(
      "contact [email] today"
    );
  });

  it("replaces raw URLs including www forms", () => {
    expect(sanitizeText("see https://example.com/a?b=1 and www.foo.bar/x")).toBe(
      "see [link] and [link]"
    );
  });

  it("replaces credential assignments in key=value and key: value forms", () => {
    expect(sanitizeText("my api_key=abc123SECRET here")).toBe(
      "my [redacted] here"
    );
    expect(sanitizeText("Password: hunter2 runs")).toBe("[redacted] runs");
    expect(sanitizeText("My password is hunter2 — check it")).toBe(
      "My [redacted] — check it"
    );
  });

  it("replaces bearer tokens and sk-style keys", () => {
    expect(sanitizeText("Authorization: Bearer eyJhbGciOi")).toBe("[redacted]");
    expect(sanitizeText("use sk-AbCdEf1234567890 for it")).toBe(
      "use [redacted] for it"
    );
  });

  it("replaces absolute unix and windows paths but keeps topic words", () => {
    expect(sanitizeText("open /home/robert/report.csv now")).toBe(
      "open [path] now"
    );
    expect(sanitizeText("read C:\\Users\\bob\\data.txt please")).toBe(
      "read [path] please"
    );
    expect(sanitizeText("dentists in Sydney")).toBe("dentists in Sydney");
  });
});

describe("clipCodepoints / countCodepoints", () => {
  it("never splits surrogate pairs (emoji)", () => {
    const text = "ab😀cd";
    expect(countCodepoints(text)).toBe(5);
    expect(clipCodepoints(text, 3)).toBe("ab😀");
  });

  it("returns the input unchanged when within the cap", () => {
    expect(clipCodepoints("short", 80)).toBe("short");
  });
});

describe("clipToUtf8Bytes", () => {
  it("truncates on UTF-8 boundaries, never mid code point", () => {
    // "牙" is 3 bytes; 4 bytes budget allows exactly one.
    expect(clipToUtf8Bytes("牙医诊所", 4)).toBe("牙");
    // Emoji is 4 bytes; budget 5 allows only the ascii char.
    expect(clipToUtf8Bytes("a😀b", 5)).toBe("a😀");
  });

  it("returns the input when already within budget", () => {
    expect(clipToUtf8Bytes("hello", 4096)).toBe("hello");
  });

  it("handles multibyte text under the 4096 title budget", () => {
    const long = "牙".repeat(2000); // 6000 bytes
    const clipped = clipToUtf8Bytes(long, 4096);
    expect(utf8ByteLength(clipped)).toBe(4095);
    expect(countCodepoints(clipped)).toBe(1365);
  });
});

describe("sanitizeExcerpt", () => {
  it("normalizes, sanitizes, and clips in that order", () => {
    const raw = "  Find dentists\nin Sydney — email me at a@b.co " + "x".repeat(200);
    const out = sanitizeExcerpt(raw, 80);
    expect(out.startsWith("Find dentists in Sydney — email me at [email]")).toBe(
      true
    );
    expect(countCodepoints(out)).toBeLessThanOrEqual(80);
    expect(out).not.toContain("a@b.co");
  });
});
