import { afterEach, describe, expect, it, vi } from "vitest";

const globalWithRequire = globalThis as {
  require?: (id: string) => unknown;
};
const originalRequire = globalWithRequire.require;

afterEach(() => {
  vi.doUnmock("node:module");
  vi.resetModules();
  if (originalRequire === undefined) {
    delete globalWithRequire.require;
    return;
  }
  globalWithRequire.require = originalRequire;
});

describe("SherpaOnnxNative loader", () => {
  it("falls back to Node createRequire when a global require cannot resolve the addon", async () => {
    globalWithRequire.require = () => {
      throw new Error("global require cannot resolve native addon");
    };
    const fakeNativeAddon = {
      OfflineRecognizer: class {},
      OfflineTts: class {},
      GenerationConfig: class {},
    };
    const fallbackRequire = vi.fn((id: string) => {
      expect(id).toBe("sherpa-onnx-node");
      return fakeNativeAddon;
    });
    const createRequireMock = vi.fn(() => fallbackRequire);
    vi.doMock("node:module", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:module")>();
      return {
        ...actual,
        createRequire: createRequireMock,
      };
    });

    const { isSherpaOnnxNativeAvailable } = await import(
      "@/service/aiChatVoice/SherpaOnnxNative"
    );

    expect(isSherpaOnnxNativeAvailable()).toBe(true);
    expect(createRequireMock).toHaveBeenCalledTimes(1);
    expect(fallbackRequire).toHaveBeenCalledTimes(1);
  });
});
