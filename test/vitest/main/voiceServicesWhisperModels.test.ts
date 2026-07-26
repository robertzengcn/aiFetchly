import { describe, expect, it, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createVoiceServices } from "@/childprocess/ai-chat-voice/voiceServices";

vi.mock("@/service/aiChatVoice/SherpaOnnxNative", () => ({
  loadSherpaOnnxNative: vi.fn(() => ({
    OfflineRecognizer: vi.fn(function OfflineRecognizer() {
      return {};
    }),
  })),
}));

describe("RealSherpaSttService Whisper model layout", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
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
});
