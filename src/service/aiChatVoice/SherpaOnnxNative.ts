/**
 * Runtime loader for the sherpa-onnx Node native addon.
 *
 * Kept separate from the worker service so the main process can check whether
 * local voice inference is actually available before advertising STT/TTS as
 * ready. The package is intentionally loaded dynamically because native ONNX
 * artifacts must stay external to the Vite worker bundle.
 */
import { createRequire } from "node:module";

export interface RecognizerStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
}

export interface Recognizer {
  createStream(): RecognizerStream;
  decode(stream: unknown): void;
  getResult(stream: unknown): { text?: string };
}

export interface TtsEngine {
  generate(input: {
    text: string;
    enableExternalBuffer?: boolean;
    generationConfig: unknown;
  }): { samples: Float32Array; sampleRate: number };
}

export interface SherpaOnnxNative {
  OfflineRecognizer: new (config: unknown) => Recognizer;
  OfflineTts: new (config: unknown) => TtsEngine;
  GenerationConfig: new (input: {
    sid: number;
    speed: number;
    silenceScale?: number;
  }) => unknown;
}

/** Load the native addon at runtime, returning null when it is absent/broken. */
export function loadSherpaOnnxNative(): SherpaOnnxNative | null {
  const moduleName = "sherpa-onnx-" + "node";
  const globalRequire = (globalThis as { require?: (id: string) => unknown })
    .require;
  if (typeof globalRequire === "function") {
    try {
      return globalRequire(moduleName) as SherpaOnnxNative;
    } catch {
      // Fall through to Node's resolver below; Electron/bundled workers may
      // expose a global require with a different resolution base.
    }
  }
  try {
    const nodeRequire = createRequire(__filename);
    return nodeRequire(moduleName) as SherpaOnnxNative;
  } catch {
    return null;
  }
}

export function isSherpaOnnxNativeAvailable(): boolean {
  return loadSherpaOnnxNative() !== null;
}
