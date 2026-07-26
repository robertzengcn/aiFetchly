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
import {
  loadSherpaOnnxNative,
  type Recognizer,
  type TtsEngine,
  type SherpaOnnxNative,
} from "@/service/aiChatVoice/SherpaOnnxNative";
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
// STT — Whisper offline recognizer
// ---------------------------------------------------------------------------

type WhisperVariant = "tiny" | "base" | "small";

const WHISPER_VARIANTS: readonly WhisperVariant[] = ["tiny", "base", "small"];

function resolveWhisperVariant(modelDir: string): WhisperVariant | null {
  const dirName = path.basename(modelDir);
  return (
    WHISPER_VARIANTS.find((variant) =>
      dirName.startsWith(`sherpa-onnx-whisper-${variant}`)
    ) ?? null
  );
}

function resolveWhisperModelFiles(
  modelDir: string
): { encoder: string; decoder: string; tokens: string } | null {
  const variant = resolveWhisperVariant(modelDir);
  if (variant === null) {
    return null;
  }
  return {
    encoder: path.join(modelDir, `${variant}-encoder.int8.onnx`),
    decoder: path.join(modelDir, `${variant}-decoder.int8.onnx`),
    tokens: path.join(modelDir, `${variant}-tokens.txt`),
  };
}

class RealSherpaSttService implements SherpaSttService {
  private recognizer: Recognizer | null = null;
  private loaded = false;

  async load(modelDir?: string): Promise<boolean> {
    const native = loadSherpaOnnxNative();
    if (!native || !modelDir) {
      this.loaded = false;
      return false;
    }
    // sherpa-onnx-whisper-<variant> tarball layout:
    //   <modelDir>/<variant>-encoder.int8.onnx,
    //   <variant>-decoder.int8.onnx, <variant>-tokens.txt
    const files = resolveWhisperModelFiles(modelDir);
    if (files === null) {
      this.loaded = false;
      return false;
    }
    const { encoder, decoder, tokens } = files;
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
    const audio = this.tts.generate({
      text,
      generationConfig,
      // Electron >= 21 rejects external ArrayBuffers from native addons. Ask
      // sherpa-onnx to return a normal JS-owned Float32Array so the generated
      // samples can be encoded and passed back to the renderer safely.
      enableExternalBuffer: false,
    });
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
