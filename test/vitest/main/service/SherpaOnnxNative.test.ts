import { afterEach, describe, expect, it } from "vitest";
import { isSherpaOnnxNativeAvailable } from "@/service/aiChatVoice/SherpaOnnxNative";

const globalWithRequire = globalThis as {
  require?: (id: string) => unknown;
};
const originalRequire = globalWithRequire.require;

afterEach(() => {
  if (originalRequire === undefined) {
    delete globalWithRequire.require;
    return;
  }
  globalWithRequire.require = originalRequire;
});

describe("SherpaOnnxNative loader", () => {
  it("falls back to Node createRequire when a global require cannot resolve the addon", () => {
    globalWithRequire.require = () => {
      throw new Error("global require cannot resolve native addon");
    };

    expect(isSherpaOnnxNativeAvailable()).toBe(true);
  });
});
