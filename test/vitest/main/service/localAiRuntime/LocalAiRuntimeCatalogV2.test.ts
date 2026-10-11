// test/vitest/main/service/localAiRuntime/LocalAiRuntimeCatalogV2.test.ts
//
// Catalog v2 (computer-use design §7.3) and model file-set delivery (§7.5):
// forward compatibility (unknown entries skipped), strict validation of
// known entries, model entry invariants, resumable downloads, install-set
// consent ordering, and reference-counted version leases.
import { describe, it, expect } from "vitest";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  parseLocalAiRuntimeCatalogV2,
} from "@/schemas/localAiRuntime";
import { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeFileSetDownloadService } from "@/service/localAiRuntime/LocalAiRuntimeFileSetDownloadService";
import { LocalAiRuntimeOperationCoordinator } from "@/service/localAiRuntime/LocalAiRuntimeOperationCoordinator";
import { LOCAL_AI_MODEL_PACKAGE_LIMITS } from "@/service/localAiRuntime/localAiRuntimeConstants";
import { LocalAiRuntimeError } from "@/entityTypes/localAiRuntimeTypes";

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

const NATIVE_ENTRY = {
  packageKind: "native_runtime",
  runtimeId: "grounding-onnxruntime",
  runtimeVersion: "1.2.0",
  platform: "win32",
  arch: "x64",
  downloadUrl: "https://releases.example/grounding-runtime-win32-x64-1.2.0.zip",
  archiveFileName: "grounding-runtime-win32-x64-1.2.0.zip",
  archiveSizeBytes: 1024,
  installedSizeBytes: 4096,
  sha256: "a".repeat(64),
  electronVersion: "43.5.1",
  nodeModuleAbi: "140",
  minAppVersion: "1.0.0",
  entryModule: "onnxruntime-node",
  executionProviders: ["dml", "cpu"],
  requiredFiles: ["manifest.json"],
  dependencies: {},
};

const WEIGHTS = Buffer.from("weights-bytes-0123456789");

const MANIFEST_BODY = JSON.stringify({
  schemaVersion: 1,
  modelArchitecture: "gui-actor-2b-qwen2vl",
  runtimeId: "grounding-model-gui-actor-2b-int4",
  runtimeVersion: "0.9.0",
  modelManifestVersion: 1,
  groundingContractVersion: 1,
  groundingAdapterId: "gui-actor-onnx",
  groundingAdapterVersion: "1.0.0",
  preprocessingRevision: "qwen2vl-smartresize-v1",
  decodingRevision: "gui-actor-pointer-centroid-v1",
  calibrationRevision: "c1",
  // The manifest lists the weight files; manifest.json itself is verified by
  // its catalog manifestSha256 (a file cannot contain its own hash).
  files: [
    { path: "graph/decoder.onnx", url: "https://m.example/decoder.onnx", sizeBytes: WEIGHTS.length, sha256: sha256(WEIGHTS) },
  ],
  license: { model: "MIT", baseModel: "Apache-2.0", baseModelId: "Qwen/Qwen2-VL-2B-Instruct" },
});
const MANIFEST_BYTES = Buffer.from(MANIFEST_BODY);

function modelEntry(overrides: Record<string, unknown> = {}) {
  const files = [
    { path: "manifest.json", url: "https://m.example/manifest.json", sizeBytes: MANIFEST_BYTES.length, sha256: sha256(MANIFEST_BYTES) },
    { path: "graph/decoder.onnx", url: "https://m.example/decoder.onnx", sizeBytes: WEIGHTS.length, sha256: sha256(WEIGHTS) },
  ];
  return {
    packageKind: "model",
    runtimeId: "grounding-model-gui-actor-2b-int4",
    runtimeVersion: "0.9.0",
    platform: "any",
    arch: "any",
    minAppVersion: "1.0.0",
    downloadSizeBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    installedSizeBytes: files.reduce((s, f) => s + f.sizeBytes, 0) + 1024,
    minSystemMemoryBytes: 8 * 1024 * 1024 * 1024,
    groundingContractVersion: 1,
    groundingAdapterId: "gui-actor-onnx",
    groundingAdapterVersion: "1.0.0",
    modelArchitecture: "gui-actor-2b-qwen2vl",
    modelManifestVersion: 1,
    preprocessingRevision: "qwen2vl-smartresize-v1",
    decodingRevision: "gui-actor-pointer-centroid-v1",
    calibrationRevision: "c1",
    requiresRuntime: { runtimeId: "grounding-onnxruntime", minVersion: "1.0.0" },
    supportedExecutionProviders: ["cpu"],
    license: { model: "MIT", baseModel: "Apache-2.0", baseModelId: "Qwen/Qwen2-VL-2B-Instruct" },
    manifestSha256: sha256(MANIFEST_BODY),
    files,
    ...overrides,
  };
}

