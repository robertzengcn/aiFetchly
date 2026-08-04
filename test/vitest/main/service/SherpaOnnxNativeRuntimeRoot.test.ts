import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadSherpaOnnxNative,
  isSherpaOnnxNativeAvailable,
} from "@/service/aiChatVoice/SherpaOnnxNative";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-sherpa-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Build a fake voice-sherpa runtime root whose node_modules exports the
 * SherpaOnnxNative shape. The loader must resolve `sherpa-onnx-node` from this
 * directory via a scoped createRequire(<runtimeRoot>/package.json).
 */
function buildFakeRuntime(): string {
  const runtimeRoot = path.join(tmpRoot, "voice-sherpa", "1.0.0");
  fs.mkdirSync(path.join(runtimeRoot, "node_modules", "sherpa-onnx-node"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(runtimeRoot, "package.json"),
    JSON.stringify({ name: "@aifetchly/runtime-voice-sherpa", private: true, version: "1.0.0" }),
  );
  fs.writeFileSync(
    path.join(runtimeRoot, "node_modules", "sherpa-onnx-node", "package.json"),
    JSON.stringify({ name: "sherpa-onnx-node", version: "1.13.4", main: "index.js" }),
  );
  fs.writeFileSync(
    path.join(runtimeRoot, "node_modules", "sherpa-onnx-node", "index.js"),
    `
      class OfflineRecognizer { constructor(c) { this.c = c; } }
      class OfflineTts { constructor(c) { this.c = c; } }
      class GenerationConfig { constructor(c) { this.c = c; } }
      module.exports = { OfflineRecognizer, OfflineTts, GenerationConfig };
    `,
  );
  return runtimeRoot;
}

describe("loadSherpaOnnxNative runtimeRoot resolution (Phase 7 §16.1)", () => {
  test("resolves sherpa-onnx-node from an explicit runtime root", () => {
    const runtimeRoot = buildFakeRuntime();
    const native = loadSherpaOnnxNative(runtimeRoot);
    expect(native).not.toBeNull();
    expect(typeof native?.OfflineRecognizer).toBe("function");
    expect(typeof native?.OfflineTts).toBe("function");
    expect(typeof native?.GenerationConfig).toBe("function");
  });

  test("returns null when the runtime root does not contain the package", () => {
    const runtimeRoot = path.join(tmpRoot, "missing-runtime");
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), "{}");
    expect(loadSherpaOnnxNative(runtimeRoot)).toBeNull();
  });

  test("returns null for a nonexistent runtime root", () => {
    expect(loadSherpaOnnxNative(path.join(tmpRoot, "does-not-exist"))).toBeNull();
  });

  test("isSherpaOnnxNativeAvailable threads runtimeRoot", () => {
    const runtimeRoot = buildFakeRuntime();
    expect(isSherpaOnnxNativeAvailable(runtimeRoot)).toBe(true);
    expect(isSherpaOnnxNativeAvailable(path.join(tmpRoot, "nope"))).toBe(false);
  });

  test("legacy bundled fallback path does not throw when no runtime is installed", () => {
    // sherpa-onnx-node is not installed in the test node_modules, so the
    // no-arg bundled resolution returns null without throwing.
    expect(() => loadSherpaOnnxNative()).not.toThrow();
  });
});
