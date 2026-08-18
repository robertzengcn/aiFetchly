import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { VoiceModelCatalogService } from "@/service/aiChatVoice/VoiceModelCatalogService";
import { VoiceModelDownloadService } from "@/service/aiChatVoice/VoiceModelDownloadService";
import type { VoiceModelDownloadProgress } from "@/entityTypes/aiChatVoiceTypes";

function writeWhisperTinyFiles(modelRoot: string): void {
  const modelDir = path.join(modelRoot, "sherpa-onnx-whisper-tiny");
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, "tiny-encoder.int8.onnx"), "");
  fs.writeFileSync(path.join(modelDir, "tiny-decoder.int8.onnx"), "");
  fs.writeFileSync(path.join(modelDir, "tiny-tokens.txt"), "");
}

describe("VoiceModelCatalogService", () => {
  it("lists Tiny/Base/Small STT choices plus TTS with installed=false when dirs don't exist", () => {
    const svc = new VoiceModelCatalogService({
      modelRoot: path.join(os.tmpdir(), "voice-test-models"),
      fileExists: () => false,
    });
    const models = svc.listModels();
    expect(models).toHaveLength(4);
    expect(models.every((m) => !m.installed)).toBe(true);
    expect(models.filter((m) => m.type === "stt").map((m) => m.id)).toEqual([
      "sherpa-onnx:stt:auto",
      "sherpa-onnx:stt:whisper-base",
      "sherpa-onnx:stt:whisper-small",
    ]);
    expect(models.some((m) => m.type === "tts")).toBe(true);
  });

  it("reports installed=true when the target directory exists", () => {
    const svc = new VoiceModelCatalogService({
      modelRoot: path.join(os.tmpdir(), "voice-test-models"),
      fileExists: (p) => p.includes("sherpa-onnx-whisper-tiny"),
    });
    const models = svc.listModels();
    const stt = models.find((m) => m.type === "stt");
    const tts = models.find((m) => m.type === "tts");
    expect(stt?.installed).toBe(true);
    expect(tts?.installed).toBe(false);
  });

  it("reports installed=false when a required model file is missing (TODO P2)", () => {
    // Directory + most files present, but the Whisper tokens file is absent —
    // a half-extracted model must not count as installed/ready.
    const svc = new VoiceModelCatalogService({
      modelRoot: "/data/voice-models",
      fileExists: (p) =>
        !p.endsWith("tiny-tokens.txt") &&
        p.includes("sherpa-onnx-whisper-tiny"),
    });
    expect(svc.isInstalled("sherpa-onnx:stt:auto")).toBe(false);
  });

  it("reports installed=true when all required files are present (TODO P2)", () => {
    const svc = new VoiceModelCatalogService({
      modelRoot: "/data/voice-models",
      fileExists: (p) => p.includes("sherpa-onnx-whisper-tiny"),
    });
    expect(svc.isInstalled("sherpa-onnx:stt:auto")).toBe(true);
  });

  it("resolves model ids to model paths", () => {
    const svc = new VoiceModelCatalogService({
      modelRoot: "/data/voice-models",
      fileExists: () => false,
    });
    expect(svc.getModelPath("sherpa-onnx:stt:auto")).toBe(
      "/data/voice-models/sherpa-onnx-whisper-tiny"
    );
    expect(svc.getModelPath("sherpa-onnx:stt:whisper-base")).toBe(
      "/data/voice-models/sherpa-onnx-whisper-base"
    );
    expect(svc.getModelPath("sherpa-onnx:stt:whisper-small")).toBe(
      "/data/voice-models/sherpa-onnx-whisper-small"
    );
    expect(svc.getModelPath("unknown")).toBeNull();
  });
});

describe("VoiceModelDownloadService", () => {
  it("downloads, extracts, and reports done progress", async () => {
    const downloadFn = vi.fn(async (url: string, dest: string) => {
      fs.writeFileSync(dest, "fake-archive");
    });
    const extractFn = vi.fn(async (_archive: string, destDir: string) => {
      writeWhisperTinyFiles(destDir);
    });
    const svc = new VoiceModelDownloadService({
      modelRoot: path.join(os.tmpdir(), "voice-test-models"),
      downloadFn,
      extractFn,
    });
    const progress: VoiceModelDownloadProgress[] = [];
    await svc.downloadModel("sherpa-onnx:stt:auto", (p) => progress.push(p));

    expect(downloadFn).toHaveBeenCalledTimes(1);
    expect(extractFn).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)?.phase).toBe("done");
    expect(progress.some((p) => p.phase === "downloading")).toBe(true);
    expect(progress.some((p) => p.phase === "extracting")).toBe(true);
  });

  it("throws when cancelled before extraction", async () => {
    let resolveDownload: () => void = () => undefined;
    const downloadFn = vi.fn(async (_url: string, dest: string) => {
      fs.writeFileSync(dest, "fake");
      await new Promise<void>((r) => {
        resolveDownload = r;
      });
    });
    const extractFn = vi.fn(async () => undefined);
    const svc = new VoiceModelDownloadService({
      modelRoot: path.join(os.tmpdir(), "voice-test-models"),
      downloadFn,
      extractFn,
    });
    const promise = svc.downloadModel("sherpa-onnx:stt:auto");
    svc.cancelDownload("sherpa-onnx:stt:auto");
    resolveDownload();
    await expect(promise).rejects.toThrow(/cancelled/i);
    expect(extractFn).not.toHaveBeenCalled();
  });

  it("throws for an unknown model id", async () => {
    const svc = new VoiceModelDownloadService({
      modelRoot: path.join(os.tmpdir(), "voice-test-models"),
      downloadFn: vi.fn(),
      extractFn: vi.fn(),
    });
    await expect(svc.downloadModel("unknown-model")).rejects.toThrow(
      /unknown voice model/i
    );
  });

  it("surfaces download errors as error-phase progress", async () => {
    const downloadFn = vi.fn(async () => {
      throw new Error("Network failure.");
    });
    const svc = new VoiceModelDownloadService({
      modelRoot: path.join(os.tmpdir(), "voice-test-models"),
      downloadFn,
      extractFn: vi.fn(),
    });
    const progress: VoiceModelDownloadProgress[] = [];
    await expect(
      svc.downloadModel("sherpa-onnx:stt:auto", (p) => progress.push(p))
    ).rejects.toThrow(/network failure/i);
    expect(progress.at(-1)?.phase).toBe("error");
    expect(progress.at(-1)?.error).toContain("Network failure");
  });

  it("rejects when extraction does not produce the required model files", async () => {
    const downloadFn = vi.fn(async (url: string, dest: string) => {
      fs.writeFileSync(dest, "fake-archive");
    });
    const extractFn = vi.fn(async () => undefined);
    const svc = new VoiceModelDownloadService({
      modelRoot: fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-models-")),
      downloadFn,
      extractFn,
    });
    const progress: VoiceModelDownloadProgress[] = [];

    await expect(
      svc.downloadModel("sherpa-onnx:stt:auto", (p) => progress.push(p))
    ).rejects.toThrow(/required model files/i);
    expect(progress.at(-1)?.phase).toBe("error");
  });
});
