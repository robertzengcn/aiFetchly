/**
 * Voice STT/TTS service interfaces + factory.
 *
 * The worker (`AiChatVoiceWorker.ts`) depends on these ABSTRACTIONS, not on
 * `sherpa-onnx` directly, so:
 *  - the worker router is unit-testable with mock services, and
 *  - the real sherpa-onnx wiring is a single, clearly-marked extension point.
 *
 * Until `sherpa-onnx` is installed + the model-download flow lands, the real
 * factory returns services that report unavailable / throw a clear "not wired"
 * error — the worker still builds, forks, and routes correctly.
 */

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
  /** Load the recognizer for the given model path; returns false if unavailable. */
  load(modelPath?: string, language?: string): Promise<boolean>;
  isLoaded(): boolean;
  transcribe(
    audioBase64: string,
    mimeType: string,
    language?: string
  ): Promise<TranscribeOutput>;
}

export interface SherpaTtsService {
  load(modelPath?: string, language?: string): Promise<boolean>;
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

/**
 * Attempt to load the `sherpa-onnx` native addon at runtime. The module name
 * is built from concatenation so the bundler does not try to resolve it at
 * build time (the package may not be installed yet). Returns null when absent.
 */
function loadSherpaOnnxNative(): unknown | null {
  try {
    const moduleName = "sherpa" + "-onnx";
    const g = globalThis as { require?: (id: string) => unknown };
    if (typeof g.require === "function") {
      return g.require(moduleName);
    }
  } catch {
    // package not installed or failed to load — fall through to "unavailable"
  }
  return null;
}

/**
 * Real(ish) services backed by `sherpa-onnx`. Today this reports unavailable
 * until the package + a model are present; the transcribe/synthesize calls
 * throw a clear error so the worker surfaces a safe failure to the renderer.
 *
 * When `sherpa-onnx` is installed, replace the TODO bodies with the real
 * OfflineRecognizer / offline TTS calls (see k2-fsa/sherpa-onnx nodejs-addon-
 * examples). The router above does not change.
 */
class RealSherpaSttService implements SherpaSttService {
  private loaded = false;

  async load(modelPath?: string): Promise<boolean> {
    const native = loadSherpaOnnxNative();
    if (!native || !modelPath) {
      this.loaded = false;
      return false;
    }
    // TODO(sherpa-onnx): construct an OfflineRecognizer from modelPath.
    this.loaded = true;
    return true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async transcribe(): Promise<TranscribeOutput> {
    throw new Error("sherpa-onnx STT is not wired yet.");
  }
}

class RealSherpaTtsService implements SherpaTtsService {
  private loaded = false;

  async load(modelPath?: string): Promise<boolean> {
    const native = loadSherpaOnnxNative();
    if (!native || !modelPath) {
      this.loaded = false;
      return false;
    }
    // TODO(sherpa-onnx): construct an offline TTS synthesizer from modelPath.
    this.loaded = true;
    return true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async synthesize(): Promise<SynthesizeOutput> {
    throw new Error("sherpa-onnx TTS is not wired yet.");
  }
}

/** Production factory. Returns real services (unavailable until wired). */
export function createVoiceServices(): VoiceServices {
  return {
    stt: new RealSherpaSttService(),
    tts: new RealSherpaTtsService(),
  };
}