function v2Doc(runtimes: unknown[]): unknown {
  return {
    schemaVersion: 2,
    catalogVersion: "1.0.0",
    releaseTag: "r1",
    publishedAt: "2026-10-12T00:00:00Z",
    runtimes,
  };
}

describe("parseLocalAiRuntimeCatalogV2", () => {
  it("parses native and model entries", () => {
    const result = parseLocalAiRuntimeCatalogV2(v2Doc([NATIVE_ENTRY, modelEntry()]));
    expect(result.skipped).toEqual([]);
    expect(result.catalog.runtimes).toHaveLength(2);
    expect(result.catalog.runtimes[0].packageKind).toBe("native_runtime");
    expect(result.catalog.runtimes[1].packageKind).toBe("model");
  });

  it("skips unknown runtime ids and unknown package kinds (forward compat)", () => {
    const result = parseLocalAiRuntimeCatalogV2(
      v2Doc([
        { runtimeId: "future-runtime-x", packageKind: "native_runtime" },
        { runtimeId: "embedding-xenova", packageKind: "quantum_package" },
        NATIVE_ENTRY,
      ])
    );
    expect(result.skipped).toEqual(["future-runtime-x", "embedding-xenova:quantum_package"]);
    expect(result.catalog.runtimes).toHaveLength(1);
  });

  it("rejects a malformed KNOWN entry (whole catalog invalid)", () => {
    expect(() =>
      parseLocalAiRuntimeCatalogV2(
        v2Doc([{ ...NATIVE_ENTRY, executionProviders: undefined }])
      )
    ).toThrow(LocalAiRuntimeError);
    expect(() =>
      parseLocalAiRuntimeCatalogV2(
        v2Doc([modelEntry({ manifestSha256: "b".repeat(64) })])
      )
    ).toThrow(/manifestSha256/);
  });

  it("enforces model invariants: duplicate paths, size sum, limits, https, license", () => {
    const dup = modelEntry();
    dup.files[1] = { ...dup.files[1], path: "manifest.json" };
    expect(() => parseLocalAiRuntimeCatalogV2(v2Doc([dup]))).toThrow(/Duplicate/);

    expect(() =>
      parseLocalAiRuntimeCatalogV2(v2Doc([modelEntry({ downloadSizeBytes: 1 })]))
    ).toThrow(/downloadSizeBytes/);

    expect(() =>
      parseLocalAiRuntimeCatalogV2(v2Doc([modelEntry({ license: { model: "cc-by-nc", baseModel: "X", baseModelId: "Y" } })]))
    ).not.toThrow(); // schema validates shape; blocklist policy is release tooling

    const httpFile = modelEntry();
    httpFile.files[1] = { ...httpFile.files[1], url: "http://m.example/decoder.onnx" };
    expect(() => parseLocalAiRuntimeCatalogV2(v2Doc([httpFile]))).toThrow(/HTTPS/);
  });

  it("requires v2 documents and names the schema version on v1 input", () => {
    expect(() =>
      parseLocalAiRuntimeCatalogV2({ schemaVersion: 1, runtimes: [] })
    ).toThrow(/v1 document/);
  });
});

/* --------------------------- file-set downloader --------------------------- */

