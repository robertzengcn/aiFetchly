/**
 * Voice STT/TTS service interfaces + factory backed by sherpa-onnx-node.
 *
 * The worker (`AiChatVoiceWorker.ts`) depends on these ABSTRACTIONS. The real
 * implementations load `sherpa-onnx-node` at runtime via a bundler-opaque
 * require (so the worker builds without the package) and construct an
 * `OfflineRecognizer` (Whisper STT) / `OfflineTts` (VITS Piper TTS) using the
 * API from k2-fsa/sherpa-onnx nodejs-addon-examples.
 *
 * `load()` returns false when the package is absent OR the model files are not
 * present — the worker then reports "unavailable" / "model not loaded", so the
 * feature degrades gracefully until `sherpa-onnx-node` is installed and the
 * consent-gated model downloader provides the files.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { encodeWavBase64, parseWavSamples } from "./wavUtils";

export interface TranscribeOutput {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface SynthesizeOutput {
  audioBase64: string;
  durationMs?: number;
}

export interface SherpaSttService {
  load(modelDir?: string, language?: string): Promise<boolean>;
  isLoaded(): boolean;
  transcribe(
    audioBase64: string,
    mimeType: string,
    language?: string
  ): Promise<TranscribeOutput>;
}

export interface SherpaTtsService {
  load(modelDir?: string, language?: string): Promise<boolean>;
  isLoaded(): boolean;
  synthesize(
    text: string,
    voiceId?: string,
    speed?: number
  ): Promise<SynthesizeOutput>;
}

export interface VoiceServices {
  readonly stt: SherpaSttService;
  readonly tts: SherpaTtsService;
}

// ---------------------------------------------------------------------------
// sherpa-onnx-node native addon (loosely typed; loaded at runtime)
// ---------------------------------------------------------------------------

interface RecognizerStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
}
interface Recognizer {
  createStream(): RecognizerStream;
  decode(stream: unknown): void;
  getResult(stream: unknown): { text?: string };
}
interface TtsEngine {
  generate(input: {
    text: string;
    generationConfig: unknown;
  }): { samples: Float32Array; sampleRate: number };
}
interface SherpaOnnxNative {
  OfflineRecognizer: new (config: unknown) => Recognizer;
  OfflineTts: new (config: unknown) => TtsEngine;
  GenerationConfig: new (input: {
    sid: number;
    speed: number;
    silenceScale?: number;
  }) => unknown;
}

/** Load the native addon at runtime. Name is concat'd so the bundler leaves it as an external require. */
function loadSherpaOnnxNative(): SherpaOnnxNative | null {
  try {
    const moduleName = "sherpa-onnx-" + "node";
    const g = globalThis as { require?: (id: string) => unknown };
    if (typeof g.require === "function") {
      return g.require(moduleName) as SherpaOnnxNative;
    }
  } catch {
    // package not installed
  }
  return null;
}

// ---------------------------------------------------------------------------
// STT — Whisper offline recognizer
// ---------------------------------------------------------------------------

class RealSherpaSttService implements SherpaSttService {
  private recognizer: Recognizer | null = null;
  private loaded = false;

  async load(modelDir?: string): Promise<boolean> {
    const native = loadSherpaOnnxNative();
    if (!native || !modelDir) {
      this.loaded = false;
      return false;
    }
    // sherpa-onnx-whisper-tiny tarball layout:
    //   <modelDir>/tiny-encoder.int8.onnx, tiny-decoder.int8.onnx, tiny-tokens.txt
    const encoder = path.join(modelDir, "tiny-encoder.int8.onnx");
    const decoder = path.join(modelDir, "tiny-decoder.int8.onnx");
    const tokens = path.join(modelDir, "tiny-tokens.txt");
    if (
      !fs.existsSync(encoder) ||
      !fs.existsSync(decoder) ||
      !fs.existsSync(tokens)
    ) {
      this.loaded = false;
      return false;
    }
    try {
      const config = {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          whisper: { encoder, decoder },
          tokens,
          numThreads: 2,
          provider: "cpu",
          debug: 0,
        },
      };
      this.recognizer = new native.OfflineRecognizer(config);
      this.loaded = true;
      return true;
    } catch {
      this.loaded = false;
      return false;
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async transcribe(
    audioBase64: string,
    _mimeType: string,
    _language?: string
  ): Promise<TranscribeOutput> {
    if (!this.recognizer) {
      throw new Error("STT model is not loaded.");
    }
    // The renderer converts the recorded WebM/Opus to 16 kHz mono WAV before
    // sending (via AudioContext), so the worker receives PCM WAV.
    const wavBytes = Buffer.from(audioBase64, "base64");
    const { samples, sampleRate } = parseWavSamples(new Uint8Array(wavBytes));
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples });
    this.recognizer.decode(stream);
    const result = this.recognizer.getResult(stream);
    const transcript = (result?.text ?? "").trim();
    return {
      transcript,
      durationMs:
        sampleRate > 0
          ? Math.round((samples.length / sampleRate) * 1000)
          : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// TTS — VITS Piper offline synthesizer
// ---------------------------------------------------------------------------

class RealSherpaTtsService implements SherpaTtsService {
  private tts: TtsEngine | null = null;
  private native: SherpaOnnxNative | null = null;
  private loaded = false;

  async load(modelDir?: string): Promise<boolean> {
    const native = loadSherpaOnnxNative();
    if (!native || !modelDir) {
      this.loaded = false;
      return false;
    }
    // vits-piper-en_US-amy-medium tarball layout:
    //   <modelDir>/en_US-amy-medium.onnx, tokens.txt, espeak-ng-data/
    const modelFile = path.join(modelDir, "en_US-amy-medium.onnx");
    const tokens = path.join(modelDir, "tokens.txt");
    const dataDir = path.join(modelDir, "espeak-ng-data");
    if (!fs.existsSync(modelFile) || !fs.existsSync(tokens)) {
      this.loaded = false;
      return false;
    }
    try {
      const config = {
        model: {
          vits: { model: modelFile, tokens, dataDir },
          debug: false,
          numThreads: 1,
          provider: "cpu",
        },
        maxNumSentences: 1,
      };
      this.tts = new native.OfflineTts(config);
      this.native = native;
      this.loaded = true;
      return true;
    } catch {
      this.loaded = false;
      return false;
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async synthesize(
    text: string,
    voiceId?: string,
    speed?: number
  ): Promise<SynthesizeOutput> {
    if (!this.tts || !this.native) {
      throw new Error("TTS model is not loaded.");
    }
    const sid = voiceId !== undefined ? Number(voiceId) || 0 : 0;
    const generationConfig = new this.native.GenerationConfig({
      sid,
      speed: speed ?? 1.0,
      silenceScale: 0.2,
    });
    const audio = this.tts.generate({ text, generationConfig });
    const audioBase64 = encodeWavBase64(audio.samples, audio.sampleRate);
    return {
      audioBase64,
      durationMs:
        audio.sampleRate > 0
          ? Math.round((audio.samples.length / audio.sampleRate) * 1000)
          : undefined,
    };
  }
}

export function createVoiceServices(): VoiceServices {
  return {
    stt: new RealSherpaSttService(),
    tts: new RealSherpaTtsService(),
  };
}
