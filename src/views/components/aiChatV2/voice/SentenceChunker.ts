/**
 * SentenceChunker — split a streaming assistant response into speakable
 * sentence-sized chunks for incremental TTS.
 *
 * Pure (no imports, no DOM). Feed token deltas via `push()`; it emits any
 * complete sentences. `flush()` returns the trailing remainder. Splits on
 * English (.!?) and CJK (。？！) sentence enders, enforcing a min length so
 * tiny fragments don't trigger synthesis and a max length so a single chunk
 * can't grow unbounded. Design §12.3.
 *
 * Note: code blocks are stripped upstream by `sanitizeForSpeech` before text
 * reaches TTS, so the chunker operates on natural-language content.
 */

export interface SentenceChunkerOptions {
  /** Minimum chars before a sentence boundary triggers an emit. */
  readonly minChars?: number;
  /** Hard cap on a single emitted chunk. */
  readonly maxChars?: number;
}

/** English + CJK sentence enders optionally followed by whitespace. */
const SENTENCE_END_RE = /[.!?。？！](?:\s|$)/;

const DEFAULT_MIN_CHARS = 24;
const DEFAULT_MAX_CHARS = 600;

export class SentenceChunker {
  private readonly minChars: number;
  private readonly maxChars: number;
  private buffer = "";

  constructor(options: SentenceChunkerOptions = {}) {
    this.minChars = options.minChars ?? DEFAULT_MIN_CHARS;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  }

  /** Append a token delta; returns any complete sentence chunks emitted. */
  push(delta: string): string[] {
    if (typeof delta !== "string" || delta.length === 0) {
      return [];
    }
    this.buffer += delta;
    return this.drain();
  }

  /** Return and clear any buffered remainder (call when the response ends). */
  flush(): string {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest;
  }

  private drain(): string[] {
    const emitted: string[] = [];
    while (this.buffer.length > 0) {
      // Force a split if the buffer exceeds the hard cap.
      if (this.buffer.length >= this.maxChars) {
        const slice = this.buffer.slice(0, this.maxChars);
        const lastBoundary = this.lastBoundaryIndex(slice);
        const cut =
          lastBoundary >= this.minChars ? lastBoundary : this.maxChars;
        emitted.push(this.buffer.slice(0, cut).trim());
        this.buffer = this.buffer.slice(cut);
        continue;
      }
      const match = SENTENCE_END_RE.exec(this.buffer);
      if (match && match.index + 1 >= this.minChars) {
        const cut = match.index + 1; // include the punctuation
        emitted.push(this.buffer.slice(0, cut).trim());
        this.buffer = this.buffer.slice(cut);
      } else {
        break; // wait for more tokens or a later boundary
      }
    }
    return emitted.filter((chunk) => chunk.length > 0);
  }

  /** Index just past the last sentence boundary in `slice`, or -1. */
  private lastBoundaryIndex(slice: string): number {
    let lastIndex = -1;
    const global = new RegExp(SENTENCE_END_RE.source, "g");
    let match: RegExpExecArray | null;
    while ((match = global.exec(slice)) !== null) {
      lastIndex = match.index + 1;
    }
    return lastIndex;
  }
}
