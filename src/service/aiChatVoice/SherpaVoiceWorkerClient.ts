"use strict";
import { utilityProcess } from "electron";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  AI_CHAT_VOICE_REQUEST_TIMEOUT_MS,
  type AiChatVoiceInitializeMessage,
  type AiChatVoiceTranscribeMessage,
  type AiChatVoiceSynthesizeMessage,
  type AiChatVoiceOutboundMessage,
} from "@/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes";

/**
 * Minimal shape of an Electron `UtilityProcess` as used by this client.
 * Abstracted so tests can inject a fake fork without depending on Electron.
 * Mirrors `LocalEmbeddingWorkerClient`.
 */
export interface UtilityProcessLike {
  on(event: "error", handler: (error: unknown) => void): unknown;
  on(event: "exit", handler: (code: number | null) => void): unknown;
  on(event: "message", handler: (message: unknown) => void): unknown;
  postMessage(message: string): unknown;
  kill(): unknown;
}

export type ForkFn = (workerPath: string) => UtilityProcessLike;

export interface VoiceReadyPayload {
  sttAvailable: boolean;
  ttsAvailable: boolean;
}

export interface VoiceTranscribePayload {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface VoiceSynthesizePayload {
  audioBase64: string;
  durationMs?: number;
}

export interface VoiceInitOptions {
  sttModelPath?: string;
  ttsModelPath?: string;
  sttLanguage?: string;
  ttsLanguage?: string;
}

export interface VoiceSynthesizeOptions {
  language?: string;
  voiceId?: string;
  speed?: number;
}

interface PendingRequest {
  resolve: (
    value: VoiceReadyPayload | VoiceTranscribePayload | VoiceSynthesizePayload
  ) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const AI_CHAT_VOICE_WORKER_FILE = "AiChatVoiceWorker.js";

export interface AiChatVoiceWorkerPathRuntime {
  dirname: string;
  cwd: string;
  resourcesPath?: string;
  existsSync: (candidate: string) => boolean;
}

export function mirrorAppAsarUnpackedPath(candidate: string): string {
  return candidate.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

export function getAiChatVoiceWorkerPathCandidates(
  runtime: AiChatVoiceWorkerPathRuntime
): string[] {
  const candidates: string[] = [];
  const addCandidate = (candidate: string): void => {
    const normalized = path.normalize(candidate);
    const unpacked = mirrorAppAsarUnpackedPath(normalized);

    if (unpacked !== normalized && !candidates.includes(unpacked)) {
      candidates.push(unpacked);
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(path.join(runtime.dirname, AI_CHAT_VOICE_WORKER_FILE));
  addCandidate(
    path.join(runtime.dirname, "childprocess", AI_CHAT_VOICE_WORKER_FILE)
  );
  addCandidate(
    path.join(runtime.dirname, "../childprocess", AI_CHAT_VOICE_WORKER_FILE)
  );
  addCandidate(
    path.join(runtime.cwd, "dist", "childprocess", AI_CHAT_VOICE_WORKER_FILE)
  );
  addCandidate(
    path.join(runtime.cwd, ".vite", "build", AI_CHAT_VOICE_WORKER_FILE)
  );
  addCandidate(
    path.join(
      runtime.cwd,
      ".vite",
      "build",
      "childprocess",
      AI_CHAT_VOICE_WORKER_FILE
    )
  );

  if (runtime.resourcesPath) {
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar.unpacked",
        "dist",
        "childprocess",
        AI_CHAT_VOICE_WORKER_FILE
      )
    );
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar.unpacked",
        ".vite",
        "build",
        AI_CHAT_VOICE_WORKER_FILE
      )
    );
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar.unpacked",
        ".vite",
        "build",
        "childprocess",
        AI_CHAT_VOICE_WORKER_FILE
      )
    );
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar",
        "dist",
        "childprocess",
        AI_CHAT_VOICE_WORKER_FILE
      )
    );
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar",
        ".vite",
        "build",
        AI_CHAT_VOICE_WORKER_FILE
      )
    );
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar",
        ".vite",
        "build",
        "childprocess",
        AI_CHAT_VOICE_WORKER_FILE
      )
    );
  }

  return candidates;
}

