/**
 * VoiceModelDownloadService — consent-gated model download + extract + verify.
 *
 * Downloads a `.tar.bz2` model archive from GitHub releases, optionally verifies
 * its SHA256, and extracts it to `<modelRoot>/<targetDir>/` via `tar -xjf`.
 * The download + extract functions are DI'd for unit testing without network.
 * Mirrors the GitHubPluginFetcher download pattern.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as https from "node:https";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  VoiceModelCatalogService,
} from "./VoiceModelCatalogService";
import type { VoiceModelDownloadProgress } from "@/entityTypes/aiChatVoiceTypes";

const MAX_MODEL_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500 MB cap
const DOWNLOAD_TIMEOUT_MS = 300_000; // 5 min

export type DownloadFn = (
  url: string,
  dest: string,
  onProgress?: (p: { downloadedBytes: number; totalBytes?: number }) => void,
  signal?: { cancelled: boolean }
) => Promise<void>;

export type ExtractFn = (archive: string, destDir: string) => Promise<void>;

export interface VoiceModelDownloadServiceDeps {
  readonly modelRoot: string;
  readonly downloadFn?: DownloadFn;
  readonly extractFn?: ExtractFn;
}

export class VoiceModelDownloadService {
  private readonly catalog: VoiceModelCatalogService;
  private readonly modelRoot: string;
  private readonly downloadFn: DownloadFn;
  private readonly extractFn: ExtractFn;
  private readonly cancelFlags = new Map<string, { cancelled: boolean }>();

  constructor(deps: VoiceModelDownloadServiceDeps) {
    this.modelRoot = deps.modelRoot;
    this.catalog = new VoiceModelCatalogService({ modelRoot: deps.modelRoot });
    this.downloadFn = deps.downloadFn ?? defaultDownload;
    this.extractFn = deps.extractFn ?? defaultExtract;
  }

  async downloadModel(
    modelId: string,
    onProgress?: (p: VoiceModelDownloadProgress) => void
  ): Promise<void> {
    const def = this.catalog.getModel(modelId);
    if (!def) {
      throw new Error(`Unknown voice model: ${modelId}`);
    }

    const cancelSignal = { cancelled: false };
    this.cancelFlags.set(modelId, cancelSignal);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-model-"));
    const archivePath = path.join(tmpDir, path.basename(def.downloadUrl));

    try {
      // Phase 1: download
      onProgress?.({ modelId, phase: "downloading", pct: 0 });
      await this.downloadFn(
        def.downloadUrl,
        archivePath,
        ({ downloadedBytes, totalBytes }) => {
          if (cancelSignal.cancelled) return;
          const pct = totalBytes
            ? Math.round((downloadedBytes / totalBytes) * 100)
            : undefined;
          onProgress?.({
            modelId,
            phase: "downloading",
            pct,
            downloadedBytes,
            totalBytes,
          });
        },
        cancelSignal
      );
      if (cancelSignal.cancelled) {
        throw new Error("Download cancelled.");
      }

      // Phase 2: verify checksum (only if provided in the catalog)
      if (def.sha256) {
        onProgress?.({ modelId, phase: "verifying" });
        const hash = crypto
          .createHash("sha256")
          .update(fs.readFileSync(archivePath))
          .digest("hex");
        if (hash !== def.sha256) {
          throw new Error("Checksum mismatch — the downloaded file is corrupt.");
        }
      }

      // Phase 3: extract (ensure modelRoot exists)
      onProgress?.({ modelId, phase: "extracting" });
      fs.mkdirSync(this.modelRoot, { recursive: true });
      await this.extractFn(archivePath, this.modelRoot);

      // Phase 4: done
      onProgress?.({ modelId, phase: "done", pct: 100 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onProgress?.({ modelId, phase: "error", error: msg });
      throw error;
    } finally {
      this.cancelFlags.delete(modelId);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore temp cleanup failure
      }
    }
  }

  cancelDownload(modelId: string): void {
    const signal = this.cancelFlags.get(modelId);
    if (signal) {
      signal.cancelled = true;
    }
  }

  isDownloading(modelId: string): boolean {
    return this.cancelFlags.has(modelId);
  }
}

// ---------------------------------------------------------------------------
// Default download: HTTPS GET with redirect following + progress + cancel.
// Mirrors GitHubPluginFetcher.downloadZip.
// ---------------------------------------------------------------------------

async function defaultDownload(
  url: string,
  dest: string,
  onProgress?: (p: { downloadedBytes: number; totalBytes?: number }) => void,
  signal?: { cancelled: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let downloaded = 0;
    let total: number | undefined;

    const attempt = (targetUrl: string): void => {
      if (signal?.cancelled) {
        reject(new Error("Download cancelled."));
        return;
      }

      const req = https.get(targetUrl, (res) => {
        // Follow redirects (up to 5 hops)
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          redirects += 1;
          if (redirects > 5) {
            reject(new Error("Too many redirects."));
            return;
          }
          res.resume();
          attempt(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const contentLength = res.headers["content-length"];
        total = contentLength ? parseInt(contentLength, 10) : undefined;

        const writeStream = fs.createWriteStream(dest);
        res.on("data", (chunk: Buffer) => {
          if (signal?.cancelled) {
            req.destroy();
            writeStream.destroy();
            reject(new Error("Download cancelled."));
            return;
          }
          downloaded += chunk.length;
          if (downloaded > MAX_MODEL_DOWNLOAD_BYTES) {
            req.destroy();
            writeStream.destroy();
            reject(new Error("Download exceeds the size limit."));
            return;
          }
          onProgress?.({ downloadedBytes: downloaded, totalBytes: total });
        });
        writeStream.on("error", reject);
        writeStream.on("finish", () => resolve());
        res.pipe(writeStream);
      });

      req.on("error", reject);
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy(new Error("Download timed out."));
      });
    };

    attempt(url);
  });
}

// ---------------------------------------------------------------------------
// Default extract: spawn `tar -xjf` (mirrors NpmPluginFetcher's tar -xzf).
// ---------------------------------------------------------------------------

async function defaultExtract(archive: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xjf", archive, "-C", destDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on("error", (err) => {
      reject(
        new Error(
          `Failed to extract model archive (tar not available?): ${err.message}`,
        ),
      );
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`Extraction failed (exit code ${code}): ${stderr.trim()}`),
        );
      }
    });
  });
}
