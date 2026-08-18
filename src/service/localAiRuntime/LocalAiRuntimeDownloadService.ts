/**
 * Local AI Runtime — streaming archive download (design §12).
 *
 * Enforces HTTPS (production), host allowlist, bounded redirects, no URL
 * credentials, request timeout, content-length preflight, streaming SHA-256
 * with backpressure, local size ceiling, and cancellation. Archives are never
 * buffered in memory.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeCatalogEntry,
  type LocalAiRuntimeDownloadPhase,
  type LocalAiRuntimeDownloadProgress,
} from "@/entityTypes/localAiRuntimeTypes";
import {
  LOCAL_AI_RUNTIME_LIMITS,
  RUNTIME_PROGRESS_MAX_EVENTS_PER_SECOND,
} from "./localAiRuntimeConstants";

export interface RuntimeDownloadRequest {
  operationId: string;
  entry: LocalAiRuntimeCatalogEntry;
  destinationPath: string;
  signal: AbortSignal;
  onProgress: (progress: LocalAiRuntimeDownloadProgress) => void;
}

export interface RuntimeDownloadResult {
  archivePath: string;
  downloadedBytes: number;
  sha256: string;
}

export interface DownloadServiceOptions {
  /** Require HTTPS for every hop. Default true; tests of localhost may disable. */
  enforceHttps?: boolean;
  /** Optional host allowlist. When empty, host validation is skipped. */
  allowedHosts?: readonly string[];
  maxArchiveBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

const NS_PER_SECOND = 1_000_000_000;

export class LocalAiRuntimeDownloadService {
  constructor(private readonly options: DownloadServiceOptions = {}) {}

  async download(
    request: RuntimeDownloadRequest
  ): Promise<RuntimeDownloadResult> {
    const { entry, destinationPath, signal, onProgress, operationId } = request;
    const enforceHttps = this.options.enforceHttps ?? true;
    const allowedHosts = this.options.allowedHosts ?? [];
    const maxArchiveBytes =
      this.options.maxArchiveBytes ?? LOCAL_AI_RUNTIME_LIMITS.maxArchiveBytes;
    const maxRedirects =
      this.options.maxRedirects ?? LOCAL_AI_RUNTIME_LIMITS.maxRedirects;
    const timeoutMs =
      this.options.timeoutMs ?? LOCAL_AI_RUNTIME_LIMITS.timeoutMs;

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

    emit("downloading");

    const finalRes = await this.followRedirects(
      entry.downloadUrl,
      {
        signal,
        enforceHttps,
        allowedHosts,
        maxRedirects,
        timeoutMs,
      },
      emit
    );

    // Preflight: reject oversized content-length before streaming the body.
    const declared = finalRes.headers.get("content-length");
    if (declared !== null) {
      const declaredBytes = Number(declared);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxArchiveBytes) {
        throw new LocalAiRuntimeError(
          "runtime_download_too_large",
          `Archive content-length ${declaredBytes} exceeds limit ${maxArchiveBytes}.`
        );
      }
    }

    // Operation paths point at `<runtimeRoot>/.downloads/<id>.zip.part`; the
    // downloads dir is created lazily here so first-time installs do not fail
    // with ENOENT when opening the partial file.
    await mkdir(path.dirname(destinationPath), { recursive: true });

    const out = createWriteStream(destinationPath, { flags: "wx" });
    const hash = createHash("sha256");
    let received = 0;
    let lastEmitNs = BigInt(0);
    const minIntervalNs = BigInt(
      NS_PER_SECOND / RUNTIME_PROGRESS_MAX_EVENTS_PER_SECOND
    );

    const counter = new Transform({
      transform(chunk: Buffer, _enc, callback): void {
        if (signal.aborted) {
          callback(
            new LocalAiRuntimeError(
              "runtime_download_cancelled",
              "Download cancelled."
            )
          );
          return;
        }
        received += chunk.length;
        if (received > maxArchiveBytes) {
          callback(
            new LocalAiRuntimeError(
              "runtime_download_too_large",
              `Download exceeded limit ${maxArchiveBytes}.`
            )
          );
          return;
        }
        hash.update(chunk);
        // Throttled progress emission.
        const now = process.hrtime.bigint();
        if (now - lastEmitNs >= minIntervalNs) {
          lastEmitNs = now;
          emit("downloading", {
            downloadedBytes: received,
            totalBytes: entry.archiveSizeBytes,
            percent:
              entry.archiveSizeBytes > 0
                ? Math.min(100, (received / entry.archiveSizeBytes) * 100)
                : undefined,
          });
        }
        callback(null, chunk);
      },
    });

