/**
 * LocalAiRuntimeFileSetDownloadService — resumable model file-set download
 * (computer-use design §7.5).
 *
 * Algorithm:
 *  1. Disk preflight: free space >= remaining bytes + 512 MiB margin, else
 *     `runtime_disk_space_insufficient`.
 *  2. Manifest first: download `manifest.json`, verify `manifestSha256`,
 *     and require its file list to EQUAL the catalog entry (path, size,
 *     hash). A mismatch fails with `runtime_manifest_invalid` before any
 *     weight is downloaded.
 *  3. Resumable `.part` files keyed by content hash beneath
 *     `.downloads/files/<sha256>.part`: an existing shorter part seeds the
 *     running SHA-256 and resumes with `Range: bytes=<n>-`; `206` with a
 *     matching `Content-Range` total continues, `200` restarts from zero,
 *     and a full-size part is verified and reused without network traffic.
 *  4. Network policy matches LocalAiRuntimeDownloadService: per-hop HTTPS,
 *     no URL credentials, at most 5 redirects.
 *  5. Idle timeout of 60 s without bytes (`runtime_download_stalled`)
 *     instead of a whole-download timeout; the operation AbortController
 *     cancels.
 *  6. Each file is finalized by exact size + SHA-256; a mismatch deletes
 *     the `.part` and retries that file once from zero; a second mismatch
 *     fails with `runtime_checksum_mismatch`.
 *  7. Progress aggregates bytes across files, throttled to the shared cap.
 */
