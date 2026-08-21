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
export interface UtilityProcessStreamLike {
  on(event: "data", handler: (chunk: Buffer | string) => void): unknown;
}

export interface UtilityProcessLike {
  on(event: "error", handler: (error: unknown) => void): unknown;
  on(event: "exit", handler: (code: number | null) => void): unknown;
  on(event: "message", handler: (message: unknown) => void): unknown;
  postMessage(message: string): unknown;
  kill(): unknown;
  /** Present when forked with `stdio: "pipe"`. */
  stderr?: UtilityProcessStreamLike;
  stdout?: UtilityProcessStreamLike;
}

export type ForkFn = (workerPath: string) => UtilityProcessLike;

interface PendingRequest {
  resolve: (
    value: LocalEmbeddingReadyPayload | LocalEmbeddingBatchPayload
  ) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Extra NODE_PATH entries for the local embedding utility worker.
 *
 * The downloadable embedding-xenova worker.js lives under userData and
 * `require()`s both:
 *  - runtime-local packages (`@xenova/transformers`, onnxruntime, sharp)
 *  - app packages the slim runtime does not ship (notably `zod`)
 *
 * In packaged builds, `buildPackagedWorkerEnv` already puts app.asar
 * node_modules on NODE_PATH. In electron-forge / unpackaged runs,
 * resourcesPath has no app.asar, so we also add `<cwd>/node_modules`.
 * Always prepend the runtime's own node_modules when present.
 */
export function buildLocalEmbeddingWorkerNodePathExtras(
  workerPath: string,
  options: {
    cwd?: string;
    resourcesPath?: string;
    existsSync?: (candidate: string) => boolean;
    existingNodePath?: string;
    pathDelimiter?: string;
  } = {}
): string {
  const existsSync = options.existsSync ?? fs.existsSync;
  const delimiter = options.pathDelimiter ?? path.delimiter;
  const parts: string[] = [];

  const runtimeNodeModules = path.join(
    path.dirname(workerPath),
    "node_modules"
  );
  if (existsSync(runtimeNodeModules)) {
    parts.push(runtimeNodeModules);
  }

  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };
  const resourcesPath =
    options.resourcesPath ?? electronProcess.resourcesPath ?? "";
  const asarNodeModules = resourcesPath
    ? path.join(resourcesPath, "app.asar", "node_modules")
    : "";
  const hasPackagedAppModules = Boolean(
    asarNodeModules && existsSync(asarNodeModules)
  );
  if (!hasPackagedAppModules) {
    const cwd = options.cwd ?? process.cwd();
    const cwdNodeModules = path.join(cwd, "node_modules");
    if (existsSync(cwdNodeModules)) {
      parts.push(cwdNodeModules);
    }
  }

  const existing =
    options.existingNodePath !== undefined
      ? options.existingNodePath
      : process.env.NODE_PATH;
  if (existing && existing.trim().length > 0) {
    parts.push(existing);
  }

  return parts.join(delimiter);
}

const defaultFork: ForkFn = (workerPath): UtilityProcessLike => {
  const proc = utilityProcess.fork(workerPath, [], {
    stdio: "pipe",
    env: buildPackagedWorkerEnv({
      existingNodePath: buildLocalEmbeddingWorkerNodePathExtras(workerPath),
    }),
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
  /** Truncated stderr/stdout from the current worker for crash diagnostics. */
  private lastWorkerDiag = "";

  /**
   * Optional downloaded embedding-xenova worker path resolver (Phase 8,
   * design §17.2). When installed, the client forks the runtime's worker.js
   * (the manifest entryPoint) instead of the bundled candidate. The worker then
   * resolves Transformers.js/ONNX Runtime/Sharp from its colocated node_modules.
   * Supplied by the main-process LocalAiRuntimeResolver — never renderer-provided.
   */
  private workerPathResolver?: () => Promise<string | null>;

  private constructor(
    timeoutMs: number = LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS,
    forkImpl: ForkFn = defaultFork,
    workerPathOverride: string | null = null
  ) {
    this.timeoutMs = timeoutMs;
    this.forkImpl = forkImpl;
    this.workerPathOverride = workerPathOverride;
  }

  /**
   * Install (or clear) the downloaded embedding worker path resolver. The
   * composition root calls this with a function backed by
   * LocalAiRuntimeResolver so the worker forks from the active runtime. Clears
   * the cached worker path so a newly installed resolver takes effect on the
   * next fork (the running worker is left alone until it exits).
   */
  public setWorkerPathResolver(
    fn: (() => Promise<string | null>) | undefined
  ): void {
    this.workerPathResolver = fn;
    this.cachedWorkerPath = null;
  }

  /**
   * True when the downloadable embedding-xenova runtime worker path resolves.
   * When no resolver is wired (tests / unusual setups), returns false (the
   * bundled fallback path cannot resolve @xenova/transformers).
   */
  public async hasInstalledRuntimeWorker(): Promise<boolean> {
    if (this.workerPathOverride) {
      return true;
    }
    if (!this.workerPathResolver) {
      return false;
    }
    try {
      const runtimeWorkerPath = await this.workerPathResolver();
      return Boolean(runtimeWorkerPath && fs.existsSync(runtimeWorkerPath));
    } catch {
      return false;
    }
  }

  /**
   * Fail-fast readiness probe: fork the worker and complete the initialize
   * handshake for `modelId`. Used before multi-page website imports so a
   * broken runtime does not scrape dozens of pages only to fail on embed.
   */
  public async probeInitialize(modelId: string): Promise<void> {
    await this.ensureReady(modelId);
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
    workerPathOverride: string | null = "/fake/LocalEmbeddingWorker.js"
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
    const resolvedPath = await this.resolveWorkerPathAsync();
    console.log(
      `[LocalEmbeddingWorkerClient] forking worker path=${resolvedPath}`
    );
    this.lastWorkerDiag = "";
    const worker = this.forkImpl(resolvedPath);

    const appendDiag = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.lastWorkerDiag = (this.lastWorkerDiag + text).slice(-4000);
    };
    worker.stderr?.on("data", appendDiag);
    worker.stdout?.on("data", appendDiag);

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
    const diag = this.lastWorkerDiag.trim();
    if (diag) {
      console.error(
        `[LocalEmbeddingWorkerClient] worker gone (${detail}); output:\n${diag}`
      );
    } else {
      console.error(`[LocalEmbeddingWorkerClient] worker gone (${detail})`);
    }
    const suffix = diag
      ? `; worker output: ${diag.replace(/\s+/g, " ").slice(0, 500)}`
      : "";
    this.rejectAllPending(
      new Error(`Local embedding worker unavailable (${detail})${suffix}`)
    );
    this.workerProcess = null;
    this.startupPromise = null;
    this.readyPromise = null;
    this.readyModel = null;
    this.lastWorkerDiag = "";
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

  /**
   * Resolve the worker entry path: downloaded runtime first (design §17.2),
   * then the bundled candidate search as the FR-17 migration fallback.
   * `workerPathOverride` (tests) short-circuits both.
   */
  private async resolveWorkerPathAsync(): Promise<string> {
    if (this.workerPathOverride) {
      return this.workerPathOverride;
    }
    if (this.workerPathResolver) {
      try {
        const runtimeWorkerPath = await this.workerPathResolver();
        if (runtimeWorkerPath && fs.existsSync(runtimeWorkerPath)) {
          this.cachedWorkerPath = runtimeWorkerPath;
          return runtimeWorkerPath;
        }
      } catch {
        // Resolver error → fall through to bundled candidates.
      }
    }
    return this.resolveWorkerPath();
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
