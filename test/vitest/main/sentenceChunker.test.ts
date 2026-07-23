import { describe, it, expect } from "vitest";
import { SentenceChunker } from "@/views/components/aiChatV2/voice/SentenceChunker";

describe("SentenceChunker", () => {
  it("does not emit until a sentence reaches the minimum length", () => {
    const chunker = new SentenceChunker();
    // "Hello world." is only 12 chars (< default min 24) -> held in buffer.
    expect(chunker.push("Hello world.")).toEqual([]);
    expect(chunker.flush()).toBe("Hello world.");
  });

  it("emits a complete sentence once it crosses the minimum length", () => {
    const chunker = new SentenceChunker();
    const sentence = "This sentence is long enough to emit on its own.";
    expect(chunker.push(sentence)).toEqual([sentence]);
    expect(chunker.flush()).toBe("");
  });

  it("emits multiple sentences in one push", () => {
    const chunker = new SentenceChunker();
    const out = chunker.push(
      "First complete sentence here. Second complete sentence now."
    );
    expect(out).toEqual([
      "First complete sentence here.",
      "Second complete sentence now.",
    ]);
  });

  it("flush returns the trailing remainder", () => {
    const chunker = new SentenceChunker();
    chunker.push("A full sentence ends here. Trailing partial text");
    expect(chunker.flush()).toBe("Trailing partial text");
    // second flush is empty (buffer cleared)
    expect(chunker.flush()).toBe("");
  });

  it("splits on CJK sentence enders", () => {
    const chunker = new SentenceChunker();
    const sentence = "今天我想和你聊一聊关于本地语音聊天的功能实现细节问题。";
    expect(chunker.push(sentence)).toEqual([sentence]);
  });

  it("force-splits a long run without boundaries at maxChars", () => {
    const chunker = new SentenceChunker({ minChars: 5, maxChars: 20 });
    const out = chunker.push("x".repeat(55));
    // Each emitted chunk must respect the 20-char hard cap.
    expect(out.every((c) => c.length <= 20)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(chunker.flush().length).toBeLessThanOrEqual(20);
  });

  it("ignores empty deltas", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("")).toEqual([]);
  });
});