import { createHash, type Hash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeDownloadPhase,
  type LocalAiRuntimeDownloadProgress,
  type ModelCatalogEntryV2,
  type ModelPackageFile,
} from "@/entityTypes/localAiRuntimeTypes";
import {
  LOCAL_AI_MODEL_PACKAGE_LIMITS,
  RUNTIME_PROGRESS_MAX_EVENTS_PER_SECOND,
} from "@/service/localAiRuntime/localAiRuntimeConstants";
import type { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { isSafeRelativeRuntimePath } from "@/schemas/localAiRuntime";

export interface FileSetDownloadRequest {
  operationId: string;
  entry: ModelCatalogEntryV2;
  /** Staging directory the verified files are finalized into. */
  stagingRoot: string;
  signal: AbortSignal;
  onProgress: (progress: LocalAiRuntimeDownloadProgress) => void;
}

export interface FileSetDownloadResult {
  readonly totalBytes: number;
  readonly files: readonly {
    path: string;
    sha256: string;
    sizeBytes: number;
  }[];
}

export interface FileSetDownloadOptions {
  /** Require HTTPS per hop. Default true; loopback tests may disable. */
  enforceHttps?: boolean;
  maxRedirects?: number;
  idleTimeoutMs?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Injectable disk-free probe (tests). */
  freeSpace?: (directory: string) => Promise<number>;
}

const NS_PER_SECOND = 1_000_000_000;

export class LocalAiRuntimeFileSetDownloadService {
  private readonly fetchImpl: typeof fetch;
  private readonly freeSpaceProbe: (directory: string) => Promise<number>;
  private readonly enforceHttps: boolean;
  private readonly maxRedirects: number;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly paths: LocalAiRuntimePathService,
    options: FileSetDownloadOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.freeSpaceProbe = options.freeSpace ?? probeFreeSpace;
    this.enforceHttps = options.enforceHttps ?? true;
    this.maxRedirects =
      options.maxRedirects ?? LOCAL_AI_MODEL_PACKAGE_LIMITS.maxRedirects;
    this.idleTimeoutMs =
      options.idleTimeoutMs ?? LOCAL_AI_MODEL_PACKAGE_LIMITS.idleTimeoutMs;
  }

  async download(
    request: FileSetDownloadRequest
  ): Promise<FileSetDownloadResult> {
    const { entry, stagingRoot, signal, operationId, onProgress } = request;
    const emit = (
      phase: LocalAiRuntimeDownloadPhase,
      extra?: Partial<LocalAiRuntimeDownloadProgress>
    ): void => {
      onProgress({
        operationId,
        runtimeId: entry.runtimeId,
        runtimeVersion: entry.runtimeVersion,
        phase,
        ...extra,
      });
    };

    // ---- 1. disk preflight ----
    emit("downloading");
    const catalogFiles = entry.files;
    const remaining = await this.computeRemainingBytes(catalogFiles);
    const free = await this.freeSpaceProbe(this.paths.runtimeRoot);
    if (free < remaining + LOCAL_AI_MODEL_PACKAGE_LIMITS.diskMarginBytes) {
      throw new LocalAiRuntimeError(
        "runtime_disk_space_insufficient",
        `Model download needs ${
          remaining + LOCAL_AI_MODEL_PACKAGE_LIMITS.diskMarginBytes
        } bytes free; ${free} available.`
      );
    }

    // ---- 2. manifest first ----
    const manifestFile = catalogFiles.find((f) => f.path === "manifest.json");
    if (!manifestFile) {
      throw new LocalAiRuntimeError(
        "runtime_manifest_invalid",
        "Catalog model entry has no manifest.json file."
      );
    }
    const manifestBytes = await this.fetchWholeFile(manifestFile, signal);
    const manifestSha = createHash("sha256").update(manifestBytes).digest("hex");
    if (manifestSha !== entry.manifestSha256) {
      throw new LocalAiRuntimeError(
        "runtime_manifest_invalid",
        "Downloaded manifest hash does not match the catalog's manifestSha256."
      );
    }
    const manifestFiles = extractManifestFileList(
      safeJsonParse(manifestBytes.toString("utf8"))
    );
    if (!fileListsEqual(manifestFiles, catalogFiles)) {
      throw new LocalAiRuntimeError(
        "runtime_manifest_invalid",
        "Model manifest file list does not equal the catalog entry."
      );
    }

    // ---- 3..6 per-file resumable downloads ----
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(this.paths.modelPartsRoot, { recursive: true });

    let completedBytes = 0;
    const results: Array<{
      path: string;
      sha256: string;
      sizeBytes: number;
    }> = [];
    let lastEmitNs = BigInt(0);
    const minIntervalNs = BigInt(
      NS_PER_SECOND / RUNTIME_PROGRESS_MAX_EVENTS_PER_SECOND
    );
    const totalBytes = catalogFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
    const throttledProgress = (fileCompletedBytes: number): void => {
      const now = process.hrtime.bigint();
      if (now - lastEmitNs < minIntervalNs) return;
      lastEmitNs = now;
      const downloaded = completedBytes + fileCompletedBytes;
      emit("downloading", {
        downloadedBytes: downloaded,
        totalBytes,
        percent:
          totalBytes > 0
            ? Math.min(100, (downloaded / totalBytes) * 100)
            : undefined,
      });
    };

    for (const file of catalogFiles) {
      if (signal.aborted) {
        throw new LocalAiRuntimeError(
          "runtime_download_cancelled",
          "Model download cancelled."
        );
      }
      if (file.path === "manifest.json") {
        // Already downloaded and hash-verified in the manifest-first step;
        // write the exact bytes into staging instead of re-fetching.
        const destination = path.resolve(stagingRoot, "manifest.json");
        await mkdir(path.dirname(destination), { recursive: true });
        await (await import("node:fs/promises")).writeFile(
          destination,
          manifestBytes
        );
        results.push({
          path: "manifest.json",
          sha256: entry.manifestSha256,
          sizeBytes: file.sizeBytes,
        });
        completedBytes += file.sizeBytes;
        continue;
      }
      const sha = await this.downloadFileResumable(
        file,
        stagingRoot,
        signal,
        throttledProgress
      );
      completedBytes += file.sizeBytes;
      results.push({ path: file.path, sha256: sha, sizeBytes: file.sizeBytes });
    }

    return { totalBytes, files: results };
  }

  /** Bytes still missing across the file set, accounting for reusable parts. */
  private async computeRemainingBytes(
    files: readonly ModelPackageFile[]
  ): Promise<number> {
    let remaining = 0;
    for (const file of files) {
      const partSize = await stat(this.paths.getResumablePartPath(file.sha256))
        .then((s) => s.size)
        .catch(() => 0);
      const usable = Math.min(partSize, file.sizeBytes);
      remaining += file.sizeBytes - usable;
    }
    return remaining;
  }

  /**
   * Download one file into its hash-keyed `.part` and finalize (rename) it
   * into staging. Retries exactly once from zero on a checksum mismatch.
   */
  private async downloadFileResumable(
    file: ModelPackageFile,
    stagingRoot: string,
    signal: AbortSignal,
    onFileProgress: (completedBytes: number) => void
  ): Promise<string> {
    if (!isSafeRelativeRuntimePath(file.path)) {
      throw new LocalAiRuntimeError(
        "runtime_manifest_invalid",
        `Unsafe file path in model package: ${file.path}`
      );
    }
    let attempts = 0;
    for (;;) {
      try {
        return await this.attemptFileResumable(
          file,
          stagingRoot,
          signal,
          onFileProgress
        );
      } catch (error) {
        if (
          error instanceof LocalAiRuntimeError &&
          error.code === "runtime_checksum_mismatch" &&
          attempts < LOCAL_AI_MODEL_PACKAGE_LIMITS.checksumRetries
        ) {
          attempts += 1;
          await rm(this.paths.getResumablePartPath(file.sha256), {
            force: true,
          }).catch(() => undefined);
          continue;
        }
        throw error;
      }
    }
  }

  private async attemptFileResumable(
    file: ModelPackageFile,
    stagingRoot: string,
    signal: AbortSignal,
    onFileProgress: (completedBytes: number) => void
  ): Promise<string> {
    const partPath = this.paths.getResumablePartPath(file.sha256);
    const existingSize = await stat(partPath)
      .then((s) => s.size)
      .catch(() => 0);

    if (existingSize > file.sizeBytes) {
      // A foreign/corrupted part: discard and restart from zero.
      await rm(partPath, { force: true });
    } else if (existingSize === file.sizeBytes) {
      // Full-size part: verify and reuse with no network traffic.
      const sha = await hashFile(partPath);
      if (sha === file.sha256) {
        await this.finalizePart(partPath, stagingRoot, file);
        return sha;
      }
      await rm(partPath, { force: true });
    }

    const startByte =
      existingSize > 0 && existingSize < file.sizeBytes ? existingSize : 0;

    const opened = await this.openWithPolicy(file.url, signal, startByte);
    try {
      if (opened.status === 206) {
        const total = parseContentRangeTotal(
          opened.response.headers.get("content-range")
        );
        if (total !== file.sizeBytes) {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            `Server Content-Range total (${total}) does not match the catalog size (${file.sizeBytes}).`
          );
        }
        if (startByte === 0) {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Server returned 206 for a non-range request."
          );
        }
        // Resume: seed the running hash with the existing part bytes.
        const hash = createHash("sha256");
        await hashExistingBytes(partPath, hash);
        return await this.streamToPart(
          file,
          partPath,
          stagingRoot,
          signal,
          onFileProgress,
          startByte,
          hash
        );
      }

      if (opened.status === 200) {
        // Fresh download from zero (server ignored or got no Range).
        return await this.streamToPart(
          file,
          partPath,
          stagingRoot,
          signal,
          onFileProgress,
          0,
          createHash("sha256")
        );
      }

      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        `Model file request failed with HTTP ${opened.status}.`
      );
    } finally {
      await opened.response.body?.cancel().catch(() => undefined);
    }
  }

  /** Stream the response body into the .part (append on resume) and finalize. */
  private async streamToPart(
    file: ModelPackageFile,
    partPath: string,
    stagingRoot: string,
    signal: AbortSignal,
    onFileProgress: (completedBytes: number) => void,
    startByte: number,
    hash: Hash
  ): Promise<string> {
    const response = this.pendingResponse;
    this.pendingResponse = null;
    const body = response?.body;
    if (!response || !body) {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        "Model file response had no body."
      );
    }

    await mkdir(path.dirname(partPath), { recursive: true });
    let received = startByte;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const stallController = new AbortController();
    const armIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        stallController.abort(
          new LocalAiRuntimeError(
            "runtime_download_stalled",
            "No bytes received within the idle timeout; download stalled."
          )
        );
      }, this.idleTimeoutMs);
    };

    const out = createWriteStream(partPath, {
      flags: startByte > 0 ? "a" : "w",
    });
    const counter = new Transform({
      transform(chunk: Buffer, _enc, callback): void {
        received += chunk.length;
        if (received > file.sizeBytes) {
          callback(
            new LocalAiRuntimeError(
              "runtime_download_too_large",
              "Model file exceeded its declared size."
            )
          );
          return;
        }
        hash.update(chunk);
        armIdleTimer();
        onFileProgress(received);
        callback(null, chunk);
      },
    });
    const combined = AbortSignal.any([signal, stallController.signal]);

    try {
      const fromWeb = (
        Readable as unknown as {
          fromWeb(stream: ReadableStream<Uint8Array>): Readable;
        }
      ).fromWeb;
      armIdleTimer();
      await pipeline(fromWeb(body), counter, out, { signal: combined });
    } catch (error) {
      out.destroy();
      throw normalizeFileSetError(error);
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }

    if (received !== file.sizeBytes) {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        `Model file ${file.path}: received ${received} of ${file.sizeBytes} bytes.`
      );
    }
    const sha256 = hash.digest("hex");
    if (sha256 !== file.sha256) {
      throw new LocalAiRuntimeError(
        "runtime_checksum_mismatch",
        `Model file ${file.path} failed SHA-256 verification.`
      );
    }
    await this.finalizePart(partPath, stagingRoot, file);
    return sha256;
  }

  /** Rename a verified part into staging at its safe relative path. */
  private async finalizePart(
    partPath: string,
    stagingRoot: string,
    file: ModelPackageFile
  ): Promise<void> {
    const stagingResolved = path.resolve(stagingRoot);
    const destination = path.resolve(stagingRoot, file.path);
    if (!destination.startsWith(stagingResolved + path.sep)) {
      throw new LocalAiRuntimeError(
        "runtime_path_outside_root",
        "Model file escapes the staging root."
      );
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(partPath, destination);
  }

  private pendingResponse: Response | null = null;

  /**
   * Open a download response applying the shared URL policy and optional
   * Range header. Stashes the response for the immediately following
   * streamToPart/fetchWholeFile call (single consumer).
   */
  private async openWithPolicy(
    startUrl: string,
    signal: AbortSignal,
    startByte: number
  ): Promise<{ status: number; response: Response }> {
    let currentUrl = startUrl;
    let redirects = 0;
    for (;;) {
      this.validateUrl(currentUrl);
      // Inline HTTPS guard so the secure-protocol guarantee is visible in
      // the data flow into fetch (CodeQL js/insecure-download, CWE-829).
      let fetchUrl = currentUrl;
      if (this.enforceHttps) {
        const parsed = new URL(fetchUrl);
        if (parsed.protocol !== "https:") {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Model file URL must use HTTPS."
          );
        }
        fetchUrl = parsed.href; // proven-https URL flows into fetch
      }
      const headers: Record<string, string> = {};
      if (startByte > 0) headers.Range = `bytes=${startByte}-`;
      let response: Response;
      try {
        response = await this.fetchImpl(fetchUrl, {
          method: "GET",
          headers,
          signal,
          redirect: "manual",
        });
      } catch (error) {
        throw normalizeFileSetError(error);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Redirect without Location header."
          );
        }
        redirects += 1;
        if (redirects > this.maxRedirects) {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Redirect limit exceeded."
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      this.pendingResponse = response;
      return { status: response.status, response };
    }
  }

  /** Small files (manifest.json) are fetched whole and hashed in memory. */
  private async fetchWholeFile(
    file: ModelPackageFile,
    signal: AbortSignal
  ): Promise<Buffer> {
    const opened = await this.openWithPolicy(file.url, signal, 0);
    try {
      if (opened.status !== 200) {
        throw new LocalAiRuntimeError(
          "runtime_download_failed",
          `Manifest fetch failed with HTTP ${opened.status}.`
        );
      }
      const buffer = Buffer.from(await opened.response.arrayBuffer());
      if (buffer.length !== file.sizeBytes) {
        throw new LocalAiRuntimeError(
          "runtime_manifest_invalid",
          "Manifest size does not match the catalog."
        );
      }
      return buffer;
    } finally {
      await opened.response.body?.cancel().catch(() => undefined);
    }
  }

  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        "Invalid model file URL."
      );
    }
    if (this.enforceHttps && parsed.protocol !== "https:") {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        "Model file URL must use HTTPS."
      );
    }
    if (parsed.username || parsed.password) {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        "Model file URL must not carry credentials."
      );
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Read the producer manifest's declared file list (path/size/hash triples). */
function extractManifestFileList(
  manifest: unknown
): Array<{ path: string; sizeBytes: number; sha256: string }> | null {
  if (typeof manifest !== "object" || manifest === null) return null;
  const files = (manifest as { files?: unknown }).files;
  if (!Array.isArray(files)) return null;
  const out: Array<{ path: string; sizeBytes: number; sha256: string }> = [];
  for (const entry of files) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.path !== "string" ||
      typeof record.sizeBytes !== "number" ||
      typeof record.sha256 !== "string"
    ) {
      return null;
    }
    out.push({
      path: record.path,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
    });
  }
  return out;
}

