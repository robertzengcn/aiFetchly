"use strict";
import { utilityProcess } from "electron";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS,
  type LocalEmbeddingBatchMessage,
  type LocalEmbeddingBatchPayload,
  type LocalEmbeddingInitMessage,
  type LocalEmbeddingOutboundMessage,
  type LocalEmbeddingReadyPayload,
} from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";
import { underlyingModelFromModelId } from "@/childprocess/embedding/LocalEmbeddingValidation";
import {
  getPackagedWorkerPathCandidates,
  resolvePackagedWorkerPath,
  type PackagedWorkerPathRuntime,
  buildPackagedWorkerEnv,
} from "@/utils/packagedWorkerPath";

/**
 * Minimal shape of an Electron `UtilityProcess` as used by this client. Abstracted
 * so tests can inject a fake fork implementation without depending on Electron.
 */
export interface UtilityProcessLike {
  on(event: "error", handler: (error: unknown) => void): unknown;
  on(event: "exit", handler: (code: number | null) => void): unknown;
  on(event: "message", handler: (message: unknown) => void): unknown;
  postMessage(message: string): unknown;
  kill(): unknown;
}

export type ForkFn = (workerPath: string) => UtilityProcessLike;

interface PendingRequest {
  resolve: (
    value: LocalEmbeddingReadyPayload | LocalEmbeddingBatchPayload
  ) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const defaultFork: ForkFn = (workerPath): UtilityProcessLike => {
  const proc = utilityProcess.fork(workerPath, [], {
    stdio: "pipe",
    env: buildPackagedWorkerEnv(),
  });
  return proc as unknown as UtilityProcessLike;
};

/**
 * Spawns and drives the local embedding worker process.
 *
 * The client is a singleton in production. It performs an explicit
 * `initialize` → `ready` handshake after fork (so the provider can confirm the
 * model loaded and report dimensions before any embedding work), then forwards
 * `embed-batch` requests and resolves them when the worker returns vectors.
 *
 * Crash handling: if the worker exits or errors at runtime, all pending
 * requests are rejected and internal state is cleared so the next call re-forks.
 */
export class LocalEmbeddingWorkerClient {
  private static instance: LocalEmbeddingWorkerClient | null = null;

  private workerProcess: UtilityProcessLike | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private readonly forkImpl: ForkFn;
  private readonly workerPathOverride: string | null;
  private cachedWorkerPath: string | null = null;
  private startupPromise: Promise<UtilityProcessLike> | null = null;
  private readyPromise: Promise<LocalEmbeddingReadyPayload> | null = null;
  private readyModel: string | null = null;

  private constructor(
    timeoutMs: number = LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS,
    forkImpl: ForkFn = defaultFork,
    workerPathOverride: string | null = null
  ) {
    this.timeoutMs = timeoutMs;
    this.forkImpl = forkImpl;
    this.workerPathOverride = workerPathOverride;
  }

  public static getInstance(): LocalEmbeddingWorkerClient {
    if (LocalEmbeddingWorkerClient.instance === null) {
      LocalEmbeddingWorkerClient.instance = new LocalEmbeddingWorkerClient();
    }
    return LocalEmbeddingWorkerClient.instance;
  }

  /**
   * Test-only factory. Injects a fake fork implementation and (optionally) a
   * fixed worker path so tests skip the filesystem-based path resolution.
   */
  public static createWithFork(
    forkImpl: ForkFn,
    timeoutMs: number = LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS,
    workerPathOverride = "/fake/LocalEmbeddingWorker.js"
  ): LocalEmbeddingWorkerClient {
    return new LocalEmbeddingWorkerClient(
      timeoutMs,
      forkImpl,
      workerPathOverride
    );
  }

  /** Reset the singleton (test helper). */
  public static resetInstance(): void {
    if (LocalEmbeddingWorkerClient.instance) {
      LocalEmbeddingWorkerClient.instance.dispose();
      LocalEmbeddingWorkerClient.instance = null;
    }
  }

