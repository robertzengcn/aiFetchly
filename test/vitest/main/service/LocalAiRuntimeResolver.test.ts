import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeStateStore } from "@/service/localAiRuntime/LocalAiRuntimeStateStore";
import { LocalAiRuntimeResolver } from "@/service/localAiRuntime/LocalAiRuntimeResolver";
import type {
  LocalAiRuntimeActiveState,
  LocalAiRuntimePackageManifest,
  LocalAiRuntimeTarget,
} from "@/entityTypes/localAiRuntimeTypes";

let tmpRoot: string;
const TARGET: LocalAiRuntimeTarget = {
  platform: "darwin",
  arch: "arm64",
  electronVersion: "35.7.5",
  nodeModuleAbi: "135",
  appVersion: "1.5.0",
};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-resolver-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const MANIFEST: LocalAiRuntimePackageManifest = {
  schemaVersion: 1,
  runtimeId: "voice-sherpa",
  runtimeVersion: "1.0.0",
  platform: "darwin",
  arch: "arm64",
  electronVersion: "35.7.5",
  nodeModuleAbi: "135",
  entryModule: "sherpa-onnx-node",
  requiredFiles: ["package.json", "node_modules/sherpa-onnx-node/package.json"],
  dependencies: { "sherpa-onnx-node": "1.13.4" },
  build: { commit: "abc", workflowRunId: "1", builtAt: "2026-07-30T00:00:00Z" },
};

const ACTIVE: LocalAiRuntimeActiveState = {
  schemaVersion: 1,
  runtimeId: "voice-sherpa",
  runtimeVersion: "1.0.0",
  activatedAt: "2026-07-30T00:00:00Z",
  packageSha256: "a".repeat(64),
};

function setupRuntime(): {
  paths: LocalAiRuntimePathService;
  store: LocalAiRuntimeStateStore;
} {
  const paths = new LocalAiRuntimePathService(tmpRoot);
  const store = new LocalAiRuntimeStateStore(paths);
  return { paths, store };
}

async function materialize(
  paths: LocalAiRuntimePathService,
  store: LocalAiRuntimeStateStore,
  manifest: LocalAiRuntimePackageManifest
): Promise<void> {
  const { versionRoot } = paths.getRuntimePaths(
    manifest.runtimeId,
    manifest.runtimeVersion
  );
  await fs.promises.mkdir(versionRoot, { recursive: true });
  for (const f of manifest.requiredFiles) {
    const fp = path.join(versionRoot, f);
    await fs.promises.mkdir(path.dirname(fp), { recursive: true });
    await fs.promises.writeFile(fp, "{}");
  }
  await store.writePackageManifest(
    manifest.runtimeId,
    manifest.runtimeVersion,
    manifest
  );
  await store.writeActive(ACTIVE);
}

describe("LocalAiRuntimeResolver", () => {
  test("resolves an installed compatible runtime", async () => {
    const { paths, store } = setupRuntime();
    await materialize(paths, store, MANIFEST);
    const resolver = new LocalAiRuntimeResolver(paths, store, TARGET);
    const resolved = await resolver.resolve("voice-sherpa");
    expect(resolved?.runtimeVersion).toBe("1.0.0");
    expect(resolved?.manifest).toEqual(MANIFEST);
    expect(resolved?.moduleRequirePath).toBe(
      path.join(
        paths.getRuntimePaths("voice-sherpa", "1.0.0").versionRoot,
        "package.json"
      )
    );
  });

  test("returns null when no active pointer exists", async () => {
    const { paths, store } = setupRuntime();
    const resolver = new LocalAiRuntimeResolver(paths, store, TARGET);
    expect(await resolver.resolve("voice-sherpa")).toBeNull();
  });

  test("returns null when platform does not match target", async () => {
    const { paths, store } = setupRuntime();
    await materialize(paths, store, {
      ...MANIFEST,
      platform: "win32",
      arch: "x64",
    });
    const resolver = new LocalAiRuntimeResolver(paths, store, TARGET);
    expect(await resolver.resolve("voice-sherpa")).toBeNull();
  });

  test("returns null when ABI does not match target", async () => {
    const { paths, store } = setupRuntime();
    await materialize(paths, store, { ...MANIFEST, nodeModuleAbi: "136" });
    const resolver = new LocalAiRuntimeResolver(paths, store, TARGET);
    expect(await resolver.resolve("voice-sherpa")).toBeNull();
  });

  test("returns null when a required file is missing", async () => {
    const { paths, store } = setupRuntime();
    await materialize(paths, store, MANIFEST);
    await fs.promises.rm(
      path.join(
        paths.getRuntimePaths("voice-sherpa", "1.0.0").versionRoot,
        "node_modules",
        "sherpa-onnx-node",
        "package.json"
      )
    );
    const resolver = new LocalAiRuntimeResolver(paths, store, TARGET);
    expect(await resolver.resolve("voice-sherpa")).toBeNull();
  });

  test("resolves embedding entry point beneath version root", async () => {
    const { paths, store } = setupRuntime();
    const embeddingManifest = {
      schemaVersion: 1 as const,
      runtimeId: "embedding-xenova" as const,
      runtimeVersion: "1.0.0",
      platform: "darwin" as const,
      arch: "arm64" as const,
      electronVersion: "35.7.5",
      nodeModuleAbi: "135",
      entryPoint: "worker.js",
      requiredFiles: ["worker.js", "package.json"],
      dependencies: { "@xenova/transformers": "2.17.2" },
      build: {
        commit: "abc",
        workflowRunId: "1",
        builtAt: "2026-07-30T00:00:00Z",
      },
    };
    const activeEmbedding: LocalAiRuntimeActiveState = {
      ...ACTIVE,
      runtimeId: "embedding-xenova",
    };
    const { versionRoot } = paths.getRuntimePaths("embedding-xenova", "1.0.0");
    await fs.promises.mkdir(versionRoot, { recursive: true });
    for (const f of embeddingManifest.requiredFiles) {
      await fs.promises.writeFile(path.join(versionRoot, f), "{}");
    }
    await store.writePackageManifest(
      "embedding-xenova",
      "1.0.0",
      embeddingManifest
    );
    await store.writeActive(activeEmbedding);
    const resolver = new LocalAiRuntimeResolver(paths, store, TARGET);
    const resolved = await resolver.resolve("embedding-xenova");
    expect(resolved?.entryPath).toBe(path.join(versionRoot, "worker.js"));
    expect(resolved?.moduleRequirePath).toBeUndefined();
  });
});
