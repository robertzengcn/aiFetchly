import { describe, it, expect } from "vitest";
import { sanitizeForSpeech } from "@/views/components/aiChatV2/voice/SpeechTextSanitizer";

describe("sanitizeForSpeech", () => {
  it("passes plain text through", () => {
    expect(sanitizeForSpeech("Hello world.")).toBe("Hello world.");
  });

  it("removes fenced code blocks and keeps the prose", () => {
    expect(
      sanitizeForSpeech("```js\nconst x = 1;\n```\nHi there. Listen to me.")
    ).toBe("Hi there. Listen to me.");
  });

  it("returns empty string for a code-only message", () => {
    expect(sanitizeForSpeech("```code```")).toBe("");
  });

  it("converts markdown links to their label text", () => {
    expect(sanitizeForSpeech("[Click here](http://example.com) to continue.")).toBe(
      "Click here to continue."
    );
  });

  it("removes image syntax but keeps the alt text", () => {
    expect(sanitizeForSpeech("See ![a diagram](diagram.png) now.")).toBe(
      "See a diagram now."
    );
  });

  it("removes markdown tables", () => {
    expect(sanitizeForSpeech("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("");
  });

  it("strips markdown control characters (# * _ > ~)", () => {
    expect(
      sanitizeForSpeech("# Heading\n\n**bold** and _under_ text > quote")
    ).toBe("Heading bold and under text quote");
  });

  it("collapses whitespace", () => {
    expect(sanitizeForSpeech("Line1\n\n   Line2\t\tLine3")).toBe(
      "Line1 Line2 Line3"
    );
  });

  it("bounds the output to maxChars", () => {
    const out = sanitizeForSpeech("x".repeat(2000), 50);
    expect(out.length).toBe(50);
  });

  it("returns empty for non-string input", () => {
    expect(sanitizeForSpeech(undefined as unknown as string)).toBe("");
  });
});
