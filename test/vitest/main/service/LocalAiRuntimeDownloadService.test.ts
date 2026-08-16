import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalAiRuntimeDownloadService } from "@/service/localAiRuntime/LocalAiRuntimeDownloadService";
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeCatalogEntry,
  type LocalAiRuntimeDownloadProgress,
} from "@/entityTypes/localAiRuntimeTypes";

let tmpRoot: string;
let destPath: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-dl-"));
  destPath = path.join(tmpRoot, "archive.zip");
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function sha256hex(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function entry(
  url: string,
  size: number,
  sha: string
): LocalAiRuntimeCatalogEntry {
  return {
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    downloadUrl: url,
    archiveFileName: "voice-runtime-darwin-arm64-1.0.0.zip",
    archiveSizeBytes: size,
    installedSizeBytes: size,
    sha256: sha,
    electronVersion: "35.7.5",
    nodeModuleAbi: "135",
    minAppVersion: "1.0.0",
    entryModule: "sherpa-onnx-node",
    requiredFiles: ["package.json"],
    dependencies: { "sherpa-onnx-node": "1.13.4" },
  };
}

const progressEvents: LocalAiRuntimeDownloadProgress[] = [];
function onProgress(p: LocalAiRuntimeDownloadProgress): void {
  progressEvents.push(p);
}

function svc(
  opts: { maxArchiveBytes?: number } = {}
): LocalAiRuntimeDownloadService {
  progressEvents.length = 0;
  return new LocalAiRuntimeDownloadService({
    enforceHttps: false,
    allowedHosts: [],
    maxArchiveBytes: opts.maxArchiveBytes,
  });
}

describe("LocalAiRuntimeDownloadService", () => {
  test("streams a valid archive and verifies sha256", async () => {
    const payload = Buffer.from("the quick brown fox");
    await withServer(
      (_req, res) => res.end(payload),
      async (base) => {
        const e = entry(`${base}/a.zip`, payload.length, sha256hex(payload));
        const result = await svc().download({
          operationId: "op",
          entry: e,
          destinationPath: destPath,
          signal: new AbortController().signal,
          onProgress,
        });
        expect(result.downloadedBytes).toBe(payload.length);
        expect(result.sha256).toBe(sha256hex(payload));
        expect(fs.readFileSync(destPath)).toEqual(payload);
        expect(progressEvents.some((p) => p.phase === "downloading")).toBe(
          true
        );
      }
    );
  });

  test("creates missing parent directory before writing the partial archive", async () => {
    const payload = Buffer.from("nested download destination");
    const nestedDest = path.join(tmpRoot, ".downloads", "op.zip.part");
    expect(fs.existsSync(path.dirname(nestedDest))).toBe(false);
    await withServer(
      (_req, res) => res.end(payload),
      async (base) => {
        const e = entry(`${base}/a.zip`, payload.length, sha256hex(payload));
        const result = await svc().download({
          operationId: "op",
          entry: e,
          destinationPath: nestedDest,
          signal: new AbortController().signal,
          onProgress,
        });
        expect(result.downloadedBytes).toBe(payload.length);
        expect(fs.existsSync(nestedDest)).toBe(true);
        expect(fs.readFileSync(nestedDest)).toEqual(payload);
      }
    );
  });

  test("rejects checksum mismatch and removes the partial file", async () => {
    const payload = Buffer.from("tampered content");
    await withServer(
      (_req, res) => res.end(payload),
      async (base) => {
        const e = entry(`${base}/a.zip`, payload.length, "0".repeat(64));
        await expect(
          svc().download({
            operationId: "op",
            entry: e,
            destinationPath: destPath,
            signal: new AbortController().signal,
            onProgress,
          })
        ).rejects.toThrow(LocalAiRuntimeError);
        expect(fs.existsSync(destPath)).toBe(false);
      }
    );
  });

  test("rejects when content-length exceeds local limit (preflight)", async () => {
    const payload = Buffer.alloc(1000, "x");
    await withServer(
      (_req, res) => {
        res.setHeader("content-length", String(payload.length));
        res.end(payload);
      },
      async (base) => {
        const e = entry(`${base}/a.zip`, payload.length, sha256hex(payload));
        await expect(
          svc({ maxArchiveBytes: 100 }).download({
            operationId: "op",
            entry: e,
            destinationPath: destPath,
            signal: new AbortController().signal,
            onProgress,
          })
        ).rejects.toThrow(LocalAiRuntimeError);
      }
    );
  });

  test("rejects non-HTTPS when enforcement is on", async () => {
    const e = entry("http://example.com/a.zip", 10, "0".repeat(64));
    const secure = new LocalAiRuntimeDownloadService({ enforceHttps: true });
    await expect(
      secure.download({
        operationId: "op",
        entry: e,
        destinationPath: destPath,
        signal: new AbortController().signal,
        onProgress,
      })
    ).rejects.toThrow(LocalAiRuntimeError);
  });

  test("rejects URL with credentials", async () => {
    const e = entry("http://user:pass@127.0.0.1/a.zip", 10, "0".repeat(64));
    await expect(
      svc().download({
        operationId: "op",
        entry: e,
        destinationPath: destPath,
        signal: new AbortController().signal,
        onProgress,
      })
    ).rejects.toThrow(LocalAiRuntimeError);
  });

  test("rejects oversized declared content-length before streaming", async () => {
    // CodeQL js/insecure-download (#48) robustness: the preflight must
    // refuse an archive whose declared size exceeds the local ceiling
    // before any bytes hit disk.
    const payload = Buffer.from("tiny");
    await withServer(
      (_req, res) => {
        // Lie about the size: declare far more than maxArchiveBytes.
        res.setHeader("Content-Length", String(1024 * 1024));
        res.end(payload);
      },
      async (base) => {
        const e = entry(`${base}/big.zip`, 1024 * 1024, sha256hex(payload));
        await expect(
          svc({ maxArchiveBytes: 4096 }).download({
            operationId: "op",
            entry: e,
            destinationPath: destPath,
            signal: new AbortController().signal,
            onProgress,
          })
        ).rejects.toThrow(LocalAiRuntimeError);
        expect(fs.existsSync(destPath)).toBe(false);
      }
    );
  });

  test("follows a redirect to the final artifact", async () => {
    const payload = Buffer.from("redirected payload bytes");
    await withServer(
      (req, res) => {
        if (req.url === "/start") {
          res.statusCode = 302;
          res.setHeader("Location", "/real");
          res.end();
          return;
        }
        res.end(payload);
      },
      async (base) => {
        const e = entry(`${base}/start`, payload.length, sha256hex(payload));
        const result = await svc().download({
          operationId: "op",
          entry: e,
          destinationPath: destPath,
          signal: new AbortController().signal,
          onProgress,
        });
        expect(result.sha256).toBe(sha256hex(payload));
      }
    );
  });

  test("cancels via AbortSignal and removes the partial file", async () => {
    const payload = Buffer.alloc(200_000, "y"); // large enough to be mid-stream
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-length": String(payload.length) });
        // Write slowly in chunks so cancellation can happen mid-stream.
        let i = 0;
        const timer = setInterval(() => {
          const chunk = payload.subarray(i, i + 1000);
          i += 1000;
          if (i >= payload.length) {
            res.end(chunk);
            clearInterval(timer);
          } else {
            res.write(chunk);
          }
        }, 5);
      },
      async (base) => {
        const controller = new AbortController();
        const e = entry(`${base}/a.zip`, payload.length, sha256hex(payload));
        const promise = svc().download({
          operationId: "op",
          entry: e,
          destinationPath: destPath,
          signal: controller.signal,
          onProgress,
        });
        // Cancel shortly after download begins.
        setTimeout(() => controller.abort(), 20);
        await expect(promise).rejects.toThrow(LocalAiRuntimeError);
        expect(fs.existsSync(destPath)).toBe(false);
      }
    );
  });

  test("enforces redirect limit", async () => {
    // Fixed loopback path (not req.url) to avoid CodeQL
    // js/server-side-unvalidated-url-redirection (CWE-601): the mock must
    // not echo unvalidated user input into a redirect target.
    const LOOP_PATH = "/loop";
    await withServer(
      (_req, res) => {
        res.statusCode = 302;
        res.setHeader("Location", LOOP_PATH); // deterministic self-redirect
        res.end();
      },
      async (base) => {
        const e = entry(`${base}/loop`, 5, "0".repeat(64));
        await expect(
          svc().download({
            operationId: "op",
            entry: e,
            destinationPath: destPath,
            signal: new AbortController().signal,
            onProgress,
          })
        ).rejects.toThrow(LocalAiRuntimeError);
      }
    );
  });
});
