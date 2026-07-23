/**
 * VoiceModelCatalogService — catalog of downloadable sherpa-onnx models + status.
 *
 * Declares the recommended STT (Whisper-tiny) and TTS (Piper VITS) models with
 * their GitHub release URLs, target directories, and approximate sizes. Checks
 * whether each model is installed on disk. Design §14.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface VoiceModelDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: "stt" | "tts";
  readonly downloadUrl: string;
  readonly targetDir: string;
  readonly approxSizeMb: number;
  /** Optional SHA256 digest; if present, the downloader verifies it. */
  readonly sha256?: string;
}

export interface VoiceModelCatalogEntry extends VoiceModelDefinition {
  readonly installed: boolean;
}

/** Built-in recommended models (user decision: Whisper-tiny + Piper en_US-amy). */
export const VOICE_MODEL_DEFINITIONS: readonly VoiceModelDefinition[] = [
  {
    id: "sherpa-onnx:stt:auto",
    name: "Whisper Tiny (Multilingual STT)",
    type: "stt",
    downloadUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2",
    targetDir: "sherpa-onnx-whisper-tiny",
    approxSizeMb: 39,
  },
  {
    id: "sherpa-onnx:tts:auto",
    name: "Piper VITS en_US Amy (TTS)",
    type: "tts",
    downloadUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2",
    targetDir: "vits-piper-en_US-amy-medium",
    approxSizeMb: 61,
  },
];

export interface VoiceModelCatalogServiceDeps {
  readonly modelRoot: string;
  readonly fileExists?: (filePath: string) => boolean;
}

export class VoiceModelCatalogService {
  private readonly modelRoot: string;
  private readonly fileExists: (filePath: string) => boolean;

  constructor(deps: VoiceModelCatalogServiceDeps) {
    this.modelRoot = deps.modelRoot;
    this.fileExists = deps.fileExists ?? ((p: string) => fs.existsSync(p));
  }

  listModels(): VoiceModelCatalogEntry[] {
    return VOICE_MODEL_DEFINITIONS.map((def) => ({
      ...def,
      installed: this.isInstalled(def.id),
    }));
  }

  getModel(id: string): VoiceModelDefinition | null {
    return VOICE_MODEL_DEFINITIONS.find((m) => m.id === id) ?? null;
  }

  isInstalled(id: string): boolean {
    const modelPath = this.getModelPath(id);
    return modelPath !== null && this.fileExists(modelPath);
  }

  getModelPath(id: string): string | null {
    const def = this.getModel(id);
    if (!def) return null;
    return path.join(this.modelRoot, def.targetDir);
  }
}
