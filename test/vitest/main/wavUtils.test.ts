import { describe, it, expect } from "vitest";
import {
  encodeWavBase64,
  parseWavSamples,
} from "@/childprocess/ai-chat-voice/wavUtils";

describe("wavUtils", () => {
  it("round-trips Float32 samples through encode -> parse at 16 kHz", () => {
    const original = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25, -0.75, 0.001]);
    const base64 = encodeWavBase64(original, 16000);
    const bytes = Buffer.from(base64, "base64");
    const { samples, sampleRate } = parseWavSamples(new Uint8Array(bytes));
    expect(sampleRate).toBe(16000);
    expect(samples.length).toBe(original.length);
    // 16-bit PCM quantization loses precision; assert within 1 decimal.
    for (let i = 0; i < original.length; i += 1) {
      expect(samples[i]).toBeCloseTo(original[i], 1);
    }
  });

  it("rejects non-WAV input", () => {
    expect(() => parseWavSamples(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(
      /not a valid WAV/i,
    );
  });

  it("produces valid base64 with a RIFF/WAVE header", () => {
    const base64 = encodeWavBase64(new Float32Array([0, 0, 0]), 16000);
    const bytes = Buffer.from(base64, "base64");
    const header = Buffer.from(bytes.slice(0, 4)).toString("ascii");
    expect(header).toBe("RIFF");
    // 44-byte header + 3 samples * 2 bytes = 50 bytes total
    expect(bytes.length).toBe(44 + 6);
  });
});
