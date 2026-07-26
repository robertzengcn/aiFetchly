import { describe, expect, it, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createVoiceServices } from "@/childprocess/ai-chat-voice/voiceServices";

const { ttsGenerateInputs } = vi.hoisted(() => ({
  ttsGenerateInputs: [] as unknown[],
}));

vi.mock("@/service/aiChatVoice/SherpaOnnxNative", () => ({
  loadSherpaOnnxNative: vi.fn(() => ({
    OfflineRecognizer: vi.fn(function OfflineRecognizer() {
      return {};
    }),
    OfflineTts: vi.fn(function OfflineTts() {
      return {
        generate: vi.fn((input: unknown) => {
          ttsGenerateInputs.push(input);
          return { samples: new Float32Array([0]), sampleRate: 16000 };
        }),
      };
    }),
    GenerationConfig: vi.fn(function GenerationConfig(input: unknown) {
      return input;
    }),
  })),
}));

describe("RealSherpaSttService Whisper model layout", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    ttsGenerateInputs.length = 0;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it.each([
    ["Base", "base"],
    ["Small", "small"],
  ])("loads a Whisper %s directory by looking for %s model files", async (
    _label,
    variant
  ) => {
    const modelDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `sherpa-onnx-whisper-${variant}-`)
    );
    tempDirs.push(modelDir);
    fs.writeFileSync(path.join(modelDir, `${variant}-encoder.int8.onnx`), "");
    fs.writeFileSync(path.join(modelDir, `${variant}-decoder.int8.onnx`), "");
    fs.writeFileSync(path.join(modelDir, `${variant}-tokens.txt`), "");

    const services = createVoiceServices();
    await expect(services.stt.load(modelDir)).resolves.toBe(true);
  });

  it("disables external TTS buffers for Electron playback", async () => {
    const modelDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sherpa-onnx-vits-piper-")
    );
    tempDirs.push(modelDir);
    fs.writeFileSync(path.join(modelDir, "en_US-amy-medium.onnx"), "");
    fs.writeFileSync(path.join(modelDir, "tokens.txt"), "");
    fs.mkdirSync(path.join(modelDir, "espeak-ng-data"));

    const services = createVoiceServices();
    await expect(services.tts.load(modelDir)).resolves.toBe(true);
    await services.tts.synthesize("Hello world.", "0", 1);

    expect(ttsGenerateInputs).toHaveLength(1);
    expect(ttsGenerateInputs[0]).toMatchObject({
      text: "Hello world.",
      enableExternalBuffer: false,
    });
  });
});
