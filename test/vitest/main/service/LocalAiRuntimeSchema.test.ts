import { describe, expect, test } from "vitest";
import {
  isSafeRelativeRuntimePath,
  expectedArchiveFileName,
  localAiRuntimeCatalogEntrySchema,
  localAiRuntimeCatalogSchema,
  localAiRuntimePackageManifestSchema,
  localAiRuntimeActiveStateSchema,
} from "@/schemas/localAiRuntime";
import type { LocalAiRuntimeCatalogEntry } from "@/entityTypes/localAiRuntimeTypes";

function baseEntry(
  overrides: Partial<LocalAiRuntimeCatalogEntry> = {}
): unknown {
  return {
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    platform: "win32",
    arch: "x64",
    downloadUrl:
      "https://github.com/o/r/releases/download/v1/voice-runtime-win32-x64-1.0.0.zip",
    archiveFileName: "voice-runtime-win32-x64-1.0.0.zip",
    archiveSizeBytes: 100,
    installedSizeBytes: 200,
    sha256: "a".repeat(64),
    electronVersion: "35.7.5",
    nodeModuleAbi: "135",
    minAppVersion: "1.0.0",
    entryModule: "sherpa-onnx-node",
    requiredFiles: [
      "package.json",
      "node_modules/sherpa-onnx-node/package.json",
    ],
    dependencies: { "sherpa-onnx-node": "1.13.4" },
    ...overrides,
  };
}

describe("isSafeRelativeRuntimePath", () => {
  test("accepts plain relative paths", () => {
    expect(isSafeRelativeRuntimePath("worker.js")).toBe(true);
    expect(
      isSafeRelativeRuntimePath("node_modules/sherpa-onnx-node/index.js")
    ).toBe(true);
  });
  test.each([
    ["absolute unix", "/etc/passwd"],
    ["windows drive", "C:\\boot.ini"],
    ["UNC", "\\\\server\\share\\x"],
    ["traversal parent", "../escape"],
    ["nested traversal", "a/../../b"],
    ["dot segment", "./a"],
    ["empty", ""],
    ["NUL byte", "a\0b"],
    ["backslash", "a\\b"],
    ["Windows CON device", "CON"],
    ["CON with extension", "CON.txt"],
  ])("rejects %s", (_label, value) => {
    expect(isSafeRelativeRuntimePath(value)).toBe(false);
  });
});