/**
 * Equality of the producer manifest's file list and the catalog entry.
 * `manifest.json` itself is excluded from the comparison — its integrity is
 * already proven by the manifestSha256 check that ran before parsing, and a
 * file cannot contain its own hash.
 */
function fileListsEqual(
  manifestFiles: Array<{
    path: string;
    sizeBytes: number;
    sha256: string;
  }> | null,
  catalogFiles: readonly ModelPackageFile[]
): boolean {
  if (!manifestFiles) return false;
  const manifestListed = manifestFiles.filter((f) => f.path !== "manifest.json");
  const catalogListed = catalogFiles.filter((f) => f.path !== "manifest.json");
  if (manifestListed.length !== catalogListed.length) return false;
  const byPath = new Map(manifestListed.map((f) => [f.path, f]));
  for (const file of catalogListed) {
    const match = byPath.get(file.path);
    if (
      !match ||
      match.sizeBytes !== file.sizeBytes ||
      match.sha256 !== file.sha256
    ) {
      return false;
    }
  }
  return true;
}

function parseContentRangeTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(contentRange);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk as Buffer))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

function hashExistingBytes(filePath: string, hash: Hash): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk as Buffer))
      .on("end", () => resolve())
      .on("error", reject);
  });
}

function normalizeFileSetError(error: unknown): LocalAiRuntimeError {
  if (error instanceof LocalAiRuntimeError) return error;
  const err = error as { name?: string; message?: string };
  if (err?.name === "TimeoutError") {
    return new LocalAiRuntimeError(
      "runtime_download_failed",
      "Model file download timed out."
    );
  }
  if (err?.name === "AbortError") {
    return new LocalAiRuntimeError(
      "runtime_download_cancelled",
      "Model download cancelled."
    );
  }
  return new LocalAiRuntimeError(
    "runtime_download_failed",
    `Model download failed: ${err?.message ?? "unknown error"}`
  );
}

/** Node statfs probe with a @types/node-safe cast. */
async function probeFreeSpace(directory: string): Promise<number> {
  const fsPromises = (await import("node:fs/promises")) as unknown as {
    statfs?: (path: string) => Promise<{ bsize: number; bavail: number }>;
  };
  if (typeof fsPromises.statfs !== "function") {
    return Number.MAX_SAFE_INTEGER; // probe unavailable: skip preflight
  }
  const stats = await fsPromises.statfs(directory);
  return stats.bsize * stats.bavail;
}
