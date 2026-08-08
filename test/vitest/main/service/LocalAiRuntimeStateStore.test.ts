import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeStateStore } from "@/service/localAiRuntime/LocalAiRuntimeStateStore";
import type {
  LocalAiRuntimeActiveState,
  LocalAiRuntimeCatalog,
  LocalAiRuntimePackageManifest,
} from "@/entityTypes/localAiRuntimeTypes";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-state-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function newStore(): LocalAiRuntimeStateStore {
  return new LocalAiRuntimeStateStore(new LocalAiRuntimePathService(tmpRoot));
}

const ACTIVE: LocalAiRuntimeActiveState = {
  schemaVersion: 1,
  runtimeId: "voice-sherpa",
  runtimeVersion: "1.0.0",
  activatedAt: "2026-07-30T00:00:00Z",
  packageSha256: "a".repeat(64),
};

const MANIFEST: LocalAiRuntimePackageManifest = {
  schemaVersion: 1,
  runtimeId: "voice-sherpa",
  runtimeVersion: "1.0.0",
  platform: "darwin",
  arch: "arm64",
  electronVersion: "35.7.5",
  nodeModuleAbi: "135",
  entryModule: "sherpa-onnx-node",
  requiredFiles: ["package.json"],
  dependencies: { "sherpa-onnx-node": "1.13.4" },
  build: { commit: "abc", workflowRunId: "1", builtAt: "2026-07-30T00:00:00Z" },
};

describe("LocalAiRuntimeStateStore active pointer", () => {
  test("readActive returns null when absent", async () => {
    expect(await newStore().readActive("voice-sherpa")).toBeNull();
  });

  test("write then read round-trips", async () => {
    const store = newStore();
    await store.writeActive(ACTIVE);
    expect(await store.readActive("voice-sherpa")).toEqual(ACTIVE);
  });

  test("corrupt active.json is treated as missing (null)", async () => {
    const store = newStore();
    const paths = new LocalAiRuntimePathService(tmpRoot);
    await fs.promises.mkdir(paths.getRuntimeDir("voice-sherpa"), { recursive: true });
    await fs.promises.writeFile(paths.getActiveStatePath("voice-sherpa"), "{not json");
    expect(await store.readActive("voice-sherpa")).toBeNull();
  });

  test("clearActive removes the pointer and is idempotent", async () => {
    const store = newStore();
    await store.writeActive(ACTIVE);
    await store.clearActive("voice-sherpa");
    expect(await store.readActive("voice-sherpa")).toBeNull();
    await expect(store.clearActive("voice-sherpa")).resolves.toBeUndefined();
  });
});

describe("LocalAiRuntimeStateStore package manifest", () => {
  test("write then read round-trips", async () => {
    const store = newStore();
    await store.writePackageManifest("voice-sherpa", "1.0.0", MANIFEST);
    expect(await store.readPackageManifest("voice-sherpa", "1.0.0")).toEqual(MANIFEST);
  });

  test("read returns null for missing manifest", async () => {
    expect(await newStore().readPackageManifest("voice-sherpa", "1.0.0")).toBeNull();
  });
});

describe("LocalAiRuntimeStateStore listInstalledVersions", () => {
  test("lists semver dirs with valid manifests, sorted desc", async () => {
    const store = newStore();
    await store.writePackageManifest("voice-sherpa", "1.0.0", { ...MANIFEST, runtimeVersion: "1.0.0" });
    await store.writePackageManifest("voice-sherpa", "0.9.0", {
      ...MANIFEST,
      runtimeVersion: "0.9.0",
    });
    // A directory without a manifest must be ignored.
    const paths = new LocalAiRuntimePathService(tmpRoot);
    await fs.promises.mkdir(
      path.join(paths.getRuntimeDir("voice-sherpa"), "0.5.0"),
      { recursive: true },
    );
    expect(await store.listInstalledVersions("voice-sherpa")).toEqual(["1.0.0", "0.9.0"]);
  });

  test("returns empty when runtime dir does not exist", async () => {
    expect(await newStore().listInstalledVersions("voice-sherpa")).toEqual([]);
  });
});

describe("LocalAiRuntimeStateStore catalog cache", () => {
  const CATALOG: LocalAiRuntimeCatalog = {
    schemaVersion: 1,
    catalogVersion: "1.0.0",
    releaseTag: "v1",
    publishedAt: "2026-07-30T00:00:00Z",
    runtimes: [
      {
        runtimeId: "voice-sherpa",
        runtimeVersion: "1.0.0",
        platform: "darwin",
        arch: "arm64",
        downloadUrl: "https://github.com/o/r/releases/download/v1/voice-runtime-darwin-arm64-1.0.0.zip",
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
      },
    ],
  };

  test("write then read round-trips", async () => {
    const store = newStore();
    await store.writeCatalogCache(CATALOG);
    expect(await store.readCatalogCache()).toEqual(CATALOG);
  });

  test("cache meta round-trips and tolerates absence", async () => {
    const store = newStore();
    expect(await store.readCatalogCacheMeta()).toBeNull();
    await store.writeCatalogCacheMeta({
      fetchedAt: "2026-07-30T00:00:00Z",
      etag: "abc",
    });
    expect(await store.readCatalogCacheMeta()).toEqual({
      fetchedAt: "2026-07-30T00:00:00Z",
      etag: "abc",
    });
  });
});