describe("localAiRuntimeCatalogEntrySchema", () => {
  test("accepts a valid voice entry", () => {
    expect(
      localAiRuntimeCatalogEntrySchema.safeParse(baseEntry()).success
    ).toBe(true);
  });
  test("accepts a valid embedding entry with entryPoint", () => {
    const entry = baseEntry({
      runtimeId: "embedding-xenova",
      entryPoint: "worker.js",
      entryModule: undefined,
      archiveFileName: "embedding-runtime-win32-x64-1.0.0.zip",
      downloadUrl:
        "https://github.com/o/r/releases/download/v1/embedding-runtime-win32-x64-1.0.0.zip",
    });
    delete (entry as Record<string, unknown>).entryModule;
    expect(localAiRuntimeCatalogEntrySchema.safeParse(entry).success).toBe(
      true
    );
  });
  test("rejects unknown runtime id", () => {
    const r = localAiRuntimeCatalogEntrySchema.safeParse(
      baseEntry({ runtimeId: "evil" as never })
    );
    expect(r.success).toBe(false);
  });
  test("rejects bad sha256", () => {
    const r = localAiRuntimeCatalogEntrySchema.safeParse(
      baseEntry({ sha256: "XYZ" })
    );
    expect(r.success).toBe(false);
  });
  test("rejects non-HTTPS url", () => {
    const r = localAiRuntimeCatalogEntrySchema.safeParse(
      baseEntry({ downloadUrl: "http://example.com/x.zip" })
    );
    expect(r.success).toBe(false);
  });
  test("rejects filename that does not match target contract", () => {
    const r = localAiRuntimeCatalogEntrySchema.safeParse(
      baseEntry({ archiveFileName: "voice-runtime-darwin-arm64-1.0.0.zip" })
    );
    expect(r.success).toBe(false);
  });
  test("rejects maxAppVersion < minAppVersion", () => {
    const r = localAiRuntimeCatalogEntrySchema.safeParse(
      baseEntry({ minAppVersion: "2.0.0", maxAppVersion: "1.0.0" })
    );
    expect(r.success).toBe(false);
  });
  test("rejects embedding entry without entryPoint", () => {
    const entry = baseEntry({ runtimeId: "embedding-xenova" });
    delete (entry as Record<string, unknown>).entryModule;
    delete (entry as Record<string, unknown>).entryPoint;
    const r = localAiRuntimeCatalogEntrySchema.safeParse(entry);
    expect(r.success).toBe(false);
  });
  test("rejects voice entry without entryModule", () => {
    const entry = baseEntry();
    delete (entry as Record<string, unknown>).entryModule;
    const r = localAiRuntimeCatalogEntrySchema.safeParse(entry);
    expect(r.success).toBe(false);
  });
  test("accepts Linux x64 runtime entries", () => {
    const entry = baseEntry({
      platform: "linux",
      archiveFileName: "voice-runtime-linux-x64-1.0.0.zip",
      downloadUrl:
        "https://github.com/o/r/releases/download/v1/voice-runtime-linux-x64-1.0.0.zip",
    });
    expect(localAiRuntimeCatalogEntrySchema.safeParse(entry).success).toBe(
      true
    );
  });
  test("expectedArchiveFileName derives deterministic name", () => {
    expect(
      expectedArchiveFileName("voice-sherpa", "darwin", "arm64", "1.2.3")
    ).toBe("voice-runtime-darwin-arm64-1.2.3.zip");
    expect(
      expectedArchiveFileName("embedding-xenova", "win32", "x64", "1.0.0")
    ).toBe("embedding-runtime-win32-x64-1.0.0.zip");
    expect(
      expectedArchiveFileName("embedding-xenova", "linux", "x64", "1.0.0")
    ).toBe("embedding-runtime-linux-x64-1.0.0.zip");
  });
});

describe("localAiRuntimeCatalogSchema", () => {
  function catalog(runtimes: unknown[]): Record<string, unknown> {
    return {
      schemaVersion: 1,
      catalogVersion: "1.0.0",
      releaseTag: "v1",
      publishedAt: "2026-07-30T00:00:00Z",
      runtimes,
    };
  }
  test("rejects unknown schema version", () => {
    const r = localAiRuntimeCatalogSchema.safeParse({
      ...catalog([baseEntry()]),
      schemaVersion: 99,
    });
    expect(r.success).toBe(false);
  });
  test("rejects duplicate target entries", () => {
    const r = localAiRuntimeCatalogSchema.safeParse(
      catalog([baseEntry(), baseEntry()])
    );
    expect(r.success).toBe(false);
  });
});

describe("localAiRuntimePackageManifestSchema", () => {
  test("accepts a valid manifest", () => {
    const r = localAiRuntimePackageManifestSchema.safeParse({
      schemaVersion: 1,
      runtimeId: "voice-sherpa",
      runtimeVersion: "1.0.0",
      platform: "win32",
      arch: "x64",
      electronVersion: "35.7.5",
      nodeModuleAbi: "135",
      entryModule: "sherpa-onnx-node",
      requiredFiles: ["package.json"],
      dependencies: { "sherpa-onnx-node": "1.13.4" },
      build: {
        commit: "abc",
        workflowRunId: "1",
        builtAt: "2026-07-30T00:00:00Z",
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("localAiRuntimeActiveStateSchema", () => {
  test("accepts a valid active pointer", () => {
    const r = localAiRuntimeActiveStateSchema.safeParse({
      schemaVersion: 1,
      runtimeId: "voice-sherpa",
      runtimeVersion: "1.0.0",
      activatedAt: "2026-07-30T00:00:00Z",
      packageSha256: "a".repeat(64),
    });
    expect(r.success).toBe(true);
  });
});
