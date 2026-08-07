import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeStateStore } from "@/service/localAiRuntime/LocalAiRuntimeStateStore";
import { LocalAiRuntimeCatalogService } from "@/service/localAiRuntime/LocalAiRuntimeCatalogService";
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeCatalog,
} from "@/entityTypes/localAiRuntimeTypes";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-cat-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function validCatalog(): LocalAiRuntimeCatalog {
  return {
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
      },
    ],
  };
}

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

function newService(
  base: string,
  cacheTtlMs = 60_000
): LocalAiRuntimeCatalogService {
  const state = new LocalAiRuntimeStateStore(
    new LocalAiRuntimePathService(tmpRoot)
  );
  return new LocalAiRuntimeCatalogService(
    { catalogUrl: `${base}/catalog.json`, allowedHosts: [], cacheTtlMs },
    state,
    { enforceHttps: false }
  );
}

describe("LocalAiRuntimeCatalogService", () => {
  test("fetches and caches a valid catalog", async () => {
    let requests = 0;
    await withServer(
      (_req, res) => {
        requests += 1;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(validCatalog()));
      },
      async (base) => {
        const svc = newService(base);
        const cat = await svc.getCatalog();
        expect(cat.runtimes).toHaveLength(1);
        // Second call within TTL uses cache (no new request).
        const cat2 = await svc.getCatalog();
        expect(cat2.runtimes).toHaveLength(1);
        expect(requests).toBe(1);
      }
    );
  });

  test("forceRefresh bypasses cache", async () => {
    let requests = 0;
    await withServer(
      (_req, res) => {
        requests += 1;
        res.end(JSON.stringify(validCatalog()));
      },
      async (base) => {
        const svc = newService(base);
        await svc.getCatalog();
        await svc.getCatalog(true);
        expect(requests).toBe(2);
      }
    );
  });

  test("invalid response does not replace a valid cache", async () => {
    let first = true;
    await withServer(
      (_req, res) => {
        if (first) {
          first = false;
          res.end(JSON.stringify(validCatalog()));
        } else {
          res.end("{not valid json");
        }
      },
      async (base) => {
        const svc = newService(base);
        await svc.getCatalog();
        // Force refresh returns garbage -> must throw but leave cache intact.
        await expect(svc.getCatalog(true)).rejects.toThrow(LocalAiRuntimeError);
        // Cache hit still works (does not hit network because TTL not expired).
        const cat = await svc.getCatalog();
        expect(cat.runtimes).toHaveLength(1);
      }
    );
  });

  test("rejects non-HTTPS catalog URL when enforcement is on", async () => {
    const state = new LocalAiRuntimeStateStore(
      new LocalAiRuntimePathService(tmpRoot)
    );
    const svc = new LocalAiRuntimeCatalogService(
      {
        catalogUrl: "http://example.com/catalog.json",
        allowedHosts: [],
        cacheTtlMs: 60_000,
      },
      state,
      { enforceHttps: true }
    );
    await expect(svc.getCatalog()).rejects.toThrow(LocalAiRuntimeError);
  });

  test("304 returns the cached entry", async () => {
    let first = true;
    await withServer(
      (req, res) => {
        const inm = req.headers["if-none-match"];
        if (!first && inm === '"abc"') {
          res.statusCode = 304;
          res.end();
          return;
        }
        first = false;
        res.setHeader("etag", '"abc"');
        res.end(JSON.stringify(validCatalog()));
      },
      async (base) => {
        const svc = newService(base, 0); // TTL 0 so we always revalidate
        const cat1 = await svc.getCatalog();
        expect(cat1.runtimes).toHaveLength(1);
        // Second fetch: cache TTL 0 forces revalidation; server returns 304.
        const cat2 = await svc.getCatalog();
        expect(cat2.runtimes).toHaveLength(1);
      }
    );
  });
});
