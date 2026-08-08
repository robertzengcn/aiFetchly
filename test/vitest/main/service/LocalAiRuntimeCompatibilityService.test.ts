import { describe, expect, test } from "vitest";
import { LocalAiRuntimeCompatibilityService } from "@/service/localAiRuntime/LocalAiRuntimeCompatibilityService";
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeCatalog,
  type LocalAiRuntimeTarget,
} from "@/entityTypes/localAiRuntimeTypes";

function entry(
  overrides: Partial<LocalAiRuntimeCatalog["runtimes"][number]>
): LocalAiRuntimeCatalog["runtimes"][number] {
  return {
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    downloadUrl:
      "https://github.com/o/r/releases/download/v1/voice-runtime-darwin-arm64-1.0.0.zip",
    archiveFileName: "voice-runtime-darwin-arm64-1.0.0.zip",
    archiveSizeBytes: 100,
    installedSizeBytes: 200,
    sha256: "a".repeat(64),
    electronVersion: "35.7.5",
    nodeModuleAbi: "135",
    minAppVersion: "1.0.0",
    entryModule: "sherpa-onnx-node",
    requiredFiles: ["package.json"],
    dependencies: { "sherpa-onnx-node": "1.13.4" },
    ...overrides,
  };
}

const TARGET: LocalAiRuntimeTarget = {
  platform: "darwin",
  arch: "arm64",
  electronVersion: "35.7.5",
  nodeModuleAbi: "135",
  appVersion: "1.5.0",
};

function catalog(
  runtimes: LocalAiRuntimeCatalog["runtimes"]
): LocalAiRuntimeCatalog {
  return {
    schemaVersion: 1,
    catalogVersion: "1.0.0",
    releaseTag: "v1",
    publishedAt: "2026-07-30T00:00:00Z",
    runtimes,
  };
}

describe("LocalAiRuntimeCompatibilityService", () => {
  const svc = new LocalAiRuntimeCompatibilityService();

  test("selects the single exact match", () => {
    const cat = catalog([entry({})]);
    expect(svc.selectEntry(cat, "voice-sherpa", TARGET).runtimeVersion).toBe(
      "1.0.0"
    );
  });

  test("selects the highest compatible version", () => {
    const cat = catalog([
      entry({
        runtimeVersion: "1.0.0",
        archiveFileName: "voice-runtime-darwin-arm64-1.0.0.zip",
      }),
      entry({
        runtimeVersion: "1.2.0",
        archiveFileName: "voice-runtime-darwin-arm64-1.2.0.zip",
      }),
    ]);
    expect(svc.selectEntry(cat, "voice-sherpa", TARGET).runtimeVersion).toBe(
      "1.2.0"
    );
  });

  test("never falls back to another architecture", () => {
    const cat = catalog([
      entry({
        arch: "x64",
        archiveFileName: "voice-runtime-darwin-x64-1.0.0.zip",
      }),
    ]);
    expect(() => svc.selectEntry(cat, "voice-sherpa", TARGET)).toThrow(
      LocalAiRuntimeError
    );
    expect(svc.findCompatibleEntry(cat, "voice-sherpa", TARGET)).toBeNull();
  });

  test("never falls back to another ABI", () => {
    const cat = catalog([entry({ nodeModuleAbi: "136" })]);
    expect(() => svc.selectEntry(cat, "voice-sherpa", TARGET)).toThrow(
      LocalAiRuntimeError
    );
  });

  test("rejects app version below min", () => {
    const cat = catalog([entry({ minAppVersion: "2.0.0" })]);
    expect(svc.findCompatibleEntry(cat, "voice-sherpa", TARGET)).toBeNull();
  });

  test("rejects app version above max", () => {
    const cat = catalog([entry({ maxAppVersion: "1.0.0" })]);
    expect(svc.findCompatibleEntry(cat, "voice-sherpa", TARGET)).toBeNull();
  });

  test("throws runtime_catalog_target_missing when no entry", () => {
    try {
      svc.selectEntry(catalog([]), "voice-sherpa", TARGET);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalAiRuntimeError);
      expect((error as LocalAiRuntimeError).code).toBe(
        "runtime_catalog_target_missing"
      );
    }
  });

  test("filters by runtime id (does not cross-match)", () => {
    // A catalog containing only an embedding entry; requesting voice must not
    // match it, even though platform/arch/ABI are otherwise compatible.
    const embeddingEntry: LocalAiRuntimeCatalog["runtimes"][number] = {
      runtimeId: "embedding-xenova",
      runtimeVersion: "1.0.0",
      platform: "darwin",
      arch: "arm64",
      downloadUrl:
        "https://github.com/o/r/releases/download/v1/embedding-runtime-darwin-arm64-1.0.0.zip",
      archiveFileName: "embedding-runtime-darwin-arm64-1.0.0.zip",
      archiveSizeBytes: 100,
      installedSizeBytes: 200,
      sha256: "a".repeat(64),
      electronVersion: "35.7.5",
      nodeModuleAbi: "135",
      minAppVersion: "1.0.0",
      entryPoint: "worker.js",
      requiredFiles: ["worker.js"],
      dependencies: { "@xenova/transformers": "2.17.2" },
    };
    const cat = catalog([embeddingEntry]);
    expect(() => svc.selectEntry(cat, "voice-sherpa", TARGET)).toThrow(
      LocalAiRuntimeError
    );
  });
});
