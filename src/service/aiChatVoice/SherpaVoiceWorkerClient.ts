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

  private constructor(
    timeoutMs: number = AI_CHAT_VOICE_REQUEST_TIMEOUT_MS,
    forkImpl: ForkFn = defaultFork,
    workerPathOverride: string | null = null
  ) {
    this.timeoutMs = timeoutMs;
    this.forkImpl = forkImpl;
    this.workerPathOverride = workerPathOverride;
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
    const candidates = [
      path.join(__dirname, "childprocess", "AiChatVoiceWorker.js"),
      path.join(__dirname, "../childprocess", "AiChatVoiceWorker.js"),
      path.join(process.cwd(), "dist/childprocess", "AiChatVoiceWorker.js"),
      path.join(
        process.cwd(),
        ".vite/build/childprocess",
        "AiChatVoiceWorker.js"
      ),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.cachedWorkerPath = candidate;
        return candidate;
      }
    }
    throw new Error(
      `Local voice worker file not found. Run yarn dev or yarn make to build AiChatVoiceWorker. Tried: ${candidates.join(
        ", "
      )}`
    );
  }
}
