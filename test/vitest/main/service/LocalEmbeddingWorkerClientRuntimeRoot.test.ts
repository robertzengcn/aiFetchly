import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalEmbeddingWorkerClient } from "@/service/embedding/LocalEmbeddingWorkerClient";
import type {
  ForkFn,
  UtilityProcessLike,
} from "@/service/embedding/LocalEmbeddingWorkerClient";
import type { LocalEmbeddingOutboundMessage } from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";
import { LOCAL_XENOVA_ALL_MINILM_MODEL_ID } from "@/service/embedding/LocalEmbeddingModels";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-embed-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Minimal fake worker that auto-responds to initialize/embed-batch so the
 * handshake completes. Records the workerPath the fork was invoked with.
 */
class RecordingFakeWorker {
  readonly sent: unknown[] = [];
  forkedPath: string | null = null;
  private messageHandlers: Array<(m: unknown) => void> = [];

  on(event: string, handler: (arg: unknown) => void): unknown {
    if (event === "message") {
      this.messageHandlers.push(handler);
    }
    return this;
  }

  postMessage(raw: unknown): unknown {
    const msg = typeof raw === "string" ? JSON.parse(raw as string) : raw;
    this.sent.push(msg);
    const m = msg as { type: string; requestId: string; texts?: string[] };
    let response: LocalEmbeddingOutboundMessage | undefined;
    if (m.type === "initialize") {
      response = {
        type: "ready",
        requestId: m.requestId,
        modelId: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
        dimensions: 384,
      };
    } else if (m.type === "embed-batch") {
      const count = m.texts?.length ?? 1;
      response = {
        type: "embed-batch-result",
        requestId: m.requestId,
        modelId: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
        dimensions: 384,
        embeddings: new Array(count).fill(0).map(() => new Array(384).fill(0.1)),
      };
    }
    if (response) {
      queueMicrotask(() => {
        for (const h of this.messageHandlers) {
          h(response);
        }
      });
    }
    return undefined;
  }

  kill(): unknown {
    return undefined;
  }
}

describe("LocalEmbeddingWorkerClient runtime worker resolution (Phase 8 §17.2)", () => {
  it("forks the downloaded runtime worker path when the resolver returns one", async () => {
    const fakeWorkerPath = path.join(tmpRoot, "worker.js");
    fs.writeFileSync(fakeWorkerPath, "// fake downloaded embedding worker");

    const worker = new RecordingFakeWorker();
    const fork: ForkFn = (workerPath: string) => {
      worker.forkedPath = workerPath;
      return worker as unknown as UtilityProcessLike;
    };
    // workerPathOverride = null so the resolver-first path runs.
    const client = LocalEmbeddingWorkerClient.createWithFork(fork, 2000, null);
    client.setWorkerPathResolver(async () => fakeWorkerPath);

    await client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["hello"]);

    expect(worker.forkedPath).toBe(fakeWorkerPath);
    client.dispose();
  });

  it("falls back to bundled candidates when the resolver returns null", async () => {
    const worker = new RecordingFakeWorker();
    const fork: ForkFn = (workerPath: string) => {
      worker.forkedPath = workerPath;
      return worker as unknown as UtilityProcessLike;
    };
    const client = LocalEmbeddingWorkerClient.createWithFork(fork, 2000, null);
    client.setWorkerPathResolver(async () => null);

    // No bundled worker exists in the test env → the fallback search throws.
    await expect(
      client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["hello"]),
    ).rejects.toThrow(/worker file not found/i);
    client.dispose();
  });

  it("falls back when the resolver returns a path that does not exist on disk", async () => {
    const worker = new RecordingFakeWorker();
    const fork: ForkFn = (workerPath: string) => {
      worker.forkedPath = workerPath;
      return worker as unknown as UtilityProcessLike;
    };
    const client = LocalEmbeddingWorkerClient.createWithFork(fork, 2000, null);
    client.setWorkerPathResolver(async () => path.join(tmpRoot, "missing-worker.js"));

    await expect(
      client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["hello"]),
    ).rejects.toThrow(/worker file not found/i);
    client.dispose();
  });

  it("workerPathOverride short-circuits the resolver", async () => {
    const fakeWorkerPath = path.join(tmpRoot, "worker.js");
    fs.writeFileSync(fakeWorkerPath, "// fake");

    const worker = new RecordingFakeWorker();
    const fork: ForkFn = (workerPath: string) => {
      worker.forkedPath = workerPath;
      return worker as unknown as UtilityProcessLike;
    };
    // Default override ("/fake/LocalEmbeddingWorker.js") wins over the resolver.
    const client = LocalEmbeddingWorkerClient.createWithFork(fork, 2000);
    client.setWorkerPathResolver(async () => fakeWorkerPath);

    await client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["hello"]);
    expect(worker.forkedPath).toBe("/fake/LocalEmbeddingWorker.js");
    client.dispose();
  });
});
