import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeStateStore } from "@/service/localAiRuntime/LocalAiRuntimeStateStore";
import { LocalAiRuntimeCompatibilityService } from "@/service/localAiRuntime/LocalAiRuntimeCompatibilityService";
import { LocalAiRuntimeResolver } from "@/service/localAiRuntime/LocalAiRuntimeResolver";
import { LocalAiRuntimeOperationCoordinator } from "@/service/localAiRuntime/LocalAiRuntimeOperationCoordinator";
import { LocalAiRuntimeHealthService } from "@/service/localAiRuntime/LocalAiRuntimeHealthService";
import type {
  RuntimeDownloadRequest,
  RuntimeDownloadResult,
} from "@/service/localAiRuntime/LocalAiRuntimeDownloadService";
import { LocalAiRuntimeModule } from "@/modules/LocalAiRuntimeModule";
import type {
  LocalAiRuntimeCatalog,
  LocalAiRuntimeCatalogEntry,
  LocalAiRuntimeDownloadProgress,
  LocalAiRuntimeTarget,
  ResolvedLocalAiRuntime,
} from "@/entityTypes/localAiRuntimeTypes";
import { LocalAiRuntimeError } from "@/entityTypes/localAiRuntimeTypes";

let tmpRoot: string;
const TARGET: LocalAiRuntimeTarget = {
  platform: "darwin",
  arch: "arm64",
  electronVersion: "35.7.5",
  nodeModuleAbi: "135",
  appVersion: "1.5.0",
};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-module-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeEntry(version: string): LocalAiRuntimeCatalogEntry {
  return {
    runtimeId: "voice-sherpa",
    runtimeVersion: version,
    platform: "darwin",
    arch: "arm64",
    downloadUrl:
      "https://github.com/o/r/releases/download/v1/voice-runtime-darwin-arm64-" +
      version +
      ".zip",
    archiveFileName: `voice-runtime-darwin-arm64-${version}.zip`,
    archiveSizeBytes: 200,
    installedSizeBytes: 400,
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
  };
}

function manifestJsonFor(version: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    runtimeId: "voice-sherpa",
    runtimeVersion: version,
    platform: "darwin",
    arch: "arm64",
    electronVersion: "35.7.5",
    nodeModuleAbi: "135",
    entryModule: "sherpa-onnx-node",
    requiredFiles: [
      "package.json",
      "node_modules/sherpa-onnx-node/package.json",
    ],
    dependencies: { "sherpa-onnx-node": "1.13.4" },
    build: {
      commit: "abc",
      workflowRunId: "1",
      builtAt: "2026-07-30T00:00:00Z",
    },
  });
}

interface FakeSetup {
  module: LocalAiRuntimeModule;
  state: LocalAiRuntimeStateStore;
  paths: LocalAiRuntimePathService;
  setCatalogVersion: (version: string) => void;
  setHealthOk: (ok: boolean) => void;
  progress: LocalAiRuntimeDownloadProgress[];
}

function setup(initialVersion = "1.0.0"): FakeSetup {
  const paths = new LocalAiRuntimePathService(tmpRoot);
  const state = new LocalAiRuntimeStateStore(paths);
  const compatibility = new LocalAiRuntimeCompatibilityService();
  const resolver = new LocalAiRuntimeResolver(paths, state, TARGET);
  const coordinator = new LocalAiRuntimeOperationCoordinator();
  const progress: LocalAiRuntimeDownloadProgress[] = [];

  let catalogVersion = initialVersion;
  let healthOk = true;

  const fakeCatalog = {
    async getCatalog(): Promise<LocalAiRuntimeCatalog> {
      return {
        schemaVersion: 1,
        catalogVersion: "1.0.0",
        releaseTag: "v1",
        publishedAt: "2026-07-30T00:00:00Z",
        runtimes: [makeEntry(catalogVersion)],
      };
    },
  };

  const fakeDownload = {
    async download(
      req: RuntimeDownloadRequest
    ): Promise<RuntimeDownloadResult> {
      const zip = new AdmZip();
      zip.addFile(
        "manifest.json",
        Buffer.from(manifestJsonFor(req.entry.runtimeVersion), "utf-8")
      );
      zip.addFile("package.json", Buffer.from("{}", "utf-8"));
      zip.addFile(
        "node_modules/sherpa-onnx-node/package.json",
        Buffer.from("{}", "utf-8")
      );
      zip.writeZip(req.destinationPath);
      const buf = fs.readFileSync(req.destinationPath);
      return {
        archivePath: req.destinationPath,
        downloadedBytes: buf.length,
        sha256: req.entry.sha256,
      };
    },
  };

  const fakeHealth = {
    async check(ctx: {
      runtime: ResolvedLocalAiRuntime;
    }): Promise<{ ok: boolean; errorMessage?: string }> {
      return {
        ok: healthOk,
        errorMessage: healthOk ? undefined : "forced failure",
      };
    },
  };

  // Real services where possible; fakes only for network/native surfaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const module = new LocalAiRuntimeModule({
    paths,
    state,
    catalog: fakeCatalog as never,
    compatibility,
    download: fakeDownload as never,
    resolver,
    coordinator,
    health: fakeHealth as never,
    target: TARGET,
    publishProgress: (p) => progress.push(p),
  });

  return {
    module,
    state,
    paths,
    setCatalogVersion: (v) => (catalogVersion = v),
    setHealthOk: (ok) => (healthOk = ok),
    progress,
  };
}

