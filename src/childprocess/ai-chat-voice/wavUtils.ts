/**
 * Pure WAV encode/decode helpers for the voice worker.
 *
 * - `encodeWavBase64`: Float32 samples -> 16-bit PCM WAV -> base64 (TTS output
 *   sent back to the renderer for playback).
 * - `parseWavSamples`: 16-bit PCM WAV bytes -> Float32 samples + sampleRate
 *   (STT input — the renderer converts the recorded WebM/Opus to 16 kHz mono
 *   WAV via AudioContext before sending, so sherpa-onnx receives PCM).
 *
 * No native / sherpa-onnx imports — fully unit-testable.
 */

/** Encode Float32 PCM samples into a 16-bit mono WAV, returned as base64. */
export function encodeWavBase64(
  samples: Float32Array,
  sampleRate: number
): string {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return bytesToBase64(new Uint8Array(buffer));
}

/** Parse a 16-bit PCM WAV into Float32 samples + the sample rate. */
export function parseWavSamples(wavBytes: Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
} {
  const view = new DataView(
    wavBytes.buffer,
    wavBytes.byteOffset,
    wavBytes.byteLength
  );
  if (wavBytes.length < 44 || readAscii(view, 0, 4) !== "RIFF") {
    throw new Error("Not a valid WAV file.");
  }
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (bitsPerSample !== 16) {
    throw new Error(`Expected 16-bit PCM WAV, got ${bitsPerSample}-bit.`);
  }

  // Locate the "data" chunk (chunks may not be in a fixed order).
  let offset = 12;
  let dataOffset = 0;
  let dataLen = 0;
  while (offset + 8 <= wavBytes.length) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      dataOffset = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (dataLen === 0) {
    throw new Error("WAV has no data chunk.");
  }

  const bytesPerFrame = numChannels * (bitsPerSample / 8);
  const numFrames = Math.floor(dataLen / bytesPerFrame);
  const out = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i += 1) {
    const v = view.getInt16(dataOffset + i * bytesPerFrame, true);
    out[i] = v / (v < 0 ? 0x8000 : 0x7fff);
  }
  return { samples: out, sampleRate };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i += 1) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Node Buffer is available in the worker (CJS) and in vitest.
  const ctor = (globalThis as { Buffer?: { from(a: unknown): { toString(enc: string): string } } }).Buffer;
  if (ctor) {
    return ctor.from(bytes).toString("base64");
  }
  // Browser fallback.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === "function" ? btoa(binary) : binary;
}