export function resolveAiChatVoiceWorkerPath(
  runtime: AiChatVoiceWorkerPathRuntime
): string | null {
  const candidates = getAiChatVoiceWorkerPathCandidates(runtime);

  for (const candidate of candidates) {
    if (runtime.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const defaultFork: ForkFn = (workerPath): UtilityProcessLike => {
  const proc = utilityProcess.fork(workerPath, [], {
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      WORKER_TYPE: "ai-chat-voice",
    },
  });
  return proc as unknown as UtilityProcessLike;
};

/**
 * Spawns and drives the local sherpa-onnx voice worker process.
 *
 * Singleton in production. Performs an explicit `initialize` -> `ready`
 * handshake after fork (reports STT/TTS model availability), then forwards
 * `transcribe` / `synthesize` requests and resolves them on the worker's
 * result messages. Crash handling: on worker exit/error, all pending requests
 * are rejected and internal state is cleared so the next call re-forks.
 *
 * Mirrors `LocalEmbeddingWorkerClient` (design §9).
 */
export class SherpaVoiceWorkerClient {
  private static instance: SherpaVoiceWorkerClient | null = null;

  private workerProcess: UtilityProcessLike | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private readonly forkImpl: ForkFn;
  private readonly workerPathOverride: string | null;
  private cachedWorkerPath: string | null = null;
  private startupPromise: Promise<UtilityProcessLike> | null = null;
  private readyPromise: Promise<VoiceReadyPayload> | null = null;
  private readyKey: string | null = null;

  /**
   * Optional voice-sherpa runtime root resolver (Phase 7, design §16.3).
   * When installed, the resolved root is forwarded to the worker in the
   * `initialize` message so sherpa-onnx-node loads from the downloaded runtime
   * directory. Supplied by the main-process LocalAiRuntimeResolver — never
   * renderer-provided.
   */
  private runtimeRootResolver?: () => Promise<string | null>;

  private constructor(
    timeoutMs: number = AI_CHAT_VOICE_REQUEST_TIMEOUT_MS,
    forkImpl: ForkFn = defaultFork,
    workerPathOverride: string | null = null
  ) {
    this.timeoutMs = timeoutMs;
    this.forkImpl = forkImpl;
    this.workerPathOverride = workerPathOverride;
  }

  /**
   * Install (or clear) the voice-sherpa runtime root resolver. The composition
   * root calls this with a function backed by LocalAiRuntimeResolver so the
   * worker loads sherpa-onnx-node from the active downloaded runtime.
   */
  public setRuntimeRootResolver(
    fn: (() => Promise<string | null>) | undefined
  ): void {
    this.runtimeRootResolver = fn;
    // Force re-init so a newly installed resolver takes effect on next use.
    this.readyPromise = null;
    this.readyKey = null;
  }

  public static getInstance(): SherpaVoiceWorkerClient {
    if (SherpaVoiceWorkerClient.instance === null) {
      SherpaVoiceWorkerClient.instance = new SherpaVoiceWorkerClient();
    }
    return SherpaVoiceWorkerClient.instance;
  }

  /** Test-only factory: inject a fake fork + optional fixed worker path. */
  public static createWithFork(
    forkImpl: ForkFn,
    timeoutMs: number = AI_CHAT_VOICE_REQUEST_TIMEOUT_MS,
    workerPathOverride = "/fake/AiChatVoiceWorker.js"
  ): SherpaVoiceWorkerClient {
    return new SherpaVoiceWorkerClient(timeoutMs, forkImpl, workerPathOverride);
  }

  /** Reset the singleton (test helper). */
  public static resetInstance(): void {
    if (SherpaVoiceWorkerClient.instance) {
      SherpaVoiceWorkerClient.instance.dispose();
      SherpaVoiceWorkerClient.instance = null;
    }
  }

  public dispose(): void {
    this.rejectAllPending(new Error("Voice worker client disposed"));
    this.readyPromise = null;
    this.readyKey = null;
    this.startupPromise = null;
    if (this.workerProcess) {
      try {
        this.workerProcess.kill();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[SherpaVoiceWorkerClient] Failed to kill worker: ${message}`
        );
      }
      this.workerProcess = null;
    }
  }

  /** Transcribe a base64 audio payload via the worker. */
  public async transcribe(
    audioBase64: string,
    mimeType: string,
    language?: string,
    init: VoiceInitOptions = {}
  ): Promise<VoiceTranscribePayload> {
    await this.ensureReady(init);
    const worker = this.workerProcess;
    if (!worker) {
      throw new Error("Voice worker became unavailable");
    }
    const requestId = `stt-${uuidv4()}`;
    const message: AiChatVoiceTranscribeMessage = {
      type: "transcribe",
      requestId,
      audioBase64,
      mimeType,
      ...(language !== undefined ? { language } : {}),
    };
    return this.sendRequest<VoiceTranscribePayload>(worker, requestId, message);
  }

  /** Synthesize speech from text via the worker. */
  public async synthesize(
    text: string,
    options: VoiceSynthesizeOptions = {},
    init: VoiceInitOptions = {}
  ): Promise<VoiceSynthesizePayload> {
    await this.ensureReady(init);
    const worker = this.workerProcess;
    if (!worker) {
      throw new Error("Voice worker became unavailable");
    }
    const requestId = `tts-${uuidv4()}`;
    const message: AiChatVoiceSynthesizeMessage = {
      type: "synthesize",
      requestId,
      text,
      ...(options.language !== undefined ? { language: options.language } : {}),
      ...(options.voiceId !== undefined ? { voiceId: options.voiceId } : {}),
      ...(options.speed !== undefined ? { speed: options.speed } : {}),
    };
    return this.sendRequest<VoiceSynthesizePayload>(worker, requestId, message);
  }

  /**
   * Best-effort cancel of pending STT/TTS work (TODO P0-5).
   *
   * With a `requestId`, cancels that single job; without it, cancels every
   * pending request. Each cancelled request's promise rejects with a
   * "cancelled" error and its timeout is cleared, so the caller can stop
   * awaiting. Late worker results for a cancelled request are ignored: by the
   * time they arrive there is no matching pending entry, so
   * `handleWorkerMessage` drops them. Returns the number of requests
   * cancelled. Safe when no worker is active (returns 0).
   */
  public cancel(requestId?: string): number {
    if (requestId !== undefined) {
      const pending = this.pendingRequests.get(requestId);
      if (!pending) {
        return 0;
      }
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.reject(new Error("Voice request cancelled"));
      return 1;
    }
    const count = this.pendingRequests.size;
    this.rejectAllPending(new Error("Voice request cancelled"));
    return count;
  }

  private sendRequest<T>(
    worker: UtilityProcessLike,
    requestId: string,
    message: AiChatVoiceTranscribeMessage | AiChatVoiceSynthesizeMessage
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Voice worker timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as PendingRequest["resolve"],
        reject,
        timeout,
      });

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
          new Error(`Failed to post message to voice worker: ${errorMessage}`)
        );
      }
    });
  }

  private async ensureReady(
    init: VoiceInitOptions
  ): Promise<VoiceReadyPayload> {
    const key = JSON.stringify(init);
    if (this.readyPromise && this.readyKey === key) {
      return this.readyPromise;
    }
    this.readyKey = key;
    this.readyPromise = this.startAndInitialize(init);
    try {
      return await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      this.readyKey = null;
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
    this.rejectAllPending(new Error(`Voice worker unavailable (${detail})`));
    this.workerProcess = null;
    this.startupPromise = null;
    this.readyPromise = null;
    this.readyKey = null;
  }

  private async startAndInitialize(
    init: VoiceInitOptions
  ): Promise<VoiceReadyPayload> {
    const worker = await this.ensureWorkerStarted();
    const requestId = `init-${uuidv4()}`;
    // Resolve the downloaded voice-sherpa runtime root (if any) before building
    // the init message. Bundled fallback is used when no resolver is installed
    // or the resolver returns null (runtime not installed).
    let runtimeRoot: string | null = null;
    if (this.runtimeRootResolver) {
      try {
        runtimeRoot = await this.runtimeRootResolver();
      } catch {
        runtimeRoot = null;
      }
    }

    return new Promise<VoiceReadyPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.readyPromise = null;
        this.readyKey = null;
        reject(
          new Error(`Voice worker init timeout after ${this.timeoutMs}ms`)
        );
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as PendingRequest["resolve"],
        reject,
        timeout,
      });

      const message: AiChatVoiceInitializeMessage = {
        type: "initialize",
        requestId,
        ...(init.sttModelPath !== undefined
          ? { sttModelPath: init.sttModelPath }
          : {}),
        ...(init.ttsModelPath !== undefined
          ? { ttsModelPath: init.ttsModelPath }
          : {}),
        ...(init.sttLanguage !== undefined
          ? { sttLanguage: init.sttLanguage }
          : {}),
        ...(init.ttsLanguage !== undefined
          ? { ttsLanguage: init.ttsLanguage }
          : {}),
        ...(runtimeRoot ? { runtimeRoot } : {}),
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
        this.readyKey = null;
        const errorMessage =
          postError instanceof Error ? postError.message : String(postError);
        reject(
          new Error(
            `Failed to post init message to voice worker: ${errorMessage}`
          )
        );
      }
    });
  }

  private handleWorkerMessage(rawMessage: unknown): void {
    let message: AiChatVoiceOutboundMessage;
    try {
      const parsed =
        typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
      message = parsed as AiChatVoiceOutboundMessage;
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      this.rejectAllPending(
        new Error(`Failed to parse voice worker message: ${errorMessage}`)
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
        sttAvailable: message.sttAvailable,
        ttsAvailable: message.ttsAvailable,
      });
      return;
    }
    if (message.type === "transcribe-result") {
      pending.resolve({
        transcript: message.transcript,
        ...(message.language !== undefined
          ? { language: message.language }
          : {}),
        ...(message.durationMs !== undefined
          ? { durationMs: message.durationMs }
          : {}),
      });
      return;
    }
    if (message.type === "synthesize-result") {
      pending.resolve({
        audioBase64: message.audioBase64,
        ...(message.durationMs !== undefined
          ? { durationMs: message.durationMs }
          : {}),
      });
      return;
    }
    if (message.type === "error") {
      pending.reject(new Error(message.error));
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
    const runtime: AiChatVoiceWorkerPathRuntime = {
      dirname: __dirname,
      cwd: process.cwd(),
      resourcesPath: electronProcess.resourcesPath,
      existsSync: fs.existsSync,
    };
    const resolvedPath = resolveAiChatVoiceWorkerPath(runtime);
    if (resolvedPath) {
      this.cachedWorkerPath = resolvedPath;
      return resolvedPath;
    }
    const candidates = getAiChatVoiceWorkerPathCandidates(runtime);
    throw new Error(
      `Local voice worker file not found. Run yarn dev or yarn make to build AiChatVoiceWorker. Tried: ${candidates.join(
        ", "
      )}`
    );
  }
}