describe("LocalAiRuntimeModule install/activate", () => {
  test("prepareInstall + install activates the runtime atomically", async () => {
    const env = setup();
    const offer = await env.module.prepareInstall("voice-sherpa");
    expect(offer.runtimeVersion).toBe("1.0.0");
    const result = await env.module.install({
      operationId: offer.operationId,
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    expect(result.activated).toBe(true);

    const active = await env.state.readActive("voice-sherpa");
    expect(active?.runtimeVersion).toBe("1.0.0");
    expect(active?.packageSha256).toBe("a".repeat(64));
    const { versionRoot } = env.paths.getRuntimePaths("voice-sherpa", "1.0.0");
    expect(fs.existsSync(path.join(versionRoot, "manifest.json"))).toBe(true);
    expect(env.progress.some((p) => p.phase === "done")).toBe(true);
  });

  test("status is ready after install and not_installed before", async () => {
    const env = setup();
    const before = await env.module.getStatus("voice-sherpa");
    expect(before.state).toBe("download_required"); // catalog has a compatible entry

    const offer = await env.module.prepareInstall("voice-sherpa");
    await env.module.install({
      operationId: offer.operationId,
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    const after = await env.module.getStatus("voice-sherpa");
    expect(after.state).toBe("ready");
    expect(after.installedVersion).toBe("1.0.0");
  });

  test("install rejects on consent token mismatch", async () => {
    const env = setup();
    const offer = await env.module.prepareInstall("voice-sherpa");
    await expect(
      env.module.install({
        operationId: offer.operationId,
        runtimeId: "voice-sherpa",
        expectedRuntimeVersion: offer.runtimeVersion,
        consentToken: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow(LocalAiRuntimeError);
    // Nothing activated.
    expect(await env.state.readActive("voice-sherpa")).toBeNull();
  });

  test("health failure aborts install and leaves no active runtime", async () => {
    const env = setup();
    env.setHealthOk(false);
    const offer = await env.module.prepareInstall("voice-sherpa");
    await expect(
      env.module.install({
        operationId: offer.operationId,
        runtimeId: "voice-sherpa",
        expectedRuntimeVersion: offer.runtimeVersion,
        consentToken: offer.consentToken,
      })
    ).rejects.toThrow(LocalAiRuntimeError);
    expect(await env.state.readActive("voice-sherpa")).toBeNull();
    // Staging/download leftovers cleaned.
    expect(fs.existsSync(env.paths.stagingRoot)).toBe(true); // root dir remains
  });

  test("health failure preserves the previous active runtime", async () => {
    const env = setup("1.0.0");
    const offer = await env.module.prepareInstall("voice-sherpa");
    await env.module.install({
      operationId: offer.operationId,
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });

    // Now publish a newer version but force health to fail for it.
    env.setCatalogVersion("1.1.0");
    env.setHealthOk(false);
    const offer2 = await env.module.prepareInstall("voice-sherpa");
    await expect(
      env.module.install({
        operationId: offer2.operationId,
        runtimeId: "voice-sherpa",
        expectedRuntimeVersion: offer2.runtimeVersion,
        consentToken: offer2.consentToken,
      })
    ).rejects.toThrow(LocalAiRuntimeError);

    // Previous active runtime (1.0.0) is still active.
    const active = await env.state.readActive("voice-sherpa");
    expect(active?.runtimeVersion).toBe("1.0.0");
  });
});

describe("LocalAiRuntimeModule update/repair/remove", () => {
  test("checkForUpdate reports a newer compatible version", async () => {
    const env = setup("1.0.0");
    const offer = await env.module.prepareInstall("voice-sherpa");
    await env.module.install({
      operationId: offer.operationId,
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    env.setCatalogVersion("1.2.0");
    const update = await env.module.checkForUpdate("voice-sherpa");
    expect(update?.installedVersion).toBe("1.0.0");
    expect(update?.availableVersion).toBe("1.2.0");
  });

  test("repair re-downloads the same version", async () => {
    const env = setup("1.0.0");
    const offer = await env.module.prepareInstall("voice-sherpa");
    await env.module.install({
      operationId: offer.operationId,
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    const result = await env.module.repair("voice-sherpa");
    expect(result.activated).toBe(true);
    expect(result.runtimeVersion).toBe("1.0.0");
  });

  test("remove clears active pointer and deletes the version dir", async () => {
    const env = setup("1.0.0");
    const offer = await env.module.prepareInstall("voice-sherpa");
    await env.module.install({
      operationId: offer.operationId,
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    const { versionRoot } = env.paths.getRuntimePaths("voice-sherpa", "1.0.0");
    expect(fs.existsSync(versionRoot)).toBe(true);
    await env.module.remove({ runtimeId: "voice-sherpa", removeModels: false });
    expect(await env.state.readActive("voice-sherpa")).toBeNull();
    expect(fs.existsSync(versionRoot)).toBe(false);
  });

  test("remove refuses while a worker holds a version lease", async () => {
    const env = setup("1.0.0");
    const offer = await env.module.prepareInstall("voice-sherpa");
    await env.module.install({
      operationId: offer.operationId,
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    env.module
      .getOperationCoordinator()
      .acquireVersionLease("voice-sherpa", "1.0.0");
    await expect(
      env.module.remove({ runtimeId: "voice-sherpa", removeModels: false })
    ).rejects.toThrow(LocalAiRuntimeError);
    env.module
      .getOperationCoordinator()
      .releaseVersionLease("voice-sherpa", "1.0.0");
  });
});