  public dispose(): void {
    this.rejectAllPending(new Error("Local embedding worker client disposed"));
    this.readyPromise = null;
    this.readyModel = null;
    this.startupPromise = null;
    if (this.workerProcess) {
      try {
        this.workerProcess.kill();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[LocalEmbeddingWorkerClient] Failed to kill worker: ${message}`
        );
      }
      this.workerProcess = null;
    }
  }

  /**
   * Embed a batch of texts using the local worker. The caller is responsible
   * for batching; the worker enforces its own maximum batch size.
   */
  public async embedBatch(
    modelId: string,
    texts: string[]
  ): Promise<LocalEmbeddingBatchPayload> {
    if (texts.length === 0) {
      // Nothing to do; surface the known MiniLM dimension cheaply.
      const ready = await this.ensureReady(modelId);
      return {
        modelId: ready.modelId,
        dimensions: ready.dimensions,
        embeddings: [],
      };
    }

    await this.ensureReady(modelId);
    const worker = this.workerProcess;
    if (!worker) {
      throw new Error("Local embedding worker became unavailable");
    }

    const requestId = `embed-${uuidv4()}`;

    return new Promise<LocalEmbeddingBatchPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(`Local embedding worker timeout after ${this.timeoutMs}ms`)
        );
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as PendingRequest["resolve"],
        reject,
        timeout,
      });

      const message: LocalEmbeddingBatchMessage = {
        type: "embed-batch",
        requestId,
        modelId,
        texts,
      };

      try {
        worker.postMessage(JSON.stringify(message));
      } catch (postError) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);
        }
        const errorMessage =
          postError instanceof Error ? postError.message : String(postError);
        reject(
          new Error(
            `Failed to post message to local embedding worker: ${errorMessage}`
          )
        );
      }
    });
  }

  private async ensureReady(
    modelId: string
  ): Promise<LocalEmbeddingReadyPayload> {
    if (this.readyPromise && this.readyModel === modelId) {
      return this.readyPromise;
    }
    this.readyModel = modelId;
    this.readyPromise = this.startAndInitialize(modelId);
    try {
      return await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      this.readyModel = null;
      throw error;
    }
  }

  private async ensureWorkerStarted(): Promise<UtilityProcessLike> {
    if (this.workerProcess) {
      return this.workerProcess;
    }
    if (this.startupPromise) {
      return this.startupPromise;
    }
    this.startupPromise = this.startWorker();
    try {
      return await this.startupPromise;
    } catch (error) {
      this.startupPromise = null;
      throw error;
    }
  }

  private async startWorker(): Promise<UtilityProcessLike> {
    const resolvedPath = this.resolveWorkerPath();
    const worker = this.forkImpl(resolvedPath);

    const onError = (error: unknown): void => {
      const msg = error instanceof Error ? error.message : String(error);
      this.handleWorkerGone(`process error: ${msg}`);
    };
    const onExit = (code: number | null): void => {
      const detail = code === null ? "unknown" : String(code);
      this.handleWorkerGone(`exit code: ${detail}`);
    };
    const onMessage = (rawMessage: unknown): void => {
      this.handleWorkerMessage(rawMessage);
    };

    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.on("message", onMessage);

    this.workerProcess = worker;
    this.startupPromise = null;
    return worker;
  }

  private handleWorkerGone(detail: string): void {
    this.rejectAllPending(
      new Error(`Local embedding worker unavailable (${detail})`)
    );
    this.workerProcess = null;
    this.startupPromise = null;
    this.readyPromise = null;
    this.readyModel = null;
  }

  private async startAndInitialize(
    modelId: string
  ): Promise<LocalEmbeddingReadyPayload> {
    const worker = await this.ensureWorkerStarted();
    const requestId = `init-${uuidv4()}`;

    return new Promise<LocalEmbeddingReadyPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.readyPromise = null;
        this.readyModel = null;
        reject(
          new Error(
            `Local embedding worker init timeout after ${this.timeoutMs}ms`
          )
        );
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as PendingRequest["resolve"],
        reject,
        timeout,
      });

      const message: LocalEmbeddingInitMessage = {
        type: "initialize",
        requestId,
        modelId,
        underlyingModel: underlyingModelFromModelId(modelId),
      };

      try {
        worker.postMessage(JSON.stringify(message));
      } catch (postError) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);
        }
        this.readyPromise = null;
        this.readyModel = null;
        const errorMessage =
          postError instanceof Error ? postError.message : String(postError);
        reject(
          new Error(
            `Failed to post init message to local embedding worker: ${errorMessage}`
          )
        );
      }
    });
  }

  private handleWorkerMessage(rawMessage: unknown): void {
    let message: LocalEmbeddingOutboundMessage;
    try {
      const parsed =
        typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
      message = parsed as LocalEmbeddingOutboundMessage;
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      this.rejectAllPending(
        new Error(
          `Failed to parse local embedding worker message: ${errorMessage}`
        )
      );
      return;
    }

    if (
      typeof message !== "object" ||
      message === null ||
      typeof message.requestId !== "string"
    ) {
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.type === "ready") {
      pending.resolve({
        modelId: message.modelId,
        dimensions: message.dimensions,
      });
      return;
    }
    if (message.type === "embed-batch-result") {
      pending.resolve({
        modelId: message.modelId,
        dimensions: message.dimensions,
        embeddings: message.embeddings,
      });
      return;
    }
    if (message.type === "error") {
      pending.reject(new Error(message.error));
      return;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private resolveWorkerPath(): string {
    if (this.workerPathOverride) {
      return this.workerPathOverride;
    }
    if (this.cachedWorkerPath) {
      return this.cachedWorkerPath;
    }
    const electronProcess = process as NodeJS.Process & {
      resourcesPath?: string;
    };
    const runtime: PackagedWorkerPathRuntime = {
      dirname: __dirname,
      cwd: process.cwd(),
      resourcesPath: electronProcess.resourcesPath,
      existsSync: fs.existsSync,
    };
    const options = {
      dirnameRelativePaths: [
        "LocalEmbeddingWorker.js",
        path.join("childprocess", "LocalEmbeddingWorker.js"),
        path.join("..", "childprocess", "LocalEmbeddingWorker.js"),
      ],
      cwdRelativePaths: [
        path.join("dist", "childprocess", "LocalEmbeddingWorker.js"),
        path.join(".vite", "build", "LocalEmbeddingWorker.js"),
        path.join(".vite", "build", "childprocess", "LocalEmbeddingWorker.js"),
      ],
    };
    const resolvedPath = resolvePackagedWorkerPath(runtime, options);
    if (resolvedPath) {
      this.cachedWorkerPath = resolvedPath;
      return resolvedPath;
    }
    const candidates = getPackagedWorkerPathCandidates(runtime, options);
    throw new Error(
      `Local embedding worker file not found. Tried: ${candidates.join(", ")}`
    );
  }
}