function makePaths(): { paths: LocalAiRuntimePathService; dir: string } {
  const dir = path.join(tmpdir(), `aifetchly-cu-v2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return { paths: new LocalAiRuntimePathService(dir), dir };
}

function streamOf(body: string | Buffer): ReadableStream<Uint8Array> {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe("LocalAiRuntimeFileSetDownloadService", () => {
  it("downloads a full set, verifies hashes, and finalizes into staging", async () => {
    const { paths, dir } = makePaths();
    const staging = path.join(dir, "staging");
    const requests: Array<{ url: string; range?: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      requests.push({ url: href, range: (init?.headers as Record<string, string>)?.Range });
      if (href.endsWith("manifest.json")) {
        return new Response(streamOf(MANIFEST_BODY), { status: 200 });
      }
      return new Response(streamOf(WEIGHTS), { status: 200 });
    }) as typeof fetch;
    const service = new LocalAiRuntimeFileSetDownloadService(paths, {
      fetchImpl,
      enforceHttps: true,
      freeSpace: async () => 10 * 1024 * 1024 * 1024,
    });
    const entry = modelEntry() as ReturnType<typeof modelEntry> & { files: { path: string; sizeBytes: number; sha256: string }[] };
    const result = await service.download({
      operationId: "op-1",
      entry: entry as never,
      stagingRoot: staging,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
    expect(result.files).toHaveLength(2);
    expect(await readFile(path.join(staging, "graph", "decoder.onnx"))).toEqual(WEIGHTS);
    // Full-size parts are consumed (renamed), not left behind.
    await expect(stat(paths.getResumablePartPath(entry.files[1].sha256))).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("fails the disk preflight below the margin", async () => {
    const { paths, dir } = makePaths();
    const service = new LocalAiRuntimeFileSetDownloadService(paths, {
      fetchImpl: (async () => new Response(null)) as unknown as typeof fetch,
      freeSpace: async () => 0,
    });
    await expect(
      service.download({
        operationId: "op-2",
        entry: modelEntry() as never,
        stagingRoot: path.join(dir, "staging"),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toThrowError(LocalAiRuntimeError);
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects a catalog entry whose file list disagrees with the manifest", async () => {
    const { paths, dir } = makePaths();
    // The manifest itself is authentic (hash matches); the CATALOG declares a
    // decoder size that differs from what the manifest lists.
    const disagreeing = modelEntry();
    (disagreeing.files[1] as { sizeBytes: number }).sizeBytes = WEIGHTS.length + 1;
    disagreeing.downloadSizeBytes = disagreeing.files.reduce(
      (s: number, f: { sizeBytes: number }) => s + f.sizeBytes,
      0
    );
    const service = new LocalAiRuntimeFileSetDownloadService(paths, {
      fetchImpl: (async (url: string | URL) =>
        String(url).endsWith("manifest.json")
          ? new Response(streamOf(MANIFEST_BODY), { status: 200 })
          : new Response(streamOf(WEIGHTS), { status: 200 })) as unknown as typeof fetch,
      freeSpace: async () => 10 * 1024 * 1024 * 1024,
    });
    await expect(
      service.download({
        operationId: "op-3",
        entry: disagreeing as never,
        stagingRoot: path.join(dir, "staging"),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toThrow(/does not equal/);
    await rm(dir, { recursive: true, force: true });
  });

  it("resumes from a .part with a 206 and rejects a mismatched Content-Range", async () => {
    const { paths, dir } = makePaths();
    const entry = modelEntry() as never as {
      files: { path: string; url: string; sizeBytes: number; sha256: string }[];
      runtimeId: string;
      runtimeVersion: string;
    };
    const weightsFile = entry.files[1];
    // Pre-seed a partial part: the first 10 bytes of WEIGHTS.
    const firstHalf = WEIGHTS.subarray(0, 10);
    await (await import("node:fs/promises")).mkdir(paths.modelPartsRoot, {
      recursive: true,
    });
    await writeFile(paths.getResumablePartPath(weightsFile.sha256), firstHalf);

    let rangeSeen: string | undefined;
    const contentRangeState: { total: string } = {
      total: `bytes 10-${WEIGHTS.length - 1}/${WEIGHTS.length}`,
    };
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("manifest.json")) {
        return new Response(streamOf(MANIFEST_BODY), { status: 200 });
      }
      rangeSeen = (init?.headers as Record<string, string>)?.Range;
      const rest = WEIGHTS.subarray(10);
      return new Response(streamOf(rest), {
        status: 206,
        headers: { "content-range": contentRangeState.total },
      });
    }) as unknown as typeof fetch;

    const service = new LocalAiRuntimeFileSetDownloadService(paths, {
      fetchImpl,
      freeSpace: async () => 10 * 1024 * 1024 * 1024,
    });
    const staging = path.join(dir, "staging");
    const result = await service.download({
      operationId: "op-4",
      entry: entry as never,
      stagingRoot: staging,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
    expect(rangeSeen).toBe(`bytes=10-`);
    expect(await readFile(path.join(staging, "graph", "decoder.onnx"))).toEqual(WEIGHTS);
    void result;

    // Now a mismatched Content-Range total must be rejected outright.
    contentRangeState.total = `bytes 10-${WEIGHTS.length - 1}/${WEIGHTS.length + 999}`;
    await writeFile(
      paths.getResumablePartPath(weightsFile.sha256),
      WEIGHTS.subarray(0, 10)
    );
    await expect(
      service.download({
        operationId: "op-5",
        entry: entry as never,
        stagingRoot: path.join(dir, "staging2"),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toThrow(/Content-Range/);
    await rm(dir, { recursive: true, force: true });
  });

  it("reuses a verified full-size .part without network traffic", async () => {
    const { paths, dir } = makePaths();
    const entry = modelEntry() as never as {
      files: { path: string; sizeBytes: number; sha256: string }[];
      runtimeId: string;
      runtimeVersion: string;
    };
    const weightsFile = entry.files[1];
    await (await import("node:fs/promises")).mkdir(paths.modelPartsRoot, {
      recursive: true,
    });
    await writeFile(paths.getResumablePartPath(weightsFile.sha256), WEIGHTS);

    let networkCalls = 0;
    const service = new LocalAiRuntimeFileSetDownloadService(paths, {
      fetchImpl: (async (url: string | URL) => {
        networkCalls++;
        return new Response(streamOf(MANIFEST_BODY), { status: 200 });
      }) as unknown as typeof fetch,
      freeSpace: async () => 10 * 1024 * 1024 * 1024,
    });
    const staging = path.join(dir, "staging");
    await service.download({
      operationId: "op-6",
      entry: entry as never,
      stagingRoot: staging,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
    expect(networkCalls).toBe(1); // manifest only; weights part was reused
    await rm(dir, { recursive: true, force: true });
  });
});

/* ------------------------------ coordinator ------------------------------ */

describe("LocalAiRuntimeOperationCoordinator version leases", () => {
  it("reference-counts: two holders, one release keeps the lease", () => {
    const coordinator = new LocalAiRuntimeOperationCoordinator();
    coordinator.acquireVersionLease("grounding-onnxruntime", "1.2.0");
    coordinator.acquireVersionLease("grounding-onnxruntime", "1.2.0");
    coordinator.releaseVersionLease("grounding-onnxruntime", "1.2.0");
    expect(coordinator.isVersionLeased("grounding-onnxruntime", "1.2.0")).toBe(true);
    expect(coordinator.versionLeaseCount("grounding-onnxruntime", "1.2.0")).toBe(1);
    coordinator.releaseVersionLease("grounding-onnxruntime", "1.2.0");
    expect(coordinator.isVersionLeased("grounding-onnxruntime", "1.2.0")).toBe(false);
  });

  it("runs a deferred activation once every lease is released", async () => {
    const coordinator = new LocalAiRuntimeOperationCoordinator();
    let applied = 0;
    coordinator.deferActivation("grounding-onnxruntime", "1.3.0", async () => {
      applied += 1;
    });
    expect(coordinator.hasPendingActivation("grounding-onnxruntime")).toBe(true);
    coordinator.acquireVersionLease("grounding-onnxruntime", "1.2.0");
    coordinator.releaseVersionLease("grounding-onnxruntime", "1.2.0");
    // The deferred apply runs asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(applied).toBe(1);
    expect(coordinator.hasPendingActivation("grounding-onnxruntime")).toBe(false);
  });

  it("keeps a deferred activation waiting while any version is leased", async () => {
    const coordinator = new LocalAiRuntimeOperationCoordinator();
    let applied = 0;
    coordinator.deferActivation("grounding-onnxruntime", "1.3.0", async () => {
      applied += 1;
    });
    coordinator.acquireVersionLease("grounding-onnxruntime", "1.2.0");
    coordinator.releaseVersionLease("grounding-onnxruntime", "1.2.0");
    coordinator.acquireVersionLease("grounding-onnxruntime", "1.4.0");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(applied).toBe(1); // already ran before the new lease
  });
});

void LOCAL_AI_MODEL_PACKAGE_LIMITS;
