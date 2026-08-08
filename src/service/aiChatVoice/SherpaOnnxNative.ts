/**
 * Runtime loader for the sherpa-onnx Node native addon.
 *
 * Kept separate from the worker service so the main process can check whether
 * local voice inference is actually available before advertising STT/TTS as
 * ready. The package is intentionally loaded dynamically because native ONNX
 * artifacts must stay external to the Vite worker bundle.
 *
 * Phase 7 (design §16.1, FR-11): when an explicit `runtimeRoot` is supplied by
 * the LocalAiRuntimeResolver, the addon is loaded from that downloaded runtime
 * directory via a scoped `createRequire`. This never mutates global NODE_PATH.
 * When no runtime root is supplied, the legacy bundled resolution is used as a
 * migration fallback (FR-17) and is removed after runtime delivery is stable.
 */
import { createRequire } from "node:module";
import path from "node:path";

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

/**
 * Load the native addon at runtime, returning null when it is absent/broken.
 *
 * @param runtimeRoot Optional downloaded-runtime root (Phase 7). When supplied,
 *   the addon is resolved from `<runtimeRoot>/package.json` via a scoped
 *   `createRequire` — the active voice-sherpa runtime directory. When omitted,
 *   the legacy bundled resolution is used (migration fallback).
 */
export function loadSherpaOnnxNative(
  runtimeRoot?: string
): SherpaOnnxNative | null {
  const moduleName = "sherpa-onnx-" + "node";

  // Explicit downloaded runtime root wins (design §16.1, FR-11).
  if (runtimeRoot) {
    try {
      const runtimeRequire = createRequire(
        path.join(runtimeRoot, "package.json")
      );
      return runtimeRequire(moduleName) as SherpaOnnxNative;
    } catch {
      return null;
    }
  }

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

export function isSherpaOnnxNativeAvailable(runtimeRoot?: string): boolean {
  return loadSherpaOnnxNative(runtimeRoot) !== null;
}