    try {
      const body = finalRes.body;
      if (!body) {
        throw new LocalAiRuntimeError(
          "runtime_download_failed",
          "Response had no body."
        );
      }
      // Backpressure-aware copy: web stream -> counter transform -> file.
      // `Readable.fromWeb` exists at runtime (Node 18+) but is absent from the
      // pinned @types/node@16 declarations; access it via a typed cast.
      const fromWeb = (
        Readable as unknown as {
          fromWeb(stream: ReadableStream<Uint8Array>): Readable;
        }
      ).fromWeb;
      await pipeline(fromWeb(body), counter, out);
    } catch (error) {
      // Best-effort cleanup of partial file; ignore cleanup errors.
      out.destroy();
      await this.safeRemove(destinationPath);
      throw this.normalizeError(error);
    }

    // The downloaded bytes must not exceed the catalog-declared size.
    if (received > entry.archiveSizeBytes) {
      await this.safeRemove(destinationPath);
      throw new LocalAiRuntimeError(
        "runtime_download_too_large",
        `Downloaded ${received} bytes exceeds catalog size ${entry.archiveSizeBytes}.`
      );
    }

    const sha256 = hash.digest("hex");
    if (sha256 !== entry.sha256) {
      await this.safeRemove(destinationPath);
      throw new LocalAiRuntimeError(
        "runtime_checksum_mismatch",
        "Downloaded archive SHA-256 does not match the catalog."
      );
    }

    return { archivePath: destinationPath, downloadedBytes: received, sha256 };
  }

  private async followRedirects(
    startUrl: string,
    opts: {
      signal: AbortSignal;
      enforceHttps: boolean;
      allowedHosts: readonly string[];
      maxRedirects: number;
      timeoutMs: number;
    },
    emit: (
      phase: LocalAiRuntimeDownloadPhase,
      extra?: Partial<LocalAiRuntimeDownloadProgress>
    ) => void
  ): Promise<Response> {
    let currentUrl = startUrl;
    let redirects = 0;
    // Combine caller cancellation with an absolute timeout.
    const timeoutSignal = AbortSignal.timeout(opts.timeoutMs);
    const combined = AbortSignal.any([opts.signal, timeoutSignal]);

    for (;;) {
      this.validateUrl(currentUrl, opts.enforceHttps, opts.allowedHosts);
      // Inline HTTPS guard so the secure-protocol guarantee is visible in the
      // data flow into fetch (CodeQL js/insecure-download, CWE-829): tests of
      // localhost disable enforceHttps, but production always requires https:.
      let fetchUrl = currentUrl;
      if (opts.enforceHttps) {
        let parsedFetch: URL;
        try {
          parsedFetch = new URL(fetchUrl);
        } catch {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Invalid download URL."
          );
        }
        if (parsedFetch.protocol !== "https:") {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Download URL must use HTTPS."
          );
        }
        fetchUrl = parsedFetch.href; // proven-https URL flows into fetch
      }
      let res: Response;
      try {
        res = await fetch(fetchUrl, {
          method: "GET",
          signal: combined,
          redirect: "manual",
        });
      } catch (error) {
        throw this.normalizeError(error);
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Redirect without Location header."
          );
        }
        redirects += 1;
        if (redirects > opts.maxRedirects) {
          throw new LocalAiRuntimeError(
            "runtime_download_failed",
            "Redirect limit exceeded."
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!res.ok) {
        throw new LocalAiRuntimeError(
          "runtime_download_failed",
          `Download failed with HTTP ${res.status}.`
        );
      }
      void emit;
      return res;
    }
  }

  private validateUrl(
    url: string,
    enforceHttps: boolean,
    allowedHosts: readonly string[]
  ): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        "Invalid download URL."
      );
    }
    if (enforceHttps && parsed.protocol !== "https:") {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        "Download URL must use HTTPS."
      );
    }
    if (parsed.username || parsed.password) {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        "Download URL must not carry credentials."
      );
    }
    if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.host)) {
      throw new LocalAiRuntimeError(
        "runtime_download_failed",
        `Download host not allowed: ${parsed.host}`
      );
    }
  }

  private async safeRemove(filePath: string): Promise<void> {
    try {
      await access(filePath);
      await rm(filePath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  private normalizeError(error: unknown): LocalAiRuntimeError {
    if (error instanceof LocalAiRuntimeError) return error;
    const err = error as { name?: string; message?: string };
    if (err?.name === "TimeoutError") {
      return new LocalAiRuntimeError(
        "runtime_download_failed",
        "Download timed out."
      );
    }
    if (err?.name === "AbortError") {
      return new LocalAiRuntimeError(
        "runtime_download_cancelled",
        "Download cancelled."
      );
    }
    return new LocalAiRuntimeError(
      "runtime_download_failed",
      `Download failed: ${err?.message ?? "unknown error"}`
    );
  }
}
