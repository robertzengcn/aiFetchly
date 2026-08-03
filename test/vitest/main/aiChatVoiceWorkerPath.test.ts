import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mirrorAppAsarUnpackedPath,
  resolveAiChatVoiceWorkerPath,
} from "@/service/aiChatVoice/SherpaVoiceWorkerClient";

describe("AI chat voice worker path resolution", () => {
  it("resolves the local Vite worker bundle", () => {
    const expected = path.join("/repo", ".vite", "build", "AiChatVoiceWorker.js");

    const resolved = resolveAiChatVoiceWorkerPath({
      dirname: path.join("/repo", ".vite", "build"),
      cwd: "/repo",
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("resolves the unpacked packaged worker from dist/childprocess", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const expected = path.join(
      resourcesPath,
      "app.asar.unpacked",
      "dist",
      "childprocess",
      "AiChatVoiceWorker.js"
    );

    const resolved = resolveAiChatVoiceWorkerPath({
      dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
      cwd: "/tmp",
      resourcesPath,
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("maps Windows app.asar paths to the app.asar.unpacked mirror", () => {
    const packedPath =
      "E:\\aifetchly\\app-1.0.131\\resources\\app.asar\\.vite\\build\\childprocess\\AiChatVoiceWorker.js";

    expect(mirrorAppAsarUnpackedPath(packedPath)).toBe(
      "E:\\aifetchly\\app-1.0.131\\resources\\app.asar.unpacked\\.vite\\build\\childprocess\\AiChatVoiceWorker.js"
    );
  });
});
